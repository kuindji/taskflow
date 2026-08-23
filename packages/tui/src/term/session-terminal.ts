import { Terminal } from "@xterm/headless";
import { MSG, KittyKeyboardStack } from "@taskflow/shared";
import type {
    SessionSnapshotResponse,
    SessionHistoryResponse,
    TerminalOutputEvent,
    SessionExitedEvent,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { ChildModes } from "../input/encode";

interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}

interface SessionTerminalDeps {
    net: NetLike;
    sessionId: string;
    owner: SessionOwner;
    cols: number;
    rows: number;
}

interface PendingChunk {
    data: string;
    /** null for markers this client generates itself, which are never stale. */
    sequence: number | null;
}

const SCROLLBACK = 5000;

/**
 * How much already-written output to keep for a possible re-attach. The backend
 * reports the sequence its headless mirror has finished parsing, which trails
 * the sequence it has already sent us, so a snapshot can legitimately exclude a
 * batch this client has already drawn. Those bytes are gone once `reset()`
 * clears the grid, so they are held here until a snapshot claims to cover them.
 * The window is the backend's parse lag, not the session's lifetime, so a small
 * cap is enough; anything older is covered many times over.
 */
const RECENT_LIMIT = 128 * 1024;

class SessionTerminal {
    public readonly terminal: Terminal;

    private historyLoaded = false;
    private pending: PendingChunk[] = [];
    /** Written to the grid already, but not yet known to be in any snapshot. */
    private recent: PendingChunk[] = [];
    private recentBytes = 0;
    private readonly kitty = new KittyKeyboardStack();
    /** Counts kitty push/pop sequences parsed, so a replay can be told whether it carried any. */
    private kittyEvents = 0;
    private hiddenCursor = false;
    private readonly disposers: Array<() => void> = [];
    /** Serializes writes so `attach()` can await the parser actually finishing. */
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private readonly deps: SessionTerminalDeps) {
        this.terminal = new Terminal({
            cols: deps.cols,
            rows: deps.rows,
            allowProposedApi: true,
            scrollback: SCROLLBACK,
        });

        this.registerModeHandlers();

        this.disposers.push(
            deps.net.on(MSG.TERMINAL_OUTPUT, (payload) => {
                const event = payload as TerminalOutputEvent;
                if (event.sessionId !== deps.sessionId) return;
                const chunk: PendingChunk = { data: event.data, sequence: event.sequence };
                if (this.historyLoaded) {
                    this.remember(chunk);
                    void this.enqueue(event.data);
                } else this.pending.push(chunk);
            }),
        );

        this.disposers.push(
            deps.net.on(MSG.SESSION_EXITED, (payload) => {
                const event = payload as SessionExitedEvent;
                if (event.sessionId !== deps.sessionId) return;
                // A session that exits while attach() is still waiting for the
                // snapshot must not have its marker drawn ahead of the output
                // it belongs after, so it queues with the rest.
                const marker = `\r\n\x1b[90m[Process exited with code ${String(event.exitCode)}]\x1b[0m\r\n`;
                const chunk: PendingChunk = { data: marker, sequence: null };
                if (this.historyLoaded) {
                    this.remember(chunk);
                    void this.enqueue(marker);
                } else this.pending.push(chunk);
            }),
        );
    }

    private registerModeHandlers(): void {
        const parser = this.terminal.parser;

        const track = (disposable: { dispose(): void }): void => {
            this.disposers.push(() => {
                disposable.dispose();
            });
        };

        // The child pushing or popping the kitty keyboard protocol. Returning
        // false leaves the sequence to xterm's own handling as well.
        track(
            parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
                const first = params[0];
                this.kitty.push(typeof first === "number" ? first : 0);
                this.kittyEvents += 1;
                return false;
            }),
        );
        track(
            parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
                const first = params[0];
                this.kitty.pop(typeof first === "number" ? first : 1);
                this.kittyEvents += 1;
                return false;
            }),
        );

        // DECTCEM — cursor visibility, which IBuffer does not expose.
        const setCursorVisible =
            (visible: boolean) =>
            (params: (number | number[])[]): boolean => {
                if (params.some((p) => p === 25)) this.hiddenCursor = !visible;
                return false;
            };
        track(parser.registerCsiHandler({ prefix: "?", final: "h" }, setCursorVisible(true)));
        track(parser.registerCsiHandler({ prefix: "?", final: "l" }, setCursorVisible(false)));
    }

    /**
     * `Terminal.write` is asynchronous and reports completion by callback.
     * Queueing through it keeps writes ordered and lets `attach()` resolve only
     * once the parser has consumed everything.
     */
    private enqueue(data: string): Promise<void> {
        this.writeQueue = this.writeQueue.then(
            () =>
                new Promise<void>((resolve) => {
                    this.terminal.write(data, resolve);
                }),
        );
        return this.writeQueue;
    }

    /**
     * Holds a chunk that has been written to the grid in case a re-attach has
     * to replay it, dropping the oldest once the buffer is over its cap.
     */
    private remember(chunk: PendingChunk): void {
        this.recent.push(chunk);
        this.recentBytes += chunk.data.length;
        while (this.recentBytes > RECENT_LIMIT && this.recent.length > 1) {
            const dropped = this.recent.shift();
            if (dropped) this.recentBytes -= dropped.data.length;
        }
    }

    private takeRecent(): PendingChunk[] {
        const taken = this.recent;
        this.recent = [];
        this.recentBytes = 0;
        return taken;
    }

    /** Runs `action` in write order, once the parser has caught up. */
    private enqueueAction(action: () => void): Promise<void> {
        this.writeQueue = this.writeQueue.then(action);
        return this.writeQueue;
    }

    get modes(): ChildModes {
        return {
            applicationCursorKeys: this.terminal.modes.applicationCursorKeysMode,
            bracketedPaste: this.terminal.modes.bracketedPasteMode,
            kittyFlags: this.kitty.flags,
        };
    }

    get cursorHidden(): boolean {
        return this.hiddenCursor;
    }

    async attach(): Promise<void> {
        // A second attach means the connection dropped and came back. The
        // snapshot is the entire screen, so the old grid must go first or it
        // renders twice. terminal.reset() also clears DEC modes, which the
        // child set long ago and will not send again, so they are held here
        // for the fallback path below.
        let restore = "";
        let savedKitty: (number | null)[] = [];
        if (this.historyLoaded) {
            this.historyLoaded = false;
            // reset() is about to wipe the grid, so output that is already on it
            // but may not be in the coming snapshot has to go back in the replay
            // queue. finishLoad drops whatever the snapshot turns out to cover.
            this.pending = this.takeRecent();
            // The reset goes through the write queue: output that was still
            // queued when the socket dropped has to be parsed before the clear,
            // or it lands on the fresh grid and the modes it carries are lost.
            await this.enqueueAction(() => {
                const previous = this.modes;
                savedKitty = this.kitty.toArray();
                this.terminal.reset();
                // reset() restores DECTCEM to visible; our tracking has to follow it.
                this.hiddenCursor = false;
                // The kitty stack is ours, not xterm's, so reset() leaves it
                // alone — but everything that built it is about to be replayed.
                // Keeping it would stack a second copy of the child's push on
                // top, and the child's next pop would land on the duplicate
                // instead of leaving the protocol.
                this.kitty.restore([]);
                if (previous.applicationCursorKeys) restore += "\x1b[?1h";
                if (previous.bracketedPaste) restore += "\x1b[?2004h";
            });
        }

        try {
            const snapshot = await this.deps.net.request<SessionSnapshotResponse>(
                MSG.SESSION_SNAPSHOT,
                { sessionId: this.deps.sessionId },
            );
            if (snapshot.snapshot !== null) {
                // The serialized screen carries no kitty keyboard state, so the
                // backend reports it separately; without it a client attaching
                // to a session already in kitty mode would encode legacy keys.
                this.kitty.restore(snapshot.kittyStack);
                void this.enqueue(snapshot.snapshot);
                if (snapshot.cursorHidden) {
                    void this.enqueue("\x1b[?25l");
                    this.hiddenCursor = true;
                }
                await this.finishLoad(snapshot.lastSequence);
                return;
            }
        } catch {
            // Fall through to history.
        }

        // Only the history path needs the pre-drop modes back. SerializeAddon
        // writes an enable sequence for a mode that is on and nothing for one
        // that is off, so replaying them over a snapshot would switch back on
        // whatever the child turned off while we were disconnected. History is
        // raw scrollback and may have been trimmed past the sequences that set
        // them, so there the saved state is the best we have.
        if (restore !== "") void this.enqueue(restore);

        const kittyEventsBefore = this.kittyEvents;
        try {
            const history = await this.deps.net.request<SessionHistoryResponse>(
                MSG.SESSION_HISTORY,
                { ...this.deps.owner, sessionId: this.deps.sessionId },
            );
            if (history.data) await this.enqueue(history.data);
            this.recoverKittyStack(savedKitty, this.kittyEvents === kittyEventsBefore);
            await this.finishLoad(history.lastSequence);
        } catch {
            this.recoverKittyStack(savedKitty, this.kittyEvents === kittyEventsBefore);
            await this.finishLoad(-1);
        }
    }

    /**
     * History has been replayed. If it carried any of the child's own pushes or
     * pops the stack rebuilt itself and stands — including when it rebuilt to
     * empty, which means the child left the protocol while we were disconnected
     * and must not be dragged back into it. Only a replay that carried no kitty
     * sequences at all leaves the pre-drop state as the best guess, the same
     * reasoning that replays the saved DEC modes on this path.
     */
    private recoverKittyStack(
        saved: readonly (number | null)[],
        historyCarriedNoKitty: boolean,
    ): void {
        if (!historyCarriedNoKitty) return;
        if (this.kitty.flags === null && saved.length > 0) this.kitty.restore(saved);
    }

    private async finishLoad(lastSequence: number): Promise<void> {
        this.historyLoaded = true;
        const replay = this.pending;
        this.pending = [];
        for (const chunk of replay) {
            if (chunk.sequence === null || chunk.sequence > lastSequence) {
                // A replayed chunk is on the grid but still outside every
                // snapshot taken so far, exactly like a live one, so it has to
                // be held back for the next re-attach too. Forgetting it here
                // would lose it if the connection dropped again before the
                // backend finished parsing the batch.
                this.remember(chunk);
                void this.enqueue(chunk.data);
            }
        }
        await this.writeQueue;
    }

    /**
     * Move the scrollback view by `lines` — negative is back into history.
     *
     * A method here rather than a reach through the public `terminal` from the
     * UI layer: xterm's scrolling API stays in one place, and Stage 2 will want
     * this to interact with `attach()`'s replay, which only this class can see.
     */
    scroll(lines: number): void {
        this.terminal.scrollLines(lines);
    }

    resize(cols: number, rows: number): void {
        this.terminal.resize(cols, rows);
        void this.deps.net
            .request(MSG.TERMINAL_RESIZE, { sessionId: this.deps.sessionId, cols, rows })
            .catch(() => undefined);
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.terminal.dispose();
    }
}

export { SessionTerminal };
export type { SessionOwner };

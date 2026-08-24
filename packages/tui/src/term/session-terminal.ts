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

/**
 * The DEC private modes that choose how mouse reports are spelled. `IModes`
 * reports the tracking mode but has no member for the encoding, so these are
 * read off the child's own output stream.
 */
const MOUSE_ENCODING_MODES: Record<number, ChildModes["mouseEncoding"] | undefined> = {
    1005: "utf8",
    1006: "sgr",
    1015: "urxvt",
    1016: "sgr-pixels",
};

/** The sequence that puts each tracking mode back after a `reset()`. */
const MOUSE_TRACKING_SET: Record<ChildModes["mouseTracking"], string> = {
    none: "",
    x10: "\x1b[?9h",
    vt200: "\x1b[?1000h",
    drag: "\x1b[?1002h",
    any: "\x1b[?1003h",
};

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
    /** `?1005`/`?1006`/`?1015`/`?1016`; xterm's `IModes` does not expose it. */
    private mouseEncoding: ChildModes["mouseEncoding"] = "x10";
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

        // The DEC private modes xterm either does not expose or does not
        // parse: DECTCEM, which IBuffer has no member for, and the four mouse
        // encoding modes, which IModes has no member for either.
        const decPrivateMode =
            (set: boolean) =>
            (params: (number | number[])[]): boolean => {
                for (const param of params) {
                    if (typeof param !== "number") continue;
                    if (param === 25) this.hiddenCursor = !set;
                    const encoding = MOUSE_ENCODING_MODES[param];
                    if (encoding === undefined) continue;
                    // Last enable wins. A disable only clears the encoding that
                    // is actually on, so a child in SGR that resets urxvt stays
                    // in SGR rather than dropping to the default.
                    if (set) this.mouseEncoding = encoding;
                    else if (this.mouseEncoding === encoding) this.mouseEncoding = "x10";
                }
                return false;
            };
        track(parser.registerCsiHandler({ prefix: "?", final: "h" }, decPrivateMode(true)));
        track(parser.registerCsiHandler({ prefix: "?", final: "l" }, decPrivateMode(false)));

        // RIS. xterm puts its own modes back to power-on defaults, but the two
        // it does not expose are ours to reset: a child that re-enables
        // tracking after a reset without reselecting an extended encoding is
        // parsing legacy bytes, and the grid's cursor is visible again whatever
        // the child hid before. This is deliberately narrower than a
        // `terminal.reset()` hook — attach() calls that API directly, and the
        // encoding has to survive *that* one, since nothing on either re-attach
        // path can restore it.
        track(
            parser.registerEscHandler({ final: "c" }, (): boolean => {
                this.mouseEncoding = "x10";
                this.hiddenCursor = false;
                return false;
            }),
        );
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
            mouseTracking: this.terminal.modes.mouseTrackingMode,
            mouseEncoding: this.mouseEncoding,
        };
    }

    get cursorHidden(): boolean {
        return this.hiddenCursor;
    }

    async attach(): Promise<void> {
        // A second attach means the connection dropped and came back. The
        // snapshot is the entire screen, so the old grid must go before one is
        // applied or it renders twice — but not one moment sooner. A tunnel
        // that drops again while the snapshot is in flight leaves both fetches
        // rejecting, and a grid cleared up front is then a blank pane holding
        // output the backend still has and nothing on this side redraws until
        // some later reconnect happens to succeed. So the clear is deferred to
        // the point where there is something to put in its place, and the
        // failure path simply leaves the screen alone.
        //
        // terminal.reset() also clears DEC modes, which the child set long ago
        // and will not send again, so they are held here for the fallback path
        // below.
        const reattaching = this.historyLoaded;
        let restore = "";
        let savedKitty: (number | null)[] = [];
        let cleared = false;
        const clearGrid = async (): Promise<void> => {
            if (!reattaching || cleared) return;
            cleared = true;
            // Output stops being written straight to the grid from here: what
            // arrives during the rest of the attach belongs after the replay,
            // which is what `pending` is for.
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
                // The mouse *encoding* deliberately survives the reset. Neither
                // path can restore it: `IModes` has no member for it, so
                // SerializeAddon writes nothing for it into the snapshot, and
                // trimmed history may no longer hold the sequence that set it.
                // The pre-drop value is the only thing that knows what the
                // child is parsing, and output replayed below still overrides
                // it. Clearing it here would spell every click after a
                // reconnect in legacy bytes to a child waiting for SGR.
                // The kitty stack is ours, not xterm's, so reset() leaves it
                // alone — but everything that built it is about to be replayed.
                // Keeping it would stack a second copy of the child's push on
                // top, and the child's next pop would land on the duplicate
                // instead of leaving the protocol.
                this.kitty.restore([]);
                if (previous.applicationCursorKeys) restore += "\x1b[?1h";
                if (previous.bracketedPaste) restore += "\x1b[?2004h";
                // Tracking, unlike the encoding above, is xterm's own and the
                // reset really did clear it, so the history path has to put it
                // back or every click after the reconnect is dropped.
                restore += MOUSE_TRACKING_SET[previous.mouseTracking];
            });
        };

        try {
            const snapshot = await this.deps.net.request<SessionSnapshotResponse>(
                MSG.SESSION_SNAPSHOT,
                { sessionId: this.deps.sessionId },
            );
            if (snapshot.snapshot !== null) {
                await clearGrid();
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

        let kittyEventsBefore = this.kittyEvents;
        try {
            const history = await this.deps.net.request<SessionHistoryResponse>(
                MSG.SESSION_HISTORY,
                { ...this.deps.owner, sessionId: this.deps.sessionId },
            );
            await clearGrid();
            // Counted after the clear, because the clear is what empties the
            // stack the recovery below decides about.
            kittyEventsBefore = this.kittyEvents;
            // Only the history path needs the pre-drop modes back. SerializeAddon
            // writes an enable sequence for a mode that is on and nothing for one
            // that is off, so replaying them over a snapshot would switch back on
            // whatever the child turned off while we were disconnected. History is
            // raw scrollback and may have been trimmed past the sequences that set
            // them, so there the saved state is the best we have.
            if (restore !== "") void this.enqueue(restore);
            if (history.data) await this.enqueue(history.data);
            this.recoverKittyStack(savedKitty, this.kittyEvents === kittyEventsBefore);
            await this.finishLoad(history.lastSequence);
        } catch {
            // Nothing was fetched, so nothing was cleared: the grid still holds
            // the screen it had, `savedKitty` is empty because the reset that
            // fills it never ran, and finishLoad only puts `historyLoaded` back
            // where it was.
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

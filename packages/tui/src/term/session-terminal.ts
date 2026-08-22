import { Terminal } from "@xterm/headless";
import { MSG } from "@taskflow/shared";
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
    sequence: number;
}

const SCROLLBACK = 5000;

class SessionTerminal {
    public readonly terminal: Terminal;

    private historyLoaded = false;
    private pending: PendingChunk[] = [];
    private kittyFlags: number | null = null;
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
                if (this.historyLoaded) void this.enqueue(event.data);
                else this.pending.push({ data: event.data, sequence: event.sequence });
            }),
        );

        this.disposers.push(
            deps.net.on(MSG.SESSION_EXITED, (payload) => {
                const event = payload as SessionExitedEvent;
                if (event.sessionId !== deps.sessionId) return;
                void this.enqueue(
                    `\r\n\x1b[90m[Process exited with code ${String(event.exitCode)}]\x1b[0m\r\n`,
                );
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
                this.kittyFlags = typeof first === "number" ? first : 1;
                return false;
            }),
        );
        track(
            parser.registerCsiHandler({ prefix: "<", final: "u" }, () => {
                this.kittyFlags = null;
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

    get modes(): ChildModes {
        return {
            applicationCursorKeys: this.terminal.modes.applicationCursorKeysMode,
            bracketedPaste: this.terminal.modes.bracketedPasteMode,
            kittyFlags: this.kittyFlags,
        };
    }

    get cursorHidden(): boolean {
        return this.hiddenCursor;
    }

    async attach(): Promise<void> {
        // A second attach means the connection dropped and came back. The
        // snapshot is the entire screen, so the old grid must go first or it
        // renders twice. terminal.reset() also clears DEC modes, which the
        // child set long ago and will not send again, so they are restored.
        if (this.historyLoaded) {
            const previous = this.modes;
            this.historyLoaded = false;
            this.pending = [];
            this.terminal.reset();
            // reset() restores DECTCEM to visible; our tracking has to follow it.
            this.hiddenCursor = false;
            let restore = "";
            if (previous.applicationCursorKeys) restore += "\x1b[?1h";
            if (previous.bracketedPaste) restore += "\x1b[?2004h";
            if (restore !== "") await this.enqueue(restore);
        }

        try {
            const snapshot = await this.deps.net.request<SessionSnapshotResponse>(
                MSG.SESSION_SNAPSHOT,
                { sessionId: this.deps.sessionId },
            );
            if (snapshot.snapshot !== null) {
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

        try {
            const history = await this.deps.net.request<SessionHistoryResponse>(
                MSG.SESSION_HISTORY,
                { ...this.deps.owner, sessionId: this.deps.sessionId },
            );
            if (history.data) void this.enqueue(history.data);
            await this.finishLoad(history.lastSequence);
        } catch {
            await this.finishLoad(-1);
        }
    }

    private async finishLoad(lastSequence: number): Promise<void> {
        this.historyLoaded = true;
        const replay = this.pending;
        this.pending = [];
        for (const chunk of replay) {
            if (chunk.sequence > lastSequence) void this.enqueue(chunk.data);
        }
        await this.writeQueue;
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

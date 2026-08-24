import { EmbeddedTerminalRenderable, type CliRenderer } from "@opentui/core";
import { MSG } from "@taskflow/shared";
import type {
    SessionExitedEvent,
    SessionHistoryResponse,
    SessionSnapshotResponse,
    TerminalOutputEvent,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { inputBytesToString } from "./input-bytes";
import { assertCompatibleSnapshot, supplementalSnapshotSequence } from "./snapshot-state";

interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}

interface SessionBridgeDeps {
    renderer: CliRenderer;
    net: NetLike;
    sessionId: string;
    owner: SessionOwner;
    cols: number;
    rows: number;
}

interface PendingChunk {
    data: string;
    sequence: number | null;
}

const RECENT_LIMIT = 128 * 1024;
// OpenTUI accounts the native cell storage, not just the input bytes. A
// 200-column ASCII fixture needs about 11 MiB to retain 5,000 complete rows.
const MAX_SCROLLBACK_BYTES = 16 * 1024 * 1024;

class SessionBridge {
    readonly renderable: EmbeddedTerminalRenderable;
    private loaded = false;
    private replaying = false;
    private destroyed = false;
    private active = false;
    private inputEnabled = true;
    private pending: PendingChunk[] = [];
    private recent: PendingChunk[] = [];
    private recentBytes = 0;
    private attachQueue: Promise<void> = Promise.resolve();
    private readonly disposers: Array<() => void> = [];
    private lastResize: { cols: number; rows: number } | null = null;

    constructor(private readonly deps: SessionBridgeDeps) {
        this.renderable = new EmbeddedTerminalRenderable(deps.renderer, {
            id: `session-${deps.sessionId}`,
            cols: deps.cols,
            rows: deps.rows,
            width: "100%",
            height: "100%",
            maxScrollback: MAX_SCROLLBACK_BYTES,
            selectable: false,
            visible: false,
            onData: (bytes, source) => {
                if (source === "response" && this.replaying) return;
                this.sendInput(bytes);
            },
            onTerminalResize: (cols, rows) => this.sendResize(cols, rows),
        });

        this.disposers.push(
            deps.net.on(MSG.TERMINAL_OUTPUT, (payload) => {
                const event = payload as TerminalOutputEvent;
                if (event.sessionId !== deps.sessionId) return;
                this.receive({ data: event.data, sequence: event.sequence });
            }),
        );
        this.disposers.push(
            deps.net.on(MSG.SESSION_EXITED, (payload) => {
                const event = payload as SessionExitedEvent;
                if (event.sessionId !== deps.sessionId) return;
                this.receive({
                    data: `\r\n\x1b[90m[Process exited with code ${String(event.exitCode)}]\x1b[0m\r\n`,
                    sequence: null,
                });
            }),
        );
    }

    private receive(chunk: PendingChunk): void {
        if (this.destroyed) return;
        if (!this.loaded) {
            this.pending.push(chunk);
            return;
        }
        this.remember(chunk);
        this.writeLive(chunk.data);
    }

    private writeReplay(data: string): void {
        if (data === "") return;
        this.replaying = true;
        try {
            this.renderable.write(data);
        } finally {
            this.replaying = false;
        }
    }

    private writeLive(data: string): void {
        if (data !== "") this.renderable.write(data);
    }

    private remember(chunk: PendingChunk): void {
        this.recent.push(chunk);
        this.recentBytes += chunk.data.length;
        while (this.recentBytes > RECENT_LIMIT && this.recent.length > 1) {
            const dropped = this.recent.shift();
            if (dropped) this.recentBytes -= dropped.data.length;
        }
    }

    private takeRecent(): PendingChunk[] {
        const recent = this.recent;
        this.recent = [];
        this.recentBytes = 0;
        return recent;
    }

    attach(): Promise<void> {
        const run = this.attachQueue.then(() => this.attachOnce());
        this.attachQueue = run.catch(() => undefined);
        return run;
    }

    private async attachOnce(): Promise<void> {
        const snapshot: SessionSnapshotResponse | Record<string, unknown> | null =
            await this.deps.net
                .request<SessionSnapshotResponse>(MSG.SESSION_SNAPSHOT, {
                    sessionId: this.deps.sessionId,
                })
                .catch(() => null);

        if (snapshot !== null) {
            assertCompatibleSnapshot(snapshot);
            if (snapshot.snapshot !== null) {
                this.beginReplacement();
                this.writeReplay(snapshot.snapshot);
                this.writeReplay(supplementalSnapshotSequence(snapshot));
                this.finishReplacement(snapshot.lastSequence);
                return;
            }
        }

        try {
            const history = await this.deps.net.request<SessionHistoryResponse>(
                MSG.SESSION_HISTORY,
                { ...this.deps.owner, sessionId: this.deps.sessionId },
            );
            this.beginReplacement();
            this.writeReplay(history.data);
            this.finishReplacement(history.lastSequence);
        } catch {
            this.finishReplacement(-1, false);
        }
    }

    private beginReplacement(): void {
        if (this.loaded) {
            this.loaded = false;
            this.pending = this.takeRecent();
            this.writeReplay("\x1bc");
        }
    }

    private finishReplacement(lastSequence: number, replacementApplied = true): void {
        if (!replacementApplied && this.loaded) return;
        this.loaded = true;
        const pending = this.pending;
        this.pending = [];
        for (const chunk of pending) {
            if (chunk.sequence === null || chunk.sequence > lastSequence) {
                this.remember(chunk);
                this.writeReplay(chunk.data);
            }
        }
    }

    private sendInput(bytes: Uint8Array): void {
        const data = inputBytesToString(bytes);
        if (data === null || this.destroyed || !this.inputEnabled) return;
        void this.deps.net
            .request(MSG.SESSION_INPUT, { sessionId: this.deps.sessionId, data })
            .catch(() => undefined);
    }

    private sendResize(cols: number, rows: number): void {
        if (this.destroyed) return;
        if (this.lastResize?.cols === cols && this.lastResize.rows === rows) return;
        this.lastResize = { cols, rows };
        void this.deps.net
            .request(MSG.TERMINAL_RESIZE, { sessionId: this.deps.sessionId, cols, rows })
            .catch(() => undefined);
    }

    setActive(active: boolean, cols?: number, rows?: number): void {
        this.active = active;
        this.renderable.visible = active;
        if (active && cols !== undefined && rows !== undefined) {
            this.renderable.width = cols;
            this.renderable.height = rows;
            this.sendResize(cols, rows);
        }
    }

    focus(): void {
        if (this.active) this.renderable.focus();
    }

    blur(): void {
        this.renderable.blur();
    }

    setInputEnabled(enabled: boolean): void {
        this.inputEnabled = enabled;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.renderable.destroy();
    }
}

export { SessionBridge };
export type { SessionBridgeDeps, SessionOwner };

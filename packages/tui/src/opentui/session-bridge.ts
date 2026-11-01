import {
    ClipboardTarget,
    EmbeddedTerminalRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import { MSG, assertCompatibleSnapshot, supplementalSnapshotSequence } from "@taskflow/shared";
import type {
    SessionExitedEvent,
    SessionHistoryResponse,
    SessionSnapshotResponse,
    TerminalOutputEvent,
    TerminalResyncEvent,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { inputBytesToString } from "./input-bytes";
import { Osc52Scanner } from "./osc52";
import type { Osc52Sink, Osc52Target } from "./osc52";
import { EmbeddedTerminalOutputFilter } from "./terminal-output";

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
    clipboard?: Osc52Sink;
}

interface PendingChunk {
    data: string;
    sequence: number | null;
}

const RECENT_LIMIT = 128 * 1024;
// OpenTUI accounts the native cell storage, not just the input bytes. A
// 200-column ASCII fixture needs about 11 MiB to retain 5,000 complete rows.
const MAX_SCROLLBACK_BYTES = 16 * 1024 * 1024;

const ESC = 0x1b;

/**
 * On macOS the native legacy key encoder treats Option as a text modifier and
 * drops Alt, so Alt+B reaches a non-Kitty child as a bare "b". The outer
 * terminal already reported Alt (Option-as-Meta), so restore the ESC prefix.
 * Kitty encodings and modified CSI keys already start with ESC.
 */
class SessionTerminalRenderable extends EmbeddedTerminalRenderable {
    override encodeKey(key: KeyEvent): Uint8Array {
        const bytes = super.encodeKey(key);
        if (!key.option || key.super || key.hyper) return bytes;
        if (bytes.length === 0 || bytes[0] === ESC) return bytes;
        const prefixed = new Uint8Array(bytes.length + 1);
        prefixed[0] = ESC;
        prefixed.set(bytes, 1);
        return prefixed;
    }
}

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
    private attachOperation: Promise<void> | null = null;
    private followUp = false;
    private buffering = true;
    private dirty = false;
    private lastAccepted: number | null = null;
    private highestReceived = 0;
    private readonly exitMarkers: string[] = [];
    private readonly disposers: Array<() => void> = [];
    private lastResize: { cols: number; rows: number } | null = null;
    /** The pane size `setActive` last gave the renderable, whose own width is layout-computed. */
    private appliedSize: { cols: number; rows: number };
    private readonly osc52: Osc52Scanner;
    private readonly outputFilter = new EmbeddedTerminalOutputFilter();

    constructor(private readonly deps: SessionBridgeDeps) {
        this.appliedSize = { cols: deps.cols, rows: deps.rows };
        this.osc52 = new Osc52Scanner(deps.clipboard ?? rendererClipboardSink(deps.renderer));
        this.renderable = new SessionTerminalRenderable(deps.renderer, {
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
            deps.net.on(MSG.TERMINAL_RESYNC, (payload) => {
                const event = payload as TerminalResyncEvent;
                if (event.sessionIds.includes(deps.sessionId))
                    void this.attach().catch(() => undefined);
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
        if (chunk.sequence === null) {
            this.exitMarkers.push(chunk.data);
            if (!this.buffering) this.writeLive(chunk.data);
            return;
        }
        if (this.lastAccepted !== null && chunk.sequence <= this.lastAccepted) return;
        this.highestReceived = Math.max(this.highestReceived, chunk.sequence);
        if (this.buffering) {
            this.pending.push(chunk);
            if (this.dirty && !this.attachOperation) void this.attach().catch(() => undefined);
            return;
        }
        if (this.lastAccepted !== null && chunk.sequence !== this.lastAccepted + 1) {
            this.pending.push(chunk);
            void this.attach().catch(() => undefined);
            return;
        }
        this.remember(chunk);
        this.lastAccepted = chunk.sequence;
        this.osc52.feed(chunk.data);
        this.writeLive(chunk.data);
    }

    private writeReplay(data: string): void {
        const filtered = this.outputFilter.feed(data);
        if (filtered === "") return;
        this.replaying = true;
        try {
            this.renderable.write(filtered);
        } finally {
            this.replaying = false;
        }
    }

    private writeLive(data: string): void {
        const filtered = this.outputFilter.feed(data);
        if (filtered !== "") this.renderable.write(filtered);
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
        if (this.destroyed) return Promise.resolve();
        if (this.attachOperation) {
            this.followUp = true;
            return this.attachOperation;
        }
        const run = (async () => {
            do {
                this.followUp = false;
                await this.attachOnce();
            } while (this.followUp && !this.destroyed);
        })();
        this.attachOperation = run.finally(() => {
            this.attachOperation = null;
        });
        return this.attachOperation;
    }

    private catchUp(sequence: number): {
        chunks: PendingChunk[];
        sequence: number;
        complete: boolean;
    } {
        const numbered = new Map<number, PendingChunk>();
        for (const chunk of this.pending)
            if (chunk.sequence !== null) numbered.set(chunk.sequence, chunk);
        const chunks: PendingChunk[] = [];
        for (const [next, chunk] of [...numbered].sort(([a], [b]) => a - b)) {
            if (next <= sequence) continue;
            if (next !== sequence + 1) break;
            chunks.push(chunk);
            sequence = next;
        }
        return { chunks, sequence, complete: sequence >= this.highestReceived };
    }

    private async attachOnce(): Promise<void> {
        // Buffer from before the request, preserving the visible screen until
        // either response can establish a complete replacement.
        this.buffering = true;
        this.dirty = true;
        this.pending = [...this.takeRecent(), ...this.pending];
        const snapshot = await this.deps.net
            .request<SessionSnapshotResponse>(MSG.SESSION_SNAPSHOT, {
                sessionId: this.deps.sessionId,
            })
            .catch(() => null);
        if (this.destroyed) return;
        if (snapshot !== null) assertCompatibleSnapshot(snapshot);
        if (snapshot?.snapshot != null && this.catchUp(snapshot.lastSequence).complete) {
            this.beginReplacement();
            this.writeReplay(snapshot.snapshot);
            this.writeReplay(supplementalSnapshotSequence(snapshot));
            this.finishReplacement(snapshot.lastSequence);
            return;
        }

        let history: SessionHistoryResponse;
        try {
            history = await this.deps.net.request<SessionHistoryResponse>(MSG.SESSION_HISTORY, {
                ...this.deps.owner,
                sessionId: this.deps.sessionId,
            });
        } catch {
            // Leave the last good screen and the dirty buffer for a later trigger.
            return;
        }
        if (this.destroyed) return;
        if (!this.catchUp(history.lastSequence).complete) return;
        this.beginReplacement();
        this.writeReplay(history.data);
        this.finishReplacement(history.lastSequence);
    }

    private beginReplacement(): void {
        this.outputFilter.reset();
        this.osc52.reset();
        if (this.loaded) this.writeReplay("\x1bc");
    }

    private finishReplacement(lastSequence: number): void {
        const bridge = this.catchUp(lastSequence);
        for (const chunk of bridge.chunks) {
            this.remember(chunk);
            this.writeReplay(chunk.data);
        }
        for (const marker of this.exitMarkers) this.writeReplay(marker);
        this.loaded = true;
        this.lastAccepted = bridge.sequence;
        this.highestReceived = Math.max(this.highestReceived, bridge.sequence);
        this.dirty = !this.catchUp(bridge.sequence).complete;
        if (!this.dirty) {
            this.pending = [];
            this.buffering = false;
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

    /**
     * Forget the last size sent, which may never have arrived (a resize while
     * the machine was offline is dropped). An active bridge resends its current
     * size now. An inactive one sends its real size on the next `setActive`.
     */
    resetResize(): void {
        this.lastResize = null;
        if (!this.active) return;
        this.sendResize(this.appliedSize.cols, this.appliedSize.rows);
    }

    setActive(active: boolean, cols?: number, rows?: number): void {
        this.active = active;
        this.renderable.visible = active;
        if (active && cols !== undefined && rows !== undefined) {
            this.appliedSize = { cols, rows };
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
        this.followUp = false;
        this.pending = [];
        this.recent = [];
        this.exitMarkers.length = 0;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.osc52.reset();
        this.outputFilter.reset();
        this.renderable.destroy();
    }
}

function clipboardTarget(target: Osc52Target): ClipboardTarget {
    switch (target) {
        case "clipboard":
            return ClipboardTarget.Clipboard;
        case "primary":
            return ClipboardTarget.Primary;
        case "select":
            return ClipboardTarget.Select;
    }
}

function rendererClipboardSink(renderer: CliRenderer): Osc52Sink {
    return {
        copy: (text, target) => {
            renderer.copyToClipboardOSC52(text, clipboardTarget(target));
        },
        clear: (target) => {
            renderer.clearClipboardOSC52(clipboardTarget(target));
        },
    };
}

export { SessionBridge };
export type { SessionBridgeDeps, SessionOwner };

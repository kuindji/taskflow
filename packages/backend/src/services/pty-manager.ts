import { randomUUID } from "crypto";
import type { Terminal } from "bun";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { TERMINAL_SCROLLBACK } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";
import { isWindows } from "./platform";
import { WindowsPtySession } from "./pty-session-win";

interface SpawnOptions {
    command: string;
    args: string[];
    cwd: string;
    onData: (data: string, sequence: number) => void;
    onExit: (exitCode: number) => void;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /**
     * Text to type into the PTY once startup output goes quiet — for agents
     * with no CLI flag for an initial prompt (kimi). Sent as a bracketed
     * paste followed by Enter.
     */
    initialInput?: string;
}

const MAX_SCROLLBACK = 50_000;
const BATCH_MAX_SIZE = 128 * 1024; // 128KB — smaller batches are easier for the frontend to time-budget
const BATCH_CEILING_MS = 50; // Force-flush safety ceiling during sustained bursts
const INITIAL_INPUT_QUIET_MS = 500; // inject after this much output silence
const INITIAL_INPUT_MAX_WAIT_MS = 10_000; // inject regardless after this long
const INITIAL_INPUT_SUBMIT_DELAY_MS = 50; // gap between paste and Enter

/**
 * Batches PTY output chunks to reduce WebSocket message frequency.
 *
 * Uses setImmediate for low-latency coalescing: data arriving in the same
 * I/O cycle is merged before the next event-loop turn.  A secondary
 * setTimeout ceiling (50 ms) guarantees a flush even when data arrives
 * continuously without pause.
 */
class DataBatcher {
    private buffer = "";
    private immediateHandle: ReturnType<typeof setImmediate> | null = null;
    private ceilingTimer: ReturnType<typeof setTimeout> | null = null;
    private onFlush: (data: string) => void;

    constructor(onFlush: (data: string) => void) {
        this.onFlush = onFlush;
    }

    add(data: string): void {
        this.buffer += data;
        if (this.buffer.length >= BATCH_MAX_SIZE) {
            this.flush();
            return;
        }
        if (this.immediateHandle === null) {
            this.immediateHandle = setImmediate(() => this.flush());
        }
        if (this.ceilingTimer === null) {
            this.ceilingTimer = setTimeout(() => this.flush(), BATCH_CEILING_MS);
        }
    }

    flush(): void {
        if (this.immediateHandle !== null) {
            clearImmediate(this.immediateHandle);
            this.immediateHandle = null;
        }
        if (this.ceilingTimer !== null) {
            clearTimeout(this.ceilingTimer);
            this.ceilingTimer = null;
        }
        if (this.buffer.length > 0) {
            const data = this.buffer;
            this.buffer = "";
            this.onFlush(data);
        }
    }

    dispose(): void {
        if (this.immediateHandle !== null) {
            clearImmediate(this.immediateHandle);
            this.immediateHandle = null;
        }
        if (this.ceilingTimer !== null) {
            clearTimeout(this.ceilingTimer);
            this.ceilingTimer = null;
        }
        this.buffer = "";
    }
}

interface PtyHandle {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
}

interface Session {
    pty: PtyHandle;
    scrollback: string[];
    lastSequence: number;
    headless: HeadlessTerminal;
    serializer: SerializeAddon;
    /** Cancels a pending initial-input injection; set only when spawned with initialInput. */
    cancelInitialInput?: () => void;
}

interface ScrollbackSnapshot {
    data: string;
    lastSequence: number;
}

export class PtyManager {
    private sessions = new Map<string, Session>();

    spawn(options: SpawnOptions & { id?: string }): string {
        const id = options.id ?? randomUUID();
        const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;
        const cols = options.cols ?? 80;
        const rows = options.rows ?? 24;

        const scrollback: string[] = [];
        let scrollbackLen = 0;
        let lastSequence = 0;
        let sessionEntry: Session | null = null;

        const headless = new HeadlessTerminal({
            cols,
            rows,
            scrollback: TERMINAL_SCROLLBACK,
            allowProposedApi: true,
        });
        const serializer = new SerializeAddon();
        headless.loadAddon(serializer);

        const initialInput = options.initialInput;
        let injected = initialInput === undefined;
        let quietTimer: ReturnType<typeof setTimeout> | null = null;
        let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
        let submitTimer: ReturnType<typeof setTimeout> | null = null;

        const cancelInjection = () => {
            if (quietTimer) clearTimeout(quietTimer);
            if (maxWaitTimer) clearTimeout(maxWaitTimer);
            if (submitTimer) clearTimeout(submitTimer);
            quietTimer = maxWaitTimer = submitTimer = null;
        };

        const inject = () => {
            if (injected) return;
            injected = true;
            cancelInjection();
            const session = this.sessions.get(id);
            if (!session || initialInput === undefined) return;
            session.pty.write(`\x1b[200~${initialInput}\x1b[201~`);
            submitTimer = setTimeout(() => {
                this.sessions.get(id)?.pty.write("\r");
            }, INITIAL_INPUT_SUBMIT_DELAY_MS);
        };

        const scheduleQuietInject = () => {
            if (injected) return;
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(inject, INITIAL_INPUT_QUIET_MS);
        };

        const batcher = new DataBatcher((batchedData) => {
            scheduleQuietInject();
            lastSequence += 1;
            if (sessionEntry) sessionEntry.lastSequence = lastSequence;
            scrollback.push(batchedData);
            scrollbackLen += batchedData.length;
            while (scrollbackLen > MAX_SCROLLBACK && scrollback.length > 1) {
                const removed = scrollback.shift();
                if (removed) scrollbackLen -= removed.length;
            }
            headless.write(batchedData);
            options.onData(batchedData, lastSequence);
        });

        const env: Record<string, string> = {
            ...cleanEnv,
            PATH: buildShellPath(),
            TERM: "xterm-256color",
            TERM_PROGRAM: "xterm-256color",
            COLORTERM: "truecolor",
            ...(isWindows()
                ? {}
                : {
                      LANG: cleanEnv.LANG || "en_US.UTF-8",
                      LC_ALL: cleanEnv.LC_ALL || "en_US.UTF-8",
                  }),
            ...options.env,
        };

        const cleanup = (exitCode: number) => {
            injected = true;
            cancelInjection();
            batcher.flush();
            batcher.dispose();
            const session = this.sessions.get(id);
            if (session) {
                session.serializer.dispose();
                session.headless.dispose();
            }
            this.sessions.delete(id);
            options.onExit(exitCode);
        };

        let pty: PtyHandle;

        if (isWindows()) {
            const winSession = new WindowsPtySession({
                command: options.command,
                args: options.args,
                cwd: options.cwd,
                env,
                cols,
                rows,
                onData: (data: string) => {
                    batcher.add(data);
                },
                onExit: cleanup,
            });
            pty = winSession;
        } else {
            const decoder = new TextDecoder("utf-8", { fatal: false });
            const proc = Bun.spawn([options.command, ...options.args], {
                cwd: options.cwd,
                env,
                terminal: {
                    rows,
                    cols,
                    data: (_term: Terminal, data: Uint8Array) => {
                        batcher.add(decoder.decode(data, { stream: true }));
                    },
                },
            });

            const terminal = (proc as unknown as { terminal?: Terminal }).terminal ?? null;

            pty = {
                write: (d: string) => terminal?.write(d),
                resize: (c: number, r: number) => terminal?.resize(c, r),
                kill: () => proc.kill(),
            };

            void proc.exited.then(cleanup).catch((err: unknown) => {
                console.error(`[pty] Exit cleanup failed for session ${id}:`, err);
            });
        }

        sessionEntry = {
            pty,
            scrollback,
            lastSequence,
            headless,
            serializer,
            ...(initialInput !== undefined && {
                cancelInitialInput: () => {
                    injected = true;
                    cancelInjection();
                },
            }),
        };

        this.sessions.set(id, sessionEntry);

        if (!injected) {
            maxWaitTimer = setTimeout(inject, INITIAL_INPUT_MAX_WAIT_MS);
        }
        return id;
    }

    write(id: string, data: string): void {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session not found: ${id}`);
        session.pty.write(data);
    }

    resize(id: string, cols: number, rows: number): void {
        const session = this.sessions.get(id);
        if (!session) return;
        session.pty.resize(cols, rows);
        session.headless.resize(cols, rows);
    }

    close(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.cancelInitialInput?.();
            session.serializer.dispose();
            session.headless.dispose();
            session.pty.kill();
            this.sessions.delete(id);
        }
    }

    closeAll(): void {
        for (const [id] of this.sessions) {
            this.close(id);
        }
    }

    getSnapshot(id: string): {
        snapshot: string | null;
        lastSequence: number;
        cursorHidden: boolean;
    } {
        const session = this.sessions.get(id);
        if (!session) return { snapshot: null, lastSequence: 0, cursorHidden: false };
        // Access internal API: SerializeAddon v0.13.0 doesn't serialize DECTCEM
        // (cursor visibility), so we read it from the headless terminal's core.
        const core = (
            session.headless as unknown as { _core: { coreService: { isCursorHidden: boolean } } }
        )._core;
        const cursorHidden = core?.coreService?.isCursorHidden ?? false;
        return {
            snapshot: session.serializer.serialize(),
            lastSequence: session.lastSequence,
            cursorHidden,
        };
    }

    getScrollback(id: string): ScrollbackSnapshot {
        const session = this.sessions.get(id);
        if (!session) return { data: "", lastSequence: 0 };
        return {
            data: session.scrollback.join(""),
            lastSequence: session.lastSequence,
        };
    }

    list(): string[] {
        return Array.from(this.sessions.keys());
    }

    has(id: string): boolean {
        return this.sessions.has(id);
    }
}

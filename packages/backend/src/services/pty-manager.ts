import { randomUUID } from "crypto";
import type { Subprocess, Terminal } from "bun";
import { buildShellPath } from "./shell-path";

interface SpawnOptions {
    command: string;
    args: string[];
    cwd: string;
    onData: (data: string, sequence: number) => void;
    onExit: (exitCode: number) => void;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
}

const MAX_SCROLLBACK = 50_000;
const BATCH_MAX_SIZE = 200 * 1024; // 200KB
const BATCH_MAX_MS = 16; // ~1 frame at 60fps

/**
 * Batches PTY output chunks to reduce WebSocket message frequency.
 * Flushes when either the size threshold or time threshold is reached,
 * ensuring escape sequences stay intact within each batch.
 */
class DataBatcher {
    private buffer = "";
    private timer: ReturnType<typeof setTimeout> | null = null;
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
        if (this.timer === null) {
            this.timer = setTimeout(() => this.flush(), BATCH_MAX_MS);
        }
    }

    flush(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.buffer.length > 0) {
            const data = this.buffer;
            this.buffer = "";
            this.onFlush(data);
        }
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.buffer = "";
    }
}

interface Session {
    proc: Subprocess;
    terminal: Terminal | null;
    scrollback: string[];
    lastSequence: number;
}

interface ScrollbackSnapshot {
    data: string;
    lastSequence: number;
}

type PtySubprocess = Subprocess & { terminal?: Terminal | null };

export class PtyManager {
    private sessions = new Map<string, Session>();

    spawn(options: SpawnOptions & { id?: string }): string {
        const id = options.id ?? randomUUID();
        const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;
        const cols = options.cols ?? 80;
        const rows = options.rows ?? 24;

        const decoder = new TextDecoder("utf-8", { fatal: false });
        const scrollback: string[] = [];
        let scrollbackLen = 0;
        let lastSequence = 0;
        let sessionEntry: Session | null = null;

        const batcher = new DataBatcher((batchedData) => {
            lastSequence += 1;
            if (sessionEntry) sessionEntry.lastSequence = lastSequence;
            scrollback.push(batchedData);
            scrollbackLen += batchedData.length;
            while (scrollbackLen > MAX_SCROLLBACK && scrollback.length > 1) {
                const removed = scrollback.shift();
                if (removed) scrollbackLen -= removed.length;
            }
            options.onData(batchedData, lastSequence);
        });

        const proc = Bun.spawn([options.command, ...options.args], {
            cwd: options.cwd,
            env: {
                ...cleanEnv,
                PATH: buildShellPath(),
                TERM: "xterm-256color",
                TERM_PROGRAM: "xterm-256color",
                COLORTERM: "truecolor",
                LANG: cleanEnv.LANG || "en_US.UTF-8",
                LC_ALL: cleanEnv.LC_ALL || "en_US.UTF-8",
                ...options.env,
            },
            terminal: {
                rows,
                cols,
                data: (term: Terminal, data: Uint8Array) => {
                    if (sessionEntry) sessionEntry.terminal = term;
                    batcher.add(decoder.decode(data, { stream: true }));
                },
            },
        }) as PtySubprocess;

        void proc.exited.then((exitCode) => {
            batcher.flush();
            batcher.dispose();
            this.sessions.delete(id);
            options.onExit(exitCode);
        });

        sessionEntry = {
            proc,
            terminal: proc.terminal ?? null,
            scrollback,
            lastSequence,
        };

        this.sessions.set(id, sessionEntry);
        return id;
    }

    write(id: string, data: string): void {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session not found: ${id}`);
        session.terminal?.write(data);
    }

    resize(id: string, cols: number, rows: number): void {
        const session = this.sessions.get(id);
        if (!session) return;
        session.terminal?.resize(cols, rows);
    }

    close(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.proc.kill();
            this.sessions.delete(id);
        }
    }

    closeAll(): void {
        for (const [id] of this.sessions) {
            this.close(id);
        }
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

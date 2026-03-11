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
        const cols = options.cols ?? 120;
        const rows = options.rows ?? 40;

        const decoder = new TextDecoder();
        const scrollback: string[] = [];
        let scrollbackLen = 0;
        let lastSequence = 0;
        let sessionEntry: Session | null = null;

        const proc = Bun.spawn([options.command, ...options.args], {
            cwd: options.cwd,
            env: {
                ...cleanEnv,
                PATH: buildShellPath(),
                TERM: "xterm-256color",
                ...options.env,
            },
            terminal: {
                rows,
                cols,
                data: (term: Terminal, data: Uint8Array) => {
                    if (sessionEntry) sessionEntry.terminal = term;
                    const text = decoder.decode(data);
                    scrollback.push(text);
                    scrollbackLen += text.length;
                    lastSequence += 1;
                    if (sessionEntry) sessionEntry.lastSequence = lastSequence;
                    // Trim oldest chunks when over the cap
                    while (scrollbackLen > MAX_SCROLLBACK && scrollback.length > 1) {
                        const removed = scrollback.shift();
                        if (removed) scrollbackLen -= removed.length;
                    }
                    options.onData(text, lastSequence);
                },
            },
        }) as PtySubprocess;

        void proc.exited.then((exitCode) => {
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

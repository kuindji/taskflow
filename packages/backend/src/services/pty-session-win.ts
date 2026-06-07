import { join, dirname } from "path";
import { existsSync } from "fs";

interface WindowsPtySessionOptions {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    cols: number;
    rows: number;
    onData: (data: string) => void;
    onExit: (exitCode: number) => void;
}

function resolveNodePath(): string {
    const fromPath = Bun.which("node");
    if (fromPath) return fromPath;
    for (const candidate of [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
    ]) {
        if (existsSync(candidate)) return candidate;
    }
    throw new Error(
        "Node.js is required for terminal sessions on Windows. Install from https://nodejs.org",
    );
}

function resolveBridgeScript(): string {
    const devPath = join(import.meta.dir, "pty-bridge.mjs");
    if (existsSync(devPath)) return devPath;
    const pkgPath = join(dirname(process.execPath), "pty-bridge.mjs");
    if (existsSync(pkgPath)) return pkgPath;
    throw new Error("Could not find pty-bridge.mjs");
}

class WindowsPtySession {
    private proc: ReturnType<typeof Bun.spawn>;
    private stdout: ReadableStream<Uint8Array>;
    private stdinSink: { write(data: Uint8Array): number };
    private encoder = new TextEncoder();
    private alive = true;
    private killTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts: WindowsPtySessionOptions) {
        const nodePath = resolveNodePath();
        const bridgeScript = resolveBridgeScript();

        const cleanEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(opts.env)) {
            if (v !== undefined) cleanEnv[k] = v;
        }

        this.proc = Bun.spawn([nodePath, bridgeScript], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "inherit",
            cwd: opts.cwd,
        });
        this.stdout = this.proc.stdout as ReadableStream<Uint8Array>;
        this.stdinSink = this.proc.stdin as unknown as { write(data: Uint8Array): number };

        this.send({
            type: "spawn",
            file: opts.command,
            args: opts.args,
            cwd: opts.cwd,
            env: cleanEnv,
            cols: opts.cols,
            rows: opts.rows,
        });

        void this.readLoop(opts.onData, opts.onExit);

        void this.proc.exited
            .then((code) => {
                if (this.killTimer !== null) {
                    clearTimeout(this.killTimer);
                    this.killTimer = null;
                }
                if (this.alive) {
                    this.alive = false;
                    opts.onExit(code ?? 1);
                }
            })
            .catch((err: unknown) => {
                console.error("[pty-win] Process exit handling failed:", err);
            });
    }

    private async readLoop(
        onData: (data: string) => void,
        onExit: (exitCode: number) => void,
    ): Promise<void> {
        const decoder = new TextDecoder();
        const reader = this.stdout.getReader();
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIdx: number;
                while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newlineIdx);
                    buffer = buffer.slice(newlineIdx + 1);
                    if (!line) continue;
                    try {
                        const msg = JSON.parse(line) as Record<string, unknown>;
                        if (msg.type === "data" && typeof msg.data === "string") {
                            const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
                            onData(new TextDecoder().decode(bytes));
                        } else if (msg.type === "exit") {
                            if (this.alive) {
                                this.alive = false;
                                onExit(typeof msg.exitCode === "number" ? msg.exitCode : 1);
                            }
                        } else if (msg.type === "error" && typeof msg.message === "string") {
                            console.error("[pty-bridge]", msg.message);
                        }
                    } catch {
                        // malformed JSON line, skip
                    }
                }
            }
        } catch {
            // reader closed
        }
    }

    private send(msg: Record<string, unknown>): void {
        if (!this.alive) return;
        try {
            this.stdinSink.write(this.encoder.encode(JSON.stringify(msg) + "\n"));
        } catch {
            // stdin closed
        }
    }

    write(data: string): void {
        this.send({ type: "write", data });
    }

    resize(cols: number, rows: number): void {
        this.send({ type: "resize", cols, rows });
    }

    kill(): void {
        if (!this.alive) return;
        this.alive = false;
        this.send({ type: "kill" });
        this.killTimer = setTimeout(() => {
            this.killTimer = null;
            try {
                this.proc.kill();
            } catch {
                /* already dead */
            }
        }, 500);
    }
}

export { WindowsPtySession, resolveNodePath };
export type { WindowsPtySessionOptions };

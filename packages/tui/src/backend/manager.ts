import { spawn, type ChildProcess } from "child_process";
import { readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

interface StartBackendOptions {
    binary: string;
    args: string[];
    devBranch: string | null;
    timeoutMs?: number;
}

interface BackendHandle {
    port: number;
    stop(): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

async function readPort(portFile: string): Promise<number | null> {
    try {
        const raw = await readFile(portFile, "utf-8");
        const port = Number.parseInt(raw.trim(), 10);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
        return null;
    }
}

async function startBackend(opts: StartBackendOptions): Promise<BackendHandle> {
    const portFile = join(tmpdir(), `taskflow-tui-port-${process.pid}-${Date.now()}`);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Agents the backend spawns refuse to launch when they see these, so they are
    // stripped here exactly as electron/src/backend-manager.ts does.
    const { CLAUDECODE: _cc, CLAUDE_CODE_ENTRYPOINT: _cce, ...safeEnv } = process.env;

    const child: ChildProcess = spawn(opts.binary, opts.args, {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
            ...safeEnv,
            TASKFLOW_PORT_FILE: portFile,
            ...(opts.devBranch === null ? {} : { TASKFLOW_DEV_BRANCH: opts.devBranch }),
        },
    });

    // Held in an object: TypeScript narrows a plain `let` to `never` here,
    // because it cannot see the assignment that happens inside the callback.
    const outcome: { exitCode: number | null; spawnError: Error | null } = {
        exitCode: null,
        spawnError: null,
    };
    child.once("exit", (code: number | null) => {
        outcome.exitCode = code ?? 0;
    });
    // Without this listener Node throws on ENOENT instead of rejecting.
    child.once("error", (err: Error) => {
        outcome.spawnError = err;
    });

    const stop = (): void => {
        child.kill();
        void rm(portFile, { force: true });
    };

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const port = await readPort(portFile);
        if (port !== null) return { port, stop };
        if (outcome.spawnError !== null) {
            await rm(portFile, { force: true });
            throw new Error(`Backend failed to start: ${outcome.spawnError.message}`);
        }
        if (outcome.exitCode !== null) {
            await rm(portFile, { force: true });
            throw new Error(`Backend exited before startup (code ${String(outcome.exitCode)})`);
        }
        if (Date.now() > deadline) {
            stop();
            throw new Error(`Backend startup timeout after ${String(timeoutMs)}ms`);
        }
        await Bun.sleep(POLL_INTERVAL_MS);
    }
}

export { startBackend };
export type { BackendHandle };

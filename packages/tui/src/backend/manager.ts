import { spawn, type ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import { rmSync } from "fs";
import { randomUUID } from "crypto";
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
const STDERR_TAIL_BYTES = 8192;

// The backend writes the port with a single small `writeFile`, so a reader either
// sees nothing or sees the whole number. Anything that is not a bare port number is
// treated as "not written yet" rather than parsed leniently.
async function readPort(portFile: string): Promise<number | null> {
    try {
        const raw = (await readFile(portFile, "utf-8")).trim();
        if (!/^\d+$/.test(raw)) return null;
        const port = Number.parseInt(raw, 10);
        return port > 0 && port <= 65535 ? port : null;
    } catch {
        return null;
    }
}

async function startBackend(opts: StartBackendOptions): Promise<BackendHandle> {
    const portFile = join(tmpdir(), `taskflow-tui-port-${process.pid}-${randomUUID()}`);
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
    const outcome: {
        exit: { code: number | null; signal: NodeJS.Signals | null } | null;
        spawnError: Error | null;
        stderr: string;
    } = {
        exit: null,
        spawnError: null,
        stderr: "",
    };
    // The stderr pipe must be drained or the child blocks once it fills, which
    // wedges the backend permanently. Only the tail is kept, for error messages.
    child.stderr?.on("data", (chunk: Buffer) => {
        outcome.stderr = (outcome.stderr + chunk.toString("utf-8")).slice(-STDERR_TAIL_BYTES);
    });
    // A child killed by a signal reports a null code, so the exit is recorded as an
    // object: `code` alone cannot distinguish "exited with 0" from "not exited yet".
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        outcome.exit = { code, signal };
    });
    // Without this listener Node throws on ENOENT instead of rejecting.
    child.once("error", (err: Error) => {
        outcome.spawnError = err;
    });

    // Removal is synchronous so that a caller which exits right after `stop()`
    // still leaves no port file behind.
    const stop = (): void => {
        child.kill();
        rmSync(portFile, { force: true });
    };

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        // Failure is checked before the port file: a child that wrote a port and then
        // died has not started up, and its handle would point at a dead backend.
        if (outcome.spawnError !== null) {
            rmSync(portFile, { force: true });
            throw new Error(`Backend failed to start: ${outcome.spawnError.message}`);
        }
        if (outcome.exit !== null) {
            rmSync(portFile, { force: true });
            const { code, signal } = outcome.exit;
            const how = signal === null ? `code ${String(code ?? 0)}` : `signal ${signal}`;
            const tail = outcome.stderr.trim();
            throw new Error(
                `Backend exited before startup (${how})` + (tail === "" ? "" : `: ${tail}`),
            );
        }
        const port = await readPort(portFile);
        if (port !== null) return { port, stop };
        // The wait is clamped to what is left of the budget, so the last poll lands on
        // the deadline instead of up to one whole interval past it.
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            stop();
            throw new Error(`Backend startup timeout after ${String(timeoutMs)}ms`);
        }
        await Bun.sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }
}

export { startBackend };
export type { BackendHandle };

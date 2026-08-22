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
const KILL_GRACE_MS = 1000;

// Cleanup runs on paths that are already reporting a failure, so it must never throw:
// a child that left a directory at the port-file path would make a plain `rmSync` fail
// with EISDIR and replace the backend's own error message with a filesystem one.
function removePortFile(portFile: string): void {
    try {
        rmSync(portFile, { force: true, recursive: true });
    } catch {
        // Nothing useful to do here — the caller is already reporting the real error.
    }
}

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

    // Agents the backend spawns refuse to launch when they see the two Claude Code
    // markers, so they are stripped here exactly as electron/src/backend-manager.ts
    // does. Both dev-instance selectors are stripped too so that `devBranch` is the
    // only thing deciding the child's instance: TASKFLOW_DEV_BRANCH names one
    // directly, and TASKFLOW_DEV makes the backend derive one from the current git
    // branch (packages/backend/src/config.ts:44-61). Inheriting either would put the
    // backend on a dev instance the caller explicitly asked not to use.
    const {
        CLAUDECODE: _cc,
        CLAUDE_CODE_ENTRYPOINT: _cce,
        TASKFLOW_DEV_BRANCH: _devBranch,
        TASKFLOW_DEV: _dev,
        ...safeEnv
    } = process.env;

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
    // still leaves no port file behind. `stop()` stays synchronous and sends only
    // SIGTERM for the same reason: its callers run `process.exit(0)` on the next
    // line, so any escalation timer this scheduled would never fire.
    const stop = (): void => {
        child.kill();
        removePortFile(portFile);
    };

    // The startup paths can wait, so they escalate: SIGTERM gives the backend its
    // shutdown handler, and a child that ignores it or has wedged is SIGKILLed
    // rather than left alive holding the port a retry needs.
    const terminate = async (): Promise<void> => {
        if (outcome.exit !== null) return;
        child.kill("SIGTERM");
        const graceUntil = Date.now() + KILL_GRACE_MS;
        while (outcome.exit === null) {
            const left = graceUntil - Date.now();
            if (left <= 0) break;
            await Bun.sleep(Math.min(POLL_INTERVAL_MS, left));
        }
        if (outcome.exit === null) child.kill("SIGKILL");
    };

    const stderrSuffix = (): string => {
        const tail = outcome.stderr.trim();
        return tail === "" ? "" : `: ${tail}`;
    };

    // Null while the child is still a candidate; an Error once it has failed for a
    // reason of its own. Built on demand so that the message reflects the state at
    // the moment it is thrown.
    const failure = (): Error | null => {
        if (outcome.spawnError !== null) {
            return new Error(`Backend failed to start: ${outcome.spawnError.message}`);
        }
        if (outcome.exit !== null) {
            const { code, signal } = outcome.exit;
            const how = signal === null ? `code ${String(code ?? 0)}` : `signal ${signal}`;
            return new Error(`Backend exited before startup (${how})` + stderrSuffix());
        }
        return null;
    };

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        // Failure is checked before the port file: a child that wrote a port and then
        // died has not started up, and its handle would point at a dead backend.
        const failedEarly = failure();
        if (failedEarly !== null) {
            removePortFile(portFile);
            throw failedEarly;
        }
        const port = await readPort(portFile);
        // The read is an await, so the child can fail during it. That failure is the
        // real reason startup did not happen, and it is checked before both the port
        // and the deadline so it is never reported as a timeout.
        const failedDuringRead = failure();
        if (failedDuringRead !== null) {
            removePortFile(portFile);
            throw failedDuringRead;
        }
        if (port !== null) return { port, stop };
        // The wait is clamped to what is left of the budget, so the last poll lands on
        // the deadline instead of up to one whole interval past it.
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            await terminate();
            removePortFile(portFile);
            throw new Error(
                `Backend startup timeout after ${String(timeoutMs)}ms` + stderrSuffix(),
            );
        }
        await Bun.sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }
}

export { startBackend };
export type { BackendHandle };

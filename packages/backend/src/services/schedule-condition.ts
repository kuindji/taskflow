import { spawn } from "child_process";
import { getDefaultShell, isWindows } from "./platform";

const CONDITION_TIMEOUT_MS = 30_000;

function normalizeConditionScript(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new Error("conditionScript must be a string or null");
    return value.trim() ? value : undefined;
}

/** Run without a PTY or agent. Only the exit status decides whether to launch. */
function runScheduleCondition(
    script: string,
    options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        signal: AbortSignal;
        shell?: string;
        timeoutMs?: number;
    },
): Promise<boolean> {
    options.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(script, {
            cwd: options.cwd,
            env: options.env,
            shell: options.shell ?? getDefaultShell(),
            detached: !isWindows(),
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            // Drain all output, retaining only a bounded diagnostic.
            stderr = (stderr + chunk.toString()).slice(-4096);
        });
        const stop = () => {
            if (!child.pid) return;
            if (isWindows()) {
                const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                    windowsHide: true,
                    stdio: "ignore",
                });
                killer.on("error", () => child.kill("SIGKILL"));
            } else {
                try {
                    // The detached shell owns this group, including a running check command.
                    process.kill(-child.pid, "SIGKILL");
                } catch {
                    child.kill("SIGKILL");
                }
            }
        };
        const finish = (error?: Error, shouldRun = false) => {
            clearTimeout(timer);
            options.signal.removeEventListener("abort", abort);
            child.stderr?.destroy();
            if (error) reject(error);
            else resolve(shouldRun);
        };
        const abort = () => {
            stop();
            finish(new Error("Condition script cancelled"));
        };
        const timeoutMs = options.timeoutMs ?? CONDITION_TIMEOUT_MS;
        const timer = setTimeout(() => {
            stop();
            finish(new Error(`Condition script timed out after ${timeoutMs / 1000} seconds`));
        }, timeoutMs);
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
        child.on("error", (error) => finish(error));
        child.on("exit", (code, signal) => {
            if (code === 0 || code === 1) finish(undefined, code === 0);
            else {
                const detail = stderr.trim();
                finish(
                    new Error(
                        `Condition script exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `: ${detail}` : ""}`,
                    ),
                );
            }
        });
    });
}

export { CONDITION_TIMEOUT_MS, normalizeConditionScript, runScheduleCondition };

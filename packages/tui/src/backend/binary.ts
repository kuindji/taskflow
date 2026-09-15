import { existsSync } from "fs";
import { dirname, join } from "path";

/**
 * The backend the TUI spawns for This machine. `TASKFLOW_BACKEND_BIN` wins.
 * Next is a backend installed beside the TUI binary, where `bun run linux-setup`
 * puts it, so the pair always comes from the same checkout. Last is whatever
 * `taskflow-backend` is on PATH.
 */
function resolveBackendBinary(
    env: Readonly<Record<string, string | undefined>>,
    execPath: string,
    platform: NodeJS.Platform,
    exists: (path: string) => boolean = existsSync,
): string {
    const override = env.TASKFLOW_BACKEND_BIN;
    if (override !== undefined && override !== "") return override;
    const name = platform === "win32" ? "taskflow-backend.exe" : "taskflow-backend";
    const sibling = join(dirname(execPath), name);
    return exists(sibling) ? sibling : name;
}

export { resolveBackendBinary };

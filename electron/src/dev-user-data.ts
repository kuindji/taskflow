import { isAbsolute, join } from "path";

/**
 * Electron `userData` for dev runs. Follows `TASKFLOW_CONFIG_DIR` the way the
 * backend does (`resolveConfigBaseDir`), so a sandboxed run keeps its Electron
 * profile next to its backend data instead of sharing the per-branch one.
 */
export function devUserDataPath(
    env: Readonly<Record<string, string | undefined>>,
    home: string,
    branch: string,
): string {
    const override = env.TASKFLOW_CONFIG_DIR;
    if (override !== undefined && override.trim() !== "") {
        if (!isAbsolute(override)) {
            throw new Error("TASKFLOW_CONFIG_DIR must be an absolute path");
        }
        return join(override, "electron-user-data");
    }
    return join(home, ".config", `taskflow-dev-${branch}`);
}

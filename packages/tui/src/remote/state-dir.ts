import { isAbsolute, join } from "path";

/**
 * Resolves where the TUI keeps its own state (last-selected machine,
 * per-machine project/task selections, saved backend records): an explicit
 * override, else the XDG config root, else the platform default. Mirrors
 * `resolveDevLaunchConfig`'s override handling in `dev.ts`.
 */
function resolveStateDir(env: NodeJS.ProcessEnv, homeDir: string): string {
    const override = env.TASKFLOW_TUI_STATE_DIR;
    if (override !== undefined && override.trim() !== "") {
        if (!isAbsolute(override)) {
            throw new Error("TASKFLOW_TUI_STATE_DIR must be an absolute path");
        }
        return override;
    }

    const xdgConfigHome = env.XDG_CONFIG_HOME;
    if (xdgConfigHome !== undefined && xdgConfigHome.trim() !== "") {
        return join(xdgConfigHome, "taskflow", "tui");
    }

    return join(homeDir, ".config", "taskflow", "tui");
}

export { resolveStateDir };

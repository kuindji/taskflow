import { homedir } from "os";
import { delimiter, join, posix, win32 } from "path";

interface ConfigBaseDirInputs {
    platform: NodeJS.Platform;
    env: Readonly<Record<string, string | undefined>>;
    homeDir: string;
}

export function resolveConfigBaseDir(inputs: ConfigBaseDirInputs): string {
    const path = inputs.platform === "win32" ? win32 : posix;
    const override = inputs.env.TASKFLOW_CONFIG_DIR;
    if (override !== undefined && override.trim() !== "") {
        if (!path.isAbsolute(override)) {
            throw new Error("TASKFLOW_CONFIG_DIR must be an absolute path");
        }
        return override;
    }

    if (inputs.platform === "win32") {
        const appData = inputs.env.APPDATA || path.join(inputs.homeDir, "AppData", "Roaming");
        return path.join(appData, "taskflow");
    }
    return path.join(inputs.homeDir, ".config", "taskflow");
}

export function isWindows(): boolean {
    return process.platform === "win32";
}

export function getHomeDir(): string {
    return homedir();
}

export function getConfigBaseDir(): string {
    return resolveConfigBaseDir({
        platform: process.platform,
        env: process.env,
        homeDir: homedir(),
    });
}

export function getPathDelimiter(): string {
    return delimiter;
}

export function getNullDevice(): string {
    return isWindows() ? "NUL" : "/dev/null";
}

export function getDefaultShell(): string {
    if (isWindows()) {
        return process.env.COMSPEC || "cmd.exe";
    }
    return process.env.SHELL || "/bin/bash";
}

export function getDefaultShellEnvVar(): string | undefined {
    return isWindows() ? process.env.COMSPEC : process.env.SHELL;
}

export function getEnsurePaths(): string[] {
    const home = homedir();
    if (isWindows()) {
        return [
            join(home, ".local", "bin"),
            join(home, ".bun", "bin"),
            join(home, ".cargo", "bin"),
            join(home, ".kimi-code", "bin"),
            join(home, "AppData", "Roaming", "npm"),
            "C:\\Program Files\\nodejs",
        ];
    }
    return [
        join(home, ".local", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".cargo", "bin"),
        join(home, ".kimi-code", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
    ];
}

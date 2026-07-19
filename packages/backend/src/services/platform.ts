import { homedir } from "os";
import { join, delimiter } from "path";

export function isWindows(): boolean {
    return process.platform === "win32";
}

export function getHomeDir(): string {
    return homedir();
}

export function getConfigBaseDir(): string {
    if (isWindows()) {
        const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
        return join(appData, "taskflow");
    }
    return join(homedir(), ".config", "taskflow");
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

import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { basename } from "path";
import type { ShellInfo } from "@taskflow/shared";
import { isWindows, getDefaultShellEnvVar } from "./platform";

const UNIX_SHELLS = new Set(["bash", "zsh"]);
const WINDOWS_SHELLS = new Set(["powershell", "pwsh", "cmd"]);

function knownShells(): Set<string> {
    return isWindows() ? WINDOWS_SHELLS : UNIX_SHELLS;
}

async function isExecutable(path: string): Promise<boolean> {
    try {
        if (isWindows()) {
            await access(path, constants.F_OK);
        } else {
            await access(path, constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

function isSupportedShell(path: string): boolean {
    const name = basename(path).replace(/\.exe$/i, "");
    return knownShells().has(name);
}

export function resolveSystemShellPath(
    shells: ShellInfo[],
    envShell = getDefaultShellEnvVar() ?? null,
): string | null {
    const normalizedEnvShell = envShell?.trim();
    if (normalizedEnvShell && isSupportedShell(normalizedEnvShell)) {
        const exact = shells.find((shell) => shell.path === normalizedEnvShell);
        if (exact) return exact.path;

        const envShellName = basename(normalizedEnvShell).replace(/\.exe$/i, "");
        const byName = shells.find((shell) => shell.name === envShellName);
        if (byName) return byName.path;
    }

    return shells[0]?.path ?? null;
}

function prioritizeSystemShell(
    shells: ShellInfo[],
    envShell = getDefaultShellEnvVar() ?? null,
): ShellInfo[] {
    const systemShellPath = resolveSystemShellPath(shells, envShell);
    if (!systemShellPath) return shells;

    const index = shells.findIndex((shell) => shell.path === systemShellPath);
    if (index <= 0) return shells;

    return [shells[index], ...shells.slice(0, index), ...shells.slice(index + 1)];
}

async function detectUnixShells(): Promise<ShellInfo[]> {
    let content: string;
    try {
        content = await readFile("/etc/shells", "utf-8");
    } catch {
        return [];
    }

    const seen = new Set<string>();
    const shells: ShellInfo[] = [];

    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const name = basename(trimmed);
        if (!knownShells().has(name)) continue;
        if (seen.has(name)) continue;

        if (await isExecutable(trimmed)) {
            seen.add(name);
            shells.push({ name, path: trimmed });
        }
    }

    return prioritizeSystemShell(shells);
}

async function detectWindowsShells(): Promise<ShellInfo[]> {
    const shells: ShellInfo[] = [];

    const pwshPath = Bun.which("pwsh");
    if (pwshPath) shells.push({ name: "pwsh", path: pwshPath });

    const powershellPath = Bun.which("powershell");
    if (powershellPath) shells.push({ name: "powershell", path: powershellPath });

    const comspec = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    if (await isExecutable(comspec)) shells.push({ name: "cmd", path: comspec });

    const bashPath = Bun.which("bash");
    if (bashPath) shells.push({ name: "bash", path: bashPath });

    return prioritizeSystemShell(shells);
}

export async function detectShells(): Promise<ShellInfo[]> {
    return isWindows() ? detectWindowsShells() : detectUnixShells();
}

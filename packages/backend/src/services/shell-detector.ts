import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { basename } from "path";
import type { ShellInfo } from "@taskflow/shared";

const KNOWN_INTERACTIVE_SHELLS = new Set(["bash", "zsh"]);

async function isExecutable(path: string): Promise<boolean> {
    try {
        await access(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isSupportedShell(path: string): boolean {
    return KNOWN_INTERACTIVE_SHELLS.has(basename(path));
}

export function resolveSystemShellPath(
    shells: ShellInfo[],
    envShell = process.env.SHELL ?? null,
): string | null {
    const normalizedEnvShell = envShell?.trim();
    if (normalizedEnvShell && isSupportedShell(normalizedEnvShell)) {
        const exact = shells.find((shell) => shell.path === normalizedEnvShell);
        if (exact) return exact.path;

        const envShellName = basename(normalizedEnvShell);
        const byName = shells.find((shell) => shell.name === envShellName);
        if (byName) return byName.path;
    }

    return shells[0]?.path ?? null;
}

function prioritizeSystemShell(shells: ShellInfo[], envShell = process.env.SHELL ?? null): ShellInfo[] {
    const systemShellPath = resolveSystemShellPath(shells, envShell);
    if (!systemShellPath) return shells;

    const index = shells.findIndex((shell) => shell.path === systemShellPath);
    if (index <= 0) return shells;

    return [shells[index], ...shells.slice(0, index), ...shells.slice(index + 1)];
}

export async function detectShells(): Promise<ShellInfo[]> {
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
        if (!KNOWN_INTERACTIVE_SHELLS.has(name)) continue;
        if (seen.has(name)) continue;

        if (await isExecutable(trimmed)) {
            seen.add(name);
            shells.push({ name, path: trimmed });
        }
    }

    return prioritizeSystemShell(shells);
}

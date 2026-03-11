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

    return shells;
}

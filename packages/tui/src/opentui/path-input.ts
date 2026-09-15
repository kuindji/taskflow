import type { Dirent } from "fs";
import { readdir } from "fs/promises";
import { homedir } from "os";

interface PathCompletion {
    value: string;
    candidates: string[];
}

interface PathCompletionDeps {
    home: string;
    readdir: (dir: string) => Promise<Pick<Dirent, "name" | "isDirectory">[]>;
}

function localDeps(): PathCompletionDeps {
    return { home: homedir(), readdir: (dir) => readdir(dir, { withFileTypes: true }) };
}

function commonPrefix(names: readonly string[]): string {
    let prefix = names[0] ?? "";
    for (const name of names) {
        while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
}

/**
 * Completes the last segment of a directory path from this machine's
 * filesystem. A leading `~` is expanded for reading but kept in the value.
 * Files are never offered, and dot-directories only when the typed segment
 * starts with a dot. A unique match gets a trailing `/`; several matches
 * complete to their longest common prefix.
 */
async function completePath(input: string, deps?: PathCompletionDeps): Promise<PathCompletion> {
    if (input === "~") return { value: "~/", candidates: [] };
    const { home, readdir: list } = deps ?? localDeps();
    const slash = input.lastIndexOf("/");
    const prefix = input.slice(0, slash + 1);
    const segment = input.slice(slash + 1);
    const dir = prefix.startsWith("~/") ? `${home}${prefix.slice(1)}` : prefix || ".";
    let entries: Pick<Dirent, "name" | "isDirectory">[];
    try {
        entries = await list(dir);
    } catch {
        return { value: input, candidates: [] };
    }
    const showDotted = segment.startsWith(".");
    const candidates = entries
        .filter(
            (entry) =>
                entry.isDirectory() &&
                entry.name.startsWith(segment) &&
                (showDotted || !entry.name.startsWith(".")),
        )
        .map((entry) => entry.name)
        .sort();
    if (candidates.length === 0) return { value: input, candidates };
    if (candidates.length === 1) return { value: `${prefix}${candidates[0]}/`, candidates };
    return { value: `${prefix}${commonPrefix(candidates)}`, candidates };
}

export { completePath };
export type { PathCompletion };

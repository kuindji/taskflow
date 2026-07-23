import { readFile, stat } from "fs/promises";
import { homedir, platform } from "os";
import { join, sep } from "path";
import type { ObsidianState, ObsidianVaultState } from "@taskflow/shared";

function isWithin(candidate: string, root: string): boolean {
    return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/** Longest registered-vault prefix containing `path`, or null. */
function matchVault(path: string, vaultPaths: string[]): string | null {
    let best: string | null = null;
    for (const vault of vaultPaths) {
        if (!isWithin(path, vault)) continue;
        if (best === null || vault.length > best.length) best = vault;
    }
    return best;
}

interface ClassifyArgs {
    path: string;
    vaultPaths: string[];
    hasObsidianDir: boolean;
}

function classifyPath({ path, vaultPaths, hasObsidianDir }: ClassifyArgs): ObsidianVaultState {
    if (matchVault(path, vaultPaths) !== null) return "registered";
    return hasObsidianDir ? "unregistered-vault" : "plain-folder";
}

/**
 * Read vault paths out of Obsidian's `obsidian.json`. The format is private and
 * undocumented, so any surprise degrades to "no vaults known" rather than
 * throwing — the caller then disables the menu entries.
 */
function parseVaultRegistry(json: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const vaults = (parsed as Record<string, unknown>).vaults;
    if (typeof vaults !== "object" || vaults === null || Array.isArray(vaults)) return [];

    const out: string[] = [];
    for (const entry of Object.values(vaults as Record<string, unknown>)) {
        if (typeof entry !== "object" || entry === null) continue;
        const path = (entry as Record<string, unknown>).path;
        if (typeof path === "string" && path !== "") out.push(path);
    }
    return out;
}

function appPath(): string {
    switch (platform()) {
        case "darwin":
            return "/Applications/Obsidian.app";
        case "win32":
            return join(process.env.LOCALAPPDATA ?? "", "Obsidian", "Obsidian.exe");
        default:
            return join(homedir(), ".local", "share", "applications", "obsidian.desktop");
    }
}

function registryPath(): string {
    switch (platform()) {
        case "darwin":
            return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
        case "win32":
            return join(process.env.APPDATA ?? "", "obsidian", "obsidian.json");
        default:
            return join(homedir(), ".config", "obsidian", "obsidian.json");
    }
}

async function exists(path: string): Promise<boolean> {
    return stat(path).then(
        () => true,
        () => false,
    );
}

/**
 * Current Obsidian state for a wiki root. The registry is read fresh on every
 * query because it changes whenever the user adds a vault.
 */
async function detectObsidian(wikiRoot: string | null): Promise<ObsidianState> {
    const installed = await exists(appPath());
    if (!installed || wikiRoot === null) return { installed, vault: null };

    const json = await readFile(registryPath(), "utf-8").catch(() => "");
    const vaultPaths = json === "" ? [] : parseVaultRegistry(json);
    const hasObsidianDir = await exists(join(wikiRoot, ".obsidian"));

    return { installed, vault: classifyPath({ path: wikiRoot, vaultPaths, hasObsidianDir }) };
}

export { classifyPath, detectObsidian, matchVault, parseVaultRegistry };

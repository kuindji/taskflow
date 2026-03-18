import { spawnSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { config } from "../config";

function resolveNvmNodeBin(home: string): string | null {
    const nvmDir = join(home, ".nvm");
    try {
        const alias = readFileSync(join(nvmDir, "alias", "default"), "utf8").trim();
        const versionsDir = join(nvmDir, "versions", "node");
        const installed = readdirSync(versionsDir);
        // Find best match: alias can be a full version like "22.14.0" or a major like "22"
        const matching = installed
            .filter((v) => {
                const stripped = v.startsWith("v") ? v.slice(1) : v;
                return stripped === alias || stripped.startsWith(`${alias}.`);
            })
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        if (matching.length === 0) return null;
        const binDir = join(versionsDir, matching[0], "bin");
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

function resolveVoltaBin(home: string): string | null {
    const binDir = join(home, ".volta", "bin");
    try {
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

function resolveFnmNodeBin(home: string): string | null {
    const binDir = join(home, ".fnm", "aliases", "default", "bin");
    try {
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

/**
 * Resolve the user's login shell PATH by spawning their shell in login mode.
 * This captures everything set in .zshrc, .bash_profile, etc.
 * Falls back to process.env.PATH on failure.
 */
function resolveLoginShellPath(): string {
    const shell = process.env.SHELL || "/bin/zsh";
    try {
        const result = spawnSync(shell, ["-l", "-c", "echo $PATH"], {
            encoding: "utf8",
            timeout: 5000,
            env: {
                ...process.env,
                // Prevent shell from trying to update the terminal title etc.
                TERM: "dumb",
            },
        });
        const output = result.stdout?.trim();
        if (output && !result.error && result.status === 0) {
            return output;
        }
    } catch {
        // Fall through to process.env.PATH
    }
    return process.env.PATH ?? "";
}

let cachedPath: string | null = null;

export function buildShellPath(): string {
    if (cachedPath) return cachedPath;

    const home = process.env.HOME ?? "";

    // Start with the user's full login shell PATH (not the minimal Electron PATH)
    const loginPath = resolveLoginShellPath();

    // Paths to prepend — these take highest priority
    const prependPaths = [config.binDir];

    // Paths to ensure are present (appended if missing from login PATH)
    const ensurePaths = [
        `${home}/.local/bin`,
        `${home}/.bun/bin`,
        `${home}/.cargo/bin`,
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
    ];

    // Detect node version managers so that tools with #!/usr/bin/env node work
    const nodeResolvers = [resolveNvmNodeBin, resolveVoltaBin, resolveFnmNodeBin];
    for (const resolve of nodeResolvers) {
        const binDir = resolve(home);
        if (binDir) {
            ensurePaths.push(binDir);
            break;
        }
    }

    const loginParts = loginPath.split(":");
    const seen = new Set(loginParts);

    // Append any ensurePaths not already in the login PATH
    for (const p of ensurePaths) {
        if (!seen.has(p)) {
            loginParts.push(p);
            seen.add(p);
        }
    }

    // Prepend high-priority paths (config.binDir for taskflow-cli)
    const finalParts: string[] = [];
    for (const p of prependPaths) {
        if (!seen.has(p)) {
            finalParts.push(p);
            seen.add(p);
        }
    }
    finalParts.push(...loginParts);

    cachedPath = finalParts.join(":");
    return cachedPath;
}

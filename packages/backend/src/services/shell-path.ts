import { spawnSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { delimiter, join } from "path";
import { config } from "../config";
import { isWindows, getHomeDir, getDefaultShell, getEnsurePaths } from "./platform";

export function resolveNvmNodeBin(home: string): string | null {
    const nvmDir = join(home, ".nvm");
    try {
        // `nvm alias default v22.14.0` stores the version with its "v" prefix.
        const alias = readFileSync(join(nvmDir, "alias", "default"), "utf8")
            .trim()
            .replace(/^v/, "");
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
    const binDir = isWindows()
        ? join(home, ".fnm", "aliases", "default")
        : join(home, ".fnm", "aliases", "default", "bin");
    try {
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

const PATH_MARKER = "__TASKFLOW_PATH__";
const PATH_PATTERN = new RegExp(`${PATH_MARKER}(.*?)${PATH_MARKER}`, "s");

/**
 * PATH as `shell` reports it with `flags`. The value is framed by markers
 * because interactive startup files may print to stdout. Null on failure.
 */
function readShellPath(shell: string, flags: string[]): string | null {
    try {
        const result = spawnSync(
            shell,
            [...flags, `printf '%s%s%s' ${PATH_MARKER} "$PATH" ${PATH_MARKER}`],
            {
                encoding: "utf8",
                timeout: 5000,
                // No stdin, so an interactive startup prompt reads EOF instead of hanging.
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...process.env,
                    // Prevent shell from trying to update the terminal title etc.
                    TERM: "dumb",
                },
            },
        );
        if (result.error) return null;
        const path = result.stdout?.match(PATH_PATTERN)?.[1]?.trim();
        return path ? path : null;
    } catch {
        return null;
    }
}

/**
 * Resolve the user's shell PATH by spawning their shell as an interactive
 * login shell, which reads both the login files (.zprofile, .bash_profile)
 * and the interactive ones (.zshrc, .bashrc) where installers add PATH
 * entries. Falls back to a login-only shell, then to process.env.PATH.
 */
export function resolveLoginShellPath(): string {
    if (isWindows()) {
        return process.env.PATH ?? "";
    }
    const shell = getDefaultShell();
    return (
        readShellPath(shell, ["-i", "-l", "-c"]) ??
        readShellPath(shell, ["-l", "-c"]) ??
        process.env.PATH ??
        ""
    );
}

let cachedPath: string | null = null;

export function buildShellPath(): string {
    if (cachedPath) return cachedPath;

    const home = getHomeDir();

    // Start with the user's full login shell PATH (not the minimal Electron PATH)
    const loginPath = resolveLoginShellPath();

    // Paths to prepend — these take highest priority
    const prependPaths = [config.binDir];

    // Paths to ensure are present (appended if missing from login PATH)
    const ensurePaths = getEnsurePaths();

    // Detect node version managers so that tools with #!/usr/bin/env node work
    const nodeResolvers = [resolveNvmNodeBin, resolveVoltaBin, resolveFnmNodeBin];
    for (const resolve of nodeResolvers) {
        const binDir = resolve(home);
        if (binDir) {
            ensurePaths.push(binDir);
            break;
        }
    }

    const loginParts = loginPath.split(delimiter);
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

    cachedPath = finalParts.join(delimiter);
    return cachedPath;
}

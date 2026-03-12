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

export function buildShellPath(): string {
    const home = process.env.HOME ?? "";
    const extraPaths = [
        config.binDir,
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
            extraPaths.push(binDir);
            break;
        }
    }

    const currentPath = process.env.PATH ?? "";
    const parts = currentPath.split(":");
    const seen = new Set(parts);
    for (const p of extraPaths) {
        if (!seen.has(p)) {
            parts.push(p);
            seen.add(p);
        }
    }
    return parts.join(":");
}

import { join, dirname, resolve } from "path";
import { accessSync, constants, readdirSync } from "fs";
import { createRequire } from "module";
import { isWindows } from "./platform";

const rgBinary = isWindows() ? "rg.exe" : "rg";

/**
 * Check whether a candidate binary path exists (is readable).
 */
function canAccess(p: string): boolean {
    try {
        accessSync(p, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the ripgrep binary inside bun's hoisted .bun directory.
 * Bun hoists packages into node_modules/.bun/<pkg>@<version>/node_modules/…
 */
function findInBunHoisted(nodeModulesDir: string): string | null {
    const bunDir = join(nodeModulesDir, ".bun");
    try {
        for (const entry of readdirSync(bunDir)) {
            if (entry.startsWith("@vscode+ripgrep@")) {
                const candidate = join(
                    bunDir,
                    entry,
                    "node_modules",
                    "@vscode",
                    "ripgrep",
                    "bin",
                    rgBinary,
                );
                if (canAccess(candidate)) return candidate;
            }
        }
    } catch {
        // directory doesn't exist
    }
    return null;
}

/**
 * Resolve the ripgrep binary path.
 *
 * Resolution order:
 *  1. TASKFLOW_RG_PATH environment variable (set by Electron for packaged builds)
 *  2. createRequire().resolve (works when running from source via bun)
 *  3. Known monorepo locations relative to this file and project root
 *  4. System "rg" in PATH
 */
function resolveRgPath(): string {
    // 1. Explicit env override (used by packaged Electron app)
    if (process.env.TASKFLOW_RG_PATH && canAccess(process.env.TASKFLOW_RG_PATH)) {
        return process.env.TASKFLOW_RG_PATH;
    }

    // 2. createRequire — works when running from source, bun strips it from bundles
    try {
        const require = createRequire(import.meta.url);
        const modPath = require.resolve("@vscode/ripgrep");
        const bundledPath = join(dirname(modPath), "..", "bin", rgBinary);
        if (canAccess(bundledPath)) return bundledPath;
    } catch {
        // not available in bundled/compiled mode
    }

    // 3. Probe known monorepo locations
    //    Walk up from this file (or dist/) to find the project root.
    const startDir = typeof __dirname !== "undefined" ? __dirname : dirname(import.meta.url.replace("file:///", ""));
    let dir = resolve(startDir);
    for (let i = 0; i < 8; i++) {
        // Standard node_modules location
        const standard = join(dir, "node_modules", "@vscode", "ripgrep", "bin", rgBinary);
        if (canAccess(standard)) return standard;

        // packages/backend/node_modules (monorepo workspace)
        const workspace = join(dir, "packages", "backend", "node_modules", "@vscode", "ripgrep", "bin", rgBinary);
        if (canAccess(workspace)) return workspace;

        // Bun hoisted location
        const hoisted = findInBunHoisted(join(dir, "node_modules"));
        if (hoisted) return hoisted;

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // 4. Fall back to system rg
    return "rg";
}

let cached: string | null = null;

function getRgPath(): string {
    if (!cached) {
        cached = resolveRgPath();
    }
    return cached;
}

export { getRgPath };

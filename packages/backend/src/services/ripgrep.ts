import { join, dirname } from "path";
import { accessSync, constants } from "fs";
import { createRequire } from "module";
import { isWindows } from "./platform";

const rgBinary = isWindows() ? "rg.exe" : "rg";
const require = createRequire(import.meta.url);

/**
 * Resolve the ripgrep binary path.
 * Prefers the bundled @vscode/ripgrep binary, falls back to system PATH.
 */
function resolveRgPath(): string {
    try {
        const modPath = require.resolve("@vscode/ripgrep");
        const bundledPath = join(dirname(modPath), "..", "bin", rgBinary);
        accessSync(bundledPath, constants.X_OK);
        return bundledPath;
    } catch {
        // not found — fall through
    }

    // Fall back to system rg
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

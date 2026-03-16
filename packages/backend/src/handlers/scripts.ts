import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { MSG } from "@taskflow/shared";
import type { ScriptsListPayload, PackageManager } from "@taskflow/shared";
import type { Router } from "../ws/router";

function detectPackageManager(dir: string): PackageManager {
    if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) {
        return "bun";
    }
    if (existsSync(join(dir, "yarn.lock"))) {
        return "yarn";
    }
    return "npm";
}

async function readScripts(dir: string): Promise<Record<string, string>> {
    const pkgPath = join(dir, "package.json");
    try {
        const raw = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
        return pkg.scripts ?? {};
    } catch {
        return {};
    }
}

export function registerScriptsHandlers(router: Router): void {
    router.register(MSG.SCRIPTS_LIST, async (payload) => {
        const { path } = payload as ScriptsListPayload;
        return {
            scripts: await readScripts(path),
            packageManager: detectPackageManager(path),
        };
    });
}

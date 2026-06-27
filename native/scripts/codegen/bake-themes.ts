import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledThemes, deriveTheme } from "../../../packages/shared/src/index.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(REPO_ROOT, "native", "Sources", "Taskflow", "Resources", "themes");
mkdirSync(OUT, { recursive: true });

for (const record of bundledThemes) {
    const resolved = deriveTheme(record.source);
    const baked = {
        id: record.id,
        name: record.source.name,
        css: resolved.css,
        xterm: resolved.xterm,
    };
    writeFileSync(join(OUT, `${record.id}.json`), JSON.stringify(baked, null, 2) + "\n");
    console.log(`baked ${record.id}.json`);
}

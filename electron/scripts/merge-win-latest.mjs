import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(here, "..", "release");
const primaryPath = join(releaseDir, "latest-x64.yml");
const secondaryPath = join(releaseDir, "latest.yml");

if (!existsSync(primaryPath)) {
    console.error(`[merge-win-latest] Missing ${primaryPath} — did the x64 build run first?`);
    process.exit(1);
}
if (!existsSync(secondaryPath)) {
    console.error(`[merge-win-latest] Missing ${secondaryPath} — did the arm64 build run?`);
    process.exit(1);
}

// Extract the `files:` block and collect `- url: ...` entries (with their indented sub-keys).
// Expected format emitted by electron-builder:
//   files:
//     - url: NAME
//       sha512: ...
//       size: N
//     - url: ...
//   path: NAME
function splitFilesBlock(src) {
    const lines = src.split(/\r?\n/);
    const filesIdx = lines.findIndex((l) => /^files:\s*$/.test(l));
    if (filesIdx === -1) throw new Error("No `files:` key found");

    let end = lines.length;
    for (let i = filesIdx + 1; i < lines.length; i++) {
        // block ends at first line that isn't blank and isn't indented
        if (lines[i].length > 0 && !/^\s/.test(lines[i])) {
            end = i;
            break;
        }
    }

    const entries = [];
    let current = null;
    for (let i = filesIdx + 1; i < end; i++) {
        const line = lines[i];
        if (/^\s*-\s/.test(line)) {
            if (current) entries.push(current);
            current = { urlMatch: /url:\s*(\S+)/.exec(line)?.[1] ?? null, lines: [line] };
        } else if (current && /^\s+\S/.test(line)) {
            const m = /url:\s*(\S+)/.exec(line);
            if (m && !current.urlMatch) current.urlMatch = m[1];
            current.lines.push(line);
        }
    }
    if (current) entries.push(current);

    return {
        before: lines.slice(0, filesIdx + 1),
        after: lines.slice(end),
        entries,
    };
}

const primary = splitFilesBlock(readFileSync(primaryPath, "utf8"));
const secondary = splitFilesBlock(readFileSync(secondaryPath, "utf8"));

const seen = new Set();
const merged = [];
for (const entry of [...primary.entries, ...secondary.entries]) {
    if (!entry.urlMatch || seen.has(entry.urlMatch)) continue;
    seen.add(entry.urlMatch);
    merged.push(entry.lines.join("\n"));
}

const out = [...primary.before, ...merged, ...primary.after].join("\n");
writeFileSync(secondaryPath, out);
renameSync(primaryPath, join(releaseDir, "latest-x64.yml.bak"));
console.log(`[merge-win-latest] Wrote merged ${secondaryPath} with ${merged.length} file entries.`);

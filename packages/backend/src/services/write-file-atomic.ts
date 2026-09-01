import { rename, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

// A plain writeFile truncates the target before it writes, so any reader that
// looks in between sees an empty or half-written file. Writing to a sibling
// temp file and renaming it into place makes the swap atomic: a reader either
// sees the whole previous version or the whole new one, never a torn state.
// The temp file must live in the same directory so the rename stays within one
// filesystem, and it must not end in `.json` so directory scans skip it.
async function writeFileAtomic(filePath: string, data: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try {
        await writeFile(tempPath, data);
        await rename(tempPath, filePath);
    } catch (error) {
        await unlink(tempPath).catch(() => {
            // The temp file may never have been created; nothing to clean up.
        });
        throw error;
    }
}

// Convenience wrapper for the JSON state files this backend persists.
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

export { writeFileAtomic, writeJsonAtomic };

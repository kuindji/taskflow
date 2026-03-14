import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { constants } from "fs";
import { join } from "path";

/** Items that live in the data directory (moved when location changes) */
const DATA_ITEMS = [
    "projects.json",
    "tasks",
    "archive",
    "task-logs",
    "agent-skills",
];

export async function readDataLocation(baseDir: string): Promise<string | null> {
    try {
        const raw = await readFile(join(baseDir, "data-location.json"), "utf-8");
        const parsed = JSON.parse(raw) as { path?: string };
        if (parsed.path && typeof parsed.path === "string") {
            return parsed.path;
        }
    } catch {
        // Missing or invalid
    }
    return null;
}

export async function writeDataLocation(baseDir: string, newPath: string): Promise<void> {
    await writeFile(
        join(baseDir, "data-location.json"),
        JSON.stringify({ path: newPath }, null, 2),
    );
}

export async function clearDataLocation(baseDir: string): Promise<void> {
    try {
        await rm(join(baseDir, "data-location.json"), { force: true });
    } catch {
        // Ignore
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function isWritable(path: string): Promise<boolean> {
    try {
        await access(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

async function moveItem(src: string, dest: string): Promise<void> {
    try {
        // Fast path: same filesystem
        await rename(src, dest);
    } catch {
        // Cross-filesystem: copy then delete
        const srcStat = await stat(src);
        if (srcStat.isDirectory()) {
            await cp(src, dest, { recursive: true });
        } else {
            await cp(src, dest);
        }
        await rm(src, { recursive: true, force: true });
    }
}

export async function validateTargetDir(targetPath: string): Promise<string | null> {
    const targetExists = await exists(targetPath);

    if (targetExists) {
        const targetStat = await stat(targetPath);
        if (!targetStat.isDirectory()) {
            return "Target path exists but is not a directory";
        }
        if (!(await isWritable(targetPath))) {
            return "Target directory is not writable";
        }
    } else {
        // Try to create it
        try {
            await mkdir(targetPath, { recursive: true });
        } catch {
            return "Cannot create target directory";
        }
    }

    return null;
}

/** Check if a directory contains existing taskflow data */
export async function hasExistingData(dirPath: string): Promise<boolean> {
    for (const item of DATA_ITEMS) {
        const itemPath = join(dirPath, item);
        if (await exists(itemPath)) {
            try {
                const itemStat = await stat(itemPath);
                if (itemStat.isFile()) return true;
                // For directories, only count as existing if non-empty
                const entries = await readdir(itemPath);
                if (entries.length > 0) return true;
            } catch {
                // Ignore stat errors
            }
        }
    }
    return false;
}

/** Move data from currentDir to newDir, overwriting any existing data at destination */
export async function migrateDataDir(currentDir: string, newDir: string): Promise<void> {
    await mkdir(newDir, { recursive: true });

    for (const item of DATA_ITEMS) {
        const src = join(currentDir, item);
        const dest = join(newDir, item);

        if (!(await exists(src))) continue;

        // Remove destination if it exists (overwrite mode)
        if (await exists(dest)) {
            await rm(dest, { recursive: true, force: true });
        }

        await moveItem(src, dest);
    }
}

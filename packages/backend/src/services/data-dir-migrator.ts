import {
    access,
    cp,
    mkdir,
    mkdtemp,
    readdir,
    realpath,
    rename,
    rm,
    stat,
    writeFile,
} from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { isPathInsideDirectory } from "./theme-service";
import { isPermissionError } from "./write-file-atomic";

/**
 * Everything the stores keep in the data directory (see `buildDataPaths` in
 * config). The backend restarts after a move, so each store reopens here.
 * Agent skills, settings and per-machine files live in the base directory.
 */
const DATA_ITEMS = [
    "projects.json",
    "tasks",
    "archive",
    "task-logs",
    "session-logs",
    "sessions",
    "themes",
    "flows",
    "flow-runs",
    "schedules.json",
    "notifications.json",
];

const DATA_LOCATION_FILE = "data-location.json";

/**
 * Written to a temp file and renamed into place: config falls back to the base
 * directory on a torn pointer, which would silently select the old data.
 */
export async function writeDataLocation(baseDir: string, newPath: string): Promise<void> {
    const file = join(baseDir, DATA_LOCATION_FILE);
    const temp = `${file}.${process.pid}.tmp`;
    try {
        await writeFile(temp, JSON.stringify({ path: newPath }, null, 2));
        await rename(temp, file);
    } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
    }
}

/** Throws when the pointer cannot be removed: the old folder then stays selected. */
export async function clearDataLocation(baseDir: string): Promise<void> {
    await rm(join(baseDir, DATA_LOCATION_FILE), { force: true });
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

/**
 * Moves the data from `currentDir` to `newDir`, replacing data already there.
 *
 * Every item is copied into a staging folder inside `newDir`, then renamed
 * into place, with anything it replaces set aside. `commit` (writing the
 * location pointer) runs only once all items are in place. A failure up to
 * and including `commit` puts `newDir` back as it was and leaves `currentDir`
 * untouched. After `commit` nothing is undone: the sources are deleted and
 * any that could not be are returned for the caller to log.
 */
export async function migrateDataDir(
    currentDir: string,
    newDir: string,
    commit: () => Promise<void>,
): Promise<string[]> {
    await mkdir(newDir, { recursive: true });

    // Clearing a destination that holds its own source (the same folder under
    // another spelling, or the parent of a data folder named like an item)
    // would delete the data before it moves, so refuse before touching anything.
    const [realCurrent, realNew] = await Promise.all([realpath(currentDir), realpath(newDir)]);
    const items: string[] = [];
    for (const item of DATA_ITEMS) {
        const src = join(realCurrent, item);
        const dest = join(realNew, item);
        if (!(await exists(src))) continue;
        if (isPathInsideDirectory(src, dest) || isPathInsideDirectory(dest, src)) {
            throw new Error(`The new data folder overlaps the current one at ${src}`);
        }
        items.push(item);
    }

    const staging = await mkdtemp(join(newDir, ".taskflow-migrating-"));
    const incoming = join(staging, "incoming");
    const replaced = join(staging, "replaced");
    const setAside: string[] = [];
    const placed: string[] = [];
    try {
        await mkdir(incoming);
        await mkdir(replaced);
        for (const item of items) {
            await cp(join(currentDir, item), join(incoming, item), { recursive: true });
        }
        for (const item of items) {
            const dest = join(newDir, item);
            if (await exists(dest)) {
                await rename(dest, join(replaced, item));
                setAside.push(item);
            }
            await placeItem(join(incoming, item), dest);
            placed.push(item);
        }
        await commit();
    } catch (error) {
        await restoreDestination(newDir, replaced, placed, setAside);
        await rm(staging, { recursive: true, force: true }).catch((cleanupError: unknown) => {
            console.error(`Failed to remove ${staging}:`, cleanupError);
        });
        throw error;
    }

    const leftovers: string[] = [];
    for (const path of [...items.map((item) => join(currentDir, item)), staging]) {
        try {
            await rm(path, { recursive: true, force: true });
        } catch {
            leftovers.push(path);
        }
    }
    return leftovers;
}

/**
 * Renames a staged item into place. A read-only folder cannot be renamed into
 * another parent, and macOS File Provider mounts can refuse renames while
 * allowing writes, so a refused rename falls back to copying; the staged copy
 * goes with the staging folder.
 */
async function placeItem(staged: string, dest: string): Promise<void> {
    try {
        await rename(staged, dest);
    } catch (error) {
        if (!isPermissionError(error)) throw error;
        await cp(staged, dest, { recursive: true });
    }
}

async function restoreDestination(
    newDir: string,
    replaced: string,
    placed: string[],
    setAside: string[],
): Promise<void> {
    for (const item of [...placed].reverse()) {
        try {
            await rm(join(newDir, item), { recursive: true, force: true });
        } catch (error) {
            console.error(`Failed to remove copied ${item} from ${newDir}:`, error);
        }
    }
    for (const item of setAside) {
        try {
            await rename(join(replaced, item), join(newDir, item));
        } catch (error) {
            console.error(`Failed to restore ${item} in ${newDir}:`, error);
        }
    }
}

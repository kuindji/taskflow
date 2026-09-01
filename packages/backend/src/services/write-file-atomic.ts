import { rename, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join, resolve, sep } from "path";

interface FileOperations {
    writeFile(filePath: string, data: string): Promise<unknown>;
    rename(oldPath: string, newPath: string): Promise<unknown>;
    unlink(filePath: string): Promise<unknown>;
}

const defaultFileOperations: FileOperations = { writeFile, rename, unlink };

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
    return (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EACCES" || error.code === "EPERM")
    );
}

function isMacOsFileProviderPath(filePath: string): boolean {
    if (process.platform !== "darwin") return false;
    const cloudStorageRoot = resolve(join(homedir(), "Library", "CloudStorage")) + sep;
    return resolve(filePath).startsWith(cloudStorageRoot);
}

// A plain writeFile truncates the target before it writes, so any reader that
// looks in between sees an empty or half-written file. Writing to a sibling
// temp file and renaming it into place makes the swap atomic: a reader either
// sees the whole previous version or the whole new one, never a torn state.
// The temp file must live in the same directory so the rename stays within one
// filesystem, and it must not end in `.json` so directory scans skip it.
async function writeFileAtomic(
    filePath: string,
    data: string,
    operations: FileOperations = defaultFileOperations,
): Promise<void> {
    // Apple's File Provider mount rejects replacement rename for Dropbox in
    // ~/Library/CloudStorage. Avoid creating an undeletable temp file there;
    // mutations are still serialized by TaskStore's cross-process locks.
    if (isMacOsFileProviderPath(filePath)) {
        await operations.writeFile(filePath, data);
        return;
    }

    const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try {
        await operations.writeFile(tempPath, data);
        await operations.rename(tempPath, filePath);
    } catch (error) {
        await operations.unlink(tempPath).catch(() => {
            // Some macOS File Provider directories reject both rename and
            // unlink. Task directory scans ignore the stranded .tmp file.
        });

        // Dropbox and other macOS File Provider mounts can allow ordinary
        // writes while rejecting a replacement rename. Reads of task records
        // are non-destructive on a transient parse failure, so an in-place
        // write is safer than making every mutation fail in those directories.
        if (isPermissionError(error)) {
            await operations.writeFile(filePath, data);
            return;
        }
        throw error;
    }
}

// Convenience wrapper for the JSON state files this backend persists.
async function writeJsonAtomic(
    filePath: string,
    value: unknown,
    operations: FileOperations = defaultFileOperations,
): Promise<void> {
    await writeFileAtomic(filePath, JSON.stringify(value, null, 2), operations);
}

async function removeFileOrWrite(
    filePath: string,
    fallbackData: string,
    operations: FileOperations = defaultFileOperations,
): Promise<void> {
    try {
        await operations.unlink(filePath);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return;
        }
        if (!isPermissionError(error)) {
            throw error;
        }

        // File Provider may deny unlink while still allowing the existing file
        // to be overwritten. Callers provide an ignored record or empty log so
        // the logical removal remains durable across shared backends.
        await operations.writeFile(filePath, fallbackData);
    }
}

async function removeFileOrWriteJson(
    filePath: string,
    fallbackValue: unknown,
    operations: FileOperations = defaultFileOperations,
): Promise<void> {
    await removeFileOrWrite(filePath, JSON.stringify(fallbackValue, null, 2), operations);
}

export type { FileOperations };
export {
    isMacOsFileProviderPath,
    isPermissionError,
    removeFileOrWrite,
    removeFileOrWriteJson,
    writeFileAtomic,
    writeJsonAtomic,
};

import { randomBytes } from "crypto";
import { link, readFile, rename, rm, writeFile } from "fs/promises";

/** A path next to `file` that no other process or call will choose. */
function uniqueSibling(file: string, suffix: string): string {
    return `${file}.${process.pid}.${randomBytes(4).toString("hex")}.${suffix}`;
}

/**
 * Publishes `port` as the stable instance port file. Written whole to a private
 * temp file and renamed into place, so the path only ever names a complete file.
 * Writing the path directly could land the port in a file a backend shutting
 * down has just moved aside to delete, leaving the running backend with none.
 */
export async function writeInstancePortFile(file: string, port: number): Promise<void> {
    const temp = uniqueSibling(file, "tmp");
    try {
        await writeFile(temp, String(port));
        await rename(temp, file);
    } finally {
        await rm(temp, { force: true });
    }
}

/**
 * Removes the stable instance port file, but only while it still names `port`.
 * The file is per instance, not per process: when two backends of one instance
 * run, the later one overwrites it, and the earlier one exiting must not delete
 * the file that points at the backend still running.
 *
 * Reading and then deleting the path would delete a port written in between, so
 * the file is first moved aside, which is atomic, and its contents are judged
 * there. A file that is not ours is linked back, unless a newer one has been
 * written to the path meanwhile, in which case that newer one stands.
 */
export async function removeInstancePortFile(file: string, port: number): Promise<void> {
    const aside = uniqueSibling(file, "removing");
    try {
        await rename(file, aside);
    } catch {
        return;
    }
    try {
        const contents = await readFile(aside, "utf-8");
        if (contents.trim() === String(port)) return;
        await link(aside, file).catch(() => undefined);
    } finally {
        await rm(aside, { force: true });
    }
}

/**
 * Withdraws the stable port file, then frees the listening port. The ordering is
 * the point: with a fixed port (TASKFLOW_DEV_PORT) the next backend of this
 * instance names the same port, so once the port is free it can start and
 * write a file identical to ours, which a later removal would delete.
 */
export async function releaseInstancePort(
    file: string,
    port: number,
    stop: (() => void) | undefined,
): Promise<void> {
    try {
        await removeInstancePortFile(file, port);
    } finally {
        stop?.();
    }
}

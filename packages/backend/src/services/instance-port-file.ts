import { randomBytes } from "crypto";
import { link, readFile, rename, rm } from "fs/promises";

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
    const aside = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.removing`;
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

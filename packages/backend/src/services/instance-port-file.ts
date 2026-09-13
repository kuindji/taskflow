import { readFile, rm } from "fs/promises";

/**
 * Removes the stable instance port file, but only while it still names `port`.
 * The file is per instance, not per process: when two backends of one instance
 * run, the later one overwrites it, and the earlier one exiting must not delete
 * the file that points at the backend still running.
 */
export async function removeInstancePortFile(file: string, port: number): Promise<void> {
    let contents: string;
    try {
        contents = await readFile(file, "utf-8");
    } catch {
        return;
    }
    if (contents.trim() === String(port)) {
        await rm(file, { force: true });
    }
}

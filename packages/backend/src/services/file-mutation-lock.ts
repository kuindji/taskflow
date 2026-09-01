import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireFileMutationLock(targetPath: string): Promise<() => Promise<void>> {
    const lockPath = `${targetPath}.lock`;
    const ownerPath = join(lockPath, "owner");
    // Identifies this acquisition so the release can tell "my lock" from "a lock
    // someone else took over after judging mine stale".
    const token = `${process.pid}-${randomUUID()}`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            await mkdir(lockPath);
        } catch {
            try {
                if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
                    await rm(lockPath, { recursive: true, force: true });
                    continue;
                }
            } catch {
                // The lock vanished between mkdir and stat — retry immediately,
                // but yield first so this cannot become a busy-spin.
                await delay(0);
                continue;
            }
            await delay(25);
            continue;
        }

        await writeFile(ownerPath, token);
        return async () => {
            // A slow holder can have its lock broken and re-taken by a waiter.
            // Releasing blindly would then free someone else's lock and let a
            // third caller into the critical section beside them.
            try {
                if ((await readFile(ownerPath, "utf-8")) !== token) return;
            } catch {
                return;
            }
            await rm(lockPath, { recursive: true, force: true });
        };
    }
    throw new Error(`Timed out waiting for shared data lock: ${targetPath}`);
}

export { acquireFileMutationLock };

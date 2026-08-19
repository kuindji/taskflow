import { mkdir, rm, stat } from "fs/promises";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireFileMutationLock(targetPath: string): Promise<() => Promise<void>> {
    const lockPath = `${targetPath}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            await mkdir(lockPath);
            return async () => {
                await rm(lockPath, { recursive: true, force: true });
            };
        } catch {
            try {
                if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
                    await rm(lockPath, { recursive: true, force: true });
                    continue;
                }
            } catch {
                continue;
            }
            await delay(25);
        }
    }
    throw new Error(`Timed out waiting for shared data lock: ${targetPath}`);
}

export { acquireFileMutationLock };

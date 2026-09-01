import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { acquireFileMutationLock } from "../file-mutation-lock";

let dir: string;
let target: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-lock-"));
    target = join(dir, "record.json");
    await writeFile(target, "{}");
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

// A holder that is considered stale gets its lock broken by the next waiter.
// When the stale holder finally releases, it must not delete the lock that now
// belongs to someone else — otherwise a third caller walks straight into the
// critical section alongside the second, and their read-modify-write updates
// clobber each other.
describe("acquireFileMutationLock", () => {
    test("a stale holder's release does not free the new holder's lock", async () => {
        const releaseA = await acquireFileMutationLock(target);

        // Age A's lock past LOCK_STALE_MS so the next waiter breaks it.
        const stale = new Date(Date.now() - 120_000);
        await utimes(`${target}.lock`, stale, stale);

        const releaseB = await acquireFileMutationLock(target);

        // A finally finishes and releases what it believes is its own lock.
        await releaseA();

        // B is still inside the critical section, so the lock must still be held.
        expect(await stat(`${target}.lock`).catch(() => null)).not.toBeNull();

        await releaseB();
    });
});

/**
 * Plan review repro (round 4) for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Task 9 Step 3 serializes registry mutations per backend id. Task 9 Step 1's
 * test "removing a machine while it is connecting keeps it removed" then does
 *
 *     const attaching = reg.attachBackend(record.id);
 *     await reg.removeBackend(record.id);   // queued behind the attach
 *     release();                            // never reached
 *
 * `removeBackend` is queued behind `attachBackend` on the same id, and the
 * attach is parked on `gate`, which only `release()` opens — after the await.
 * The test hangs until bun's timeout. `serialize` is transcribed verbatim.
 *
 * The assertion below states the WRONG behaviour: the removal is still pending
 * long after it was awaited.
 *
 * Run: bun test ./plan-review/serialize-deadlock.test.ts
 */
import { expect, test } from "bun:test";

// ── Task 9 Step 3, verbatim ─────────────────────────────────────────────────
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(
        id,
        next.catch(() => {}),
    );
    return next;
}

test("Task 9 Step 1's remove-while-connecting sequence never gets past the await", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const attachBackend = (id: string) =>
        serialize(id, async () => {
            await gate;
            return "attached";
        });
    const removeBackend = (id: string) => serialize(id, async () => "removed");

    const attaching = attachBackend("desktop.local:main");
    const removal = removeBackend("desktop.local:main");

    const outcome = await Promise.race([
        removal.then(() => "removeBackend resolved"),
        new Promise<string>((r) => setTimeout(() => r("removeBackend still pending"), 300)),
    ]);
    expect(outcome).toBe("removeBackend still pending");

    release();
    await Promise.all([attaching, removal]);
});

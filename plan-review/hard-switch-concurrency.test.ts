/**
 * Plan review repro for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Task 21 Step 3's `workAs` is transcribed below verbatim; only the store, the
 * connection registry and the IPC are stubbed so it can run. The await
 * boundaries are the plan's own.
 *
 * The assertions state the WRONG behaviour.
 *
 * Run: bun test ./plan-review/hard-switch-concurrency.test.ts
 */
import { describe, expect, test } from "bun:test";

type MachineState = { id: string; state: "attaching" | "attached" | "offline" | "incompatible" };

function makeStore() {
    let machines: MachineState[] = [
        { id: "a", state: "attached" },
        { id: "b", state: "attached" },
        { id: "c", state: "attached" },
    ];
    const closed: string[] = [];
    const reset: string[] = [];
    const detached: string[] = [];
    let primaryId: string | null = "a";

    const get = () => ({ machines });
    const closeConnection = (id: string) => void closed.push(id);
    const resetBackend = (id: string) => void reset.push(id);
    /** Stands in for window.taskflow.detachBackend — a real IPC round trip. */
    const detachBackend = async (id: string) => {
        await Promise.resolve();
        detached.push(id);
        machines = machines.map((m) => (m.id === id ? { ...m, state: "offline" as const } : m));
    };
    const setPrimaryBackend = (id: string) => void (primaryId = id);

    // ── Task 21, Step 3, verbatim (dirty check and the not-attached branch
    //    elided: both targets are already attached, the case the plan calls
    //    "the likely case").
    async function workAs(id: string) {
        const already = get().machines.find((m) => m.id === id && m.state === "attached");
        if (!already) throw new Error("not exercised here");

        // 3. Detach everything EXCEPT the target.
        for (const machine of get().machines) {
            if (machine.id === id) continue;
            closeConnection(machine.id, "switch");
            resetBackend(machine.id);
            await detachBackend(machine.id);
        }

        // 4. Promote, then 5. remount.
        setPrimaryBackend(id);
        return { ok: true as const };
    }

    return {
        workAs,
        closed,
        detached,
        machines: () => machines,
        primary: () => primaryId,
    };
}

describe("hard switch is not single-flight", () => {
    test("two concurrent Work-as calls detach each other's target", async () => {
        const s = makeStore();

        // The user double-clicks, or picks a second machine before the first
        // switch has finished its IPC round trips.
        await Promise.all([s.workAs("b"), s.workAs("c")]);

        // The bug: workAs("b") skips b and closes a and c; workAs("c") skips c
        // and closes a and b. Every backend ends up closed, including both
        // targets that were just validated as healthy.
        expect(s.closed.sort()).toEqual(["a", "a", "b", "c"]);
        expect(s.machines().every((m) => m.state === "offline")).toBe(true);

        // And primary is left pointing at a backend the other switch tore down.
        expect(s.primary()).toBe("c");
        expect(s.machines().find((m) => m.id === "c")?.state).toBe("offline");
    });
});

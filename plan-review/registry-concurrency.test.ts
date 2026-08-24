/**
 * Plan review repro for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Task 9's createRegistry is transcribed below from the plan verbatim (Step 3),
 * with only the discovery listener and the real fs removed so it can run. Every
 * `await` boundary is the plan's own.
 *
 * The registry holds `records` as a plain reassigned array, and every mutator
 * reads it, awaits, then writes back a value derived from the pre-await read.
 * `openTunnel` sits inside that window and can take up to READINESS_TIMEOUT_MS
 * (10s), so the window is wide open in practice, not theoretically.
 *
 * The assertions below state the WRONG behaviour.
 *
 * Run: bun test ./plan-review/registry-concurrency.test.ts
 */
import { describe, expect, test } from "bun:test";

interface BackendRecord {
    id: string;
    backendUid: string | null;
    host: string;
    instanceId: string;
    displayName: string;
    user: string;
    sshPort: number;
    lastKnownPort: number | null;
    attached: boolean;
    addedAt: string;
}

// ── Task 5, verbatim ────────────────────────────────────────────────────────
function upsertRecord(records: BackendRecord[], next: BackendRecord): BackendRecord[] {
    const index = records.findIndex((record) => record.id === next.id);
    if (index === -1) return [...records, next];
    const copy = [...records];
    copy[index] = next;
    return copy;
}
function removeRecord(records: BackendRecord[], id: string): BackendRecord[] {
    return records.filter((record) => record.id !== id);
}
function backendIdFor(host: string, instanceId: string): string {
    return `${host}:${instanceId}`;
}

// ── Task 9, Step 3, verbatim (fs and discovery stubbed) ─────────────────────
function createRegistry(deps: {
    defaultUser: string;
    openTunnel(
        record: BackendRecord,
        backendPort: number,
    ): Promise<{ ok: true; localPort: number } | { ok: false; failure: unknown }>;
    closeTunnel(id: string): void;
}) {
    let records: BackendRecord[] = [];
    const origins = new Map<string, string>();
    let persisted = "[]";

    async function persist(): Promise<void> {
        persisted = JSON.stringify(records);
    }
    async function resolveBackendPort(record: BackendRecord): Promise<number> {
        return record.lastKnownPort ?? 7777;
    }

    return {
        peek: () => records,
        persistedRecords: () => JSON.parse(persisted) as BackendRecord[],
        originFor: (id: string) => origins.get(id) ?? null,

        async addBackend(input: { host: string }): Promise<BackendRecord> {
            const instanceId = "main";
            const record: BackendRecord = {
                id: backendIdFor(input.host, instanceId),
                backendUid: null,
                host: input.host,
                instanceId,
                displayName: input.host,
                user: deps.defaultUser,
                sshPort: 22,
                lastKnownPort: null,
                attached: false,
                addedAt: "2026-08-24T00:00:00.000Z",
            };
            records = upsertRecord(records, record);
            await persist();
            return record;
        },

        async attachBackend(id: string) {
            const record = records.find((entry) => entry.id === id);
            if (!record) return { ok: false as const, failure: "No such backend" };

            const port = await resolveBackendPort(record);
            const tunnel = await deps.openTunnel(record, port); // <- the wide window
            if (!tunnel.ok) return tunnel;

            const origin = `http://127.0.0.1:${tunnel.localPort}`;
            origins.set(id, origin);
            // `record` was read before two awaits and is written back wholesale.
            records = upsertRecord(records, { ...record, attached: true, lastKnownPort: port });
            await persist();
            return { ok: true as const, origin };
        },

        async updateBackend(id: string, patch: { displayName?: string }) {
            const record = records.find((entry) => entry.id === id);
            if (!record) return { ok: false, reason: "No such backend" };
            records = upsertRecord(records, { ...record, ...patch });
            await persist();
            return { ok: true };
        },

        async removeBackend(id: string) {
            deps.closeTunnel(id);
            origins.delete(id);
            records = removeRecord(records, id);
            await persist();
            return { ok: true };
        },
    };
}

/** An openTunnel we can hold open, standing in for ssh + the readiness probe. */
function heldTunnel() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const closed: string[] = [];
    return {
        closed,
        release,
        deps: {
            defaultUser: "kuindji",
            async openTunnel() {
                await gate;
                return { ok: true as const, localPort: 45001 };
            },
            closeTunnel: (id: string) => closed.push(id),
        },
    };
}

describe("registry mutators read, await, then write back a stale snapshot", () => {
    test("removing a machine while it is connecting brings it back, attached and dead", async () => {
        const t = heldTunnel();
        const reg = createRegistry(t.deps);
        const record = await reg.addBackend({ host: "desktop.local" });

        const attaching = reg.attachBackend(record.id); // parks inside openTunnel
        await reg.removeBackend(record.id); // user gives up and removes it
        expect(reg.peek()).toHaveLength(0);
        expect(t.closed).toEqual([record.id]); // its ssh child was killed

        t.release(); // ssh finally comes up; attachBackend resumes
        await attaching;

        // The bug: upsertRecord appends when the id is gone, so the removed
        // machine is resurrected — marked attached, with an origin pointing at
        // the tunnel that was just killed — and written back to backends.json.
        expect(reg.peek()).toHaveLength(1);
        expect(reg.peek()[0]).toMatchObject({ id: record.id, attached: true });
        expect(reg.persistedRecords()).toHaveLength(1);
        expect(reg.originFor(record.id)).toBe("http://127.0.0.1:45001");
    });

    test("renaming a machine while it is connecting silently loses the rename", async () => {
        const t = heldTunnel();
        const reg = createRegistry(t.deps);
        const record = await reg.addBackend({ host: "desktop.local" });

        const attaching = reg.attachBackend(record.id); // parks inside openTunnel
        await reg.updateBackend(record.id, { displayName: "Studio Desktop" });
        expect(reg.peek()[0].displayName).toBe("Studio Desktop");

        t.release();
        await attaching;

        // The bug: attachBackend writes back the snapshot it took before the
        // awaits, so the rename is overwritten and persisted away.
        expect(reg.peek()[0].displayName).toBe("desktop.local");
        expect(reg.persistedRecords()[0].displayName).toBe("desktop.local");
    });
    test("detaching a slow-connecting machine leaves it attached anyway", async () => {
        const t = heldTunnel();
        const reg = createRegistry(t.deps);
        const record = await reg.addBackend({ host: "desktop.local" });

        const attaching = reg.attachBackend(record.id); // parks inside openTunnel
        // The user unchecks it in the machines menu while it is still connecting.
        await reg.removeBackend(record.id);
        t.release();
        await attaching;

        // Same lost update as above, and this is the likeliest way to hit it:
        // openTunnel waits up to READINESS_TIMEOUT_MS (10s) for the readiness
        // probe, so the window is ten seconds wide on a sleeping machine.
        expect(reg.persistedRecords()[0]).toMatchObject({ attached: true });
    });
});

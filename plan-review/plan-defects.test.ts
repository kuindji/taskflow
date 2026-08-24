/**
 * Plan review repros for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * The plan's code is not written yet, so these tests embed the plan's OWN code
 * verbatim (with the source line noted above each block) and drive it through
 * the sequence the plan describes. Every assertion below states the WRONG
 * behaviour the plan as written produces.
 *
 * Run: bun test .plan-review/plan-defects.test.ts
 */
import { describe, expect, test } from "bun:test";

// ────────────────────────────────────────────────────────────────────────────
// Types, copied from the plan (Task 5, Task 10).
// ────────────────────────────────────────────────────────────────────────────
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
interface MenuEntry {
    id: string;
    displayName: string;
    instanceId: string;
    host: string;
    attached: boolean;
    saved: boolean;
    seen: boolean;
}
type MachineState = {
    id: string;
    displayName: string;
    host: string;
    instanceId: string;
    state: "attaching" | "attached" | "offline" | "incompatible";
    isLocal: boolean;
};

function record(patch: Partial<BackendRecord> = {}): BackendRecord {
    return {
        id: "desktop.local:main",
        backendUid: null,
        host: "desktop.local",
        instanceId: "main",
        displayName: "desktop",
        user: "kuindji",
        sshPort: 22,
        lastKnownPort: null,
        attached: false,
        addedAt: "2026-08-24T00:00:00.000Z",
        ...patch,
    };
}

// ── Plan, Task 5, "mergeForMenu" (verbatim; discovery arg unused here) ───────
function mergeForMenu(records: BackendRecord[]): MenuEntry[] {
    const saved: MenuEntry[] = records.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        instanceId: r.instanceId,
        host: r.host,
        attached: r.attached,
        saved: true,
        seen: false,
    }));
    return [...saved];
}

// ── Plan, Task 5, "adoptUid" (verbatim) ─────────────────────────────────────
function adoptUid(
    records: BackendRecord[],
    currentId: string,
    backendUid: string,
): BackendRecord[] {
    const source = records.find((r) => r.id === currentId);
    if (!source) return records;
    if (source.id === backendUid && source.backendUid === backendUid) return records;

    const existing = records.find((r) => r.id === backendUid && r !== source);
    if (!existing) {
        return records.map((r) => (r === source ? { ...r, id: backendUid, backendUid } : r));
    }

    const merged: BackendRecord = {
        ...existing,
        backendUid,
        id: backendUid,
        host: source.host,
        sshPort: source.sshPort,
        user: source.user || existing.user,
        lastKnownPort: source.lastKnownPort ?? existing.lastKnownPort,
        attached: existing.attached || source.attached,
    };
    return records.filter((r) => r !== source).map((r) => (r === existing ? merged : r));
}

// ── Plan, Task 10, Step 6, "refresh()" (verbatim, minus zustand) ────────────
function refresh(
    previousMachines: MachineState[],
    entries: MenuEntry[],
    attached: { id: string; origin: string; isLocal: boolean; isPrimary: boolean }[],
): MachineState[] {
    const attachedById = new Map(attached.map((a) => [a.id, a]));
    return entries.map((entry) => {
        const previous = previousMachines.find((m) => m.id === entry.id);
        const live = attachedById.get(entry.id);
        return {
            id: entry.id,
            displayName: entry.displayName,
            host: entry.host,
            instanceId: entry.instanceId,
            isLocal: live?.isLocal ?? false,
            state: previous?.state === "attaching" ? "attaching" : live ? "attached" : "offline",
        } as MachineState;
    });
}

// ── Plan, Task 19, Step 1, "useIsLocalBackend" (verbatim, minus the hook) ───
function isLocalBackend(machines: MachineState[], backendId: string | null): boolean {
    if (!backendId) return false;
    return machines.some((m) => m.id === backendId && m.isLocal);
}

// ────────────────────────────────────────────────────────────────────────────
describe("Finding 1 — the local backend never gets a machine row", () => {
    // Task 9, Step 5: "The local backend is not a record: getAttached always
    // includes it first". mergeForMenu (Task 5) only maps over records, so
    // listBackends() cannot return it. refresh() maps over listBackends().
    test("refresh() drops the local entry that getAttached reports", () => {
        const entries = mergeForMenu([
            record({ id: "abc123", backendUid: "abc123", attached: true }),
        ]);
        const attached = [
            { id: "local", origin: "http://127.0.0.1:7777", isLocal: true, isPrimary: true },
            { id: "abc123", origin: "http://127.0.0.1:45001", isLocal: false, isPrimary: false },
        ];

        const machines = refresh([], entries, attached);

        // The bug: no row for the machine the user is actually sitting at.
        expect(machines.map((m) => m.id)).toEqual(["abc123"]);
        expect(machines.find((m) => m.id === "local")).toBeUndefined();
    });

    test("so every local-only affordance is gated off on a single-machine install", () => {
        // A purely local user: one local project, backendId "local" (Task 10 Step 7).
        const machines = refresh([], mergeForMenu([]), [
            { id: "local", origin: "http://127.0.0.1:7777", isLocal: true, isPrimary: true },
        ]);

        // Task 19 Step 2 gates selectProjectDirectory, selectFile, openExternalFile,
        // showItemInFolder, runInShell and native file-drop on this predicate.
        expect(isLocalBackend(machines, "local")).toBe(false); // should be true
    });
});

describe("Finding 2 — attaching a backend under a second alias leaves it attached with no socket", () => {
    test("the merged record is reported attached while the renderer holds no connection for it", () => {
        // The canonical record confirmed its uid earlier and is currently detached.
        let records = [
            record({ id: "abc123", backendUid: "abc123", host: "desktop.local", attached: false }),
        ];
        const origins = new Map<string, string>();
        // The renderer's connection registry (Task 8): keyed by the id passed to
        // openConnection, which is the id the user attached under.
        const connections = new Set<string>();

        // User adds the same machine by IP and attaches it.
        const alias = record({ id: "192.168.1.20:main", host: "192.168.1.20", sshPort: 2222 });
        records = [...records, alias];
        origins.set(alias.id, "http://127.0.0.1:45002"); // registry.attachBackend
        records = records.map((r) => (r.id === alias.id ? { ...r, attached: true } : r));
        connections.add(alias.id); // backend-store.attach -> openConnection(alias.id, origin)

        // Handshake reports uid abc123 -> registry.confirmBackend (Task 9, Step 3, verbatim):
        const id = alias.id;
        const info = { backendUid: "abc123", protocolVersion: 1 };
        const before = records.find((e) => e.id === id);
        records = adoptUid(records, id, info.backendUid);
        if (before && id !== info.backendUid) {
            const origin = origins.get(id);
            if (origin) {
                origins.delete(id);
                origins.set(info.backendUid, origin);
            }
        }
        const canonical = info.backendUid;

        // backend-store.attach (Task 10, Step 5): canonical !== id, so it closes
        // this connection and removes the row, "letting the canonical one stand".
        expect(canonical).not.toBe(id);
        connections.delete(id);

        // What main now reports:
        const entries = mergeForMenu(records);
        const attached = [
            { id: "local", origin: "http://127.0.0.1:7777", isLocal: true, isPrimary: true },
            ...[...origins.entries()].map(([rid, origin]) => ({
                id: rid,
                origin,
                isLocal: false,
                isPrimary: false,
            })),
        ];
        const machines = refresh([], entries, attached);

        // The bug: one machine, shown as attached...
        expect(machines).toHaveLength(1);
        expect(machines[0]).toMatchObject({ id: "abc123", state: "attached" });
        // ...with no connection behind it. Every sendRequest("abc123", …) rejects
        // with BackendDetachedError, and bootstrapBackend never ran for it, so the
        // section renders with no projects and no error.
        expect(connections.has("abc123")).toBe(false);
        expect([...connections]).toEqual([]);
    });

    test("and the alias's ssh child is never closed", () => {
        // closeTunnel is called only from detachBackend and removeBackend
        // (Task 9, Step 3). confirmBackend's merge path calls neither, so the
        // tunnel opened under the alias id outlives the record it belonged to.
        const openTunnels = new Set<string>();
        openTunnels.add("192.168.1.20:main"); // attachBackend(alias)
        // confirmBackend merges the record away…
        const records = adoptUid(
            [
                record({ id: "abc123", backendUid: "abc123", attached: true }),
                record({ id: "192.168.1.20:main", host: "192.168.1.20", attached: true }),
            ],
            "192.168.1.20:main",
            "abc123",
        );
        expect(records.map((r) => r.id)).toEqual(["abc123"]);
        // …but the child keyed by the vanished id is still running.
        expect(openTunnels.has("192.168.1.20:main")).toBe(true);
    });
});

describe("Finding 3 — a manually added backend disconnects itself the moment it connects", () => {
    test("the first successful attach of a provisional record closes its own only socket", () => {
        // "Connect to backend…" -> addBackend (Task 9, Step 3): id is provisional.
        let records = [record({ id: "desktop.local:main", backendUid: null })];
        const origins = new Map<string, string>();
        const connections = new Set<string>();
        const openTunnels = new Set<string>();

        // attachBackend (Task 9, Step 3)
        origins.set("desktop.local:main", "http://127.0.0.1:45001");
        openTunnels.add("desktop.local:main"); // tunnels are keyed by record.id
        records = records.map((r) =>
            r.id === "desktop.local:main" ? { ...r, attached: true } : r,
        );
        // backend-store.attach (Task 10, Step 5)
        connections.add("desktop.local:main");

        // The handshake succeeds and reports a uid -> confirmBackend (Task 9, Step 3, verbatim):
        const id = "desktop.local:main";
        const info = { backendUid: "abc123", protocolVersion: 1 };
        const before = records.find((e) => e.id === id);
        records = adoptUid(records, id, info.backendUid);
        if (before && id !== info.backendUid) {
            const origin = origins.get(id);
            if (origin) {
                origins.delete(id);
                origins.set(info.backendUid, origin);
            }
        }
        const canonical = info.backendUid;

        // Task 10, Step 5, verbatim:
        //   if (canonical !== id) {
        //       // Two aliases of one backend. Main merged the records; drop this
        //       // connection and let the canonical one stand.
        //       closeConnection(id, "detach");
        //       ...filter the machine row out...
        //       return;
        //   }
        // But this is NOT an alias merge — it is the first attach of a record
        // that had no uid yet. There is no canonical connection to stand.
        expect(canonical).not.toBe(id);
        connections.delete(id);

        // The bug, three ways:
        expect(connections.size).toBe(0); // the only socket is gone
        expect(records.map((r) => r.id)).toEqual(["abc123"]); // record survives, renamed
        expect(origins.get("abc123")).toBe("http://127.0.0.1:45001"); // main still says attached

        // refresh() then re-adds the row as "attached" with nothing behind it.
        const machines = refresh(
            [],
            mergeForMenu(records),
            [...origins.entries()].map(([rid, origin]) => ({
                id: rid,
                origin,
                isLocal: false,
                isPrimary: false,
            })),
        );
        expect(machines[0]).toMatchObject({ id: "abc123", state: "attached" });
        expect(connections.has("abc123")).toBe(false);

        // And the ssh child is keyed under an id no record holds any more, so
        // detachBackend("abc123") -> closeTunnel("abc123") can never kill it.
        expect(openTunnels.has("desktop.local:main")).toBe(true);
        expect(openTunnels.has("abc123")).toBe(false);
    });
});

// ── Plan, Task 11, Step 3, "createSlices" (verbatim) ─────────────────────────
function createSlices<T>() {
    interface Slice {
        items: (T & { backendId: string })[];
        revision: number;
    }
    const slices = new Map<string, Slice>();
    function sliceFor(backendId: string): Slice {
        let slice = slices.get(backendId);
        if (!slice) {
            slice = { items: [], revision: 0 };
            slices.set(backendId, slice);
        }
        return slice;
    }
    return {
        read: (): (T & { backendId: string })[] => [...slices.values()].flatMap((s) => s.items),
        token: (backendId: string): number => sliceFor(backendId).revision,
        replace: (backendId: string, items: T[], token: number): void => {
            const slice = sliceFor(backendId);
            if (slice.revision !== token) return;
            slice.items = items.map((item) => ({ ...item, backendId }));
            slice.revision++;
        },
    };
}

describe("Finding 4 — two concurrent fetches for one backend: the stale answer wins", () => {
    test("the second, newer PROJECT_LIST response is discarded in favour of the first", () => {
        const slices = createSlices<{ id: string }>();

        // Two overlapping fetchProjects("a") calls — e.g. bootstrapBackend on
        // attach and a refresh triggered by onBackendsChanged.
        const tokenA = slices.token("a"); // 0
        const tokenB = slices.token("a"); // 0

        // The older request resolves first with the state as it was.
        slices.replace("a", [{ id: "old" }], tokenA);
        // The newer request resolves second, carrying the project just created
        // on the backend. Its token (0) no longer matches revision (1).
        slices.replace("a", [{ id: "old" }, { id: "new" }], tokenB);

        // The bug: the fresher list is dropped and the store keeps the older one.
        expect(slices.read().map((i) => i.id)).toEqual(["old"]);
    });
});

describe("Finding 5 — a backend attached in the background at launch never gets a socket", () => {
    test("refresh() promotes it to 'attached' without openConnection/handshake/bootstrap", () => {
        // main.ts (Task 9, Step 7) dials persisted records without awaiting:
        //     for (const record of registry.attachedRecords()) void registry.attachBackend(record.id);
        // The renderer (Task 10, Step 7) reads getAttached() at startup. The ssh
        // tunnel is not up yet, so origins is empty and it attaches only local.
        const records = [record({ id: "abc123", backendUid: "abc123", attached: true })];
        const origins = new Map<string, string>();
        const connections = new Set<string>(["local"]);

        let machines = refresh([], mergeForMenu(records), [
            { id: "local", origin: "http://127.0.0.1:7777", isLocal: true, isPrimary: true },
        ]);
        expect(machines[0]).toMatchObject({ id: "abc123", state: "offline" });

        // Seconds later main's attachBackend resolves and fires onBackendsChanged,
        // whose only handler is `void useBackendStore.getState().refresh()`.
        origins.set("abc123", "http://127.0.0.1:45001");
        machines = refresh(machines, mergeForMenu(records), [
            { id: "local", origin: "http://127.0.0.1:7777", isLocal: true, isPrimary: true },
            ...[...origins.entries()].map(([id, origin]) => ({
                id,
                origin,
                isLocal: false,
                isPrimary: false,
            })),
        ]);

        // The bug: the row says attached, but refresh() only maps state — it never
        // calls openConnection, so there is no socket, no handshake and no
        // bootstrapBackend. The section renders empty with no error, and
        // onBackendSeen's retry is gated on state === "offline", so the beacon
        // reappearing will not rescue it either.
        expect(machines[0]).toMatchObject({ id: "abc123", state: "attached" });
        expect(connections.has("abc123")).toBe(false);
    });
});

// ── Plan, Task 5, "matchesDiscovered" (verbatim) ────────────────────────────
interface DiscoveredBackend {
    backendUid: string;
    hostname: string;
    instanceId: string;
    port: number;
    lastSeenAt: number;
}
function matchesDiscovered(r: BackendRecord, entry: DiscoveredBackend): boolean {
    if (r.backendUid) return r.backendUid === entry.backendUid;
    return r.host === entry.hostname && r.instanceId === entry.instanceId;
}

// ── Plan, Task 9, Step 3, "resolveBackendPort" (verbatim) ───────────────────
function resolveBackendPort(
    r: BackendRecord,
    discovered: DiscoveredBackend[],
    readRemotePort: () => number,
): number {
    const live = discovered.find((entry) => matchesDiscovered(r, entry));
    if (live) return live.port;
    if (r.lastKnownPort) return r.lastKnownPort;
    return readRemotePort();
}

describe("Finding 6 — any LAN peer can keep a saved machine permanently unattachable", () => {
    test("a spoofed announce overrides the record's own good cached port", () => {
        // backendUid is broadcast in cleartext in every announce (Task 3, Delta A),
        // so every peer on the LAN learns it. matchesDiscovered ignores hostname
        // entirely once a record has a uid, so the spoofed announce need not even
        // claim to be the victim host.
        const saved = record({
            id: "abc123",
            backendUid: "abc123",
            host: "desktop.local",
            lastKnownPort: 54892, // the real, working port
        });
        const spoof: DiscoveredBackend = {
            backendUid: "abc123",
            hostname: "attacker.local",
            instanceId: "main",
            port: 9,
            lastSeenAt: 0,
        };

        expect(matchesDiscovered(saved, spoof)).toBe(true);

        // The bug: the live beacon is preferred over lastKnownPort, so attach
        // forwards to a dead port on the real host. waitForBackend requires the
        // body to start with "Taskflow backend", so the probe fails and
        // attachBackend reports failure { kind: "no-backend" }:
        //   "Taskflow is not running on desktop." — while it plainly is.
        expect(resolveBackendPort(saved, [spoof], () => 54892)).toBe(9);
        expect(resolveBackendPort(saved, [], () => 54892)).toBe(54892); // without the spoof

        // The same match also drives registry.onSeen -> onBackendSeen -> retry(id),
        // so the failing attach is re-driven for as long as the attacker announces.
    });
});

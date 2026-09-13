import { describe, expect, test } from "bun:test";
import type { BackendRecord, DiscoveredBackend } from "@taskflow/shared";
import {
    adoptUid,
    mergeForMenu,
    normalizeRecords,
    recordFromDiscovered,
    upsertRecord,
} from "./backend-records";

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

describe("adoptUid", () => {
    test("rekeys a provisional record onto its uid", () => {
        const records = [record()];
        const next = adoptUid(records, "desktop.local:main", "abc123");

        expect(next).toHaveLength(1);
        expect(next[0].id).toBe("abc123");
        expect(next[0].backendUid).toBe("abc123");
        expect(next[0].host).toBe("desktop.local");
    });

    test("merges an alias into the record that already holds the uid", () => {
        const byName = record({ id: "abc123", backendUid: "abc123", attached: true });
        const byIp = record({ id: "192.168.1.20:main", host: "192.168.1.20", sshPort: 2222 });

        const next = adoptUid([byName, byIp], "192.168.1.20:main", "abc123");

        expect(next).toHaveLength(1);
        expect(next[0].id).toBe("abc123");
        // The surviving record keeps its attached state and adopts the newly
        // proven reachable host, because that is the one that just answered.
        expect(next[0].attached).toBe(true);
        expect(next[0].host).toBe("192.168.1.20");
        expect(next[0].sshPort).toBe(2222);
    });

    test("is a no-op when the uid is already the record's id", () => {
        const records = [record({ id: "abc123", backendUid: "abc123" })];
        expect(adoptUid(records, "abc123", "abc123")).toEqual(records);
    });

    test("refuses a uid outside the safe label set, which could name a provisional record", () => {
        const byName = record();
        const byIp = record({ id: "192.168.1.20:main", host: "192.168.1.20" });
        const records = [byName, byIp];

        expect(adoptUid(records, "desktop.local:main", "192.168.1.20:main")).toEqual(records);
        expect(adoptUid(records, "desktop.local:main", "")).toEqual(records);
    });
});

describe("recordFromDiscovered", () => {
    test("saves a discovered backend provisionally, keyed by source address, not by the announced uid", () => {
        const record = recordFromDiscovered(
            {
                v: 1,
                protocolVersion: 1,
                instanceId: "dev-x",
                hostname: "desktop",
                displayName: "",
                port: 54892,
                appVersion: "0.14.4",
                os: "darwin",
                backendUid: "abc123",
                address: "192.168.1.20",
                lastSeenAt: 1_000,
            },
            "kuindji",
            "2026-08-24T00:00:00.000Z",
        );
        // The beacon's uid is a hint anyone on the LAN can advertise. Identity
        // is adopted at handshake (adoptUid), never from a datagram.
        expect(record.id).toBe("192.168.1.20:dev-x");
        expect(record.backendUid).toBeNull();
        expect(record.host).toBe("192.168.1.20");
        expect(record.displayName).toBe("desktop");
        expect(record.lastKnownPort).toBe(54892);
    });
});

describe("normalizeRecords", () => {
    test("reads a pre-uid file as provisional records", () => {
        const parsed = normalizeRecords([
            { id: "desktop.local:main", host: "desktop.local", instanceId: "main" },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].backendUid).toBeNull();
        expect(parsed[0].attached).toBe(false);
    });

    test("drops entries that are not usable records", () => {
        expect(normalizeRecords([null, 42, {}, { host: "x" }])).toHaveLength(0);
    });
});

describe("normalizeRecords and adoptUid on a hand-edited file", () => {
    test("a confirmed record saved under a stale id is keyed by its uid, and adopting that uid merges into it", () => {
        const parsed = normalizeRecords([
            {
                id: "desktop.local:main",
                backendUid: "abc123",
                host: "desktop.local",
                instanceId: "main",
            },
            { id: "abc123", backendUid: "abc123", host: "desktop.local", instanceId: "main" },
            { id: "192.168.1.20:main", backendUid: null, host: "192.168.1.20", instanceId: "main" },
        ]);
        expect(parsed.map((r) => r.id)).toEqual(["abc123", "192.168.1.20:main"]);

        const next = adoptUid(parsed, "192.168.1.20:main", "abc123");
        expect(next.map((r) => r.id)).toEqual(["abc123"]);
    });

    test("a record already saved under its uid wins over a stale-id duplicate listed before it", () => {
        const parsed = normalizeRecords([
            {
                id: "desktop.local:main",
                backendUid: "abc123",
                host: "desktop.local",
                instanceId: "main",
            },
            {
                id: "abc123",
                backendUid: "abc123",
                host: "192.168.1.20",
                instanceId: "main",
                sshPort: 2222,
                attached: true,
            },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].host).toBe("192.168.1.20");
        expect(parsed[0].sshPort).toBe(2222);
        expect(parsed[0].attached).toBe(true);
    });

    test("a uid outside the safe label set is read as provisional and cannot take another record's id", () => {
        const parsed = normalizeRecords([
            {
                id: "desktop.local:main",
                backendUid: "192.168.1.20:main",
                host: "desktop.local",
                instanceId: "main",
            },
            { id: "192.168.1.20:main", backendUid: null, host: "192.168.1.20", instanceId: "main" },
        ]);
        expect(parsed.map((r) => r.id)).toEqual(["desktop.local:main", "192.168.1.20:main"]);
        expect(parsed[0].backendUid).toBeNull();
    });

    test("ports outside 1-65535 fall back to their defaults", () => {
        const [parsed] = normalizeRecords([
            { host: "desktop.local", instanceId: "main", sshPort: 0, lastKnownPort: -1 },
        ]);
        expect(parsed.sshPort).toBe(22);
        expect(parsed.lastKnownPort).toBeNull();

        const [fractional] = normalizeRecords([
            { host: "desktop.local", instanceId: "main", sshPort: 22.5, lastKnownPort: 70000 },
        ]);
        expect(fractional.sshPort).toBe(22);
        expect(fractional.lastKnownPort).toBeNull();
    });
});

describe("mergeForMenu", () => {
    function beacon(patch: Partial<DiscoveredBackend>): DiscoveredBackend {
        return {
            v: 1,
            protocolVersion: 1,
            instanceId: "main",
            hostname: "desktop",
            displayName: "",
            port: 54892,
            appVersion: "0.14.4",
            os: "darwin",
            backendUid: "abc123",
            address: "192.168.1.20",
            lastSeenAt: 1_000,
            ...patch,
        };
    }

    test("two unsaved machines announcing one uid get distinct rows, keyed as they would be saved", () => {
        const entries = mergeForMenu(
            [],
            [beacon({ address: "192.168.1.20" }), beacon({ address: "192.168.1.66" })],
            1_000,
        );
        expect(entries.map((e) => e.id)).toEqual(["192.168.1.20:main", "192.168.1.66:main"]);
    });
});

describe("upsertRecord", () => {
    test("replaces by id and keeps order", () => {
        const a = record({ id: "a", host: "a" });
        const b = record({ id: "b", host: "b" });
        const next = upsertRecord([a, b], record({ id: "a", host: "a", displayName: "renamed" }));
        expect(next.map((r) => r.id)).toEqual(["a", "b"]);
        expect(next[0].displayName).toBe("renamed");
    });
});

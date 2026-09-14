import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DiscoveredBackend } from "@taskflow/shared";
import { createRegistry } from "./backend-registry";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A live announcement as the listener would hold it. Every field, so it typechecks. */
function discovered(patch: Partial<DiscoveredBackend> = {}): DiscoveredBackend {
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
        lastSeenAt: Date.now(),
        ...patch,
    };
}

/** The error a promise rejects with. bun types `rejects.toThrow` as void, which
 *  eslint's `await-thenable` refuses to await. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof Error) return error;
        throw new Error(`Rejected with a non-Error: ${String(error)}`, { cause: error });
    }
    throw new Error("Expected the promise to reject");
}

async function registry(overrides: Partial<Parameters<typeof createRegistry>[0]> = {}) {
    const dir = await mkdtemp(join(tmpdir(), "reg-"));
    dirs.push(dir);
    return {
        dir,
        reg: createRegistry({
            file: join(dir, "backends.json"),
            defaultUser: "kuindji",
            openTunnel: async () => ({ ok: true as const, localPort: 45001 }),
            closeTunnel: () => {},
            rekeyTunnel: () => {},
            readRemotePort: async () => ({ port: 7777 }),
            fetchHostKeyFingerprint: async () => "256 SHA256:abc desktop (ED25519)",
            trustHostKey: async () => {},
            forgetScannedHostKey: () => {},
            ...overrides,
        }),
    };
}

describe("backend registry", () => {
    test("persists the attached flag so a machine is redialled next launch", async () => {
        const { dir, reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const written = JSON.parse(await readFile(join(dir, "backends.json"), "utf-8")) as {
            attached: boolean;
        }[];
        expect(written[0].attached).toBe(true);
        // Written through a temp file and a rename, which leaves nothing behind.
        expect(await readdir(dir)).toEqual(["backends.json"]);
    });

    test("confirming a uid rekeys the record and returns the canonical id", async () => {
        const { reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        const { id } = await reg.confirmBackend(record.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        expect(id).toBe("abc123");
        expect((await reg.listBackends()).map((e) => e.id)).toEqual(["abc123"]);
    });

    test("confirming the same uid from a second alias merges rather than duplicating", async () => {
        const { reg } = await registry();
        const byName = await reg.addBackend({ host: "desktop.local" });
        await reg.confirmBackend(byName.id, { backendUid: "abc123", protocolVersion: 1 });

        const byIp = await reg.addBackend({ host: "192.168.1.20" });
        const { id } = await reg.confirmBackend(byIp.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });

        expect(id).toBe("abc123");
        expect(await reg.listBackends()).toHaveLength(1);
    });

    test("detaching clears the attached flag and the tunnel", async () => {
        const closed: string[] = [];
        const { reg } = await registry({ closeTunnel: (id: string) => closed.push(id) });
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);
        await reg.detachBackend(record.id);
        expect((await reg.listBackends())[0].attached).toBe(false);
        expect(closed).toEqual([record.id]);
        expect(reg.originFor(record.id)).toBeNull();
        expect(reg.attached()).toEqual([]);
    });

    test("a first confirm is a rename: the tunnel moves and nothing is closed", async () => {
        const closed: string[] = [];
        const rekeyed: [string, string][] = [];
        const { reg } = await registry({
            closeTunnel: (id: string) => closed.push(id),
            rekeyTunnel: (from: string, to: string) => rekeyed.push([from, to]),
        });
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const result = await reg.confirmBackend(record.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });

        // This is every manual connect. Treating it as a merge closes the only
        // socket there is.
        expect(result).toEqual({ id: "abc123", merged: false });
        expect(closed).toEqual([]);
        expect(rekeyed).toEqual([[record.id, "abc123"]]);
        expect(reg.originFor("abc123")).not.toBeNull();
        expect(reg.originFor(record.id)).toBeNull();
        expect(reg.attached()).toEqual([{ id: "abc123", origin: "http://127.0.0.1:45001" }]);
    });

    test("a second alias is a merge: its tunnel is closed by the id it was opened under", async () => {
        const closed: string[] = [];
        const { reg } = await registry({ closeTunnel: (id: string) => closed.push(id) });
        const byName = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(byName.id);
        await reg.confirmBackend(byName.id, { backendUid: "abc123", protocolVersion: 1 });

        const byIp = await reg.addBackend({ host: "192.168.1.20" });
        await reg.attachBackend(byIp.id);
        const result = await reg.confirmBackend(byIp.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });

        expect(result).toEqual({ id: "abc123", merged: true });
        expect(closed).toContain(byIp.id);
        expect(await reg.listBackends()).toHaveLength(1);
    });

    test("removing a machine while it is connecting keeps it removed", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const { reg } = await registry({
            openTunnel: async () => {
                await gate;
                return { ok: true as const, localPort: 45001 };
            },
        });
        const record = await reg.addBackend({ host: "desktop.local" });

        const attaching = reg.attachBackend(record.id);
        // Not awaited before `release()`: the removal is queued behind the
        // attach on the same id, and the attach is parked on `gate`. Awaiting
        // it here would wait on itself and hang the test.
        const removing = reg.removeBackend(record.id);
        release();
        await Promise.all([attaching, removing]);

        // Unserialized, attachBackend's pre-await snapshot resurrects the record
        // with attached: true and an origin pointing at a killed ssh child.
        expect(await reg.listBackends()).toHaveLength(0);
        expect(reg.originFor(record.id)).toBeNull();
    });

    test("renaming a machine while it is connecting keeps the new name", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const { reg } = await registry({
            openTunnel: async () => {
                await gate;
                return { ok: true as const, localPort: 45001 };
            },
        });
        const record = await reg.addBackend({ host: "desktop.local" });

        const attaching = reg.attachBackend(record.id);
        const renaming = reg.updateBackend(record.id, { displayName: "Studio Desktop" });
        release();
        await Promise.all([attaching, renaming]);

        expect((await reg.listBackends())[0].displayName).toBe("Studio Desktop");
    });

    test("a spoofed beacon port does not override a port we have reached", async () => {
        const tried: number[] = [];
        const { reg } = await registry({
            openTunnel: async (_record: unknown, port: number) => {
                tried.push(port);
                return { ok: true as const, localPort: 45001 };
            },
        });
        const added = await reg.addBackend({ host: "desktop.local", port: 54892 });
        // The record must hold a confirmed uid, or matchesDiscovered falls back
        // to host matching and the spoof below never matches anything.
        const { id } = await reg.confirmBackend(added.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        // A LAN peer announces that uid with a dead port. Any peer can:
        // backendUid is broadcast in cleartext and matchesDiscovered keys on it.
        reg.__setDiscoveredForTest([
            discovered({ backendUid: "abc123", address: "attacker.local", port: 9 }),
        ]);

        await reg.attachBackend(id);
        expect(tried).toEqual([54892]);
    });

    test("an alias of a saved but detached record adopts the alias's tunnel instead of closing it", async () => {
        const closed: string[] = [];
        const rekeyed: [string, string][] = [];
        const { reg } = await registry({
            closeTunnel: (id: string) => closed.push(id),
            rekeyTunnel: (from: string, to: string) => rekeyed.push([from, to]),
        });
        const byName = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(byName.id);
        await reg.confirmBackend(byName.id, { backendUid: "abc123", protocolVersion: 1 });
        await reg.detachBackend("abc123");

        // The user connects the same machine by IP. The canonical record exists
        // but holds no live origin, so the newcomer's tunnel is the only one
        // there is: a rename onto the canonical, not a merge. Deciding on record
        // existence alone would close the one connection just proved healthy.
        const byIp = await reg.addBackend({ host: "192.168.1.20" });
        await reg.attachBackend(byIp.id);
        const result = await reg.confirmBackend(byIp.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });

        expect(result).toEqual({ id: "abc123", merged: false });
        expect(closed).toEqual(["abc123"]); // only the earlier detach
        expect(rekeyed).toContainEqual([byIp.id, "abc123"]);
        expect(reg.originFor("abc123")).not.toBeNull();
        expect((await reg.listBackends()).map((e) => e.id)).toEqual(["abc123"]);
    });

    test("saving a discovered machine keeps it provisional until a handshake confirms the uid", async () => {
        const { reg } = await registry();
        reg.__setDiscoveredForTest([
            discovered({ backendUid: "abc123", address: "192.168.1.20", instanceId: "dev-x" }),
        ]);

        const record = await reg.addDiscoveredBackend("192.168.1.20:dev-x");

        expect(record?.id).toBe("192.168.1.20:dev-x");
        expect(record?.backendUid).toBeNull();
        expect(record?.instanceId).toBe("dev-x");
        expect(record?.lastKnownPort).toBe(54892);
        expect(await reg.addDiscoveredBackend("nobody")).toBeNull();
    });

    test("this machine's own announcement is neither listed nor saved once local's uid is known", async () => {
        const { reg } = await registry();
        reg.__setDiscoveredForTest([
            discovered({ backendUid: "self-uid", address: "192.168.1.5" }),
            discovered({ backendUid: "abc123", address: "192.168.1.20" }),
        ]);

        reg.setLocalUid("self-uid");

        expect((await reg.listBackends()).map((e) => e.id)).toEqual(["192.168.1.20:main"]);
        expect(await reg.addDiscoveredBackend("192.168.1.5:main")).toBeNull();
    });

    test("refuses a uid outside the safe label set before touching tunnels or origins", async () => {
        // Such a uid could spell a provisional id ("host:instance") and merge
        // two machines. adoptUid leaves the records alone; the tunnel and the
        // origin must not move either, or they end up filed under an id no
        // record holds.
        const closed: string[] = [];
        const rekeyed: [string, string][] = [];
        const { reg } = await registry({
            closeTunnel: (id: string) => closed.push(id),
            rekeyTunnel: (from: string, to: string) => rekeyed.push([from, to]),
        });
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const refused = await rejectionOf(
            reg.confirmBackend(record.id, { backendUid: "192.168.1.20:main", protocolVersion: 1 }),
        );
        expect(refused.message).toMatch(/not a valid backend uid/);

        expect(closed).toEqual([]);
        expect(rekeyed).toEqual([]);
        expect(reg.originFor(record.id)).not.toBeNull();
        expect(reg.originFor("192.168.1.20:main")).toBeNull();
        expect((await reg.listBackends()).map((e) => e.id)).toEqual([record.id]);
    });

    test("refuses to rekey a confirmed record onto a different uid", async () => {
        // A confirmed record answering with another uid is a different backend
        // on that host and port. Adopting it would hand this record, its
        // attached flag and its tunnel to whoever answered.
        const rekeyed: [string, string][] = [];
        const { reg } = await registry({
            rekeyTunnel: (from: string, to: string) => rekeyed.push([from, to]),
        });
        const added = await reg.addBackend({ host: "desktop.local" });
        const { id } = await reg.confirmBackend(added.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        await reg.attachBackend(id);
        rekeyed.length = 0;

        const refused = await rejectionOf(
            reg.confirmBackend(id, { backendUid: "def456", protocolVersion: 1 }),
        );
        expect(refused.message).toMatch(/different backend/);

        expect(rekeyed).toEqual([]);
        expect(reg.originFor("abc123")).not.toBeNull();
        expect(reg.originFor("def456")).toBeNull();
        expect((await reg.listBackends()).map((e) => e.id)).toEqual(["abc123"]);
    });

    test("confirming a machine removed during its handshake is refused", async () => {
        const rekeyed: [string, string][] = [];
        const { reg } = await registry({
            rekeyTunnel: (from: string, to: string) => rekeyed.push([from, to]),
        });
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.removeBackend(record.id);

        const refused = await rejectionOf(
            reg.confirmBackend(record.id, { backendUid: "abc123", protocolVersion: 1 }),
        );
        expect(refused.message).toMatch(/No such backend/);
        expect(rekeyed).toEqual([]);
        expect(reg.originFor("abc123")).toBeNull();
    });

    test("adding a machine that is already saved keeps the saved record", async () => {
        const { reg } = await registry();
        const first = await reg.addBackend({ host: "desktop.local", user: "alice" });
        await reg.attachBackend(first.id);

        const second = await reg.addBackend({ host: "desktop.local", user: "bob" });

        expect(second.user).toBe("alice");
        expect(second.attached).toBe(true);
        expect(reg.originFor(first.id)).not.toBeNull();
        expect(await reg.listBackends()).toHaveLength(1);
    });

    test("rejects ports and instance names a record cannot hold", async () => {
        const { reg } = await registry();
        expect(
            (await rejectionOf(reg.addBackend({ host: "a.local", sshPort: 0 }))).message,
        ).toMatch(/not a valid port/);
        expect(
            (await rejectionOf(reg.addBackend({ host: "a.local", port: 70000 }))).message,
        ).toMatch(/not a valid port/);
        expect(
            (await rejectionOf(reg.addBackend({ host: "a.local", instanceId: "a b" }))).message,
        ).toMatch(/not a valid instance name/);
        expect((await rejectionOf(reg.addBackend({ host: "   " }))).message).toMatch(/host/);
        expect(await reg.listBackends()).toHaveLength(0);

        const record = await reg.addBackend({ host: "desktop.local" });
        const update = await reg.updateBackend(record.id, { sshPort: -1 });
        expect(update.ok).toBe(false);
        expect(update.reason).toMatch(/not a valid port/);
        expect((await reg.listBackends())[0].id).toBe(record.id);
    });

    test("an update changes only the fields it names and forgets a scanned host key", async () => {
        const forgotten: string[] = [];
        const { reg } = await registry({
            forgetScannedHostKey: (id: string) => forgotten.push(id),
        });
        const record = await reg.addBackend({ host: "desktop.local" });

        // What arrives over IPC is whatever the renderer sent, not the declared type.
        const patch = { sshPort: 2222, id: "abc123", backendUid: "abc123" };
        expect(await reg.updateBackend(record.id, patch)).toEqual({ ok: true });

        const [entry] = await reg.listBackends();
        expect(entry.id).toBe(record.id);
        expect(forgotten).toEqual([record.id]);
    });

    test("a tunnel that exits on its own drops the origin but keeps the attached intent", async () => {
        const { reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        await reg.tunnelExited(record.id);

        expect(reg.originFor(record.id)).toBeNull();
        expect(reg.attachedRecordIds()).toEqual([record.id]);
    });

    test("host key trust is looked up by record and reports failures as a reason", async () => {
        const trusted: string[] = [];
        const { reg } = await registry({
            trustHostKey: async (record) => {
                if (record.host === "bad.local") throw new Error("Re-check it");
                trusted.push(record.host);
            },
        });
        const good = await reg.addBackend({ host: "desktop.local" });
        const bad = await reg.addBackend({ host: "bad.local" });

        expect(await reg.trustBackendHost(good.id)).toEqual({ ok: true });
        expect(await reg.trustBackendHost(bad.id)).toEqual({ ok: false, reason: "Re-check it" });
        expect(await reg.trustBackendHost("nobody")).toEqual({
            ok: false,
            reason: "No such backend",
        });
        expect(trusted).toEqual(["desktop.local"]);
        expect(await reg.getHostFingerprint(good.id)).toEqual({
            ok: true,
            fingerprint: "256 SHA256:abc desktop (ED25519)",
        });
        expect(await reg.getHostFingerprint("nobody")).toEqual({
            ok: false,
            reason: "No such backend",
        });
    });

    // The renderer's row keeps its provisional id until `confirmBackend` resolves,
    // so a detach or removal clicked in that window arrives under the old id.
    test("a detach sent under the id a confirm is moving detaches the confirmed record", async () => {
        const closed: string[] = [];
        const { reg } = await registry({ closeTunnel: (id) => closed.push(id) });
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const confirming = reg.confirmBackend(record.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        const detaching = reg.detachBackend(record.id);
        await confirming;
        await detaching;

        expect(reg.attached()).toEqual([]);
        expect(reg.attachedRecordIds()).toEqual([]);
        expect(closed).toContain("abc123");
    });

    test("a removal sent under the id a confirm is moving removes the confirmed record", async () => {
        const { reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const confirming = reg.confirmBackend(record.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        const removing = reg.removeBackend(record.id);
        await confirming;
        await removing;

        expect(await reg.listBackends()).toEqual([]);
    });

    test("an id saved again after its record was confirmed away names the new record", async () => {
        const { reg } = await registry();
        const first = await reg.addBackend({ host: "desktop.local" });
        await reg.confirmBackend(first.id, { backendUid: "abc123", protocolVersion: 1 });
        const again = await reg.addBackend({ host: "desktop.local" });

        expect(again.id).toBe(first.id);
        await reg.removeBackend(again.id);

        expect((await reg.listBackends()).map((entry) => entry.id)).toEqual(["abc123"]);
    });
});

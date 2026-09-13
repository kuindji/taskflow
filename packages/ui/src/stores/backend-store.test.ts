import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { MenuEntry } from "@taskflow/shared";
import { BackendDetachedError, closeConnection, sendRequest } from "@/lib/connection-registry";
import type { useBackendStore as UseBackendStore } from "./backend-store";
import {
    bridge,
    emitBackendDropped,
    emitBackendSeen,
    installFakeBridge,
    main,
    resetFakeMain,
    tunnelFailure,
    uninstallFakeBridge,
} from "./fake-desktop-bridge";

type Bridge = NonNullable<Window["taskflow"]>;
type AttachResult = Awaited<ReturnType<Bridge["attachBackend"]>>;

/**
 * A backend that answers SYSTEM_INFO with `info()` and every other request with
 * `{}`. `holdInfo`, when given, decides when each SYSTEM_INFO answer is sent.
 */
function startBackend(
    info: () => { protocolVersion: number; backendUid?: string },
    holdInfo?: (answer: () => void) => void,
    answerLists = true,
): {
    origin: string;
    stop(): void;
} {
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            message(ws, raw) {
                const request = JSON.parse(String(raw)) as { correlationId?: string; type: string };
                if (!request.correlationId) return;
                const correlationId = request.correlationId;
                if (request.type !== MSG.SYSTEM_INFO) {
                    // An attach bootstraps the machine's projects and tasks;
                    // with `answerLists` false those answers are malformed.
                    let payload: object = {};
                    if (answerLists && request.type === MSG.PROJECT_LIST) {
                        payload = { projects: [] };
                    }
                    if (answerLists && request.type === MSG.TASK_LIST) payload = { tasks: [] };
                    ws.send(JSON.stringify({ correlationId, payload }));
                    return;
                }
                const answer = () => ws.send(JSON.stringify({ correlationId, payload: info() }));
                if (holdInfo) holdInfo(answer);
                else answer();
            },
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        stop: () => void server.stop(true),
    };
}

const failure = tunnelFailure;

let store: typeof UseBackendStore;

beforeAll(async () => {
    ({ useBackendStore: store } = await installFakeBridge());
});

afterAll(uninstallFakeBridge);

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const machine of store.getState().machines) closeConnection(machine.id, "detach");
    cleanups.splice(0).forEach((cleanup) => cleanup());
    resetFakeMain();
});

function seedRow(id: string): void {
    const entry: Pick<MenuEntry, "id" | "displayName" | "host" | "instanceId"> = {
        id,
        displayName: id,
        host: "desktop.local",
        instanceId: "main",
    };
    store.setState({
        machines: [{ ...entry, state: "offline", isLocal: false, keepAttached: true }],
    });
}

function row(id: string) {
    return store.getState().machines.find((m) => m.id === id);
}

function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => "resolved",
        (reason: unknown) => reason,
    );
}

describe("backend store attach", () => {
    test("a first handshake refiles the row and its socket under the uid", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        seedRow("desktop.local:main");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });

        const attachedAs = await store.getState().attach("desktop.local:main");

        expect(attachedAs).toBe("abc123");
        expect(store.getState().machines.map((m) => [m.id, m.state, m.backendUid])).toEqual([
            ["abc123", "attached", "abc123"],
        ]);
        // The same socket, now reachable under the uid.
        expect(await sendRequest<Record<string, never>>("abc123", "ping")).toEqual({});
    });

    test("a machine whose projects and tasks cannot be loaded ends offline with the reason", async () => {
        const backend = startBackend(
            () => ({ protocolVersion: PROTOCOL_VERSION, backendUid: "abc123" }),
            undefined,
            false,
        );
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });

        await store.getState().attach("abc123");

        expect(row("abc123")?.state).toBe("offline");
        expect(row("abc123")?.failure?.message).toBe(
            "Could not load this machine's projects and tasks",
        );
    });

    test("a refused confirm leaves the row offline with main's reason and no socket", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "other-uid",
        }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () =>
            Promise.reject(new Error("A different backend answered on that host"));

        const attachedAs = await store.getState().attach("abc123");

        expect(attachedAs).toBeNull();
        expect(row("abc123")?.state).toBe("offline");
        expect(row("abc123")?.failure?.message).toBe("A different backend answered on that host");
        expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
    });

    test("a protocol mismatch is incompatible and never reaches main's confirm", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION + 1,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });

        expect(await store.getState().attach("abc123")).toBeNull();
        expect(row("abc123")?.state).toBe("incompatible");
        expect(main.confirmed).toEqual([]);
    });

    test("an alias of an attached machine drops its row and answers the canonical id", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        seedRow("desktop.local:main");
        store.setState((state) => ({
            machines: [
                {
                    id: "abc123",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    state: "attached",
                    isLocal: false,
                    keepAttached: true,
                },
                ...state.machines,
            ],
        }));
        let attachCalls = 0;
        main.attachBackend = () => {
            attachCalls++;
            return Promise.resolve({ ok: true, origin: backend.origin });
        };
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: true });

        expect(await store.getState().attach("desktop.local:main")).toBe("abc123");
        expect(row("desktop.local:main")).toBeUndefined();
        // Already attached here: no second dial of the canonical id.
        expect(attachCalls).toBe(1);
        expect(row("abc123")?.state).toBe("attached");
        expect(await outcomeOf(sendRequest("desktop.local:main", "ping"))).toBeInstanceOf(
            BackendDetachedError,
        );
    });

    test("an alias of a machine this renderer holds no socket for dials the canonical id", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        // Main still has abc123's tunnel, but its earlier attach failed here: the
        // row is offline and there is no connection under it.
        store.setState({
            machines: [
                {
                    id: "abc123",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    state: "offline",
                    isLocal: false,
                    keepAttached: true,
                },
                {
                    id: "desktop.local:main",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    state: "offline",
                    isLocal: false,
                    keepAttached: true,
                },
            ],
        });
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = (id) =>
            Promise.resolve(
                id === "abc123" ? { id, merged: false } : { id: "abc123", merged: true },
            );

        expect(await store.getState().attach("desktop.local:main")).toBe("abc123");
        expect(store.getState().machines.map((m) => [m.id, m.state])).toEqual([
            ["abc123", "attached"],
        ]);
        expect(await sendRequest<Record<string, never>>("abc123", "ping")).toEqual({});
    });

    test("a detach while the tunnel is opening wins over the attach", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        let openTunnel: (result: AttachResult) => void = () => {};
        main.attachBackend = () => new Promise((resolve) => (openTunnel = resolve));
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });

        const attaching = store.getState().attach("abc123");
        await store.getState().detach("abc123");
        openTunnel({ ok: true, origin: backend.origin });

        expect(await attaching).toBeNull();
        expect(row("abc123")?.state).toBe("offline");
        expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
    });

    test("a tunnel that drops while main confirms fails the attach and keeps the drop's reason", async () => {
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: "abc123",
        }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        let answerConfirm: () => void = () => {};
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = (id) =>
            new Promise((resolve) => (answerConfirm = () => resolve({ id, merged: false })));

        const attaching = store.getState().attach("abc123");
        while (main.confirmed.length < 1) await Bun.sleep(5);
        emitBackendDropped("abc123", failure("ssh exited"));
        answerConfirm();

        expect(await attaching).toBeNull();
        expect(row("abc123")?.state).toBe("offline");
        expect(row("abc123")?.failure?.message).toBe("ssh exited");
    });

    test("an attach whose handshake a newer attach cut off leaves the newer one alone", async () => {
        let infoRequests = 0;
        let answerFirst: () => void = () => {};
        const backend = startBackend(
            () => ({ protocolVersion: PROTOCOL_VERSION, backendUid: "abc123" }),
            (answer) => {
                // Hold the first handshake unanswered; answer the rest at once.
                if (++infoRequests === 1) answerFirst = answer;
                else answer();
            },
        );
        cleanups.push(backend.stop);
        cleanups.push(() => answerFirst());
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });

        const first = store.getState().attach("abc123");
        while (infoRequests < 1) await Bun.sleep(5);
        const second = store.getState().attach("abc123");

        expect(await first).toBeNull();
        expect(await second).toBe("abc123");
        expect(row("abc123")?.state).toBe("attached");
        expect(await sendRequest<Record<string, never>>("abc123", "ping")).toEqual({});
    });

    test("a reconnect answered by a different backend detaches the machine", async () => {
        let uid = "abc123";
        const backend = startBackend(() => ({
            protocolVersion: PROTOCOL_VERSION,
            backendUid: uid,
        }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });
        expect(await store.getState().attach("abc123")).toBe("abc123");

        uid = "someone-else";
        await store.getState().rehandshake("abc123");

        expect(row("abc123")?.state).toBe("offline");
        expect(row("abc123")?.failure?.message).toMatch(/different backend/);
        expect(main.detached).toEqual(["abc123"]);
        expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
    });
});

describe("backend store beacon", () => {
    /** Main lists abc123 with the given persisted intent; counts attach dials. */
    function beaconSetup(attached: boolean): { dials: () => number } {
        seedRow("abc123");
        let dials = 0;
        main.attachBackend = () => {
            dials++;
            return Promise.resolve({ ok: false, failure: failure("still asleep") });
        };
        const original = bridge.listBackends;
        bridge.listBackends = () =>
            Promise.resolve([
                {
                    id: "abc123",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    attached,
                    saved: true,
                    seen: true,
                },
            ]);
        cleanups.push(() => (bridge.listBackends = original));
        return { dials: () => dials };
    }

    test("a beacon from a machine the user detached does not dial it", async () => {
        const { dials } = beaconSetup(false);

        emitBackendSeen("abc123");
        await Bun.sleep(20);

        expect(dials()).toBe(0);
        expect(row("abc123")?.state).toBe("offline");
    });

    test("a beacon from an attached machine that went offline dials it again", async () => {
        const { dials } = beaconSetup(true);

        emitBackendSeen("abc123");
        await Bun.sleep(20);

        expect(dials()).toBe(1);
    });

    test("a detach while the beacon checks the persisted intent does not dial", async () => {
        const { dials } = beaconSetup(true);
        // Main answers with the intent as it stood before the detach.
        const stale = bridge.listBackends;
        let answerList: () => void = () => {};
        let listed = false;
        bridge.listBackends = () => {
            listed = true;
            return new Promise((resolve) => (answerList = () => void stale().then(resolve)));
        };

        emitBackendSeen("abc123");
        while (!listed) await Bun.sleep(5);
        await store.getState().detach("abc123");
        answerList();
        await Bun.sleep(20);

        expect(dials()).toBe(0);
        expect(row("abc123")?.state).toBe("offline");
    });
});

describe("backend store refresh", () => {
    test("local gets a row from getAttached and is not marked attached by it", async () => {
        store.setState({ machines: [] });
        const original = bridge.getAttached;
        bridge.getAttached = () =>
            Promise.resolve([{ id: "local", origin: "http://127.0.0.1:1", isLocal: true }]);
        cleanups.push(() => (bridge.getAttached = original));

        await store.getState().refresh();

        expect(store.getState().machines.map((m) => [m.id, m.state, m.isLocal])).toEqual([
            ["local", "offline", true],
        ]);
    });

    test("a refresh while the user's attach opens the tunnel keeps the machine wanted", async () => {
        seedRow("abc123");
        store.setState((state) => ({
            machines: state.machines.map((m) => ({ ...m, keepAttached: false })),
        }));
        let openTunnel: (result: AttachResult) => void = () => {};
        main.attachBackend = () => new Promise((resolve) => (openTunnel = resolve));
        // Main persists `attached: true` only once the tunnel is open.
        const original = bridge.listBackends;
        bridge.listBackends = () =>
            Promise.resolve([
                {
                    id: "abc123",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    attached: false,
                    saved: true,
                    seen: true,
                },
            ]);
        cleanups.push(() => (bridge.listBackends = original));

        const attaching = store.getState().attach("abc123");
        await store.getState().refresh();

        expect(row("abc123")?.keepAttached).toBe(true);
        openTunnel({ ok: false, failure: failure("no route") });
        await attaching;
    });
});

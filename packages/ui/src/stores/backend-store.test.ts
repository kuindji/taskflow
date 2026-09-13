import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { MenuEntry, TunnelFailure } from "@taskflow/shared";
import { BackendDetachedError, closeConnection, sendRequest } from "@/lib/connection-registry";
import type { useBackendStore as UseBackendStore } from "./backend-store";

type Bridge = NonNullable<Window["taskflow"]>;
type AttachResult = Awaited<ReturnType<Bridge["attachBackend"]>>;

/** A backend that answers SYSTEM_INFO with `info()` and every other request with `{}`. */
function startBackend(info: () => { protocolVersion: number; backendUid?: string }): {
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
                const payload = request.type === MSG.SYSTEM_INFO ? info() : {};
                ws.send(JSON.stringify({ correlationId: request.correlationId, payload }));
            },
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        stop: () => void server.stop(true),
    };
}

interface FakeMain {
    attachBackend: (id: string) => Promise<AttachResult>;
    confirmBackend: Bridge["confirmBackend"];
    detached: string[];
    confirmed: string[];
}

const main: FakeMain = {
    attachBackend: () => Promise.resolve({ ok: false, failure: failure("unset") }),
    confirmBackend: () => Promise.reject(new Error("unset")),
    detached: [],
    confirmed: [],
};

function failure(message: string): TunnelFailure {
    return { kind: "unknown", message, stderr: "" };
}

const bridge: Pick<
    Bridge,
    | "attachBackend"
    | "confirmBackend"
    | "detachBackend"
    | "listBackends"
    | "getAttached"
    | "onBackendsChanged"
    | "onBackendDropped"
    | "onBackendSeen"
> = {
    attachBackend: (id) => main.attachBackend(id),
    confirmBackend: (id, info) => {
        main.confirmed.push(id);
        return main.confirmBackend(id, info);
    },
    detachBackend: (id) => {
        main.detached.push(id);
        return Promise.resolve();
    },
    listBackends: () => Promise.resolve([]),
    getAttached: () => Promise.resolve([]),
    onBackendsChanged: () => () => {},
    onBackendDropped: () => () => {},
    onBackendSeen: () => () => {},
};

let store: typeof UseBackendStore;

beforeAll(async () => {
    window.taskflow = bridge as Bridge;
    ({ useBackendStore: store } = await import("./backend-store"));
});

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const machine of store.getState().machines) closeConnection(machine.id, "detach");
    cleanups.splice(0).forEach((cleanup) => cleanup());
    main.detached = [];
    main.confirmed = [];
});

function seedRow(id: string): void {
    const entry: Pick<MenuEntry, "id" | "displayName" | "host" | "instanceId"> = {
        id,
        displayName: id,
        host: "desktop.local",
        instanceId: "main",
    };
    store.setState({ machines: [{ ...entry, state: "offline", isLocal: false }] });
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
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: true });

        expect(await store.getState().attach("desktop.local:main")).toBe("abc123");
        expect(row("desktop.local:main")).toBeUndefined();
        expect(await outcomeOf(sendRequest("desktop.local:main", "ping"))).toBeInstanceOf(
            BackendDetachedError,
        );
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
});

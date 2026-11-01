import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { MenuEntry } from "@taskflow/shared";
import {
    BackendDetachedError,
    closeConnection,
    getPrimary,
    onPrimaryStatusChange,
    onStatusChange,
    sendRequest,
    tokenFor,
} from "@/lib/connection-registry";
import type { useBackendStore as UseBackendStore } from "./backend-store";
import {
    bridge,
    emitBackendDropped,
    emitBackendSeen,
    emitRemoteResume,
    installFakeBridge,
    main,
    resetFakeMain,
    tunnelFailure,
    uninstallFakeBridge,
} from "./fake-desktop-bridge";

import { useProjectStore } from "./project-store";
import { useUIStore } from "./ui-store";
import { onBackendReady } from "@/lib/backend-ready";

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
    holdRequest?: (type: string, answer: () => void) => void,
    accept?: (protocolHeader: string | null) => boolean,
    port = 0,
): {
    origin: string;
    stop(): void;
} {
    const server = Bun.serve<{ accepted: boolean }>({
        port,
        hostname: "127.0.0.1",
        fetch: (req, server) =>
            server.upgrade(req, {
                data: { accepted: accept?.(req.headers.get("sec-websocket-protocol")) ?? true },
            })
                ? undefined
                : new Response("ok"),
        websocket: {
            open(ws) {
                if (!ws.data.accepted) ws.close(4401, "unauthorized");
            },
            message(ws, raw) {
                if (!ws.data.accepted) return;
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
                    const answer = () => {
                        ws.send(JSON.stringify({ correlationId, payload }));
                    };
                    if (holdRequest) holdRequest(request.type, answer);
                    else answer();
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
afterEach(async () => {
    await resetFakeMain();
    for (const machine of store.getState().machines) closeConnection(machine.id, "detach");
    cleanups.splice(0).forEach((cleanup) => cleanup());
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
        expect(row("abc123")?.state).toBe("reconnecting");
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

    test("local detached by a switch stays unticked across a refresh", async () => {
        store.setState({
            machines: [
                {
                    id: "local",
                    displayName: "This machine",
                    host: "127.0.0.1",
                    instanceId: "main",
                    state: "offline",
                    isLocal: true,
                    keepAttached: false,
                },
            ],
        });
        const original = bridge.getAttached;
        // Main always lists the backend it started, attached or not.
        bridge.getAttached = () =>
            Promise.resolve([{ id: "local", origin: "http://127.0.0.1:1", isLocal: true }]);
        cleanups.push(() => (bridge.getAttached = original));

        await store.getState().refresh();

        expect(row("local")?.keepAttached).toBe(false);
    });

    test("a discovered machine that is not saved gets no row", async () => {
        store.setState({ machines: [] });
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
                {
                    id: "192.168.1.66:main",
                    displayName: "Studio",
                    host: "192.168.1.66",
                    instanceId: "main",
                    attached: false,
                    saved: false,
                    seen: true,
                },
            ]);
        cleanups.push(() => (bridge.listBackends = original));

        await store.getState().refresh();

        expect(store.getState().machines.map((m) => m.id)).toEqual(["abc123"]);
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

test("attach opens the socket with the token main returned", async () => {
    const backend = startBackend(() => ({
        protocolVersion: PROTOCOL_VERSION,
        backendUid: "abc123",
    }));
    cleanups.push(backend.stop);
    seedRow("abc123");
    const token = "T".repeat(43);
    main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin, token });
    main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });
    expect(await store.getState().attach("abc123")).toBe("abc123");
    expect(tokenFor("abc123")).toBe(token);
});

async function waitUntil(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out");
        await Bun.sleep(5);
    }
}

describe("backend terminal readiness", () => {
    test("backend ready is published after the canonical handshake and required bootstrap", async () => {
        const ids: string[] = [];
        cleanups.push(onBackendReady((id) => ids.push(id)));
        let taskAnswer: (() => void) | null = null;
        const backend = startBackend(
            () => ({ protocolVersion: PROTOCOL_VERSION, backendUid: "abc123" }),
            undefined,
            true,
            (type, answer) => {
                if (type === MSG.TASK_LIST) taskAnswer = answer;
                else answer();
            },
        );
        cleanups.push(backend.stop);
        seedRow("provisional");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });
        const attaching = store.getState().attach("provisional");
        await waitUntil(() => taskAnswer !== null);
        expect(row("abc123")?.state).toBe("attached");
        expect(ids).toEqual([]);
        const answer = taskAnswer as unknown as () => void;
        answer();
        await attaching;
        expect(ids).toEqual(["abc123"]);
        taskAnswer = null;
        const reconnect = store.getState().rehandshake("abc123");
        await waitUntil(() => taskAnswer !== null);
        expect(ids).toEqual(["abc123"]);
        (taskAnswer as unknown as () => void)();
        await reconnect;
        expect(ids).toEqual(["abc123", "abc123"]);
    });
    test("failed bootstrap does not publish backend ready", async () => {
        const ids: string[] = [];
        cleanups.push(onBackendReady((id) => ids.push(id)));
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
        await store.getState().rehandshake("abc123");
        expect(ids).toEqual([]);
    });
    test("an incompatible or refused backend never publishes backend ready", async () => {
        const ids: string[] = [];
        cleanups.push(onBackendReady((id) => ids.push(id)));
        let version = PROTOCOL_VERSION + 1;
        const backend = startBackend(() => ({ protocolVersion: version, backendUid: "abc123" }));
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.reject(new Error("refused"));
        expect(await store.getState().attach("abc123")).toBeNull();
        version = PROTOCOL_VERSION;
        expect(await store.getState().attach("abc123")).toBeNull();
        expect(ids).toEqual([]);
    });
    test("a detach during bootstrap prevents a stale backend ready notification", async () => {
        const ids: string[] = [];
        cleanups.push(onBackendReady((id) => ids.push(id)));
        let held = false;
        const backend = startBackend(
            () => ({ protocolVersion: PROTOCOL_VERSION, backendUid: "abc123" }),
            undefined,
            true,
            (type, answer) => {
                if (type === MSG.TASK_LIST) held = true;
                else answer();
            },
        );
        cleanups.push(backend.stop);
        seedRow("abc123");
        main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
        main.confirmBackend = () => Promise.resolve({ id: "abc123", merged: false });
        const attaching = store.getState().attach("abc123");
        await waitUntil(() => held);
        await store.getState().detach("abc123");
        await attaching;
        expect(ids).toEqual([]);
    });
});

async function recoverySetup() {
    const backend = startBackend(() => ({
        protocolVersion: PROTOCOL_VERSION,
        backendUid: "abc123",
    }));
    cleanups.push(backend.stop);
    seedRow("abc123");
    main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
    main.confirmBackend = (id) => Promise.resolve({ id, merged: false });
    await store.getState().attach("abc123");
    return backend;
}

test("a tunnel exit keeps the desired machine reconnecting and preserves its data", async () => {
    await recoverySetup();
    const projects = [
        {
            id: "p",
            name: "project",
            path: "/repo",
            sessions: [],
            attributes: [],
            createdAt: "today",
            backendId: "abc123",
        },
    ];
    useProjectStore.setState({ projects });
    useUIStore.setState({ activeProjectId: "p" });
    emitBackendDropped("abc123", failure("ssh exited"));
    expect(row("abc123")?.state).toBe("reconnecting");
    expect(row("abc123")?.keepAttached).toBe(true);
    expect(useProjectStore.getState().projects).toBe(projects);
    expect(useUIStore.getState().activeProjectId).toBe("p");
    expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
});
test("a remote reconnects automatically without receiving a beacon", async () => {
    await recoverySetup();
    const ids: string[] = [];
    cleanups.push(onBackendReady((id) => ids.push(id)));
    emitBackendDropped("abc123", failure("ssh exited"));
    await waitUntil(() => ids.length > 0);
    expect(row("abc123")?.state).toBe("attached");
    expect(ids).toEqual(["abc123"]);
});
test("detaching during an automatic attach wins over its late result", async () => {
    const backend = await recoverySetup();
    let answer: ((result: AttachResult) => void) | undefined;
    main.attachBackend = () =>
        new Promise((resolve) => {
            answer = resolve;
        });
    emitBackendDropped("abc123", failure("ssh exited"));
    await waitUntil(() => answer !== undefined);
    await store.getState().detach("abc123");
    main.detached = [];
    answer?.({ ok: true, origin: backend.origin });
    await Bun.sleep(20);
    expect(row("abc123")?.state).toBe("offline");
    expect(row("abc123")?.keepAttached).toBe(false);
    expect(main.detached).toEqual(["abc123"]);
    expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
});
test("refresh preserves attachment intent while a reconnect is in flight", async () => {
    await recoverySetup();
    let answer: ((result: AttachResult) => void) | undefined;
    main.attachBackend = () =>
        new Promise((resolve) => {
            answer = resolve;
        });
    emitBackendDropped("abc123", failure("ssh exited"));
    await waitUntil(() => answer !== undefined);
    const original = bridge.listBackends;
    bridge.listBackends = () =>
        Promise.resolve([
            {
                id: "abc123",
                displayName: "desktop",
                host: "desktop.local",
                instanceId: "main",
                saved: true,
                attached: false,
                seen: false,
            },
        ]);
    cleanups.push(() => {
        bridge.listBackends = original;
    });
    await store.getState().refresh();
    expect(row("abc123")?.keepAttached).toBe(true);
    expect(row("abc123")?.state).toBe("reconnecting");
    answer?.({ ok: false, failure: failure("asleep") });
    await Bun.sleep(10);
});
test("an automatic reconnect still refuses a different backend uid", async () => {
    await recoverySetup();
    const backend = startBackend(() => ({
        protocolVersion: PROTOCOL_VERSION,
        backendUid: "different-uid",
    }));
    cleanups.push(backend.stop);
    main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
    let confirms = 0;
    main.confirmBackend = () => {
        confirms++;
        return Promise.reject(new Error("A different backend answered on that host"));
    };
    emitBackendDropped("abc123", failure("ssh exited"));
    await waitUntil(() => confirms > 0);
    await Bun.sleep(20);
    expect(row("abc123")?.state).toBe("reconnecting");
    expect(row("abc123")?.failure?.message).toMatch(/different backend/);
    expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
});
test("a protocol mismatch remains incompatible during automatic recovery", async () => {
    await recoverySetup();
    const backend = startBackend(() => ({
        protocolVersion: PROTOCOL_VERSION + 1,
        backendUid: "abc123",
    }));
    cleanups.push(backend.stop);
    main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
    emitBackendDropped("abc123", failure("ssh exited"));
    await waitUntil(() => row("abc123")?.state === "incompatible");
    expect(await outcomeOf(sendRequest("abc123", "ping"))).toBeInstanceOf(BackendDetachedError);
});
test("a primary remote that reconnects after a tunnel exit is primary again", async () => {
    await recoverySetup();
    expect(await store.getState().workAs("abc123")).toEqual({ ok: true });
    const connected: boolean[] = [];
    cleanups.push(onPrimaryStatusChange((status) => connected.push(status.connected)));
    emitBackendDropped("abc123", failure("ssh exited"));
    expect(getPrimary()).toBeNull();
    expect(connected.at(-1)).toBe(false);
    await waitUntil(() => row("abc123")?.state === "attached");
    expect(getPrimary()).toBe("abc123");
    expect(connected.at(-1)).toBe(true);
});

test("a refresh announcing the canonical id during confirmation preserves its reconnect", async () => {
    const backend = startBackend(() => ({
        protocolVersion: PROTOCOL_VERSION,
        backendUid: "abc123",
    }));
    cleanups.push(backend.stop);
    seedRow("provisional");
    main.attachBackend = () => Promise.resolve({ ok: true, origin: backend.origin });
    const original = bridge.listBackends;
    cleanups.push(() => {
        bridge.listBackends = original;
    });
    main.confirmBackend = async () => {
        bridge.listBackends = () =>
            Promise.resolve([
                {
                    id: "abc123",
                    displayName: "desktop",
                    host: "desktop.local",
                    instanceId: "main",
                    saved: true,
                    attached: true,
                    seen: false,
                },
            ]);
        await store.getState().refresh();
        return { id: "abc123", merged: false };
    };
    emitBackendDropped("provisional", failure("ssh exited"));
    await waitUntil(() => row("abc123")?.state === "attached");
    expect(store.getState().machines.map((m) => m.id)).toEqual(["abc123"]);
    expect(await sendRequest<Record<string, never>>("abc123", "ping")).toEqual({});
});

test("OS resume wakes a pending remote reconnect", async () => {
    await recoverySetup();
    let calls = 0;
    main.attachBackend = () => {
        calls++;
        return Promise.resolve({ ok: false, failure: failure("asleep") });
    };
    emitBackendDropped("abc123", failure("ssh exited"));
    emitRemoteResume();
    await waitUntil(() => calls === 1);
    await Bun.sleep(10);
    expect(row("abc123")?.state).toBe("reconnecting");
});
test("online wakes a pending remote reconnect", async () => {
    await recoverySetup();
    let calls = 0;
    main.attachBackend = () => {
        calls++;
        return Promise.resolve({ ok: false, failure: failure("asleep") });
    };
    emitBackendDropped("abc123", failure("ssh exited"));
    window.dispatchEvent(new Event("online"));
    await waitUntil(() => calls === 1);
    await Bun.sleep(10);
});
test("resume and online do not reconnect an explicitly detached backend", async () => {
    await recoverySetup();
    let calls = 0;
    main.attachBackend = () => {
        calls++;
        return Promise.resolve({ ok: false, failure: failure("asleep") });
    };
    // Healthy connections ignore both signals too.
    emitRemoteResume();
    window.dispatchEvent(new Event("online"));
    expect(calls).toBe(0);
    emitBackendDropped("abc123", failure("ssh exited"));
    await store.getState().detach("abc123");
    emitRemoteResume();
    window.dispatchEvent(new Event("online"));
    await Bun.sleep(20);
    expect(calls).toBe(0);
});
test("an automatic retry closes a tunnel left by a failed attempt", async () => {
    await recoverySetup();
    const original = bridge.getAttached;
    bridge.getAttached = () =>
        Promise.resolve([{ id: "abc123", origin: "http://127.0.0.1:1", isLocal: false }]);
    cleanups.push(() => (bridge.getAttached = original));
    const calls: string[] = [];
    const attach = main.attachBackend;
    main.attachBackend = (id) => {
        calls.push(`attach ${main.detached.length}`);
        return attach(id);
    };
    main.detached = [];
    emitBackendDropped("abc123", failure("ssh exited"));
    emitRemoteResume();
    await waitUntil(() => row("abc123")?.state === "attached");
    expect(main.detached).toEqual(["abc123"]);
    expect(calls).toEqual(["attach 1"]);
    expect(row("abc123")?.keepAttached).toBe(true);
});
test("a Retry whose redial fails leaves the machine attached for the next refresh", async () => {
    await recoverySetup();
    // Main's persisted intent: only a successful attach sets it, and a plain
    // detach clears it.
    let persisted = true;
    let tunnelLive = true;
    const originalAttached = bridge.getAttached;
    const originalList = bridge.listBackends;
    bridge.getAttached = () =>
        Promise.resolve(
            tunnelLive ? [{ id: "abc123", origin: "http://127.0.0.1:1", isLocal: false }] : [],
        );
    bridge.listBackends = () =>
        Promise.resolve([
            {
                id: "abc123",
                displayName: "desktop",
                host: "desktop.local",
                instanceId: "main",
                attached: persisted,
                saved: true,
                seen: true,
            },
        ]);
    cleanups.push(() => {
        bridge.getAttached = originalAttached;
        bridge.listBackends = originalList;
    });
    main.detachBackend = (_id, options) => {
        tunnelLive = false;
        if (!options?.keepIntent) persisted = false;
        return Promise.resolve();
    };
    let attaches = 0;
    main.attachBackend = () => {
        attaches++;
        return Promise.resolve({ ok: false, failure: failure("Backend did not answer") });
    };

    store.getState().retry("abc123");
    await waitUntil(() => attaches === 1 && row("abc123")?.failure !== undefined);
    await store.getState().refresh();

    expect(main.detached).toContain("abc123");
    expect(persisted).toBe(true);
    expect(row("abc123")?.keepAttached).toBe(true);
});
test("a repeated failure keeps its identity across automatic retries", async () => {
    await recoverySetup();
    let calls = 0;
    main.attachBackend = () => {
        calls++;
        return Promise.resolve({ ok: false, failure: failure("Host key is not trusted") });
    };
    emitBackendDropped("abc123", failure("ssh exited"));
    emitRemoteResume();
    await waitUntil(() => row("abc123")?.failure?.message === "Host key is not trusted");
    const first = row("abc123")?.failure;
    emitRemoteResume();
    await waitUntil(() => calls === 2);
    await Bun.sleep(10);
    expect(row("abc123")?.failure).toBe(first);
});

const AUTH_TOKEN = "a".repeat(43);
const NEW_AUTH_TOKEN = "b".repeat(43);
async function untilAuth(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!predicate() && Date.now() < deadline) await Bun.sleep(10);
    expect(predicate()).toBe(true);
}
function authBackend(accept: (header: string | null) => boolean) {
    const backend = startBackend(
        () => ({ protocolVersion: PROTOCOL_VERSION }),
        undefined,
        true,
        undefined,
        accept,
    );
    cleanups.push(backend.stop);
    return backend;
}
test("a remote attach refused with 4401 refreshes the token once and attaches with the new one", async () => {
    const backend = authBackend((h) => h?.includes(NEW_AUTH_TOKEN) ?? false);
    seedRow("auth1");
    let calls = 0;
    main.attachBackend = async () => ({
        ok: true,
        origin: backend.origin,
        token: ++calls === 1 ? AUTH_TOKEN : NEW_AUTH_TOKEN,
    });
    expect(await store.getState().attach("auth1")).toBe("auth1");
    expect(row("auth1")?.state).toBe("attached");
    expect(main.refreshed).toEqual(["auth1"]);
});
test("a remote attach refused twice ends offline with Remote backend rejected the access token and kind unauthorized", async () => {
    const backend = authBackend(() => false);
    seedRow("auth2");
    main.attachBackend = async () => ({ ok: true, origin: backend.origin, token: AUTH_TOKEN });
    await store.getState().attach("auth2");
    expect(row("auth2")?.state).toBe("offline");
    expect(row("auth2")?.failure).toEqual({
        kind: "unauthorized",
        message: "Remote backend rejected the access token",
        stderr: "",
    });
    expect(main.refreshed).toEqual(["auth2"]);
});
test("a local attach refused with 4401 ends offline with The local backend rejected the access token and no refresh", async () => {
    const backend = authBackend(() => false);
    seedRow("local");
    main.attachBackend = async () => ({ ok: true, origin: backend.origin, token: AUTH_TOKEN });
    await store.getState().attach("local");
    expect(row("local")?.state).toBe("offline");
    expect(row("local")?.failure?.message).toBe("The local backend rejected the access token");
    expect(main.refreshed).toEqual([]);
});
test("a successful handshake re-arms the refresh for a later 4401", async () => {
    let accepted = NEW_AUTH_TOKEN;
    const backend = authBackend((h) => h?.includes(accepted) ?? false);
    seedRow("auth3");
    let token = AUTH_TOKEN;
    main.refreshBackendToken = async () => {
        token = accepted;
        return { ok: true };
    };
    main.attachBackend = async () => ({ ok: true, origin: backend.origin, token });
    await store.getState().attach("auth3");
    expect(row("auth3")?.state).toBe("attached");
    accepted = "c".repeat(43);
    await store.getState().attach("auth3");
    expect(row("auth3")?.state).toBe("attached");
    expect(main.refreshed).toEqual(["auth3", "auth3"]);
});
async function liveRotation(id: string, wrong: boolean, primary = false) {
    let accepted = AUTH_TOKEN;
    const backend = authBackend((h) => h?.includes(accepted) ?? false);
    seedRow(id);
    let token = AUTH_TOKEN;
    main.attachBackend = async () => ({ ok: true, origin: backend.origin, token });
    main.refreshBackendToken = async () => {
        if (!wrong) token = NEW_AUTH_TOKEN;
        return { ok: true };
    };
    if (primary) store.setState({ primaryId: id });
    await store.getState().attach(id);
    const status: boolean[] = [];
    const off = onPrimaryStatusChange((s) => status.push(s.connected));
    cleanups.push(off);
    // Restart the real server on its existing port, as a remote backend restart does.
    accepted = NEW_AUTH_TOKEN;
    backend.stop();
    const port = Number(new URL(backend.origin).port);
    const restarted = startBackend(
        () => ({ protocolVersion: PROTOCOL_VERSION }),
        undefined,
        true,
        undefined,
        (h) => h?.includes(accepted) ?? false,
        port,
    );
    cleanups.push(restarted.stop);
    await untilAuth(
        () => main.refreshed.length > 0 && row(id)?.state === (wrong ? "offline" : "attached"),
    );
    return status;
}
test("a remote that restarts with a new token while attached refreshes once through rehandshake and reattaches", async () => {
    await liveRotation("live1", false);
    expect(main.refreshed).toEqual(["live1"]);
    expect(tokenFor("live1")).toBe(NEW_AUTH_TOKEN);
});
test("a refreshed token that is still wrong ends offline after exactly one refresh", async () => {
    await liveRotation("live2", true);
    await Bun.sleep(1100);
    expect(main.refreshed).toEqual(["live2"]);
    expect(row("live2")?.failure?.kind).toBe("unauthorized");
});
test("a detached machine's late 4401 starts no refresh", async () => {
    const backend = authBackend(() => false);
    seedRow("late-auth");
    main.attachBackend = async () => ({ ok: true, origin: backend.origin, token: AUTH_TOKEN });
    const off = onStatusChange("late-auth", (status) => {
        if (status.connected) void store.getState().detach("late-auth");
    });
    try {
        await store.getState().attach("late-auth");
        await Bun.sleep(30);
        expect(main.refreshed).toEqual([]);
    } finally {
        off();
    }
});
test("a primary remote that rotates its token is primary again after the refresh", async () => {
    const statuses = await liveRotation("live-primary", false, true);
    expect(getPrimary()).toBe("live-primary");
    expect(statuses).toContain(false);
    expect(statuses.at(-1)).toBe(true);
});

async function rejectedAutomaticRecovery() {
    await recoverySetup();
    const backend = authBackend((h) => h?.includes(NEW_AUTH_TOKEN) ?? false);
    let token = AUTH_TOKEN;
    let attaches = 0;
    main.attachBackend = async () => {
        attaches++;
        return { ok: true, origin: backend.origin, token };
    };
    emitBackendDropped("abc123", failure("ssh exited"));
    emitRemoteResume();
    await untilAuth(() => row("abc123")?.failure?.kind === "unauthorized");
    expect(main.refreshed).toEqual(["abc123"]);
    return {
        setToken(value: string) {
            token = value;
        },
        attaches: () => attaches,
    };
}

test("manual Retry can attach with a corrected token after automatic recovery was rejected", async () => {
    const recovery = await rejectedAutomaticRecovery();
    recovery.setToken(NEW_AUTH_TOKEN);
    store.getState().retry("abc123");
    await untilAuth(() => row("abc123")?.state === "attached");
    expect(tokenFor("abc123")).toBe(NEW_AUTH_TOKEN);
    expect(main.refreshed).toEqual(["abc123"]);
});

test("a later tunnel exit does not restart a machine rejected for its token", async () => {
    const recovery = await rejectedAutomaticRecovery();
    const before = recovery.attaches();
    emitBackendDropped("abc123", failure("ssh exited again"));
    emitRemoteResume();
    await Bun.sleep(50);
    expect(row("abc123")?.failure?.kind).toBe("unauthorized");
    expect(row("abc123")?.state).toBe("offline");
    expect(recovery.attaches()).toBe(before);
});

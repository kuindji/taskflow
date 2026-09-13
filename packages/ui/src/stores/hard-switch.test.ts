import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import { clearEditorDirty, setEditorDirty } from "@/components/panes/editor-dirty-state";
import { BackendDetachedError, closeConnection, sendRequest } from "@/lib/connection-registry";
import { startTestServer } from "@/lib/test-ws-server";
import type { TestServer } from "@/lib/test-ws-server";
import type {
    MachineState,
    setPrimaryBackend as SetPrimaryBackend,
    useBackendStore as UseBackendStore,
} from "./backend-store";
import {
    installFakeBridge,
    main,
    resetFakeMain,
    tunnelFailure,
    uninstallFakeBridge,
} from "./fake-desktop-bridge";

/** What each machine's backend does wrong, if anything. */
interface MachineBehaviour {
    protocolVersion?: number;
    /** Answer the project list with nothing a store can load. */
    brokenLists?: boolean;
}

const servers = new Map<string, TestServer>();

/** A backend with uid `uid`, reachable through main under `recordId`. */
function startMachine(recordId: string, uid: string, behaviour: MachineBehaviour = {}): TestServer {
    const server = startTestServer(uid, (type) => {
        if (type === MSG.SYSTEM_INFO) {
            return {
                protocolVersion: behaviour.protocolVersion ?? PROTOCOL_VERSION,
                backendUid: uid,
            };
        }
        if (type === MSG.PROJECT_LIST) return behaviour.brokenLists ? {} : { projects: [] };
        if (type === MSG.TASK_LIST) return { tasks: [] };
        return {};
    });
    servers.get(recordId)?.stop();
    servers.set(recordId, server);
    return server;
}

function systemInfoRequests(server: TestServer): number {
    return server.received.filter((request) => request.type === MSG.SYSTEM_INFO).length;
}

const dials: string[] = [];
const failure = tunnelFailure;

/** Main as Task 9's IPC layer answers it: local is never a record. */
function answerAsMain(): void {
    main.attachBackend = (id) => {
        dials.push(id);
        const server = servers.get(id);
        return Promise.resolve(
            server
                ? { ok: true, origin: server.origin }
                : { ok: false, failure: failure("no route") },
        );
    };
    main.confirmBackend = (id, info) =>
        Promise.resolve(
            id === "local" ? { id, merged: false } : { id: info.backendUid, merged: false },
        );
}

let store: typeof UseBackendStore;
let setPrimaryBackend: typeof SetPrimaryBackend;

beforeAll(async () => {
    ({ useBackendStore: store, setPrimaryBackend } = await installFakeBridge());
});

afterAll(uninstallFakeBridge);

beforeEach(answerAsMain);

afterEach(() => {
    for (const machine of store.getState().machines) closeConnection(machine.id, "detach");
    for (const server of servers.values()) server.stop();
    servers.clear();
    dials.length = 0;
    resetFakeMain();
    store.setState({ machines: [], primaryId: null });
});

function machineRow(id: string, isLocal = false): MachineState {
    return {
        id,
        displayName: id,
        host: isLocal ? "127.0.0.1" : `${id}.local`,
        instanceId: "main",
        state: "offline",
        isLocal,
        keepAttached: false,
    };
}

function row(id: string): MachineState | undefined {
    return store.getState().machines.find((m) => m.id === id);
}

function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => "resolved",
        (reason: unknown) => reason,
    );
}

/** Local attached and primary, as the provider leaves it at launch; `others` get offline rows. */
async function launch(...others: string[]): Promise<void> {
    startMachine("local", "local");
    store.setState({
        machines: [machineRow("local", true), ...others.map((id) => machineRow(id))],
    });
    setPrimaryBackend("local");
    expect(await store.getState().attach("local")).toBe("local");
    dials.length = 0;
}

describe("hard switch", () => {
    test("an already attached target keeps its connection and local is detached", async () => {
        await launch("b");
        const b = startMachine("b", "b");
        expect(await store.getState().attach("b")).toBe("b");
        const shellKey = store.getState().shellKey;
        dials.length = 0;

        expect(await store.getState().workAs("b")).toEqual({ ok: true });

        // Not dialled again and not handshaken again: the same socket.
        expect(dials).toEqual([]);
        expect(systemInfoRequests(b)).toBe(1);
        expect(await sendRequest<Record<string, never>>("b", "ping")).toEqual({});
        expect(row("b")?.state).toBe("attached");
        expect(store.getState().primaryId).toBe("b");
        expect(row("local")?.state).toBe("offline");
        expect(await outcomeOf(sendRequest("local", "ping"))).toBeInstanceOf(BackendDetachedError);
        expect(store.getState().shellKey).toBe(shellKey + 1);
    });

    test("a target that is not attached is attached, then local is detached", async () => {
        await launch("b");
        startMachine("b", "b");

        expect(await store.getState().workAs("b")).toEqual({ ok: true });

        expect(dials).toEqual(["b"]);
        expect(row("b")?.state).toBe("attached");
        expect(store.getState().primaryId).toBe("b");
        expect(row("local")?.state).toBe("offline");
        expect(await outcomeOf(sendRequest("local", "ping"))).toBeInstanceOf(BackendDetachedError);
    });

    test("a provisional target is addressed by the uid its first handshake renamed it to", async () => {
        await launch("desktop.local:main");
        startMachine("desktop.local:main", "b-uid");

        expect(await store.getState().workAs("desktop.local:main")).toEqual({ ok: true });

        expect(store.getState().machines.map((m) => [m.id, m.state])).toEqual([
            ["local", "offline"],
            ["b-uid", "attached"],
        ]);
        expect(store.getState().primaryId).toBe("b-uid");
        expect(main.detached).not.toContain("b-uid");
        expect(main.detached).not.toContain("desktop.local:main");
        expect(await sendRequest<Record<string, never>>("b-uid", "ping")).toEqual({});
    });

    test("a target whose handshake fails leaves the attached set alone", async () => {
        await launch("b");
        startMachine("b", "b", { protocolVersion: PROTOCOL_VERSION + 1 });
        const shellKey = store.getState().shellKey;

        const result = await store.getState().workAs("b");

        expect(result).toMatchObject({ ok: false, reason: "unreachable" });
        expect(row("local")?.state).toBe("attached");
        expect(store.getState().primaryId).toBe("local");
        expect(await sendRequest<Record<string, never>>("local", "ping")).toEqual({});
        expect(main.detached).not.toContain("local");
        expect(store.getState().shellKey).toBe(shellKey);
    });

    test("a refusal after attaching a target nobody wanted detaches it again", async () => {
        await launch("b");
        startMachine("b", "b");
        const answer = main.attachBackend;
        // The user edits a local file while the target's tunnel comes up.
        main.attachBackend = (id) => {
            setEditorDirty("local", "/repo/a.ts", true);
            return answer(id);
        };
        try {
            expect(await store.getState().workAs("b")).toEqual({
                ok: false,
                reason: "dirty",
                files: ["/repo/a.ts"],
            });
        } finally {
            clearEditorDirty("local", "/repo/a.ts");
        }

        expect(row("b")).toMatchObject({ state: "offline", keepAttached: false });
        expect(main.detached).toEqual(["b"]);
        expect(await outcomeOf(sendRequest("b", "ping"))).toBeInstanceOf(BackendDetachedError);
        expect(store.getState().primaryId).toBe("local");
        expect(await sendRequest<Record<string, never>>("local", "ping")).toEqual({});
    });

    test("a refusal leaves a target the user already wanted attached", async () => {
        await launch("b");
        store.setState({
            machines: store
                .getState()
                .machines.map((m) => (m.id === "b" ? { ...m, keepAttached: true } : m)),
        });
        startMachine("b", "b");
        const answer = main.attachBackend;
        main.attachBackend = (id) => {
            setEditorDirty("local", "/repo/a.ts", true);
            return answer(id);
        };
        try {
            expect(await store.getState().workAs("b")).toMatchObject({ reason: "dirty" });
        } finally {
            clearEditorDirty("local", "/repo/a.ts");
        }

        expect(row("b")).toMatchObject({ state: "attached", keepAttached: true });
        expect(main.detached).toEqual([]);
    });

    test("a refusal leaves attached a machine the target turned out to be an alias of", async () => {
        await launch("b-uid", "desktop.local:main");
        startMachine("b-uid", "b-uid");
        startMachine("desktop.local:main", "b-uid");
        expect(await store.getState().attach("b-uid")).toBe("b-uid");
        dials.length = 0;
        // The saved record handshakes as a machine already attached under its uid.
        main.confirmBackend = (id, info) =>
            Promise.resolve({ id: info.backendUid, merged: id !== info.backendUid });
        const answer = main.attachBackend;
        main.attachBackend = (id) => {
            setEditorDirty("local", "/repo/a.ts", true);
            return answer(id);
        };
        try {
            expect(await store.getState().workAs("desktop.local:main")).toMatchObject({
                reason: "dirty",
            });
        } finally {
            clearEditorDirty("local", "/repo/a.ts");
        }

        expect(row("b-uid")).toMatchObject({ state: "attached", keepAttached: true });
        expect(main.detached).not.toContain("b-uid");
        expect(await sendRequest<Record<string, never>>("b-uid", "ping")).toEqual({});
        expect(store.getState().primaryId).toBe("local");
    });

    test("a machine main fails to detach still goes offline and the switch completes", async () => {
        await launch("b", "c");
        startMachine("b", "b");
        startMachine("c", "c");
        expect(await store.getState().attach("b")).toBe("b");
        expect(await store.getState().attach("c")).toBe("c");
        const shellKey = store.getState().shellKey;
        main.detachBackend = (id) =>
            id === "c" ? Promise.reject(new Error("disk full")) : Promise.resolve();

        expect(await store.getState().workAs("b")).toEqual({ ok: true });

        expect(store.getState().primaryId).toBe("b");
        expect(row("local")?.state).toBe("offline");
        expect(row("c")).toMatchObject({ state: "offline", keepAttached: false });
        expect(store.getState().shellKey).toBe(shellKey + 1);
    });

    test("a target that attaches but cannot load its projects leaves the attached set alone", async () => {
        await launch("b");
        startMachine("b", "b", { brokenLists: true });

        const result = await store.getState().workAs("b");

        expect(result).toEqual({
            ok: false,
            reason: "unreachable",
            failure: failure("Could not load this machine's projects and tasks"),
        });
        expect(row("local")?.state).toBe("attached");
        expect(store.getState().primaryId).toBe("local");
        expect(await sendRequest<Record<string, never>>("local", "ping")).toEqual({});
    });

    test("a target main cannot reach reports main's failure", async () => {
        await launch("b");

        expect(await store.getState().workAs("b")).toEqual({
            ok: false,
            reason: "unreachable",
            failure: failure("no route"),
        });
        expect(row("local")?.state).toBe("attached");
    });

    test("an unsaved buffer on a machine being detached refuses the switch", async () => {
        await launch("b");
        startMachine("b", "b");
        expect(await store.getState().attach("b")).toBe("b");
        setEditorDirty("local", "/repo/a.ts", true);
        setEditorDirty("local", "/repo/saved.ts", false);
        try {
            expect(await store.getState().workAs("b")).toEqual({
                ok: false,
                reason: "dirty",
                files: ["/repo/a.ts"],
            });
        } finally {
            clearEditorDirty("local", "/repo/a.ts");
            clearEditorDirty("local", "/repo/saved.ts");
        }

        expect(main.detached).toEqual([]);
        expect(store.getState().primaryId).toBe("local");
        expect(await sendRequest<Record<string, never>>("local", "ping")).toEqual({});
        expect(await sendRequest<Record<string, never>>("b", "ping")).toEqual({});
    });

    test("an unsaved buffer on the target itself does not refuse the switch", async () => {
        await launch("b");
        startMachine("b", "b");
        expect(await store.getState().attach("b")).toBe("b");
        setEditorDirty("b", "/repo/a.ts", true);
        try {
            expect(await store.getState().workAs("b")).toEqual({ ok: true });
        } finally {
            clearEditorDirty("b", "/repo/a.ts");
        }
    });

    test("an unsaved buffer on the machine a target turns out to be an alias of does not refuse the switch", async () => {
        await launch("b-uid", "desktop.local:main");
        startMachine("b-uid", "b-uid");
        startMachine("desktop.local:main", "b-uid");
        expect(await store.getState().attach("b-uid")).toBe("b-uid");
        main.confirmBackend = (id, info) =>
            Promise.resolve({ id: info.backendUid, merged: id !== info.backendUid });
        setEditorDirty("b-uid", "/repo/a.ts", true);
        try {
            expect(await store.getState().workAs("desktop.local:main")).toEqual({ ok: true });
        } finally {
            clearEditorDirty("b-uid", "/repo/a.ts");
        }

        expect(store.getState().primaryId).toBe("b-uid");
        expect(row("b-uid")?.state).toBe("attached");
        expect(row("local")?.state).toBe("offline");
    });

    test("a second switch started during the first is refused as busy", async () => {
        await launch("b", "c");
        startMachine("b", "b");
        startMachine("c", "c");
        expect(await store.getState().attach("b")).toBe("b");
        expect(await store.getState().attach("c")).toBe("c");

        const switching = store.getState().workAs("b");
        expect(store.getState().switching).toBe(true);
        const results = await Promise.all([switching, store.getState().workAs("c")]);

        expect(results).toEqual([{ ok: true }, { ok: false, reason: "busy" }]);
        expect(store.getState().switching).toBe(false);
        expect(store.getState().primaryId).toBe("b");
        expect(row("b")?.state).toBe("attached");
        expect(row("c")?.state).toBe("offline");
        expect(await sendRequest<Record<string, never>>("b", "ping")).toEqual({});
        expect(await outcomeOf(sendRequest("c", "ping"))).toBeInstanceOf(BackendDetachedError);
    });

    test("returning to local reopens local through attach and detaches the remote machine", async () => {
        await launch("b");
        startMachine("b", "b");
        expect(await store.getState().workAs("b")).toEqual({ ok: true });
        expect(row("local")?.state).toBe("offline");
        expect(await outcomeOf(sendRequest("local", "ping"))).toBeInstanceOf(BackendDetachedError);
        dials.length = 0;

        expect(await store.getState().returnToLocal()).toEqual({ ok: true });

        expect(dials).toEqual(["local"]);
        expect(row("local")?.state).toBe("attached");
        expect(store.getState().primaryId).toBe("local");
        expect(await sendRequest<Record<string, never>>("local", "ping")).toEqual({});
        expect(row("b")?.state).toBe("offline");
        expect(main.detached).toContain("b");
        expect(await outcomeOf(sendRequest("b", "ping"))).toBeInstanceOf(BackendDetachedError);
    });
});

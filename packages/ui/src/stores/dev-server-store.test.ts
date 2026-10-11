import { afterEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { DevServer, DevServerStopResult } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { devServerKey, useDevServerStore } from "./dev-server-store";
import { resetBackend } from "./store-reset";

function devServer(id: string, changes: Partial<DevServer> = {}): DevServer {
    return {
        id,
        pid: 1000,
        label: `server ${id}`,
        registeredAt: "2026-10-11T10:00:00.000Z",
        projectId: "p1",
        ...changes,
    };
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the store");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const servers: TestServer[] = [];

async function attach(
    backendId: string,
    list: DevServer[],
    onStop: (payload: unknown) => DevServerStopResult | Promise<DevServerStopResult> = () => ({
        ok: true,
    }),
): Promise<TestServer> {
    const server = startTestServer(backendId, (type, payload) => {
        if (type === MSG.DEV_SERVER_LIST) return { devServers: list };
        if (type === MSG.DEV_SERVER_STOP) return onStop(payload);
        return {};
    });
    servers.push(server);
    await openConnection(backendId, server.origin);
    await useDevServerStore.getState().fetchDevServers(backendId);
    return server;
}

function keys(): string[] {
    return useDevServerStore.getState().devServers.map((d) => devServerKey(d));
}

afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
    useDevServerStore.setState({ stopStates: {} });
});

describe("dev server store", () => {
    test("lists from two backends coexist, each tagged with its backend", async () => {
        await attach("a", [devServer("1")]);
        await attach("b", [devServer("1"), devServer("2")]);

        expect(keys()).toEqual(["a:1", "b:1", "b:2"]);
    });

    test("a list broadcast replaces only that backend's rows", async () => {
        const serverA = await attach("a", [devServer("1"), devServer("2")]);
        await attach("b", [devServer("9")]);

        serverA.broadcast(MSG.DEV_SERVER_LIST, { devServers: [devServer("3")] });
        await until(() => keys().includes("a:3"));

        expect(keys()).toEqual(["a:3", "b:9"]);
    });

    test("a broadcast that lands while a fetch is in flight wins over the older response", async () => {
        let releaseList: (() => void) | undefined;
        const server = startTestServer("a", (type) => {
            if (type !== MSG.DEV_SERVER_LIST) return {};
            // The machine answers with the old list only after it broadcast a newer one.
            return new Promise((resolve) => {
                releaseList = () => resolve({ devServers: [devServer("old")] });
            });
        });
        servers.push(server);
        await openConnection("a", server.origin);

        const fetching = useDevServerStore.getState().fetchDevServers("a");
        await until(() => releaseList !== undefined);
        server.broadcast(MSG.DEV_SERVER_LIST, { devServers: [devServer("new")] });
        await until(() => keys().includes("a:new"));
        releaseList?.();
        await fetching;

        expect(keys()).toEqual(["a:new"]);
    });

    test("resetting a backend drops only its rows and its stop states", async () => {
        await attach("a", [devServer("1")]);
        await attach("b", [devServer("2")]);
        useDevServerStore.setState({
            stopStates: { "a:1": { error: "boom" }, "b:2": { error: "bang" } },
        });

        closeConnection("a", "detach");
        resetBackend("a");

        expect(keys()).toEqual(["b:2"]);
        expect(useDevServerStore.getState().stopStates).toEqual({ "b:2": { error: "bang" } });
    });

    test("a successful stop asks the record's own backend and removes the row", async () => {
        const serverA = await attach("a", [devServer("1")]);
        const serverB = await attach("b", [devServer("1")]);
        const row = useDevServerStore.getState().devServers.find((d) => d.backendId === "b");
        if (!row) throw new Error("missing row");

        await useDevServerStore.getState().stopDevServer(row);

        const stops = (server: TestServer) =>
            server.received.filter((r) => r.type === MSG.DEV_SERVER_STOP).map((r) => r.payload);
        expect(stops(serverA)).toEqual([]);
        expect(stops(serverB)).toEqual([{ id: "1" }]);
        expect(keys()).toEqual(["a:1"]);
        expect(useDevServerStore.getState().stopStates).toEqual({});
    });

    test("an ok that lands after a re-registration of the same id keeps the new row", async () => {
        let finish: ((result: DevServerStopResult) => void) | undefined;
        const server = await attach(
            "a",
            [devServer("1")],
            () =>
                new Promise<DevServerStopResult>((resolve) => {
                    finish = resolve;
                }),
        );
        const [row] = useDevServerStore.getState().devServers;
        const newer = "2026-10-11T11:00:00.000Z";

        const stopping = useDevServerStore.getState().stopDevServer(row);
        await until(() => finish !== undefined);
        server.broadcast(MSG.DEV_SERVER_LIST, {
            devServers: [devServer("1", { registeredAt: newer })],
        });
        await until(() => useDevServerStore.getState().devServers[0]?.registeredAt === newer);
        finish?.({ ok: true });
        await stopping;

        expect(useDevServerStore.getState().devServers.map((d) => d.registeredAt)).toEqual([newer]);
        expect(useDevServerStore.getState().stopStates).toEqual({});
    });

    test("a stop that settles after its backend was reset changes nothing", async () => {
        // Holder objects, not `let`: TypeScript keeps a `let` narrowed to `undefined`
        // across the callback that assigns it, and `finish?.()` then fails to compile.
        const first: { finish?: (result: DevServerStopResult) => void } = {};
        await attach(
            "a",
            [devServer("1")],
            () =>
                new Promise<DevServerStopResult>((resolve) => {
                    first.finish = resolve;
                }),
        );
        const [row] = useDevServerStore.getState().devServers;

        // Closing rejects the pending request; its catch runs after the reset.
        const failing = useDevServerStore.getState().stopDevServer(row);
        await until(() => first.finish !== undefined);
        closeConnection("a", "detach");
        resetBackend("a");
        await failing;

        expect(useDevServerStore.getState().stopStates).toEqual({});
        expect(keys()).toEqual([]);

        // An ok that lands after a reset and a refetch removes nothing either.
        const second: { finish?: (result: DevServerStopResult) => void } = {};
        const server = await attach(
            "a",
            [devServer("1")],
            () =>
                new Promise<DevServerStopResult>((resolve) => {
                    second.finish = resolve;
                }),
        );
        const stopping = useDevServerStore.getState().stopDevServer(row);
        await until(() => second.finish !== undefined);
        resetBackend("a");
        await useDevServerStore.getState().fetchDevServers("a");
        second.finish?.({ ok: true });
        await stopping;

        expect(keys()).toEqual(["a:1"]);
        expect(useDevServerStore.getState().stopStates).toEqual({});
        expect(server.received.filter((r) => r.type === MSG.DEV_SERVER_STOP)).toHaveLength(1);
    });

    test("the row reads stopping while the request is in flight", async () => {
        let finish: ((result: DevServerStopResult) => void) | undefined;
        await attach(
            "a",
            [devServer("1")],
            () =>
                new Promise<DevServerStopResult>((resolve) => {
                    finish = resolve;
                }),
        );
        const [row] = useDevServerStore.getState().devServers;

        const stopping = useDevServerStore.getState().stopDevServer(row);
        expect(useDevServerStore.getState().stopStates["a:1"]).toBe("stopping");
        await until(() => finish !== undefined);
        finish?.({ ok: true });
        await stopping;

        expect(useDevServerStore.getState().stopStates["a:1"]).toBeUndefined();
    });

    test("a failed stop keeps the row and records the backend's error", async () => {
        const error = "Could not stop pid 1000: operation not permitted";
        await attach("a", [devServer("1")], () => ({ ok: false, error }));
        const [row] = useDevServerStore.getState().devServers;

        await useDevServerStore.getState().stopDevServer(row);

        expect(keys()).toEqual(["a:1"]);
        expect(useDevServerStore.getState().stopStates["a:1"]).toEqual({ error });
    });

    test("a retry replaces the error with stopping", async () => {
        let attempts = 0;
        let finish: ((result: DevServerStopResult) => void) | undefined;
        await attach("a", [devServer("1")], () => {
            attempts++;
            if (attempts === 1) return { ok: false, error: "still running" };
            return new Promise<DevServerStopResult>((resolve) => {
                finish = resolve;
            });
        });
        const [row] = useDevServerStore.getState().devServers;
        await useDevServerStore.getState().stopDevServer(row);
        expect(useDevServerStore.getState().stopStates["a:1"]).toEqual({ error: "still running" });

        const retry = useDevServerStore.getState().stopDevServer(row);
        expect(useDevServerStore.getState().stopStates["a:1"]).toBe("stopping");
        await until(() => finish !== undefined);
        finish?.({ ok: true });
        await retry;
    });

    test("a request that rejects shows its message as the error", async () => {
        // No connection is open for "gone", so sendRequest rejects with BackendDetachedError.
        const row: Scoped<DevServer> = { ...devServer("1"), backendId: "gone" };

        await useDevServerStore.getState().stopDevServer(row);

        expect(useDevServerStore.getState().stopStates["gone:1"]).toEqual({
            error: "Backend gone was detached",
        });
        useDevServerStore.setState({ stopStates: {} });
    });

    test("clearing errors keeps stops that are still running", () => {
        useDevServerStore.setState({
            stopStates: { "a:1": { error: "boom" }, "a:2": "stopping" },
        });

        useDevServerStore.getState().clearStopErrors();

        expect(useDevServerStore.getState().stopStates).toEqual({ "a:2": "stopping" });
    });
});

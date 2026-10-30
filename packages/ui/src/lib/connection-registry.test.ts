import { BackendUnauthorizedError } from "@taskflow/shared";
import { Connection } from "./connection";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
    BackendDetachedError,
    closeConnection,
    onEvent,
    onPrimaryChange,
    onPrimaryStatusChange,
    onStatusChange,
    openConnection,
    rekeyConnection,
    sendRequest,
    setPrimary,
    tokenFor,
} from "./connection-registry";
import { startTestServer as startServer } from "./test-ws-server";

const servers: { stop(): void }[] = [];
afterEach(() => {
    closeConnection("a", "detach");
    closeConnection("b", "detach");
    servers.splice(0).forEach((s) => s.stop());
});

describe("connection registry", () => {
    test("routes a request to the named backend and nowhere else", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);
        setPrimary("a");

        expect(await sendRequest<{ from: string }>("a", "ping")).toEqual({ from: "A" });
        expect(await sendRequest<{ from: string }>("b", "ping")).toEqual({ from: "B" });
    });

    test("an event handler learns which backend delivered it", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);

        const seen: string[] = [];
        const off = onEvent("thing", (_payload, backendId) => seen.push(backendId));
        b.broadcast("thing");
        await new Promise((resolve) => setTimeout(resolve, 200));
        off();

        expect(seen).toEqual(["b"]);
    });

    test("closing one backend rejects only its pending requests", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        // A request that will never be answered, because we close first.
        const pending = sendRequest("a", "never");
        closeConnection("a", "detach");

        const error = await pending.then(
            () => null,
            (reason: unknown) => reason,
        );
        expect(error).toBeInstanceOf(BackendDetachedError);
    });

    test("primary changes are observable, including through a rekey", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        const seen: (string | null)[] = [];
        const off = onPrimaryChange((id) => seen.push(id));
        setPrimary("a");
        rekeyConnection("a", "a-uid");
        off();
        closeConnection("a-uid", "detach");

        expect(seen).toEqual(["a", "a-uid"]);
    });

    test("closing a connection that is still opening rejects the open", async () => {
        const a = startServer("A");
        servers.push(a);

        const opening = openConnection("a", a.origin);
        closeConnection("a", "detach");

        const outcome = await Promise.race([
            opening.then(
                () => "resolved",
                (reason: unknown) => reason,
            ),
            new Promise((resolve) => setTimeout(() => resolve("still pending"), 1000)),
        ]);
        expect(outcome).toBeInstanceOf(BackendDetachedError);
    });

    test("a rekey keeps the status subscribers already waiting under the new id", async () => {
        const a = startServer("A");
        servers.push(a);

        const seen: boolean[] = [];
        const off = onStatusChange("a-uid", (status) => seen.push(status.connected));
        await openConnection("a", a.origin);
        const offProvisional = onStatusChange("a", () => {});
        rekeyConnection("a", "a-uid");
        closeConnection("a-uid", "detach");
        off();
        offProvisional();

        // The initial "not connected", the rekeyed connection's live status,
        // then its close.
        expect(seen).toEqual([false, true, false]);
    });

    test("unsubscribing after a rekey stops the status updates", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        const seen: boolean[] = [];
        const off = onStatusChange("a", (status) => seen.push(status.connected));
        rekeyConnection("a", "a-uid");
        off();
        closeConnection("a-uid", "detach");

        // Only the status replayed on subscribe.
        expect(seen).toEqual([true]);
    });

    test("primary's status subscription follows primary as it changes", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);
        await openConnection("a", a.origin);

        // Subscribed before anything is primary, as the provider does on mount.
        const seen: boolean[] = [];
        const off = onPrimaryStatusChange((status) => seen.push(status.connected));
        setPrimary("a");
        await openConnection("b", b.origin);
        // A status change on a machine that is not primary is not primary's.
        closeConnection("b", "detach");
        closeConnection("a", "detach");
        off();

        // Not connected, a's live status, then a's close (which also clears primary).
        expect(seen).toEqual([false, true, false, false]);
    });
});

test("a connection opened with a token offers taskflow then taskflow.auth.<token>", async () => {
    const a = startServer("A");
    servers.push(a);
    const token = "T".repeat(43);
    await openConnection("a", a.origin, token);
    expect(a.offeredProtocols).toEqual([`taskflow, taskflow.auth.${token}`]);
});

test("a connection opened without a token offers no subprotocol", async () => {
    const a = startServer("A");
    servers.push(a);
    await openConnection("a", a.origin);
    expect(a.offeredProtocols).toEqual([null]);
});

test("tokenFor returns the token a backend was opened with, and null once it is closed", async () => {
    const a = startServer("A");
    servers.push(a);
    expect(tokenFor("a")).toBeNull();
    await openConnection("a", a.origin, "TOKEN");
    expect(tokenFor("a")).toBe("TOKEN");
    closeConnection("a", "detach");
    expect(tokenFor("a")).toBeNull();
});

function startTestServer(options: { rejectAll?: boolean } = {}) {
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            open(ws) {
                if (options.rejectAll) ws.close(4401, "unauthorized");
            },
            message() {},
        },
    });
    const result = {
        origin: `http://127.0.0.1:${server.port}`,
        stop: () => void server.stop(true),
    };
    servers.push(result);
    return result;
}
test("a 4401 close after open rejects the pending request with BackendUnauthorizedError", async () => {
    const server = startTestServer({ rejectAll: true });
    let pending: Promise<unknown> = Promise.resolve("no request");
    const connection = new Connection("a", server.origin, {
        onEvent() {},
        onStatus(status) {
            if (status.connected)
                pending = connection.sendRequest("never", {}).catch((error: unknown) => error);
        },
    });
    try {
        await connection.open();
        expect(await pending).toBeInstanceOf(BackendUnauthorizedError);
    } finally {
        connection.close(new Error("cleanup"));
    }
});
test("after a 4401 close a new request rejects with BackendUnauthorizedError", async () => {
    const server = startTestServer({ rejectAll: true });
    await openConnection("a", server.origin);
    await Bun.sleep(30);
    expect(await sendRequest("a", "ping").catch((error: unknown) => error)).toBeInstanceOf(
        BackendUnauthorizedError,
    );
});
test("a 4401 close does not reconnect", async () => {
    const server = startTestServer({ rejectAll: true });
    const statuses: boolean[] = [];
    const off = onStatusChange("a", (status) => statuses.push(status.reconnecting));
    try {
        await openConnection("a", server.origin);
        await Bun.sleep(1150);
        expect(statuses).not.toContain(true);
    } finally {
        off();
    }
});

test("a longer request timeout stays pending after 30 seconds and rejects at its own deadline", async () => {
    const server = startTestServer();
    await openConnection("a", server.origin);
    const realSetTimeout = globalThis.setTimeout;
    const timers: { delay: number; fire(): void }[] = [];
    const controlledSetTimeout = Object.assign(
        (callback: () => void, delay?: number) => {
            const timer = realSetTimeout(callback, 1_000_000);
            timers.push({
                delay: delay ?? 0,
                fire: () => {
                    clearTimeout(timer);
                    callback();
                },
            });
            return timer;
        },
        { __promisify__: realSetTimeout.__promisify__ },
    );
    const clock = spyOn(globalThis, "setTimeout").mockImplementation(
        controlledSetTimeout as typeof setTimeout,
    );
    try {
        let settled = false;
        const pending = sendRequest("a", "never", {}, 300_000).catch((error: unknown) => {
            settled = true;
            return error;
        });
        for (const timer of timers.filter((timer) => timer.delay <= 30_000)) timer.fire();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(timers.map((timer) => timer.delay)).toEqual([300_000]);
        for (const timer of timers.filter(
            (timer) => timer.delay > 30_000 && timer.delay <= 300_000,
        ))
            timer.fire();
        expect(await pending).toEqual(new Error("Request timeout: never"));
    } finally {
        closeConnection("a", "detach");
        clock.mockRestore();
    }
});

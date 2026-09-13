import { afterEach, describe, expect, test } from "bun:test";
import {
    BackendDetachedError,
    closeConnection,
    onEvent,
    onPrimaryChange,
    onStatusChange,
    openConnection,
    rekeyConnection,
    sendRequest,
    setPrimary,
} from "./connection-registry";

/** A minimal WS server that answers every request with its own label. */
function startServer(label: string): {
    origin: string;
    stop(): void;
    broadcast(type: string): void;
} {
    const sockets = new Set<{ send(data: string): void }>();
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            open(ws) {
                sockets.add(ws);
            },
            close(ws) {
                sockets.delete(ws);
            },
            message(ws, raw) {
                const request = JSON.parse(String(raw)) as { correlationId?: string; type: string };
                if (!request.correlationId) return;
                ws.send(
                    JSON.stringify({
                        correlationId: request.correlationId,
                        type: request.type,
                        payload: { from: label },
                    }),
                );
            },
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        stop: () => void server.stop(true),
        broadcast: (type: string) => {
            for (const ws of sockets) ws.send(JSON.stringify({ type, payload: { from: label } }));
        },
    };
}

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

        // The initial "not connected", then the close of the rekeyed connection.
        expect(seen).toEqual([false, false]);
    });
});

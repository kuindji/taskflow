import { describe, test, expect, afterEach } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { BackendUnauthorizedError } from "@taskflow/shared";
import { WsClient } from "./client";

const servers: Server<unknown>[] = [];
const clients: WsClient[] = [];
const accepted: ServerWebSocket<unknown>[] = [];

const originalHost = process.env.TASKFLOW_HOST;

afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    accepted.length = 0;
    for (const server of servers) await server.stop(true);
    servers.length = 0;
    if (originalHost === undefined) delete process.env.TASKFLOW_HOST;
    else process.env.TASKFLOW_HOST = originalHost;
});

function makeClient(port: number, token: string | null = null): WsClient {
    const client = new WsClient(port, null, token);
    clients.push(client);
    return client;
}

function startMalformedServer(): number {
    const server: Server<unknown> = Bun.serve({
        port: 0,
        fetch(req, s) {
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            message(ws, raw) {
                const req = JSON.parse(String(raw)) as { correlationId: string; type: string };
                ws.send("this is not json");
                ws.send(
                    JSON.stringify({
                        correlationId: req.correlationId,
                        type: req.type,
                        payload: { ok: true },
                    }),
                );
            },
        },
    });
    servers.push(server);
    return server.port ?? 0;
}

function startEchoServer(authorizations: (string | null)[] = []): number {
    const server: Server<unknown> = Bun.serve({
        port: 0,
        fetch(req, s) {
            authorizations.push(req.headers.get("authorization"));
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            open(ws) {
                accepted.push(ws);
            },
            message(ws, raw) {
                const req = JSON.parse(String(raw)) as {
                    correlationId: string;
                    type: string;
                    payload: unknown;
                };
                if (req.type === "boom") {
                    ws.send(
                        JSON.stringify({
                            correlationId: req.correlationId,
                            type: req.type,
                            payload: null,
                            error: "exploded",
                        }),
                    );
                    return;
                }
                ws.send(
                    JSON.stringify({
                        correlationId: req.correlationId,
                        type: req.type,
                        payload: { echo: req.payload },
                    }),
                );
                ws.send(JSON.stringify({ type: "note", payload: { n: 1 } }));
            },
        },
    });
    servers.push(server);
    return server.port ?? 0;
}

describe("WsClient", () => {
    test("dials the host the backend bound, not a hardcoded IPv4 literal", async () => {
        // TASKFLOW_HOST=::1 is the escape hatch for a machine where `localhost`
        // resolves to `::1` alone. The backend inherits this environment through
        // startBackend, so a client pinned to 127.0.0.1 can never reach it.
        const server: Server<unknown> = Bun.serve({
            port: 0,
            hostname: "::1",
            fetch(req, s) {
                if (s.upgrade(req, { data: {} })) return undefined;
                return new Response("no");
            },
            websocket: {
                message() {
                    // The handshake is the whole assertion.
                },
            },
        });
        servers.push(server);
        process.env.TASKFLOW_HOST = "::1";
        const client = makeClient(server.port ?? 0);
        const statuses: boolean[] = [];
        client.onStatusChange((status) => statuses.push(status.connected));
        await client.connect();
        expect(statuses).toEqual([true]);
    });

    test("resolves a request with its correlated response", async () => {
        const client = makeClient(startEchoServer());
        await client.connect();
        const result = await client.request<{ echo: unknown }>("hello", { a: 1 });
        expect(result).toEqual({ echo: { a: 1 } });
    });

    test("rejects when the response carries an error", async () => {
        const client = makeClient(startEchoServer());
        await client.connect();
        let message: string | null = null;
        try {
            await client.request("boom");
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe("exploded");
    });

    test("delivers events to subscribers and stops after unsubscribe", async () => {
        const client = makeClient(startEchoServer());
        await client.connect();
        const seen: unknown[] = [];
        const off = client.on("note", (payload) => {
            seen.push(payload);
        });
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toEqual([{ n: 1 }]);
        off();
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toHaveLength(1);
    });

    test("ignores a frame that is not JSON and still resolves the request", async () => {
        const client = makeClient(startMalformedServer());
        await client.connect();
        const result = await client.request<{ ok: boolean }>("hello", {});
        expect(result).toEqual({ ok: true });
    });

    test("connect() settles when close() happens before the socket opens", async () => {
        const client = makeClient(startEchoServer());
        const connecting = client.connect();
        client.close();
        let settled = false;
        const mark = (): void => {
            settled = true;
        };
        await Promise.race([connecting.then(mark, mark), Bun.sleep(500)]);
        expect(settled).toBe(true);
    });

    test("close() reports the disconnect to status listeners", async () => {
        const client = makeClient(startEchoServer());
        const seen: boolean[] = [];
        client.onStatusChange(({ connected }) => {
            seen.push(connected);
        });
        await client.connect();
        client.close();
        expect(seen).toEqual([true, false]);
    });

    test("retarget() on a connected client closes the socket and redials the new port", async () => {
        const client = makeClient(startEchoServer());
        await client.connect();
        const seen: boolean[] = [];
        const reconnected = new Promise<void>((resolve) => {
            client.onStatusChange(({ connected }) => {
                seen.push(connected);
                if (connected) resolve();
            });
        });
        // The malformed server answers every request with `{ ok: true }`, which
        // the echo server never does, so the reply proves which port was dialled.
        client.retarget(startMalformedServer(), null, null);
        expect(seen).toEqual([false]);
        await Promise.race([reconnected, Bun.sleep(2_000)]);
        expect(seen).toEqual([false, true]);
        const result = await client.request<{ ok: boolean }>("hello", {});
        expect(result).toEqual({ ok: true });
    });

    test("a socket superseded by a new connect() no longer delivers events", async () => {
        const client = makeClient(startEchoServer());
        await client.connect();
        const seen: unknown[] = [];
        client.on("note", (payload) => {
            seen.push(payload);
        });
        const first = accepted[0];
        await client.connect();
        await Bun.sleep(20);
        first?.send(JSON.stringify({ type: "note", payload: { stale: true } }));
        await Bun.sleep(30);
        expect(seen).toEqual([]);
    });
});

test("a client given a token sends Authorization: Bearer <token> on the upgrade", async () => {
    const authorizations: (string | null)[] = [];
    const client = makeClient(startEchoServer(authorizations), "T".repeat(43));
    await client.connect();
    expect(authorizations).toEqual([`Bearer ${"T".repeat(43)}`]);
});

test("a client without a token sends no Authorization header", async () => {
    const authorizations: (string | null)[] = [];
    const client = makeClient(startEchoServer(authorizations));
    await client.connect();
    expect(authorizations).toEqual([null]);
});

test("a reconnect after a drop sends the token again", async () => {
    const authorizations: (string | null)[] = [];
    const client = makeClient(startEchoServer(authorizations), "T".repeat(43));
    await client.connect();
    const reconnected = new Promise<void>((resolve) => {
        client.onStatusChange(({ connected }) => {
            if (connected) resolve();
        });
    });
    accepted[0].close();
    await Promise.race([reconnected, Bun.sleep(2000)]);
    expect(client.isConnected()).toBe(true);
    expect(authorizations).toEqual([`Bearer ${"T".repeat(43)}`, `Bearer ${"T".repeat(43)}`]);
});

function startAuthServer(
    acceptedToken: string | null,
    authorizations: (string | null)[] = [],
): number {
    const server = Bun.serve<{ accepted: boolean }>({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, server) {
            const authorization = req.headers.get("authorization");
            authorizations.push(authorization);
            return server.upgrade(req, {
                data: {
                    accepted: acceptedToken !== null && authorization === `Bearer ${acceptedToken}`,
                },
            })
                ? undefined
                : new Response("no");
        },
        websocket: {
            open(ws) {
                if (!ws.data.accepted) ws.close(4401, "unauthorized");
            },
            message(ws, raw) {
                if (ws.data.accepted) {
                    const req = JSON.parse(String(raw)) as { correlationId: string };
                    ws.send(
                        JSON.stringify({ correlationId: req.correlationId, payload: { ok: true } }),
                    );
                }
            },
        },
    });
    servers.push(server as Server<unknown>);
    return server.port ?? 0;
}
test("a 4401 close after open rejects the pending request with BackendUnauthorizedError and does not redial", async () => {
    const authorizations: (string | null)[] = [];
    const client = makeClient(startAuthServer(null, authorizations));
    let pending: Promise<unknown> = Promise.resolve("no request");
    client.onStatusChange((s) => {
        if (s.connected) pending = client.request("never").catch((error: unknown) => error);
    });
    await client.connect();
    expect(await pending).toBeInstanceOf(BackendUnauthorizedError);
    expect(await client.request("later").catch((error: unknown) => error)).toBeInstanceOf(
        BackendUnauthorizedError,
    );
    await Bun.sleep(600);
    expect(authorizations).toHaveLength(1);
});
test("wasUnauthorized is set by a 4401 and cleared by the next successful open", async () => {
    const client = makeClient(startAuthServer(null));
    await client.connect();
    await Bun.sleep(20);
    expect(client.wasUnauthorized()).toBe(true);
    client.retarget(startAuthServer("a".repeat(43)), "127.0.0.1", "a".repeat(43));
    await Bun.sleep(350);
    expect(client.isConnected()).toBe(true);
    expect(client.wasUnauthorized()).toBe(false);
});
test("retarget with a new token redials an unauthorized client and sends the new token", async () => {
    const token = "b".repeat(43);
    const headers: (string | null)[] = [];
    const port = startAuthServer(token, headers);
    const client = makeClient(port, "a".repeat(43));
    await client.connect();
    await Bun.sleep(20);
    client.retarget(port, "127.0.0.1", token);
    await Bun.sleep(350);
    expect(await client.request<{ ok: boolean }>("ping")).toEqual({ ok: true });
    expect(headers).toEqual([`Bearer ${"a".repeat(43)}`, `Bearer ${token}`]);
});

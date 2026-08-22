import { describe, test, expect, afterEach } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { WsClient } from "./client";

const servers: Server<unknown>[] = [];
const clients: WsClient[] = [];
const accepted: ServerWebSocket<unknown>[] = [];

afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    accepted.length = 0;
    for (const server of servers) await server.stop(true);
    servers.length = 0;
});

function makeClient(port: number): WsClient {
    const client = new WsClient(port);
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

function startEchoServer(): number {
    const server: Server<unknown> = Bun.serve({
        port: 0,
        fetch(req, s) {
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

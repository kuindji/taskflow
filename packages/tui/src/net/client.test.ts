import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "bun";
import { WsClient } from "./client";

let server: Server<unknown> | null = null;

afterEach(async () => {
    await server?.stop(true);
    server = null;
});

function startMalformedServer(): number {
    server = Bun.serve({
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
    return server.port ?? 0;
}

function startEchoServer(): number {
    server = Bun.serve({
        port: 0,
        fetch(req, s) {
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
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
    return server.port ?? 0;
}

describe("WsClient", () => {
    test("resolves a request with its correlated response", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        const result = await client.request<{ echo: unknown }>("hello", { a: 1 });
        expect(result).toEqual({ echo: { a: 1 } });
        client.close();
    });

    test("rejects when the response carries an error", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        let message: string | null = null;
        try {
            await client.request("boom");
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe("exploded");
        client.close();
    });

    test("delivers events to subscribers and stops after unsubscribe", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        const seen: unknown[] = [];
        const off = client.on("note", (payload) => seen.push(payload));
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toEqual([{ n: 1 }]);
        off();
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toHaveLength(1);
        client.close();
    });

    test("ignores a frame that is not JSON and still resolves the request", async () => {
        const client = new WsClient(startMalformedServer());
        await client.connect();
        const result = await client.request<{ ok: boolean }>("hello", {});
        expect(result).toEqual({ ok: true });
        client.close();
    });
});

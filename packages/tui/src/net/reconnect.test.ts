import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "bun";
import { WsClient } from "./client";

let server: Server<unknown> | null = null;
let client: WsClient | null = null;
/** Every upgrade the current server has accepted, so a retry loop is visible to a test. */
let opened = 0;

afterEach(async () => {
    client?.close();
    client = null;
    await server?.stop(true);
    server = null;
    opened = 0;
});

function serveOn(port: number): Server<unknown> {
    return Bun.serve({
        port,
        fetch(req, s) {
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            open() {
                opened++;
            },
            message(ws, raw) {
                const req = JSON.parse(String(raw)) as { correlationId: string; type: string };
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
}

describe("WsClient reconnection", () => {
    test("reports disconnect and reconnects when the server returns", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;

        client = new WsClient(port);
        await client.connect();

        const states: boolean[] = [];
        client.onStatusChange((status) => {
            states.push(status.connected);
        });

        await server.stop(true);
        await Bun.sleep(150);
        expect(states).toContain(false);

        server = serveOn(port);
        await Bun.sleep(2000);
        expect(states).toContain(true);

        const result = await client.request<{ ok: boolean }>("ping");
        expect(result.ok).toBe(true);
    }, 15_000);

    test("stops reconnecting after close", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;
        client = new WsClient(port);
        await client.connect();
        client.close();

        await server.stop(true);
        await Bun.sleep(300);
        let message: string | null = null;
        try {
            await client.request("ping");
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe("Not connected");
    });

    test("does not dial again after close, even once the server is back", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;
        client = new WsClient(port);
        await client.connect();
        expect(opened).toBe(1);

        await server.stop(true);
        client.close();

        server = serveOn(port);
        // The count so far belongs to the connect above; only the new server's
        // upgrades are evidence of a retry loop.
        opened = 0;
        await Bun.sleep(1500);
        expect(opened).toBe(0);
    }, 15_000);
});

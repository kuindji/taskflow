import { describe, test, expect, afterEach } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { WsClient } from "./client";

let server: Server<unknown> | null = null;
let client: WsClient | null = null;
/** Every upgrade the current server has accepted, so a retry loop is visible to a test. */
let opened = 0;
/** The most recent accepted socket, so a test can drop one client without stopping the server. */
let accepted: ServerWebSocket<unknown> | null = null;
/** Held before the upgrade, so a test can catch a dial while it is still CONNECTING. */
let upgradeDelayMs = 0;

afterEach(async () => {
    client?.close();
    client = null;
    await server?.stop(true);
    server = null;
    opened = 0;
    accepted = null;
    upgradeDelayMs = 0;
});

function serveOn(port: number): Server<unknown> {
    return Bun.serve({
        port,
        async fetch(req, s) {
            if (upgradeDelayMs > 0) await Bun.sleep(upgradeDelayMs);
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            open(ws) {
                opened++;
                accepted = ws;
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

    test("a connect() made from inside the disconnect notification is not replaced by the retry", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;
        client = new WsClient(port);
        await client.connect();

        // A status-driven caller redials the moment it is told the link is down,
        // which lands synchronously inside the close handler that is about to arm
        // a retry. The server itself stays up, so this dial succeeds.
        const net = client;
        let redialled = false;
        client.onStatusChange(({ connected }) => {
            if (connected || redialled) return;
            redialled = true;
            void net.connect().catch(() => undefined);
        });

        accepted?.close();
        await Bun.sleep(150);
        expect(redialled).toBe(true);

        const states: boolean[] = [];
        client.onStatusChange((status) => {
            states.push(status.connected);
        });
        // Long enough for a retry armed by the close above (250ms) to fire.
        await Bun.sleep(800);

        // A retry armed after the redial had already taken over would tear the
        // live socket down as "Connection replaced".
        expect(states).toEqual([]);
        const result = await net.request<{ ok: boolean }>("ping");
        expect(result.ok).toBe(true);
    }, 15_000);

    test("a retry armed by a superseded dial does not replace the dial that superseded it", async () => {
        // Long enough that a dial can be caught mid-handshake.
        upgradeDelayMs = 600;
        server = serveOn(0);
        const port = server.port ?? 0;
        client = new WsClient(port);
        await client.connect();

        // Let the retry loop's own dial get as far as CONNECTING, then dial by
        // hand on top of it. The superseded dial rejects as "Connection
        // replaced", which must not be mistaken for a failed retry.
        accepted?.close();
        await Bun.sleep(300);

        const errors: string[] = [];
        await client.connect().catch((error: unknown) => {
            errors.push(error instanceof Error ? error.message : String(error));
        });
        // A retry rearmed behind this dial fires mid-handshake and tears it down,
        // so the caller is told its connection was replaced by nothing.
        expect(errors).toEqual([]);
    }, 15_000);

    test("a manual connect cancels the armed retry instead of being replaced by it", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;
        client = new WsClient(port);
        await client.connect();

        // Drop the socket so onclose arms a retry, then dial again by hand
        // before that timer can fire.
        await server.stop(true);
        await Bun.sleep(50);
        server = serveOn(port);
        await client.connect();

        const states: boolean[] = [];
        client.onStatusChange((status) => {
            states.push(status.connected);
        });
        // Long enough for the retry armed above (250ms) to fire.
        await Bun.sleep(800);

        // A stale timer that still dials would tear this live socket down as
        // "Connection replaced", reporting a disconnect the user never had.
        expect(states).toEqual([]);
        const result = await client.request<{ ok: boolean }>("ping");
        expect(result.ok).toBe(true);
    }, 15_000);
});

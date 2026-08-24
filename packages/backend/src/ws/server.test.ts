import { describe, test, expect, afterEach } from "bun:test";
import { MSG } from "@taskflow/shared";
import { Router } from "./router";
import { createServer } from "./server";

let stop: (() => void) | null = null;
const originalHost = process.env.TASKFLOW_HOST;

afterEach(() => {
    stop?.();
    stop = null;
    if (originalHost === undefined) delete process.env.TASKFLOW_HOST;
    else process.env.TASKFLOW_HOST = originalHost;
});

async function startTestServer(): Promise<number> {
    const router = new Router();
    router.register("ping", () => Promise.resolve({ ok: true }));
    const server = createServer(router, 0);
    const started = await server.start();
    stop = started.stop;
    return started.port;
}

function connect(port: number, host = "127.0.0.1"): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}:${port}`);
        ws.onopen = () => {
            resolve(ws);
        };
        ws.onerror = () => {
            reject(new Error("connect failed"));
        };
    });
}

describe("createServer", () => {
    test("accepts connections on loopback", async () => {
        const port = await startTestServer();
        const ws = await connect(port);
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
    });

    test("broadcasts the connected client count as clients join and leave", async () => {
        const port = await startTestServer();
        const first = await connect(port);

        // `first` was counted on its own `open`, so that broadcast is already in flight.
        // Draining it here keeps the assertions below about the join and the leave only.
        const counts: number[] = [];
        first.onmessage = (event: MessageEvent) => {
            const parsed = JSON.parse(String(event.data)) as {
                type?: string;
                payload?: { count?: number };
            };
            if (parsed.type === MSG.SYSTEM_CLIENTS && typeof parsed.payload?.count === "number") {
                counts.push(parsed.payload.count);
            }
        };

        await Bun.sleep(50);
        counts.length = 0;

        const second = await connect(port);
        await Bun.sleep(50);
        expect(counts).toEqual([2]);

        counts.length = 0;
        second.close();
        await Bun.sleep(50);
        expect(counts).toEqual([1]);
        first.close();
    });

    test("refuses to start on a host that is not loopback", async () => {
        // TASKFLOW_HOST is an escape hatch for `localhost` resolving to `::1` only.
        // It must not double as a way to publish the unauthenticated backend, so a
        // wildcard or LAN address has to fail the bind rather than open the socket.
        process.env.TASKFLOW_HOST = "0.0.0.0";
        const router = new Router();
        const server = createServer(router, 0);

        let message: string | null = null;
        try {
            // Assigned so afterEach can close the socket if the bind is ever allowed.
            stop = (await server.start()).stop;
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }

        expect(message).toMatch(/loopback/);
    });
});

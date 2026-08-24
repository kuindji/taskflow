import { describe, test, expect, afterEach } from "bun:test";
import { MSG } from "@taskflow/shared";
import { Router } from "./router";
import { createServer } from "./server";

let stop: (() => void) | null = null;

afterEach(() => {
    stop?.();
    stop = null;
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

    test("broadcasts the connected client count as clients join", async () => {
        const port = await startTestServer();
        const first = await connect(port);

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

        const second = await connect(port);
        await Bun.sleep(50);
        expect(counts).toContain(2);

        second.close();
        await Bun.sleep(50);
        expect(counts).toContain(1);
        first.close();
    });
});

import { describe, test, expect, afterEach } from "bun:test";
import { MSG } from "@taskflow/shared";
import { Router } from "./router";
import { createServer } from "./server";
import { ApiRouter } from "../api/router";
import { parseUiOrigins, type ServerAuth } from "./auth";

// DOM typings omit Bun's supported custom-header constructor.
const BunWebSocket = WebSocket as typeof WebSocket & {
    new (url: string, options?: string | string[] | Bun.WebSocketOptions): WebSocket;
};

const T = "A".repeat(43);
function testAuth(enforce = false, lines: string[] = []): ServerAuth {
    return {
        token: T,
        allowedOrigins: parseUiOrigins(undefined),
        enforce,
        log: (line) => lines.push(line),
    };
}

let stop: (() => void) | null = null;
const originalHost = process.env.TASKFLOW_HOST;

afterEach(() => {
    stop?.();
    stop = null;
    if (originalHost === undefined) delete process.env.TASKFLOW_HOST;
    else process.env.TASKFLOW_HOST = originalHost;
});

async function startTestServer(auth = testAuth()): Promise<{
    port: number;
    clientCount: () => number;
}> {
    const router = new Router();
    router.register("ping", () => Promise.resolve({ ok: true }));
    const server = createServer(router, 0, undefined, undefined, auth);
    const started = await server.start();
    stop = started.stop;
    return { port: started.port, clientCount: server.clientCount };
}

function connect(
    port: number,
    options?: string | string[] | { headers: Record<string, string> },
    host = "127.0.0.1",
): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new BunWebSocket(`ws://${host}:${port}`, options);
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
        const { port } = await startTestServer();
        const ws = await connect(port);
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
    });

    test("broadcasts the connected client count as clients join and leave", async () => {
        const { port } = await startTestServer();
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

    test("reports the live client count to anything that asks", async () => {
        // A client cannot hear the broadcast announcing its own arrival — that
        // frame reaches it in the same turn as the socket open, before it has
        // subscribed to anything — so the count has to be readable on demand.
        const { port, clientCount } = await startTestServer();
        expect(clientCount()).toBe(0);

        const first = await connect(port);
        await Bun.sleep(50);
        expect(clientCount()).toBe(1);

        const second = await connect(port);
        await Bun.sleep(50);
        expect(clientCount()).toBe(2);

        second.close();
        await Bun.sleep(50);
        expect(clientCount()).toBe(1);
        first.close();
    });

    test("releases what a request acquired after its socket had already closed", async () => {
        // A FILE_WATCH still validating its path when the client drops registers the
        // watch after `close` has fired; without a second disconnect it runs forever.
        const router = new Router();
        const held = new Set<string>();
        let openGate: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            openGate = resolve;
        });
        let received: () => void = () => {};
        const requestArrived = new Promise<void>((resolve) => {
            received = resolve;
        });
        router.register("acquire", async (_payload, ctx) => {
            received();
            await gate;
            held.add(ctx.clientId);
            return { ok: true };
        });
        const server = createServer(router, 0, undefined, undefined, testAuth());
        server.onDisconnect((clientId) => held.delete(clientId));
        const started = await server.start();
        stop = started.stop;

        const ws = await connect(started.port);
        ws.send(JSON.stringify({ type: "acquire", payload: {}, correlationId: "1" }));
        await requestArrived;
        ws.close();
        await Bun.sleep(50);

        openGate();
        await Bun.sleep(50);
        expect(held.size).toBe(0);
    });

    test("refuses to start on a host that is not loopback", async () => {
        // TASKFLOW_HOST is an escape hatch for `localhost` resolving to `::1` only.
        // It must not double as a way to publish the unauthenticated backend, so a
        // wildcard or LAN address has to fail the bind rather than open the socket.
        process.env.TASKFLOW_HOST = "0.0.0.0";
        const router = new Router();
        const server = createServer(router, 0, undefined, undefined, testAuth());

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

async function rejectedSocket(
    port: number,
    protocols?: string[],
    sendOnOpen = false,
): Promise<{ ws: WebSocket; closed: CloseEvent }> {
    const ws = new BunWebSocket(`ws://127.0.0.1:${port}`, protocols);
    const closed = await new Promise<CloseEvent>((resolve, reject) => {
        ws.onclose = resolve;
        ws.onerror = () => reject(new Error("upgrade failed"));
        ws.onopen = () => {
            if (sendOnOpen)
                ws.send(JSON.stringify({ type: "rejected", payload: {}, correlationId: "1" }));
        };
    });
    return { ws, closed };
}

describe("request authentication", () => {
    test("report-only: a socket without a credential still connects, counts as a client, and is logged once", async () => {
        const lines: string[] = [];
        const { port, clientCount } = await startTestServer(testAuth(false, lines));
        const ws = await connect(port);
        expect(clientCount()).toBe(1);
        expect(lines).toEqual(["[auth] report-only: would reject (credential) WS / from ua=none"]);
        ws.close();
    });
    test("report-only: two identical rejected requests log one line", async () => {
        const lines: string[] = [];
        const { port } = await startTestServer(testAuth(false, lines));
        for (let i = 0; i < 2; i++) {
            const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
                headers: { "User-Agent": "node/22" },
            });
            expect(res.status).toBe(200);
            await res.text();
        }
        expect(lines).toEqual([
            "[auth] report-only: would reject (credential) GET /api/settings from ua=node",
        ]);
    });
    test("report-only: a request from a foreign Origin is served and logged with reason origin", async () => {
        const lines: string[] = [];
        const { port } = await startTestServer(testAuth(false, lines));
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { Origin: "https://evil.example" },
        });
        expect(res.status).toBe(200);
        await res.text();
        expect(lines).toEqual([
            "[auth] report-only: would reject (origin) GET /api/settings from origin=https://evil.example",
        ]);
    });
    for (const protocols of [
        ["taskflow", `taskflow.auth.${T}`],
        [`taskflow.auth.${T}`, "taskflow"],
    ]) {
        test(`a client offering ${protocols[0]} first gets protocol taskflow and no log line`, async () => {
            const lines: string[] = [];
            const { port } = await startTestServer(testAuth(false, lines));
            const ws = await connect(port, protocols);
            expect(ws.protocol).toBe("taskflow");
            expect(lines).toEqual([]);
            ws.close();
        });
    }
    test("a Bearer header on the upgrade connects with no log line", async () => {
        const lines: string[] = [];
        const { port } = await startTestServer(testAuth(false, lines));
        const ws = await connect(port, { headers: { Authorization: `Bearer ${T}` } });
        expect(lines).toEqual([]);
        ws.close();
    });
    test("GET / answers Taskflow backend with no credential and no log line", async () => {
        const lines: string[] = [];
        const { port } = await startTestServer(testAuth(true, lines));
        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(await res.text()).toBe("Taskflow backend");
        expect(lines).toEqual([]);
    });
    test("enforced: an upgrade without a credential closes with 4401 unauthorized and never counts as a client", async () => {
        let connects = 0;
        let disconnects = 0;
        const server = createServer(new Router(), 0, undefined, undefined, testAuth(true));
        server.onConnect(() => connects++);
        server.onDisconnect(() => disconnects++);
        const started = await server.start();
        stop = started.stop;
        const { closed } = await rejectedSocket(started.port);
        expect(closed.code).toBe(4401);
        expect(closed.reason).toBe("unauthorized");
        expect(server.clientCount()).toBe(0);
        expect(connects).toBe(0);
        expect(disconnects).toBe(0);
    });
    test("enforced: a wrong token in the subprotocol closes with 4401, and the protocol answer is still taskflow", async () => {
        const { port, clientCount } = await startTestServer(testAuth(true));
        const { ws, closed } = await rejectedSocket(port, [
            "taskflow",
            `taskflow.auth.${"B".repeat(43)}`,
        ]);
        expect(ws.protocol).toBe("taskflow");
        expect(closed.code).toBe(4401);
        expect(closed.reason).toBe("unauthorized");
        expect(clientCount()).toBe(0);
    });
    test("enforced: a message sent on a rejected socket reaches no router handler", async () => {
        const router = new Router();
        const calls: unknown[] = [];
        router.register("rejected", async (payload) => {
            calls.push(payload);
            return {};
        });
        const server = createServer(router, 0, undefined, undefined, testAuth(true));
        const started = await server.start();
        stop = started.stop;
        const { closed } = await rejectedSocket(started.port, undefined, true);
        expect(closed.code).toBe(4401);
        expect(calls).toEqual([]);
    });
    test("enforced: HTTP without a credential gets 401 Unauthorized", async () => {
        const { port } = await startTestServer(testAuth(true));
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
    });
    test("enforced: a foreign Origin gets 403 Forbidden and is not upgraded", async () => {
        const { port, clientCount } = await startTestServer(testAuth(true));
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { Origin: "https://evil.example", Authorization: `Bearer ${T}` },
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Forbidden" });
        const ws = new BunWebSocket(`ws://127.0.0.1:${port}`, {
            headers: { Origin: "https://evil.example", Authorization: `Bearer ${T}` },
        });
        let opened = false;
        ws.onopen = () => {
            opened = true;
            ws.close();
        };
        await new Promise<void>((resolve) => {
            ws.onerror = () => resolve();
            ws.onclose = () => resolve();
        });
        expect(opened).toBe(false);
        expect(clientCount()).toBe(0);
    });
    test("enforced: Host evil.example gets 403", async () => {
        const { port } = await startTestServer(testAuth(true));
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { Host: "evil.example", Authorization: `Bearer ${T}` },
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Forbidden" });
    });
    test("enforced: the token query is accepted on GET /api/file/raw", async () => {
        const apiRouter = new ApiRouter();
        apiRouter.register("GET", "/api/file/raw", async () => new Response("raw file"));
        const server = createServer(new Router(), 0, apiRouter, undefined, testAuth(true));
        const started = await server.start();
        stop = started.stop;
        const res = await fetch(`http://127.0.0.1:${started.port}/api/file/raw?token=${T}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("raw file");
    });
});

import { describe, test, expect, afterEach } from "bun:test";
import { MSG } from "@taskflow/shared";
import { Router } from "./router";
import { createServer } from "./server";
import { ApiRouter } from "../api/router";
import { cdpKey, parseUiOrigins, type AuthContext } from "./auth";
import type { CdpGateway } from "../services/cdp/cdp-gateway";

// DOM typings omit Bun's supported custom-header constructor.
const BunWebSocket = WebSocket as typeof WebSocket & {
    new (url: string, options?: string | string[] | Bun.WebSocketOptions): WebSocket;
};

const T = "A".repeat(43);
function testAuth(): AuthContext {
    return {
        token: T,
        allowedOrigins: parseUiOrigins(undefined),
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
    options: string | string[] | { headers: Record<string, string> } = {
        headers: { Authorization: `Bearer ${T}` },
    },
    host = "127.0.0.1",
    path = "/",
): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new BunWebSocket(`ws://${host}:${port}${path}`, options);
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
    path = "/",
): Promise<{ ws: WebSocket; closed: CloseEvent }> {
    const ws = new BunWebSocket(`ws://127.0.0.1:${port}${path}`, protocols);
    const closed = await new Promise<CloseEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error("socket was not rejected"));
        }, 1000);
        ws.onclose = (event) => {
            clearTimeout(timer);
            resolve(event);
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error("upgrade failed"));
        };
        ws.onopen = () => {
            if (sendOnOpen)
                ws.send(JSON.stringify({ type: "rejected", payload: {}, correlationId: "1" }));
        };
    });
    return { ws, closed };
}

describe("request authentication", () => {
    for (const protocols of [
        ["taskflow", `taskflow.auth.${T}`],
        [`taskflow.auth.${T}`, "taskflow"],
    ]) {
        test(`a client offering ${protocols[0]} first gets protocol taskflow`, async () => {
            const { port } = await startTestServer(testAuth());
            const ws = await connect(port, protocols);
            expect(ws.protocol).toBe("taskflow");
            ws.close();
        });
    }
    test("a Bearer header on the upgrade connects", async () => {
        const { port } = await startTestServer(testAuth());
        const ws = await connect(port, { headers: { Authorization: `Bearer ${T}` } });
        ws.close();
    });
    test("GET / answers Taskflow backend with no credential", async () => {
        const { port } = await startTestServer(testAuth());
        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(await res.text()).toBe("Taskflow backend");
    });
    test("an upgrade without a credential closes with 4401 unauthorized and never counts as a client", async () => {
        let connects = 0;
        let disconnects = 0;
        const server = createServer(new Router(), 0, undefined, undefined, testAuth());
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
    test("a wrong token in the subprotocol closes with 4401, and the protocol answer is still taskflow", async () => {
        const { port, clientCount } = await startTestServer(testAuth());
        const { ws, closed } = await rejectedSocket(port, [
            "taskflow",
            `taskflow.auth.${"B".repeat(43)}`,
        ]);
        expect(ws.protocol).toBe("taskflow");
        expect(closed.code).toBe(4401);
        expect(closed.reason).toBe("unauthorized");
        expect(clientCount()).toBe(0);
    });
    test("a message sent on a rejected socket reaches no router handler", async () => {
        const router = new Router();
        const calls: unknown[] = [];
        router.register("rejected", async (payload) => {
            calls.push(payload);
            return {};
        });
        const server = createServer(router, 0, undefined, undefined, testAuth());
        const started = await server.start();
        stop = started.stop;
        const { closed } = await rejectedSocket(started.port, undefined, true);
        expect(closed.code).toBe(4401);
        expect(calls).toEqual([]);
    });
    test("HTTP without a credential gets 401 Unauthorized", async () => {
        const { port } = await startTestServer(testAuth());
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
    });
    test("a foreign Origin gets 403 Forbidden and is not upgraded", async () => {
        const { port, clientCount } = await startTestServer(testAuth());
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
    test("Host evil.example gets 403", async () => {
        const { port } = await startTestServer(testAuth());
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { Host: "evil.example", Authorization: `Bearer ${T}` },
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Forbidden" });
    });
    test("the token query is accepted on GET /api/file/raw", async () => {
        const apiRouter = new ApiRouter();
        apiRouter.register("GET", "/api/file/raw", async () => new Response("raw file"));
        const server = createServer(new Router(), 0, apiRouter, undefined, testAuth());
        const started = await server.start();
        stop = started.stop;
        const res = await fetch(`http://127.0.0.1:${started.port}/api/file/raw?token=${T}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("raw file");
    });
});

const routeCases = [
    { group: "session", method: "POST", path: "/api/sessions" },
    { group: "session input", method: "POST", path: "/api/sessions/s1/input" },
    { group: "task worktree", method: "PATCH", path: "/api/tasks/t1/worktree" },
    { group: "archived tasks", method: "GET", path: "/api/tasks/archived" },
    { group: "project deletion", method: "DELETE", path: "/api/projects/p1" },
    { group: "projects", method: "GET", path: "/api/projects" },
    { group: "flow artifact", method: "POST", path: "/api/flow/artifact" },
    { group: "raw flow artifact", method: "GET", path: "/api/flow/artifact/o/f/t/raw" },
    { group: "schedule", method: "POST", path: "/api/schedules/x/trigger" },
    { group: "settings read", method: "GET", path: "/api/settings" },
    { group: "settings update", method: "PATCH", path: "/api/settings" },
    { group: "CLI help", method: "GET", path: "/api/cli-help" },
    { group: "tray state", method: "GET", path: "/api/tray-state" },
    { group: "notification", method: "GET", path: "/api/notifications" },
    { group: "dev server", method: "GET", path: "/api/dev-servers" },
    { group: "attribute", method: "GET", path: "/api/tasks/t1/attributes" },
    { group: "file", method: "GET", path: "/api/file/raw?path=/etc/hosts" },
    { group: "browser tabs", method: "POST", path: "/api/browser/tabs" },
    { group: "browser host", method: "PUT", path: "/api/browser/host" },
    { group: "browser host events", method: "POST", path: "/api/browser/host/events" },
    { group: "unkeyed CDP", method: "GET", path: "/cdp/tab1/json/version" },
    { group: "wrong CDP key", method: "GET", path: "/cdp/tab1/wrong-key/json/version" },
    {
        group: "another tab's CDP key",
        method: "GET",
        path: `/cdp/tab1/${cdpKey(T, "tab2")}/json/list`,
    },
    { group: "unknown", method: "GET", path: "/nothing-here" },
];

function hasHandler(path: string): boolean {
    return path !== "/cdp/tab1/json/version" && path !== "/nothing-here";
}

async function startRouteServer() {
    const calls: string[] = [];
    const openedTabs: string[] = [];
    const apiRouter = new ApiRouter();
    for (const row of routeCases) {
        if (!hasHandler(row.path)) continue;
        apiRouter.register(row.method, new URL(row.path, "http://localhost").pathname, async () => {
            calls.push(row.path);
            return Response.json({ handled: row.path });
        });
    }
    const gateway: CdpGateway = {
        open: (ws) => {
            openedTabs.push(ws.data.tabId);
        },
        close: () => {},
        message: () => {},
        versionJson: async () => ({}),
        listJson: async () => [],
    };
    const server = createServer(new Router(), 0, apiRouter, gateway, testAuth());
    const started = await server.start();
    stop = started.stop;
    return { port: started.port, calls, openedTabs, clientCount: server.clientCount };
}

describe("authentication across route groups", () => {
    for (const row of routeCases) {
        test(`every route group refuses a request with no credential: ${row.group}`, async () => {
            const { port, calls } = await startRouteServer();
            const response = await fetch(`http://127.0.0.1:${port}${row.path}`, {
                method: row.method,
            });
            expect(response.status).toBe(401);
            expect(await response.json()).toEqual({ error: "Unauthorized" });
            expect(calls).toEqual([]);
        });
        if (!hasHandler(row.path)) continue;
        test(`the same request with Authorization: Bearer <token> reaches its handler: ${row.group}`, async () => {
            const { port, calls } = await startRouteServer();
            const response = await fetch(`http://127.0.0.1:${port}${row.path}`, {
                method: row.method,
                headers: { Authorization: `Bearer ${T}` },
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ handled: row.path });
            expect(calls).toEqual([row.path]);
        });
    }

    test("with a Bearer token, the unkeyed CDP path gets 404 and an unknown path gets the identity fallback", async () => {
        const { port, calls } = await startRouteServer();
        const headers = { Authorization: `Bearer ${T}` };
        const cdp = await fetch(`http://127.0.0.1:${port}/cdp/tab1/json/version`, { headers });
        expect(cdp.status).toBe(404);
        await cdp.text();
        const unknown = await fetch(`http://127.0.0.1:${port}/nothing-here`, { headers });
        expect(unknown.status).toBe(200);
        expect(await unknown.text()).toBe("Taskflow backend");
        expect(calls).toEqual([]);
    });

    test("a text/plain cross-site POST with Origin https://evil.example gets 403 and its handler is not called", async () => {
        const { port, calls } = await startRouteServer();
        const response = await fetch(`http://127.0.0.1:${port}/api/flow/artifact`, {
            method: "POST",
            headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
            body: "{}",
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "Forbidden" });
        expect(calls).toEqual([]);
    });

    test("the token query reaches the raw file handler but GET /api/settings gets 401", async () => {
        const { port, calls } = await startRouteServer();
        const raw = await fetch(`http://127.0.0.1:${port}/api/file/raw?token=${T}`);
        expect(raw.status).toBe(200);
        expect(await raw.json()).toEqual({ handled: "/api/file/raw?path=/etc/hosts" });
        const settings = await fetch(`http://127.0.0.1:${port}/api/settings?token=${T}`);
        expect(settings.status).toBe(401);
        expect(await settings.json()).toEqual({ error: "Unauthorized" });
        expect(calls).toEqual(["/api/file/raw?path=/etc/hosts"]);
    });

    test("an upgrade to /cdp/tab1/wrong-key/devtools/browser closes 4401 and never opens the gateway", async () => {
        const { port, openedTabs, clientCount } = await startRouteServer();
        const { closed } = await rejectedSocket(
            port,
            undefined,
            false,
            "/cdp/tab1/wrong-key/devtools/browser",
        );
        expect(closed.code).toBe(4401);
        expect(closed.reason).toBe("unauthorized");
        expect(openedTabs).toEqual([]);
        expect(clientCount()).toBe(0);
    });

    test("an upgrade with the tab's CDP key reaches the gateway", async () => {
        const { port, openedTabs, clientCount } = await startRouteServer();
        const ws = await connect(
            port,
            [],
            "127.0.0.1",
            `/cdp/tab1/${cdpKey(T, "tab1")}/devtools/browser`,
        );
        expect(openedTabs).toEqual(["tab1"]);
        expect(clientCount()).toBe(0);
        ws.close();
    });
});

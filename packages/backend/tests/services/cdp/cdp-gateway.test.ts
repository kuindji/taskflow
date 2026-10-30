import { afterEach, expect, it } from "bun:test";
import type { BrowserTab, WsEvent } from "@taskflow/shared";
import type { ServerWebSocket } from "bun";
import { ApiRouter } from "../../../src/api/router";
import { registerBrowserRoutes } from "../../../src/api/routes/browser-routes";
import { Router } from "../../../src/ws/router";
import { cdpKey } from "../../../src/ws/auth";
import { createServer } from "../../../src/ws/server";
import { createCdpGateway } from "../../../src/services/cdp/cdp-gateway";
import type { CdpMessage } from "../../../src/services/cdp/cdp-filter";
import type { BrowserTabService } from "../../../src/services/browser-tab-service";
import {
    BrowserHostUnavailableError,
    BrowserTabNotFoundError,
} from "../../../src/services/browser-tab-errors";

const TOKEN = "A".repeat(43);

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function until(check: () => boolean): Promise<void> {
    const deadline = performance.now() + 2000;
    while (!check()) {
        if (performance.now() > deadline) throw new Error("Timed out waiting for socket state");
        await Bun.sleep(2);
    }
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

async function fixture(
    options: {
        unavailable?: boolean;
        loadGate?: Promise<void>;
        infoGate?: Promise<void>;
        resolveTarget?: BrowserTabService["resolveTarget"];
    } = {},
) {
    const upstreamSockets = new Set<ServerWebSocket<{ id: number }>>();
    const records: Array<{ connection: number; message: CdpMessage }> = [];
    let connections = 0;
    let closedConnections = 0;
    const upstream = Bun.serve<{ id: number }>({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req, server) {
            const path = new URL(req.url).pathname;
            if (path === "/json/version")
                return Response.json({
                    Browser: "Chrome/130",
                    "Protocol-Version": "1.3",
                    webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/real`,
                });
            if (path === "/json/list")
                return Response.json(
                    ["root", "child", "other", "app"]
                        .map((id) => ({
                            id: `T-${id}`,
                            type: "page",
                            title: id,
                            webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/page/T-${id}`,
                            devtoolsFrontendUrl: `/devtools/inspector.html?ws=T-${id}`,
                        }))
                        .concat([
                            {
                                id: "tab-root",
                                type: "tab",
                                title: "root",
                                webSocketDebuggerUrl: "unused",
                                devtoolsFrontendUrl: "unused",
                            },
                        ]),
                );
            if (server.upgrade(req, { data: { id: ++connections } })) return;
            return new Response("not found", { status: 404 });
        },
        websocket: {
            open(ws) {
                upstreamSockets.add(ws);
            },
            close(ws) {
                upstreamSockets.delete(ws);
                closedConnections++;
            },
            async message(ws, raw) {
                const m = JSON.parse(String(raw)) as CdpMessage;
                records.push({ connection: ws.data.id, message: m });
                const reply = (result: Record<string, unknown>) =>
                    ws.send(
                        JSON.stringify({
                            id: m.id,
                            ...(m.sessionId ? { sessionId: m.sessionId } : {}),
                            result,
                        }),
                    );
                if (m.method === "Target.getTargetInfo") {
                    if (options.infoGate) await options.infoGate;
                    reply({
                        targetInfo: {
                            targetId: "T-root",
                            type: "page",
                            browserContextId: "browser-context",
                        },
                    });
                } else if (m.method === "Target.attachToTarget") {
                    const child = m.params?.targetId === "T-child" ? "-child" : "";
                    reply({ sessionId: `helper-${ws.data.id}${child}` });
                } else if (m.method === "Target.setDiscoverTargets") {
                    for (const [targetId, type] of [
                        ["T-root", "page"],
                        ["T-child", "page"],
                        ["T-other", "page"],
                        ["W-root", "service_worker"],
                    ])
                        ws.send(
                            JSON.stringify({
                                method: "Target.targetCreated",
                                params: { targetInfo: { targetId, type } },
                            }),
                        );
                    reply({});
                } else if (m.method === "Target.setAutoAttach" && m.sessionId) {
                    reply({});
                    ws.send(
                        JSON.stringify({
                            method: "Target.attachedToTarget",
                            sessionId: m.sessionId,
                            params: {
                                sessionId: "nested-page",
                                targetInfo: { targetId: "T-root", type: "page" },
                                waitingForDebugger: false,
                            },
                        }),
                    );
                } else if (m.method === "Target.setAutoAttach") {
                    ws.send(
                        JSON.stringify({
                            method: "Target.attachedToTarget",
                            params: {
                                sessionId: "S-tab",
                                targetInfo: { targetId: "tab-root", type: "tab" },
                                waitingForDebugger: false,
                            },
                        }),
                    );
                    reply({});
                } else if (m.method === "Network.getAllCookies")
                    reply({ cookies: [{ name: "session", value: "browser" }] });
                else reply({ echoed: m.method });
            },
        },
    });
    cleanups.push(() => {
        void upstream.stop(true);
    });
    const changes: number[] = [];
    const gone = new Set<(tabId: string) => void>();
    const tab: BrowserTab = {
        id: "root",
        scope: { kind: "master" },
        label: "Root",
        url: "https://example.com",
        createdAt: "2026-10-30T00:00:00Z",
        loaded: true,
        agentConnections: 0,
    };
    const service: BrowserTabService = {
        list: () => ({ tabs: [tab], hostAvailable: !options.unavailable }),
        get: (id) => (id === "root" ? tab : null),
        open: async () => tab,
        openChild: async () => ({
            tab: { ...tab, id: "child", parentId: "root" },
            targetId: "T-child",
        }),
        close: async () => true,
        closeForOwner: async () => {},
        ensureLoaded: async (id) => {
            if (id !== "root") throw new BrowserTabNotFoundError("Browser tab not found");
            if (options.unavailable) throw new BrowserHostUnavailableError();
            if (options.loadGate) await options.loadGate;
            return { targetId: "T-root", debugPort: upstream.port! };
        },
        resolveTarget:
            options.resolveTarget ??
            (async (id) =>
                id === "T-root" ? { tabId: "root" } : id === "T-child" ? { tabId: "child" } : null),
        tabIdForTarget: (id) => (id === "T-root" ? "root" : id === "T-child" ? "child" : null),
        familyOf: () => new Set(["root", "child"]),
        addAgentConnection: (_id, delta) => {
            changes.push(delta);
        },
        hostHeartbeat: () => {},
        hostEvent: async () => {},
        hostAvailable: () => !options.unavailable,
        subscribeTabGone: (cb) => {
            gone.add(cb);
            return () => {
                gone.delete(cb);
            };
        },
        init: async () => {},
    };
    const gateway = createCdpGateway({ service });
    const apiRouter = new ApiRouter();
    registerBrowserRoutes({
        apiRouter,
        browserTabService: service,
        cdpGateway: gateway,
        cdpKeyFor: (id) => cdpKey(TOKEN, id),
    });
    const backend = createServer(new Router(), 0, apiRouter, gateway, {
        token: TOKEN,
        allowedOrigins: new Set(["file://", "null"]),
    });
    const running = await backend.start();
    cleanups.push(() => running.stop());
    const origin = `http://127.0.0.1:${running.port}`;
    function connect(
        path = `/cdp/root/${cdpKey(TOKEN, "root")}/devtools/browser`,
        protocols?: string[],
    ) {
        const ws = new WebSocket(`${origin.replace("http:", "ws:")}${path}`, protocols);
        const messages: CdpMessage[] = [];
        ws.addEventListener("message", (event) => {
            messages.push(JSON.parse(String(event.data)) as CdpMessage);
        });
        const closed = new Promise<CloseEvent>((resolve) =>
            ws.addEventListener("close", resolve, { once: true }),
        );
        const opened = new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve(), { once: true });
            ws.addEventListener("error", () => reject(new Error("WebSocket upgrade failed")), {
                once: true,
            });
        });
        cleanups.push(() => ws.close());
        return { ws, messages, closed, opened };
    }
    return {
        gateway,
        backend,
        origin,
        connect,
        changes,
        gone,
        records,
        upstreamSockets,
        closedConnections: () => closedConnections,
        connections: () => connections,
    };
}

it("connect to an unknown tab closes 4404", async () => {
    const f = await fixture();
    const c = f.connect(`/cdp/missing/${cdpKey(TOKEN, "missing")}/devtools/browser`);
    const event = await c.closed;
    expect(event.code).toBe(4404);
    expect(event.reason).toBe("Browser tab not found");
    expect(f.changes).toEqual([]);
});

it("connect with no host closes 1011 with the exact message", async () => {
    const f = await fixture({ unavailable: true });
    const event = await f.connect().closed;
    expect(event.code).toBe(1011);
    expect(event.reason).toBe(
        "Browser not available on this machine: the Taskflow desktop app must be running here",
    );
});

it("connect buffers client messages until upstream opens and the context is read", async () => {
    const loading = deferred();
    const info = deferred();
    const f = await fixture({ loadGate: loading.promise, infoGate: info.promise });
    const c = f.connect();
    await c.opened;
    c.ws.send(JSON.stringify({ id: 10, method: "Browser.getVersion" }));
    await Bun.sleep(10);
    expect(f.records).toEqual([]);
    loading.resolve();
    await until(() => f.records.length === 1);
    expect(f.records[0]?.message.method).toBe("Target.getTargetInfo");
    expect(c.messages).toEqual([]);
    info.resolve();
    await until(() => c.messages.some((m) => m.id === 10));
    expect(c.messages).toEqual([{ id: 10, result: { echoed: "Browser.getVersion" } }]);
});

it("agentConnections goes +1 on open and -1 once on close", async () => {
    const f = await fixture();
    const c = f.connect();
    await until(() => f.changes.length === 1);
    expect(f.changes).toEqual([1]);
    c.ws.close();
    await c.closed;
    await until(() => f.changes.length === 2 && f.upstreamSockets.size === 0);
    for (const cb of f.gone) cb("root");
    expect(f.changes).toEqual([1, -1]);
});

it("tab-gone for the root closes the client with 1001", async () => {
    const f = await fixture();
    const c = f.connect();
    await until(() => f.changes.length === 1);
    for (const cb of f.gone) cb("child");
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    for (const cb of [...f.gone]) cb("root");
    expect((await c.closed).code).toBe(1001);
    expect(f.changes).toEqual([1, -1]);
    expect(f.gone.size).toBe(0);
});

it("upstream close closes the client", async () => {
    const f = await fixture();
    const c = f.connect();
    await until(() => f.changes.length === 1);
    for (const ws of f.upstreamSockets) ws.close();
    expect((await c.closed).code).toBe(1001);
    expect(f.changes).toEqual([1, -1]);
});

it("keeps every family page awake on its own upstream connection while the client is connected", async () => {
    const f = await fixture();
    const c = f.connect();
    const emulated = () =>
        f.records
            .filter((r) => r.message.method === "Emulation.setFocusEmulationEnabled")
            .map((r) => r.message);
    await until(() => emulated().length === 2);
    const keepAwake = f.records.filter((r) => r.connection === 2).map((r) => r.message);
    expect(keepAwake[0]).toMatchObject({
        method: "Target.setDiscoverTargets",
        params: { discover: true },
    });
    expect(
        keepAwake
            .filter((m) => m.method === "Target.attachToTarget")
            .map((m) => m.params?.targetId)
            .sort(),
    ).toEqual(["T-child", "T-root"]);
    expect(
        emulated()
            .map((m) => [m.sessionId, m.params])
            .sort(),
    ).toEqual([
        ["helper-2", { enabled: true }],
        ["helper-2-child", { enabled: true }],
    ]);
    expect(f.upstreamSockets.size).toBe(2);
    c.ws.close();
    await c.closed;
    await until(() => f.upstreamSockets.size === 0);
});

it("keep-awake retries a page that registers late when its info changes", async () => {
    let childKnown = false;
    const f = await fixture({
        resolveTarget: async (id) =>
            id === "T-root"
                ? { tabId: "root" }
                : id === "T-child" && childKnown
                  ? { tabId: "child" }
                  : null,
    });
    f.connect();
    const emulated = () =>
        f.records
            .filter((r) => r.message.method === "Emulation.setFocusEmulationEnabled")
            .map((r) => r.message.sessionId);
    await until(() => emulated().length === 1);
    childKnown = true;
    for (const ws of f.upstreamSockets)
        if (ws.data.id === 2)
            ws.send(
                JSON.stringify({
                    method: "Target.targetInfoChanged",
                    params: { targetInfo: { targetId: "T-child", type: "page" } },
                }),
            );
    await until(() => emulated().length === 2);
    expect(emulated().sort()).toEqual(["helper-2", "helper-2-child"]);
});

it("pageOfTabTarget answers from a separate upstream connection and closes it", async () => {
    const f = await fixture();
    const c = f.connect();
    await until(() => f.changes.length === 1);
    c.ws.send(
        JSON.stringify({
            id: 20,
            method: "Target.setAutoAttach",
            params: { flatten: true, autoAttach: true },
        }),
    );
    await until(() => c.messages.some((m) => m.id === 20) && f.closedConnections() === 1);
    expect(c.messages[0]?.params?.targetInfo).toEqual({ targetId: "tab-root", type: "tab" });
    // Connection 2 is the keep-awake session.
    expect(f.connections()).toBe(3);
    expect(f.upstreamSockets.size).toBe(2);
    const attach = f.records.find(
        (r) => r.connection === 3 && r.message.method === "Target.attachToTarget",
    );
    expect(attach?.message.params).toEqual({ targetId: "tab-root", flatten: true });
    expect(
        f.records.find((r) => r.connection === 3 && r.message.method === "Target.setAutoAttach")
            ?.message,
    ).toMatchObject({
        sessionId: "helper-3",
        params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    });
});

it("runOnRootPage attaches to the root page on a separate connection, returns the command's reply and closes it", async () => {
    const f = await fixture();
    const c = f.connect();
    await until(() => f.changes.length === 1);
    c.ws.send(JSON.stringify({ id: 21, method: "Storage.getCookies" }));
    await until(() => c.messages.length === 1 && f.closedConnections() === 1);
    expect(c.messages).toEqual([
        { id: 21, result: { cookies: [{ name: "session", value: "browser" }] } },
    ]);
    expect(
        f.records.find((r) => r.connection === 3 && r.message.method === "Target.attachToTarget")
            ?.message.params,
    ).toEqual({ targetId: "T-root", flatten: true });
    expect(f.records.find((r) => r.message.method === "Network.getAllCookies")).toMatchObject({
        connection: 3,
        message: { sessionId: "helper-3", params: {} },
    });
    expect(f.upstreamSockets.size).toBe(2);
});

for (const suffix of ["/json/version", "/json/version/"]) {
    it(`${suffix} rewrites webSocketDebuggerUrl to the keyed gateway path using Host`, async () => {
        const f = await fixture();
        const response = await fetch(`${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}${suffix}`, {
            headers: { Host: "127.0.0.1:7123" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            Browser: "Chrome/130",
            "Protocol-Version": "1.3",
            webSocketDebuggerUrl: `ws://127.0.0.1:7123/cdp/root/${cdpKey(TOKEN, "root")}/devtools/browser`,
        });
    });
}

for (const suffix of ["/json/list", "/json"]) {
    it(`${suffix} lists only family page targets without debugger urls`, async () => {
        const f = await fixture();
        const response = await fetch(`${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}${suffix}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
            { id: "T-root", type: "page", title: "root" },
            { id: "T-child", type: "page", title: "child" },
        ]);
    });
}

it("json routes map missing tabs to 404 and unavailable hosts to 503", async () => {
    const f = await fixture({ unavailable: true });
    for (const suffix of ["/json/version", "/json/list"]) {
        expect(
            (await fetch(`${f.origin}/cdp/missing/${cdpKey(TOKEN, "missing")}${suffix}`)).status,
        ).toBe(404);
        const response = await fetch(`${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}${suffix}`);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: new BrowserHostUnavailableError().message });
    }
});

it("app WS clients still receive broadcasts and cdp sockets do not", async () => {
    const f = await fixture();
    const cdp = f.connect();
    const app = f.connect("/existing-app-socket", ["taskflow", `taskflow.auth.${TOKEN}`]);
    await app.opened;
    await until(() => f.changes.length === 1 && f.backend.clientCount() === 1);
    const event: WsEvent = { type: "test:broadcast", payload: { value: 42 } };
    f.backend.broadcast(event);
    await until(() => app.messages.some((m) => (m as unknown as WsEvent).type === event.type));
    expect(cdp.messages).toEqual([]);
    expect(f.backend.clientCount()).toBe(1);
});

it("an upgrade to /cdp/<id>/<key>/devtools/page/<x> gets 404 and is not an app client", async () => {
    const f = await fixture();
    const response = await fetch(
        `${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}/devtools/page/T-root`,
        {
            headers: {
                Upgrade: "websocket",
                Connection: "Upgrade",
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                "Sec-WebSocket-Version": "13",
            },
        },
    );
    expect(response.status).toBe(404);
    expect(f.backend.clientCount()).toBe(0);
});

it("an unknown GET under /cdp/ gets 404", async () => {
    const f = await fixture();
    expect((await fetch(`${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}/unknown`)).status).toBe(404);
    expect(
        (await fetch(`${f.origin}/cdp/root/${cdpKey(TOKEN, "root")}/devtools/browser`)).status,
    ).toBe(404);
});

it("closing the client during ensureLoaded never opens upstream or increments connections", async () => {
    const gate = deferred();
    const f = await fixture({ loadGate: gate.promise });
    const c = f.connect();
    await c.opened;
    c.ws.close();
    await c.closed;
    gate.resolve();
    await Bun.sleep(10);
    expect(f.connections()).toBe(0);
    expect(f.changes).toEqual([]);
    expect(f.gone.size).toBe(0);
});

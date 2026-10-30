import type { ServerWebSocket } from "bun";
import type { BrowserTabService } from "../browser-tab-service";
import { BrowserHostUnavailableError, BrowserTabNotFoundError } from "../browser-tab-errors";
import { CdpTargetFilter, type CdpMessage } from "./cdp-filter";

interface CdpSocketData {
    kind: "cdp";
    tabId: string;
    connId: string;
}

interface CdpGateway {
    open(ws: ServerWebSocket<CdpSocketData>): void;
    message(ws: ServerWebSocket<CdpSocketData>, data: string): void;
    close(ws: ServerWebSocket<CdpSocketData>): void;
    versionJson(tabId: string, host: string): Promise<Record<string, unknown>>;
    listJson(tabId: string, host: string): Promise<Record<string, unknown>[]>;
}

interface Connection {
    client: ServerWebSocket<CdpSocketData>;
    upstream?: WebSocket;
    filter?: CdpTargetFilter;
    pendingClient: CdpMessage[];
    pendingUpstream: CdpMessage[];
    counted: boolean;
    closed: boolean;
    unsubscribe: () => void;
    release?: () => void;
}

function record(raw: unknown): Record<string, unknown> {
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

function createCdpGateway({
    service,
    connectUpstream = (url) => new WebSocket(url),
    fetchJson = async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new BrowserHostUnavailableError();
        const value: unknown = await response.json();
        return value;
    },
}: {
    service: BrowserTabService;
    connectUpstream?: (url: string) => WebSocket;
    fetchJson?: (url: string) => Promise<unknown>;
}): CdpGateway {
    const connections = new Map<string, Connection>();
    const contextRequestId = -2147483648;

    async function discovery(tabId: string) {
        const loaded = await service.ensureLoaded(tabId);
        try {
            const base = `http://127.0.0.1:${loaded.debugPort}`;
            const version = record(await fetchJson(`${base}/json/version`));
            if (typeof version.webSocketDebuggerUrl !== "string")
                throw new BrowserHostUnavailableError();
            return { ...loaded, base, version, url: version.webSocketDebuggerUrl };
        } catch {
            throw new BrowserHostUnavailableError();
        }
    }

    // Helpers have their own sockets: the ordered client stream may be waiting
    // for the answer, so using it for these commands would deadlock.
    function onPage(
        url: string,
        targetId: string,
        command?: { method: string; params: Record<string, unknown> },
    ): Promise<CdpMessage | null> {
        return new Promise((resolve) => {
            let ws: WebSocket | undefined;
            let finished = false;
            let sessionId: string | undefined;
            const finish = (reply: CdpMessage | null) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                ws?.close();
                resolve(reply);
            };
            const failure = () =>
                command ? { error: { code: -32000, message: "Timeout" } } : null;
            const timer = setTimeout(() => finish(failure()), command ? 5000 : 2000);
            try {
                ws = connectUpstream(url);
                ws.addEventListener("open", () => {
                    ws?.send(
                        JSON.stringify({
                            id: 1,
                            method: "Target.attachToTarget",
                            params: { targetId, flatten: true },
                        }),
                    );
                });
                ws.addEventListener("message", (event) => {
                    if (finished) return;
                    try {
                        const m = JSON.parse(String(event.data)) as CdpMessage;
                        if (m.id === 1 && !m.sessionId) {
                            if (m.error || typeof m.result?.sessionId !== "string")
                                return finish(command ? m : null);
                            sessionId = m.result.sessionId;
                            ws?.send(
                                JSON.stringify({
                                    id: 2,
                                    sessionId,
                                    method: command?.method ?? "Target.setAutoAttach",
                                    params: command?.params ?? {
                                        autoAttach: true,
                                        waitForDebuggerOnStart: false,
                                        flatten: true,
                                    },
                                }),
                            );
                        } else if (command && m.id === 2 && m.sessionId === sessionId) finish(m);
                        else if (
                            !command &&
                            m.method === "Target.attachedToTarget" &&
                            m.sessionId === sessionId
                        ) {
                            const info = record(m.params?.targetInfo);
                            if (info.type === "page" && typeof info.targetId === "string")
                                finish({ result: { targetId: info.targetId } });
                        }
                    } catch {
                        finish(failure());
                    }
                });
                ws.addEventListener("close", () => finish(failure()));
                ws.addEventListener("error", () => finish(failure()));
            } catch {
                finish(failure());
            }
        });
    }

    // A parked tab sits in a window that is never shown, so its compositor ticks at
    // about 1 Hz and rAF and screenshots crawl. Focus emulation on sessions of our
    // own keeps the tab and its children rendering at full rate while an agent is
    // connected. Playwright turns it on itself; Puppeteer doesn't.
    function keepAwake(url: string, tabId: string): () => void {
        let ws: WebSocket;
        try {
            ws = connectUpstream(url);
        } catch {
            return () => {};
        }
        let nextId = 1;
        const attaches = new Set<number>();
        const seen = new Set<string>();
        const send = (method: string, params: Record<string, unknown>, sessionId?: string) => {
            const id = nextId++;
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
            return id;
        };
        const consider = async (info: Record<string, unknown>) => {
            const targetId = info.targetId;
            if (info.type !== "page" || typeof targetId !== "string" || seen.has(targetId)) return;
            seen.add(targetId);
            const tab = await service.resolveTarget(targetId);
            // Not registered yet: a later targetInfoChanged tries again.
            if (!tab) seen.delete(targetId);
            if (!tab || !service.familyOf(tabId).has(tab.tabId)) return;
            if (ws.readyState === WebSocket.OPEN)
                attaches.add(send("Target.attachToTarget", { targetId, flatten: true }));
        };
        ws.addEventListener("open", () => {
            send("Target.setDiscoverTargets", { discover: true });
        });
        ws.addEventListener("message", (event) => {
            try {
                const m = JSON.parse(String(event.data)) as CdpMessage;
                if (m.method === "Target.targetCreated" || m.method === "Target.targetInfoChanged")
                    void consider(record(m.params?.targetInfo));
                else if (m.method === "Target.targetDestroyed") {
                    if (typeof m.params?.targetId === "string") seen.delete(m.params.targetId);
                } else if (m.id !== undefined && attaches.delete(m.id)) {
                    if (typeof m.result?.sessionId === "string")
                        send(
                            "Emulation.setFocusEmulationEnabled",
                            { enabled: true },
                            m.result.sessionId,
                        );
                }
            } catch {
                // Rendering stays throttled; the agent's connection is unaffected.
            }
        });
        return () => ws.close();
    }

    function finish(connection: Connection, code = 1001, reason = ""): void {
        if (connection.closed) return;
        connection.closed = true;
        connections.delete(connection.client.data.connId);
        connection.unsubscribe();
        connection.release?.();
        connection.pendingClient.length = 0;
        connection.pendingUpstream.length = 0;
        connection.upstream?.close();
        if (connection.counted) {
            connection.counted = false;
            service.addAgentConnection(connection.client.data.tabId, -1);
        }
        connection.client.close(code, reason);
    }

    async function initialize(connection: Connection): Promise<void> {
        const { tabId } = connection.client.data;
        try {
            const upstreamInfo = await discovery(tabId);
            if (connection.closed) return;
            const upstream = connectUpstream(upstreamInfo.url);
            connection.upstream = upstream;
            upstream.addEventListener("open", () => {
                if (connection.closed) return;
                upstream.send(
                    JSON.stringify({
                        id: contextRequestId,
                        method: "Target.getTargetInfo",
                        params: { targetId: upstreamInfo.targetId },
                    }),
                );
            });
            upstream.addEventListener("message", (event) => {
                if (connection.closed) return;
                try {
                    const m = JSON.parse(String(event.data)) as CdpMessage;
                    if (!connection.filter && m.id === contextRequestId && !m.sessionId) {
                        if (!service.hostAvailable())
                            return finish(
                                connection,
                                1011,
                                new BrowserHostUnavailableError().message,
                            );
                        const contextId = record(m.result?.targetInfo).browserContextId;
                        const filter = new CdpTargetFilter(
                            {
                                rootTabId: tabId,
                                isAllowedTab: (id) => service.familyOf(tabId).has(id),
                                resolveTarget: (id) => service.resolveTarget(id),
                                pageOfTabTarget: async (id) => {
                                    const response = await onPage(upstreamInfo.url, id);
                                    return typeof response?.result?.targetId === "string"
                                        ? response.result.targetId
                                        : null;
                                },
                                openChild: (url) => service.openChild(tabId, url),
                                closeTarget: async (id) => {
                                    const tab = await service.resolveTarget(id);
                                    return tab && service.familyOf(tabId).has(tab.tabId)
                                        ? service.close(tab.tabId)
                                        : false;
                                },
                                runOnRootPage: async (method, params) =>
                                    (await onPage(upstreamInfo.url, upstreamInfo.targetId, {
                                        method,
                                        params,
                                    })) ?? { error: { code: -32000, message: "Timeout" } },
                                browserContextId: typeof contextId === "string" ? contextId : null,
                            },
                            {
                                toClient: (message) => {
                                    if (!connection.closed)
                                        connection.client.send(JSON.stringify(message));
                                },
                                toUpstream: (message) => {
                                    if (!connection.closed) upstream.send(JSON.stringify(message));
                                },
                            },
                        );
                        connection.filter = filter;
                        connection.release = keepAwake(upstreamInfo.url, tabId);
                        connection.counted = true;
                        service.addAgentConnection(tabId, 1);
                        for (const message of connection.pendingUpstream.splice(0))
                            void filter.fromUpstream(message).catch(() => finish(connection));
                        for (const message of connection.pendingClient.splice(0))
                            void filter.fromClient(message);
                    } else if (connection.filter)
                        void connection.filter.fromUpstream(m).catch(() => finish(connection));
                    else connection.pendingUpstream.push(m);
                } catch {
                    finish(connection, 1011, new BrowserHostUnavailableError().message);
                }
            });
            upstream.addEventListener("close", () => finish(connection));
            upstream.addEventListener("error", () => finish(connection));
        } catch (error) {
            if (error instanceof BrowserTabNotFoundError)
                finish(connection, 4404, "Browser tab not found");
            else finish(connection, 1011, new BrowserHostUnavailableError().message);
        }
    }

    return {
        open(ws) {
            const connection: Connection = {
                client: ws,
                pendingClient: [],
                pendingUpstream: [],
                counted: false,
                closed: false,
                unsubscribe: () => {},
            };
            connections.set(ws.data.connId, connection);
            connection.unsubscribe = service.subscribeTabGone((id) => {
                if (id === ws.data.tabId) finish(connection);
            });
            void initialize(connection);
        },
        message(ws, data) {
            const connection = connections.get(ws.data.connId);
            if (!connection || connection.closed) return;
            try {
                const message = JSON.parse(data) as CdpMessage;
                if (connection.filter) void connection.filter.fromClient(message);
                else connection.pendingClient.push(message);
            } catch {
                finish(connection, 1003, "Invalid JSON");
            }
        },
        close(ws) {
            const connection = connections.get(ws.data.connId);
            if (connection) finish(connection);
        },
        async versionJson(tabId, host) {
            const { version } = await discovery(tabId);
            return {
                ...version,
                webSocketDebuggerUrl: `ws://${host}/cdp/${tabId}/devtools/browser`,
            };
        },
        async listJson(tabId, _host) {
            const { base } = await discovery(tabId);
            let raw: unknown;
            try {
                raw = await fetchJson(`${base}/json/list`);
            } catch {
                throw new BrowserHostUnavailableError();
            }
            const targets: Record<string, unknown>[] = [];
            for (const value of Array.isArray(raw) ? raw : []) {
                const target = record(value);
                if (target.type !== "page" || typeof target.id !== "string") continue;
                const resolved = await service.resolveTarget(target.id);
                if (!resolved || !service.familyOf(tabId).has(resolved.tabId)) continue;
                const clean = { ...target };
                delete clean.webSocketDebuggerUrl;
                delete clean.devtoolsFrontendUrl;
                targets.push(clean);
            }
            return targets;
        },
    };
}

export { createCdpGateway };
export type { CdpGateway, CdpSocketData };

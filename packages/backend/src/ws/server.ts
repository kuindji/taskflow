import type { Server, ServerWebSocket } from "bun";
import { randomUUID } from "crypto";
import {
    MSG,
    resolveBackendHost,
    TASK_DELETE_TIMEOUT_MS,
    WS_CLOSE_UNAUTHORIZED,
} from "@taskflow/shared";
import type { WsRequest, WsResponse, WsEvent, SystemClientsEvent } from "@taskflow/shared";
import type { ApiRouter } from "../api/router";
import { Router } from "./router";
import { errorResponse } from "../api/routes/response-helpers";
import {
    checkRequest,
    isUpgradeRequest,
    offersUnansweredToken,
    upgradeHeaders,
    type AuthContext,
} from "./auth";
import type { CdpGateway, CdpSocketData } from "../services/cdp/cdp-gateway";

import { createTerminalBroadcaster, type BroadcastOptions } from "./terminal-broadcaster";

export function createServer(
    router: Router,
    port: number = 0,
    apiRouter: ApiRouter | undefined,
    cdpGateway: CdpGateway | undefined,
    auth: AuthContext,
): {
    start(): Promise<{ port: number; stop(): void }>;
    broadcast(event: WsEvent, opts?: BroadcastOptions): void;
    onConnect(callback: () => void): void;
    onDisconnect(callback: (clientId: string) => void): void;
    clientCount(): number;
} {
    type AppSocketData = { kind: "app"; clientId: string };
    type SocketData = AppSocketData | CdpSocketData | { kind: "unauthorized" };
    let server: Server<SocketData>;
    const clients = new Set<ServerWebSocket<SocketData>>();
    const broadcaster = createTerminalBroadcaster(clients);
    let connectCallback: (() => void) | null = null;
    let disconnectCallback: ((clientId: string) => void) | null = null;

    function onConnect(callback: () => void): void {
        connectCallback = callback;
    }

    /** Fired when a connection closes, so per-client resources can be released. */
    function onDisconnect(callback: (clientId: string) => void): void {
        disconnectCallback = callback;
    }

    const broadcast = broadcaster.broadcast;

    /**
     * How many clients are attached right now. The count is otherwise only
     * broadcast, and a client that has just opened its socket cannot hear the
     * broadcast announcing its own arrival — the frame is on the wire before
     * anything downstream of `connect()` has subscribed — so it has to be able
     * to ask for the current value once and follow the broadcasts from there.
     */
    function clientCount(): number {
        return clients.size;
    }

    function broadcastClientCount(): void {
        const payload: SystemClientsEvent = { count: clients.size };
        broadcast({ type: MSG.SYSTEM_CLIENTS, payload });
    }

    async function start() {
        server = Bun.serve({
            port,
            hostname: resolveBackendHost(),
            async fetch(req, server) {
                const url = new URL(req.url);
                const verdict = checkRequest(req, url, auth);
                let unauthorized = false;
                if (!verdict.ok) {
                    if (verdict.reason !== "credential") return errorResponse("Forbidden", 403);
                    else if (!isUpgradeRequest(req)) return errorResponse("Unauthorized", 401);
                    else unauthorized = true;
                }
                if (verdict.ok && verdict.anonymous)
                    return new Response("Taskflow backend", { status: 200 });
                if (isUpgradeRequest(req) && offersUnansweredToken(req))
                    return errorResponse("Unauthorized", 401);
                if (unauthorized) {
                    if (
                        server.upgrade(req, {
                            data: { kind: "unauthorized" },
                            headers: upgradeHeaders(req),
                        })
                    )
                        return;
                    return errorResponse("Unauthorized", 401);
                }
                const path = url.pathname;
                if (path.startsWith("/cdp/")) {
                    const match = /^\/cdp\/([^/]+)\/[^/]+\/devtools\/browser$/.exec(path);
                    if (
                        match &&
                        cdpGateway &&
                        server.upgrade(req, {
                            data: { kind: "cdp", tabId: match[1], connId: randomUUID() },
                            headers: upgradeHeaders(req),
                        })
                    )
                        return;
                    if (req.headers.get("upgrade"))
                        return new Response("Not found", { status: 404 });
                    if (
                        /^\/cdp\/[^/]+\/[^/]+\/json(?:\/version\/?|\/list)?$/.test(path) &&
                        apiRouter
                    ) {
                        const response = await apiRouter.handle(req);
                        if (response) return response;
                    }
                    return new Response("Not found", { status: 404 });
                }
                if (
                    server.upgrade(req, {
                        data: { kind: "app", clientId: randomUUID() },
                        headers: upgradeHeaders(req),
                    })
                )
                    return;
                if (apiRouter) {
                    // Task deletion replies after worktree cleanup, which can
                    // outlast Bun's 10 s idle timeout.
                    if (req.method === "DELETE" && /^\/api\/tasks\/[^/]+$/.test(path))
                        server.timeout(req, TASK_DELETE_TIMEOUT_MS / 1000);
                    const response = await apiRouter.handle(req);
                    if (response) return response;
                }
                return new Response("Taskflow backend", { status: 200 });
            },
            websocket: {
                backpressureLimit: 2 * 1024 * 1024, // 2 MB
                open(ws) {
                    if (ws.data.kind === "unauthorized") {
                        ws.close(WS_CLOSE_UNAUTHORIZED, "unauthorized");
                        return;
                    }
                    if (ws.data.kind === "cdp") {
                        cdpGateway?.open(ws as ServerWebSocket<CdpSocketData>);
                        return;
                    }
                    clients.add(ws);
                    if (connectCallback) connectCallback();
                    broadcastClientCount();
                },
                close(ws) {
                    if (ws.data.kind === "unauthorized") return;
                    if (ws.data.kind === "cdp") {
                        cdpGateway?.close(ws as ServerWebSocket<CdpSocketData>);
                        return;
                    }
                    broadcaster.forget(ws);
                    clients.delete(ws);
                    disconnectCallback?.(ws.data.clientId);
                    broadcastClientCount();
                },
                drain(ws) {
                    if (ws.data.kind === "app") broadcaster.drain(ws);
                },
                async message(ws, message) {
                    if (ws.data.kind === "unauthorized") return;
                    const raw =
                        typeof message === "string" ? message : new TextDecoder().decode(message);
                    if (ws.data.kind === "cdp") {
                        cdpGateway?.message(ws as ServerWebSocket<CdpSocketData>, raw);
                        return;
                    }
                    let request: WsRequest;
                    try {
                        request = JSON.parse(raw) as WsRequest;
                    } catch {
                        ws.send(JSON.stringify({ error: "Invalid JSON" }));
                        return;
                    }

                    try {
                        const result = await router.handle(request.type, request.payload, {
                            clientId: ws.data.clientId,
                        });
                        if (!request.correlationId) return;
                        const response: WsResponse = {
                            correlationId: request.correlationId,
                            type: request.type,
                            payload: result,
                        };
                        ws.send(JSON.stringify(response));
                    } catch (err) {
                        if (!request.correlationId) return;
                        const response: WsResponse = {
                            correlationId: request.correlationId,
                            type: request.type,
                            payload: null,
                            error: err instanceof Error ? err.message : "Unknown error",
                        };
                        ws.send(JSON.stringify(response));
                    } finally {
                        // The socket can close while a request is still running. What that
                        // request acquired for the client came after `close` fired and would
                        // never be released, so report the disconnect again now it has settled.
                        if (!clients.has(ws)) disconnectCallback?.(ws.data.clientId);
                    }
                },
            },
        });

        return {
            port: server.port ?? 0,
            stop() {
                broadcaster.clear();
                void server.stop();
            },
        };
    }

    return { start, broadcast, onConnect, onDisconnect, clientCount };
}

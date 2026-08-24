import type { Server, ServerWebSocket } from "bun";
import { MSG, resolveBackendHost } from "@taskflow/shared";
import type { WsRequest, WsResponse, WsEvent, SystemClientsEvent } from "@taskflow/shared";
import type { ApiRouter } from "../api/router";
import { Router } from "./router";

interface BroadcastOptions {
    /** Skip clients whose outbound buffer exceeds the backpressure threshold. */
    dropOnBackpressure?: boolean;
}

const BACKPRESSURE_THRESHOLD = 1_048_576; // 1 MB — skip terminal output for slow clients

export function createServer(
    router: Router,
    port: number = 0,
    apiRouter?: ApiRouter,
): {
    start(): Promise<{ port: number; stop(): void }>;
    broadcast(event: WsEvent, opts?: BroadcastOptions): void;
    onConnect(callback: () => void): void;
    clientCount(): number;
} {
    let server: Server<unknown>;
    const clients = new Set<ServerWebSocket<unknown>>();
    let connectCallback: (() => void) | null = null;

    function onConnect(callback: () => void): void {
        connectCallback = callback;
    }

    function broadcast(event: WsEvent, opts?: BroadcastOptions): void {
        const data = JSON.stringify(event);
        for (const ws of clients) {
            if (opts?.dropOnBackpressure && ws.getBufferedAmount() > BACKPRESSURE_THRESHOLD) {
                continue; // Client will resync via snapshot on next terminal mount
            }
            ws.send(data);
        }
    }

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
                if (server.upgrade(req, { data: {} })) return;
                if (apiRouter) {
                    const response = await apiRouter.handle(req);
                    if (response) return response;
                }
                return new Response("Taskflow backend", { status: 200 });
            },
            websocket: {
                backpressureLimit: 2 * 1024 * 1024, // 2 MB
                open(ws) {
                    clients.add(ws);
                    if (connectCallback) connectCallback();
                    broadcastClientCount();
                },
                close(ws) {
                    clients.delete(ws);
                    broadcastClientCount();
                },
                async message(ws, message) {
                    const raw =
                        typeof message === "string" ? message : new TextDecoder().decode(message);
                    let request: WsRequest;
                    try {
                        request = JSON.parse(raw) as WsRequest;
                    } catch {
                        ws.send(JSON.stringify({ error: "Invalid JSON" }));
                        return;
                    }

                    try {
                        const result = await router.handle(request.type, request.payload);
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
                    }
                },
            },
        });

        return {
            port: server.port ?? 0,
            stop() {
                void server.stop();
            },
        };
    }

    return { start, broadcast, onConnect, clientCount };
}

import { randomUUID } from "crypto";
import { hostForUrl, resolveBackendHost } from "@taskflow/shared";
import type { WsRequest, WsResponse, WsEvent } from "@taskflow/shared";

interface NetLike {
    request<T>(type: string, payload?: unknown): Promise<T>;
    on(type: string, handler: (payload: unknown) => void): () => void;
    onStatusChange(listener: (status: { connected: boolean }) => void): () => void;
}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** First retry delay; each further attempt doubles it up to the ceiling below. */
const RECONNECT_BASE_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;

class WsClient implements NetLike {
    private ws: WebSocket | null = null;
    private connected = false;
    private settleConnect: ((error?: Error) => void) | null = null;
    private readonly pending = new Map<string, Pending>();
    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusListeners = new Set<(status: { connected: boolean }) => void>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    /** Set by close(): an intentional shutdown must not be undone by the retry loop. */
    private closed = false;

    /**
     * `host` is for remote mode, where the backend is on another machine and
     * `TASKFLOW_HOST` describes this one. Left null, the local rule applies.
     */
    constructor(
        private readonly port: number,
        private readonly host: string | null = null,
    ) {}

    connect(): Promise<void> {
        // Dialling again means the caller wants a connection, so a previous
        // close() no longer holds: leaving `closed` set would give them a live
        // socket with the retry loop silently disabled behind it.
        this.closed = false;
        // An armed retry is superseded too. Left running, it fires after this
        // dial has already succeeded and replaces the live socket, which fails
        // every in-flight request and reports an outage the user never had.
        this.cancelReconnect();
        // A second connect() supersedes the first: tear the old socket down so it
        // cannot deliver events or linger open behind the new one.
        this.disconnect(new Error("Connection replaced"));
        return new Promise<void>((resolve, reject) => {
            const settle = (error?: Error): void => {
                if (this.settleConnect !== settle) return;
                this.settleConnect = null;
                if (error) reject(error);
                else resolve();
            };
            this.settleConnect = settle;
            // With no explicit host this is the local backend, which follows
            // TASKFLOW_HOST (packages/backend/src/ws/server.ts) and inherits this
            // process's environment through startBackend — so the same read keeps
            // the client pointed at the socket that backend actually bound.
            const ws = new WebSocket(
                `ws://${hostForUrl(this.host ?? resolveBackendHost())}:${String(this.port)}`,
            );
            this.ws = ws;
            ws.onopen = () => {
                if (this.ws !== ws) return;
                // The backoff is per outage, not per process: a connection that
                // came back starts the next one at the shortest delay again.
                this.reconnectAttempt = 0;
                this.setStatus(true);
                settle();
            };
            ws.onerror = () => {
                if (this.ws !== ws) return;
                settle(new Error("WebSocket connection error"));
            };
            ws.onclose = () => {
                if (this.ws !== ws) return;
                // Drop the reference: request() must not try to send on it.
                this.ws = null;
                settle(new Error("Connection closed before it opened"));
                this.setStatus(false);
                this.failPending(new Error("Connection lost"));
                // Only an unexpected close reaches here. disconnect() detaches
                // this handler before closing, so neither close() nor a
                // superseding connect() restarts the loop.
                this.scheduleReconnect();
            };
            ws.onmessage = (event: MessageEvent) => {
                if (this.ws !== ws) return;
                this.handleMessage(String(event.data));
            };
        });
    }

    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    /**
     * Dial again after a backoff. Over a tunnel the connection drops whenever the
     * laptop sleeps or changes network, so this is the normal path rather than an
     * error path — each open session re-runs `SessionTerminal.attach()`, which
     * restores its screen from the backend's snapshot.
     */
    private scheduleReconnect(): void {
        if (this.closed || this.reconnectTimer !== null) return;
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
            MAX_RECONNECT_DELAY_MS,
        );
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch(() => {
                // A dial that fails through onerror alone never reaches onclose,
                // so the retry is rearmed here too; the timer guard above keeps
                // the two from stacking when both fire.
                this.scheduleReconnect();
            });
        }, delay);
    }

    /** Disarm the retry loop. Safe when nothing is armed. */
    private cancelReconnect(): void {
        if (this.reconnectTimer === null) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private setStatus(connected: boolean): void {
        if (this.connected === connected) return;
        this.connected = connected;
        for (const listener of this.statusListeners) listener({ connected });
    }

    private failPending(reason: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }
        this.pending.clear();
    }

    /** Detach and close the current socket, settling everything that depends on it. */
    private disconnect(reason: Error): void {
        const ws = this.ws;
        this.ws = null;
        this.settleConnect?.(reason);
        if (ws) {
            ws.onopen = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.onmessage = null;
            ws.close();
        }
        this.setStatus(false);
        this.failPending(reason);
    }

    private handleMessage(raw: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // A frame that is not JSON cannot be correlated to anything; drop it
            // rather than letting the error escape the socket's message handler.
            return;
        }
        if (typeof parsed !== "object" || parsed === null) return;

        if ("correlationId" in parsed) {
            const response = parsed as WsResponse;
            const pending = this.pending.get(response.correlationId);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(response.correlationId);
            if (response.error !== undefined) pending.reject(new Error(response.error));
            else pending.resolve(response.payload);
            return;
        }

        const event = parsed as WsEvent;
        const handlers = this.listeners.get(event.type);
        if (!handlers) return;
        for (const handler of handlers) handler(event.payload);
    }

    request<T>(type: string, payload: unknown = {}): Promise<T> {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("Not connected"));
        }
        const correlationId = randomUUID();
        const message: WsRequest = { correlationId, type, payload };
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(correlationId);
                reject(new Error(`Request timed out: ${type}`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            ws.send(JSON.stringify(message));
        });
    }

    on(type: string, handler: (payload: unknown) => void): () => void {
        let handlers = this.listeners.get(type);
        if (!handlers) {
            handlers = new Set();
            this.listeners.set(type, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
        };
    }

    close(): void {
        // Set before anything else, so a close racing an armed timer cannot be
        // undone by the dial that timer was about to make.
        this.closed = true;
        this.cancelReconnect();
        this.disconnect(new Error("Client closed"));
    }
}

export { WsClient };
export type { NetLike };

import { randomUUID } from "crypto";
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

class WsClient implements NetLike {
    private ws: WebSocket | null = null;
    private connected = false;
    private settleConnect: ((error?: Error) => void) | null = null;
    private readonly pending = new Map<string, Pending>();
    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusListeners = new Set<(status: { connected: boolean }) => void>();

    constructor(private readonly port: number) {}

    connect(): Promise<void> {
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
            const ws = new WebSocket(`ws://127.0.0.1:${String(this.port)}`);
            this.ws = ws;
            ws.onopen = () => {
                if (this.ws !== ws) return;
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
        this.disconnect(new Error("Client closed"));
    }
}

export { WsClient };
export type { NetLike };

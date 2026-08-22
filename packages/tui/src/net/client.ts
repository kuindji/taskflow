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
    private readonly pending = new Map<string, Pending>();
    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusListeners = new Set<(status: { connected: boolean }) => void>();

    constructor(private readonly port: number) {}

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${String(this.port)}`);
            this.ws = ws;
            ws.onopen = () => {
                this.notifyStatus(true);
                resolve();
            };
            ws.onerror = () => {
                reject(new Error("WebSocket connection error"));
            };
            ws.onclose = () => {
                if (this.ws !== ws) return; // superseded by a newer socket
                // Drop the reference: request() must not try to send on it.
                this.ws = null;
                this.notifyStatus(false);
                this.failPending(new Error("Connection lost"));
            };
            ws.onmessage = (event: MessageEvent) => {
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

    private notifyStatus(connected: boolean): void {
        for (const listener of this.statusListeners) listener({ connected });
    }

    private failPending(reason: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }
        this.pending.clear();
    }

    private handleMessage(raw: string): void {
        const parsed: unknown = JSON.parse(raw);
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
        this.failPending(new Error("Client closed"));
        const ws = this.ws;
        this.ws = null;
        ws?.close();
    }
}

export { WsClient };
export type { NetLike };

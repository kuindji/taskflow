import type { WsRequest } from "@taskflow/shared";

let ws: WebSocket | null = null;
let wsPort: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let connected = false;
let reconnecting = false;
const MAX_RECONNECT_DELAY = 10000;

interface ConnectionStatus {
    connected: boolean;
    reconnecting: boolean;
}

const pendingRequests = new Map<
    string,
    {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        timeoutId: ReturnType<typeof setTimeout>;
    }
>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
const statusListeners = new Set<(status: ConnectionStatus) => void>();

function notifyStatus(): void {
    const status = { connected, reconnecting };
    for (const listener of statusListeners) listener(status);
}

export function getBackendPort(): number | null {
    return wsPort;
}

export function onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    statusListeners.add(handler);
    handler({ connected, reconnecting });
    return () => {
        statusListeners.delete(handler);
    };
}

function scheduleReconnect(): void {
    if (reconnectTimer || !wsPort) return;
    reconnecting = true;
    notifyStatus();
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (wsPort) connectWebSocket(wsPort).catch(() => {});
    }, delay);
}

export function connectWebSocket(port: number): Promise<void> {
    wsPort = port;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        ws.onclose = null; // Prevent stale onclose from scheduling a redundant reconnect
        ws.close();
    }
    return new Promise((resolve, reject) => {
        ws = new WebSocket(`ws://localhost:${port}`);
        ws.onopen = () => {
            reconnectAttempt = 0;
            connected = true;
            reconnecting = false;
            notifyStatus();
            resolve();
        };
        ws.onerror = () => reject(new Error("WebSocket connection error"));
        ws.onmessage = (event) => {
            const raw: unknown = JSON.parse(event.data as string);
            if (typeof raw !== "object" || raw === null) return;
            const data = raw as Record<string, unknown>;
            if (typeof data.correlationId === "string" && pendingRequests.has(data.correlationId)) {
                const pending = pendingRequests.get(data.correlationId);
                if (!pending) return;
                clearTimeout(pending.timeoutId);
                pendingRequests.delete(data.correlationId);
                if (data.error)
                    pending.reject(
                        new Error(typeof data.error === "string" ? data.error : "Unknown error"),
                    );
                else pending.resolve(data.payload);
                return;
            }
            if (typeof data.type === "string") {
                const listeners = eventListeners.get(data.type);
                if (listeners) for (const listener of listeners) listener(data.payload);
            }
        };
        ws.onclose = () => {
            for (const [, pending] of pendingRequests) {
                clearTimeout(pending.timeoutId);
                pending.reject(new Error("WebSocket closed"));
            }
            pendingRequests.clear();
            connected = false;
            notifyStatus();
            scheduleReconnect();
        };
    });
}

export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error("WebSocket not connected"));
            return;
        }
        const correlationId = crypto.randomUUID();
        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(correlationId)) {
                pendingRequests.delete(correlationId);
                reject(new Error(`Request timeout: ${type}`));
            }
        }, 30000);
        pendingRequests.set(correlationId, {
            resolve: resolve as (value: unknown) => void,
            reject,
            timeoutId,
        });
        const request: WsRequest = { correlationId, type, payload };
        ws.send(JSON.stringify(request));
    });
}

export function sendFireAndForget(type: string, payload: unknown = {}): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, payload }));
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
    let listeners = eventListeners.get(type);
    if (!listeners) {
        listeners = new Set();
        eventListeners.set(type, listeners);
    }
    listeners.add(handler);
    return () => {
        eventListeners.get(type)?.delete(handler);
    };
}

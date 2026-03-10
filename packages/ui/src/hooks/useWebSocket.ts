import type { WsRequest } from '@taskflow/shared';

let ws: WebSocket | null = null;
let wsPort: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 10000;

const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
const statusListeners = new Set<(connected: boolean) => void>();

function notifyStatus(connected: boolean): void {
  for (const listener of statusListeners) listener(connected);
}

export function onStatusChange(handler: (connected: boolean) => void): () => void {
  statusListeners.add(handler);
  return () => { statusListeners.delete(handler); };
}

function scheduleReconnect(): void {
  if (reconnectTimer || !wsPort) return;
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
      notifyStatus(true);
      resolve();
    };
    ws.onerror = (e) => reject(e);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.correlationId && pendingRequests.has(data.correlationId)) {
        const pending = pendingRequests.get(data.correlationId)!;
        pendingRequests.delete(data.correlationId);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.payload);
        return;
      }
      if (data.type) {
        const listeners = eventListeners.get(data.type);
        if (listeners) for (const listener of listeners) listener(data.payload);
      }
    };
    ws.onclose = () => {
      for (const [, pending] of pendingRequests) pending.reject(new Error('WebSocket closed'));
      pendingRequests.clear();
      notifyStatus(false);
      scheduleReconnect();
    };
  });
}

export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket not connected')); return; }
    const correlationId = crypto.randomUUID();
    pendingRequests.set(correlationId, { resolve: resolve as (value: unknown) => void, reject });
    const request: WsRequest = { correlationId, type, payload };
    ws.send(JSON.stringify(request));
    setTimeout(() => {
      if (pendingRequests.has(correlationId)) {
        pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout: ${type}`));
      }
    }, 30000);
  });
}

export function sendFireAndForget(type: string, payload: unknown = {}): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, payload }));
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
  if (!eventListeners.has(type)) eventListeners.set(type, new Set());
  eventListeners.get(type)!.add(handler);
  return () => { eventListeners.get(type)?.delete(handler); };
}

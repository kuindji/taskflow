import type { WsRequest } from "@taskflow/shared";

export interface ConnectionStatus {
    connected: boolean;
    reconnecting: boolean;
}

const MAX_RECONNECT_DELAY = 60_000;
const REQUEST_TIMEOUT = 30_000;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    /** The socket epoch that sent this. A reply on a later epoch is ignored. */
    epoch: number;
}

interface ConnectionHooks {
    /** Called for every event frame; the registry supplies the owning backend id. */
    onEvent(type: string, payload: unknown): void;
    onStatus(status: ConnectionStatus): void;
}

/**
 * One backend's socket, its pending requests and its reconnect timer.
 *
 * The epoch exists for reconnects, not for multiple backends: two backends are
 * two Connection objects and cannot confuse each other. Within one connection a
 * replaced socket can still deliver a late message, close or error, and without
 * the epoch a stale frame would resolve a request the new socket owns.
 */
export class Connection {
    /** Not readonly: a provisional record is refiled onto its uid at handshake,
     *  and this is the id every event is tagged with. */
    private id: string;
    private socket: WebSocket | null = null;
    private epoch = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private pending = new Map<string, Pending>();
    private status: ConnectionStatus = { connected: false, reconnecting: false };
    private closed = false;

    constructor(
        backendId: string,
        readonly origin: string,
        private hooks: ConnectionHooks,
    ) {
        this.id = backendId;
    }

    get backendId(): string {
        return this.id;
    }

    /** See `rekeyConnection`. Identity only; the socket is untouched. */
    rename(backendId: string): void {
        this.id = backendId;
    }

    getStatus(): ConnectionStatus {
        return this.status;
    }

    private setStatus(next: ConnectionStatus): void {
        this.status = next;
        this.hooks.onStatus(next);
    }

    private wsUrl(): string {
        return this.origin.replace(/^http/, "ws");
    }

    open(): Promise<void> {
        this.closed = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const epoch = ++this.epoch;
        // Defensive. A reconnect only runs after `onclose`, so the previous
        // socket is closed already and this is a no-op — but if a caller ever
        // reopens while connected, the old socket's handlers are dead (their
        // epoch is stale) and not closing it would leak a live socket.
        this.socket?.close();
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.wsUrl());
            this.socket = socket;

            socket.onopen = () => {
                if (epoch !== this.epoch) return;
                this.reconnectAttempt = 0;
                this.setStatus({ connected: true, reconnecting: false });
                resolve();
            };
            socket.onerror = () => {
                if (epoch !== this.epoch) return;
                reject(new Error(`WebSocket error for backend ${this.backendId}`));
            };
            socket.onmessage = (event) => {
                if (epoch !== this.epoch) return;
                this.receive(event.data as string, epoch);
            };
            socket.onclose = () => {
                if (epoch !== this.epoch) return;
                this.failPending(new Error("WebSocket closed"), epoch);
                this.setStatus({ connected: false, reconnecting: false });
                if (!this.closed) this.scheduleReconnect();
            };
        });
    }

    private receive(raw: string, epoch: number): void {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return;
        const data = parsed as Record<string, unknown>;

        if (typeof data.correlationId === "string") {
            const entry = this.pending.get(data.correlationId);
            if (!entry || entry.epoch !== epoch) return;
            clearTimeout(entry.timeoutId);
            this.pending.delete(data.correlationId);
            if (data.error) {
                entry.reject(
                    new Error(typeof data.error === "string" ? data.error : "Unknown error"),
                );
            } else {
                entry.resolve(data.payload);
            }
            return;
        }
        if (typeof data.type === "string") this.hooks.onEvent(data.type, data.payload);
    }

    private failPending(reason: Error, epoch: number): void {
        for (const [id, entry] of [...this.pending]) {
            if (entry.epoch !== epoch) continue;
            clearTimeout(entry.timeoutId);
            this.pending.delete(id);
            entry.reject(reason);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.closed) return;
        this.setStatus({ connected: false, reconnecting: true });
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY);
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.open().catch(() => {});
        }, delay);
    }

    sendRequest<T>(type: string, payload: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error(`Backend ${this.backendId} is not connected`));
                return;
            }
            const correlationId = crypto.randomUUID();
            const epoch = this.epoch;
            const timeoutId = setTimeout(() => {
                if (this.pending.delete(correlationId)) {
                    reject(new Error(`Request timeout: ${type}`));
                }
            }, REQUEST_TIMEOUT);
            this.pending.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeoutId,
                epoch,
            });
            const request: WsRequest = { correlationId, type, payload };
            this.socket.send(JSON.stringify(request));
        });
    }

    sendFireAndForget(type: string, payload: unknown): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify({ type, payload }));
    }

    /** Close for good. Pending requests reject with `reason` rather than timing out. */
    close(reason: Error): void {
        this.closed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.failPending(reason, this.epoch);
        this.epoch++;
        this.socket?.close();
        this.socket = null;
        this.setStatus({ connected: false, reconnecting: false });
    }
}

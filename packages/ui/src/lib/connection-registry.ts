import { Connection, type ConnectionStatus } from "./connection";

/** Thrown to a request in flight when its backend is detached. */
export class BackendDetachedError extends Error {
    constructor(backendId: string) {
        super(`Backend ${backendId} was detached`);
        this.name = "BackendDetachedError";
    }
}

/** Thrown to a request in flight when a hard switch tears its backend down. */
export class BackendSwitchedError extends Error {
    constructor(backendId: string) {
        super(`Backend ${backendId} was switched away from`);
        this.name = "BackendSwitchedError";
    }
}

const connections = new Map<string, Connection>();
/** Keyed by message type, shared by every connection. */
const eventListeners = new Map<string, Set<(payload: unknown, backendId: string) => void>>();
const statusListeners = new Map<string, Set<(status: ConnectionStatus) => void>>();
let primaryId: string | null = null;
const primaryListeners = new Set<(id: string | null) => void>();

function notifyPrimary(): void {
    for (const listener of primaryListeners) listener(primaryId);
}

export function setPrimary(backendId: string): void {
    if (primaryId === backendId) return;
    primaryId = backendId;
    notifyPrimary();
}

/** Fires on `setPrimary`, and when a rekey or close moves or clears primary. */
export function onPrimaryChange(handler: (id: string | null) => void): () => void {
    primaryListeners.add(handler);
    return () => {
        primaryListeners.delete(handler);
    };
}

export function getPrimary(): string | null {
    return primaryId;
}

export function originFor(backendId: string): string | null {
    return connections.get(backendId)?.origin ?? null;
}

export function openConnection(backendId: string, origin: string): Promise<void> {
    connections.get(backendId)?.close(new BackendDetachedError(backendId));
    const connection: Connection = new Connection(backendId, origin, {
        onEvent(type, payload) {
            const listeners = eventListeners.get(type);
            if (!listeners) return;
            // `connection.backendId`, never the captured argument: after a
            // rekey the captured one is the provisional id and every event
            // would be tagged with an id no store holds a slice for.
            for (const listener of listeners) listener(payload, connection.backendId);
        },
        onStatus(status) {
            const listeners = statusListeners.get(connection.backendId);
            if (!listeners) return;
            for (const listener of listeners) listener(status);
        },
    });
    connections.set(backendId, connection);
    return connection.open();
}

export function closeConnection(backendId: string, reason: "detach" | "switch"): void {
    const connection = connections.get(backendId);
    if (!connection) return;
    connection.close(
        reason === "switch"
            ? new BackendSwitchedError(backendId)
            : new BackendDetachedError(backendId),
    );
    connections.delete(backendId);
    if (primaryId === backendId) {
        primaryId = null;
        notifyPrimary();
    }
}

/**
 * Refile a live connection under a new id, keeping the socket. A record adopts
 * its `backendUid` at handshake, and the connection was opened under the
 * provisional id; closing and reopening would tear down the very socket the
 * handshake just proved healthy, for every manual connect.
 *
 * The Connection's own `backendId` is what `onEvent` hands listeners, so it is
 * updated too — otherwise every event from this machine would arrive tagged
 * with an id no store has a slice for, and simply be dropped.
 */
export function rekeyConnection(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const connection = connections.get(fromId);
    if (!connection) return;
    connections.delete(fromId);
    connections.get(toId)?.close(new BackendDetachedError(toId));
    connection.rename(toId);
    connections.set(toId, connection);

    const listeners = statusListeners.get(fromId);
    if (listeners) {
        statusListeners.delete(fromId);
        statusListeners.set(toId, listeners);
    }
    if (primaryId === fromId) {
        primaryId = toId;
        notifyPrimary();
    }
}

export function sendRequest<T = unknown>(
    backendId: string,
    type: string,
    payload: unknown = {},
): Promise<T> {
    const connection = connections.get(backendId);
    if (!connection) return Promise.reject(new BackendDetachedError(backendId));
    return connection.sendRequest<T>(type, payload);
}

export function sendFireAndForget(backendId: string, type: string, payload: unknown = {}): void {
    connections.get(backendId)?.sendFireAndForget(type, payload);
}

/**
 * Listeners are registered against message types, not sockets, and are shared
 * by every connection — which is what lets a machine attach or detach without
 * re-subscribing anything. The second argument is how a handler knows whose
 * event it is holding; without it a desktop TASK_UPDATED would be applied to a
 * laptop record of the same shape.
 */
export function onEvent(
    type: string,
    handler: (payload: unknown, backendId: string) => void,
): () => void {
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

export function onStatusChange(
    backendId: string,
    handler: (status: ConnectionStatus) => void,
): () => void {
    let listeners = statusListeners.get(backendId);
    if (!listeners) {
        listeners = new Set();
        statusListeners.set(backendId, listeners);
    }
    listeners.add(handler);
    handler(connections.get(backendId)?.getStatus() ?? { connected: false, reconnecting: false });
    return () => {
        statusListeners.get(backendId)?.delete(handler);
    };
}

export type { ConnectionStatus };

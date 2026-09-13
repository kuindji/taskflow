import {
    getPrimary,
    onEvent as onEventRouted,
    onPrimaryChange,
    onStatusChange as onStatusChangeRouted,
    openConnection,
    sendFireAndForget as sendFireAndForgetRouted,
    sendRequest as sendRequestRouted,
    setPrimary,
    type ConnectionStatus,
} from "@/lib/connection-registry";

/**
 * TEMPORARY. These wrappers route to whichever backend is primary so that call
 * sites can migrate to explicit ids one store at a time instead of all of
 * them at once. Every use is a site that has not been routed yet. Task 19 deletes this
 * file once none are left; do not add new callers.
 */
function primaryOrThrow(): string {
    const id = getPrimary();
    if (!id) throw new Error("No primary backend");
    return id;
}

/**
 * Before a primary exists these answer "not connected" as the old module did: a
 * rejected request and a dropped message, never a throw. Children run their
 * mount effects before `WebSocketProvider` connects, and several call
 * `sendRequest(...).then(...)` synchronously inside those effects, where a
 * throw would take down the whole renderer.
 */
export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
    const id = getPrimary();
    if (!id) return Promise.reject(new Error("No primary backend"));
    return sendRequestRouted<T>(id, type, payload);
}

export function sendFireAndForget(type: string, payload: unknown = {}): void {
    const id = getPrimary();
    if (id) sendFireAndForgetRouted(id, type, payload);
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
    return onEventRouted(type, (payload) => handler(payload));
}

/**
 * Follows primary rather than binding to whichever backend is primary at
 * subscription time. Both of today's subscribers register before anything has
 * connected — `WebSocketProvider` on mount and `useAgentAvailability` at
 * import — so a shim that answered "no primary yet" with a no-op would leave
 * the provider's `connected` false for the life of the app.
 */
export function onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    let off: () => void = () => {};
    const follow = (): void => {
        off();
        const id = getPrimary();
        off = id ? onStatusChangeRouted(id, handler) : () => {};
        if (!id) handler({ connected: false, reconnecting: false });
    };
    follow();
    const offPrimary = onPrimaryChange(follow);
    return () => {
        off();
        offPrimary();
    };
}

/**
 * Keeps today's signature. Until Task 10 replaces the provider this is the
 * app's only connect, and it runs before anything has named a primary — so it
 * names one. Task 10's provider calls `setPrimaryBackend` itself and does not
 * come through here.
 */
export function connectWebSocket(port: number): Promise<void> {
    if (!getPrimary()) setPrimary("local");
    return openConnection(primaryOrThrow(), `http://localhost:${port}`);
}

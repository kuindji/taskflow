import {
    getPrimary,
    onEvent as onEventRouted,
    onPrimaryChange,
    onStatusChange as onStatusChangeRouted,
    sendFireAndForget as sendFireAndForgetRouted,
    sendRequest as sendRequestRouted,
    type ConnectionStatus,
} from "@/lib/connection-registry";

/**
 * TEMPORARY. These wrappers route to whichever backend is primary so that call
 * sites can migrate to explicit ids one store at a time instead of all of
 * them at once. Every use is a site that has not been routed yet. Task 19 deletes this
 * file once none are left; do not add new callers.
 *
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

/**
 * Only primary's events: a caller here cannot tell machines apart, so another
 * attached backend's event would be applied as if primary had sent it.
 */
export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
    return onEventRouted(type, (payload, backendId) => {
        if (backendId === getPrimary()) handler(payload);
    });
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

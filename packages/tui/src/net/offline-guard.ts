import type { NetLike } from "./client";

/** A request refused because the machine is known to be unreachable. Nothing was sent. */
class MachineOfflineError extends Error {
    constructor() {
        super("The machine is offline");
        this.name = "MachineOfflineError";
    }
}

/**
 * The `NetLike` every store and view of a workspace talks through. While
 * `offline` is set, requests fail at once instead of reaching the socket, so a
 * keypress in any view cannot queue work for a machine that is gone. Events and
 * status changes pass through untouched.
 */
class OfflineGuardNet implements NetLike {
    offline = false;

    constructor(private readonly inner: NetLike) {}

    request<T>(type: string, payload?: unknown): Promise<T> {
        if (this.offline) return Promise.reject(new MachineOfflineError());
        return this.inner.request<T>(type, payload);
    }

    on(type: string, handler: (payload: unknown) => void): () => void {
        return this.inner.on(type, handler);
    }

    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        return this.inner.onStatusChange(listener);
    }
}

export { MachineOfflineError, OfflineGuardNet };

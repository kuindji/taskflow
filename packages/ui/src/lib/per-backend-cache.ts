import { registerBackendReset } from "@/stores/store-reset";

/**
 * A value fetched from one backend and cached against it.
 *
 * A global cache of backend-derived data silently answers with whichever
 * machine replied first, which is how a desktop task ends up offered this
 * laptop's installed agents.
 */
export function createPerBackendCache<T>(
    fetcher: (backendId: string) => Promise<T>,
    name: string,
): { get(backendId: string): Promise<T>; peek(backendId: string): T | null } {
    const values = new Map<string, T>();
    const inFlight = new Map<string, Promise<T>>();

    registerBackendReset(name, (backendId) => {
        values.delete(backendId);
        inFlight.delete(backendId);
    });

    return {
        get(backendId) {
            const cached = values.get(backendId);
            if (cached !== undefined) return Promise.resolve(cached);
            const pending = inFlight.get(backendId);
            if (pending) return pending;
            const promise: Promise<T> = fetcher(backendId).then(
                (value) => {
                    // A reset while this was in flight dropped the entry: the
                    // answer came from a machine that has since been detached.
                    if (inFlight.get(backendId) === promise) {
                        values.set(backendId, value);
                        inFlight.delete(backendId);
                    }
                    return value;
                },
                (error: unknown) => {
                    if (inFlight.get(backendId) === promise) inFlight.delete(backendId);
                    throw error;
                },
            );
            inFlight.set(backendId, promise);
            return promise;
        },
        peek(backendId) {
            return values.get(backendId) ?? null;
        },
    };
}

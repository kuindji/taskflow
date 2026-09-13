import { backendOrigin } from "./backend-url";

/**
 * The backend this app started. It is not a saved record, so the backend IPC
 * channels answer for it under this id and the renderer attaches, detaches and
 * handshakes it through the same calls as any other machine.
 */
const LOCAL_BACKEND_ID = "local";

interface AttachedBackend {
    id: string;
    origin: string;
    isLocal: boolean;
}

/**
 * Every backend main can reach right now: local once its port is known, then each
 * record with a live tunnel. Ids are the ones the renderer holds (local, or the
 * record id main renames at the first handshake).
 */
function listAttachedBackends(
    localPort: number | null,
    remote: { id: string; origin: string }[],
): AttachedBackend[] {
    const local =
        localPort === null
            ? []
            : [{ id: LOCAL_BACKEND_ID, origin: backendOrigin(localPort), isLocal: true }];
    return [...local, ...remote.map((entry) => ({ ...entry, isLocal: false }))];
}

export { LOCAL_BACKEND_ID, listAttachedBackends };
export type { AttachedBackend };

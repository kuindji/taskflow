import { create } from "zustand";
import type {
    DevServer,
    DevServerListResponse,
    DevServerStopPayload,
    DevServerStopResult,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

/** Absent from `stopStates`: idle. */
type DevServerStopState = "stopping" | { error: string };

interface DevServerStoreState {
    devServers: Scoped<DevServer>[];
    /** Keyed by `devServerKey`. */
    stopStates: Record<string, DevServerStopState>;

    fetchDevServers(backendId: string): Promise<void>;
    stopDevServer(server: Scoped<DevServer>): Promise<void>;
    /** Errors only: a stop still in flight keeps its "stopping". */
    clearStopErrors(): void;
}

const slices = createSlices<DevServer>();

function devServerKey(server: Pick<Scoped<DevServer>, "backendId" | "id">): string {
    return `${server.backendId}:${server.id}`;
}

function publish(): void {
    useDevServerStore.setState({ devServers: slices.read() });
}

// The newest stop attempt per `devServerKey`. A backend reset deletes its entries, so
// a request that settles afterwards finds its token gone and changes nothing.
const attempts = new Map<string, number>();
let attemptSeq = 0;

function setStopState(key: string, state: DevServerStopState | null): void {
    useDevServerStore.setState((s) => {
        const rest = Object.fromEntries(Object.entries(s.stopStates).filter(([k]) => k !== key));
        return { stopStates: state === null ? rest : { ...rest, [key]: state } };
    });
}

const useDevServerStore = create<DevServerStoreState>((set, get) => ({
    devServers: [],
    stopStates: {},

    async fetchDevServers(backendId) {
        const landed = await slices.load(backendId, async () => {
            const { devServers } = await sendRequest<DevServerListResponse>(
                backendId,
                MSG.DEV_SERVER_LIST,
                {},
            );
            return devServers;
        });
        if (landed) publish();
    },

    async stopDevServer(server) {
        const key = devServerKey(server);
        if (get().stopStates[key] === "stopping") return;
        const attempt = ++attemptSeq;
        attempts.set(key, attempt);
        setStopState(key, "stopping");
        const payload: DevServerStopPayload = { id: server.id };
        let result: DevServerStopResult;
        try {
            result = await sendRequest<DevServerStopResult>(
                server.backendId,
                MSG.DEV_SERVER_STOP,
                payload,
            );
        } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        // Stale: the backend was reset while the request ran. Writing now would bring
        // back an error or a slice the reset cleared.
        if (attempts.get(key) !== attempt) return;
        attempts.delete(key);
        if (!result.ok) {
            setStopState(key, { error: result.error });
            return;
        }
        // The backend's broadcast removes it too; this covers an `ok` for a record it no
        // longer held. Only that registration: a re-add of the pid keeps the id.
        slices.apply(server.backendId, (items) =>
            items.filter((d) => d.id !== server.id || d.registeredAt !== server.registeredAt),
        );
        publish();
        setStopState(key, null);
    },

    clearStopErrors() {
        set((s) => ({
            stopStates: Object.fromEntries(
                Object.entries(s.stopStates).filter(([, state]) => state === "stopping"),
            ),
        }));
    },
}));

registerBackendReset("dev-server-store", (backendId) => {
    slices.drop(backendId);
    publish();
    const prefix = `${backendId}:`;
    for (const key of [...attempts.keys()]) {
        if (key.startsWith(prefix)) attempts.delete(key);
    }
    useDevServerStore.setState((s) => ({
        stopStates: Object.fromEntries(
            Object.entries(s.stopStates).filter(([key]) => !key.startsWith(prefix)),
        ),
    }));
});

// A full list, so the write replaces the slice. Through `apply`, not `replace`: a
// fetch in flight replays it over its older response instead of overwriting it.
const _unsubDevServerList = onEvent(MSG.DEV_SERVER_LIST, (payload, backendId) => {
    const { devServers } = payload as DevServerListResponse;
    if (!Array.isArray(devServers)) return;
    const scoped = devServers.map((d) => ({ ...d, backendId }));
    slices.apply(backendId, () => scoped);
    publish();
});

export { useDevServerStore, devServerKey };
export type { DevServerStopState };

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubDevServerList();
    });
}

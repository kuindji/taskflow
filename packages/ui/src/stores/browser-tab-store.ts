import { create } from "zustand";
import { MSG, type BrowserTabListResponse } from "@taskflow/shared";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { createSlices } from "@/lib/backend-scope";
import { registerBackendReset } from "./store-reset";

interface BrowserTabStoreState {
    byBackend: Record<string, BrowserTabListResponse>;
    initialByBackend: Record<string, boolean>;
    fetchBrowserTabs(backendId: string): Promise<void>;
}

// Keep the availability bit and the list in the same slice so a broadcast
// during bootstrap wins over both fields of an older response.
const slices = createSlices<BrowserTabListResponse>();
function publish(backendId: string, initial: boolean) {
    useBrowserTabStore.setState((state) => {
        const byBackend = Object.fromEntries(
            slices.read().map(({ backendId, tabs, hostAvailable }) => {
                const old = state.byBackend[backendId];
                return [
                    backendId,
                    old && old.tabs === tabs && old.hostAvailable === hostAvailable
                        ? old
                        : { tabs, hostAvailable },
                ];
            }),
        );
        const initialByBackend = Object.fromEntries(
            Object.keys(byBackend).map((id) => [
                id,
                id === backendId ? initial : (state.initialByBackend[id] ?? false),
            ]),
        );
        return { byBackend, initialByBackend };
    });
}
export const useBrowserTabStore = create<BrowserTabStoreState>(() => ({
    byBackend: {},
    initialByBackend: {},
    async fetchBrowserTabs(backendId) {
        const landed = await slices.load(backendId, async () => {
            const response = await sendRequest<BrowserTabListResponse>(
                backendId,
                MSG.BROWSER_TABS_LIST,
                {},
            );
            if (!validList(response)) throw new Error("Invalid browser tab list");
            return [response];
        });
        if (landed) publish(backendId, true);
    },
}));
registerBackendReset("browser-tab-store", (backendId) => {
    slices.drop(backendId);
    publish(backendId, false);
});
function validList(response: unknown): response is BrowserTabListResponse {
    return (
        typeof response === "object" &&
        response !== null &&
        "tabs" in response &&
        Array.isArray(response.tabs) &&
        "hostAvailable" in response &&
        typeof response.hostAvailable === "boolean"
    );
}
const unsubscribe = onEvent(MSG.BROWSER_TABS_LIST, (payload, backendId) => {
    const response = payload;
    if (!validList(response)) return;
    slices.apply(backendId, () => [{ ...response, backendId }]);
    publish(backendId, !useBrowserTabStore.getState().byBackend[backendId]);
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);

/** The native host belongs only to the desktop app's attached local backend. */
export function backendHostsBrowser(
    backendId: string | null,
    electron: boolean,
    machines: readonly { id: string; isLocal: boolean }[],
    registry: BrowserTabListResponse | undefined,
): boolean {
    return (
        electron &&
        machines.some((machine) => machine.id === backendId && machine.isLocal) &&
        registry?.hostAvailable === true
    );
}

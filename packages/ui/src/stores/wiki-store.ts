import { create } from "zustand";
import { MSG } from "@taskflow/shared";
import type { WikiIndexData, WikiIndexPayload } from "@taskflow/shared";
import { sendRequest, onEvent } from "@/hooks/useWebSocket";

interface WikiStore {
    indexByRoot: Record<string, WikiIndexData>;
    /** Roots whose value failed to resolve to a usable directory. */
    errorByRoot: Record<string, string>;
    fetchIndex(root: string): Promise<void>;
}

const inFlight = new Set<string>();

export const useWikiStore = create<WikiStore>((set) => ({
    indexByRoot: {},
    errorByRoot: {},
    async fetchIndex(root) {
        if (inFlight.has(root)) return;
        inFlight.add(root);
        try {
            const payload: WikiIndexPayload = { root };
            const data = await sendRequest<WikiIndexData>(MSG.WIKI_INDEX, payload);
            set((s) => {
                const { [root]: _dropped, ...errors } = s.errorByRoot;
                return { indexByRoot: { ...s.indexByRoot, [root]: data }, errorByRoot: errors };
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to read the wiki";
            set((s) => ({ errorByRoot: { ...s.errorByRoot, [root]: message } }));
        } finally {
            inFlight.delete(root);
        }
    },
}));

const _unsubWikiIndexChanged = onEvent(MSG.WIKI_INDEX_CHANGED, (payload) => {
    const data = payload as WikiIndexData;
    useWikiStore.setState((s) => ({ indexByRoot: { ...s.indexByRoot, [data.root]: data } }));
});

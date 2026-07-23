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

/**
 * A push names the root the *backend* indexed, which is `realpath(root)` — not
 * necessarily the path the renderer asked about. Update every key whose cached
 * index came from that same backend root, or a symlinked wiki would load once
 * and then silently stop tracking the watcher.
 */
const _unsubWikiIndexChanged = onEvent(MSG.WIKI_INDEX_CHANGED, (payload) => {
    const data = payload as WikiIndexData;
    useWikiStore.setState((s) => {
        const next = { ...s.indexByRoot, [data.root]: data };
        for (const [key, cached] of Object.entries(s.indexByRoot)) {
            if (cached.root === data.root) next[key] = data;
        }
        return { indexByRoot: next };
    });
});

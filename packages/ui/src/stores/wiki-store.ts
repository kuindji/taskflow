import { create } from "zustand";
import { MSG } from "@taskflow/shared";
import type { WikiIndexData, WikiIndexPayload } from "@taskflow/shared";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

interface WikiStore {
    /**
     * Per machine, then by the root the renderer asked about. One repository
     * can sit at one path on two machines, and each has its own pages.
     */
    indexByBackend: Record<string, Record<string, WikiIndexData>>;
    /** Roots whose value failed to resolve to a usable directory, per machine. */
    errorByBackend: Record<string, Record<string, string>>;
    fetchIndex(backendId: string, root: string): Promise<void>;
}

/** Roots with a request out, per machine. A detach drops the machine's set. */
const inFlight = new Map<string, Set<string>>();

export const useWikiStore = create<WikiStore>((set) => ({
    indexByBackend: {},
    errorByBackend: {},
    async fetchIndex(backendId, root) {
        let roots = inFlight.get(backendId);
        if (roots?.has(root)) return;
        if (!roots) {
            roots = new Set();
            inFlight.set(backendId, roots);
        }
        roots.add(root);
        try {
            const payload: WikiIndexPayload = { root };
            const data = await sendRequest<WikiIndexData>(backendId, MSG.WIKI_INDEX, payload);
            // Detached while the request was out: the answer is a dropped machine's.
            if (inFlight.get(backendId) !== roots) return;
            set((s) => {
                const { [root]: _dropped, ...errors } = s.errorByBackend[backendId] ?? {};
                return {
                    indexByBackend: {
                        ...s.indexByBackend,
                        [backendId]: { ...s.indexByBackend[backendId], [root]: data },
                    },
                    errorByBackend: { ...s.errorByBackend, [backendId]: errors },
                };
            });
        } catch (err: unknown) {
            if (inFlight.get(backendId) !== roots) return;
            const message = err instanceof Error ? err.message : "Failed to read the wiki";
            set((s) => ({
                errorByBackend: {
                    ...s.errorByBackend,
                    [backendId]: { ...s.errorByBackend[backendId], [root]: message },
                },
            }));
        } finally {
            roots.delete(root);
            if (roots.size === 0 && inFlight.get(backendId) === roots) inFlight.delete(backendId);
        }
    },
}));

registerBackendReset("wiki-store", (backendId) => {
    inFlight.delete(backendId);
    useWikiStore.setState((s) => {
        const { [backendId]: _index, ...indexByBackend } = s.indexByBackend;
        const { [backendId]: _errors, ...errorByBackend } = s.errorByBackend;
        return { indexByBackend, errorByBackend };
    });
});

/**
 * A push names the root the *backend* indexed, which is `realpath(root)` — not
 * necessarily the path the renderer asked about. Update every key whose cached
 * index came from that same backend root, or a symlinked wiki would load once
 * and then silently stop tracking the watcher. Only the delivering machine's
 * keys: another machine's copy of the repo at that path is unaffected.
 */
const _unsubWikiIndexChanged = onEvent(MSG.WIKI_INDEX_CHANGED, (payload, backendId) => {
    const data = payload as WikiIndexData;
    useWikiStore.setState((s) => {
        const held = s.indexByBackend[backendId] ?? {};
        const next = { ...held, [data.root]: data };
        for (const [key, cached] of Object.entries(held)) {
            if (cached.root === data.root) next[key] = data;
        }
        return { indexByBackend: { ...s.indexByBackend, [backendId]: next } };
    });
});

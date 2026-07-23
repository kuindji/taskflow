import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { WikiIndexData } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";

/**
 * The renderer asks for the root it resolved from the `wiki` attribute, but the
 * backend answers about `realpath(root)` and broadcasts under *that* path. When
 * the wiki root is a symlink the two differ, and a store keyed only on the
 * request path silently stops applying watcher updates.
 */
const listeners = new Map<string, (payload: unknown) => void>();
let response: WikiIndexData;

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: (type: string, handler: (payload: unknown) => void) => {
        listeners.set(type, handler);
        return () => listeners.delete(type);
    },
    sendRequest: () => Promise.resolve(response),
    sendFireAndForget: () => {},
    getBackendPort: () => 7100,
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

const { useWikiStore } = await import("./wiki-store");

function index(root: string, pageIds: string[]): WikiIndexData {
    return {
        root,
        rootExists: true,
        pages: pageIds.map((id) => ({
            id,
            path: `${id}.md`,
            title: id,
            parents: [],
            children: [],
            relatedPages: [],
            headings: [],
            links: [],
            brokenLinks: [],
            mtimeMs: 0,
        })),
        tree: [],
        backlinks: {},
        unresolved: [],
        orphans: [],
    };
}

const REQUESTED = "/w/link/wiki";
const RESOLVED = "/w/real/wiki";

describe("wiki-store", () => {
    beforeEach(() => {
        useWikiStore.setState({ indexByRoot: {}, errorByRoot: {} });
    });

    it("applies a watcher push that names the resolved root to the requested root", async () => {
        response = index(RESOLVED, ["a"]);
        await useWikiStore.getState().fetchIndex(REQUESTED);
        expect(useWikiStore.getState().indexByRoot[REQUESTED]?.pages).toHaveLength(1);

        listeners.get(MSG.WIKI_INDEX_CHANGED)?.(index(RESOLVED, ["a", "b"]));

        expect(useWikiStore.getState().indexByRoot[REQUESTED]?.pages.map((p) => p.id)).toEqual([
            "a",
            "b",
        ]);
    });
});

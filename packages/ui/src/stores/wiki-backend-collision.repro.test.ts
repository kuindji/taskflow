/**
 * Plan review repro for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Unlike the repros in plan-review/, this one runs against the REAL store,
 * because the defect is that the plan leaves it untouched: wiki-store is never
 * mentioned in the plan, is absent from the store-reset enumeration list in
 * Task 10 Step 1, and keys everything by absolute root path — the exact
 * collision Task 14 fixes for fileStatCache and Task 15 for Monaco model URIs.
 *
 * The assertions below state the WRONG behaviour. Delete this file when the
 * store grows a backend dimension.
 *
 * Run it on its own:
 *     bun test ./packages/ui/src/stores/wiki-backend-collision.repro.test.ts
 * Under a whole-suite `bun test` it fails, because bun's mock.module is global
 * and other files in the suite mock the same "@/hooks/useWebSocket" path. That
 * is a property of the harness, not of the defect.
 */
import { describe, expect, mock, test } from "bun:test";
import type { WikiIndexData } from "@taskflow/shared";

/** Which machine answers the next WIKI_INDEX request. */
let answeringMachine = "desktop";

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: () => () => {},
    sendRequest: (_type: string, payload: unknown) =>
        Promise.resolve(index((payload as { root: string }).root, answeringMachine)),
    sendFireAndForget: () => {},
    getBackendPort: () => 7100,
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

const { useWikiStore } = await import("./wiki-store");

function index(root: string, machine: string): WikiIndexData {
    return {
        root,
        rootExists: true,
        pages: [
            {
                id: `${machine}-page`,
                path: `${machine}-page.md`,
                title: `${machine} page`,
                parents: [],
                children: [],
                relatedPages: [],
                headings: [],
                links: [],
                brokenLinks: [],
                mtimeMs: 0,
            },
        ],
        tree: [],
        backlinks: {},
        unresolved: [],
        orphans: [],
    };
}

describe("wiki-store has no backend dimension", () => {
    test("two machines holding the same repo path share one wiki index entry", async () => {
        // The case this whole feature exists for: one repo checked out at the
        // same absolute path on the laptop and on the desktop.
        const root = "/Users/me/repo";

        // Open the desktop project's wiki from the laptop.
        answeringMachine = "desktop";
        await useWikiStore.getState().fetchIndex(root);
        expect(useWikiStore.getState().indexByRoot[root]?.pages[0]?.id).toBe("desktop-page");

        // Now open the laptop's OWN copy of the same repo, at the same path.
        answeringMachine = "laptop";
        await useWikiStore.getState().fetchIndex(root);

        // The bug: fetchIndex(root) takes no backend and indexByRoot is keyed by
        // root alone, so there is one entry for two machines and the later fetch
        // clobbers the earlier one. The desktop project's wiki pane now renders
        // the laptop's pages. A WIKI_INDEX_CHANGED broadcast from either machine
        // does the same thing, and after Task 11 it arrives WITH a backendId
        // that this store has no place to put.
        expect(Object.keys(useWikiStore.getState().indexByRoot)).toEqual([root]);
        expect(useWikiStore.getState().indexByRoot[root]?.pages[0]?.id).toBe("laptop-page");
    });
});

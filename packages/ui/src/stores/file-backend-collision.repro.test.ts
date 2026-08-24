/**
 * Plan review repro for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * file-store is never mentioned in the plan (grep it) and is absent from the
 * store-reset enumeration list in Task 10 Step 1, yet it holds a single
 * `watchedPath` string with no backend dimension.
 *
 * The assertions below state the WRONG behaviour. Delete this file when the
 * store grows a backend dimension.
 */
import { describe, expect, mock, test } from "bun:test";
import { MSG } from "@taskflow/shared";

const sent: { type: string; payload: unknown }[] = [];

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: () => () => {},
    sendRequest: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        if (type === MSG.FILE_TREE) return Promise.resolve({ tree: [] });
        return Promise.resolve({});
    },
    sendFireAndForget: (type: string, payload: unknown) => {
        sent.push({ type, payload });
    },
    getBackendPort: () => 7100,
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

const { useFileStore } = await import("./file-store");

describe("file-store has no backend dimension", () => {
    test("opening the same path on a second machine never sends it a FILE_WATCH", async () => {
        const root = "/Users/me/repo";

        // The laptop opens the desktop project's file explorer.
        await useFileStore.getState().watchPath(root);
        const afterFirst = sent.filter((m) => m.type === MSG.FILE_WATCH).length;
        expect(afterFirst).toBe(1);

        // Now the laptop opens its OWN copy of the same repo, at the same path.
        // A different machine, so it needs its own watch on its own backend.
        await useFileStore.getState().watchPath(root);

        // The bug: watchPath compares `previousPath === path` and returns early
        // (file-store.ts:181-183). The second backend is never watched, so its
        // file changes never arrive. The FILE_CHANGED listener has the same
        // hole — it filters on event.path.startsWith(watchedPath) and ignores
        // which backend delivered the event, so the other machine's writes
        // refresh this tree.
        expect(sent.filter((m) => m.type === MSG.FILE_WATCH).length).toBe(1);
    });
});

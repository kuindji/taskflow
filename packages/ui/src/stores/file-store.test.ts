// packages/ui/src/stores/file-store.test.ts
import { describe, expect, mock, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { FileNode } from "@taskflow/shared";

const sent: { type: string; payload: unknown }[] = [];
const handlers = new Map<string, (payload: unknown) => void>();

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: (type: string, handler: (payload: unknown) => void) => {
        handlers.set(type, handler);
        return () => {};
    },
    sendRequest: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        if (type === MSG.FILE_LIST_DIR) return Promise.resolve({ entries: [], gitignorePatterns: [] });
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

const root = "/repo";
const tree: FileNode = {
    name: "repo",
    path: root,
    type: "directory",
    loaded: true,
    children: [
        {
            name: "src",
            path: `${root}/src`,
            type: "directory",
            loaded: true,
            children: [
                { name: "deep", path: `${root}/src/deep`, type: "directory", loaded: true, children: [] },
                { name: "closed", path: `${root}/src/closed`, type: "directory", children: [] },
            ],
        },
        { name: "docs", path: `${root}/docs`, type: "directory", loaded: true, children: [] },
    ],
};

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
}

function listedDirs(): string[] {
    return sent
        .filter((m) => m.type === MSG.FILE_LIST_DIR)
        .map((m) => (m.payload as { path: string }).path)
        .sort();
}

describe("file-store recursive change events", () => {
    test("a recursive event refetches every loaded directory at or under its path", async () => {
        await useFileStore.getState().watchPath(root);
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/src`, recursive: true });
        await settle();

        // Loaded dirs at or under the path, plus the path's parent (the dir itself may be gone).
        expect(listedDirs()).toEqual([root, `${root}/src`, `${root}/src/deep`]);
    });

    test("a recursive event below the root also refreshes the nearest loaded parent", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        // The collapsed directory may itself have been deleted; only its parent's listing can show that.
        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/src/deep`, recursive: true });
        await settle();

        expect(listedDirs()).toEqual([`${root}/src`, `${root}/src/deep`]);
    });

    test("a plain event still refetches only the parent directory", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([`${root}/docs`]);
    });

    test("an event for a sibling path that merely shares the root's prefix is ignored", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}-old/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([]);
    });
});

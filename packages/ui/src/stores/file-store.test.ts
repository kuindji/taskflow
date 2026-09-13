// packages/ui/src/stores/file-store.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { FileNode } from "@taskflow/shared";

/** Requests that still go through the primary-routed shim (directory listings). */
const sent: { type: string; payload: unknown }[] = [];

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: () => () => {},
    sendRequest: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        if (type === MSG.FILE_LIST_DIR)
            return Promise.resolve({ entries: [], gitignorePatterns: [] });
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
const { closeConnection, openConnection } = await import("@/lib/connection-registry");
const { startTestServer } = await import("@/lib/test-ws-server");
const { resetBackend } = await import("./store-reset");

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
                {
                    name: "deep",
                    path: `${root}/src/deep`,
                    type: "directory",
                    loaded: true,
                    children: [],
                },
                { name: "closed", path: `${root}/src/closed`, type: "directory", children: [] },
            ],
        },
        { name: "docs", path: `${root}/docs`, type: "directory", loaded: true, children: [] },
    ],
};

// Two machines, each holding the same repository at the same path.
const desktop = startTestServer("desktop");
const laptop = startTestServer("laptop");

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
}

function listedDirs(): string[] {
    return sent
        .filter((m) => m.type === MSG.FILE_LIST_DIR)
        .map((m) => (m.payload as { path: string }).path)
        .sort();
}

function watchRequests(server: typeof desktop, type: string): unknown[] {
    return server.received.filter((m) => m.type === type).map((m) => m.payload);
}

beforeAll(async () => {
    await openConnection("desktop", desktop.origin);
    await openConnection("laptop", laptop.origin);
    // Subscribes the store to change events.
    await useFileStore.getState().watchPath("desktop", root);
});

beforeEach(() => {
    useFileStore.setState({ tree, treePath: root, watched: { backendId: "desktop", path: root } });
    sent.length = 0;
});

afterAll(() => {
    for (const id of ["desktop", "laptop"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    desktop.stop();
    laptop.stop();
});

describe("file-store recursive change events", () => {
    test("a recursive event refetches every loaded directory at or under its path", async () => {
        desktop.broadcast(MSG.FILE_CHANGED, {
            type: "modify",
            path: `${root}/src`,
            recursive: true,
        });
        await settle();

        // Loaded dirs at or under the path, plus the path's parent (the dir itself may be gone).
        expect(listedDirs()).toEqual([root, `${root}/src`, `${root}/src/deep`]);
    });

    test("a recursive event below the root also refreshes the nearest loaded parent", async () => {
        // The collapsed directory may itself have been deleted; only its parent's listing can show that.
        desktop.broadcast(MSG.FILE_CHANGED, {
            type: "modify",
            path: `${root}/src/deep`,
            recursive: true,
        });
        await settle();

        expect(listedDirs()).toEqual([`${root}/src`, `${root}/src/deep`]);
    });

    test("a plain event still refetches only the parent directory", async () => {
        desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([`${root}/docs`]);
    });

    test("an event for a sibling path that merely shares the root's prefix is ignored", async () => {
        desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}-old/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([]);
    });
});

describe("file-store across machines", () => {
    test("a change on another machine at the watched path does not refresh this tree", async () => {
        laptop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([]);
    });

    test("opening the same path on a second machine watches it there and releases the first", async () => {
        desktop.received.length = 0;
        laptop.received.length = 0;

        await useFileStore.getState().watchPath("laptop", root);

        expect(watchRequests(laptop, MSG.FILE_WATCH)).toEqual([{ path: root }]);
        expect(watchRequests(desktop, MSG.FILE_UNWATCH)).toEqual([{ path: root }]);
        expect(useFileStore.getState().watched).toEqual({ backendId: "laptop", path: root });
    });

    test("detaching the watched machine forgets its watch, and only that machine's", () => {
        resetBackend("laptop");
        expect(useFileStore.getState().watched).toEqual({ backendId: "desktop", path: root });

        resetBackend("desktop");
        expect(useFileStore.getState().watched).toBeNull();
    });
});

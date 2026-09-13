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
/** While set, desktop's next FILE_UNWATCH answer (that one only) waits for it. */
let desktopNextUnwatchHold: Promise<void> | null = null;
const desktop = startTestServer("desktop", (type) => {
    if (type !== MSG.FILE_UNWATCH || !desktopNextUnwatchHold) return { from: "desktop" };
    const hold = desktopNextUnwatchHold;
    desktopNextUnwatchHold = null;
    return hold.then(() => ({ from: "desktop" }));
});
/** While set, laptop's FILE_WATCH answers wait for it. */
let laptopWatchHold: Promise<void> | null = null;
const laptop = startTestServer("laptop", (type) =>
    type === MSG.FILE_WATCH && laptopWatchHold
        ? laptopWatchHold.then(() => ({ from: "laptop" }))
        : { from: "laptop" },
);

/** Holds laptop's watch answers until the returned function is called. */
function holdLaptopWatch(): () => void {
    let release = () => {};
    laptopWatchHold = new Promise<void>((resolve) => {
        release = resolve;
    });
    return () => {
        laptopWatchHold = null;
        release();
    };
}

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) await Bun.sleep(5);
}

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

    test("a watch that lands after the pane moved to another machine is released where it landed", async () => {
        useFileStore.setState({ watched: null });
        desktop.received.length = 0;
        laptop.received.length = 0;
        const release = holdLaptopWatch();

        const late = useFileStore.getState().watchPath("laptop", root);
        await until(() => watchRequests(laptop, MSG.FILE_WATCH).length === 1);
        await useFileStore.getState().unwatchPath("laptop", root);
        await useFileStore.getState().watchPath("desktop", `${root}-other`);
        release();
        await late;
        await until(() => watchRequests(laptop, MSG.FILE_UNWATCH).length > 0);

        expect(watchRequests(laptop, MSG.FILE_UNWATCH)).toEqual([{ path: root }]);
        expect(useFileStore.getState().watched).toEqual({
            backendId: "desktop",
            path: `${root}-other`,
        });
    });

    test("a watch unwatched before it lands is released and not recorded", async () => {
        useFileStore.setState({ watched: null });
        laptop.received.length = 0;
        const release = holdLaptopWatch();

        const late = useFileStore.getState().watchPath("laptop", root);
        await until(() => watchRequests(laptop, MSG.FILE_WATCH).length === 1);
        await useFileStore.getState().unwatchPath("laptop", root);
        release();
        await late;
        await until(() => watchRequests(laptop, MSG.FILE_UNWATCH).length > 0);

        expect(watchRequests(laptop, MSG.FILE_UNWATCH)).toEqual([{ path: root }]);
        expect(useFileStore.getState().watched).toBeNull();
    });

    test("an unwatch answered after the next watch landed does not forget that watch", async () => {
        desktop.received.length = 0;
        laptop.received.length = 0;
        let release = () => {};
        desktopNextUnwatchHold = new Promise<void>((resolve) => {
            release = resolve;
        });

        // The pane closes on desktop, and before desktop answers it opens on laptop.
        const slowUnwatch = useFileStore.getState().unwatchPath("desktop", root);
        await until(() => watchRequests(desktop, MSG.FILE_UNWATCH).length === 1);
        await useFileStore.getState().watchPath("laptop", root);
        expect(useFileStore.getState().watched).toEqual({ backendId: "laptop", path: root });
        release();
        await slowUnwatch;

        expect(useFileStore.getState().watched).toEqual({ backendId: "laptop", path: root });
    });

    test("a move to another machine cancelled while the old watch is released forgets the old watch", async () => {
        desktop.received.length = 0;
        let release = () => {};
        desktopNextUnwatchHold = new Promise<void>((resolve) => {
            release = resolve;
        });

        // The pane moves to laptop, and closes before desktop has released its watch.
        const move = useFileStore.getState().watchPath("laptop", root);
        await until(() => watchRequests(desktop, MSG.FILE_UNWATCH).length === 1);
        await useFileStore.getState().unwatchPath("laptop", root);
        release();
        await move;

        expect(useFileStore.getState().watched).toBeNull();
        // Reopening it on desktop watches again: desktop holds no watch any more.
        await useFileStore.getState().watchPath("desktop", root);
        expect(watchRequests(desktop, MSG.FILE_WATCH)).toEqual([{ path: root }]);
    });

    test("detaching the watched machine forgets its watch, and only that machine's", () => {
        resetBackend("laptop");
        expect(useFileStore.getState().watched).toEqual({ backendId: "desktop", path: root });

        resetBackend("desktop");
        expect(useFileStore.getState().watched).toBeNull();
    });
});

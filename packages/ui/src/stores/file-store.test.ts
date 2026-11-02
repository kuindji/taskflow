// packages/ui/src/stores/file-store.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { FileDiskReadResponse, FileNode } from "@taskflow/shared";
import { useFileStore } from "./file-store";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer } from "@/lib/test-ws-server";
import { resetBackend } from "./store-reset";
import { notifyBackendReady } from "@/lib/backend-ready";

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

const EMPTY_LISTING = { entries: [], gitignorePatterns: [] };

// Two machines, each holding the same repository at the same path.
/** While set, desktop's next FILE_UNWATCH answer (that one only) waits for it. */
let desktopNextUnwatchHold: Promise<void> | null = null;
let readResponse: FileDiskReadResponse = { content: "", hash: "empty" };
/** While set, desktop's git status answers wait for it. */
let desktopGitStatusHold: Promise<void> | null = null;
/** Desktop's shallow listings by directory; any other directory lists empty. */
let desktopListings: Record<string, FileNode[]> = {};
/** While set, desktop's next listing is taken at once but answered only when it resolves. */
let desktopNextListingHold: Promise<void> | null = null;
const desktop = startTestServer("desktop", (type, payload) => {
    if (type === MSG.FILE_READ) return readResponse;
    if (type === MSG.FILE_WRITE) return { success: true, hash: "written" };
    if (type === MSG.GIT_STATUS && desktopGitStatusHold) {
        return desktopGitStatusHold.then(() => ({ status: null }));
    }
    if (type === MSG.FILE_LIST_DIR) {
        const entries = desktopListings[(payload as { path: string }).path];
        const listing = entries ? { entries, gitignorePatterns: [] } : EMPTY_LISTING;
        const hold = desktopNextListingHold;
        desktopNextListingHold = null;
        return hold ? hold.then(() => listing) : listing;
    }
    if (type !== MSG.FILE_UNWATCH || !desktopNextUnwatchHold) return { from: "desktop" };
    const hold = desktopNextUnwatchHold;
    desktopNextUnwatchHold = null;
    return hold.then(() => ({ from: "desktop" }));
});
/** While set, laptop's FILE_WATCH answers wait for it. */
let laptopWatchHold: Promise<void> | null = null;
const laptop = startTestServer("laptop", (type) => {
    if (type === MSG.FILE_LIST_DIR) return EMPTY_LISTING;
    return type === MSG.FILE_WATCH && laptopWatchHold
        ? laptopWatchHold.then(() => ({ from: "laptop" }))
        : { from: "laptop" };
});

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

function listedDirs(server: typeof desktop): string[] {
    return server.received
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
    useFileStore.getState().watchPath("desktop", root);
    await until(() => watchRequests(desktop, MSG.FILE_WATCH).length === 1);
});

beforeEach(() => {
    useFileStore.setState({
        tree,
        treePath: root,
        treeBackendId: "desktop",
        loadingDirs: new Set<string>(),
        watched: { backendId: "desktop", path: root },
    });
    desktopListings = {};
    desktop.received.length = 0;
    laptop.received.length = 0;
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
        expect(listedDirs(desktop)).toEqual([root, `${root}/src`, `${root}/src/deep`]);
    });

    test("a recursive event below the root also refreshes the nearest loaded parent", async () => {
        // The collapsed directory may itself have been deleted; only its parent's listing can show that.
        desktop.broadcast(MSG.FILE_CHANGED, {
            type: "modify",
            path: `${root}/src/deep`,
            recursive: true,
        });
        await settle();

        expect(listedDirs(desktop)).toEqual([`${root}/src`, `${root}/src/deep`]);
    });

    test("a plain event still refetches only the parent directory", async () => {
        desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs(desktop)).toEqual([`${root}/docs`]);
    });

    test("refreshing a directory keeps the listings already loaded below it", async () => {
        // The backend lists one level: its directories come back without children.
        desktopListings = {
            [root]: [
                { name: "src", path: `${root}/src`, type: "directory" },
                { name: "docs", path: `${root}/docs`, type: "directory" },
                { name: "README.md", path: `${root}/README.md`, type: "file" },
            ],
        };
        desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}/README.md` });
        await settle();

        const refreshed = useFileStore.getState().tree;
        expect(refreshed?.children?.map((c) => c.name)).toEqual(["src", "docs", "README.md"]);
        const src = refreshed?.children?.find((c) => c.name === "src");
        expect(src?.loaded).toBe(true);
        expect(src?.children?.map((c) => c.path)).toEqual([
            `${root}/src/deep`,
            `${root}/src/closed`,
        ]);
    });

    test("a change while its directory's listing is answered lists that directory again", async () => {
        const first = { name: "first.ts", path: `${root}/docs/first.ts`, type: "file" as const };
        const second = { name: "second.ts", path: `${root}/docs/second.ts`, type: "file" as const };
        let release = () => {};
        desktopNextListingHold = new Promise<void>((resolve) => {
            release = resolve;
        });
        desktopListings = { [`${root}/docs`]: [first] };
        desktop.broadcast(MSG.FILE_CHANGED, { type: "add", path: first.path });
        await until(() => listedDirs(desktop).length === 1);

        // The first listing was taken before second.ts existed.
        desktopListings = { [`${root}/docs`]: [first, second] };
        desktop.broadcast(MSG.FILE_CHANGED, { type: "add", path: second.path });
        await settle();
        release();
        await until(() => listedDirs(desktop).length === 2);
        await settle();

        const docs = useFileStore.getState().tree?.children?.find((c) => c.name === "docs");
        expect(docs?.children?.map((c) => c.name)).toEqual(["first.ts", "second.ts"]);
    });

    test("an event for a sibling path that merely shares the root's prefix is ignored", async () => {
        desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}-old/docs/a.md` });
        await settle();

        expect(listedDirs(desktop)).toEqual([]);
    });
});

describe("file-store across machines", () => {
    test("a change on another machine at the watched path does not refresh this tree", async () => {
        laptop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs(desktop)).toEqual([]);
        expect(listedDirs(laptop)).toEqual([]);
    });

    test("expanding a directory lists it on the machine that listed the tree", async () => {
        // Same path on both machines: only the tree's own machine knows its contents.
        useFileStore.setState({ treeBackendId: "laptop" });

        await useFileStore.getState().expandDir(`${root}/src/closed`);

        expect(listedDirs(laptop)).toEqual([`${root}/src/closed`]);
        expect(listedDirs(desktop)).toEqual([]);
    });

    test("opening the same path on a second machine watches it there and releases the first", async () => {
        useFileStore.getState().watchPath("laptop", root);
        expect(useFileStore.getState().watched).toEqual({ backendId: "laptop", path: root });
        await until(() => watchRequests(desktop, MSG.FILE_UNWATCH).length === 1);
        await until(() => watchRequests(laptop, MSG.FILE_WATCH).length === 1);

        expect(watchRequests(laptop, MSG.FILE_WATCH)).toEqual([{ path: root }]);
        expect(watchRequests(desktop, MSG.FILE_UNWATCH)).toEqual([{ path: root }]);

        // Back on desktop for the tests that follow.
        useFileStore.getState().watchPath("desktop", root);
        await until(() => watchRequests(desktop, MSG.FILE_WATCH).length === 1);
        await until(() => watchRequests(laptop, MSG.FILE_UNWATCH).length === 1);
    });

    test("closing the explorer keeps the watch a preview still holds", async () => {
        const releasePreview = useFileStore.getState().retainWatch("desktop", root);
        useFileStore.getState().unwatchPath("desktop", root);
        expect(useFileStore.getState().watched).toBeNull();
        await settle();
        expect(watchRequests(desktop, MSG.FILE_UNWATCH)).toEqual([]);

        // Reopened, the explorer shares that watch: nothing is sent.
        useFileStore.getState().watchPath("desktop", root);
        releasePreview();
        await settle();
        expect(watchRequests(desktop, MSG.FILE_WATCH)).toEqual([]);
        expect(watchRequests(desktop, MSG.FILE_UNWATCH)).toEqual([]);
        expect(useFileStore.getState().watched).toEqual({ backendId: "desktop", path: root });
    });

    test("detaching the watched machine forgets its watch, and only that machine's", () => {
        resetBackend("laptop");
        expect(useFileStore.getState().watched).toEqual({ backendId: "desktop", path: root });

        resetBackend("desktop");
        expect(useFileStore.getState().watched).toBeNull();
    });
});

describe("file-store counted watches", () => {
    const path = "/counted";

    function requests(server: typeof desktop): string[] {
        return server.received
            .filter(
                (m) =>
                    (m.type === MSG.FILE_WATCH || m.type === MSG.FILE_UNWATCH) &&
                    (m.payload as { path: string }).path === path,
            )
            .map((m) => m.type);
    }

    test("holders of one path share one watch, released with the last of them", async () => {
        const first = useFileStore.getState().retainWatch("desktop", path);
        const second = useFileStore.getState().retainWatch("desktop", path);
        await settle();
        expect(requests(desktop)).toEqual([MSG.FILE_WATCH]);

        first();
        // A release called twice counts once: the other holder keeps the watch.
        first();
        await settle();
        expect(requests(desktop)).toEqual([MSG.FILE_WATCH]);

        second();
        await settle();
        expect(requests(desktop)).toEqual([MSG.FILE_WATCH, MSG.FILE_UNWATCH]);
    });

    test("the same path on two machines is two watches", async () => {
        const onDesktop = useFileStore.getState().retainWatch("desktop", path);
        const onLaptop = useFileStore.getState().retainWatch("laptop", path);
        await settle();
        onDesktop();
        await settle();

        expect(requests(desktop)).toEqual([MSG.FILE_WATCH, MSG.FILE_UNWATCH]);
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH]);
        onLaptop();
        await settle();
    });

    test("a watch released before it lands is released once it lands", async () => {
        const answer = holdLaptopWatch();
        const release = useFileStore.getState().retainWatch("laptop", path);
        await until(() => requests(laptop).length === 1);
        release();
        await settle();
        // Not sent ahead of the watch's answer, which the backend could handle after it.
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH]);

        answer();
        await until(() => requests(laptop).length === 2);
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH, MSG.FILE_UNWATCH]);
    });

    test("a watch taken again while its release is answered is sent after that answer", async () => {
        const first = useFileStore.getState().retainWatch("desktop", path);
        await until(() => requests(desktop).length === 1);
        let answer = () => {};
        desktopNextUnwatchHold = new Promise<void>((resolve) => {
            answer = resolve;
        });
        first();
        await until(() => requests(desktop).length === 2);
        const second = useFileStore.getState().retainWatch("desktop", path);
        await settle();
        expect(requests(desktop)).toEqual([MSG.FILE_WATCH, MSG.FILE_UNWATCH]);

        answer();
        await until(() => requests(desktop).length === 3);
        expect(requests(desktop)).toEqual([MSG.FILE_WATCH, MSG.FILE_UNWATCH, MSG.FILE_WATCH]);
        second();
        await settle();
    });

    test("a machine that comes back is asked again for every watch still held", async () => {
        const held = useFileStore.getState().retainWatch("desktop", path);
        const other = useFileStore.getState().retainWatch("desktop", `${path}-released`);
        await settle();
        other();
        await settle();
        desktop.received.length = 0;

        notifyBackendReady("desktop");
        await settle();

        expect(requests(desktop)).toEqual([MSG.FILE_WATCH]);
        expect(watchRequests(desktop, MSG.FILE_WATCH)).not.toContainEqual({
            path: `${path}-released`,
        });
        expect(watchRequests(laptop, MSG.FILE_WATCH)).toEqual([]);
        held();
        await settle();
    });

    test("detaching a machine drops its counts: a stale release sends nothing", async () => {
        const stale = useFileStore.getState().retainWatch("laptop", path);
        await settle();
        resetBackend("laptop");
        stale();
        await settle();
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH]);

        // A new holder after the detach watches afresh, and the stale release does not touch it.
        const fresh = useFileStore.getState().retainWatch("laptop", path);
        stale();
        await settle();
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH, MSG.FILE_WATCH]);
        fresh();
        await settle();
        expect(requests(laptop)).toEqual([MSG.FILE_WATCH, MSG.FILE_WATCH, MSG.FILE_UNWATCH]);
    });
});

for (const [state, message] of [
    ["tooLarge", "File preview exceeds 5 MiB"],
    ["binary", "Binary file preview is unavailable"],
] as const) {
    test(`${state} rejects with ${message}`, async () => {
        readResponse = { state };
        const error = await useFileStore
            .getState()
            .readFile("desktop", "/repo/file")
            .catch((error: unknown) => error);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(message);
        expect((error as Error & { state: string }).state).toBe(state);
    });
}
test("an empty complete file still returns an empty string, with its hash", async () => {
    readResponse = { content: "", hash: "empty" };
    expect(await useFileStore.getState().readFile("desktop", "/repo/file")).toEqual({
        content: "",
        hash: "empty",
    });
});

test("a write's answer reaches the caller without waiting on the git status refresh", async () => {
    let answerStatus = () => {};
    desktopGitStatusHold = new Promise<void>((resolve) => {
        answerStatus = resolve;
    });
    try {
        // The explorer watches the repository, so the write refreshes its status.
        const result = await useFileStore.getState().writeFile("desktop", `${root}/a.ts`, "text");
        expect(result).toEqual({ success: true, hash: "written" });
        // ...and that refresh is still unanswered.
        await until(() => watchRequests(desktop, MSG.GIT_STATUS).length === 1);
    } finally {
        desktopGitStatusHold = null;
        answerStatus();
    }
});

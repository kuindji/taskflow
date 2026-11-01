import { afterEach, describe, expect, it } from "bun:test";
import type { WikiIndexData } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { notifyBackendReady } from "@/lib/backend-ready";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { resetBackend } from "./store-reset";
import { useWikiStore } from "./wiki-store";

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

const servers: TestServer[] = [];

/** A machine whose backend answers every WIKI_INDEX with `answer`. */
async function attach(
    backendId: string,
    answer: WikiIndexData | (() => WikiIndexData),
): Promise<TestServer> {
    const server = startTestServer(backendId, () =>
        typeof answer === "function" ? answer() : answer,
    );
    servers.push(server);
    await openConnection(backendId, server.origin);
    return server;
}

function pageIds(backendId: string, root: string): string[] | undefined {
    return useWikiStore.getState().indexByBackend[backendId]?.[root]?.pages.map((page) => page.id);
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the store");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
});

/**
 * The renderer asks for the root it resolved from the `wiki` attribute, but the
 * backend answers about `realpath(root)` and broadcasts under *that* path. When
 * the wiki root is a symlink the two differ, and a store keyed only on the
 * request path silently stops applying watcher updates.
 */
const REQUESTED = "/w/link/wiki";
const RESOLVED = "/w/real/wiki";
/** One repository checked out at the same path on two machines. */
const SHARED = "/Users/me/repo/docs/wiki";

describe("wiki-store", () => {
    it("applies a watcher push that names the resolved root to the requested root", async () => {
        const server = await attach("a", index(RESOLVED, ["a"]));
        await useWikiStore.getState().fetchIndex("a", REQUESTED);
        expect(pageIds("a", REQUESTED)).toEqual(["a"]);

        server.broadcast(MSG.WIKI_INDEX_CHANGED, index(RESOLVED, ["a", "b"]));

        await until(() => pageIds("a", REQUESTED)?.length === 2);
        expect(pageIds("a", REQUESTED)).toEqual(["a", "b"]);
    });

    it("two machines holding the same wiki path keep their own pages", async () => {
        await attach("a", index(SHARED, ["desktop-page"]));
        await attach("b", index(SHARED, ["laptop-page"]));

        await useWikiStore.getState().fetchIndex("a", SHARED);
        await useWikiStore.getState().fetchIndex("b", SHARED);

        expect(pageIds("a", SHARED)).toEqual(["desktop-page"]);
        expect(pageIds("b", SHARED)).toEqual(["laptop-page"]);
    });

    it("a push from one machine leaves the other machine's copy of that path alone", async () => {
        const desktop = await attach("a", index(SHARED, ["desktop-page"]));
        await attach("b", index(SHARED, ["laptop-page"]));
        await useWikiStore.getState().fetchIndex("a", SHARED);
        await useWikiStore.getState().fetchIndex("b", SHARED);

        desktop.broadcast(MSG.WIKI_INDEX_CHANGED, index(SHARED, ["desktop-page", "new-page"]));

        await until(() => pageIds("a", SHARED)?.length === 2);
        expect(pageIds("b", SHARED)).toEqual(["laptop-page"]);
    });

    it("detaching a machine drops only its wiki indexes", async () => {
        await attach("a", index(SHARED, ["desktop-page"]));
        await attach("b", index(SHARED, ["laptop-page"]));
        await useWikiStore.getState().fetchIndex("a", SHARED);
        await useWikiStore.getState().fetchIndex("b", SHARED);

        closeConnection("a", "detach");
        resetBackend("a");

        expect(pageIds("a", SHARED)).toBeUndefined();
        expect(pageIds("b", SHARED)).toEqual(["laptop-page"]);
    });

    // A restarted backend has no wiki watcher until something asks for the
    // index again, and pushes sent while the socket was down are gone: the
    // store must re-read what it holds once the machine is ready again.
    it("re-reads a held wiki index when its machine is ready again", async () => {
        let answer = index(SHARED, ["before"]);
        const server = await attach("a", () => answer);
        await useWikiStore.getState().fetchIndex("a", SHARED);
        expect(pageIds("a", SHARED)).toEqual(["before"]);

        answer = index(SHARED, ["before", "while-down"]);
        notifyBackendReady("a");

        await until(() => pageIds("a", SHARED)?.length === 2);
        expect(server.received.filter((r) => r.type === MSG.WIKI_INDEX)).toHaveLength(2);
    });

    it("leaves other machines' indexes alone when one machine is ready again", async () => {
        await attach("a", index(SHARED, ["desktop-page"]));
        const laptop = await attach("b", index(SHARED, ["laptop-page"]));
        await useWikiStore.getState().fetchIndex("a", SHARED);
        await useWikiStore.getState().fetchIndex("b", SHARED);

        notifyBackendReady("a");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(laptop.received.filter((r) => r.type === MSG.WIKI_INDEX)).toHaveLength(1);
    });
});

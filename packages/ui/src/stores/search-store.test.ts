import { afterEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useSearchStore } from "./search-store";
import { resetBackend } from "./store-reset";

const servers: TestServer[] = [];

/**
 * A machine whose searches all get the id `search-<id>` and one matching file.
 * With `hold`, search answers wait for it.
 */
async function attach(backendId: string, hold?: Promise<void>): Promise<TestServer> {
    const server = startTestServer(backendId, (type) => {
        if (type !== MSG.SEARCH_QUERY) return {};
        const answer = {
            result: {
                searchId: `search-${backendId}`,
                totalMatches: 1,
                files: [{ path: `/repo/${backendId}.ts`, matches: [] }],
            },
        };
        return hold ? hold.then(() => answer) : answer;
    });
    servers.push(server);
    await openConnection(backendId, server.origin);
    return server;
}

function requests(server: TestServer, type: string): unknown[] {
    return server.received.filter((m) => m.type === type).map((m) => m.payload);
}

afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
    useSearchStore.getState().clear();
});

describe("search-store across machines", () => {
    test("a search after the workspace moved cancels the old search on its own machine", async () => {
        const desktop = await attach("a");
        const laptop = await attach("b");
        useSearchStore.getState().setQuery("needle");

        await useSearchStore.getState().search("a", "/repo");
        await useSearchStore.getState().search("b", "/repo");

        expect(requests(desktop, MSG.SEARCH_CANCEL)).toEqual([{ searchId: "search-a" }]);
        expect(requests(laptop, MSG.SEARCH_CANCEL)).toEqual([]);
        expect(useSearchStore.getState().searchId).toBe("search-b");
    });

    test("a replace goes to the machine whose results it acts on", async () => {
        const desktop = await attach("a");
        const laptop = await attach("b");
        useSearchStore.getState().setQuery("needle");
        await useSearchStore.getState().search("a", "/repo");

        await useSearchStore.getState().replaceInFile("/repo/a.ts");

        expect(requests(desktop, MSG.SEARCH_REPLACE_ALL)).toHaveLength(1);
        expect(requests(laptop, MSG.SEARCH_REPLACE_ALL)).toEqual([]);
    });

    test("a replace in results still shown while a search on another machine runs acts on the results' machine and root", async () => {
        let release = () => {};
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        const desktop = await attach("a");
        const laptop = await attach("b", hold);
        useSearchStore.getState().setQuery("needle");
        await useSearchStore.getState().search("a", "/repo-a");

        const pending = useSearchStore.getState().search("b", "/repo-b");
        while (requests(laptop, MSG.SEARCH_QUERY).length === 0) await Bun.sleep(5);
        await useSearchStore.getState().replaceInFile("/repo/a.ts");

        expect(requests(laptop, MSG.SEARCH_REPLACE_ALL)).toEqual([]);
        expect(requests(desktop, MSG.SEARCH_REPLACE_ALL)).toEqual([
            expect.objectContaining({ path: "/repo-a", filePath: "/repo/a.ts" }),
        ]);
        release();
        await pending;
        expect(useSearchStore.getState().searchId).toBe("search-b");
    });

    test("detaching the machine a running search asked drops its late answer", async () => {
        let release = () => {};
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        await attach("a");
        const laptop = await attach("b", hold);
        useSearchStore.getState().setQuery("needle");
        await useSearchStore.getState().search("a", "/repo");

        const pending = useSearchStore.getState().search("b", "/repo");
        while (requests(laptop, MSG.SEARCH_QUERY).length === 0) await Bun.sleep(5);
        resetBackend("b");
        release();
        await pending;

        // The new search cancelled a's id; a's results stay shown, b's answer never lands.
        expect(useSearchStore.getState().results.map((f) => f.path)).toEqual(["/repo/a.ts"]);
        expect(useSearchStore.getState().searchBackendId).toBe("a");
        expect(useSearchStore.getState().searching).toBe(false);
    });

    test("detaching the searched machine drops its results and keeps the query", async () => {
        await attach("a");
        useSearchStore.getState().setQuery("needle");
        await useSearchStore.getState().search("a", "/repo");

        resetBackend("b");
        expect(useSearchStore.getState().results).toHaveLength(1);

        resetBackend("a");
        expect(useSearchStore.getState().results).toEqual([]);
        expect(useSearchStore.getState().searchId).toBeNull();
        expect(useSearchStore.getState().query).toBe("needle");
    });
});

describe("search-store single-match replace", () => {
    const line = "foo foo tail";
    const file = {
        path: "/repo/a.ts",
        matches: [
            { line: 1, column: 1, matchLength: 3, lineContent: line },
            { line: 1, column: 5, matchLength: 3, lineContent: line },
        ],
    };

    async function attachReplacing(replacedCount: number): Promise<TestServer> {
        const server = startTestServer("a", (type) => {
            if (type === MSG.SEARCH_QUERY) {
                return { result: { searchId: "s", totalMatches: 2, files: [file] } };
            }
            if (type === MSG.SEARCH_REPLACE) return { replacedCount };
            return {};
        });
        servers.push(server);
        await openConnection("a", server.origin);
        return server;
    }

    test("moves the later matches on the replaced line to the new text", async () => {
        await attachReplacing(1);
        const store = useSearchStore.getState();
        store.setQuery("foo");
        store.setReplacement("x");
        await store.search("a", "/repo");

        await useSearchStore.getState().replaceMatch(file.path, file.matches[0]);

        expect(useSearchStore.getState().results).toEqual([
            {
                path: file.path,
                matches: [{ line: 1, column: 3, matchLength: 3, lineContent: "x foo tail" }],
            },
        ]);
    });

    test("keeps a match the backend refused and says why", async () => {
        await attachReplacing(0);
        const store = useSearchStore.getState();
        store.setQuery("foo");
        store.setReplacement("x");
        await store.search("a", "/repo");

        await useSearchStore.getState().replaceMatch(file.path, file.matches[0]);

        expect(useSearchStore.getState().results).toEqual([file]);
        expect(useSearchStore.getState().error).toContain("Not replaced");
    });
});

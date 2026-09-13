import { afterEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useSearchStore } from "./search-store";
import { resetBackend } from "./store-reset";

const servers: TestServer[] = [];

/** A machine whose searches all get the id `search-<id>` and one matching file. */
async function attach(backendId: string): Promise<TestServer> {
    const server = startTestServer(backendId, (type) =>
        type === MSG.SEARCH_QUERY
            ? {
                  result: {
                      searchId: `search-${backendId}`,
                      totalMatches: 1,
                      files: [{ path: `/repo/${backendId}.ts`, matches: [] }],
                  },
              }
            : {},
    );
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

        await useSearchStore.getState().replaceInFile("/repo", "/repo/a.ts");

        expect(requests(desktop, MSG.SEARCH_REPLACE_ALL)).toHaveLength(1);
        expect(requests(laptop, MSG.SEARCH_REPLACE_ALL)).toEqual([]);
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

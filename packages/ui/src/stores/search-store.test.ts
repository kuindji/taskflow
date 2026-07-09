import { expect, mock, test } from "bun:test";
import type { SearchQueryResponse } from "@taskflow/shared";

// search-store only pulls sendRequest from useWebSocket; mock it with manually
// resolved promises so tests control the order responses arrive in.
let resolvers: Array<(value: unknown) => void> = [];
await mock.module("@/hooks/useWebSocket", () => ({
    sendRequest: () =>
        new Promise((resolve) => {
            resolvers.push(resolve);
        }),
}));

const { useSearchStore } = await import("./search-store");

function makeResponse(path: string, searchId: string): SearchQueryResponse {
    return { result: { files: [{ path, matches: [] }], totalMatches: 0, searchId } };
}

// Review fix: searchId is only assigned once a response arrives, so search()'s
// cancel() guard cannot stop an in-flight request — a slow stale response used to
// clobber the newer search's results.
test("stale search response does not clobber newer results", async () => {
    resolvers = [];
    useSearchStore.setState({ query: "foo", results: [], searchId: null });

    const first = useSearchStore.getState().search("/r"); // in flight → resolvers[0]
    useSearchStore.setState({ query: "bar" });
    const second = useSearchStore.getState().search("/r"); // in flight → resolvers[1]

    resolvers[1](makeResponse("fresh.ts", "s2")); // newer search resolves first
    await second;
    resolvers[0](makeResponse("stale.ts", "s1")); // superseded search resolves late
    await first;

    expect(useSearchStore.getState().results.map((f) => f.path)).toEqual(["fresh.ts"]);
    expect(useSearchStore.getState().searchId).toBe("s2");
});

test("cancel during the pre-searchId window clears searching", async () => {
    resolvers = [];
    useSearchStore.setState({ query: "foo", results: [], searchId: null, searching: false });

    const inFlight = useSearchStore.getState().search("/r"); // no searchId yet
    expect(useSearchStore.getState().searching).toBe(true);

    await useSearchStore.getState().cancel();
    expect(useSearchStore.getState().searching).toBe(false);

    resolvers[0](makeResponse("late.ts", "s1")); // invalidated response must stay a no-op
    await inFlight;
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().searching).toBe(false);
});

test("empty-query search clears searching and drops the in-flight response", async () => {
    resolvers = [];
    useSearchStore.setState({ query: "foo", results: [], searchId: null, searching: false });

    const inFlight = useSearchStore.getState().search("/r");
    expect(useSearchStore.getState().searching).toBe(true);

    useSearchStore.setState({ query: "" });
    await useSearchStore.getState().search("/r"); // empty-query branch invalidates the in-flight search
    expect(useSearchStore.getState().searching).toBe(false);

    resolvers[0](makeResponse("late.ts", "s1"));
    await inFlight;
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().searching).toBe(false);
});

test("response arriving after clear() is dropped", async () => {
    resolvers = [];
    useSearchStore.setState({ query: "foo", results: [], searchId: null });

    const inFlight = useSearchStore.getState().search("/r");
    useSearchStore.getState().clear();
    resolvers[0](makeResponse("late.ts", "s1"));
    await inFlight;

    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().searchId).toBeNull();
});

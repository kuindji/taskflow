import { describe, expect, test } from "bun:test";
import { createPerBackendCache } from "./per-backend-cache";
import { resetBackend } from "@/stores/store-reset";

describe("createPerBackendCache", () => {
    test("caches per backend and never serves one machine's value for another", async () => {
        const cache = createPerBackendCache(async (id) => `value-${id}`, "test-cache");
        expect(await cache.get("a")).toBe("value-a");
        expect(await cache.get("b")).toBe("value-b");
    });

    test("in-flight fetches are shared per backend, not globally", async () => {
        let calls = 0;
        const cache = createPerBackendCache(async (id) => {
            calls++;
            return id;
        }, "test-cache-2");
        await Promise.all([cache.get("a"), cache.get("a"), cache.get("b")]);
        expect(calls).toBe(2);
    });

    test("resetting one backend leaves the other cached", async () => {
        const cache = createPerBackendCache(async (id) => `v-${id}`, "test-cache-3");
        await cache.get("a");
        await cache.get("b");
        resetBackend("a");
        expect(cache.peek("a")).toBeNull();
        expect(cache.peek("b")).toBe("v-b");
    });

    test("a fetch that lands after its machine was reset is not cached", async () => {
        let answer: (value: string) => void = () => {};
        const cache = createPerBackendCache(
            () => new Promise<string>((resolve) => (answer = resolve)),
            "test-cache-4",
        );
        const pending = cache.get("a");
        resetBackend("a");
        answer("stale");
        expect(await pending).toBe("stale");
        expect(cache.peek("a")).toBeNull();
    });

    test("a failed fetch is not cached, so the next get asks again", async () => {
        let calls = 0;
        const cache = createPerBackendCache(async (id) => {
            calls++;
            if (calls === 1) throw new Error("offline");
            return id;
        }, "test-cache-5");
        const failure = await cache.get("a").then(
            () => null,
            (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(Error);
        expect(await cache.get("a")).toBe("a");
        expect(calls).toBe(2);
    });
});

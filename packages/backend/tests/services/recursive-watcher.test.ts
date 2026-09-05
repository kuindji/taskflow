// packages/backend/tests/services/recursive-watcher.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    watchRecursive,
    toRelativeWatchPath,
    PendingBatch,
    type WatchBatch,
    type RecursiveWatchHandle,
} from "../../src/services/recursive-watcher";

async function waitFor<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FSEvents replays changes made shortly before the stream opened (the
 * directories `setup()` just created). Let that warm-up batch land and
 * discard it so each test only sees what it did itself.
 */
async function settled(batches: WatchBatch[]): Promise<void> {
    await sleep(400);
    batches.length = 0;
}

describe("toRelativeWatchPath", () => {
    it("normalizes backslashes", () => {
        expect(toRelativeWatchPath(["/root"], "a\\b\\c.txt")).toBe("a/b/c.txt");
    });

    it("makes an absolute filename relative to the root", () => {
        expect(toRelativeWatchPath(["/root"], "/root/a/b.txt")).toBe("a/b.txt");
    });

    it("resolves an absolute real path against the root's real path", () => {
        expect(toRelativeWatchPath(["/var/x", "/private/var/x"], "/private/var/x/a.txt")).toBe("a.txt");
    });

    it("returns the empty string for the root itself", () => {
        expect(toRelativeWatchPath(["/root"], "/root")).toBe("");
    });

    it("drops absolute filenames outside every root", () => {
        expect(toRelativeWatchPath(["/root"], "/elsewhere/x.txt")).toBeNull();
        expect(toRelativeWatchPath(["/root"], "/rootling/x.txt")).toBeNull();
    });
});

describe("PendingBatch", () => {
    it("passes small batches through unchanged and resets on take", () => {
        const batch = new PendingBatch(10);
        batch.add("a/1.txt");
        batch.add("b/2.txt");
        batch.add("a/1.txt");
        expect(batch.take()).toEqual({ paths: ["a/1.txt", "b/2.txt"], collapsed: false });
        expect(batch.take()).toEqual({ paths: [], collapsed: false });
    });

    it("collapses to parent directories as soon as the cap is crossed, and keeps adding parents", () => {
        const batch = new PendingBatch(3);
        for (const p of ["a/1.txt", "a/2.txt", "b/c/3.txt", "top.txt"]) batch.add(p);
        batch.add("a/4.txt");
        batch.add("b/c/5.txt");
        const taken = batch.take();
        expect(taken.collapsed).toBe(true);
        expect(taken.paths.sort()).toEqual(["", "a", "b/c"]);
    });

    it("collapses to the root when parents exceed the cap, and ignores further adds", () => {
        const batch = new PendingBatch(2);
        for (const p of ["a/1", "b/2", "c/3", "d/4"]) batch.add(p);
        batch.add("e/5");
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });

    it("collapses to the root when the root itself changed", () => {
        const batch = new PendingBatch(10);
        batch.add("a/1");
        batch.markRoot();
        batch.add("b/2");
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });

    it("never holds more than the cap in memory", () => {
        const batch = new PendingBatch(100);
        for (let i = 0; i < 100000; i++) batch.add(`dir${i % 1000}/file${i}.txt`);
        expect(batch.size).toBeLessThanOrEqual(100);
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });
});

describe("watchRecursive", () => {
    let root: string;
    let handle: RecursiveWatchHandle | null = null;

    afterEach(async () => {
        handle?.close();
        handle = null;
        if (root) await rm(root, { recursive: true, force: true });
    });

    async function setup(): Promise<void> {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-rw-")));
        await mkdir(join(root, "src", "deep"), { recursive: true });
        await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    }

    it("delivers a change under the root as a relative path", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(["node_modules"]),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        await writeFile(join(root, "src", "deep", "a.txt"), "x");
        const batch = await waitFor(() => batches.find((b) => b.paths.includes("src/deep/a.txt")));
        expect(batch.collapsed).toBe(false);
    });

    it("never flushes for changes under an ignored directory", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(["node_modules"]),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 20; i++) {
            await writeFile(join(root, "node_modules", "pkg", `${i}.js`), "x");
        }
        await sleep(400);
        expect(batches).toEqual([]);
    });

    it("coalesces many changes inside one window into one flush of unique paths", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 300,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 10; i++) {
            await writeFile(join(root, "src", `f${i % 5}.txt`), `${i}`);
        }
        await waitFor(() => (batches.length > 0 ? true : undefined));
        await sleep(400);
        expect(batches).toHaveLength(1);
        const paths = batches[0].paths.filter((p) => p.startsWith("src/f"));
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths.length).toBeLessThanOrEqual(5);
    });

    it("keeps flushing while changes keep coming (throttle, not trailing debounce)", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 50,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        const started = Date.now();
        let i = 0;
        while (Date.now() - started < 800) {
            await writeFile(join(root, "src", `hot-${i++ % 20}.txt`), `${Date.now()}`);
            await sleep(10);
        }
        expect(batches.length).toBeGreaterThanOrEqual(3);
    });

    it("tolerates a second close", async () => {
        await setup();
        const w = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: () => {},
        });
        w.close();
        expect(() => w.close()).not.toThrow();
    });

    it("collapses an oversized flush to parent directories", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 300,
            maxPathsPerFlush: 3,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 8; i++) {
            await writeFile(join(root, "src", "deep", `f${i}.txt`), "x");
        }
        const batch = await waitFor(() => batches.find((b) => b.collapsed));
        expect(batch.paths).toEqual(["src/deep"]);
    });

    it("stops delivering after close", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        handle.close();
        handle = null;
        await writeFile(join(root, "src", "late.txt"), "x");
        await sleep(300);
        expect(batches).toEqual([]);
    });
});

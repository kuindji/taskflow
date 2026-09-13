import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FileWatcher } from "../../src/services/file-watcher";

const dirs: string[] = [];
let watcher: FileWatcher | null = null;

afterEach(async () => {
    await watcher?.stopAll();
    watcher = null;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "watch-"));
    dirs.push(dir);
    return dir;
}

/** The recursive watcher batches over a 100 ms window; give it a beat. */
function settle(ms = 400): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("FileWatcher ownership", () => {
    test("a second client releasing does not stop the first client's watch", async () => {
        const dir = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(dir, "client-a", (event) => events.push(event.path));
        await watcher.watch(dir, "client-b", (event) => events.push(event.path));

        await watcher.release(dir, "client-b");
        await settle();

        await writeFile(join(dir, "a.txt"), "hello");
        await settle();

        expect(events.length).toBeGreaterThan(0);
    });

    test("the last release stops the watch", async () => {
        const dir = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(dir, "client-a", (event) => events.push(event.path));
        await watcher.release(dir, "client-a");
        await settle();

        await writeFile(join(dir, "a.txt"), "hello");
        await settle();

        expect(events).toHaveLength(0);
    });

    test("releaseClient drops every path that client owned", async () => {
        const one = await tempDir();
        const two = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(one, "client-a", (event) => events.push(event.path));
        await watcher.watch(two, "client-a", (event) => events.push(event.path));
        await watcher.releaseClient("client-a");
        await settle();

        await writeFile(join(one, "a.txt"), "hello");
        await writeFile(join(two, "b.txt"), "hello");
        await settle();

        expect(events).toHaveLength(0);
    });
});

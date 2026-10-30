import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { BrowserTabStore, type SavedBrowserTab } from "../../src/services/browser-tab-store";

describe("BrowserTabStore", () => {
    let dir: string;
    let file: string;
    let store: BrowserTabStore;
    const tab: SavedBrowserTab = {
        id: "tab-1",
        scope: { kind: "task", taskId: "task-1" },
        label: "example.com",
        url: "https://example.com",
        title: "Example",
        createdAt: "2026-10-30T00:00:00.000Z",
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "browser-tab-store-"));
        file = join(dir, "browser-tabs.json");
        store = new BrowserTabStore(file);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("put then list returns the saved tab", async () => {
        await store.put(tab);
        expect(await store.list()).toEqual([tab]);
        expect(await new BrowserTabStore(file).list()).toEqual([tab]);
    });

    it("put replaces a tab with the same id", async () => {
        await store.put(tab);
        const updated = { ...tab, url: "https://example.com/updated" };
        await store.put(updated);
        expect(await store.list()).toEqual([updated]);
    });

    it("remove returns false for an unknown id", async () => {
        expect(await store.remove("missing")).toBe(false);
        await store.put(tab);
        expect(await store.remove(tab.id)).toBe(true);
        expect(await store.remove(tab.id)).toBe(false);
        expect(await store.list()).toEqual([]);
    });

    it("a missing file lists as empty", async () => {
        expect(await store.list()).toEqual([]);
    });

    it("a corrupt file lists as empty and the next put rewrites it", async () => {
        await writeFile(file, "{broken");
        expect(await store.list()).toEqual([]);
        await store.put(tab);
        expect(JSON.parse(await readFile(file, "utf-8"))).toEqual([tab]);
    });
});

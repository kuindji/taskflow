import type { BrowserTab } from "@taskflow/shared";
import { readFile } from "fs/promises";
import { KeyedQueue } from "./keyed-queue";
import { writeJsonAtomic } from "./write-file-atomic";

type SavedBrowserTab = Pick<BrowserTab, "id" | "scope" | "label" | "url" | "title" | "createdAt">;

const FILE_KEY = "file";

class BrowserTabStore {
    private readonly queue = new KeyedQueue();

    constructor(private readonly filePath: string) {}

    private async readAll(): Promise<SavedBrowserTab[]> {
        let raw: string;
        try {
            raw = await readFile(this.filePath, "utf-8");
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
            throw error;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as SavedBrowserTab[]) : [];
        } catch {
            // Match DevServerStore: the next write replaces a corrupt registry.
            return [];
        }
    }

    list(): Promise<SavedBrowserTab[]> {
        return this.queue.run(FILE_KEY, () => this.readAll());
    }

    put(tab: SavedBrowserTab): Promise<void> {
        return this.queue.run(FILE_KEY, async () => {
            if ("parentId" in tab && tab.parentId) return;
            const tabs = await this.readAll();
            const saved: SavedBrowserTab = {
                id: tab.id,
                scope: tab.scope,
                label: tab.label,
                url: tab.url,
                title: tab.title,
                createdAt: tab.createdAt,
            };
            const index = tabs.findIndex((entry) => entry.id === tab.id);
            if (index === -1) tabs.push(saved);
            else tabs[index] = saved;
            await writeJsonAtomic(this.filePath, tabs);
        });
    }

    remove(id: string): Promise<boolean> {
        return this.queue.run(FILE_KEY, async () => {
            const tabs = await this.readAll();
            const kept = tabs.filter((tab) => tab.id !== id);
            if (kept.length === tabs.length) return false;
            await writeJsonAtomic(this.filePath, kept);
            return true;
        });
    }
}

export { BrowserTabStore };
export type { SavedBrowserTab };

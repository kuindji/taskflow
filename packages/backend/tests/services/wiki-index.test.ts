import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { WikiIndexData } from "@taskflow/shared";
import { WikiIndexService } from "../../src/services/wiki-index";

async function waitFor<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe("WikiIndexService", () => {
    let root: string;
    let service: WikiIndexService;
    let changes: WikiIndexData[];

    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-wiki-")));
        await mkdir(join(root, "business"), { recursive: true });
        await writeFile(join(root, "index.md"), "# Home\n\nsee [[business/money]]\n");
        await writeFile(join(root, "business", "money.md"), "---\ntitle: Money\n---\n\n# Money\n");
        changes = [];
        service = new WikiIndexService({
            onChange: (data) => changes.push(data),
            debounceMs: 30,
        });
    });

    afterEach(async () => {
        await service.stopAll();
        await rm(root, { recursive: true, force: true });
    });

    it("indexes every markdown file under the root", async () => {
        const data = await service.get(root);
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "index"]);
        expect(data.pages.find((p) => p.id === "business/money")?.title).toBe("Money");
        expect(data.backlinks["business/money"]).toEqual(["index"]);
    });

    it("ignores non-markdown files and ignored directories", async () => {
        await mkdir(join(root, "node_modules"), { recursive: true });
        await writeFile(join(root, "node_modules", "pkg.md"), "# nope\n");
        await writeFile(join(root, "notes.txt"), "not markdown");
        const data = await service.get(root);
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "index"]);
    });

    it("serves the cached index on a second call without rescanning", async () => {
        const first = await service.get(root);
        expect(await service.get(root)).toBe(first);
    });

    it("pushes a new index when a page changes on disk", async () => {
        await service.get(root);
        await writeFile(join(root, "business", "money.md"), "---\ntitle: Renamed\n---\n\n# x\n");
        const data = await waitFor(() => changes.at(-1));
        expect(data.pages.find((p) => p.id === "business/money")?.title).toBe("Renamed");
    });

    it("pushes a new index when a page is added", async () => {
        await service.get(root);
        await writeFile(join(root, "extra.md"), "# Extra\n");
        const data = await waitFor(() =>
            changes.at(-1)?.pages.some((p) => p.id === "extra") ? changes.at(-1) : undefined,
        );
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "extra", "index"]);
    });

    it("pushes a new index when a page is deleted", async () => {
        await service.get(root);
        await rm(join(root, "business", "money.md"));
        const data = await waitFor(() =>
            changes.at(-1)?.pages.every((p) => p.id !== "business/money")
                ? changes.at(-1)
                : undefined,
        );
        expect(data.pages.map((p) => p.id)).toEqual(["index"]);
        expect(data.unresolved).toEqual([{ from: "index", target: "business/money" }]);
    });

    it("does not install a watcher when a build finishes after stopAll", async () => {
        const pending = service.get(root);
        await service.stopAll();
        await pending;
        await writeFile(join(root, "business", "money.md"), "---\ntitle: Renamed\n---\n\n# x\n");
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(changes).toEqual([]);
    });

    it("watches again after a stop-and-restart cycle", async () => {
        await service.get(root);
        await service.stopAll();
        changes = [];

        await service.get(root);
        await writeFile(join(root, "extra.md"), "# Extra\n");
        const data = await waitFor(() =>
            changes.at(-1)?.pages.some((p) => p.id === "extra") ? changes.at(-1) : undefined,
        );
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "extra", "index"]);
    });

    it("flags a missing root rather than throwing", async () => {
        const data = await service.get(join(root, "does-not-exist"));
        expect(data.rootExists).toBe(false);
        expect(data.pages).toEqual([]);
        expect(data.tree).toEqual([]);
    });

    it("flags a root that is a file, not a directory", async () => {
        const data = await service.get(join(root, "index.md"));
        expect(data.rootExists).toBe(false);
        expect(data.pages).toEqual([]);
    });

    it("distinguishes an existing but empty wiki from a missing one", async () => {
        const empty = join(root, "empty");
        await mkdir(empty, { recursive: true });
        const data = await service.get(empty);
        expect(data.rootExists).toBe(true);
        expect(data.pages).toEqual([]);
    });
});

import { describe, it, expect, afterEach } from "bun:test";
import { FileWatcher } from "../../src/services/file-watcher";
import type { FileChangeEvent } from "@taskflow/shared";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("FileWatcher", () => {
    let watcher: FileWatcher;
    let tempDir: string;

    afterEach(async () => {
        await watcher?.stopAll();
        if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it("builds a file tree", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await writeFile(join(tempDir, "file1.ts"), "content");
        await mkdir(join(tempDir, "src"));
        await writeFile(join(tempDir, "src", "file2.ts"), "content");

        watcher = new FileWatcher();
        const { tree } = await watcher.buildTree(tempDir);

        expect(tree.type).toBe("directory");
        expect(tree.children?.length).toBeGreaterThanOrEqual(2);

        const srcDir = tree.children?.find((c) => c.name === "src");
        expect(srcDir).toBeTruthy();
        expect(srcDir?.children).toHaveLength(1);
    });

    it("excludes node_modules, .git, and .worktrees", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await mkdir(join(tempDir, "node_modules"));
        await writeFile(join(tempDir, "node_modules", "pkg.js"), "x");
        await mkdir(join(tempDir, ".git"));
        await writeFile(join(tempDir, ".git", "config"), "x");
        await mkdir(join(tempDir, ".worktrees"));
        await writeFile(join(tempDir, ".worktrees", "ignored.txt"), "x");
        await writeFile(join(tempDir, ".gitignore"), "dist\n");
        await writeFile(join(tempDir, "real.ts"), "x");

        watcher = new FileWatcher();
        const { tree, gitignorePatterns } = await watcher.buildTree(tempDir);

        const names = tree.children?.map((c) => c.name) ?? [];
        expect(names).not.toContain("node_modules");
        expect(names).not.toContain(".git");
        expect(names).not.toContain(".worktrees");
        expect(names).toContain(".gitignore");
        expect(names).toContain("real.ts");
        expect(gitignorePatterns).toContain("dist");
    });

    it("hides .DS_Store from tree and directory listings", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await writeFile(join(tempDir, ".DS_Store"), "x");
        await mkdir(join(tempDir, "src"));
        await writeFile(join(tempDir, "src", ".DS_Store"), "x");
        await writeFile(join(tempDir, "src", "visible.ts"), "x");

        watcher = new FileWatcher();
        const { tree } = await watcher.buildTree(tempDir);
        const { entries } = await watcher.listDir(join(tempDir, "src"));

        const rootNames = tree.children?.map((c) => c.name) ?? [];
        const srcNode = tree.children?.find((c) => c.name === "src");
        const srcTreeNames = srcNode?.children?.map((c) => c.name) ?? [];
        const listedNames = entries.map((c) => c.name);

        expect(rootNames).not.toContain(".DS_Store");
        expect(srcTreeNames).not.toContain(".DS_Store");
        expect(srcTreeNames).toContain("visible.ts");
        expect(listedNames).not.toContain(".DS_Store");
        expect(listedNames).toContain("visible.ts");
    });

    it("watches for file changes", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        watcher = new FileWatcher();

        const changes: string[] = [];
        await watcher.watch(tempDir, (event) => {
            changes.push(event.path);
        });
        await writeFile(join(tempDir, "new-file.ts"), "hello");

        const started = Date.now();
        while (changes.length === 0 && Date.now() - started < 2000) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(changes.length).toBeGreaterThanOrEqual(1);
    });
    it("collapses a burst into a recursive directory event", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await mkdir(join(tempDir, "src"));
        watcher = new FileWatcher({ windowMs: 300, maxPathsPerFlush: 3 });

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        // FSEvents replays the mkdir above once the stream opens; let it pass first.
        await new Promise((resolve) => setTimeout(resolve, 400));
        events.length = 0;
        for (let i = 0; i < 8; i++) {
            await writeFile(join(tempDir, "src", `f${i}.ts`), "x");
        }

        const started = Date.now();
        while (!events.some((e) => e.recursive) && Date.now() - started < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const collapsed = events.filter((e) => e.recursive);
        expect(collapsed.length).toBeGreaterThanOrEqual(1);
        expect(collapsed.every((e) => e.type === "modify")).toBe(true);
        expect(collapsed.some((e) => e.path.endsWith("/src"))).toBe(true);
    });

    it("reports a deleted file as delete and a written file as modify", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await writeFile(join(tempDir, "gone.ts"), "x");
        watcher = new FileWatcher();

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        await new Promise((resolve) => setTimeout(resolve, 100));
        await rm(join(tempDir, "gone.ts"));
        await writeFile(join(tempDir, "kept.ts"), "y");

        const started = Date.now();
        while (events.length < 2 && Date.now() - started < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const gone = events.find((e) => e.path.endsWith("/gone.ts"));
        const kept = events.find((e) => e.path.endsWith("/kept.ts"));
        expect(gone?.type).toBe("delete");
        expect(kept?.type).toBe("modify");
        expect(gone?.recursive).toBeUndefined();
    });

    it("does not report changes under a watch-ignored directory such as .venv", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await mkdir(join(tempDir, ".venv", "lib"), { recursive: true });
        watcher = new FileWatcher();

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (let i = 0; i < 10; i++) {
            await writeFile(join(tempDir, ".venv", "lib", `${i}.py`), "x");
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(events).toEqual([]);
    });
});

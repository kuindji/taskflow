import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerFileHandlers } from "../../src/handlers/file";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { FileWatcher } from "../../src/services/file-watcher";
import { mkdtemp, mkdir, rm, writeFile, readFile, stat, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";

async function expectRejects(fn: () => Promise<unknown>, match?: string) {
    try {
        await fn();
        expect.unreachable("Expected promise to reject");
    } catch (err) {
        if (match) {
            expect(String(err)).toContain(match);
        }
    }
}

describe("file handlers", () => {
    let router: Router;
    let store: TaskStore;
    let fileWatcher: FileWatcher;
    let tempDir: string;
    let projectDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-file-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();

        projectDir = join(tempDir, "my-project");
        await mkdir(projectDir, { recursive: true });
        await store.addProject({ name: "test", path: projectDir });

        fileWatcher = new FileWatcher();
        router = new Router();
        const broadcast = () => {};
        registerFileHandlers({ router, fileWatcher, taskStore: store, broadcast });
    });

    afterEach(async () => {
        await fileWatcher.stopAll();
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("FILE_RENAME", () => {
        it("renames a file", async () => {
            const filePath = join(projectDir, "old.txt");
            await writeFile(filePath, "hello");
            const newPath = join(projectDir, "new.txt");

            const result = await router.handle(MSG.FILE_RENAME, { oldPath: filePath, newPath });

            expect(result).toEqual({ success: true });
            const content = await readFile(newPath, "utf-8");
            expect(content).toBe("hello");
            await expectRejects(() => stat(filePath));
        });

        it("rejects rename when target exists", async () => {
            const filePath = join(projectDir, "a.txt");
            const targetPath = join(projectDir, "b.txt");
            await writeFile(filePath, "a");
            await writeFile(targetPath, "b");

            await expectRejects(
                () => router.handle(MSG.FILE_RENAME, { oldPath: filePath, newPath: targetPath }),
                "already exists",
            );
        });

        it("rejects rename of workspace root", async () => {
            const newPath = join(tempDir, "renamed-project");
            await expectRejects(
                () => router.handle(MSG.FILE_RENAME, { oldPath: projectDir, newPath }),
                "Cannot modify workspace root",
            );
        });

        it("rejects rename outside workspace", async () => {
            const outsidePath = join(tmpdir(), "outside.txt");
            await expectRejects(
                () =>
                    router.handle(MSG.FILE_RENAME, {
                        oldPath: join(projectDir, "a.txt"),
                        newPath: outsidePath,
                    }),
                "outside",
            );
        });
    });

    describe("FILE_DELETE_FILE", () => {
        it("deletes a file", async () => {
            const filePath = join(projectDir, "delete-me.txt");
            await writeFile(filePath, "bye");

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: filePath });

            expect(result).toEqual({ success: true });
            await expectRejects(() => stat(filePath));
        });

        it("deletes a directory recursively", async () => {
            const dirPath = join(projectDir, "subdir");
            await mkdir(dirPath);
            await writeFile(join(dirPath, "child.txt"), "data");

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: dirPath });

            expect(result).toEqual({ success: true });
            await expectRejects(() => stat(dirPath));
        });

        it("deletes a hidden directory recursively", async () => {
            const dirPath = join(projectDir, ".playwrite-mcp");
            await mkdir(dirPath);
            await writeFile(join(dirPath, "debug.log"), "data");

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: dirPath });

            expect(result).toEqual({ success: true });
            await expectRejects(() => stat(dirPath));
        });

        it("rejects delete of workspace root", async () => {
            await expectRejects(
                () => router.handle(MSG.FILE_DELETE_FILE, { path: projectDir }),
                "Cannot modify workspace root",
            );
        });

        it("rejects delete outside workspace", async () => {
            const outsidePath = join(tmpdir(), "outside-delete.txt");
            await expectRejects(
                () => router.handle(MSG.FILE_DELETE_FILE, { path: outsidePath }),
                "outside",
            );
        });
    });

    describe("FILE_REVEAL", () => {
        it("accepts a valid path", async () => {
            const filePath = join(projectDir, "reveal-me.txt");
            await writeFile(filePath, "hi");

            const result = await router.handle(MSG.FILE_REVEAL, { path: filePath });
            expect(result).toEqual({ success: true });
        });
    });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerFileHandlers } from "../../src/handlers/file";
import { TestRouter } from "../test-router";
import { TaskStore } from "../../src/services/task-store";
import { FileWatcher } from "../../src/services/file-watcher";
import {
    link,
    lstat,
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    readlink,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { expectRejects as expectPromiseRejects } from "../expect-rejects";
import { resolveEditorCommand, type EditorResolverDeps } from "../../src/services/editor-resolver";

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
    let router: TestRouter;
    let store: TaskStore;
    let fileWatcher: FileWatcher;
    let tempDir: string;
    let projectDir: string;
    let originalEditor: string | undefined;

    beforeEach(async () => {
        originalEditor = process.env.EDITOR;
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
        router = new TestRouter();
        const broadcast = () => {};
        registerFileHandlers({ router, fileWatcher, taskStore: store, broadcast });
    });

    afterEach(async () => {
        if (originalEditor === undefined) delete process.env.EDITOR;
        else process.env.EDITOR = originalEditor;
        await fileWatcher.stopAll();
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("FILE_OPEN_EXTERNAL", () => {
        function injectEditors(overrides: {
            resolveEditor: typeof resolveEditorCommand;
            spawnEditor: (command: string, args: string[]) => void;
        }) {
            registerFileHandlers({
                router,
                fileWatcher,
                taskStore: store,
                broadcast: () => {},
                ...overrides,
            });
        }

        it("external open launches the shared resolved command", async () => {
            process.env.EDITOR = "idea";
            const launched: unknown[] = [];
            injectEditors({
                resolveEditor: async (editor) => {
                    const expected = {
                        id: "idea",
                        name: "IntelliJ IDEA",
                        command: "idea",
                        type: "external",
                    };
                    expect(editor).toEqual(expected);
                    return "/bundle/idea";
                },
                spawnEditor: (command, args) => {
                    launched.push([command, args]);
                },
            });
            const filePath = join(projectDir, "source.ts");
            await writeFile(filePath, "hello");
            expect(await router.handle(MSG.FILE_OPEN_EXTERNAL, { path: filePath })).toEqual({
                success: true,
            });
            expect(launched).toEqual([["/bundle/idea", [filePath]]]);
        });

        it("bundle-only Code is launchable", async () => {
            process.env.EDITOR = "vscode";
            const bundle = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
            const resolverDeps: EditorResolverDeps = {
                platform: "darwin",
                env: {},
                homeDir: "/home/tester",
                path: "",
                which: () => null,
                executable: async (path) => path === bundle,
                readDirectory: async () => [],
                version: async () => null,
            };
            const launched: unknown[] = [];
            injectEditors({
                resolveEditor: (editor) => resolveEditorCommand(editor, resolverDeps),
                spawnEditor: (command, args) => {
                    launched.push([command, args]);
                },
            });
            const filePath = join(projectDir, "source.ts");
            await writeFile(filePath, "hello");
            expect(await router.handle(MSG.FILE_OPEN_EXTERNAL, { path: filePath })).toEqual({
                success: true,
            });
            expect(launched).toEqual([[bundle, [filePath]]]);
            delete process.env.EDITOR;
            expect(await router.handle(MSG.FILE_OPEN_EXTERNAL, { path: filePath })).toEqual({
                success: true,
            });
            expect(launched).toHaveLength(2);
        });

        it("unknown editor reports the exact not-found message", async () => {
            process.env.EDITOR = "taskflow-nonexistent-editor --wait";
            const launched: unknown[] = [];
            injectEditors({
                resolveEditor: async (editor) => {
                    expect(editor.command).toBe("taskflow-nonexistent-editor --wait");
                    return null;
                },
                spawnEditor: (command, args) => {
                    launched.push([command, args]);
                },
            });
            await expectPromiseRejects(
                router.handle(MSG.FILE_OPEN_EXTERNAL, { path: join(projectDir, "file") }),
                /^Editor "taskflow-nonexistent-editor --wait" not found$/,
            );
            expect(launched).toEqual([]);
        });

        it("a rejected workspace path never reaches resolver or spawn", async () => {
            const calls: string[] = [];
            injectEditors({
                resolveEditor: async () => {
                    calls.push("resolve");
                    return "/bin/editor";
                },
                spawnEditor: () => {
                    calls.push("spawn");
                },
            });
            await expectPromiseRejects(
                router.handle(MSG.FILE_OPEN_EXTERNAL, { path: join(tempDir, "outside") }),
                "outside",
            );
            expect(calls).toEqual([]);
        });

        it("a file path containing spaces is one spawn argument", async () => {
            process.env.EDITOR = "/custom/taskflow-test-editor";
            const launched: unknown[] = [];
            injectEditors({
                resolveEditor: async (editor) => editor.command,
                spawnEditor: (command, args) => {
                    launched.push([command, args]);
                },
            });
            const filePath = join(projectDir, "a file with spaces.ts");
            await writeFile(filePath, "hello");
            expect(await router.handle(MSG.FILE_OPEN_EXTERNAL, { path: filePath })).toEqual({
                success: true,
            });
            expect(launched).toEqual([["/custom/taskflow-test-editor", [filePath]]]);
        });
    });

    describe("FILE_WRITE", () => {
        it("refuses to overwrite a file that is not UTF-8", async () => {
            const filePath = join(projectDir, "latin1.txt");
            const original = Buffer.from("caf\xe9 foo\n", "latin1");
            await writeFile(filePath, original);
            // What the editor got from FILE_READ, with one word edited.
            const read = (await router.handle(MSG.FILE_READ, { path: filePath })) as {
                content: string;
            };

            await expectRejects(
                () =>
                    router.handle(MSG.FILE_WRITE, {
                        path: filePath,
                        content: read.content.replace("foo", "bar"),
                    }),
                "not UTF-8",
            );
            expect(Buffer.compare(await readFile(filePath), original)).toBe(0);
        });

        it("writes UTF-8 files and creates new ones", async () => {
            const existing = join(projectDir, "utf8.txt");
            await writeFile(existing, "café foo\n");
            await router.handle(MSG.FILE_WRITE, { path: existing, content: "café bar\n" });
            expect(await readFile(existing, "utf-8")).toBe("café bar\n");

            const created = join(projectDir, "new.txt");
            await router.handle(MSG.FILE_WRITE, { path: created, content: "" });
            expect(await readFile(created, "utf-8")).toBe("");
        });
    });

    describe("FILE_CREATE", () => {
        it("creates an empty file", async () => {
            const created = join(projectDir, "created.txt");
            expect(await router.handle(MSG.FILE_CREATE, { path: created })).toEqual({
                success: true,
            });
            expect(await readFile(created, "utf-8")).toBe("");
        });

        it("refuses a name that is taken and leaves that file as it was", async () => {
            const existing = join(projectDir, "config.json");
            await writeFile(existing, '{"keep":true}');

            await expectRejects(
                () => router.handle(MSG.FILE_CREATE, { path: existing }),
                "already exists",
            );
            expect(await readFile(existing, "utf-8")).toBe('{"keep":true}');
        });
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

        it("changes only the case of a name", async () => {
            const filePath = join(projectDir, "CLAUDE.md");
            await writeFile(filePath, "hello");

            const result = await router.handle(MSG.FILE_RENAME, {
                oldPath: filePath,
                newPath: join(projectDir, "claude.md"),
            });

            expect(result).toEqual({ success: true });
            expect(await readdir(projectDir)).toEqual(["claude.md"]);
            expect(await readFile(join(projectDir, "claude.md"), "utf-8")).toBe("hello");
        });

        it("rejects rename onto another name of the same file", async () => {
            const filePath = join(projectDir, "a.txt");
            const otherName = join(projectDir, "b.txt");
            await writeFile(filePath, "a");
            await link(filePath, otherName);

            await expectRejects(
                () => router.handle(MSG.FILE_RENAME, { oldPath: filePath, newPath: otherName }),
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

        it("renames a symlink itself, not its target", async () => {
            const targetDir = join(projectDir, "docs");
            await mkdir(targetDir);
            const linkPath = join(projectDir, "docs-link");
            await symlink(targetDir, linkPath);
            const newPath = join(projectDir, "docs-link-renamed");

            await router.handle(MSG.FILE_RENAME, { oldPath: linkPath, newPath });

            expect((await stat(targetDir)).isDirectory()).toBe(true);
            expect((await lstat(newPath)).isSymbolicLink()).toBe(true);
            expect(await readlink(newPath)).toBe(targetDir);
            await expectRejects(() => lstat(linkPath));
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

        it("deletes a symlink to a directory without touching the target", async () => {
            const targetDir = join(projectDir, "docs");
            await mkdir(targetDir);
            await writeFile(join(targetDir, "keep.md"), "keep");
            const linkPath = join(projectDir, "docs-link");
            await symlink(targetDir, linkPath);

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: linkPath });

            expect(result).toEqual({ success: true });
            await expectRejects(() => lstat(linkPath));
            expect(await readFile(join(targetDir, "keep.md"), "utf-8")).toBe("keep");
        });

        it("deletes a symlink whose target is outside the workspace", async () => {
            const outsideDir = join(tempDir, "outside-target");
            await mkdir(outsideDir);
            await writeFile(join(outsideDir, "keep.md"), "keep");
            const linkPath = join(projectDir, "outside-link");
            await symlink(outsideDir, linkPath);

            await router.handle(MSG.FILE_DELETE_FILE, { path: linkPath });

            await expectRejects(() => lstat(linkPath));
            expect(await readFile(join(outsideDir, "keep.md"), "utf-8")).toBe("keep");
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
    it("FILE_READ returns explicit limited and binary states and complete empty text", async () => {
        const path = join(projectDir, "preview");
        await writeFile(path, Buffer.alloc(5 * 1024 * 1024 + 1));
        expect(await router.handle(MSG.FILE_READ, { path })).toEqual({ state: "tooLarge" });
        await writeFile(path, Buffer.from([1, 0, 2]));
        expect(await router.handle(MSG.FILE_READ, { path })).toEqual({ state: "binary" });
        await writeFile(path, "");
        expect(await router.handle(MSG.FILE_READ, { path })).toEqual({ content: "" });
    });
});

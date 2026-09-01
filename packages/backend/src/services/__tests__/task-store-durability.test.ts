import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type { Task } from "@taskflow/shared";
import { TaskStore } from "../task-store";
import {
    isMacOsFileProviderPath,
    removeFileOrWrite,
    removeFileOrWriteJson,
    writeFileAtomic,
    writeJsonAtomic,
} from "../write-file-atomic";
import type { FileOperations } from "../write-file-atomic";

let dir: string;
let store: TaskStore;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-durability-"));
    for (const sub of ["tasks", "archive", "task-logs", "session-logs"]) {
        await mkdir(join(dir, sub), { recursive: true });
    }
    store = new TaskStore({
        projectsFile: join(dir, "projects.json"),
        tasksDir: join(dir, "tasks"),
        archiveDir: join(dir, "archive"),
        taskLogsDir: join(dir, "task-logs"),
        sessionLogsDir: join(dir, "session-logs"),
    });
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

// Regression: readTask() used to unlink any file whose JSON did not parse, so a
// single bad read destroyed a real task permanently and silently.
describe("reading a task never deletes it", () => {
    test("an empty task file survives listTasks", async () => {
        const task = await store.createTask({
            projectId: "p1",
            title: "important",
            description: "",
        });
        await writeFile(join(dir, "tasks", `${task.id}.json`), "");

        const tasks = await store.listTasks("p1");

        expect(tasks).toEqual([]);
        expect(await readdir(join(dir, "tasks"))).toContain(`${task.id}.json`);
    });

    test("a truncated task file survives listTasks", async () => {
        const task = await store.createTask({
            projectId: "p1",
            title: "important",
            description: "",
        });
        const path = join(dir, "tasks", `${task.id}.json`);
        await writeFile(path, JSON.stringify(task, null, 2).slice(0, 40));

        await store.listTasks("p1");

        expect(await readdir(join(dir, "tasks"))).toContain(`${task.id}.json`);
    });

    test("an empty archived task file survives listArchived", async () => {
        const task = await store.createTask({
            projectId: "p1",
            title: "important",
            description: "",
        });
        await store.archiveTask(task.id);
        await writeFile(join(dir, "archive", `${task.id}.json`), "");

        await store.listArchived();

        expect(await readdir(join(dir, "archive"))).toContain(`${task.id}.json`);
    });

    test("a task reappears once its file parses again", async () => {
        const task = await store.createTask({
            projectId: "p1",
            title: "important",
            description: "",
        });
        const path = join(dir, "tasks", `${task.id}.json`);
        const good = await readFile(path, "utf-8");

        await writeFile(path, "");
        expect(await store.listTasks("p1")).toEqual([]);

        await writeFile(path, good);
        expect((await store.listTasks("p1")).map((t) => t.id)).toEqual([task.id]);
    });
});

// A plain writeFile truncates before writing; concurrent readers (a second
// backend on the same data dir, a cloud-sync client) can observe that gap.
describe("state writes are atomic", () => {
    test("writeFileAtomic replaces the file instead of truncating it in place", async () => {
        const path = join(dir, "tasks", "atomic.json");
        await writeFileAtomic(path, JSON.stringify({ v: "old" }));

        const handle = await open(path, "r");
        try {
            await writeFileAtomic(path, JSON.stringify({ v: "new" }));
            // A reader that opened the file before the write still sees a whole
            // previous version. Truncate-then-write would show it "" or a
            // half-written body instead.
            expect(JSON.parse(await handle.readFile("utf-8"))).toEqual({ v: "old" });
        } finally {
            await handle.close();
        }

        expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ v: "new" });
    });

    test("updating a task never exposes a torn record to an in-flight reader", async () => {
        const task = await store.createTask({
            projectId: "p1",
            title: "original",
            description: "",
        });
        const path = join(dir, "tasks", `${task.id}.json`);

        const handle = await open(path, "r");
        try {
            await store.updateTask(task.id, { notes: "n".repeat(200_000) });
            // The handle is pinned to the pre-update inode, so it reads the whole
            // old record. An in-place writeFile would show it the new (or a
            // half-written) body on the very same inode.
            const seen = JSON.parse(await handle.readFile("utf-8")) as Task;
            expect(seen.notes).toBe("");
        } finally {
            await handle.close();
        }

        expect((await store.getTask(task.id))?.notes?.length).toBe(200_000);
    });

    test("temp files are not mistaken for task records", async () => {
        await store.createTask({ projectId: "p1", title: "kept", description: "" });
        // A crashed write can leave its temp file behind; scans must ignore it.
        await writeFile(join(dir, "tasks", "abc.json.999.deadbeef.tmp"), "not json");

        const tasks = await store.listTasks("p1");

        expect(tasks.map((t) => t.title)).toEqual(["kept"]);
    });

    test("a failed write cleans up its temp file and leaves the target alone", async () => {
        // Renaming a file onto a directory always fails, which exercises the
        // failure path after the temp file has already been written.
        const target = join(dir, "tasks", "as-a-directory");
        await mkdir(target);

        let threw = false;
        try {
            await writeJsonAtomic(target, { ok: true });
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);
        expect(await readdir(target)).toEqual([]);
        expect((await readdir(join(dir, "tasks"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    });

    test("falls back to an in-place write when replacement rename is denied", async () => {
        const files = new Map<string, string>();
        const target = join(dir, "tasks", "provider-backed.json");
        files.set(target, JSON.stringify({ v: "old" }));
        const permissionError = Object.assign(new Error("rename denied"), { code: "EACCES" });
        const operations: FileOperations = {
            writeFile: async (path, data) => {
                files.set(path, data);
            },
            rename: async () => {
                throw permissionError;
            },
            unlink: async (path) => {
                files.delete(path);
            },
        };

        await writeFileAtomic(target, JSON.stringify({ v: "new" }), operations);

        expect(JSON.parse(files.get(target) ?? "null")).toEqual({ v: "new" });
        expect([...files.keys()].filter((path) => path.endsWith(".tmp"))).toEqual([]);
    });

    test("recognizes the macOS File Provider storage root", () => {
        const candidate = join(
            homedir(),
            "Library",
            "CloudStorage",
            "Dropbox",
            "tasks",
            "task.json",
        );
        expect(isMacOsFileProviderPath(candidate)).toBe(process.platform === "darwin");
        expect(isMacOsFileProviderPath(join(dir, "tasks", "local.json"))).toBe(false);
    });

    test("writes a tombstone when File Provider denies unlink", async () => {
        const files = new Map<string, string>();
        const target = join(dir, "tasks", "provider-backed.json");
        files.set(target, JSON.stringify({ id: "provider-backed" }));
        const permissionError = Object.assign(new Error("unlink denied"), { code: "EACCES" });
        const operations: FileOperations = {
            writeFile: async (path, data) => {
                files.set(path, data);
            },
            rename: async () => undefined,
            unlink: async () => {
                throw permissionError;
            },
        };

        await removeFileOrWriteJson(target, { kind: "taskflow-task-tombstone" }, operations);

        expect(JSON.parse(files.get(target) ?? "null")).toEqual({
            kind: "taskflow-task-tombstone",
        });
    });

    test("clears log contents when File Provider denies unlink", async () => {
        const files = new Map<string, string>();
        const target = join(dir, "task-logs", "provider-backed.jsonl");
        files.set(target, "important output");
        const permissionError = Object.assign(new Error("unlink denied"), { code: "EPERM" });
        const operations: FileOperations = {
            writeFile: async (path, data) => {
                files.set(path, data);
            },
            rename: async () => undefined,
            unlink: async () => {
                throw permissionError;
            },
        };

        await removeFileOrWrite(target, "", operations);

        expect(files.get(target)).toBe("");
    });
});

describe("task tombstones", () => {
    test("a tombstoned active task is omitted from task lists", async () => {
        await writeFile(
            join(dir, "tasks", "deleted-task.json"),
            JSON.stringify({
                kind: "taskflow-task-tombstone",
                version: 1,
                id: "deleted-task",
                projectId: "__taskflow_deleted__",
                title: "Deleted task",
                description: "",
                notes: "",
                worktree: { enabled: false, path: null, branch: null, pr: null },
                sessions: [],
                attributes: [],
                createdAt: "2026-09-01T00:00:00.000Z",
                status: "archived",
                archivedAt: "2026-09-01T00:00:00.000Z",
                pinned: false,
            }),
        );

        expect(await store.listTasks()).toEqual([]);
        expect(await store.getTask("deleted-task")).toBeNull();
    });

    test("a tombstoned archived task is omitted from archive lists", async () => {
        await writeFile(
            join(dir, "archive", "deleted-task.json"),
            JSON.stringify({
                kind: "taskflow-task-tombstone",
                version: 1,
                id: "deleted-task",
                projectId: "__taskflow_deleted__",
                title: "Deleted task",
                description: "",
                notes: "",
                worktree: { enabled: false, path: null, branch: null, pr: null },
                sessions: [],
                attributes: [],
                createdAt: "2026-09-01T00:00:00.000Z",
                status: "archived",
                archivedAt: "2026-09-01T00:00:00.000Z",
                pinned: false,
            }),
        );

        expect(await store.listArchived()).toEqual([]);
        expect(await store.getArchived("deleted-task")).toBeNull();
    });
});

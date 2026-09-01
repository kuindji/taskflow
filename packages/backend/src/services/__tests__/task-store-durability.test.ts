import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Task } from "@taskflow/shared";
import { TaskStore } from "../task-store";
import { writeFileAtomic, writeJsonAtomic } from "../write-file-atomic";

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
});

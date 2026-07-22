import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ResolvedAttribute, Task } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerTaskRoutes } from "../../src/api/routes/task-routes";
import { matchesAttribute } from "./attribute-matchers";

const BASE = "http://localhost";

interface TaskInfoResponse {
    task: Task;
    resolvedAttributes: ResolvedAttribute[];
}

describe("GET /api/tasks/:taskId attributes", () => {
    let tempDir: string;
    let store: TaskStore;
    let apiRouter: ApiRouter;
    let projectId: string;

    async function taskInfo(taskId: string): Promise<TaskInfoResponse> {
        const res = await apiRouter.handle(new Request(`${BASE}/api/tasks/${taskId}`));
        if (!res) throw new Error("No route matched");
        expect(res.status).toBe(200);
        return (await res.json()) as TaskInfoResponse;
    }

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-task-info-attr-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        apiRouter = new ApiRouter();
        registerTaskRoutes({
            apiRouter,
            taskStore: store,
            ptyManager: {} as never,
            broadcast: () => {},
            gitService: {} as never,
            flowStore: {} as never,
            flowRunner: {} as never,
        });

        const projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        projectId = (await store.addProject({ path: projectPath })).id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("includes inherited project attributes, not just the task's own", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(task.id, "ticket", "T-9");

        const { task: returned, resolvedAttributes } = await taskInfo(task.id);

        // The record's own list stays own-only: those are the ones the
        // task-scoped write commands can actually edit.
        expect(returned.attributes.map((a) => a.name)).toEqual(["ticket"]);
        expect(resolvedAttributes).toEqual([
            matchesAttribute({ name: "team", value: "core", scope: "project" }),
            matchesAttribute({ name: "ticket", value: "T-9", scope: "task" }),
        ]);
    });

    it("omits a project attribute the task shadows", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createTaskAttribute(task.id, "env", "dev");

        const { resolvedAttributes } = await taskInfo(task.id);

        expect(resolvedAttributes).toEqual([
            matchesAttribute({ name: "env", value: "dev", scope: "task" }),
        ]);
    });

    it("resolves all three layers for a subtask", async () => {
        const parent = await store.createTask({ projectId, title: "P", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "C",
            description: "",
        });
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(parent.id, "env", "staging");
        await store.createTaskAttribute(child.id, "ticket", "T-1");

        const { resolvedAttributes } = await taskInfo(child.id);

        expect(resolvedAttributes).toEqual([
            matchesAttribute({ name: "team", scope: "project" }),
            matchesAttribute({ name: "env", value: "staging", scope: "parent" }),
            matchesAttribute({ name: "ticket", scope: "task" }),
        ]);
    });

    it("returns an empty list when nothing is set anywhere", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });

        const { resolvedAttributes } = await taskInfo(task.id);

        expect(resolvedAttributes).toEqual([]);
    });
});

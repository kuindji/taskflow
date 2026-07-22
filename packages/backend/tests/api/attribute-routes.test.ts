import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Attribute, Project, ResolvedAttribute, Task, WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerAttributeRoutes } from "../../src/api/routes/attribute-routes";
import { matchesAttribute } from "./attribute-matchers";

const BASE = "http://localhost";

describe("attribute routes", () => {
    let tempDir: string;
    let store: TaskStore;
    let apiRouter: ApiRouter;
    let events: WsEvent[];
    let projectId: string;
    let taskId: string;

    async function call(method: string, path: string, body?: unknown): Promise<Response> {
        const req = new Request(`${BASE}${path}`, {
            method,
            ...(body === undefined
                ? {}
                : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
        });
        const res = await apiRouter.handle(req);
        if (!res) throw new Error(`No route matched ${method} ${path}`);
        return res;
    }

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-api-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        apiRouter = new ApiRouter();
        events = [];
        registerAttributeRoutes({
            apiRouter,
            taskStore: store,
            broadcast: (event) => {
                events.push(event);
            },
        });

        const projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        projectId = (await store.addProject({ path: projectPath })).id;
        taskId = (await store.createTask({ projectId, title: "T", description: "" })).id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("creates a task attribute and broadcasts", async () => {
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, {
            name: "env",
            value: "dev",
        });
        expect(res.status).toBe(200);

        const task = (await res.json()) as Task;
        expect(task.attributes[0]).toMatchObject({ name: "env", value: "dev" });
        expect(events).toHaveLength(1);
    });

    it("rejects a create with a missing name", async () => {
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, { value: "dev" });
        expect(res.status).toBe(400);
    });

    it("rejects a create with a duplicate name", async () => {
        await call("POST", `/api/tasks/${taskId}/attributes`, { name: "env" });
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, { name: "env" });
        expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown task", async () => {
        const res = await call("POST", `/api/tasks/missing/attributes`, { name: "env" });
        expect(res.status).toBe(404);
    });

    it("returns 400, not 404, for a duplicate name that contains the substring 'not found'", async () => {
        await call("POST", `/api/tasks/${taskId}/attributes`, { name: "release not found" });
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, {
            name: "release not found",
        });
        expect(res.status).toBe(400);
    });

    it("returns the resolved view with shadowed entries omitted", async () => {
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes`);
        const { attributes } = (await res.json()) as { attributes: ResolvedAttribute[] };

        expect(attributes).toEqual([
            matchesAttribute({ name: "team", value: "core", scope: "project" }),
            matchesAttribute({ name: "env", value: "dev", scope: "task" }),
        ]);
    });

    it("returns only the task's own attributes with ?own=1", async () => {
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes?own=1`);
        const { attributes } = (await res.json()) as { attributes: ResolvedAttribute[] };

        expect(attributes).toEqual([
            matchesAttribute({ name: "env", value: "dev", scope: "task" }),
        ]);
    });

    it("gets an inherited attribute by id from task context", async () => {
        const project = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = project.attributes[0].id;

        const res = await call("GET", `/api/tasks/${taskId}/attributes/${attrId}`);
        const { attribute } = (await res.json()) as { attribute: ResolvedAttribute };

        expect(attribute).toMatchObject({ name: "team", scope: "project" });
    });

    it("gets a shadowed attribute by id even though the list omits it", async () => {
        const project = await store.createProjectAttribute(projectId, "env", "prod");
        const shadowedId = project.attributes[0].id;
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes/${shadowedId}`);
        const { attribute } = (await res.json()) as { attribute: ResolvedAttribute };

        expect(attribute).toMatchObject({ value: "prod", scope: "project" });
    });

    it("returns 404 for an unknown attribute id", async () => {
        const res = await call("GET", `/api/tasks/${taskId}/attributes/nope`);
        expect(res.status).toBe(404);
    });

    it("patches a task attribute", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {
            value: "prod",
        });
        const task = (await res.json()) as Task;

        expect(task.attributes[0].value).toBe("prod");
    });

    it("rejects a patch with no recognised field", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {});
        expect(res.status).toBe(400);
    });

    it("deletes a task attribute", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("DELETE", `/api/tasks/${taskId}/attributes/${attrId}`);
        const task = (await res.json()) as Task;

        expect(task.attributes).toEqual([]);
    });

    it("creates and lists project attributes", async () => {
        const createRes = await call("POST", `/api/projects/${projectId}/attributes`, {
            name: "team",
            value: "core",
        });
        const project = (await createRes.json()) as Project;
        expect(project.attributes[0]).toMatchObject({ name: "team" });

        const listRes = await call("GET", `/api/projects/${projectId}/attributes`);
        const { attributes } = (await listRes.json()) as { attributes: ResolvedAttribute[] };
        expect(attributes).toEqual([matchesAttribute({ name: "team", scope: "project" })]);
    });

    it("refuses to edit a project attribute from task context", async () => {
        const project = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = project.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {
            value: "infra",
        });

        expect(res.status).toBe(400);
        const { error } = (await res.json()) as { error: string };
        expect(error).toContain("belongs to project");
        expect(error).toContain(`--project-id ${projectId}`);
    });

    it("refuses to delete a parent task's attribute from a subtask", async () => {
        const parent = await store.createTask({ projectId, title: "P", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "C",
            description: "",
        });
        const withAttr = await store.createTaskAttribute(parent.id, "env", "staging");
        const attrId = withAttr.attributes[0].id;

        const res = await call("DELETE", `/api/tasks/${child.id}/attributes/${attrId}`);

        expect(res.status).toBe(400);
        const { error } = (await res.json()) as { error: string };
        expect(error).toContain("belongs to parent task");
        expect(error).toContain(`--task-id ${parent.id}`);
    });

    it("keeps the created attribute's id stable across a rename", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, { name: "environment" });
        const res = await call("GET", `/api/tasks/${taskId}/attributes/${attrId}`);
        const { attribute } = (await res.json()) as { attribute: Attribute };

        expect(attribute.id).toBe(attrId);
        expect(attribute.name).toBe("environment");
    });
});

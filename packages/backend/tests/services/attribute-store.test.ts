import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../src/services/task-store";

describe("TaskStore attributes", () => {
    let tempDir: string;
    let store: TaskStore;
    let projectId: string;
    let projectPath: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        const project = await store.addProject({ path: projectPath });
        projectId = project.id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("starts a new task with an empty attribute list", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        expect(task.attributes).toEqual([]);
    });

    it("starts a new project with an empty attribute list", async () => {
        const project = await store.getProject(projectId);
        expect(project?.attributes).toEqual([]);
    });

    it("defaults attributes to [] when reading a legacy task record", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        const raw = { ...task } as Record<string, unknown>;
        delete raw.attributes;
        await writeFile(join(tempDir, "tasks", `${task.id}.json`), JSON.stringify(raw), "utf-8");

        const reread = await store.getTask(task.id);
        expect(reread?.attributes).toEqual([]);
    });

    it("defaults attributes to [] when reading a legacy project record", async () => {
        await writeFile(
            join(tempDir, "projects.json"),
            JSON.stringify([
                {
                    id: projectId,
                    name: "repo",
                    path: projectPath,
                    sessions: [],
                    createdAt: new Date(0).toISOString(),
                },
            ]),
            "utf-8",
        );

        const project = await store.getProject(projectId);
        expect(project?.attributes).toEqual([]);
    });

    it("creates, renames, sets and deletes a task attribute", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });

        const created = await store.createTaskAttribute(task.id, "  env  ", "dev");
        expect(created.attributes).toHaveLength(1);
        expect(created.attributes[0].name).toBe("env");
        expect(created.attributes[0].value).toBe("dev");
        const attrId = created.attributes[0].id;

        const renamed = await store.updateTaskAttribute(task.id, attrId, { name: "environment" });
        expect(renamed.attributes[0].name).toBe("environment");

        const valued = await store.updateTaskAttribute(task.id, attrId, { value: "prod" });
        expect(valued.attributes[0].value).toBe("prod");

        const deleted = await store.deleteTaskAttribute(task.id, attrId);
        expect(deleted.attributes).toEqual([]);
    });

    it("persists task attributes across reads", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createTaskAttribute(task.id, "env", "dev");

        const reread = await store.getTask(task.id);
        expect(reread?.attributes[0]).toMatchObject({ name: "env", value: "dev" });
    });

    it("creates, renames, sets and deletes a project attribute", async () => {
        const created = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = created.attributes[0].id;

        const renamed = await store.updateProjectAttribute(projectId, attrId, { name: "squad" });
        expect(renamed.attributes[0].name).toBe("squad");

        const valued = await store.updateProjectAttribute(projectId, attrId, { value: "infra" });
        expect(valued.attributes[0].value).toBe("infra");

        const deleted = await store.deleteProjectAttribute(projectId, attrId);
        expect(deleted.attributes).toEqual([]);
    });

    it("rejects a duplicate name within one task", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createTaskAttribute(task.id, "env", "dev");

        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(store.createTaskAttribute(task.id, "env", "prod")).rejects.toThrow(
            'Attribute name already exists: "env"',
        );
    });

    it("accepts the same name on a task and its project", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "env", "prod");
        const updated = await store.createTaskAttribute(task.id, "env", "dev");

        expect(updated.attributes[0].value).toBe("dev");
    });

    it("rejects an unknown task", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(store.createTaskAttribute("missing", "env", "dev")).rejects.toThrow(
            "Task not found: missing",
        );
    });

    it("rejects an unknown project", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(store.createProjectAttribute("missing", "env", "dev")).rejects.toThrow(
            "Project not found: missing",
        );
    });

    it("keeps both attributes when two project creates race", async () => {
        await Promise.all([
            store.createProjectAttribute(projectId, "env", "prod"),
            store.createProjectAttribute(projectId, "team", "core"),
        ]);

        const project = await store.getProject(projectId);
        expect(project?.attributes.map((a) => a.name).sort()).toEqual(["env", "team"]);
    });

    it("keeps both attributes when two task creates race", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await Promise.all([
            store.createTaskAttribute(task.id, "env", "prod"),
            store.createTaskAttribute(task.id, "team", "core"),
        ]);

        const reread = await store.getTask(task.id);
        expect(reread?.attributes.map((a) => a.name).sort()).toEqual(["env", "team"]);
    });

    it("resolves project and task layers for a top-level task", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createTaskAttribute(task.id, "ticket", "T-9");

        const layers = await store.resolveTaskAttributeLayers(task.id);
        expect(layers.map((l) => l.scope)).toEqual(["project", "task"]);
        expect(layers[0].attributes[0].name).toBe("env");
        expect(layers[1].attributes[0].name).toBe("ticket");
    });

    it("resolves three layers for a subtask", async () => {
        const parent = await store.createTask({ projectId, title: "P", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "C",
            description: "",
        });
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createTaskAttribute(parent.id, "env", "staging");
        await store.createTaskAttribute(child.id, "env", "dev");

        const layers = await store.resolveTaskAttributeLayers(child.id);
        expect(layers.map((l) => l.scope)).toEqual(["project", "parent", "task"]);
        expect(layers[1].attributes[0].value).toBe("staging");
    });

    it("resolves a single layer for a project", async () => {
        await store.createProjectAttribute(projectId, "env", "prod");
        const layers = await store.resolveProjectAttributeLayers(projectId);
        expect(layers.map((l) => l.scope)).toEqual(["project"]);
    });
});

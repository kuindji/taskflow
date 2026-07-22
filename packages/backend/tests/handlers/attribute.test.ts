import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { Project, Task, WsEvent } from "@taskflow/shared";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { registerAttributeHandlers } from "../../src/handlers/attribute";

describe("attribute handlers", () => {
    let tempDir: string;
    let store: TaskStore;
    let router: Router;
    let events: WsEvent[];
    let projectId: string;
    let taskId: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-ws-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        router = new Router();
        events = [];
        registerAttributeHandlers({
            router,
            store,
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

    it("creates a task attribute and broadcasts TASK_UPDATED", async () => {
        const task = (await router.handle(MSG.ATTR_CREATE, {
            taskId,
            name: "env",
            value: "dev",
        })) as Task;

        expect(task.attributes).toHaveLength(1);
        expect(task.attributes[0]).toMatchObject({ name: "env", value: "dev" });
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe(MSG.TASK_UPDATED);
    });

    it("defaults a missing value to an empty string", async () => {
        const task = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        expect(task.attributes[0].value).toBe("");
    });

    it("updates a task attribute", async () => {
        const created = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        const attrId = created.attributes[0].id;

        const updated = (await router.handle(MSG.ATTR_UPDATE, {
            taskId,
            attrId,
            value: "prod",
        })) as Task;

        expect(updated.attributes[0].value).toBe("prod");
    });

    it("deletes a task attribute", async () => {
        const created = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        const attrId = created.attributes[0].id;

        const updated = (await router.handle(MSG.ATTR_DELETE, { taskId, attrId })) as Task;
        expect(updated.attributes).toEqual([]);
    });

    it("creates a project attribute and broadcasts PROJECT_UPDATED", async () => {
        const project = (await router.handle(MSG.ATTR_CREATE, {
            projectId,
            name: "team",
            value: "core",
        })) as Project;

        expect(project.attributes[0]).toMatchObject({ name: "team", value: "core" });
        expect(events[0].type).toBe(MSG.PROJECT_UPDATED);
    });

    it("rejects a payload naming neither owner", async () => {
        expect(router.handle(MSG.ATTR_CREATE, { name: "env" })).rejects.toThrow(
            "Attribute owner requires taskId or projectId",
        );
    });

    it("rejects a payload naming both owners", async () => {
        expect(
            router.handle(MSG.ATTR_CREATE, { taskId, projectId, name: "env" }),
        ).rejects.toThrow("Attribute owner must be taskId or projectId, not both");
    });

    it("propagates a duplicate-name error", async () => {
        await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" });
        expect(router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })).rejects.toThrow(
            'Attribute name already exists: "env"',
        );
    });

    it("rejects a non-string value on create", async () => {
        expect(
            router.handle(MSG.ATTR_CREATE, { taskId, name: "env", value: 999 }),
        ).rejects.toThrow('Field "value" must be a string');
    });

    it("rejects a missing name on create", async () => {
        expect(router.handle(MSG.ATTR_CREATE, { taskId })).rejects.toThrow(
            'Field "name" is required and must be a string',
        );
    });

    it("rejects a non-string attrId on delete", async () => {
        expect(router.handle(MSG.ATTR_DELETE, { taskId, attrId: 123 })).rejects.toThrow(
            'Field "attrId" is required and must be a string',
        );
    });
});

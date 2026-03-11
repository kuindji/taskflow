import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerTaskHandlers } from "../../src/handlers/task";
import { registerProjectHandlers } from "../../src/handlers/project";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { GitService } from "../../src/services/git-service";

describe("task handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
        });
        await store.init();
        router = new Router();
        registerProjectHandlers(router, store, new GitService());
        registerTaskHandlers({ router, store });
        const projectDir = join(tempDir, "test");
        await mkdir(projectDir, { recursive: true });
        const project = await store.addProject({ name: "test", path: projectDir });
        projectId = project.id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("creates and lists tasks", async () => {
        await router.handle(MSG.TASK_CREATE, { projectId, title: "Test task" });
        const result = (await router.handle(MSG.TASK_LIST, {})) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(1);
    });

    it("filters tasks by project", async () => {
        await router.handle(MSG.TASK_CREATE, { projectId, title: "Task 1" });
        const result = (await router.handle(MSG.TASK_LIST, { projectId })) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(1);
    });

    it("updates a task", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Original",
        })) as { id: string };
        const updated = (await router.handle(MSG.TASK_UPDATE, {
            id: task.id,
            title: "Updated",
        })) as { title: string };
        expect(updated.title).toBe("Updated");
    });

    it("archives a task", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        await router.handle(MSG.TASK_ARCHIVE, { id: task.id });
        const result = (await router.handle(MSG.TASK_LIST, {})) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(0);
    });

    it("deletes a task", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        await router.handle(MSG.TASK_DELETE, { id: task.id });
        const result = (await router.handle(MSG.TASK_LIST, {})) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(0);
    });
});

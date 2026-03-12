import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerProjectHandlers } from "../../src/handlers/project";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { GitService } from "../../src/services/git-service";

describe("project handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        router = new Router();
        registerProjectHandlers(router, store, new GitService());
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    async function createProjectDir(name: string): Promise<string> {
        const dir = join(tempDir, name);
        await mkdir(dir, { recursive: true });
        return dir;
    }

    it("lists projects (empty)", async () => {
        const result = await router.handle(MSG.PROJECT_LIST, {});
        expect(result).toEqual({ projects: [] });
    });

    it("adds and lists a project", async () => {
        const projectDir = await createProjectDir("test");
        await router.handle(MSG.PROJECT_ADD, { name: "test", path: projectDir });
        const result = (await router.handle(MSG.PROJECT_LIST, {})) as {
            projects: unknown[];
        };
        expect(result.projects).toHaveLength(1);
    });

    it("removes a project", async () => {
        const projectDir = await createProjectDir("test");
        const added = (await router.handle(MSG.PROJECT_ADD, {
            name: "test",
            path: projectDir,
        })) as { id: string };
        await router.handle(MSG.PROJECT_REMOVE, { id: added.id });
        const result = (await router.handle(MSG.PROJECT_LIST, {})) as {
            projects: unknown[];
        };
        expect(result.projects).toHaveLength(0);
    });

    it("removes a project with existing tasks", async () => {
        const projectDir = await createProjectDir("test");
        const added = (await router.handle(MSG.PROJECT_ADD, {
            name: "test",
            path: projectDir,
        })) as { id: string };
        await store.createTask({ projectId: added.id, title: "Task", description: "test" });
        await router.handle(MSG.PROJECT_REMOVE, { id: added.id });
        const result = (await router.handle(MSG.PROJECT_LIST, {})) as {
            projects: unknown[];
        };
        expect(result.projects).toHaveLength(0);
    });
});

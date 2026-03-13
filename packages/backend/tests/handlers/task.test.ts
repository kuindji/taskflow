import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerTaskHandlers } from "../../src/handlers/task";
import { registerProjectHandlers } from "../../src/handlers/project";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import { writeFile } from "fs/promises";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    removedWorktrees: Array<{ repoPath: string; worktreePath: string }> = [];
    deletedBranches: Array<{ repoPath: string; branch: string }> = [];

    async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
        this.removedWorktrees.push({ repoPath, worktreePath });
    }

    async deleteBranch(repoPath: string, branch: string): Promise<void> {
        this.deletedBranches.push({ repoPath, branch });
    }
}

describe("task handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;
    let projectPath: string;
    let gitService: FakeGitService;
    let generatedTitles: Array<{ taskId: string; description: string }>;

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
        gitService = new FakeGitService();
        generatedTitles = [];
        registerProjectHandlers(router, store, gitService as unknown as GitService);
        registerTaskHandlers({
            router,
            store,
            gitService: gitService as unknown as GitService,
            generateTitle: (taskId, description) => {
                generatedTitles.push({ taskId, description });
            },
        });
        projectPath = join(tempDir, "test");
        await mkdir(projectPath, { recursive: true });
        const project = await store.addProject({ name: "test", path: projectPath });
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

    it("creates worktree-enabled tasks with pending worktree metadata", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Worktree task",
            worktree: true,
        })) as Task;

        expect(task.worktree).toEqual({ enabled: true, path: null, branch: null });
    });

    it("requests generated titles when creating untitled tasks", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            description: "Investigate flaky worktree setup",
        })) as Task;

        expect(generatedTitles).toEqual([
            { taskId: task.id, description: "Investigate flaky worktree setup" },
        ]);
    });

    it("filters tasks by project", async () => {
        await router.handle(MSG.TASK_CREATE, { projectId, title: "Task 1" });
        const result = (await router.handle(MSG.TASK_LIST, { projectId })) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(1);
    });

    it("lists tasks by newest creation date first", async () => {
        const firstTask = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "First",
        })) as Task;
        const secondTask = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Second",
        })) as Task;

        await writeFile(
            join(tempDir, "tasks", `${firstTask.id}.json`),
            JSON.stringify({ ...firstTask, createdAt: "2026-01-01T00:00:00.000Z" }, null, 2),
        );
        await writeFile(
            join(tempDir, "tasks", `${secondTask.id}.json`),
            JSON.stringify({ ...secondTask, createdAt: "2026-02-01T00:00:00.000Z" }, null, 2),
        );

        const result = (await router.handle(MSG.TASK_LIST, {})) as {
            tasks: Task[];
        };

        expect(result.tasks.map((task) => task.id)).toEqual([secondTask.id, firstTask.id]);
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

    it("cleans up worktree resources when requested on delete", async () => {
        const task = await store.createTask({
            projectId,
            title: "Worktree task",
            description: "test",
            worktree: {
                enabled: true,
                path: join(projectPath, ".worktrees", "worktree-task"),
                branch: "task/worktree-task",
            },
        });

        await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: true });

        expect(gitService.removedWorktrees).toEqual([
            { repoPath: projectPath, worktreePath: join(projectPath, ".worktrees", "worktree-task") },
        ]);
        expect(gitService.deletedBranches).toEqual([
            { repoPath: projectPath, branch: "task/worktree-task" },
        ]);
    });

    it("skips worktree cleanup when deleteWorktree is false", async () => {
        const task = await store.createTask({
            projectId,
            title: "Worktree task",
            description: "test",
            worktree: {
                enabled: true,
                path: join(projectPath, ".worktrees", "worktree-task"),
                branch: "task/worktree-task",
            },
        });

        await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: false });

        expect(gitService.removedWorktrees).toEqual([]);
        expect(gitService.deletedBranches).toEqual([]);
    });
});

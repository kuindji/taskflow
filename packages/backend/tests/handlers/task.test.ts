import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerTaskHandlers } from "../../src/handlers/task";
import { registerProjectHandlers } from "../../src/handlers/project";
import { TestRouter } from "../test-router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import { writeFile } from "fs/promises";
import type { GitService } from "../../src/services/git-service";

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

class FakeGitService {
    removeHold: Promise<void> | undefined;
    removeError: Error | undefined;
    branchError: Error | undefined;
    removedWorktrees: Array<{ repoPath: string; worktreePath: string }> = [];
    deletedBranches: Array<{ repoPath: string; branch: string }> = [];

    async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
        this.removedWorktrees.push({ repoPath, worktreePath });
        await this.removeHold;
        if (this.removeError) throw this.removeError;
    }

    async deleteBranch(repoPath: string, branch: string): Promise<void> {
        this.deletedBranches.push({ repoPath, branch });
        if (this.branchError) throw this.branchError;
    }
}

describe("task handlers", () => {
    let router: TestRouter;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;
    let projectPath: string;
    let gitService: FakeGitService;
    let closedOwners: Array<{ taskId: string } | { projectId: string }>;
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
        router = new TestRouter();
        gitService = new FakeGitService();
        generatedTitles = [];
        closedOwners = [];
        const browserTabService = {
            closeForOwner: async (owner: { taskId: string } | { projectId: string }) => {
                closedOwners.push(owner);
            },
        };
        registerProjectHandlers(
            router,
            store,
            gitService as unknown as GitService,
            browserTabService,
        );
        registerTaskHandlers({
            browserTabService,
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

        expect(task.worktree).toEqual({ enabled: true, path: null, branch: null, pr: null });
    });

    it("defaults worktree init commands from the project unless explicitly overridden", async () => {
        await store.updateProject(projectId, { defaultInitCommand: "bun install" });

        const defaultedTask = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Defaulted init",
            worktree: true,
        })) as Task;
        expect(defaultedTask.initCommand).toBe("bun install");

        const clearedTask = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "No init",
            worktree: true,
            initCommand: "",
        })) as Task;
        expect(clearedTask.initCommand).toBe("bun install");

        const overriddenTask = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Custom init",
            worktree: true,
            initCommand: "pnpm install",
        })) as Task;
        expect(overriddenTask.initCommand).toBe("pnpm install");
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
        expect(closedOwners).toEqual([{ taskId: task.id }]);
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
        expect(closedOwners).toEqual([{ taskId: task.id }]);
        const result = (await router.handle(MSG.TASK_LIST, {})) as {
            tasks: unknown[];
        };
        expect(result.tasks).toHaveLength(0);
    });

    it("closes browser tabs for archived parents and subtasks", async () => {
        const parent = await store.createTask({ projectId, title: "Parent", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "Child",
            description: "",
        });
        await router.handle(MSG.TASK_ARCHIVE, { id: parent.id });
        expect(closedOwners).toEqual([{ taskId: child.id }, { taskId: parent.id }]);
    });

    for (const archived of [false, true]) {
        it(`closes browser tabs when deleting a parent and active/archived subtasks, parent archived=${archived}`, async () => {
            const parent = await store.createTask({ projectId, title: "Parent", description: "" });
            const child = await store.createTask({
                projectId,
                parentId: parent.id,
                title: "Child",
                description: "",
            });
            const archivedChild = await store.createTask({
                projectId,
                parentId: parent.id,
                title: "Archived",
                description: "",
            });
            await store.archiveTask(archivedChild.id);
            if (archived) await store.archiveTask(parent.id);
            await router.handle(MSG.TASK_DELETE, { id: parent.id });
            expect(closedOwners).toEqual([
                { taskId: child.id },
                { taskId: archivedChild.id },
                { taskId: parent.id },
            ]);
        });
    }

    it("cleans up worktree resources when requested on delete", async () => {
        const task = await store.createTask({
            projectId,
            title: "Worktree task",
            description: "test",
            worktree: {
                enabled: true,
                path: join(projectPath, ".worktrees", "worktree-task"),
                branch: "task/worktree-task",
                pr: null,
            },
        });

        await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: true });

        await waitFor(() => gitService.deletedBranches.length > 0);

        expect(gitService.removedWorktrees).toEqual([
            {
                repoPath: projectPath,
                worktreePath: join(projectPath, ".worktrees", "worktree-task"),
            },
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
                pr: null,
            },
        });

        await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: false });

        expect(gitService.removedWorktrees).toEqual([]);
        expect(gitService.deletedBranches).toEqual([]);
    });
    async function worktreeTask(parentId?: string): Promise<Task> {
        return store.createTask({
            projectId,
            title: "Cleanup",
            description: "",
            parentId,
            worktree: {
                enabled: true,
                path: join(projectPath, ".worktrees", "cleanup"),
                branch: "task/cleanup",
                pr: null,
            },
        });
    }
    it("delete waits for worktree cleanup before replying", async () => {
        const task = await worktreeTask();
        let release = () => {};
        gitService.removeHold = new Promise<void>((resolve) => {
            release = resolve;
        });
        let replied = false;
        const pending = router
            .handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: true })
            .then((result) => {
                replied = true;
                return result;
            });
        await waitFor(() => gitService.removedWorktrees.length > 0);
        try {
            expect(await store.getTask(task.id)).toBeNull();
            expect(closedOwners).toContainEqual({ taskId: task.id });
            expect(replied).toBe(false);
        } finally {
            release();
            await pending;
        }
    });
    it("branch deletion still runs after removal fails", async () => {
        const task = await worktreeTask();
        gitService.removeError = new Error("removal denied");
        const result = await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: true });
        expect(gitService.deletedBranches).toEqual([
            { repoPath: projectPath, branch: "task/cleanup" },
        ]);
        expect(result).toEqual({
            success: true,
            cleanupError:
                "Task deleted, but worktree cleanup failed: remove worktree: removal denied",
        });
    });
    it("both cleanup failures reach the response without undoing task deletion", async () => {
        const task = await worktreeTask();
        gitService.removeError = new Error("removal denied");
        gitService.branchError = new Error("branch denied");
        const result = await router.handle(MSG.TASK_DELETE, { id: task.id, deleteWorktree: true });
        expect(result).toEqual({
            success: true,
            cleanupError:
                "Task deleted, but worktree cleanup failed: remove worktree: removal denied; delete branch: branch denied",
        });
        expect(await store.getTask(task.id)).toBeNull();
    });
    it("subtask deletion never removes the shared worktree", async () => {
        const parent = await worktreeTask();
        const child = await worktreeTask(parent.id);
        expect(
            await router.handle(MSG.TASK_DELETE, { id: child.id, deleteWorktree: true }),
        ).toEqual({ success: true });
        expect(gitService.removedWorktrees).toEqual([]);
        expect(gitService.deletedBranches).toEqual([]);
        expect(await store.getTask(parent.id)).not.toBeNull();
    });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Task } from "@taskflow/shared";
import type { GitService } from "../../src/services/git-service";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerTaskRoutes } from "../../src/api/routes/task-routes";

describe("HTTP task worktree cleanup", () => {
    let root: string;
    let store: TaskStore;
    let router: ApiRouter;
    let projectId: string;
    let removed: string[];
    let branches: string[];
    let closed: string[];
    let hold: Promise<void> | undefined;
    let removeError: Error | undefined;
    let branchError: Error | undefined;
    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-http-cleanup-")));
        store = new TaskStore({
            projectsFile: join(root, "projects.json"),
            tasksDir: join(root, "tasks"),
            archiveDir: join(root, "archive"),
            sessionLogsDir: join(root, "sessions"),
            taskLogsDir: join(root, "logs"),
        });
        await store.init();
        await mkdir(join(root, "repo"));
        projectId = (await store.addProject({ path: join(root, "repo") })).id;
        removed = [];
        branches = [];
        closed = [];
        hold = undefined;
        removeError = undefined;
        branchError = undefined;
        const gitService = {
            async isBranchMerged() {
                return true;
            },
            async removeWorktree(_repo: string, path: string) {
                removed.push(path);
                await hold;
                if (removeError) throw removeError;
            },
            async deleteBranch(_repo: string, branch: string) {
                branches.push(branch);
                if (branchError) throw branchError;
            },
        };
        router = new ApiRouter();
        registerTaskRoutes({
            apiRouter: router,
            taskStore: store,
            browserTabService: {
                closeForOwner: async (owner) => {
                    if ("taskId" in owner) closed.push(owner.taskId);
                },
            },
            gitService: gitService as unknown as GitService,
            ptyManager: {} as never,
            broadcast: () => {},
            flowStore: { getFlowRunsForOwner: async () => [] } as never,
            flowRunner: {} as never,
        });
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });
    async function task(parentId?: string): Promise<Task> {
        return store.createTask({
            projectId,
            title: "Cleanup",
            description: "",
            parentId,
            worktree: {
                enabled: true,
                path: join(root, "linked"),
                branch: "task/cleanup",
                pr: null,
            },
        });
    }
    async function remove(id: string): Promise<Response> {
        const response = await router.handle(
            new Request(`http://localhost/api/tasks/${id}`, {
                method: "DELETE",
                body: JSON.stringify({ deleteWorktree: true }),
            }),
        );
        if (!response) throw new Error("No HTTP route");
        return response;
    }
    it("delete waits for worktree cleanup before replying", async () => {
        const record = await task();
        let release = () => {};
        hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        let replied = false;
        const pending = remove(record.id).then((response) => {
            replied = true;
            return response;
        });
        while (removed.length === 0) await Bun.sleep(1);
        try {
            expect(await store.getTask(record.id)).toBeNull();
            expect(closed).toContain(record.id);
            expect(replied).toBe(false);
        } finally {
            release();
            await pending;
        }
    });
    it("branch deletion still runs after removal fails", async () => {
        const record = await task();
        removeError = new Error("remove denied");
        const response = await remove(record.id);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            success: true,
            cleanupError:
                "Task deleted, but worktree cleanup failed: remove worktree: remove denied",
        });
        expect(branches).toEqual(["task/cleanup"]);
    });
    it("both cleanup failures reach the response", async () => {
        const record = await task();
        removeError = new Error("remove denied");
        branchError = new Error("branch denied");
        const response = await remove(record.id);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            success: true,
            cleanupError:
                "Task deleted, but worktree cleanup failed: remove worktree: remove denied; delete branch: branch denied",
        });
    });
    it("cleanup failure does not undo task deletion", async () => {
        const record = await task();
        branchError = new Error("branch denied");
        const response = await remove(record.id);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            success: true,
            cleanupError: "Task deleted, but worktree cleanup failed: delete branch: branch denied",
        });
        expect(await store.getTask(record.id)).toBeNull();
    });
    it("subtask deletion never removes the shared worktree", async () => {
        const parent = await task();
        const child = await task(parent.id);
        expect(await (await remove(child.id)).json()).toEqual({ success: true });
        expect(removed).toEqual([]);
        expect(branches).toEqual([]);
        expect(await store.getTask(parent.id)).not.toBeNull();
    });
    it("disabling a subtask's worktree never removes the shared worktree", async () => {
        const parent = await task();
        const child = await task(parent.id);
        const response = await router.handle(
            new Request(`http://localhost/api/tasks/${child.id}/worktree`, {
                method: "PATCH",
                body: JSON.stringify({ enabled: false }),
            }),
        );
        expect(response?.status).toBe(400);
        expect(removed).toEqual([]);
        expect(branches).toEqual([]);
        expect((await store.getTask(child.id))?.worktree.enabled).toBe(true);
    });
});

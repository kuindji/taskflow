import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerGitHandlers } from "../../src/handlers/git";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    statusCalls: string[] = [];
    createdWorktrees: Array<{ repoPath: string; branch: string; worktreePath: string }> = [];

    async status(repoPath: string) {
        this.statusCalls.push(repoPath);
        return { branch: "task/test-worktree", files: [], ahead: 0 };
    }

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        this.createdWorktrees.push({ repoPath, branch, worktreePath });
    }
}

async function expectRejects(fn: () => Promise<unknown>, match: string) {
    try {
        await fn();
        expect.unreachable("Expected promise to reject");
    } catch (error) {
        expect(String(error)).toContain(match);
    }
}

describe("git handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;
    let projectPath: string;
    let worktreePath: string;
    let git: FakeGitService;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-git-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();

        projectPath = join(tempDir, "project");
        worktreePath = join(projectPath, ".worktrees", "task-worktree");
        await mkdir(worktreePath, { recursive: true });

        const project = await store.addProject({ name: "project", path: projectPath });
        await store.createTask({
            projectId: project.id,
            title: "Worktree task",
            description: "test",
            worktree: {
                enabled: true,
                path: worktreePath,
                branch: "task/task-worktree",
                pr: null,
            },
        });

        router = new Router();
        git = new FakeGitService();
        registerGitHandlers({
            router,
            git: git as unknown as GitService,
            taskStore: store,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("accepts task worktree paths as workspace repos", async () => {
        const result = await router.handle(MSG.GIT_STATUS, { path: worktreePath });

        expect(result).toEqual({
            status: { branch: "task/test-worktree", files: [], ahead: 0 },
        });
        expect(git.statusCalls).toEqual([worktreePath]);
    });

    it("creates worktrees only inside the repo .worktrees directory", async () => {
        const requestedPath = join(projectPath, ".worktrees", "..", ".worktrees", "new-task");

        const result = await router.handle(MSG.GIT_WORKTREE_CREATE, {
            repoPath: projectPath,
            branch: "task/new-task",
            path: requestedPath,
        });

        expect(result).toEqual({ success: true });
        expect(git.createdWorktrees).toEqual([
            {
                repoPath: projectPath,
                branch: "task/new-task",
                worktreePath: join(projectPath, ".worktrees", "new-task"),
            },
        ]);
    });

    it("rejects worktree creation outside the repo .worktrees directory", async () => {
        await expectRejects(
            () =>
                router.handle(MSG.GIT_WORKTREE_CREATE, {
                    repoPath: projectPath,
                    branch: "task/escape",
                    path: join(projectPath, "..", "escape"),
                }),
            "Worktree path must be inside",
        );
    });
});

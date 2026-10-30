import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerGitHandlers } from "../../src/handlers/git";
import { TestRouter } from "../test-router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type {
    GitCheckPrResult,
    GitCreatePrResult,
    GitDiffFileResult,
    GitDiffFileContentResult,
    GitFileContentPair,
} from "@taskflow/shared";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    lookup: GitCheckPrResult = { status: "none", provider: "gitlab", pr: null };
    created: GitCreatePrResult = {
        number: 7,
        url: "https://gitlab.com/g/r/-/merge_requests/7",
        provider: "gitlab",
        state: "open",
    };
    async checkBranchPr() {
        return this.lookup;
    }
    async createPr() {
        return this.created;
    }
    statusCalls: string[] = [];
    patch: GitDiffFileResult = { state: "tooLarge" };
    pair: GitFileContentPair = { original: "", modified: "" };
    async diffFile(): Promise<GitDiffFileResult> {
        return this.patch;
    }
    async getFileContentsForDiff(): Promise<GitDiffFileContentResult> {
        return { staged: null, unstaged: this.pair };
    }
    createdWorktrees: Array<{ repoPath: string; branch: string; worktreePath: string }> = [];
    logCalls: Array<{ repoPath: string; limit: number; skip: number }> = [];
    commitFilesCalls: Array<{ repoPath: string; hash: string }> = [];
    commitDiffFileCalls: Array<{
        repoPath: string;
        hash: string;
        path: string;
        previousPath?: string;
    }> = [];
    commitMessageCalls: Array<{ repoPath: string; generated: string }> = [];

    async status(repoPath: string) {
        this.statusCalls.push(repoPath);
        return { branch: "task/test-worktree", files: [], ahead: 0 };
    }

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        this.createdWorktrees.push({ repoPath, branch, worktreePath });
    }

    async log(repoPath: string, limit: number, skip: number) {
        this.logCalls.push({ repoPath, limit, skip });
        return { entries: [], hasMore: false };
    }

    async commitFiles(repoPath: string, hash: string) {
        this.commitFilesCalls.push({ repoPath, hash });
        return { files: [] };
    }

    async commitDiffFile(repoPath: string, hash: string, path: string, previousPath?: string) {
        this.commitDiffFileCalls.push({ repoPath, hash, path, previousPath });
        return this.pair;
    }

    async generateCommitMessage(
        repoPath: string,
        _includeUnstaged: boolean,
        generate: (diff: string) => Promise<string>,
    ) {
        const generated = await generate("DIFF");
        this.commitMessageCalls.push({ repoPath, generated });
        return generated;
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
    let router: TestRouter;
    let store: TaskStore;
    let tempDir: string;
    let projectPath: string;
    let worktreePath: string;
    let git: FakeGitService;
    let runnerCalls: unknown[];
    let projectId: string;
    let broadcasts: unknown[];

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
        projectId = project.id;
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

        broadcasts = [];
        router = new TestRouter();
        git = new FakeGitService();
        runnerCalls = [];
        registerGitHandlers({
            router,
            git: git as unknown as GitService,
            taskStore: store,
            broadcast: (event) => {
                broadcasts.push(event);
            },
            builtinActionRunner: {
                runHeadless: async (id, vars, context) => {
                    runnerCalls.push({ id, vars, context });
                    return "feat: generated";
                },
            },
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("GIT_CHECK_PR preserves found none and unavailable states", async () => {
        for (const result of [
            { status: "found", provider: "gitlab", pr: git.created },
            { status: "none", provider: "gitlab", pr: null },
            {
                status: "unavailable",
                provider: "gitlab",
                pr: null,
                reason: "failed",
                message: "Merge request status is unavailable",
            },
        ] satisfies GitCheckPrResult[]) {
            git.lookup = result;
            expect(
                await router.handle(MSG.GIT_CHECK_PR, { path: worktreePath, branch: "topic" }),
            ).toEqual(result);
        }
    });
    it("GitLab creation persists provider and state and broadcasts the task", async () => {
        const task = (await store.listTasks())[0];
        expect(
            await router.handle(MSG.GIT_CREATE_PR, {
                path: worktreePath,
                title: "MR",
                taskId: task.id,
            }),
        ).toEqual(git.created);
        expect((await store.getTask(task.id))?.worktree.pr).toEqual(git.created);
        expect(broadcasts).toEqual([
            { type: MSG.TASK_UPDATED, payload: await store.getTask(task.id) },
        ]);
    });
    it("successful remote creation survives task metadata persistence failure", async () => {
        expect(
            await router.handle(MSG.GIT_CREATE_PR, {
                path: worktreePath,
                title: "MR",
                taskId: "missing-task",
            }),
        ).toEqual(git.created);
        expect(broadcasts).toHaveLength(0);
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

    const validHash = "a".repeat(40);

    it("serves git log for a workspace repo with clamped paging", async () => {
        const result = await router.handle(MSG.GIT_LOG, {
            repoPath: projectPath,
            limit: 9999,
            skip: -5,
        });

        expect(result).toEqual({ entries: [], hasMore: false });
        expect(git.logCalls).toEqual([{ repoPath: projectPath, limit: 500, skip: 0 }]);
    });

    it("applies default log paging when omitted", async () => {
        await router.handle(MSG.GIT_LOG, { repoPath: projectPath });
        expect(git.logCalls).toEqual([{ repoPath: projectPath, limit: 100, skip: 0 }]);
    });

    it("rejects git log outside workspace repos", async () => {
        await expectRejects(
            () => router.handle(MSG.GIT_LOG, { repoPath: join(tempDir, "elsewhere") }),
            "outside known workspaces",
        );
    });

    it("serves commit files for a valid hash", async () => {
        const result = await router.handle(MSG.GIT_COMMIT_FILES, {
            repoPath: projectPath,
            hash: validHash,
        });

        expect(result).toEqual({ files: [] });
        expect(git.commitFilesCalls).toEqual([{ repoPath: projectPath, hash: validHash }]);
    });

    it("rejects malformed commit hashes", async () => {
        await expectRejects(
            () =>
                router.handle(MSG.GIT_COMMIT_FILES, {
                    repoPath: projectPath,
                    hash: "HEAD^{/pwn}",
                }),
            "Invalid commit hash",
        );
        expect(git.commitFilesCalls).toEqual([]);
    });

    it("serves commit file diff content and validates paths", async () => {
        const result = await router.handle(MSG.GIT_COMMIT_DIFF_FILE, {
            repoPath: projectPath,
            hash: validHash,
            path: "src/file.ts",
            previousPath: "src/old.ts",
        });

        expect(result).toEqual({ original: "", modified: "" });
        expect(git.commitDiffFileCalls).toEqual([
            {
                repoPath: projectPath,
                hash: validHash,
                path: "src/file.ts",
                previousPath: "src/old.ts",
            },
        ]);
    });

    it("rejects commit diff paths escaping the repo", async () => {
        await expectRejects(
            () =>
                router.handle(MSG.GIT_COMMIT_DIFF_FILE, {
                    repoPath: projectPath,
                    hash: validHash,
                    path: "../../etc/passwd",
                }),
            "outside repository",
        );
        expect(git.commitDiffFileCalls).toEqual([]);
    });

    it("generates commit messages through the built-in, in the repo, for its project", async () => {
        const result = (await router.handle(MSG.GIT_GENERATE_COMMIT_MSG, {
            path: worktreePath,
        })) as { message: string };

        expect(result.message).toBe("feat: generated");
        expect(runnerCalls).toEqual([
            {
                id: "builtin:commit-message",
                vars: { diff: "DIFF" },
                context: { cwd: worktreePath, project: await store.getProject(projectId) },
            },
        ]);
    });
    it("preview and patch states reach the client without fabricated text", async () => {
        expect(
            await router.handle(MSG.GIT_DIFF_FILE, { repoPath: projectPath, filePath: "file" }),
        ).toEqual({ state: "tooLarge" });
        for (const pair of [
            { state: "tooLarge", limit: "preview" },
            { state: "binary" },
        ] as const) {
            git.pair = pair;
            expect(
                await router.handle(MSG.GIT_DIFF_FILE_CONTENT, {
                    repoPath: projectPath,
                    filePath: "file",
                }),
            ).toEqual({ staged: null, unstaged: pair });
            expect(
                await router.handle(MSG.GIT_COMMIT_DIFF_FILE, {
                    repoPath: projectPath,
                    hash: validHash,
                    path: "file",
                }),
            ).toEqual(pair);
        }
    });
});

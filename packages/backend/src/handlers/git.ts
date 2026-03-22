import { MSG } from "@taskflow/shared";
import type {
    GitStatusPayload,
    GitDiffPayload,
    GitDiffFilePayload,
    GitRevertFilePayload,
    GitWorktreeCreatePayload,
    GitCommitPayload,
    GitPullPayload,
    GitFetchPayload,
    GitPushPayload,
    GitCreatePrPayload,
    GitCheckPrPayload,
    GitStagePayload,
    GitUnstagePayload,
    GitGenerateCommitMsgPayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { GitService } from "../services/git-service";
import type { TaskStore } from "../services/task-store";
import type { ChangeTracker } from "../services/change-tracker";
import { filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";
import {
    assertWorkspaceRepo,
    assertRepoFilePath,
    assertWorktreePath,
} from "../utils/path-validation";

interface GitHandlerDeps {
    router: Router;
    git: GitService;
    taskStore: TaskStore;
    broadcast: (message: { type: string; payload: unknown }) => void;
    changeTracker?: ChangeTracker;
}

export function registerGitHandlers(deps: GitHandlerDeps): void {
    const { router, git, taskStore, broadcast, changeTracker } = deps;

    router.register(MSG.GIT_STATUS, async (payload) => {
        const { path } = payload as GitStatusPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return { status: await git.status(repoPath) };
    });

    router.register(MSG.GIT_DIFF, async (payload) => {
        const { path } = payload as GitDiffPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return { diff: await git.diff(repoPath) };
    });

    router.register(MSG.GIT_DIFF_FILE, async (payload) => {
        const { repoPath: rawRepoPath, filePath } = payload as GitDiffFilePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        assertRepoFilePath(repoPath, filePath);
        return await git.diffFile(repoPath, filePath);
    });

    router.register(MSG.GIT_REVERT_FILE, async (payload) => {
        const {
            repoPath: rawRepoPath,
            filePath,
            status,
            previousPath,
        } = payload as GitRevertFilePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        assertRepoFilePath(repoPath, filePath);
        if (previousPath) {
            assertRepoFilePath(repoPath, previousPath);
        }
        await git.revertFile(repoPath, { path: filePath, status, previousPath });
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_STAGE, async (payload) => {
        const { repoPath: rawRepoPath, filePath } = payload as GitStagePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        if (filePath) assertRepoFilePath(repoPath, filePath);
        await git.stage(repoPath, filePath);
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_UNSTAGE, async (payload) => {
        const { repoPath: rawRepoPath, filePath } = payload as GitUnstagePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        if (filePath) assertRepoFilePath(repoPath, filePath);
        await git.unstage(repoPath, filePath);
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_WORKTREE_CREATE, async (payload) => {
        const { repoPath: rawRepoPath, branch, path } = payload as GitWorktreeCreatePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        const worktreePath = assertWorktreePath(repoPath, path);
        await git.createWorktree(repoPath, branch, worktreePath);
        return { success: true };
    });

    router.register(MSG.GIT_PULL, async (payload) => {
        const { path } = payload as GitPullPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        await git.pull(repoPath);
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_FETCH, async (payload) => {
        const { path } = payload as GitFetchPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        await git.fetch(repoPath);
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_PUSH, async (payload) => {
        const { path } = payload as GitPushPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        await git.push(repoPath);
        changeTracker?.invalidate(repoPath);
        return { success: true };
    });

    router.register(MSG.GIT_COMMIT, async (payload) => {
        const { path, message, push, includeUnstaged } = payload as GitCommitPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const result = await git.commit(repoPath, message, push, includeUnstaged ?? true);
        changeTracker?.invalidate(repoPath);
        return result;
    });

    router.register(MSG.GIT_GENERATE_COMMIT_MSG, async (payload) => {
        const { path, includeUnstaged } = payload as GitGenerateCommitMsgPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const message = await git.generateCommitMessage(repoPath, includeUnstaged ?? true);
        return { message };
    });

    router.register(MSG.GIT_CREATE_PR, async (payload) => {
        const { path, title, body, taskId } = payload as GitCreatePrPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const result = await git.createPr(repoPath, title, body);

        if (taskId) {
            try {
                const updated = await taskStore.updateTask(taskId, (task) => ({
                    worktree: {
                        ...task.worktree,
                        pr: { number: result.number, url: result.url },
                    },
                }));
                broadcast({
                    type: MSG.TASK_UPDATED,
                    payload: filterTaskSessions(updated, config.instanceId),
                });
            } catch {
                // Don't fail the PR creation if task update fails
            }
        }

        return result;
    });

    router.register(MSG.GIT_CHECK_PR, async (payload) => {
        const { path, branch } = payload as GitCheckPrPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const pr = await git.checkBranchPr(repoPath, branch);
        return { pr };
    });
}

import { MSG } from "@taskflow/shared";
import type {
    GitStatusPayload,
    GitDiffPayload,
    GitDiffFilePayload,
    GitRevertFilePayload,
    GitWorktreeCreatePayload,
    GitCommitPayload,
    GitCreatePrPayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { GitService } from "../services/git-service";
import type { TaskStore } from "../services/task-store";
import {
    assertWorkspaceRepo,
    assertRepoFilePath,
    assertWorktreePath,
} from "../utils/path-validation";

interface GitHandlerDeps {
    router: Router;
    git: GitService;
    taskStore: TaskStore;
}

export function registerGitHandlers(deps: GitHandlerDeps): void {
    const { router, git, taskStore } = deps;

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
        return { diff: await git.diffFile(repoPath, filePath) };
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
        return { success: true };
    });

    router.register(MSG.GIT_WORKTREE_CREATE, async (payload) => {
        const { repoPath: rawRepoPath, branch, path } = payload as GitWorktreeCreatePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        const worktreePath = assertWorktreePath(repoPath, path);
        await git.createWorktree(repoPath, branch, worktreePath);
        return { success: true };
    });

    router.register(MSG.GIT_COMMIT, async (payload) => {
        const { path, message, push } = payload as GitCommitPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return await git.commit(repoPath, message, push);
    });

    router.register(MSG.GIT_GENERATE_COMMIT_MSG, async (payload) => {
        const { path } = payload as GitStatusPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const message = await git.generateCommitMessage(repoPath);
        return { message };
    });

    router.register(MSG.GIT_CREATE_PR, async (payload) => {
        const { path, title, body } = payload as GitCreatePrPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return await git.createPr(repoPath, title, body);
    });
}

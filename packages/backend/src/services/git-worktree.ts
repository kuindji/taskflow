import { mkdir } from "fs/promises";
import { dirname } from "path";
import { git } from "./git-helpers";

async function createWorktree(
    repoPath: string,
    branch: string,
    worktreePath: string,
): Promise<void> {
    await mkdir(dirname(worktreePath), { recursive: true });
    await git(["worktree", "add", "-b", branch, worktreePath], repoPath);
}

async function isBranchMerged(repoPath: string, branch: string): Promise<boolean> {
    // If the branch no longer exists, treat as already merged/cleaned up
    const branches = await git(["branch", "--list", branch], repoPath);
    if (!branches.trim()) {
        return true;
    }
    const output = await git(["branch", "--merged"], repoPath);
    return output.split("\n").some((line) => line.replace(/^[*+]?\s+/, "") === branch);
}

async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await git(["worktree", "remove", worktreePath, "--force"], repoPath);
}

async function deleteBranch(repoPath: string, branch: string): Promise<void> {
    await git(["branch", "-D", branch], repoPath);
}

export { createWorktree, isBranchMerged, removeWorktree, deleteBranch };

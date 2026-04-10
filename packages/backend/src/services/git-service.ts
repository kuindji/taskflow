import type {
    GitStatusResult,
    GitFileStatus,
    GitDiffResult,
    GitDiffFile,
    GitFileContentPair,
    GitDiffFileContentResult,
} from "@taskflow/shared";
import { readFile } from "fs/promises";
import { rm } from "fs/promises";
import { dirname, join } from "path";
import { git } from "./git-helpers";
import { getNullDevice } from "./platform";
import type { NumstatEntry } from "./git-helpers";
import {
    createWorktree as createWorktreeImpl,
    isBranchMerged as isBranchMergedImpl,
    removeWorktree as removeWorktreeImpl,
    deleteBranch as deleteBranchImpl,
} from "./git-worktree";
import {
    commit as commitImpl,
    createPr as createPrImpl,
    checkBranchPr as checkBranchPrImpl,
    generateCommitMessage as generateCommitMessageImpl,
} from "./git-pr";

export class GitService {
    async getBranch(repoPath: string): Promise<string | null> {
        try {
            const output = await git(["branch", "--show-current"], repoPath);
            const branch = output.trim();
            return branch || null;
        } catch {
            return null;
        }
    }

    async numstat(repoPath: string, cached = false): Promise<NumstatEntry[]> {
        const args = cached ? ["diff", "--cached", "--numstat"] : ["diff", "--numstat"];
        const output = await git(args, repoPath);
        if (!output.trim()) return [];

        return output
            .trim()
            .split("\n")
            .map((line) => {
                const [add, del, ...pathParts] = line.split("\t");
                return {
                    path: pathParts.join("\t"),
                    additions: add === "-" ? 0 : parseInt(add, 10) || 0,
                    deletions: del === "-" ? 0 : parseInt(del, 10) || 0,
                };
            });
    }

    async status(repoPath: string): Promise<GitStatusResult> {
        const branchOutput = await git(["branch", "--show-current"], repoPath);
        // Use the NUL-delimited porcelain format so paths are machine-safe even when
        // rename targets contain spaces or other escaped characters.
        const statusOutput = await git(["status", "--porcelain=v1", "-z", "-uall"], repoPath);

        const stagedFiles: GitFileStatus[] = [];
        const unstagedFiles: GitFileStatus[] = [];
        const entries = statusOutput.split("\0").filter((entry) => entry.length > 0);

        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const x = entry[0]; // index status
            const y = entry[1]; // worktree status
            const path = entry.substring(3);
            let previousPath: string | undefined;

            if (x === "R" || y === "R") {
                previousPath = entries[index + 1];
                if (!previousPath) {
                    throw new Error(
                        "Malformed git status output: rename entry missing previous path",
                    );
                }
                index += 1;
            }

            const base = { path, absolutePath: join(repoPath, path), previousPath };

            // Untracked files go to unstaged only
            if (x === "?" && y === "?") {
                unstagedFiles.push({ ...base, status: "untracked", staged: false });
                continue;
            }

            // Staged changes (index column)
            if (x !== " " && x !== "?") {
                stagedFiles.push({
                    ...base,
                    status: this.parseStatusChar(x),
                    staged: true,
                });
            }

            // Unstaged changes (worktree column)
            if (y !== " " && y !== "?") {
                unstagedFiles.push({
                    ...base,
                    status: this.parseStatusChar(y),
                    staged: false,
                });
            }
        }

        let ahead = 0;
        let behind = 0;
        try {
            const [aheadOut, behindOut] = await Promise.all([
                git(["rev-list", "--count", "@{u}..HEAD"], repoPath),
                git(["rev-list", "--count", "HEAD..@{u}"], repoPath),
            ]);
            ahead = parseInt(aheadOut.trim(), 10) || 0;
            behind = parseInt(behindOut.trim(), 10) || 0;
        } catch {
            // No upstream configured — treat as 0
        }

        return { branch: branchOutput.trim() || null, stagedFiles, unstagedFiles, ahead, behind };
    }

    private parseStatusChar(char: string): GitFileStatus["status"] {
        switch (char) {
            case "A":
                return "new";
            case "D":
                return "deleted";
            case "R":
                return "renamed";
            case "M":
            case "T":
            default:
                return "modified";
        }
    }

    private countPatchLines(diff: string): Pick<GitDiffFile, "additions" | "deletions"> {
        let additions = 0;
        let deletions = 0;

        for (const line of diff.split("\n")) {
            if (line.startsWith("+++") || line.startsWith("---")) {
                continue;
            }
            if (line.startsWith("+")) {
                additions += 1;
            } else if (line.startsWith("-")) {
                deletions += 1;
            }
        }

        return { additions, deletions };
    }

    private async resolveFileStatus(
        repoPath: string,
        filePath: string,
    ): Promise<{
        staged: Pick<GitFileStatus, "path" | "status" | "previousPath"> | null;
        unstaged: Pick<GitFileStatus, "path" | "status" | "previousPath"> | null;
    }> {
        const status = await this.status(repoPath);
        const staged = status.stagedFiles.find((file) => file.path === filePath) ?? null;
        const unstaged = status.unstagedFiles.find((file) => file.path === filePath) ?? null;
        return { staged, unstaged };
    }

    private async diffSegments(
        repoPath: string,
        file: Pick<GitFileStatus, "path" | "status" | "previousPath">,
        staged: boolean,
    ): Promise<string[]> {
        if (file.status === "untracked") {
            const diff = await git(
                ["diff", "--no-index", "--", getNullDevice(), join(repoPath, file.path)],
                repoPath,
                { allowExitCodes: [1] },
            );
            return diff ? [diff] : [];
        }

        const paths =
            file.status === "renamed" && file.previousPath
                ? [file.previousPath, file.path]
                : [file.path];

        if (staged) {
            const cachedDiff = await git(["diff", "--cached", "--", ...paths], repoPath);
            return cachedDiff.length > 0 ? [cachedDiff] : [];
        }

        const worktreeDiff = await git(["diff", "--", ...paths], repoPath);
        return worktreeDiff.length > 0 ? [worktreeDiff] : [];
    }

    async diff(repoPath: string): Promise<GitDiffResult> {
        const status = await this.status(repoPath);
        const results: GitDiffFile[] = [];

        const processList = async (files: GitFileStatus[], staged: boolean) => {
            const diffs = await Promise.all(
                files.map(async (file) => {
                    const diffResult = await this.diffFile(
                        repoPath,
                        file.path,
                        file.status,
                        file.previousPath,
                        staged,
                    );
                    const diffText = staged ? diffResult.staged : diffResult.unstaged;
                    return {
                        path: file.path,
                        ...this.countPatchLines(diffText ?? ""),
                        diff: diffText ?? "",
                        staged,
                    };
                }),
            );
            results.push(...diffs);
        };

        await Promise.all([
            processList(status.stagedFiles, true),
            processList(status.unstagedFiles, false),
        ]);

        return { files: results };
    }

    async diffFile(
        repoPath: string,
        filePath: string,
        status?: GitFileStatus["status"],
        previousPath?: string,
        isStaged?: boolean,
    ): Promise<{ staged?: string; unstaged?: string }> {
        // If explicit status/staged is provided (from diff()), use that directly
        if (status !== undefined && isStaged !== undefined) {
            const file = { path: filePath, status, previousPath };
            const segments = await this.diffSegments(repoPath, file, isStaged);
            const diffText = segments.join("\n") || undefined;
            return isStaged ? { staged: diffText } : { unstaged: diffText };
        }

        // Otherwise, resolve from status and return both staged and unstaged
        const resolved = await this.resolveFileStatus(repoPath, filePath);
        const result: { staged?: string; unstaged?: string } = {};

        if (resolved.staged) {
            const segments = await this.diffSegments(repoPath, resolved.staged, true);
            const diffText = segments.join("\n");
            if (diffText) result.staged = diffText;
        }

        if (resolved.unstaged) {
            const segments = await this.diffSegments(repoPath, resolved.unstaged, false);
            const diffText = segments.join("\n");
            if (diffText) result.unstaged = diffText;
        }

        // Fallback if nothing found
        if (!result.staged && !result.unstaged) {
            const fallback = await git(["diff", "--", filePath], repoPath);
            if (fallback) result.unstaged = fallback;
        }

        return result;
    }

    async getFileContent(
        repoPath: string,
        filePath: string,
        ref: "HEAD" | "index" | "working",
    ): Promise<string | null> {
        if (ref === "working") {
            try {
                return await readFile(join(repoPath, filePath), "utf-8");
            } catch {
                return null;
            }
        }

        const refSpec = ref === "HEAD" ? `HEAD:${filePath}` : `:${filePath}`;
        try {
            return await git(["show", refSpec], repoPath, { allowExitCodes: [128] });
        } catch {
            return null;
        }
    }

    async getFileContentsForDiff(
        repoPath: string,
        filePath: string,
    ): Promise<GitDiffFileContentResult> {
        const resolved = await this.resolveFileStatus(repoPath, filePath);
        let staged: GitFileContentPair | null = null;
        let unstaged: GitFileContentPair | null = null;

        if (resolved.staged) {
            const origPath =
                resolved.staged.status === "renamed" && resolved.staged.previousPath
                    ? resolved.staged.previousPath
                    : filePath;
            const original =
                resolved.staged.status === "new"
                    ? ""
                    : ((await this.getFileContent(repoPath, origPath, "HEAD")) ?? "");
            const modified =
                resolved.staged.status === "deleted"
                    ? ""
                    : ((await this.getFileContent(repoPath, filePath, "index")) ?? "");
            staged = { original, modified };
        }

        if (resolved.unstaged) {
            if (resolved.unstaged.status === "untracked") {
                const modified = (await this.getFileContent(repoPath, filePath, "working")) ?? "";
                unstaged = { original: "", modified };
            } else {
                const origPath =
                    resolved.unstaged.status === "renamed" && resolved.unstaged.previousPath
                        ? resolved.unstaged.previousPath
                        : filePath;
                // If there are staged changes, the base for unstaged is the index version
                const baseRef = resolved.staged ? "index" : "HEAD";
                const original = (await this.getFileContent(repoPath, origPath, baseRef)) ?? "";
                const modified =
                    resolved.unstaged.status === "deleted"
                        ? ""
                        : ((await this.getFileContent(repoPath, filePath, "working")) ?? "");
                unstaged = { original, modified };
            }
        }

        return { staged, unstaged };
    }

    async revertFile(
        repoPath: string,
        file: Pick<GitFileStatus, "path" | "status" | "previousPath">,
    ): Promise<void> {
        if (file.status === "untracked") {
            await rm(join(repoPath, file.path), { recursive: true, force: true });
            return;
        }
        if (file.status === "new") {
            await git(["rm", "-f", "--", file.path], repoPath);
            return;
        }

        const paths =
            file.status === "renamed" && file.previousPath
                ? [file.previousPath, file.path]
                : [file.path];

        await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths], repoPath);
    }

    async stage(repoPath: string, filePath?: string): Promise<void> {
        if (filePath) {
            await git(["add", "--", filePath], repoPath);
        } else {
            await git(["add", "-A"], repoPath);
        }
    }

    async unstage(repoPath: string, filePath?: string): Promise<void> {
        if (filePath) {
            await git(["restore", "--staged", "--", filePath], repoPath);
        } else {
            await git(["restore", "--staged", "."], repoPath);
        }
    }

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        return createWorktreeImpl(repoPath, branch, worktreePath);
    }

    async isBranchMerged(repoPath: string, branch: string): Promise<boolean> {
        return isBranchMergedImpl(repoPath, branch);
    }

    async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
        return removeWorktreeImpl(repoPath, worktreePath);
    }

    async deleteBranch(repoPath: string, branch: string): Promise<void> {
        return deleteBranchImpl(repoPath, branch);
    }

    async fetch(repoPath: string): Promise<void> {
        try {
            await git(["fetch"], repoPath);
        } catch {
            // Network failure or no remote — silently skip
        }
    }

    async pull(repoPath: string): Promise<void> {
        await git(["pull"], repoPath);
    }

    async push(repoPath: string): Promise<void> {
        await git(["push"], repoPath);
    }

    async commit(
        repoPath: string,
        message: string,
        push: boolean,
        includeUnstaged = true,
    ): Promise<{ hash: string; message: string }> {
        return commitImpl(repoPath, message, push, includeUnstaged);
    }

    async createPr(
        repoPath: string,
        title: string,
        body?: string,
    ): Promise<{ url: string; number: number }> {
        return createPrImpl(repoPath, title, body);
    }

    async checkBranchPr(
        repoPath: string,
        branch: string,
    ): Promise<{ url: string; number: number } | null> {
        return checkBranchPrImpl(repoPath, branch);
    }

    async generateCommitMessage(repoPath: string, includeUnstaged = true): Promise<string> {
        return generateCommitMessageImpl(this, repoPath, includeUnstaged);
    }

    async getRemoteUrl(repoPath: string): Promise<string | null> {
        try {
            const output = await git(["remote", "get-url", "origin"], repoPath);
            return output.trim() || null;
        } catch {
            return null;
        }
    }

    async clone(source: string, target: string, branch: string): Promise<void> {
        await git(["clone", "--local", "--branch", branch, source, target], dirname(target));
    }

    async setRemoteUrl(repoPath: string, url: string): Promise<void> {
        await git(["remote", "set-url", "origin", url], repoPath);
    }

    async createBranch(repoPath: string, branch: string): Promise<void> {
        await git(["checkout", "-b", branch], repoPath);
    }
}

import type { GitStatusResult, GitFileStatus, GitDiffResult, GitDiffFile } from "@taskflow/shared";
import { mkdir, rm } from "fs/promises";
import { dirname, join } from "path";

async function git(
    args: string[],
    cwd: string,
    options: { allowExitCodes?: number[] } = {},
): Promise<string> {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0 && !options.allowExitCodes?.includes(exitCode)) {
        throw new Error(
            stderr.trim() ||
                stdout.trim() ||
                `git ${args.join(" ")} failed with exit code ${exitCode}`,
        );
    }
    return stdout;
}

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

    async status(repoPath: string): Promise<GitStatusResult> {
        const branchOutput = await git(["branch", "--show-current"], repoPath);
        // Use the NUL-delimited porcelain format so paths are machine-safe even when
        // rename targets contain spaces or other escaped characters.
        const statusOutput = await git(["status", "--porcelain=v1", "-z"], repoPath);

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
        try {
            const revList = await git(["rev-list", "--count", "@{u}..HEAD"], repoPath);
            ahead = parseInt(revList.trim(), 10) || 0;
        } catch {
            // No upstream configured — treat as 0
        }

        return { branch: branchOutput.trim() || null, stagedFiles, unstagedFiles, ahead };
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
                ["diff", "--no-index", "--", "/dev/null", join(repoPath, file.path)],
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
        await mkdir(dirname(worktreePath), { recursive: true });
        await git(["worktree", "add", "-b", branch, worktreePath], repoPath);
    }

    async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
        await git(["worktree", "remove", worktreePath, "--force"], repoPath);
    }

    async deleteBranch(repoPath: string, branch: string): Promise<void> {
        await git(["branch", "-D", branch], repoPath);
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
        if (includeUnstaged) {
            await git(["add", "-A"], repoPath);
        }
        await git(["commit", "-m", message], repoPath);
        const hashOutput = await git(["rev-parse", "--short", "HEAD"], repoPath);
        if (push) {
            await git(["push"], repoPath);
        }
        return { hash: hashOutput.trim(), message };
    }

    async createPr(repoPath: string, title: string, body?: string): Promise<{ url: string }> {
        const args = ["pr", "create", "--title", title];
        if (body) {
            args.push("--body", body);
        } else {
            args.push("--body", "");
        }
        const proc = Bun.spawn(["gh", ...args], { cwd: repoPath, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (exitCode !== 0) {
            throw new Error(
                stderr.trim() || stdout.trim() || `gh pr create failed with exit code ${exitCode}`,
            );
        }
        return { url: stdout.trim() };
    }

    async generateCommitMessage(repoPath: string, includeUnstaged = true): Promise<string> {
        const diffResult = await this.diff(repoPath);
        const files = includeUnstaged
            ? diffResult.files
            : diffResult.files.filter((f) => f.staged);
        const diffText = files.map((f) => f.diff).join("\n");
        if (!diffText.trim()) {
            throw new Error("No changes to commit");
        }

        const prompt = [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            diffText,
        ].join("\n");

        const env: Record<string, string | undefined> = { ...process.env };
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_ENTRYPOINT;

        const proc = Bun.spawn(["claude", "-p", prompt], {
            cwd: repoPath,
            stdout: "pipe",
            stderr: "pipe",
            env,
        });
        const [stdout, , exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (exitCode !== 0 || !stdout.trim()) {
            throw new Error("Failed to generate commit message");
        }
        return stdout.trim();
    }
}

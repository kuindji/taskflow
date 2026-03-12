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

        const files: GitFileStatus[] = [];
        const entries = statusOutput.split("\0").filter((entry) => entry.length > 0);

        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const xy = entry.substring(0, 2);
            const path = entry.substring(3);
            let previousPath: string | undefined;

            if (xy.includes("R")) {
                previousPath = entries[index + 1];
                if (!previousPath) {
                    throw new Error(
                        "Malformed git status output: rename entry missing previous path",
                    );
                }
                index += 1;
            }

            files.push({
                path,
                absolutePath: join(repoPath, path),
                previousPath,
                status: this.parseStatus(xy),
            });
        }

        let ahead = 0;
        try {
            const revList = await git(["rev-list", "--count", "@{u}..HEAD"], repoPath);
            ahead = parseInt(revList.trim(), 10) || 0;
        } catch {
            // No upstream configured — treat as 0
        }

        return { branch: branchOutput.trim() || null, files, ahead };
    }

    private parseStatus(xy: string): GitFileStatus["status"] {
        if (xy === "??") return "untracked";
        if (xy.includes("A")) return "new";
        if (xy.includes("D")) return "deleted";
        if (xy.includes("R")) return "renamed";
        return "modified";
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
    ): Promise<Pick<GitFileStatus, "path" | "status" | "previousPath"> | null> {
        const status = await this.status(repoPath);
        return status.files.find((file) => file.path === filePath) ?? null;
    }

    private async diffSegments(
        repoPath: string,
        file: Pick<GitFileStatus, "path" | "status" | "previousPath">,
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

        const [cachedDiff, worktreeDiff] = await Promise.all([
            git(["diff", "--cached", "--", ...paths], repoPath),
            git(["diff", "--", ...paths], repoPath),
        ]);

        return [cachedDiff, worktreeDiff].filter((diff) => diff.length > 0);
    }

    async diff(repoPath: string): Promise<GitDiffResult> {
        const status = await this.status(repoPath);
        const files = await Promise.all(
            status.files.map(async (file) => {
                const diff = await this.diffFile(
                    repoPath,
                    file.path,
                    file.status,
                    file.previousPath,
                );
                return {
                    path: file.path,
                    ...this.countPatchLines(diff),
                    diff,
                };
            }),
        );

        return { files };
    }

    async diffFile(
        repoPath: string,
        filePath: string,
        status?: GitFileStatus["status"],
        previousPath?: string,
    ): Promise<string> {
        const file = status
            ? { path: filePath, status, previousPath }
            : await this.resolveFileStatus(repoPath, filePath);

        if (!file) {
            return git(["diff", "--", filePath], repoPath);
        }

        return (await this.diffSegments(repoPath, file)).join("\n");
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

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        await mkdir(dirname(worktreePath), { recursive: true });
        await git(["worktree", "add", "-b", branch, worktreePath], repoPath);
    }

    async push(repoPath: string): Promise<void> {
        await git(["push"], repoPath);
    }

    async commit(repoPath: string, message: string, push: boolean): Promise<{ hash: string; message: string }> {
        await git(["add", "-A"], repoPath);
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
            throw new Error(stderr.trim() || stdout.trim() || `gh pr create failed with exit code ${exitCode}`);
        }
        return { url: stdout.trim() };
    }

    async generateCommitMessage(repoPath: string): Promise<string> {
        const diffResult = await this.diff(repoPath);
        const diffText = diffResult.files.map((f) => f.diff).join("\n");
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

        const proc = Bun.spawn(
            ["claude", "-p", prompt],
            { cwd: repoPath, stdout: "pipe", stderr: "pipe", env },
        );
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

import type {
    GitCreatePrResult,
    GitCheckPrResult,
    GitStatusResult,
    GitDiffFileResult,
    FileReadResponse,
    GitFileStatus,
    GitDiffResult,
    GitDiffFile,
    GitFileContentPair,
    GitDiffFileContentResult,
    GitLogResult,
    GitCommitFilesResult,
} from "@taskflow/shared";
import { rm } from "fs/promises";
import { dirname, join } from "path";
import { git, gitCapture } from "./git-helpers";
import { readFilePreview, readGitPreview, readGitPatch, previewPair } from "./file-preview";
import { getNullDevice } from "./platform";
import type { NumstatEntry } from "./git-helpers";
import {
    createWorktree as createWorktreeImpl,
    isBranchMerged as isBranchMergedImpl,
    removeWorktree as removeWorktreeImpl,
    deleteBranch as deleteBranchImpl,
} from "./git-worktree";
import {
    type GitPrDeps,
    commit as commitImpl,
    createPr as createPrImpl,
    checkBranchPr as checkBranchPrImpl,
    generateCommitMessage as generateCommitMessageImpl,
} from "./git-pr";
import {
    log as logImpl,
    commitFiles as commitFilesImpl,
    commitDiffFile as commitDiffFileImpl,
} from "./git-history";

type FileStatusEntry = Pick<GitFileStatus, "path" | "status" | "previousPath">;

interface FileStatusPair {
    staged: FileStatusEntry | null;
    unstaged: FileStatusEntry | null;
}

export class GitService {
    constructor(private readonly deps?: { pr?: GitPrDeps }) {}

    async getBranch(repoPath: string): Promise<string | null> {
        try {
            const output = await git(["branch", "--show-current"], repoPath, { readOnly: true });
            const branch = output.trim();
            return branch || null;
        } catch {
            return null;
        }
    }

    async numstat(repoPath: string, cached = false): Promise<NumstatEntry[]> {
        const args = [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            ...(cached ? ["--cached"] : []),
            "--numstat",
        ];
        const output = await git(args, repoPath, { readOnly: true });
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
        // Porcelain v2 with --branch returns branch name, ahead/behind counts, and file
        // statuses in a single git invocation. NUL delimiters keep paths machine-safe
        // even when rename targets contain spaces or other escaped characters.
        const output = await git(
            ["status", "--porcelain=v2", "--branch", "-z", "-uall"],
            repoPath,
            { readOnly: true },
        );

        const stagedFiles: GitFileStatus[] = [];
        const unstagedFiles: GitFileStatus[] = [];
        let branch: string | null = null;
        let ahead = 0;
        let behind = 0;

        const records = output.split("\0").filter((record) => record.length > 0);

        for (let index = 0; index < records.length; index += 1) {
            const record = records[index];
            const type = record[0];

            if (type === "#") {
                if (record.startsWith("# branch.head ")) {
                    const head = record.substring("# branch.head ".length);
                    branch = head === "(detached)" ? null : head;
                } else if (record.startsWith("# branch.ab ")) {
                    const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
                    if (match) {
                        ahead = parseInt(match[1], 10) || 0;
                        behind = parseInt(match[2], 10) || 0;
                    }
                }
                continue;
            }

            if (type === "?") {
                const path = record.substring(2);
                unstagedFiles.push({
                    path,
                    absolutePath: join(repoPath, path),
                    status: "untracked",
                    staged: false,
                });
                continue;
            }

            if (type !== "1" && type !== "2" && type !== "u") continue;

            // Changed entries: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>",
            // renamed/copied add "<Xscore>" before the path, unmerged entries have
            // three stage modes/hashes instead of two.
            const fieldCount = type === "1" ? 8 : type === "2" ? 9 : 10;
            const fields = this.splitStatusRecord(record, fieldCount);
            if (!fields) continue;
            const xy = fields[1];
            const x = xy[0]; // index status
            const y = xy[1]; // worktree status
            const path = fields[fieldCount];
            let previousPath: string | undefined;

            if (type === "2") {
                // With -z the original path follows as its own NUL-terminated record
                previousPath = records[index + 1];
                if (!previousPath) {
                    throw new Error(
                        "Malformed git status output: rename entry missing previous path",
                    );
                }
                index += 1;
            }

            const base = { path, absolutePath: join(repoPath, path), previousPath };

            // Staged changes (index column); "." means unchanged in porcelain v2
            if (x !== ".") {
                stagedFiles.push({ ...base, status: this.parseStatusChar(x), staged: true });
            }

            // Unstaged changes (worktree column)
            if (y !== ".") {
                unstagedFiles.push({ ...base, status: this.parseStatusChar(y), staged: false });
            }
        }

        return { branch, stagedFiles, unstagedFiles, ahead, behind };
    }

    /** Split a porcelain v2 record into `count` space-separated fields plus the trailing path */
    private splitStatusRecord(record: string, count: number): string[] | null {
        const fields: string[] = [];
        let rest = record;
        for (let i = 0; i < count; i += 1) {
            const separator = rest.indexOf(" ");
            if (separator === -1) return null;
            fields.push(rest.substring(0, separator));
            rest = rest.substring(separator + 1);
        }
        fields.push(rest);
        return fields;
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

    private async resolveFileStatus(repoPath: string, filePath: string): Promise<FileStatusPair> {
        const status = await this.status(repoPath);
        const staged = status.stagedFiles.find((file) => file.path === filePath) ?? null;
        const unstaged = status.unstagedFiles.find((file) => file.path === filePath) ?? null;
        return { staged, unstaged };
    }

    private async diffSegments(
        repoPath: string,
        file: FileStatusEntry,
        staged: boolean,
        maxOutputBytes = 1024 * 1024,
    ): Promise<string | { state: "tooLarge" }> {
        if (file.status === "untracked") {
            const diff = await readGitPatch(
                repoPath,
                [
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-index",
                    "--",
                    getNullDevice(),
                    join(repoPath, file.path),
                ],
                { allowExitCodes: [1], maxOutputBytes },
            );
            return diff;
        }

        const paths =
            file.status === "renamed" && file.previousPath
                ? [file.previousPath, file.path]
                : [file.path];

        if (staged) {
            return readGitPatch(
                repoPath,
                ["diff", "--no-ext-diff", "--no-textconv", "--cached", "--", ...paths],
                { literalPathspecs: true, maxOutputBytes },
            );
        }

        return readGitPatch(repoPath, ["diff", "--no-ext-diff", "--no-textconv", "--", ...paths], {
            literalPathspecs: true,
            maxOutputBytes,
        });
    }

    async diff(repoPath: string): Promise<GitDiffResult> {
        const status = await this.status(repoPath);
        const files = [...status.stagedFiles, ...status.unstagedFiles];
        // One status for the whole list, and one combined patch per path even
        // when the path is both staged and unstaged.
        const resolved = new Map<string, FileStatusPair>();
        for (const file of files) {
            const pair = resolved.get(file.path) ?? { staged: null, unstaged: null };
            pair[file.staged ? "staged" : "unstaged"] = file;
            resolved.set(file.path, pair);
        }
        const patches = new Map<string, Promise<GitDiffFileResult>>();
        const results: GitDiffFile[] = new Array<GitDiffFile>(files.length);
        let next = 0;
        const worker = async () => {
            while (next < files.length) {
                const index = next++;
                const file = files[index];
                let patch = patches.get(file.path);
                if (!patch) {
                    patch = this.diffFile(repoPath, file.path, resolved.get(file.path));
                    patches.set(file.path, patch);
                }
                const result = await patch;
                const diff = (file.staged ? result.staged : result.unstaged) ?? "";
                results[index] = {
                    path: file.path,
                    ...this.countPatchLines(diff),
                    diff,
                    staged: file.staged,
                    ...(result.state ? { state: result.state } : {}),
                };
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
        return { files: results };
    }

    async diffFile(
        repoPath: string,
        filePath: string,
        known?: FileStatusPair,
    ): Promise<GitDiffFileResult> {
        const resolved = known ?? (await this.resolveFileStatus(repoPath, filePath));
        const result: { staged?: string; unstaged?: string } = {};
        let remaining = 1024 * 1024;
        for (const side of ["staged", "unstaged"] as const) {
            const file = resolved[side];
            if (!file) continue;
            const patch = await this.diffSegments(repoPath, file, side === "staged", remaining);
            if (typeof patch !== "string") return patch;
            remaining -= Buffer.byteLength(patch);
            if (patch) result[side] = patch;
        }
        if (!resolved.staged && !resolved.unstaged) {
            const patch = await readGitPatch(
                repoPath,
                ["diff", "--no-ext-diff", "--no-textconv", "--", filePath],
                { literalPathspecs: true },
            );
            if (typeof patch !== "string") return patch;
            if (patch) result.unstaged = patch;
        }
        return result;
    }

    async getFileContent(
        repoPath: string,
        filePath: string,
        ref: "HEAD" | "index" | "working",
    ): Promise<FileReadResponse | null> {
        if (ref === "working") {
            try {
                return await readFilePreview(join(repoPath, filePath));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
                throw error;
            }
        }
        return readGitPreview(repoPath, ref === "HEAD" ? `HEAD:${filePath}` : `:${filePath}`);
    }

    async getFileContentsForDiff(
        repoPath: string,
        filePath: string,
    ): Promise<GitDiffFileContentResult> {
        const resolved = await this.resolveFileStatus(repoPath, filePath);
        const patch = await this.diffFile(repoPath, filePath, resolved);
        if (patch.state)
            return {
                staged: resolved.staged ? { state: "tooLarge", limit: "diff" } : null,
                unstaged: resolved.unstaged ? { state: "tooLarge", limit: "diff" } : null,
            };
        const pair = async (
            file: FileStatusEntry,
            staged: boolean,
        ): Promise<GitFileContentPair> => {
            const origPath =
                file.status === "renamed" && file.previousPath ? file.previousPath : filePath;
            const original =
                file.status === "new" || file.status === "untracked"
                    ? null
                    : await this.getFileContent(
                          repoPath,
                          origPath,
                          staged || !resolved.staged ? "HEAD" : "index",
                      );
            const modified =
                file.status === "deleted"
                    ? null
                    : await this.getFileContent(repoPath, filePath, staged ? "index" : "working");
            return previewPair(original, modified);
        };
        return {
            staged: resolved.staged ? await pair(resolved.staged, true) : null,
            unstaged: resolved.unstaged ? await pair(resolved.unstaged, false) : null,
        };
    }

    async log(repoPath: string, limit: number, skip: number): Promise<GitLogResult> {
        return logImpl(repoPath, limit, skip);
    }

    async commitFiles(repoPath: string, hash: string): Promise<GitCommitFilesResult> {
        return commitFilesImpl(repoPath, hash);
    }

    async commitDiffFile(
        repoPath: string,
        hash: string,
        path: string,
        previousPath?: string,
    ): Promise<GitFileContentPair> {
        return commitDiffFileImpl(repoPath, hash, path, previousPath);
    }

    async revertFile(repoPath: string, file: FileStatusEntry): Promise<void> {
        if (file.status === "untracked") {
            await rm(join(repoPath, file.path), { recursive: true, force: true });
            return;
        }
        if (file.status === "new") {
            await git(["rm", "-f", "--", file.path], repoPath, { literalPathspecs: true });
            return;
        }

        const paths =
            file.status === "renamed" && file.previousPath
                ? [file.previousPath, file.path]
                : [file.path];

        await git(
            ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths],
            repoPath,
            { literalPathspecs: true },
        );
    }

    async stage(repoPath: string, filePath?: string): Promise<void> {
        if (filePath) {
            await git(["add", "--", filePath], repoPath, { literalPathspecs: true });
        } else {
            await git(["add", "-A"], repoPath);
        }
    }

    async unstage(repoPath: string, filePath?: string): Promise<void> {
        if (filePath) {
            // A staged rename shows under its new path; restoring only that path
            // would leave the old path's deletion staged.
            const { stagedFiles } = await this.status(repoPath);
            const previousPath = stagedFiles.find(
                (file) => file.path === filePath && file.status === "renamed",
            )?.previousPath;
            const paths = previousPath ? [previousPath, filePath] : [filePath];
            await git(["restore", "--staged", "--", ...paths], repoPath, {
                literalPathspecs: true,
            });
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

    /** Fetch from the default remote. Returns true when any refs were updated. */
    async fetch(repoPath: string): Promise<boolean> {
        try {
            // git fetch reports ref updates on stderr and prints nothing when
            // everything is up to date, so non-empty stderr means refs changed
            const { stderr } = await gitCapture(["fetch"], repoPath);
            return stderr.trim().length > 0;
        } catch {
            // Network failure or no remote — silently skip
            return false;
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

    async createPr(repoPath: string, title: string, body?: string): Promise<GitCreatePrResult> {
        return createPrImpl(repoPath, title, body, this.deps?.pr);
    }

    async checkBranchPr(repoPath: string, branch: string): Promise<GitCheckPrResult> {
        return checkBranchPrImpl(repoPath, branch, this.deps?.pr);
    }

    async generateCommitMessage(
        repoPath: string,
        includeUnstaged: boolean,
        generate: (diff: string) => Promise<string>,
    ): Promise<string> {
        return generateCommitMessageImpl(this, repoPath, includeUnstaged, generate);
    }

    async getRemoteUrl(repoPath: string): Promise<string | null> {
        try {
            const output = await git(["remote", "get-url", "origin"], repoPath, { readOnly: true });
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

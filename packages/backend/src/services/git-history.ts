import type {
    GitCommitFile,
    GitCommitFilesResult,
    GitFileContentPair,
    GitLogEntry,
    GitLogResult,
} from "@taskflow/shared";
import { git } from "./git-helpers";

// %H hash, %h short hash, %an author, %aI ISO date, %D decorations, %s subject.
// NUL-separated fields (subjects cannot contain NUL); git joins records with
// "\n", so every record after the first starts with a stray newline that gets
// trimmed off the hash field below.
const LOG_FORMAT = "%H%x00%h%x00%an%x00%aI%x00%D%x00%s%x00";
const LOG_FIELD_COUNT = 6;

function parseRefs(decorations: string): string[] {
    return decorations
        .split(", ")
        .map((ref) => ref.replace(/^HEAD -> /, "").replace(/^tag: /, "").trim())
        .filter((ref) => ref.length > 0 && ref !== "HEAD");
}

async function log(repoPath: string, limit: number, skip: number): Promise<GitLogResult> {
    let output: string;
    try {
        output = await git(
            [
                "log",
                "HEAD",
                `--max-count=${limit + 1}`,
                `--skip=${skip}`,
                `--pretty=format:${LOG_FORMAT}`,
            ],
            repoPath,
        );
    } catch (error) {
        // An unborn HEAD (repo with no commits yet) is normal empty history:
        // the path is a git repo but HEAD doesn't resolve. Anything else —
        // not a git repo, corrupt object store — must surface.
        try {
            await git(["rev-parse", "--git-dir"], repoPath);
        } catch {
            throw error; // not a git repository
        }
        let headResolves = true;
        try {
            await git(["rev-parse", "--verify", "HEAD"], repoPath);
        } catch {
            headResolves = false;
        }
        if (headResolves) {
            throw error; // repo with a valid HEAD — the log failure is real
        }
        return { entries: [], hasMore: false };
    }

    const fields = output.split("\0");
    const entries: GitLogEntry[] = [];
    for (let i = 0; i + LOG_FIELD_COUNT <= fields.length; i += LOG_FIELD_COUNT) {
        entries.push({
            hash: fields[i].trim(),
            shortHash: fields[i + 1],
            authorName: fields[i + 2],
            date: fields[i + 3],
            refs: parseRefs(fields[i + 4]),
            subject: fields[i + 5],
        });
    }

    const hasMore = entries.length > limit;
    return { entries: hasMore ? entries.slice(0, limit) : entries, hasMore };
}

const COMMIT_DIFF_ARGS = ["--format=", "--diff-merges=first-parent", "-z"];

function parseCommitStatus(char: string): GitCommitFile["status"] {
    switch (char) {
        case "A":
            return "new";
        case "D":
            return "deleted";
        case "R":
            return "renamed";
        default:
            return "modified";
    }
}

async function commitFiles(repoPath: string, hash: string): Promise<GitCommitFilesResult> {
    // Two invocations: --name-status for status letters + rename pairs,
    // --numstat for per-file line counts. Both NUL-delimited, merged by path.
    const [nameStatusOut, numstatOut] = await Promise.all([
        git(["show", ...COMMIT_DIFF_ARGS, "--name-status", hash], repoPath),
        git(["show", ...COMMIT_DIFF_ARGS, "--numstat", hash], repoPath),
    ]);

    const files: GitCommitFile[] = [];
    const nameStatusRecords = nameStatusOut.split("\0").filter((r) => r.length > 0);
    for (let i = 0; i < nameStatusRecords.length; i += 1) {
        // Record: "A" | "M" | "D" | "R100" ... followed by path record(s)
        const statusChar = nameStatusRecords[i].trim()[0];
        const status = parseCommitStatus(statusChar);
        if (status === "renamed") {
            const previousPath = nameStatusRecords[i + 1];
            const path = nameStatusRecords[i + 2];
            i += 2;
            if (path === undefined) break;
            files.push({ path, previousPath, status, additions: 0, deletions: 0 });
        } else {
            const path = nameStatusRecords[i + 1];
            i += 1;
            if (path === undefined) break;
            files.push({ path, status, additions: 0, deletions: 0 });
        }
    }

    // With -z, numstat renames are "add\tdel\t" then NUL, old path, NUL, new path
    const statsByPath = new Map<string, { additions: number; deletions: number }>();
    const numstatRecords = numstatOut.split("\0").filter((r) => r.length > 0);
    for (let i = 0; i < numstatRecords.length; i += 1) {
        const record = numstatRecords[i];
        // Split on the first two tabs only — with -z the path is unquoted and
        // may itself contain tabs
        const tab1 = record.indexOf("\t");
        const tab2 = record.indexOf("\t", tab1 + 1);
        if (tab1 === -1 || tab2 === -1) continue;
        const add = record.slice(0, tab1);
        const del = record.slice(tab1 + 1, tab2);
        const inlinePath = record.slice(tab2 + 1);
        const stats = {
            additions: add === "-" ? -1 : parseInt(add, 10) || 0,
            deletions: del === "-" ? -1 : parseInt(del, 10) || 0,
        };
        if (inlinePath) {
            statsByPath.set(inlinePath, stats);
        } else {
            // Rename: skip old path record, stats belong to the new path
            const path = numstatRecords[i + 2];
            i += 2;
            if (path === undefined) break;
            statsByPath.set(path, stats);
        }
    }

    for (const file of files) {
        const stats = statsByPath.get(file.path);
        if (stats) {
            file.additions = stats.additions;
            file.deletions = stats.deletions;
        }
    }

    return { files };
}

async function showBlob(repoPath: string, refSpec: string): Promise<string> {
    try {
        return await git(["show", refSpec], repoPath);
    } catch {
        // Path absent at that ref (added/deleted file, or root commit parent)
        return "";
    }
}

async function commitDiffFile(
    repoPath: string,
    hash: string,
    path: string,
    previousPath?: string,
): Promise<GitFileContentPair> {
    // A blob missing at a ref is expected (added/deleted file, root commit
    // parent) and maps to an empty side — but a missing COMMIT (history
    // rewritten) must surface as an error, so verify the commit first.
    await git(["rev-parse", "--verify", `${hash}^{commit}`], repoPath);
    const [original, modified] = await Promise.all([
        showBlob(repoPath, `${hash}^:${previousPath ?? path}`),
        showBlob(repoPath, `${hash}:${path}`),
    ]);
    return { original, modified };
}

export { log, commitFiles, commitDiffFile };

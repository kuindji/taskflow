import type { GitLogEntry, GitLogResult } from "@taskflow/shared";
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

export { log };

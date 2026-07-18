# Git History View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only git history view (commit list → changed files → per-file diff) opened from a "History" button in the workspace header, next to the existing Diff button.

**Architecture:** Follows the existing Changes-tab pattern end to end: header button → tab in `session-store` → pane component → WebSocket request → backend git handler → `GitService` → raw `git` subprocess. New backend git logic lives in a dedicated `git-history.ts` module (same delegation pattern as `git-worktree.ts` / `git-pr.ts`), with `GitService` delegating.

**Tech Stack:** Bun (backend + tests via `bun test`), TypeScript, React + Zustand + Tailwind (UI), Monaco diff editor (existing `MonacoDiffViewer`), WebSocket request/response (`sendRequest`).

**Spec:** `docs/superpowers/specs/2026-07-18-git-history-view-design.md`

## Global Constraints

- Use `bun` for everything (`bun test`, `bun run typecheck`) — never npm/yarn.
- No `as any`. No disabling eslint rules. No co-authored-by lines in commits.
- Don't export symbols that aren't consumed outside their module.
- All git subprocess calls go through `git`/`gitCapture` from `packages/backend/src/services/git-helpers.ts`.
- Read-only feature: no mutating git commands anywhere in this plan.
- Merge commits: show the diff against the first parent (`--diff-merges=first-parent`).
- Repo root for all commands below: `/Users/kuindji/Projects/taskflow`.

---

### Task 1: Shared message channels and types

**Files:**
- Modify: `packages/shared/src/constants.ts` (git section, after `GIT_CHECK_PR` at ~line 91)
- Modify: `packages/shared/src/types/git.ts`
- Modify: `packages/shared/src/types/ws.ts` (git payloads section, ~line 368+)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2–5 backend and Task 7 UI):
  - `MSG.GIT_LOG = "git:log"`, `MSG.GIT_COMMIT_FILES = "git:commit-files"`, `MSG.GIT_COMMIT_DIFF_FILE = "git:commit-diff-file"`
  - Types `GitLogEntry`, `GitLogResult`, `GitCommitFile`, `GitCommitFilesResult` (from `@taskflow/shared`)
  - Payloads `GitLogPayload`, `GitCommitFilesPayload`, `GitCommitDiffFilePayload` (from `@taskflow/shared`)

- [ ] **Step 1: Add message constants**

In `packages/shared/src/constants.ts`, after the `GIT_CHECK_PR: "git:check-pr",` line add:

```ts
    GIT_LOG: "git:log",
    GIT_COMMIT_FILES: "git:commit-files",
    GIT_COMMIT_DIFF_FILE: "git:commit-diff-file",
```

- [ ] **Step 2: Add result types**

Append to `packages/shared/src/types/git.ts`:

```ts
export interface GitLogEntry {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    /** ISO 8601 author date */
    date: string;
    /** Ref decorations (branch/tag names); empty when none */
    refs: string[];
}

export interface GitLogResult {
    entries: GitLogEntry[];
    hasMore: boolean;
}

export interface GitCommitFile {
    path: string;
    previousPath?: string;
    status: "new" | "modified" | "deleted" | "renamed";
    /** -1 when the file is binary */
    additions: number;
    /** -1 when the file is binary */
    deletions: number;
}

export interface GitCommitFilesResult {
    files: GitCommitFile[];
}
```

- [ ] **Step 3: Add payload types**

In `packages/shared/src/types/ws.ts`, after `GitDiffFileContentPayload` (~line 390) add:

```ts
export interface GitLogPayload {
    repoPath: string;
    limit?: number;
    skip?: number;
}

export interface GitCommitFilesPayload {
    repoPath: string;
    hash: string;
}

export interface GitCommitDiffFilePayload {
    repoPath: string;
    hash: string;
    path: string;
    previousPath?: string;
}
```

(`packages/shared/src/index.ts` already does `export * from "./types/git"` and `export * from "./types/ws"` — no change needed there.)

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: exits 0 for all packages.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/git.ts packages/shared/src/types/ws.ts
git commit -m "feat(shared): add git history message channels and types"
```

---

### Task 2: Backend `log` — commit list with paging

**Files:**
- Create: `packages/backend/src/services/git-history.ts`
- Modify: `packages/backend/src/services/git-service.ts`
- Test: `packages/backend/tests/services/git-history.test.ts`

**Interfaces:**
- Consumes: `git` from `./git-helpers`; `GitLogEntry`, `GitLogResult` from `@taskflow/shared` (Task 1).
- Produces: `log(repoPath: string, limit: number, skip: number): Promise<GitLogResult>` exported from `git-history.ts`; `GitService.log(repoPath, limit, skip)` delegating to it. Task 5 calls `git.log(...)` on the service.

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/services/git-history.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GitService } from "../../src/services/git-service";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

async function run(args: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
}

async function commitFile(
    repoDir: string,
    name: string,
    content: string,
    message: string,
): Promise<void> {
    await writeFile(join(repoDir, name), content);
    await run(["git", "add", "."], repoDir);
    await run(["git", "commit", "-m", message], repoDir);
}

describe("git history", () => {
    let git: GitService;
    let repoDir: string;

    beforeEach(async () => {
        repoDir = await mkdtemp(join(tmpdir(), "taskflow-git-history-test-"));
        await run(["git", "init"], repoDir);
        await run(["git", "config", "user.email", "test@test.com"], repoDir);
        await run(["git", "config", "user.name", "Test Author"], repoDir);
        git = new GitService();
    });

    afterEach(async () => {
        await rm(repoDir, { recursive: true, force: true });
    });

    describe("log", () => {
        it("returns commits newest first with metadata", async () => {
            await commitFile(repoDir, "a.txt", "one", "first commit");
            await commitFile(repoDir, "b.txt", "two", "second commit");

            const result = await git.log(repoDir, 100, 0);

            expect(result.hasMore).toBe(false);
            expect(result.entries).toHaveLength(2);
            const [latest, oldest] = result.entries;
            expect(latest.subject).toBe("second commit");
            expect(oldest.subject).toBe("first commit");
            expect(latest.hash).toMatch(/^[0-9a-f]{40}$/);
            expect(latest.shortHash.length).toBeGreaterThanOrEqual(7);
            expect(latest.hash.startsWith(latest.shortHash)).toBe(true);
            expect(latest.authorName).toBe("Test Author");
            expect(new Date(latest.date).getTime()).not.toBeNaN();
        });

        it("pages with limit and skip and reports hasMore", async () => {
            await commitFile(repoDir, "a.txt", "1", "c1");
            await commitFile(repoDir, "a.txt", "2", "c2");
            await commitFile(repoDir, "a.txt", "3", "c3");

            const page1 = await git.log(repoDir, 2, 0);
            expect(page1.entries.map((e) => e.subject)).toEqual(["c3", "c2"]);
            expect(page1.hasMore).toBe(true);

            const page2 = await git.log(repoDir, 2, 2);
            expect(page2.entries.map((e) => e.subject)).toEqual(["c1"]);
            expect(page2.hasMore).toBe(false);
        });

        it("returns branch decorations in refs", async () => {
            await commitFile(repoDir, "a.txt", "one", "decorated");

            const result = await git.log(repoDir, 10, 0);

            // The checked-out branch name (master or main) decorates the tip commit
            expect(result.entries[0].refs.length).toBeGreaterThan(0);
            expect(result.entries[0].refs.join(",")).toMatch(/ma(in|ster)/);
        });

        it("returns empty result for a repo with no commits", async () => {
            const result = await git.log(repoDir, 100, 0);
            expect(result).toEqual({ entries: [], hasMore: false });
        });

        it("rejects when the path is not a git repository", async () => {
            const plainDir = await mkdtemp(join(tmpdir(), "taskflow-not-a-repo-"));
            try {
                await expect(git.log(plainDir, 100, 0)).rejects.toThrow();
            } finally {
                await rm(plainDir, { recursive: true, force: true });
            }
        });

        it("handles subjects containing tabs and quotes", async () => {
            await commitFile(repoDir, "a.txt", "x", 'weird\tsubject "quoted" %H');

            const result = await git.log(repoDir, 10, 0);

            expect(result.entries[0].subject).toBe('weird\tsubject "quoted" %H');
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: FAIL — `git.log is not a function`.

- [ ] **Step 3: Implement `log` in a new `git-history.ts` module**

Create `packages/backend/src/services/git-history.ts`:

```ts
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
        // An unborn HEAD (repo with no commits yet) is normal empty history.
        // Anything else — not a git repo, corrupt object store — must surface.
        try {
            await git(["rev-parse", "--git-dir"], repoPath);
        } catch {
            throw error;
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
```

- [ ] **Step 4: Delegate from `GitService`**

In `packages/backend/src/services/git-service.ts`:

Add to the imports (next to the `git-worktree`/`git-pr` import blocks):

```ts
import type { GitLogResult } from "@taskflow/shared";
import { log as logImpl } from "./git-history";
```

(Merge `GitLogResult` into the existing `@taskflow/shared` type-import block at the top of the file rather than adding a second import statement.)

Add a method to the `GitService` class (near the other read-only methods, e.g. after `getFileContentsForDiff`):

```ts
    async log(repoPath: string, limit: number, skip: number): Promise<GitLogResult> {
        return logImpl(repoPath, limit, skip);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: PASS (all `log` tests).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git-history.ts packages/backend/src/services/git-service.ts packages/backend/tests/services/git-history.test.ts
git commit -m "feat(backend): git log with paging for history view"
```

---

### Task 3: Backend `commitFiles` — files changed by a commit

**Files:**
- Modify: `packages/backend/src/services/git-history.ts`
- Modify: `packages/backend/src/services/git-service.ts`
- Test: `packages/backend/tests/services/git-history.test.ts`

**Interfaces:**
- Consumes: `git` from `./git-helpers`; `GitCommitFile`, `GitCommitFilesResult` from `@taskflow/shared` (Task 1); test helpers `run`/`commitFile` from Task 2's test file.
- Produces: `commitFiles(repoPath: string, hash: string): Promise<GitCommitFilesResult>` exported from `git-history.ts`; `GitService.commitFiles(repoPath, hash)` delegating. Task 5 calls `git.commitFiles(...)`.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe("git history", ...)` block of `packages/backend/tests/services/git-history.test.ts`:

```ts
    describe("commitFiles", () => {
        it("lists added, modified, and deleted files with stats", async () => {
            await commitFile(repoDir, "keep.txt", "line1\n", "base");
            await writeFile(join(repoDir, "keep.txt"), "line1\nline2\n");
            await writeFile(join(repoDir, "added.txt"), "new\n");
            await run(["git", "add", "."], repoDir);
            await run(["git", "commit", "-m", "changes"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(2);
            const added = files.find((f) => f.path === "added.txt");
            const modified = files.find((f) => f.path === "keep.txt");
            expect(added).toMatchObject({ status: "new", additions: 1, deletions: 0 });
            expect(modified).toMatchObject({ status: "modified", additions: 1, deletions: 0 });
        });

        it("detects deletions", async () => {
            await commitFile(repoDir, "gone.txt", "a\nb\n", "base");
            await run(["git", "rm", "gone.txt"], repoDir);
            await run(["git", "commit", "-m", "remove"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "gone.txt",
                status: "deleted",
                additions: 0,
                deletions: 2,
            });
        });

        it("detects renames with previousPath", async () => {
            await commitFile(repoDir, "old name.txt", "same content\n", "base");
            await run(["git", "mv", "old name.txt", "new name.txt"], repoDir);
            await run(["git", "commit", "-m", "rename"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "new name.txt",
                previousPath: "old name.txt",
                status: "renamed",
            });
        });

        it("marks binary files with -1 stats", async () => {
            await commitFile(repoDir, "a.txt", "text", "base");
            await writeFile(join(repoDir, "bin.dat"), Buffer.from([0, 1, 2, 255, 0, 7]));
            await run(["git", "add", "."], repoDir);
            await run(["git", "commit", "-m", "binary"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "bin.dat",
                status: "new",
                additions: -1,
                deletions: -1,
            });
        });

        it("lists files of the root commit", async () => {
            await commitFile(repoDir, "first.txt", "hello\n", "root");

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({ path: "first.txt", status: "new", additions: 1 });
        });
    });
```

Also extend the imports at the top of the test file: `Buffer` is global in Bun — no import change needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: FAIL — `git.commitFiles is not a function`. (Task 2 tests still PASS.)

- [ ] **Step 3: Implement `commitFiles`**

Append to `packages/backend/src/services/git-history.ts` (and extend its `@taskflow/shared` type import with `GitCommitFile, GitCommitFilesResult`):

```ts
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
```

Add `commitFiles` to the module's export statement: `export { log, commitFiles };`

- [ ] **Step 4: Delegate from `GitService`**

In `packages/backend/src/services/git-service.ts` extend the shared type import with `GitCommitFilesResult`, extend the `git-history` import to `import { log as logImpl, commitFiles as commitFilesImpl } from "./git-history";`, and add below the `log` method:

```ts
    async commitFiles(repoPath: string, hash: string): Promise<GitCommitFilesResult> {
        return commitFilesImpl(repoPath, hash);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git-history.ts packages/backend/src/services/git-service.ts packages/backend/tests/services/git-history.test.ts
git commit -m "feat(backend): list files changed by a commit"
```

---

### Task 4: Backend `commitDiffFile` — before/after blobs for one file

**Files:**
- Modify: `packages/backend/src/services/git-history.ts`
- Modify: `packages/backend/src/services/git-service.ts`
- Test: `packages/backend/tests/services/git-history.test.ts`

**Interfaces:**
- Consumes: `git` from `./git-helpers`; `GitFileContentPair` from `@taskflow/shared` (existing type).
- Produces: `commitDiffFile(repoPath: string, hash: string, path: string, previousPath?: string): Promise<GitFileContentPair>` exported from `git-history.ts`; `GitService.commitDiffFile(...)` delegating. Task 5 calls it.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe("git history", ...)` block of the test file:

```ts
    describe("commitDiffFile", () => {
        it("returns original and modified content for a modified file", async () => {
            await commitFile(repoDir, "f.txt", "before\n", "base");
            await commitFile(repoDir, "f.txt", "after\n", "change");

            const { entries } = await git.log(repoDir, 1, 0);
            const pair = await git.commitDiffFile(repoDir, entries[0].hash, "f.txt");

            expect(pair).toEqual({ original: "before\n", modified: "after\n" });
        });

        it("returns empty original for a file added in the root commit", async () => {
            await commitFile(repoDir, "f.txt", "hello\n", "root");

            const { entries } = await git.log(repoDir, 1, 0);
            const pair = await git.commitDiffFile(repoDir, entries[0].hash, "f.txt");

            expect(pair).toEqual({ original: "", modified: "hello\n" });
        });

        it("returns empty modified for a deleted file", async () => {
            await commitFile(repoDir, "f.txt", "content\n", "base");
            await run(["git", "rm", "f.txt"], repoDir);
            await run(["git", "commit", "-m", "remove"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const pair = await git.commitDiffFile(repoDir, entries[0].hash, "f.txt");

            expect(pair).toEqual({ original: "content\n", modified: "" });
        });

        it("uses previousPath for the original side of a rename", async () => {
            await commitFile(repoDir, "old.txt", "same\n", "base");
            await run(["git", "mv", "old.txt", "new.txt"], repoDir);
            await run(["git", "commit", "-m", "rename"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const pair = await git.commitDiffFile(
                repoDir,
                entries[0].hash,
                "new.txt",
                "old.txt",
            );

            expect(pair).toEqual({ original: "same\n", modified: "same\n" });
        });

        it("rejects when the commit does not exist", async () => {
            await commitFile(repoDir, "f.txt", "x\n", "base");
            await expect(
                git.commitDiffFile(repoDir, "0".repeat(40), "f.txt"),
            ).rejects.toThrow();
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: FAIL — `git.commitDiffFile is not a function`.

- [ ] **Step 3: Implement `commitDiffFile`**

Append to `packages/backend/src/services/git-history.ts` (extend the shared type import with `GitFileContentPair`):

```ts
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
```

Update the export statement: `export { log, commitFiles, commitDiffFile };`

- [ ] **Step 4: Delegate from `GitService`**

Extend the `git-history` import in `git-service.ts` with `commitDiffFile as commitDiffFileImpl` and add:

```ts
    async commitDiffFile(
        repoPath: string,
        hash: string,
        path: string,
        previousPath?: string,
    ): Promise<GitFileContentPair> {
        return commitDiffFileImpl(repoPath, hash, path, previousPath);
    }
```

(`GitFileContentPair` is already imported in `git-service.ts`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git-history.ts packages/backend/src/services/git-service.ts packages/backend/tests/services/git-history.test.ts
git commit -m "feat(backend): fetch before/after blobs for a commit file"
```

---

### Task 5: Backend WebSocket handlers

**Files:**
- Modify: `packages/backend/src/handlers/git.ts`
- Test: `packages/backend/tests/handlers/git.test.ts`

**Interfaces:**
- Consumes: `MSG.GIT_LOG` / `MSG.GIT_COMMIT_FILES` / `MSG.GIT_COMMIT_DIFF_FILE` and payload types (Task 1); `GitService.log` / `.commitFiles` / `.commitDiffFile` (Tasks 2–4); existing `assertWorkspaceRepo`, `assertRepoFilePath` from `../utils/path-validation`.
- Produces: three registered channels. Responses are the raw `GitLogResult`, `GitCommitFilesResult`, and `GitFileContentPair` objects (no wrapper), consumed by Task 7's UI.

- [ ] **Step 1: Write the failing tests**

`packages/backend/tests/handlers/git.test.ts` already builds a `Router` + `TaskStore` + `FakeGitService` fixture with `projectPath` registered as a project (see its `beforeEach`). Extend `FakeGitService` (top of file) with:

```ts
    logCalls: Array<{ repoPath: string; limit: number; skip: number }> = [];
    commitFilesCalls: Array<{ repoPath: string; hash: string }> = [];
    commitDiffFileCalls: Array<{
        repoPath: string;
        hash: string;
        path: string;
        previousPath?: string;
    }> = [];

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
        return { original: "", modified: "" };
    }
```

Add tests at the end of the `describe("git handlers", ...)` block (the `expectRejects` helper already exists in this file):

```ts
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
```

(The match strings are substrings of the real errors thrown by `packages/backend/src/utils/path-validation.ts`: `Repository is outside known workspaces: ...` / `File path is outside repository: ...`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/git.test.ts`
Expected: new tests FAIL (unregistered channel → router error); existing tests PASS.

- [ ] **Step 3: Implement the handlers**

In `packages/backend/src/handlers/git.ts`, extend the payload type import with `GitLogPayload, GitCommitFilesPayload, GitCommitDiffFilePayload`, add a module-level helper above `registerGitHandlers`:

```ts
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

function assertCommitHash(hash: string): string {
    if (!COMMIT_HASH_PATTERN.test(hash)) {
        throw new Error("Invalid commit hash");
    }
    return hash;
}
```

and register inside `registerGitHandlers`, after the `MSG.GIT_DIFF_FILE_CONTENT` handler:

```ts
    router.register(MSG.GIT_LOG, async (payload) => {
        const { repoPath: rawRepoPath, limit, skip } = payload as GitLogPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        const safeLimit = Math.min(Math.max(limit ?? 100, 1), 500);
        const safeSkip = Math.max(skip ?? 0, 0);
        return await git.log(repoPath, safeLimit, safeSkip);
    });

    router.register(MSG.GIT_COMMIT_FILES, async (payload) => {
        const { repoPath: rawRepoPath, hash } = payload as GitCommitFilesPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        return await git.commitFiles(repoPath, assertCommitHash(hash));
    });

    router.register(MSG.GIT_COMMIT_DIFF_FILE, async (payload) => {
        const {
            repoPath: rawRepoPath,
            hash,
            path,
            previousPath,
        } = payload as GitCommitDiffFilePayload;
        const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
        assertRepoFilePath(repoPath, path);
        if (previousPath) {
            assertRepoFilePath(repoPath, previousPath);
        }
        return await git.commitDiffFile(repoPath, assertCommitHash(hash), path, previousPath);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/handlers/git.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite and typecheck**

Run: `cd packages/backend && bun test && bun run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handlers/git.ts packages/backend/tests/handlers/git.test.ts
git commit -m "feat(backend): git history websocket handlers"
```

---

### Task 6: UI wiring — tab type, header button, tab content

**Files:**
- Modify: `packages/ui/src/stores/session-helpers.ts` (Tab union, ~line 8)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx` (next to `handleDiffTab`, ~line 350, and the `TaskHeader` render, ~line 434)
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx` (props ~line 55, gating ~line 160, buttons ~line 395)
- Modify: `packages/ui/src/components/workspace/TabContent.tsx` (switch, after the `"changes"` case ~line 110)

**Interfaces:**
- Consumes: existing `useSessionStore` tab API, `useUIStore` split state, `showGitButtons` gating in `TaskHeader`.
- Produces: `Tab["type"]` includes `"history"`; `TaskHeader` accepts `onHistory?: () => void`; `TabContent` renders `<HistoryPane repoPath={workspace.workingDir} />` for history tabs. Task 7 provides `HistoryPane` — in THIS task create a stub so the app compiles.

- [ ] **Step 1: Add the tab type**

In `packages/ui/src/stores/session-helpers.ts`, add `| "history"` to the `Tab["type"]` union after `| "changes"`.

- [ ] **Step 2: Create a stub `HistoryPane`**

Create `packages/ui/src/components/panes/HistoryPane.tsx`:

```tsx
interface HistoryPaneProps {
    repoPath: string;
}

function HistoryPane({ repoPath }: HistoryPaneProps) {
    return <div className="text-muted-foreground p-3 text-sm">History for {repoPath}</div>;
}

export { HistoryPane };
```

- [ ] **Step 3: Render history tabs**

In `packages/ui/src/components/workspace/TabContent.tsx`, import `HistoryPane` next to the `ChangesPane` import and add a case after the `"changes"` case:

```tsx
                    case "history":
                        label = "History";
                        if (!isActive) return null;
                        pane = workspace.workingDir ? (
                            <HistoryPane repoPath={workspace.workingDir} />
                        ) : (
                            <div className="text-muted-foreground p-3">
                                Repository not available
                            </div>
                        );
                        break;
```

- [ ] **Step 4: Add `handleHistoryTab` in `Workspace.tsx`**

The existing `handleDiffTab` (lines 350–376) finds-or-creates a `"changes"` tab across the main and `:right` pane keys. Generalize instead of duplicating: rename the body into a shared helper and keep both callbacks:

```tsx
    const openSingletonTab = (type: "changes" | "history", label: string) => {
        if (!workspace.workspaceKey) return;
        const store = useSessionStore.getState();
        const rightKey = `${workspace.workspaceKey}:right`;
        const allTabs = [
            ...(store.tabsByWorkspace[workspace.workspaceKey] ?? []),
            ...(store.tabsByWorkspace[rightKey] ?? []),
        ];
        const existingTab = allTabs.find((tab) => tab.type === type);
        if (existingTab) {
            const rightTabs = store.tabsByWorkspace[rightKey] ?? [];
            if (rightTabs.some((t) => t.id === existingTab.id)) {
                store.setActiveTab(rightKey, existingTab.id);
            } else {
                store.setActiveTab(workspace.workspaceKey, existingTab.id);
            }
            return;
        }
        const split = useUIStore.getState().splitByWorkspace[workspace.workspaceKey];
        const targetKey =
            split?.open && split.activePane === "right" ? rightKey : workspace.workspaceKey;
        store.addTab(targetKey, { id: crypto.randomUUID(), type, label });
    };

    const handleDiffTab = () => openSingletonTab("changes", "Changes");
    const handleHistoryTab = () => openSingletonTab("history", "History");
```

Then pass it to the header (line ~434):

```tsx
            <TaskHeader
                task={workspace.task ?? undefined}
                project={workspace.project}
                onDiff={canShowGitControls ? handleDiffTab : undefined}
                onHistory={canShowGitControls ? handleHistoryTab : undefined}
            />
```

- [ ] **Step 5: Add the History button to `TaskHeader.tsx`**

Extend the props interface and destructuring:

```tsx
interface TaskHeaderProps {
    task?: Task;
    project?: Project;
    onDiff?: () => void;
    onHistory?: () => void;
}

export function TaskHeader({ task, project, onDiff, onHistory }: TaskHeaderProps) {
```

Next to `const showDiffButton = !!onDiff && showGitButtons;` (line ~161) add:

```tsx
    const showHistoryButton = !!onHistory && showGitButtons;
```

Import the `History` icon from `lucide-react` (extend the existing lucide import). Then, immediately AFTER the Diff button's closing `)}` (line ~424), add:

```tsx
                    {showHistoryButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onHistory}
                            aria-label="Show history"
                            className="[-webkit-app-region:no-drag]">
                            <History className="h-3 w-3" />
                            <span className="text-xs">History</span>
                        </Button>
                    )}
```

Note: unlike Diff, the History button is never disabled by `diffDisabled` — history exists even with a clean working tree.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bunx eslint packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/components/workspace/TaskHeader.tsx packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/panes/HistoryPane.tsx packages/ui/src/stores/session-helpers.ts`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/session-helpers.ts packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/components/workspace/TaskHeader.tsx packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/panes/HistoryPane.tsx
git commit -m "feat(ui): history tab type and header entry point"
```

---

### Task 7: `HistoryPane` — commit list, file list, diff

**Files:**
- Modify: `packages/ui/src/components/panes/HistoryPane.tsx` (replace the Task 6 stub)

**Interfaces:**
- Consumes: `sendRequest` from `@/hooks/useWebSocket`; `MSG.GIT_LOG` / `MSG.GIT_COMMIT_FILES` / `MSG.GIT_COMMIT_DIFF_FILE`; types `GitLogEntry`, `GitLogResult`, `GitCommitFile`, `GitCommitFilesResult`, `GitFileContentPair` from `@taskflow/shared`; `MonacoDiffViewer` from `./MonacoDiffViewer`; `getLanguage` from `@/lib/editor-language`; `Badge`, `Button`, `CopyButton` from `@/components/ui/*`; `cn` from `@/lib/utils`.
- Produces: `HistoryPane({ repoPath })` — no new exports beyond the component.

- [ ] **Step 1: Implement the pane**

Replace `packages/ui/src/components/panes/HistoryPane.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type {
    GitCommitFile,
    GitCommitFilesResult,
    GitFileContentPair,
    GitLogEntry,
    GitLogResult,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import { getLanguage } from "@/lib/editor-language";
import { MonacoDiffViewer } from "./MonacoDiffViewer";

const PAGE_SIZE = 100;

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: "year", seconds: 31536000 },
    { unit: "month", seconds: 2592000 },
    { unit: "week", seconds: 604800 },
    { unit: "day", seconds: 86400 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
];

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatCommitDate(iso: string): string {
    const elapsed = (new Date(iso).getTime() - Date.now()) / 1000;
    if (Number.isNaN(elapsed)) return "";
    for (const { unit, seconds } of RELATIVE_UNITS) {
        if (Math.abs(elapsed) >= seconds) {
            return relativeFormat.format(Math.round(elapsed / seconds), unit);
        }
    }
    return "just now";
}

function statusPrefix(status: GitCommitFile["status"]): string {
    if (status === "new") return "+";
    if (status === "deleted") return "D";
    if (status === "renamed") return "R";
    return "M";
}

function displayPath(file: GitCommitFile): string {
    return file.status === "renamed" && file.previousPath
        ? `${file.previousPath} -> ${file.path}`
        : file.path;
}

function isBinary(file: GitCommitFile): boolean {
    return file.additions === -1 && file.deletions === -1;
}

interface CommitRowProps {
    entry: GitLogEntry;
    isSelected: boolean;
    onSelect: (hash: string) => void;
}

function CommitRow({ entry, isSelected, onSelect }: CommitRowProps) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry.hash)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(entry.hash);
                }
            }}
            className={cn(
                "group cursor-pointer rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/60",
                isSelected && "bg-muted",
            )}>
            <div className="flex items-center justify-between gap-1">
                <span className="text-secondary-foreground min-w-0 flex-1 truncate">
                    {entry.subject}
                </span>
                <span
                    className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}>
                    {/* CopyButton doesn't stop propagation itself; without this
                        the copy click would also select the commit row */}
                    <CopyButton value={entry.hash} tooltip="Copy hash" />
                </span>
            </div>
            <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                <span className="font-mono">{entry.shortHash}</span>
                <span className="truncate">{entry.authorName}</span>
                <span className="shrink-0">{formatCommitDate(entry.date)}</span>
                {entry.refs.map((ref) => (
                    <Badge key={ref} variant="outline" className="px-1 py-0 text-xs">
                        {ref}
                    </Badge>
                ))}
            </div>
        </div>
    );
}

interface HistoryPaneProps {
    repoPath: string;
    className?: string;
}

function HistoryPane({ repoPath, className }: HistoryPaneProps) {
    const [entries, setEntries] = useState<GitLogEntry[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [logLoading, setLogLoading] = useState(true);
    const [logError, setLogError] = useState(false);
    const [selectedHash, setSelectedHash] = useState<string | null>(null);
    const [files, setFiles] = useState<GitCommitFile[] | null>(null);
    const [filesError, setFilesError] = useState(false);
    const [selectedFile, setSelectedFile] = useState<GitCommitFile | null>(null);
    const [diffPair, setDiffPair] = useState<GitFileContentPair | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [diffError, setDiffError] = useState(false);
    const repoVersionRef = useRef(0);
    const requestIdRef = useRef(0);

    const fetchLog = useCallback(
        async (skip: number, repoVersion = repoVersionRef.current) => {
            setLogLoading(true);
            try {
                const result = await sendRequest<GitLogResult>(MSG.GIT_LOG, {
                    repoPath,
                    limit: PAGE_SIZE,
                    skip,
                });
                if (repoVersion !== repoVersionRef.current) return;
                setEntries((prev) => (skip === 0 ? result.entries : [...prev, ...result.entries]));
                setHasMore(result.hasMore);
                setLogError(false);
            } catch (err: unknown) {
                if (repoVersion !== repoVersionRef.current) return;
                console.error("Failed to fetch git log:", err);
                setLogError(true);
            } finally {
                if (repoVersion === repoVersionRef.current) setLogLoading(false);
            }
        },
        [repoPath],
    );

    useEffect(() => {
        const repoVersion = ++repoVersionRef.current;
        requestIdRef.current += 1;
        setEntries([]);
        setHasMore(false);
        setLogError(false);
        setSelectedHash(null);
        setFiles(null);
        setSelectedFile(null);
        setDiffPair(null);
        setDiffLoading(false);
        void fetchLog(0, repoVersion);
    }, [repoPath, fetchLog]);

    async function selectCommit(hash: string) {
        const repoVersion = repoVersionRef.current;
        const requestId = ++requestIdRef.current;
        setSelectedHash(hash);
        setFiles(null);
        setFilesError(false);
        setSelectedFile(null);
        setDiffPair(null);
        setDiffLoading(false);
        setDiffError(false);
        try {
            const result = await sendRequest<GitCommitFilesResult>(MSG.GIT_COMMIT_FILES, {
                repoPath,
                hash,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            setFiles(result.files);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            console.error("Failed to fetch commit files:", err);
            setFilesError(true);
        }
    }

    async function selectFile(file: GitCommitFile) {
        if (!selectedHash) return;
        const repoVersion = repoVersionRef.current;
        const requestId = ++requestIdRef.current;
        setSelectedFile(file);
        setDiffPair(null);
        setDiffError(false);
        if (isBinary(file)) return;
        setDiffLoading(true);
        try {
            const result = await sendRequest<GitFileContentPair>(MSG.GIT_COMMIT_DIFF_FILE, {
                repoPath,
                hash: selectedHash,
                path: file.path,
                previousPath: file.status === "renamed" ? file.previousPath : undefined,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            setDiffPair(result);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            console.error("Failed to fetch commit diff:", err);
            setDiffError(true);
        } finally {
            if (repoVersion === repoVersionRef.current && requestId === requestIdRef.current) {
                setDiffLoading(false);
            }
        }
    }

    return (
        <div className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden", className)}>
            {/* Left column: commits on top, selected commit's files beneath */}
            <div className="border-border flex w-80 shrink-0 flex-col border-r">
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {logError ? (
                        <div className="text-muted-foreground p-1 text-sm">
                            Failed to load history{" "}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-xs"
                                onClick={() => void fetchLog(0)}>
                                Retry
                            </Button>
                        </div>
                    ) : entries.length === 0 && !logLoading ? (
                        <div className="text-muted-foreground p-1 text-sm">No commits yet</div>
                    ) : (
                        <>
                            {entries.map((entry) => (
                                <CommitRow
                                    key={entry.hash}
                                    entry={entry}
                                    isSelected={entry.hash === selectedHash}
                                    onSelect={(hash) => void selectCommit(hash)}
                                />
                            ))}
                            {hasMore && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1 h-6 w-full text-xs"
                                    loading={logLoading}
                                    onClick={() => void fetchLog(entries.length)}>
                                    Load more
                                </Button>
                            )}
                        </>
                    )}
                    {logLoading && entries.length === 0 && (
                        <div className="text-muted-foreground p-1 text-sm">Loading history...</div>
                    )}
                </div>
                {selectedHash && (
                    <div className="border-border max-h-[40%] shrink-0 overflow-y-auto border-t p-2">
                        {filesError ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                Failed to load commit{" "}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1.5 text-xs"
                                    onClick={() => void selectCommit(selectedHash)}>
                                    Retry
                                </Button>
                            </div>
                        ) : files === null ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                Loading files...
                            </div>
                        ) : files.length === 0 ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                No files changed
                            </div>
                        ) : (
                            files.map((file) => (
                                <div
                                    key={file.path}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => void selectFile(file)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            void selectFile(file);
                                        }
                                    }}
                                    className={cn(
                                        "flex cursor-pointer items-center justify-between gap-1 rounded-md px-1 py-0.5 text-sm transition-colors hover:bg-muted/60",
                                        selectedFile?.path === file.path && "bg-muted",
                                    )}>
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "px-1 py-0 font-mono text-xs",
                                                file.status === "deleted" &&
                                                    "text-destructive border-destructive/30",
                                            )}>
                                            {statusPrefix(file.status)}
                                        </Badge>
                                        <span className="text-secondary-foreground truncate">
                                            {displayPath(file)}
                                        </span>
                                    </span>
                                    <span className="flex shrink-0 gap-0.5 text-xs">
                                        {isBinary(file) ? (
                                            <span className="text-muted-foreground">binary</span>
                                        ) : (
                                            <>
                                                <span className="text-success">
                                                    +{file.additions}
                                                </span>
                                                <span className="text-destructive">
                                                    -{file.deletions}
                                                </span>
                                            </>
                                        )}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Right side: diff area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {diffLoading ? (
                    <div className="text-muted-foreground p-3 text-sm">Loading diff...</div>
                ) : diffError ? (
                    <div className="text-muted-foreground p-3 text-sm">
                        Failed to load diff{" "}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs"
                            onClick={() => selectedFile && void selectFile(selectedFile)}>
                            Retry
                        </Button>
                    </div>
                ) : selectedFile && isBinary(selectedFile) ? (
                    <div className="text-muted-foreground p-3 text-sm">Binary file</div>
                ) : diffPair ? (
                    <div className="min-h-0 flex-1">
                        <MonacoDiffViewer
                            original={diffPair.original}
                            modified={diffPair.modified}
                            language={selectedFile ? getLanguage(selectedFile.path) : "plaintext"}
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground p-3 text-sm">
                        {selectedHash
                            ? "Click a file to see its diff"
                            : "Select a commit to see its changes"}
                    </div>
                )}
            </div>
        </div>
    );
}

export { HistoryPane };
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bunx eslint packages/ui/src/components/panes/HistoryPane.tsx`
Expected: both exit 0.

- [ ] **Step 3: Verify in the running app**

Runtime verification is performed by the ORCHESTRATING session after this task completes, not by the task subagent (the subagent only needs Steps 1, 2, and 4). Orchestrator checklist: launch the dev sandbox (fake `HOME` + `TASKFLOW_DEV_PORT` per the project's dev-backend sandbox convention; never the real data dir), open a project workspace → click History → commit list appears → select a commit → files appear → select a file → Monaco diff renders. Also confirm the History tab and Changes tab coexist, and re-clicking History focuses the existing tab instead of opening a duplicate.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/panes/HistoryPane.tsx
git commit -m "feat(ui): git history pane with commit list and diffs"
```

---

### Task 8: Final verification and release

> This release step (version bump + push) is NOT part of the feature spec — it was explicitly requested by the user for this delivery ("bump minor version, commit and push"). Execute it only as the final task, after every other task is complete and reviewed.

**Files:**
- Modify: `electron/package.json` (version field only)

**Interfaces:**
- Consumes: everything above.
- Produces: released commit on `main`, pushed.

- [ ] **Step 1: Full test suite, typecheck, lint**

Run from the repo root: `bun test && bun run typecheck && bun run lint`
Expected: all pass, exit 0.

- [ ] **Step 2: Bump minor version**

In `electron/package.json` change `"version": "0.8.x"` to `"version": "0.9.0"` (minor bump from whatever the current value is — this is the only file that carries the app version; prior bump commits touch only it).

- [ ] **Step 3: Commit and push**

```bash
git add electron/package.json
git commit -m "version bump"
git push
```

Expected: push succeeds to `origin/main`.

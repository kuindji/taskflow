# Git Staging Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git staging (index) support to the diff view and commit dialog so users can stage/unstage files individually or in bulk, and choose whether to commit only staged changes.

**Architecture:** Extend the shared git types to distinguish staged vs unstaged files. Update the backend `GitService` to parse porcelain v1 status codes into separate arrays, add stage/unstage methods, and split diff output by index state. Update the frontend `ChangesPane` to show two collapsible sections with stage/unstage controls, and add an "Include unstaged" toggle to `CommitDialog`.

**Tech Stack:** TypeScript, Bun, React, Zustand, WebSocket

---

## Chunk 1: Shared Types & Constants

### Task 1: Update shared git types

**Files:**
- Modify: `packages/shared/src/types/git.ts`

- [ ] **Step 1: Update `GitFileStatus` — add `staged` field**

```ts
export interface GitFileStatus {
    path: string;
    absolutePath?: string;
    previousPath?: string;
    status: "new" | "modified" | "deleted" | "untracked" | "renamed";
    staged: boolean;
}
```

- [ ] **Step 2: Update `GitStatusResult` — replace `files` with `stagedFiles` and `unstagedFiles`**

```ts
export interface GitStatusResult {
    branch: string | null;
    stagedFiles: GitFileStatus[];
    unstagedFiles: GitFileStatus[];
    ahead: number;
}
```

- [ ] **Step 3: Update `GitDiffFile` — add `staged` field**

```ts
export interface GitDiffFile {
    path: string;
    additions: number;
    deletions: number;
    diff: string;
    staged: boolean;
}
```

- [ ] **Step 4: Verify the shared package builds**

Run: `cd packages/shared && bun run build`
Expected: Build succeeds (downstream packages will have type errors — that's expected at this stage).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/git.ts
git commit -m "feat: update shared git types for staging support"
```

### Task 2: Add new WebSocket message constants

**Files:**
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add `GIT_STAGE` and `GIT_UNSTAGE` to the MSG object**

Add these two entries after `GIT_REVERT_FILE` (line 54):

```ts
    GIT_STAGE: "git:stage",
    GIT_UNSTAGE: "git:unstage",
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat: add GIT_STAGE and GIT_UNSTAGE message constants"
```

### Task 3: Update WebSocket payload types

**Files:**
- Modify: `packages/shared/src/types/ws.ts`

- [ ] **Step 1: Add `GitStagePayload` and `GitUnstagePayload` interfaces**

Add after `GitRevertFilePayload` (line 267):

```ts
export interface GitStagePayload {
    repoPath: string;
    filePath?: string;
}

export interface GitUnstagePayload {
    repoPath: string;
    filePath?: string;
}
```

- [ ] **Step 2: Update `GitDiffFileResponse` to return staged/unstaged diffs separately**

Change `GitDiffFileResponse` (lines 258-260) from:

```ts
export interface GitDiffFileResponse {
    diff: string;
}
```

to:

```ts
export interface GitDiffFileResponse {
    staged?: string;
    unstaged?: string;
}
```

- [ ] **Step 3: Update `GitCommitPayload` to include `includeUnstaged`**

Change `GitCommitPayload` (lines 275-279) from:

```ts
export interface GitCommitPayload {
    path: string;
    message: string;
    push: boolean;
}
```

to:

```ts
export interface GitCommitPayload {
    path: string;
    message: string;
    push: boolean;
    includeUnstaged?: boolean;
}
```

- [ ] **Step 4: Add `GitGenerateCommitMsgPayload`**

Currently `GIT_GENERATE_COMMIT_MSG` reuses `GitStatusPayload` (just `{ path }`). Add a dedicated type after `GitCommitResult`:

```ts
export interface GitGenerateCommitMsgPayload {
    path: string;
    includeUnstaged?: boolean;
}
```

- [ ] **Step 5: Verify the shared package builds**

Run: `cd packages/shared && bun run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/ws.ts
git commit -m "feat: add staging-related WebSocket payload types"
```

---

## Chunk 2: Backend Git Service

### Task 4: Update `status()` to separate staged and unstaged files

**Files:**
- Modify: `packages/backend/src/services/git-service.ts`

- [ ] **Step 1: Write the failing test for staged/unstaged separation**

Add to `packages/backend/tests/services/git-service.test.ts`:

```ts
it("separates staged and unstaged files in status", async () => {
    // Create a modified file (unstaged)
    await writeFile(join(repoDir, "initial.txt"), "modified");
    // Create a new file and stage it
    await writeFile(join(repoDir, "staged.txt"), "new content");
    await run(["git", "add", "staged.txt"], repoDir);

    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(1);
    expect(status.stagedFiles[0]).toMatchObject({ path: "staged.txt", status: "new", staged: true });
    expect(status.unstagedFiles).toHaveLength(1);
    expect(status.unstagedFiles[0]).toMatchObject({ path: "initial.txt", status: "modified", staged: false });
});

it("shows partially staged file in both arrays", async () => {
    await writeFile(join(repoDir, "initial.txt"), "staged content");
    await run(["git", "add", "initial.txt"], repoDir);
    await writeFile(join(repoDir, "initial.txt"), "more changes after staging");

    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(1);
    expect(status.stagedFiles[0]).toMatchObject({ path: "initial.txt", status: "modified", staged: true });
    expect(status.unstagedFiles).toHaveLength(1);
    expect(status.unstagedFiles[0]).toMatchObject({ path: "initial.txt", status: "modified", staged: false });
});

it("shows untracked files only in unstaged", async () => {
    await writeFile(join(repoDir, "untracked.txt"), "untracked");
    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(0);
    expect(status.unstagedFiles).toHaveLength(1);
    expect(status.unstagedFiles[0]).toMatchObject({ path: "untracked.txt", status: "untracked", staged: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: FAIL — `status.stagedFiles` is undefined (property doesn't exist yet).

- [ ] **Step 3: Rewrite `status()` to parse XY codes into staged/unstaged arrays**

Replace the `status()` method in `packages/backend/src/services/git-service.ts` (lines 37-79). The key change is parsing the two-character XY status code: first character is index (staged), second is worktree (unstaged). `??` = untracked (unstaged only).

```ts
async status(repoPath: string): Promise<GitStatusResult> {
    const branchOutput = await git(["branch", "--show-current"], repoPath);
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
```

- [ ] **Step 4: Add `parseStatusChar()` private method**

Add alongside the existing `parseStatus()` (which can be removed later or kept for backward compat). Place it after `parseStatus()`:

```ts
private parseStatusChar(char: string): GitFileStatus["status"] {
    switch (char) {
        case "A": return "new";
        case "D": return "deleted";
        case "R": return "renamed";
        case "M":
        case "T":
        default: return "modified";
    }
}
```

- [ ] **Step 5: Update existing tests that reference `status.files`**

In `packages/backend/tests/services/git-service.test.ts`, update all existing tests. The pattern:

- `status.files` → `status.unstagedFiles` for unstaged/untracked scenarios
- `status.files` → `status.stagedFiles` for staged scenarios (like after revert checks where length should be 0, check both arrays)

Specific changes:

Test "gets status of clean repo" (line 31-35):
```ts
expect(status.stagedFiles).toHaveLength(0);
expect(status.unstagedFiles).toHaveLength(0);
```

Test "detects modified files" (line 37-42):
```ts
expect(status.unstagedFiles).toHaveLength(1);
expect(status.unstagedFiles[0].status).toBe("modified");
```

Test "detects new untracked files" (line 44-49):
```ts
expect(status.unstagedFiles).toHaveLength(1);
expect(status.unstagedFiles[0].status).toBe("untracked");
```

Test "reverts a modified file" (line 93-98):
```ts
expect(status.stagedFiles).toHaveLength(0);
expect(status.unstagedFiles).toHaveLength(0);
```

Test "parses renamed files with spaces" (line 100-109):
```ts
expect(status.stagedFiles).toHaveLength(1);
expect(status.stagedFiles[0]).toMatchObject({
    status: "renamed",
    path: "renamed file.txt",
    previousPath: "initial.txt",
    staged: true,
});
```

Test "reverts an untracked file" (line 111-116):
```ts
expect(status.stagedFiles).toHaveLength(0);
expect(status.unstagedFiles).toHaveLength(0);
```

Test "reverts a renamed file" (line 118-127):
```ts
expect(status.stagedFiles).toHaveLength(0);
expect(status.unstagedFiles).toHaveLength(0);
```

Test "reverts a staged new file" (line 129-135):
```ts
expect(status.stagedFiles).toHaveLength(0);
expect(status.unstagedFiles).toHaveLength(0);
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/git-service.ts packages/backend/tests/services/git-service.test.ts
git commit -m "feat: update status() to separate staged and unstaged files"
```

### Task 5: Update `resolveFileStatus()`, `diff()`, and `diffFile()`

**Files:**
- Modify: `packages/backend/src/services/git-service.ts`

- [ ] **Step 1: Write failing tests for the new diffFile return type**

Add to test file:

```ts
it("diffFile returns staged and unstaged diffs separately", async () => {
    await writeFile(join(repoDir, "initial.txt"), "staged content");
    await run(["git", "add", "initial.txt"], repoDir);
    await writeFile(join(repoDir, "initial.txt"), "more unstaged changes");

    const result = await git.diffFile(repoDir, "initial.txt");
    expect(result.staged).toContain("staged content");
    expect(result.unstaged).toContain("more unstaged changes");
});

it("diffFile returns only staged for fully staged file", async () => {
    await writeFile(join(repoDir, "initial.txt"), "staged only");
    await run(["git", "add", "initial.txt"], repoDir);

    const result = await git.diffFile(repoDir, "initial.txt");
    expect(result.staged).toContain("staged only");
    expect(result.unstaged).toBeUndefined();
});

it("diffFile returns only unstaged for untracked file", async () => {
    await writeFile(join(repoDir, "new.txt"), "untracked content");

    const result = await git.diffFile(repoDir, "new.txt");
    expect(result.staged).toBeUndefined();
    expect(result.unstaged).toContain("untracked content");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: FAIL — `diffFile` returns a string, not an object.

- [ ] **Step 3: Update `resolveFileStatus()`, `diffFile()`, `diffSegments()`, and `diff()` together**

These four methods are interdependent — update them all before running tests. Apply all changes in Steps 3a–3d before proceeding to Step 4.

**Step 3a: Update `resolveFileStatus()`**

Replace `resolveFileStatus()` (lines 107-113):

```ts
private async resolveFileStatus(
    repoPath: string,
    filePath: string,
): Promise<{ staged: Pick<GitFileStatus, "path" | "status" | "previousPath"> | null; unstaged: Pick<GitFileStatus, "path" | "status" | "previousPath"> | null }> {
    const status = await this.status(repoPath);
    const staged = status.stagedFiles.find((file) => file.path === filePath) ?? null;
    const unstaged = status.unstagedFiles.find((file) => file.path === filePath) ?? null;
    return { staged, unstaged };
}
```

**Step 3b: Update `diffFile()` to return `{ staged?, unstaged? }`**

Replace `diffFile()` (lines 162-177). The new signature and implementation:

```ts
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
```

**Step 3c: Update `diffSegments()` to accept a `staged` parameter**

Replace `diffSegments()` (lines 115-139). The method needs to know whether to return cached or worktree diff:

```ts
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
```

**Step 3d: Update `diff()` to produce tagged `GitDiffFile` entries**

Replace `diff()` (lines 141-160). Now iterates both staged and unstaged files:

```ts
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
```

- [ ] **Step 4: Update existing diff tests for new return types**

In the test file, update:

Test "gets diff" (line 51-56): `diff` is now in `files[0].diff` — but `diff()` may return 1 unstaged entry. This test creates an unstaged modification, so:
```ts
it("gets diff", async () => {
    await writeFile(join(repoDir, "initial.txt"), "modified content");
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].staged).toBe(false);
    expect(diff.files[0].diff).toContain("modified content");
});
```

Test "gets diff for untracked files" (line 58-64):
```ts
it("gets diff for untracked files", async () => {
    await writeFile(join(repoDir, "new.txt"), "new file");
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "new.txt", additions: 1, deletions: 0, staged: false });
    expect(diff.files[0].diff).toContain("new file");
});
```

Test "gets diff for staged new files" (line 66-73):
```ts
it("gets diff for staged new files", async () => {
    await writeFile(join(repoDir, "staged.txt"), "staged file");
    await run(["git", "add", "staged.txt"], repoDir);
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "staged.txt", additions: 1, deletions: 0, staged: true });
    expect(diff.files[0].diff).toContain("staged file");
});
```

Test "gets diff for renamed files" (line 75-85):
```ts
it("gets diff for renamed files", async () => {
    await run(["git", "mv", "initial.txt", "renamed file.txt"], repoDir);
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
        path: "renamed file.txt",
        additions: 0,
        deletions: 0,
        staged: true,
    });
    expect(diff.files[0].diff).toContain("rename to renamed file.txt");
});
```

Test "gets file diff for staged files" (line 137-142): `diffFile` now returns an object:
```ts
it("gets file diff for staged files", async () => {
    await writeFile(join(repoDir, "staged.txt"), "new content");
    await run(["git", "add", "staged.txt"], repoDir);
    const result = await git.diffFile(repoDir, "staged.txt");
    expect(result.staged).toContain("new content");
});
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git-service.ts packages/backend/tests/services/git-service.test.ts
git commit -m "feat: update diff/diffFile/resolveFileStatus for staging support"
```

### Task 6: Add `stage()` and `unstage()` methods

**Files:**
- Modify: `packages/backend/src/services/git-service.ts`
- Modify: `packages/backend/tests/services/git-service.test.ts`

- [ ] **Step 1: Write failing tests for stage/unstage**

```ts
it("stages a single file", async () => {
    await writeFile(join(repoDir, "a.txt"), "aaa");
    await writeFile(join(repoDir, "b.txt"), "bbb");

    await git.stage(repoDir, "a.txt");
    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(1);
    expect(status.stagedFiles[0].path).toBe("a.txt");
    expect(status.unstagedFiles).toHaveLength(1);
    expect(status.unstagedFiles[0].path).toBe("b.txt");
});

it("stages all files", async () => {
    await writeFile(join(repoDir, "a.txt"), "aaa");
    await writeFile(join(repoDir, "b.txt"), "bbb");

    await git.stage(repoDir);
    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(2);
    expect(status.unstagedFiles).toHaveLength(0);
});

it("unstages a single file", async () => {
    await writeFile(join(repoDir, "a.txt"), "aaa");
    await writeFile(join(repoDir, "b.txt"), "bbb");
    await run(["git", "add", "."], repoDir);

    await git.unstage(repoDir, "a.txt");
    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(1);
    expect(status.stagedFiles[0].path).toBe("b.txt");
    expect(status.unstagedFiles).toHaveLength(1);
    expect(status.unstagedFiles[0].path).toBe("a.txt");
});

it("unstages all files", async () => {
    await writeFile(join(repoDir, "a.txt"), "aaa");
    await writeFile(join(repoDir, "b.txt"), "bbb");
    await run(["git", "add", "."], repoDir);

    await git.unstage(repoDir);
    const status = await git.status(repoDir);
    expect(status.stagedFiles).toHaveLength(0);
    expect(status.unstagedFiles).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: FAIL — `git.stage` and `git.unstage` don't exist.

- [ ] **Step 3: Implement `stage()` and `unstage()`**

Add to `GitService` class, after `revertFile()`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/git-service.ts packages/backend/tests/services/git-service.test.ts
git commit -m "feat: add stage() and unstage() methods to GitService"
```

### Task 7: Update `commit()` and `generateCommitMessage()`

**Files:**
- Modify: `packages/backend/src/services/git-service.ts`

- [ ] **Step 1: Update `commit()` to accept `includeUnstaged`**

Replace `commit()` (lines 217-229):

```ts
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
```

- [ ] **Step 2: Update `generateCommitMessage()` to accept `includeUnstaged`**

Replace `generateCommitMessage()` (lines 252-286):

```ts
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
```

- [ ] **Step 3: Remove the old `parseStatus()` method if no longer used**

The old `parseStatus(xy: string)` method (lines 81-87) parsed the combined XY string. Since we now use `parseStatusChar()` which handles single characters, remove `parseStatus()` if nothing else references it.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/git-service.ts
git commit -m "feat: update commit() and generateCommitMessage() for staging support"
```

### Task 8: Register new WebSocket handlers

**Files:**
- Modify: `packages/backend/src/handlers/git.ts`

- [ ] **Step 1: Update imports to include new payload types**

Add `GitStagePayload`, `GitUnstagePayload`, and `GitGenerateCommitMsgPayload` to the import from `@taskflow/shared`:

```ts
import type {
    GitStatusPayload,
    GitDiffPayload,
    GitDiffFilePayload,
    GitRevertFilePayload,
    GitWorktreeCreatePayload,
    GitCommitPayload,
    GitPushPayload,
    GitCreatePrPayload,
    GitStagePayload,
    GitUnstagePayload,
    GitGenerateCommitMsgPayload,
} from "@taskflow/shared";
```

- [ ] **Step 2: Register `GIT_STAGE` handler**

Add after the `GIT_REVERT_FILE` handler (after line 63):

```ts
router.register(MSG.GIT_STAGE, async (payload) => {
    const { repoPath: rawRepoPath, filePath } = payload as GitStagePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    if (filePath) assertRepoFilePath(repoPath, filePath);
    await git.stage(repoPath, filePath);
    return { success: true };
});
```

- [ ] **Step 3: Register `GIT_UNSTAGE` handler**

Add immediately after the stage handler:

```ts
router.register(MSG.GIT_UNSTAGE, async (payload) => {
    const { repoPath: rawRepoPath, filePath } = payload as GitUnstagePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    if (filePath) assertRepoFilePath(repoPath, filePath);
    await git.unstage(repoPath, filePath);
    return { success: true };
});
```

- [ ] **Step 4: Update `GIT_DIFF_FILE` handler return value**

The handler (line 42-47) currently returns `{ diff: string }`. Update it to pass through the object:

```ts
router.register(MSG.GIT_DIFF_FILE, async (payload) => {
    const { repoPath: rawRepoPath, filePath } = payload as GitDiffFilePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    assertRepoFilePath(repoPath, filePath);
    return await git.diffFile(repoPath, filePath);
});
```

- [ ] **Step 5: Update `GIT_COMMIT` handler to pass `includeUnstaged`**

Update the handler (line 80-84):

```ts
router.register(MSG.GIT_COMMIT, async (payload) => {
    const { path, message, push, includeUnstaged } = payload as GitCommitPayload;
    const repoPath = await assertWorkspaceRepo(taskStore, path);
    return await git.commit(repoPath, message, push, includeUnstaged ?? true);
});
```

- [ ] **Step 6: Update `GIT_GENERATE_COMMIT_MSG` handler**

Update the handler (line 86-91):

```ts
router.register(MSG.GIT_GENERATE_COMMIT_MSG, async (payload) => {
    const { path, includeUnstaged } = payload as GitGenerateCommitMsgPayload;
    const repoPath = await assertWorkspaceRepo(taskStore, path);
    const message = await git.generateCommitMessage(repoPath, includeUnstaged ?? true);
    return { message };
});
```

- [ ] **Step 7: Verify the backend builds**

Run: `cd packages/backend && bun run build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/handlers/git.ts
git commit -m "feat: register stage/unstage handlers and update existing git handlers"
```

---

## Chunk 3: Frontend Changes

### Task 9: Update diff store for staging

**Files:**
- Modify: `packages/ui/src/stores/diff-store.ts`

- [ ] **Step 1: Update the `commitDisabled` logic to use new status shape**

In `fetchDiff()` (line 64-68), replace:

```ts
commitDisabled = status.files.length === 0 && status.ahead === 0;
```

with:

```ts
commitDisabled = status.stagedFiles.length === 0 && status.unstagedFiles.length === 0 && status.ahead === 0;
```

- [ ] **Step 2: Verify it builds**

Run: `cd packages/ui && bun run build`
Expected: Build may have other errors in components that still reference old types — that's fine, we'll fix those next.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/diff-store.ts
git commit -m "feat: update diff store commitDisabled for staged/unstaged status shape"
```

### Task 10: Update ChangesPane with staged/unstaged sections

**Files:**
- Modify: `packages/ui/src/components/panes/ChangesPane.tsx`

- [ ] **Step 1: Add staging-related imports**

Add `Plus, Minus, ChevronDown, ChevronRight` to the lucide-react import (line 10):

```ts
import { Undo2, Plus, Minus, ChevronDown, ChevronRight } from "lucide-react";
```

- [ ] **Step 2: Update `FileStatusRow` to accept staging action props**

Replace the `FileStatusRowProps` interface and component (lines 56-109). The row now shows either a stage (+) or unstage (-) button depending on the section, and the revert button only appears for unstaged files:

```tsx
interface FileStatusRowProps {
    file: GitFileStatus;
    isSelected: boolean;
    onSelect: (path: string) => void;
    onRevert?: (file: GitFileStatus) => void;
    onStageToggle?: (file: GitFileStatus) => void;
    staged: boolean;
}

function FileStatusRow({ file, isSelected, onSelect, onRevert, onStageToggle, staged }: FileStatusRowProps) {
    const rowClasses = useMemo(
        () =>
            cn(
                "flex justify-between items-center px-1 py-0.5 cursor-pointer rounded-md text-sm group",
                isSelected && "bg-muted",
            ),
        [isSelected],
    );

    const badgeClasses = useMemo(
        () =>
            cn(
                "text-xs px-1 py-0 font-mono",
                file.status === "deleted" && "text-destructive border-destructive/30",
            ),
        [file.status],
    );

    return (
        <div onClick={() => onSelect(file.path)} className={rowClasses}>
            <span className="flex items-center gap-1.5 min-w-0">
                <Badge
                    variant="outline"
                    colorScheme={gitStatusToColorScheme(file.status)}
                    className={badgeClasses}
                >
                    {statusPrefix(file.status)}
                </Badge>
                <span className="text-secondary-foreground truncate">{displayPath(file)}</span>
            </span>
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {!staged && onRevert && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive h-5 w-5"
                        aria-label="Revert change"
                        tooltip="Revert change"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRevert(file);
                        }}
                    >
                        <Undo2 className="h-3 w-3" />
                    </Button>
                )}
                {onStageToggle && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-5 w-5"
                        aria-label={staged ? "Unstage file" : "Stage file"}
                        tooltip={staged ? "Unstage file" : "Stage file"}
                        onClick={(e) => {
                            e.stopPropagation();
                            onStageToggle(file);
                        }}
                    >
                        {staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    </Button>
                )}
            </span>
        </div>
    );
}
```

- [ ] **Step 3: Add a collapsible section header component**

Add before `ChangesPane`:

```tsx
interface SectionHeaderProps {
    label: string;
    count: number;
    collapsed: boolean;
    onToggle: () => void;
    action?: { label: string; onClick: () => void };
}

function SectionHeader({ label, count, collapsed, onToggle, action }: SectionHeaderProps) {
    return (
        <div className="flex items-center justify-between py-1 px-1">
            <button
                onClick={onToggle}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
                {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {label} ({count})
            </button>
            {action && count > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-xs px-1.5"
                    onClick={action.onClick}
                >
                    {action.label}
                </Button>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Rewrite `ChangesPane` state and handlers**

Replace the `ChangesPane` component (lines 116-259) with the updated version. Key changes:
- State: replace `diff: string | null` with `diff: { staged?: string; unstaged?: string } | null`
- Add `stagedCollapsed` and `unstagedCollapsed` state
- Add `stageFile`, `unstageFile`, `stageAll`, `unstageAll` handlers
- Update `showDiff` to expect the new `GitDiffFileResponse` shape
- Update `revertFile` to only work on unstaged files

```tsx
function ChangesPane({ repoPath, className }: ChangesPaneProps) {
    const [status, setStatus] = useState<GitStatusResult | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [diff, setDiff] = useState<{ staged?: string; unstaged?: string } | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [stagedCollapsed, setStagedCollapsed] = useState(false);
    const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);
    const repoVersionRef = useRef(0);
    const diffRequestIdRef = useRef(0);

    const containerClasses = useMemo(
        () => cn("flex-1 flex flex-col overflow-hidden", className),
        [className],
    );

    const fetchStatus = useCallback(
        async (repoVersion = repoVersionRef.current) => {
            try {
                const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, {
                    path: repoPath,
                });
                if (repoVersion !== repoVersionRef.current) return;
                setStatus(status);
            } catch (err: unknown) {
                if (repoVersion !== repoVersionRef.current) return;
                console.error("Failed to fetch git status:", err);
            }
        },
        [repoPath],
    );

    useEffect(() => {
        const repoVersion = ++repoVersionRef.current;
        diffRequestIdRef.current += 1;
        setSelectedFile(null);
        setDiff(null);
        setDiffLoading(false);
        void fetchStatus(repoVersion);
    }, [repoPath, fetchStatus]);

    async function showDiff(filePath: string) {
        const repoVersion = repoVersionRef.current;
        const requestId = ++diffRequestIdRef.current;
        setSelectedFile(filePath);
        setDiff(null);
        setDiffLoading(true);
        try {
            const result = await sendRequest<{ staged?: string; unstaged?: string }>(MSG.GIT_DIFF_FILE, {
                repoPath,
                filePath,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            setDiff(result);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            console.error("Failed to fetch diff:", err);
            setDiff(null);
        } finally {
            if (repoVersion === repoVersionRef.current && requestId === diffRequestIdRef.current) {
                setDiffLoading(false);
            }
        }
    }

    async function stageFile(file: GitFileStatus) {
        try {
            await sendRequest(MSG.GIT_STAGE, { repoPath, filePath: file.path });
            await fetchStatus();
            if (selectedFile === file.path) void showDiff(file.path);
        } catch (err) {
            console.error("Failed to stage file:", err);
        }
    }

    async function unstageFile(file: GitFileStatus) {
        try {
            await sendRequest(MSG.GIT_UNSTAGE, { repoPath, filePath: file.path });
            await fetchStatus();
            if (selectedFile === file.path) void showDiff(file.path);
        } catch (err) {
            console.error("Failed to unstage file:", err);
        }
    }

    async function stageAll() {
        try {
            await sendRequest(MSG.GIT_STAGE, { repoPath });
            await fetchStatus();
            if (selectedFile) void showDiff(selectedFile);
        } catch (err) {
            console.error("Failed to stage all files:", err);
        }
    }

    async function unstageAll() {
        try {
            await sendRequest(MSG.GIT_UNSTAGE, { repoPath });
            await fetchStatus();
            if (selectedFile) void showDiff(selectedFile);
        } catch (err) {
            console.error("Failed to unstage all files:", err);
        }
    }

    async function revertFile(file: GitFileStatus) {
        const repoVersion = repoVersionRef.current;
        await confirm({
            title: "Revert File",
            description: `Revert all changes to ${file.path}? This cannot be undone.`,
            confirmLabel: "Revert",
            variant: "destructive",
            onConfirm: async () => {
                await sendRequest(MSG.GIT_REVERT_FILE, {
                    repoPath,
                    filePath: file.path,
                    status: file.status,
                    previousPath: file.previousPath,
                });
                await fetchStatus(repoVersion);
                if (repoVersion !== repoVersionRef.current) return;
                if (selectedFile === file.path) {
                    setSelectedFile(null);
                    setDiff(null);
                    setDiffLoading(false);
                }
            },
        });
    }

    const hasNoChanges = status && status.stagedFiles.length === 0 && status.unstagedFiles.length === 0;

    return (
        <div className={containerClasses}>
            {/* File list */}
            <ScrollArea className="border-border max-h-[40%] border-b p-3">
                {status?.branch && (
                    <div className="mb-1.5">
                        <Badge variant="outline" className="text-xs">
                            {status.branch}
                        </Badge>
                    </div>
                )}
                {hasNoChanges && (
                    <div className="text-muted-foreground text-sm">No changes</div>
                )}

                {status && status.stagedFiles.length > 0 && (
                    <>
                        <SectionHeader
                            label="Staged Changes"
                            count={status.stagedFiles.length}
                            collapsed={stagedCollapsed}
                            onToggle={() => setStagedCollapsed((v) => !v)}
                            action={{ label: "Unstage All", onClick: () => void unstageAll() }}
                        />
                        {!stagedCollapsed &&
                            status.stagedFiles.map((file) => (
                                <FileStatusRow
                                    key={`staged-${file.path}`}
                                    file={file}
                                    staged
                                    isSelected={file.path === selectedFile}
                                    onSelect={showDiff}
                                    onStageToggle={unstageFile}
                                />
                            ))}
                    </>
                )}

                {status && status.unstagedFiles.length > 0 && (
                    <>
                        <SectionHeader
                            label="Unstaged Changes"
                            count={status.unstagedFiles.length}
                            collapsed={unstagedCollapsed}
                            onToggle={() => setUnstagedCollapsed((v) => !v)}
                            action={{ label: "Stage All", onClick: () => void stageAll() }}
                        />
                        {!unstagedCollapsed &&
                            status.unstagedFiles.map((file) => (
                                <FileStatusRow
                                    key={`unstaged-${file.path}`}
                                    file={file}
                                    staged={false}
                                    isSelected={file.path === selectedFile}
                                    onSelect={showDiff}
                                    onRevert={revertFile}
                                    onStageToggle={stageFile}
                                />
                            ))}
                    </>
                )}
            </ScrollArea>

            {/* Diff view */}
            <ScrollArea className="flex-1 p-3">
                {diffLoading ? (
                    <div className="text-muted-foreground text-sm">Loading diff...</div>
                ) : diff && (diff.staged || diff.unstaged) ? (
                    <pre className="m-0">
                        {diff.staged && (
                            <>
                                <div className="text-xs font-semibold text-accent mb-1 px-1 py-0.5 bg-accent/10 rounded">
                                    Staged Changes
                                </div>
                                {diff.staged.split("\n").map((line, i) => (
                                    <div
                                        key={`staged-${i}`}
                                        className={diffLineVariants({ type: getDiffLineType(line) })}
                                    >
                                        {line}
                                    </div>
                                ))}
                            </>
                        )}
                        {diff.staged && diff.unstaged && (
                            <div className="border-t border-border my-2" />
                        )}
                        {diff.unstaged && (
                            <>
                                <div className="text-xs font-semibold text-muted-foreground mb-1 px-1 py-0.5 bg-muted rounded">
                                    Unstaged Changes
                                </div>
                                {diff.unstaged.split("\n").map((line, i) => (
                                    <div
                                        key={`unstaged-${i}`}
                                        className={diffLineVariants({ type: getDiffLineType(line) })}
                                    >
                                        {line}
                                    </div>
                                ))}
                            </>
                        )}
                    </pre>
                ) : selectedFile ? (
                    <div className="text-muted-foreground text-sm">
                        No textual diff available for this file
                    </div>
                ) : (
                    <div className="text-muted-foreground text-sm">
                        Click a file to see its diff
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
```

- [ ] **Step 5: Verify the UI builds**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds (or only commit dialog errors remain — we fix that next).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/panes/ChangesPane.tsx
git commit -m "feat: add staged/unstaged sections with stage/unstage controls to ChangesPane"
```

### Task 11: Update CommitDialog with "Include unstaged" toggle

**Files:**
- Modify: `packages/ui/src/components/workspace/CommitDialog.tsx`

- [ ] **Step 1: Add `includeUnstaged` state**

Add after the existing state declarations (line 33):

```ts
const [includeUnstaged, setIncludeUnstaged] = useState(true);
```

- [ ] **Step 2: Update `resetForm` to reset `includeUnstaged`**

Add `setIncludeUnstaged(true);` to the `resetForm` callback (after line 44).

- [ ] **Step 3: Update `hasChanges` check to use new status shape**

In the `useEffect` (lines 57-68), replace:

```ts
const changed = res.status.files.length > 0;
```

with:

```ts
const changed = res.status.stagedFiles.length > 0 || res.status.unstagedFiles.length > 0;
```

- [ ] **Step 4: Add `hasStagedChanges` tracking**

Add another state variable:

```ts
const [hasStagedChanges, setHasStagedChanges] = useState(false);
```

Update the `useEffect` to also track staged changes:

```ts
setHasStagedChanges(res.status.stagedFiles.length > 0);
```

Add `setHasStagedChanges(false)` to `resetForm`.

- [ ] **Step 5: Update agent mode prompt**

In `handleSubmit`, update the agent prompt (line 102):

```ts
const parts: string[] = [
    includeUnstaged
        ? "Create commits for all changes, staged and unstaged."
        : "Create commits for staged changes only.",
];
```

- [ ] **Step 6: Update direct commit to pass `includeUnstaged`**

In `handleSubmit`, update the `GIT_COMMIT` call (lines 133-136):

```ts
const commitResult = await sendRequest<{ hash: string; message: string }>(
    MSG.GIT_COMMIT,
    { path: repoPath, message: commitMessage, push, includeUnstaged },
);
```

- [ ] **Step 7: Update `GIT_GENERATE_COMMIT_MSG` call to pass `includeUnstaged`**

In `handleSubmit`, update the auto-generate call (lines 127-130):

```ts
const result = await sendRequest<{ message: string }>(MSG.GIT_GENERATE_COMMIT_MSG, {
    path: repoPath,
    includeUnstaged,
});
```

- [ ] **Step 8: Add the "Include unstaged changes" toggle to the dialog UI**

Add after the "Use agent" switch block (after line 205), inside the same `flex flex-col gap-2` div:

```tsx
<div className="flex items-center gap-2">
    <Switch
        id="commit-include-unstaged"
        checked={includeUnstaged}
        onCheckedChange={setIncludeUnstaged}
    />
    <Label
        htmlFor="commit-include-unstaged"
        className="cursor-pointer tracking-normal normal-case"
    >
        Include unstaged changes
    </Label>
</div>
```

- [ ] **Step 9: Disable commit button when `!includeUnstaged && !hasStagedChanges`**

Update the submit button. Add a `commitDisabled` computed value before the return:

```ts
const commitButtonDisabled = !pushOnly && !includeUnstaged && !hasStagedChanges;
```

Update the Button:

```tsx
<Button
    onClick={() => void handleSubmit()}
    loading={loading || hasChanges === null}
    disabled={commitButtonDisabled}
    tooltip={commitButtonDisabled ? "No staged changes to commit" : undefined}
    className="bg-accent text-accent-foreground hover:bg-accent/90"
>
    {submitLabel}
</Button>
```

- [ ] **Step 10: Add `includeUnstaged` to `handleSubmit` dependency array**

Update the `useCallback` deps (line 151) to include `includeUnstaged`.

- [ ] **Step 11: Verify the UI builds**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds.

- [ ] **Step 12: Commit**

```bash
git add packages/ui/src/components/workspace/CommitDialog.tsx
git commit -m "feat: add 'Include unstaged changes' toggle to CommitDialog"
```

### Task 12: Update FileExplorer git status usage

**Files:**
- Modify: `packages/ui/src/components/panels/FileExplorer.tsx`

- [ ] **Step 1: Update `gitFiles` memo to merge staged and unstaged arrays**

In `FileExplorer.tsx` (around line 69-78), the `gitFiles` memo accesses `gitStatus?.files.forEach(...)`. Replace it with a merge of both arrays. Use a Map keyed by path — if a file appears in both staged and unstaged, the unstaged status takes visual precedence (it represents the working tree state):

```tsx
const gitFiles = useMemo(() => {
    const map = new Map<string, string>();
    if (!workingDir || gitStatusPath !== workingDir) return map;
    // Staged first, then unstaged overwrites — unstaged reflects working tree
    gitStatus?.stagedFiles.forEach((f) => {
        const absolutePath =
            f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
        map.set(absolutePath, f.status);
    });
    gitStatus?.unstagedFiles.forEach((f) => {
        const absolutePath =
            f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
        map.set(absolutePath, f.status);
    });
    return map;
}, [gitStatus, gitStatusPath, workingDir]);
```

- [ ] **Step 2: Verify the UI builds**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/FileExplorer.tsx
git commit -m "fix: update FileExplorer to use stagedFiles/unstagedFiles from new git status shape"
```

### Task 13: Final build verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Build the entire project**

Run: `bun run build` (from project root)
Expected: Full build succeeds with no type errors.

- [ ] **Step 2: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All tests pass.

- [ ] **Step 3: Check for any remaining references to old `status.files` pattern**

Search the codebase for `status.files` or `.files.length` patterns that may have been missed. Check:
- `packages/ui/src/stores/diff-store.ts`
- `packages/ui/src/components/workspace/CommitDialog.tsx`
- `packages/ui/src/components/panes/ChangesPane.tsx`

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: resolve any remaining type errors from staging refactor"
```

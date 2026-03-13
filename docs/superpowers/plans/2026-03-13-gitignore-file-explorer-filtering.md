# Gitignore File Explorer Filtering — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the expensive `git ls-files` subprocess (21K+ paths, ~1.7MB per poll) with lightweight `.gitignore` pattern strings, parsed client-side via the `ignore` npm package.

**Architecture:** Backend reads `.gitignore` at tree-build time and returns raw patterns alongside the file tree. UI creates an `ignore` matcher from patterns and tests tree nodes against it to build the `ignoredFiles` set. The `ignoredPaths` field is removed from `GitStatusResult` entirely.

**Tech Stack:** `ignore` npm package (gitignore pattern matching), Bun filesystem APIs, Zustand store

**Spec:** `docs/superpowers/specs/2026-03-13-gitignore-file-explorer-filtering.md`

---

## Chunk 1: Backend + Shared Types

### Task 1: Install `ignore` dependency

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Install the `ignore` package**

```bash
cd packages/ui && bun add ignore
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/package.json bun.lock
git commit -m "deps: add ignore package to ui for gitignore pattern matching"
```

---

### Task 2: Update shared types

**Files:**
- Modify: `packages/shared/src/types/ws.ts:190-192`
- Modify: `packages/shared/src/types/git.ts:8-13`

- [ ] **Step 1: Add `gitignorePatterns` to `FileTreeResponse`**

In `packages/shared/src/types/ws.ts`, update `FileTreeResponse`:

```typescript
export interface FileTreeResponse {
    tree: FileNode;
    gitignorePatterns: string[];
}
```

- [ ] **Step 2: Remove `ignoredPaths` from `GitStatusResult`**

In `packages/shared/src/types/git.ts`, update `GitStatusResult`:

```typescript
export interface GitStatusResult {
    branch: string | null;
    files: GitFileStatus[];
    ahead: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/ws.ts packages/shared/src/types/git.ts
git commit -m "types: add gitignorePatterns to FileTreeResponse, remove ignoredPaths from GitStatusResult"
```

---

### Task 3: Update `FileWatcher.buildTree()` to read `.gitignore`

**Files:**
- Modify: `packages/backend/src/services/file-watcher.ts:1-2,22-49`

- [ ] **Step 1: Add readFile import and define return type**

At the top of `packages/backend/src/services/file-watcher.ts`, add `readFile` to the existing import:

```typescript
import { readdir, stat, readFile } from "fs/promises";
```

Add a result interface after the existing interfaces (after `PollingWatcher`):

```typescript
interface BuildTreeResult {
    tree: FileNode;
    gitignorePatterns: string[];
}
```

- [ ] **Step 2: Update `buildTree()` method**

Change the method signature and add `.gitignore` reading at depth 0:

```typescript
async buildTree(dirPath: string, depth = 0): Promise<BuildTreeResult> {
    const name = basename(dirPath);
    const children: FileNode[] = [];
    const node: FileNode = { name, path: dirPath, type: "directory", children };

    let gitignorePatterns: string[] = [];

    if (depth > 10) return { tree: node, gitignorePatterns };

    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (IGNORED.has(entry.name)) continue;

            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const { tree: childTree } = await this.buildTree(fullPath, depth + 1);
                children.push(childTree);
            } else {
                children.push({ name: entry.name, path: fullPath, type: "file" });
            }
        }
        children.sort((a, b) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    } catch {
        /* permission denied */
    }

    if (depth === 0) {
        try {
            const content = await readFile(join(dirPath, ".gitignore"), "utf-8");
            gitignorePatterns = content.split("\n");
        } catch {
            // No .gitignore — return empty patterns
        }
    }

    return { tree: node, gitignorePatterns };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/file-watcher.ts
git commit -m "feat: read .gitignore patterns in buildTree at depth 0"
```

---

### Task 4: Update file handler and remove `ignoredPaths` from git service

**Files:**
- Modify: `packages/backend/src/handlers/file.ts:29-34`
- Modify: `packages/backend/src/services/git-service.ts:78-90,92`

- [ ] **Step 1: Update `FILE_TREE` handler**

In `packages/backend/src/handlers/file.ts`, update the handler to destructure the new return shape:

```typescript
router.register(MSG.FILE_TREE, async (payload) => {
    const { path } = payload as FileTreePayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    const { tree, gitignorePatterns } = await fileWatcher.buildTree(workspacePath);
    return { tree, gitignorePatterns };
});
```

- [ ] **Step 2: Remove `ignoredPaths` from git service `status()`**

In `packages/backend/src/services/git-service.ts`, remove lines 78-90 (the `ignoredPaths` variable and the `git ls-files` try/catch block). Then update line 92 (the return statement) to remove `ignoredPaths`:

```typescript
return { branch: branchOutput.trim() || null, files, ahead };
```

Remove:
```typescript
let ignoredPaths: string[] = [];
try {
    const ignoredOutput = await git(
        ["ls-files", "--others", "--ignored", "--exclude-standard"],
        repoPath,
    );
    ignoredPaths = ignoredOutput
        .split("\n")
        .filter((line) => line.length > 0)
        .map((relativePath) => join(repoPath, relativePath));
} catch {
    // Non-git repo or other error — treat as no ignored files
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/file.ts packages/backend/src/services/git-service.ts
git commit -m "feat: return gitignore patterns from file tree handler, remove ignoredPaths from git status"
```

---

## Chunk 2: UI Changes

### Task 5: Update `file-store.ts` to store gitignore patterns

**Files:**
- Modify: `packages/ui/src/stores/file-store.ts:6-26,33-53,93-103`

- [ ] **Step 1: Add `gitignorePatterns` to store state and interface**

Add `gitignorePatterns: string[]` to the `FileStore` interface (after `treePath`):

```typescript
interface FileStore {
    tree: FileNode | null;
    treePath: string | null;
    gitignorePatterns: string[];
    gitStatus: GitStatusResult | null;
    // ... rest unchanged
}
```

Add the initial value in the store creation (after `treePath: null`):

```typescript
gitignorePatterns: [],
```

- [ ] **Step 2: Update `fetchTree()` to extract and store patterns**

First, add `FileTreeResponse` to the type import at the top of the file:

```typescript
import type { FileNode, GitStatusResult, FileChangeEvent, FileTreeResponse } from "@taskflow/shared";
```

Then update `fetchTree()` to use `FileTreeResponse` and store patterns:

```typescript
async fetchTree(path) {
    const requestId = ++treeRequestId;
    set((state) => ({
        loading: true,
        tree: state.treePath === path ? state.tree : null,
        treePath: state.treePath === path ? state.treePath : null,
        gitignorePatterns: state.treePath === path ? state.gitignorePatterns : [],
    }));
    const { tree, gitignorePatterns } = await sendRequest<FileTreeResponse>(MSG.FILE_TREE, { path });
    if (requestId !== treeRequestId) return;
    set({ tree, treePath: path, gitignorePatterns, loading: false });
},
```

- [ ] **Step 3: Reset `gitignorePatterns` in `clearExplorerState()`**

Update `clearExplorerState()` to include `gitignorePatterns`:

```typescript
clearExplorerState() {
    treeRequestId += 1;
    gitStatusRequestId += 1;
    set({
        tree: null,
        treePath: null,
        gitignorePatterns: [],
        gitStatus: null,
        gitStatusPath: null,
        loading: false,
    });
},
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/file-store.ts
git commit -m "feat: store gitignorePatterns from tree response in file store"
```

---

### Task 6: Update `FileExplorer.tsx` to use `ignore` matcher

**Files:**
- Modify: `packages/ui/src/components/panels/FileExplorer.tsx:1,11-21,77-82`

- [ ] **Step 1: Add imports and update store destructuring**

Add these imports at the top of `FileExplorer.tsx`:

```typescript
import type { FileNode } from "@taskflow/shared";
import ignore from "ignore";
```

Update the destructured store values to include `gitignorePatterns` instead of pulling `ignoredPaths` from `gitStatus`:

```typescript
const {
    tree,
    treePath,
    gitStatus,
    gitStatusPath,
    gitignorePatterns,
    fetchTree,
    fetchGitStatus,
    watchPath,
    unwatchPath,
    clearExplorerState,
} = useFileStore();
```

Replace the existing `ignoredFiles` useMemo (lines 77-82) with:

```typescript
const ignoredFiles = useMemo(() => {
    if (!workingDir || !tree || treePath !== workingDir || gitignorePatterns.length === 0) {
        return new Set<string>();
    }

    const ig = ignore().add(gitignorePatterns);
    const result = new Set<string>();
    const prefix = workingDir + "/";

    function walk(node: FileNode) {
        if (node.path !== workingDir) {
            const relative = node.path.startsWith(prefix)
                ? node.path.slice(prefix.length)
                : null;
            if (relative && ig.ignores(relative)) {
                result.add(node.path);
                return; // children of ignored dirs are implicitly ignored
            }
        }
        if (node.children) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }

    walk(tree);
    return result;
}, [workingDir, tree, treePath, gitignorePatterns]);
```

- [ ] **Step 2: Replace the `ignoredFiles` useMemo**

Replace the existing `ignoredFiles` useMemo (lines 77-82) with the `walk`-based version shown above.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/FileExplorer.tsx
git commit -m "feat: use ignore package for gitignore pattern matching in file explorer"
```

---

### Task 7: Verify and clean up

- [ ] **Step 1: Type-check the project**

```bash
cd /Users/kuindji/Projects/taskflow && bun run --filter '*' typecheck
```

If the project doesn't have a `typecheck` script, run:

```bash
bunx tsc --noEmit -p packages/shared/tsconfig.json && bunx tsc --noEmit -p packages/backend/tsconfig.json && bunx tsc --noEmit -p packages/ui/tsconfig.json
```

Fix any type errors. Common issues:
- Other files referencing `gitStatus.ignoredPaths` — search for `ignoredPaths` across the codebase and remove any remaining references.

- [ ] **Step 2: Verify `ignoredPaths` is fully removed**

Search for any remaining references:

```bash
grep -r "ignoredPaths" packages/ --include="*.ts" --include="*.tsx"
```

Expected: zero results.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve type errors from ignoredPaths removal"
```

Only run this step if there were fixes needed.

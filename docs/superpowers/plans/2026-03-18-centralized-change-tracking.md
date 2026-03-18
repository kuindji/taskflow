# Centralized Change Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI-driven per-file git diff polling with a centralized backend `ChangeTracker` service that uses batched `git diff --numstat` commands and broadcasts stats only when they change.

**Architecture:** A new `ChangeTracker` backend service polls each tracked path (projects + worktree tasks) sequentially using 3-4 lightweight git commands, sums stats, and broadcasts `CHANGE_STATS` events via WebSocket. The UI `diff-store` becomes a passive listener. The existing `GIT_DIFF` / `GIT_STATUS` handlers remain for the ChangesPane on-demand use.

**Tech Stack:** Bun (backend), Zustand (UI store), WebSocket (transport)

---

### Task 1: Add shared types and message constant

**Files:**
- Modify: `packages/shared/src/constants.ts:57-69` (add to Git section)
- Modify: `packages/shared/src/types/git.ts`
- Modify: `packages/shared/src/types/ws.ts` (add event type)

- [ ] **Step 1: Add `CHANGE_STATS` to MSG constant**

In `packages/shared/src/constants.ts`, add after `GIT_CHECK_PR` (line 69):

```typescript
    GIT_CHANGE_STATS: "git:change-stats",
```

- [ ] **Step 2: Add `ChangeStats` interface**

In `packages/shared/src/types/git.ts`, add after `GitDiffFile`:

```typescript
export interface ChangeStats {
    additions: number;
    deletions: number;
    fileCount: number;
    branch: string | null;
    ahead: number;
    hasChanges: boolean;
    diffDisabled: boolean;
    commitDisabled: boolean;
}
```

- [ ] **Step 3: Add WebSocket event payload type**

In `packages/shared/src/types/ws.ts`, add in the Git messages section (after `GitCheckPrPayload`):

```typescript
export interface ChangeStatsEvent {
    targetId: string;
    stats: ChangeStats | null;
}
```

Import `ChangeStats` from `./git` at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/git.ts packages/shared/src/types/ws.ts
git commit -m "feat: add ChangeStats type and GIT_CHANGE_STATS message constant"
```

---

### Task 2: Add `numstat` methods to GitService

**Files:**
- Modify: `packages/backend/src/services/git-service.ts:5-25` (git helper and new methods)

- [ ] **Step 1: Add `--no-optional-locks` to the `git()` helper**

In `packages/backend/src/services/git-service.ts`, modify the `git()` function (line 5-16) to always prepend `--no-optional-locks`:

```typescript
async function git(
    args: string[],
    cwd: string,
    options: { allowExitCodes?: number[] } = {},
): Promise<string> {
    const proc = Bun.spawn(["git", "--no-optional-locks", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    // ... rest unchanged
}
```

- [ ] **Step 2: Add `numstat` method to GitService**

Add after the `getBranch` method (after line 35):

```typescript
interface NumstatEntry {
    path: string;
    additions: number;
    deletions: number;
}

async numstat(repoPath: string, cached = false): Promise<NumstatEntry[]> {
    const args = cached
        ? ["diff", "--cached", "--numstat"]
        : ["diff", "--numstat"];
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
```

Note: The `NumstatEntry` interface should be defined at module level (above the class), not exported.

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/git-service.ts
git commit -m "feat: add numstat method and --no-optional-locks to GitService"
```

---

### Task 3: Create `ChangeTracker` service

**Files:**
- Create: `packages/backend/src/services/change-tracker.ts`

This is the core service. It depends on `GitService` for git commands and receives a `broadcast` function and a `FileWatcher` reference.

- [ ] **Step 1: Create the ChangeTracker service**

Create `packages/backend/src/services/change-tracker.ts`:

```typescript
import type { ChangeStats, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { GitService } from "./git-service";
import { stat, readFile } from "fs/promises";
import { join } from "path";

const POLL_INTERVAL_NORMAL = 3_000;
const POLL_INTERVAL_LARGE = 10_000;
const LARGE_CHANGESET_THRESHOLD = 200;
const MAX_UNTRACKED_FILE_SIZE = 1_048_576; // 1MB
const FILE_CHANGE_DEBOUNCE = 300;

interface TrackedTarget {
    id: string;
    path: string;
    stats: ChangeStats | null;
    invalidated: boolean;
    polling: boolean;
}

function statsEqual(a: ChangeStats | null, b: ChangeStats | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return (
        a.additions === b.additions &&
        a.deletions === b.deletions &&
        a.fileCount === b.fileCount &&
        a.ahead === b.ahead &&
        a.hasChanges === b.hasChanges &&
        a.branch === b.branch &&
        a.diffDisabled === b.diffDisabled &&
        a.commitDisabled === b.commitDisabled
    );
}

export class ChangeTracker {
    private targets = new Map<string, TrackedTarget>();
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private polling = false;
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private git: GitService,
        private broadcast: (event: WsEvent) => void,
    ) {}

    track(id: string, path: string): void {
        if (this.targets.has(id)) return;
        this.targets.set(id, { id, path, stats: null, invalidated: true, polling: false });
        if (!this.pollTimer) this.startPolling();
    }

    untrack(id: string): void {
        const target = this.targets.get(id);
        if (!target) return;
        this.targets.delete(id);
        const timer = this.debounceTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(id);
        }
        this.broadcast({
            type: MSG.GIT_CHANGE_STATS,
            payload: { targetId: id, stats: null },
        });
        if (this.targets.size === 0) this.stopPolling();
    }

    invalidate(path: string): void {
        for (const target of this.targets.values()) {
            if (target.path === path || path.startsWith(target.path + "/")) {
                target.invalidated = true;
                void this.pollTarget(target);
                return;
            }
        }
    }

    /** Called when a file changes in a watched directory */
    onFileChanged(filePath: string): void {
        for (const target of this.targets.values()) {
            if (
                filePath === target.path ||
                filePath.startsWith(target.path + "/")
            ) {
                const existing = this.debounceTimers.get(target.id);
                if (existing) clearTimeout(existing);
                this.debounceTimers.set(
                    target.id,
                    setTimeout(() => {
                        this.debounceTimers.delete(target.id);
                        void this.pollTarget(target);
                    }, FILE_CHANGE_DEBOUNCE),
                );
                return;
            }
        }
    }

    /** Send current cached stats for all targets to a newly connected client */
    sendCurrentStats(): void {
        for (const target of this.targets.values()) {
            this.broadcast({
                type: MSG.GIT_CHANGE_STATS,
                payload: { targetId: target.id, stats: target.stats },
            });
        }
    }

    private startPolling(): void {
        if (this.pollTimer) return;
        this.schedulePoll();
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    private schedulePoll(): void {
        const interval = this.getCurrentInterval();
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollAll().finally(() => {
                if (this.targets.size > 0) this.schedulePoll();
            });
        }, interval);
    }

    private getCurrentInterval(): number {
        let totalFiles = 0;
        for (const target of this.targets.values()) {
            if (target.stats) totalFiles += target.stats.fileCount;
        }
        return totalFiles >= LARGE_CHANGESET_THRESHOLD
            ? POLL_INTERVAL_LARGE
            : POLL_INTERVAL_NORMAL;
    }

    private async pollAll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            for (const target of this.targets.values()) {
                await this.pollTarget(target);
            }
        } finally {
            this.polling = false;
        }
    }

    private async pollTarget(target: TrackedTarget): Promise<void> {
        if (target.polling) return; // prevent concurrent polls on same target
        target.polling = true;
        try {
            const stats = await this.computeStats(target.path);
            target.invalidated = false;
            if (!statsEqual(target.stats, stats)) {
                target.stats = stats;
                this.broadcast({
                    type: MSG.GIT_CHANGE_STATS,
                    payload: { targetId: target.id, stats },
                });
            }
        } catch {
            // Git command failed (repo not ready, etc.) — skip this cycle
        } finally {
            target.polling = false;
        }
    }

    private async computeStats(repoPath: string): Promise<ChangeStats> {
        // Run numstat for unstaged and staged in parallel (safe — they don't lock)
        const [unstaged, staged] = await Promise.all([
            this.git.numstat(repoPath, false),
            this.git.numstat(repoPath, true),
        ]);

        // Get status for branch, ahead count, and untracked file list
        const status = await this.git.status(repoPath);

        // Count lines in untracked files from disk
        let untrackedAdditions = 0;
        const untrackedFiles = status.unstagedFiles.filter(
            (f) => f.status === "untracked",
        );
        for (const file of untrackedFiles) {
            untrackedAdditions += await this.countFileLines(
                join(repoPath, file.path),
            );
        }

        const additions =
            unstaged.reduce((sum, e) => sum + e.additions, 0) +
            staged.reduce((sum, e) => sum + e.additions, 0) +
            untrackedAdditions;
        const deletions =
            unstaged.reduce((sum, e) => sum + e.deletions, 0) +
            staged.reduce((sum, e) => sum + e.deletions, 0);

        const fileCount =
            status.stagedFiles.length + status.unstagedFiles.length;
        const hasChanges = fileCount > 0;

        return {
            additions,
            deletions,
            fileCount,
            branch: status.branch,
            ahead: status.ahead,
            hasChanges,
            diffDisabled: !hasChanges,
            commitDisabled: !hasChanges && status.ahead === 0,
        };
    }

    private async countFileLines(filePath: string): Promise<number> {
        try {
            const info = await stat(filePath);
            if (!info.isFile() || info.size > MAX_UNTRACKED_FILE_SIZE) return 0;
            const content = await readFile(filePath, "utf-8");
            // Count newlines; a file with content but no newline still has 1 line
            const newlines = content.split("\n").length;
            return content.endsWith("\n") ? newlines - 1 : newlines;
        } catch {
            return 0;
        }
    }

    dispose(): void {
        this.stopPolling();
        this.targets.clear();
    }
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/change-tracker.ts
git commit -m "feat: add ChangeTracker service for centralized git stats polling"
```

---

### Task 4: Wire ChangeTracker into backend initialization

**Files:**
- Modify: `packages/backend/src/index.ts` (instantiate and connect ChangeTracker)
- Modify: `packages/backend/src/ws/server.ts` (add onConnect callback)

- [ ] **Step 1: Add `onConnect` callback to WebSocket server**

In `packages/backend/src/ws/server.ts`, modify the `createServer` function to accept and call an `onConnect` callback:

1. Add parameter to the function signature — change the return type to also include the callback setter:

```typescript
export function createServer(
    router: Router,
    port: number = 0,
    apiRouter?: ApiRouter,
): {
    start(): Promise<{ port: number; stop(): void }>;
    broadcast(event: WsEvent): void;
    onConnect(callback: () => void): void;
} {
```

2. Add a callback variable and setter inside the function body (after `const clients`):

```typescript
    let connectCallback: (() => void) | null = null;

    function onConnect(callback: () => void): void {
        connectCallback = callback;
    }
```

3. In the `websocket.open` handler (line 37), add after `clients.add(ws)`:

```typescript
                    if (connectCallback) connectCallback();
```

4. Add `onConnect` to the return object (line 84):

```typescript
    return { start, broadcast, onConnect };
```

- [ ] **Step 2: Instantiate ChangeTracker in main entry**

In `packages/backend/src/index.ts`, add the following:

1. Import at the top:
```typescript
import { ChangeTracker } from "./services/change-tracker";
```

2. After `const gitService = new GitService();` (around line 43), add:
```typescript
const changeTracker = new ChangeTracker(gitService, server.broadcast);
```

Note: `server` is created a few lines later. The `ChangeTracker` constructor just stores the broadcast reference, so `server` must be created first. Check the actual instantiation order and place `changeTracker` creation after `const server = createServer(...)`.

3. After `const server = createServer(...)`, add the onConnect hook:
```typescript
server.onConnect(() => changeTracker.sendCurrentStats());
```

4. After `await server.start()` and after projects are loaded, register initial tracking targets. Find where projects are first available (after `store.listProjects()` or the startup sequence) and add:
```typescript
// Register projects for change tracking
const initialProjects = await store.listProjects();
for (const project of initialProjects) {
    if (project.locationValid !== false) {
        changeTracker.track(project.id, project.path);
    }
}

// Register worktree tasks for change tracking
const allTasks = await store.listTasks();
for (const task of allTasks) {
    if (task.worktree.enabled && task.worktree.path && !task.parentId) {
        changeTracker.track(task.id, task.worktree.path);
    }
}
```

5. Pass `changeTracker` to `registerGitHandlers`:
```typescript
registerGitHandlers({ router, git: gitService, taskStore: store, broadcast: server.broadcast, changeTracker });
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/index.ts packages/backend/src/ws/server.ts
git commit -m "feat: wire ChangeTracker into backend startup and WebSocket connect"
```

---

### Task 5: Add invalidation to git mutation handlers

**Files:**
- Modify: `packages/backend/src/handlers/git.ts`

- [ ] **Step 1: Accept `changeTracker` in handler deps**

In `packages/backend/src/handlers/git.ts`, update the `GitHandlerDeps` interface:

```typescript
import type { ChangeTracker } from "../services/change-tracker";

interface GitHandlerDeps {
    router: Router;
    git: GitService;
    taskStore: TaskStore;
    broadcast: (message: { type: string; payload: unknown }) => void;
    changeTracker: ChangeTracker;
}
```

Update the destructuring at the top of `registerGitHandlers`:

```typescript
const { router, git, taskStore, broadcast, changeTracker } = deps;
```

- [ ] **Step 2: Add `changeTracker.invalidate()` calls after mutations**

Add `changeTracker.invalidate(repoPath)` at the end of these handlers (after the git operation, before `return`):

1. `GIT_STAGE` handler (line 72-78) — add after `await git.stage(...)`:
```typescript
        changeTracker.invalidate(repoPath);
```

2. `GIT_UNSTAGE` handler (line 80-86) — add after `await git.unstage(...)`:
```typescript
        changeTracker.invalidate(repoPath);
```

3. `GIT_REVERT_FILE` handler (line 56-70) — add after `await git.revertFile(...)`:
```typescript
        changeTracker.invalidate(repoPath);
```

4. `GIT_COMMIT` handler (line 103-107) — add after `await git.commit(...)` and before `return`:
```typescript
        changeTracker.invalidate(repoPath);
```

5. `GIT_PUSH` handler (line 96-101) — add after `await git.push(...)`:
```typescript
        changeTracker.invalidate(repoPath);
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/git.ts
git commit -m "feat: invalidate ChangeTracker after git mutations"
```

---

### Task 6: Connect ChangeTracker to FILE_CHANGED events

**Files:**
- Modify: `packages/backend/src/handlers/file.ts`

- [ ] **Step 1: Accept `changeTracker` in file handler deps**

In `packages/backend/src/handlers/file.ts`, update the `FileHandlerDeps` interface:

```typescript
import type { ChangeTracker } from "../services/change-tracker";

interface FileHandlerDeps {
    router: Router;
    fileWatcher: FileWatcher;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    changeTracker: ChangeTracker;
}
```

Update the destructuring:
```typescript
const { router, fileWatcher, taskStore, broadcast, changeTracker } = deps;
```

- [ ] **Step 2: Forward file change events to ChangeTracker**

In the `FILE_WATCH` handler (line 60-66), modify the watch callback to also notify the change tracker:

```typescript
    router.register(MSG.FILE_WATCH, async (payload) => {
        const { path } = payload as FileWatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.watch(workspacePath, (event) => {
            broadcast({ type: MSG.FILE_CHANGED, payload: event });
            changeTracker.onFileChanged(event.path);
        });
        return { success: true };
    });
```

- [ ] **Step 3: Update the caller in `index.ts`**

In `packages/backend/src/index.ts`, update the `registerFileHandlers` call to pass `changeTracker`:

```typescript
registerFileHandlers({ router, fileWatcher, taskStore: store, broadcast: server.broadcast, changeTracker });
```

- [ ] **Step 4: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/handlers/file.ts packages/backend/src/index.ts
git commit -m "feat: forward FILE_CHANGED events to ChangeTracker for reactive updates"
```

---

### Task 7: Track/untrack on project and task changes

**Files:**
- Modify: `packages/backend/src/handlers/task.ts` (track worktree tasks on create/update)
- Modify: `packages/backend/src/index.ts` (pass changeTracker to task and project handlers)

- [ ] **Step 1: Identify where projects and tasks are added/removed**

The project handlers are in `packages/backend/src/handlers/project.ts`. Check the handler registrations for `PROJECT_ADD`, `PROJECT_REMOVE`, `PROJECT_UPDATE`.

The task handlers are in `packages/backend/src/handlers/task.ts`. Check for `TASK_CREATE`, `TASK_UPDATE`, `TASK_DELETE`, `TASK_ARCHIVE`.

Additionally, the worktree API endpoint in `packages/backend/src/api/routes.ts` handles worktree enable/disable.

- [ ] **Step 2: Add changeTracker to project handlers**

In `packages/backend/src/handlers/project.ts`, add `changeTracker` as a 5th positional parameter (the function uses positional args, not a deps object):

```typescript
export function registerProjectHandlers(
    router: Router,
    store: TaskStore,
    gitService: GitService,
    closeSession?: (sessionId: string) => void,
    changeTracker?: ChangeTracker,
): void {
```

Import `ChangeTracker` at the top. Then:

1. After `PROJECT_ADD` succeeds — call `changeTracker?.track(project.id, project.path)`
2. After `PROJECT_REMOVE` succeeds — call `changeTracker?.untrack(id)`

- [ ] **Step 3: Add changeTracker to task handlers**

In `packages/backend/src/handlers/task.ts`, add `changeTracker` to the deps and:

1. After `TASK_CREATE` — if the new task has `worktree.enabled && worktree.path && !parentId`, call `changeTracker.track(task.id, task.worktree.path)`
2. After `TASK_DELETE` — call `changeTracker.untrack(id)`
3. After `TASK_ARCHIVE` — call `changeTracker.untrack(id)`
4. After `TASK_UNARCHIVE` — if task has `worktree.enabled && worktree.path && !task.parentId`, call `changeTracker.track(task.id, task.worktree.path)`. Note: `TASK_UNARCHIVE` cascades to subtasks — only track root tasks (those without `parentId`)

- [ ] **Step 4: Track worktree creation in title-generator**

In `packages/backend/src/services/title-generator.ts`, the `createWorktreeForTask` function sets the worktree path after git worktree creation. Pass `changeTracker` into `createTitleGenerator` deps and after the `taskStore.updateTask` call that sets the worktree path, add:

```typescript
changeTracker.track(taskId, worktreePath);
```

- [ ] **Step 5: Track worktree toggle in API routes**

In `packages/backend/src/api/routes.ts`, the `PATCH /api/tasks/:taskId/worktree` endpoint enables/disables worktrees. Pass `changeTracker` and:

1. When disabling (after cleanup): `changeTracker.untrack(params.taskId)`
2. When enabling (if path exists): `changeTracker.track(params.taskId, task.worktree.path)`

- [ ] **Step 6: Update index.ts to pass changeTracker to all affected handlers**

Update the handler registration calls in `packages/backend/src/index.ts`:

1. `registerProjectHandlers` uses positional args — add `changeTracker` as 5th arg:
```typescript
registerProjectHandlers(router, store, gitService, closeSession, changeTracker);
```

2. `registerTaskHandlers` — add `changeTracker` to its deps object

3. `createTitleGenerator` — add `changeTracker` to its deps object

4. `registerApiRoutes` — add `changeTracker` to its deps object

- [ ] **Step 7: Verify build**

Run: `cd packages/backend && bun run build`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/handlers/task.ts packages/backend/src/handlers/project.ts packages/backend/src/services/title-generator.ts packages/backend/src/api/routes.ts packages/backend/src/index.ts
git commit -m "feat: track/untrack projects and worktree tasks in ChangeTracker on lifecycle events"
```

---

### Task 8: Simplify UI diff-store to passive listener

**Files:**
- Modify: `packages/ui/src/stores/diff-store.ts`

- [ ] **Step 1: Rewrite diff-store as passive listener**

Replace the contents of `packages/ui/src/stores/diff-store.ts` with:

```typescript
import { create } from "zustand";
import type { ChangeStats, ChangeStatsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent } from "../hooks/useWebSocket";

interface DiffStats {
    additions: number;
    deletions: number;
}

interface DiffStore {
    statsByProject: Record<string, DiffStats | null>;
    diffDisabledByProject: Record<string, boolean>;
    commitDisabledByProject: Record<string, boolean>;
    hasChangesByProject: Record<string, boolean>;
}

export const useDiffStore = create<DiffStore>(() => ({
    statsByProject: {},
    diffDisabledByProject: {},
    commitDisabledByProject: {},
    hasChangesByProject: {},
}));

// Module-level listener — runs once when the module is imported
const _unsubChangeStats = onEvent(MSG.GIT_CHANGE_STATS, (payload) => {
    const { targetId, stats } = payload as ChangeStatsEvent;

    if (stats === null) {
        // Target was untracked — clear entry
        useDiffStore.setState((state) => {
            const { [targetId]: _s, ...restStats } = state.statsByProject;
            const { [targetId]: _d, ...restDiff } = state.diffDisabledByProject;
            const { [targetId]: _c, ...restCommit } = state.commitDisabledByProject;
            const { [targetId]: _h, ...restChanges } = state.hasChangesByProject;
            return {
                statsByProject: restStats,
                diffDisabledByProject: restDiff,
                commitDisabledByProject: restCommit,
                hasChangesByProject: restChanges,
            };
        });
        return;
    }

    const diffStats: DiffStats | null =
        stats.additions === 0 && stats.deletions === 0 ? null : {
            additions: stats.additions,
            deletions: stats.deletions,
        };

    useDiffStore.setState((state) => ({
        statsByProject: { ...state.statsByProject, [targetId]: diffStats },
        diffDisabledByProject: { ...state.diffDisabledByProject, [targetId]: stats.diffDisabled },
        commitDisabledByProject: { ...state.commitDisabledByProject, [targetId]: stats.commitDisabled },
        hasChangesByProject: { ...state.hasChangesByProject, [targetId]: stats.hasChanges },
    }));
});

// Keep the export for consumers that use it
export { _unsubChangeStats };
```

Note: The `getWorkspaceButtonState` function exported from the old store may be used by `ChangesPane.tsx` — check if it's imported anywhere. If so, keep it as a standalone exported function, or move the logic inline at the call site.

- [ ] **Step 2: Check for `getWorkspaceButtonState` usage**

Search for `getWorkspaceButtonState` across the UI codebase. If it's used in `ChangesPane.tsx` or elsewhere, keep it exported from the store (it derives from `GitStatusResult`, not from the new `ChangeStats`, so it's still needed for the on-demand ChangesPane flow).

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/diff-store.ts
git commit -m "refactor: simplify diff-store to passive CHANGE_STATS listener"
```

---

### Task 9: Remove polling setup from TaskSidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:62-111`

- [ ] **Step 1: Remove diff polling code from TaskSidebar**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`:

1. Remove the `startPolling` selector (line 63):
```typescript
// DELETE: const startPolling = useDiffStore((s) => s.startPolling);
```

2. Remove the `diffTargets` memo (lines 95-106):
```typescript
// DELETE the entire useMemo block for diffTargets
```

3. Remove the `startPolling` useEffect (lines 108-111):
```typescript
// DELETE the entire useEffect block that calls startPolling
```

4. Keep the `diffStatsByProject` selector (line 62) — it's still used for rendering pills.

5. Remove the `startPolling` import if `useDiffStore` no longer exports it (it shouldn't after Task 8). The `useDiffStore` import itself stays since `diffStatsByProject` still uses it.

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: No errors

- [ ] **Step 3: Verify the app runs**

Run: `cd /Users/kuindji/Projects/taskflow && bun run dev`
Expected: App starts, pills show +/- stats, no console errors related to diff polling

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "refactor: remove UI-side diff polling from TaskSidebar"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Verify pills update on file changes**

1. Start the app in dev mode
2. Open a project with some uncommitted changes
3. Verify +/- pills appear in the sidebar
4. Make a change to a file in that project (e.g., add a line)
5. Verify pills update within ~1-3 seconds

- [ ] **Step 2: Verify pills update after git operations**

1. Stage a file via the ChangesPane
2. Verify pills update immediately (within ~500ms)
3. Commit the staged changes
4. Verify pills update to reflect the commit

- [ ] **Step 3: Verify worktree task pills**

1. If a worktree task exists, verify its pill shows correct stats
2. Make a change in the worktree directory
3. Verify the task's pill updates

- [ ] **Step 4: Verify adaptive interval**

1. Check backend logs/behavior with a small changeset — interval should be ~3s
2. Check with a large changeset (200+ files) — interval should increase to ~10s

# Centralized Change Tracking

## Problem

When a branch has a large uncommitted diff (thousands of lines), the app becomes laggy. The root cause is that `diff-store.ts` polls from the UI every 15 seconds, and each poll triggers `GitService.diff()` which spawns a **separate `git diff` subprocess per changed file** to compute +/- stats. With 500 changed files, that's 500+ concurrent subprocesses per poll cycle. Additionally, `git status -uall` does recursive untracked file enumeration which is slow on large repos.

## Solution

Move change tracking to a centralized backend service (`ChangeTracker`) that polls efficiently using batched git commands and broadcasts stats to the UI only when values change.

## Design

### Backend: `ChangeTracker` service

New file: `packages/backend/src/services/change-tracker.ts`

- Maintains a `Map<string, TrackedTarget>` keyed by target ID (project ID or task ID)
- Each target stores: `id`, `path`, and cached `ChangeStats`
- Runs a single `setInterval` that iterates all tracked targets **sequentially** (avoids git lock contention)
- For each target, runs 4 lightweight git commands:
  1. `git --no-optional-locks diff --numstat` — unstaged per-file additions/deletions (single process)
  2. `git --no-optional-locks diff --cached --numstat` — staged per-file additions/deletions (single process)
  3. `git --no-optional-locks status --porcelain=v1 -z -uall` — file list with full untracked enumeration (needed for accurate file counts and untracked line counting)
  4. `git --no-optional-locks rev-list --count @{u}..HEAD` — ahead count (caught silently if no upstream)
- For untracked files found in step 3, reads from disk to count lines (skips files >1MB)
- Sums totals, compares to previous stats, broadcasts `CHANGE_STATS` only when values change
- **Adaptive interval**: 3s when total files < 200, 10s when >= 200
- Subscribes to `FILE_CHANGED` events from the file watcher — on change, debounces (300ms) and runs an out-of-band poll for the affected target, providing fast feedback when files are written by agents

### Registration and lifecycle

- `track(id, path)` and `untrack(id)` methods
- Only root-level worktree tasks are tracked (those without `parentId`), mirroring the existing UI filter
- On startup, registers all project paths from the project store
- Worktree task creation/enablement triggers `track()`; deletion/disablement triggers `untrack()`
- Project add/remove in sidebar triggers track/untrack
- `untrack(id)` broadcasts a final `CHANGE_STATS` with `null` stats so the UI clears stale entries
- Polling loop starts when first target is tracked, stops when last is untracked
- `invalidate(id)` triggers an immediate out-of-band poll for that target (not "on the next cycle") — called after mutations like stage, unstage, commit, revert
- On new WebSocket client connection, sends current cached stats for all tracked targets immediately

### Shared types

New message type `CHANGE_STATS` in constants. New interface:

```typescript
interface ChangeStats {
    additions: number;
    deletions: number;
    fileCount: number;
    branch: string | null;
    ahead: number;
    hasChanges: boolean;    // staged or unstaged files exist
    diffDisabled: boolean;  // no file changes at all
    commitDisabled: boolean; // no file changes AND ahead === 0
}
```

Broadcast payload: `{ targetId: string; stats: ChangeStats | null }` — sent per-target only when values change. `null` means the target was untracked (UI should clear entry).

### UI: Simplified `diff-store.ts`

- Drops all polling logic: `startPolling`, `fetchDiff`, `fetchAllDiffs`, file watcher subscription, visibility listener, `clearStaleProjects`
- Becomes a passive receiver that listens for `CHANGE_STATS` events and updates `statsByProject`
- When `stats` is `null`, removes the entry from all store maps
- Store shape (`statsByProject`, `diffDisabledByProject`, etc.) stays the same so consumers don't change
- `diffDisabled` and `commitDisabled` are read directly from the broadcast payload (computed on backend)

### GitService changes

- Add `numstat(path)` method — runs `git --no-optional-locks diff --numstat`, returns `Array<{path, additions, deletions}>`
- Add `numstatCached(path)` method — same but with `--cached` flag
- Add `--no-optional-locks` to existing `status()` method

## File changes

### New files
- `packages/backend/src/services/change-tracker.ts`

### Modified files
- `packages/shared/src/constants.ts` — add `CHANGE_STATS` message type
- `packages/shared/src/types/git.ts` — add `ChangeStats` interface
- `packages/backend/src/services/git-service.ts` — add `numstat`/`numstatCached` methods, `--no-optional-locks` on status
- `packages/backend/src/handlers/git.ts` — call `changeTracker.invalidate()` after mutations
- `packages/ui/src/stores/diff-store.ts` — replace polling with `CHANGE_STATS` listener
- `packages/ui/src/components/sidebar/TaskSidebar.tsx` — remove `diffTargets` memo (lines 95-106), `startPolling` call (lines 108-111), and `startPolling` selector; keep `diffStatsByProject` selector (still used for rendering)

### Unchanged
- `ProjectGroup.tsx`, `TaskCard.tsx`, `TaskHeader.tsx` — read from `useDiffStore` (same API)
- `ChangesPane.tsx` — still uses `GIT_STATUS` and `GIT_DIFF_FILE` on-demand
- `file-watcher.ts` — unrelated to diff stats (but `ChangeTracker` subscribes to its events)

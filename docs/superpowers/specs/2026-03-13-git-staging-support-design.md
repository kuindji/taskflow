# Git Staging Support for Diff View & Commit Dialog

## Overview

Add git staging (index) support to the diff view and commit dialog. The diff view gains two collapsible sections for staged/unstaged files with stage/unstage actions. The commit dialog gains an "Include unstaged changes" toggle (on by default).

## Types & Messages

### Shared Types (`packages/shared/src/types/git.ts`)

- Extend `GitFileStatus` with a `staged: boolean` field.
- Replace `GitStatusResult.files` with `stagedFiles: GitFileStatus[]` and `unstagedFiles: GitFileStatus[]`. A file can appear in both arrays when partially staged.
- Extend `GitDiffFile` with `staged: boolean`.

### New WebSocket Messages (`packages/shared/src/constants.ts`)

- `GIT_STAGE` — stage a single file or all files. Payload: `{ repoPath: string, filePath?: string }`. Omit `filePath` to stage all.
- `GIT_UNSTAGE` — unstage a single file or all files. Same payload pattern.

### Modified Messages

- `GIT_DIFF_FILE` response: update `GitDiffFileResponse` in `ws.ts` to return `{ staged?: string, unstaged?: string }` instead of `{ diff: string }`, so the UI can display both patches with visual separation.
- `GIT_COMMIT` payload: add `includeUnstaged: boolean` (default `true`).
- `GIT_GENERATE_COMMIT_MSG` payload: add `includeUnstaged: boolean` (default `true`).

### New Payload Types (`packages/shared/src/types/ws.ts`)

- `GitStagePayload` — `{ repoPath: string, filePath?: string }`
- `GitUnstagePayload` — same shape as `GitStagePayload`
- Update `GitDiffFileResponse` — change `diff: string` to `staged?: string, unstaged?: string`
- Update `GitCommitPayload` — add `includeUnstaged: boolean`

## Backend Git Service (`packages/backend/src/services/git-service.ts`)

### `status()` Changes

Parse `git status --porcelain=v1` two-character status codes to distinguish index vs worktree:
- First character = index status (staged)
- Second character = worktree status (unstaged)

Build separate `stagedFiles` and `unstagedFiles` arrays from these codes.

### New Methods

- `stage(filePath?: string)` — runs `git add <filePath>` or `git add -A` if no path. "Stage All" includes untracked files.
- `unstage(filePath?: string)` — runs `git restore --staged <filePath>` or `git restore --staged .` if no path. Uses `git restore --staged` (consistent with existing `revertFile()` style) instead of legacy `git reset HEAD`.

### `diffFile()` Changes

Return `{ staged?: string, unstaged?: string }` instead of a single combined string:
- `staged` = `git diff --cached -- <file>`
- `unstaged` = `git diff -- <file>` (or `git diff --no-index /dev/null <file>` for untracked)

### `diff()` Changes

Tag each `GitDiffFile` entry with `staged: true/false`. A file with both staged and unstaged changes produces two entries.

### `resolveFileStatus()` Changes

Update internal `resolveFileStatus()` to work with the new split status arrays (it currently accesses `status.files`).

### `generateCommitMessage()` Changes

Update to accept `includeUnstaged: boolean`. When `false`, only include diffs from staged files (filter `diffResult.files` where `staged === true`) to avoid sending duplicate/irrelevant hunks to Claude.

### `commit()` Changes

Accept `includeUnstaged: boolean`:
- `true` (default): run `git add -A` before committing (current behavior).
- `false`: run `git commit` with only what's currently in the index.

## Backend Handlers (`packages/backend/src/handlers/git.ts`)

Register new handlers:
- `GIT_STAGE` → `git.stage(filePath?)`
- `GIT_UNSTAGE` → `git.unstage(filePath?)`

## Frontend — Changes Pane (`packages/ui/src/components/panes/ChangesPane.tsx`)

### File List

Replace the flat file list with two collapsible sections:
- **"Staged Changes (N)"** — header with "Unstage All" button. Each file has an unstage (-) icon button.
- **"Unstaged Changes (N)"** — header with "Stage All" button. Each file has a stage (+) icon button.
- Revert button stays on unstaged files only. To revert staged changes, user must unstage first, then revert. This is explicit and safe.
- A file can appear in both sections when partially staged.

### Diff Display

When a file is clicked:
- If the file exists in both staged and unstaged: show both diffs concatenated with visual headers ("Staged Changes" / "Unstaged Changes") separating them.
- If the file exists in only one section: show that diff with its header.
- Headers should be visually distinct (colored bar/label).

### State

- Uses `stagedFiles` and `unstagedFiles` from the status response directly.
- After stage/unstage actions, re-fetch status + diff to update UI.

## Frontend — Commit Dialog (`packages/ui/src/components/workspace/CommitDialog.tsx`)

### New Toggle

- "Include unstaged changes" switch, enabled by default.
- When enabled: backend runs `git add -A` before commit (current behavior).
- When disabled: commits only staged changes. Commit button disabled if nothing is staged, with a tooltip.

### `hasChanges` Logic Update

Currently checks `res.status.files.length > 0`. Must update to check `stagedFiles.length > 0 || unstagedFiles.length > 0`.

### Agent Mode

- "Include unstaged" on: prompt says "Create commits for all changes, staged and unstaged".
- "Include unstaged" off: prompt says "Create commits for staged changes only".

## Frontend — Diff Store (`packages/ui/src/stores/diff-store.ts`)

- Track `stagedStats` and `unstagedStats` separately per project (additions/deletions).
- `commitDisabled` logic: disabled when `stagedFiles.length === 0 && unstagedFiles.length === 0 && status.ahead === 0`.

## Files to Modify

1. `packages/shared/src/types/git.ts` — extend types
2. `packages/shared/src/constants.ts` — add `GIT_STAGE`, `GIT_UNSTAGE`
3. `packages/shared/src/types/ws.ts` — add payload types, update `GitDiffFileResponse`
4. `packages/backend/src/services/git-service.ts` — add stage/unstage, modify status/diff/diffFile/commit/resolveFileStatus/generateCommitMessage
5. `packages/backend/src/handlers/git.ts` — register new handlers
6. `packages/backend/tests/services/git-service.test.ts` — update all `status.files` references to `stagedFiles`/`unstagedFiles`, add tests for stage/unstage
7. `packages/ui/src/components/panes/ChangesPane.tsx` — staged/unstaged sections, stage/unstage UI, updated diff display
8. `packages/ui/src/components/workspace/CommitDialog.tsx` — "Include unstaged" toggle, update `hasChanges` logic
9. `packages/ui/src/stores/diff-store.ts` — separate staged/unstaged stats, update `commitDisabled` condition

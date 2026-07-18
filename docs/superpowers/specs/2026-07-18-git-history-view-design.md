# Git History View — Design

**Date:** 2026-07-18
**Status:** Approved

## Summary

A read-only git history view for projects and worktree tasks. Entry point is a
"History" button in the workspace header, next to the existing Diff button. The
button opens a new "History" tab (same pattern as the "Changes" tab) showing the
current branch's commit log; selecting a commit shows its changed files, and
selecting a file shows a side-by-side diff in the existing Monaco diff viewer.

## Scope

- Commit list + per-commit file list + per-file diff. Read-only.
- History of the currently checked-out branch: the worktree branch for worktree
  tasks, the project repo's current branch otherwise (`git log HEAD`).
- Only interaction beyond browsing: copy commit hash.
- Out of scope: branch graph visualization, search/filter, file-level history,
  mutating actions (revert/reset/checkout), branch selector.

## Architecture

Follows the existing Changes-tab pattern end to end: header button → tab in
`session-store` → pane component → WebSocket request → backend git handler →
`GitService` → raw `git` subprocess.

### Shared (`packages/shared`)

New message channels in `src/constants.ts`:

- `GIT_LOG: "git:log"` — page of commits.
- `GIT_COMMIT_FILES: "git:commit-files"` — files changed by one commit.
- `GIT_COMMIT_DIFF_FILE: "git:commit-diff-file"` — before/after blob pair for
  one file in one commit.

New types in `src/types/git.ts`:

```ts
interface GitLogEntry {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    date: string; // ISO 8601
    refs: string[]; // decorations: branch/tag names, empty when none
}

interface GitLogResult {
    entries: GitLogEntry[];
    hasMore: boolean;
}

interface GitCommitFile {
    path: string;
    previousPath?: string; // renames
    status: "new" | "modified" | "deleted" | "renamed";
    additions: number; // -1 for binary
    deletions: number; // -1 for binary
}

interface GitCommitFilesResult {
    files: GitCommitFile[];
}
```

The per-file diff result reuses the existing `GitFileContentPair`
(`{ original, modified }`). Payload types (`GitLogPayload { repoPath, limit,
skip }`, `GitCommitFilesPayload { repoPath, hash }`, `GitCommitDiffFilePayload
{ repoPath, hash, path, previousPath? }`) go in `src/types/ws.ts`, exported via
`src/index.ts`, alongside the existing git payload types.

### Backend (`packages/backend`)

New `GitService` methods (`src/services/git-service.ts`), using the existing
`gitCapture` helper:

- `log(repoPath, limit, skip)` — `git log HEAD` with a null-delimited
  `--pretty` format (`%H`, `%h`, `%s`, `%an`, `%aI`, `%D`) so subjects with any
  characters parse safely. Requests `limit + 1` entries to compute `hasMore`.
  Returns an empty result (not an error) for a repo with no commits.
- `commitFiles(repoPath, hash)` — `git show --numstat --name-status
  --format= -z <hash>` (numstat and name-status merged by path) to produce
  `GitCommitFile[]` with rename detection and binary markers (`-` numstat →
  `-1`).
- `commitDiffFile(repoPath, hash, path, previousPath?)` — returns a
  `GitFileContentPair`: original from `git show <hash>^:<previousPath ?? path>`
  (empty string when the commit has no parent or the file is new), modified
  from `git show <hash>:<path>` (empty when deleted).

Handlers registered in `src/handlers/git.ts` next to the existing git handlers,
with the same `assertWorkspaceRepo` path validation. The commit `hash` is
validated as a hex string before being passed to git. No ChangeTracker
involvement — history is fetched on demand, not polled.

### Frontend (`packages/ui`)

- **Tab type:** add `"history"` to the `Tab` union in
  `src/stores/session-helpers.ts`.
- **Open logic:** `handleHistoryTab` in
  `src/components/workspace/Workspace.tsx`, mirroring `handleDiffTab`
  (focus existing `history` tab or `addTab` a new one, label "History").
  Passed to `TaskHeader` as a new optional `onHistory` prop.
- **Header button:** in `src/components/workspace/TaskHeader.tsx`, a ghost
  `size="xs"` "History" button next to the Diff button, gated by the same
  `showGitButtons` condition and rendered only when `onHistory` is provided.
- **Rendering:** `TabContent.tsx` maps `tab.type === "history"` →
  `<HistoryPane repoPath={workspace.workingDir} />`.
- **`HistoryPane`** (`src/components/panes/HistoryPane.tsx`), analogous to
  `ChangesPane`:
  - Left column: commit list. Each row shows short hash, subject, author,
    relative date, and ref badges; a copy-hash affordance uses the existing
    `copy-button` primitive. Loads 100 commits per page via `GIT_LOG`; a
    "Load more" row appends the next page while `hasMore`. Plain scrollable
    list, no virtualization.
  - Selecting a commit fetches its file list via `GIT_COMMIT_FILES` and shows
    it below the commit list in the same left column (commits on top, files of
    the selected commit beneath), with per-file +/- stats matching
    `ChangesPane` row styling. The right side of the pane is the diff area,
    as in `ChangesPane`.
  - Selecting a file fetches the blob pair via `GIT_COMMIT_DIFF_FILE` and
    renders `MonacoDiffViewer` with `getLanguage(path)`.
  - Local component state (selected commit, selected file, loaded pages);
    no new Zustand store.

## Error handling & edge cases

- **Empty repo (no commits):** backend returns empty entries; pane shows an
  empty state ("No commits yet").
- **Root commit:** no parent → original side is empty; diff shows full file as
  added.
- **Renames:** `previousPath` used for the original blob lookup, row shows
  `old → new`.
- **Binary files:** numstat `-` → stats shown as "binary", file row selectable
  but diff area shows a "Binary file" placeholder instead of Monaco.
- **History rewritten while viewing (rebase/amend):** a selected hash may stop
  existing; backend errors surface as the pane's inline error state with a
  refresh affordance, consistent with `ChangesPane` error handling.
- **Backend errors** (invalid repo, git failure) follow the existing
  request/response error path and render an inline error message.

## Testing

Follows the repo's existing testing approach for git features: backend
`GitService` parsing (log format, numstat/name-status merge, rename/binary
cases, root commit) is the primary unit-test surface, using a temp fixture
repo. UI behavior verified by exercising the pane against a real repo
(commit list paging, drill-down, empty repo).

# Section 8: Git safety and preview limits

Read `handoff.md`, `design.md` §5, and `reviews/research-5-git-desktop.md`. This is an implementation plan only. Anchors below were verified against the current checkout on 2026-10-30; they are not future line numbers.

**Files:**

- Modify: `packages/backend/src/services/git-helpers.ts:1`, `:5`, `:30`. One literal-pathspec opt-in and bounded query execution.
- Modify: `packages/backend/src/services/git-service.ts:208`, `:236`, `:270`, `:310`, `:331`, `:395`, `:416`, `:424`. Literal file actions, bounded patches/content, and four bulk workers. Also mark the read-only calls at `:38`, `:48`, `:68`, `:503`.
- Modify: `packages/backend/src/services/git-history.ts:29`, `:95`, `:162`, `:171`; `packages/backend/src/services/git-pr.ts:14`, `:72`. Bound history queries and reject incomplete input to commit-message generation.
- Modify: `packages/backend/src/services/git-worktree.ts:14`, `:24`. Verify ownership and safely clean linked worktrees.
- Create: `packages/backend/src/services/worktree-removal.ts`, `packages/backend/src/services/task-worktree-cleanup.ts`, `packages/backend/src/services/file-preview.ts`; `packages/backend/tests/services/git-helpers.test.ts`, `packages/backend/tests/services/git-worktree.test.ts`, `packages/backend/tests/services/worktree-removal.test.ts`, `packages/backend/tests/services/file-preview.test.ts`.
- Modify: `packages/backend/src/handlers/task.ts:224` and `packages/backend/src/api/routes/task-routes.ts:469`. Both currently fire and forget the same cleanup. Reuse one awaited helper.
- Modify: `packages/backend/src/handlers/file.ts:48`; `packages/backend/src/handlers/git.ts:69`, `:76`, `:97`. Preserve path validation and return explicit preview results.
- Modify: `packages/shared/src/types/ws.ts:332`; `packages/shared/src/types/git.ts:21`, `:29`, `:34`; `packages/shared/src/constants.ts:9`. Add the contracts below in these already re-exported modules and bump the protocol for responses that can omit text. No barrel change is needed.
- Modify: `packages/ui/src/stores/file-store.ts:100`, `:386`; `packages/ui/src/stores/task-store.ts:160`; `packages/ui/src/components/panes/EditorPaneImpl.tsx:183`, `:193`, `:207`, `:269`; `packages/ui/src/components/panes/MarkdownPaneImpl.tsx:244`, `:356`, `:549`; `packages/ui/src/components/panes/ChangesPane.tsx:216`, `:319`, `:416`; `packages/ui/src/components/panes/HistoryPane.tsx:196`, `:375`.
- Create: `packages/ui/src/components/panes/DiffPreview.tsx`, `packages/ui/src/components/panes/DiffPreview.test.tsx`; `packages/ui/src/lib/file-preview-error.ts`; `packages/ui/src/components/panes/editor-preview-access.ts`, `packages/ui/src/components/panes/editor-preview-access.test.ts`. Use the small diff wrapper in both panes; keep `packages/ui/src/components/panes/MonacoDiffViewer.tsx:34` read-only.
- Modify: `packages/tui/src/git/store.ts:93` and `packages/tui/src/opentui/git-changes.ts:194`. The TUI consumes the patch response too.
- Extend: `packages/backend/tests/services/git-service.test.ts:7`, `packages/backend/tests/services/git-history.test.ts:12`, `packages/backend/tests/services/git-pr.test.ts:10`; `packages/backend/tests/handlers/git.test.ts:11`, `packages/backend/tests/handlers/file.test.ts:22`, `packages/backend/tests/handlers/task.test.ts:24`; `packages/ui/src/stores/file-store.test.ts:42`; `packages/tui/src/git/store.test.ts:23`.
- Create: `packages/backend/tests/api/task-worktree-cleanup.test.ts`, following the real `ApiRouter`/`TaskStore` fixture in `packages/backend/tests/api/task-info-attributes.test.ts:31`; `packages/ui/src/stores/task-store.cleanup.test.ts`, following `file-store.test.ts:42`'s socket fixtures.

**Interfaces:**

Consumes `GitService`, `GitFileStatus`, `GitDiffResult`, `GitDiffFileContentResult`, `FileReadResponse`, and the existing `assertWorkspacePath`, `assertWorkspaceRepo`, `assertRepoFilePath` checks. Keep the existing `git`/`gitCapture` signatures, adding options rather than a second runner.

```ts
// git-helpers.ts. Export GitRunOptions only because file-preview.ts imports it.
interface GitRunOptions {
  allowExitCodes?: number[];
  literalPathspecs?: boolean; // default false
  readOnly?: boolean; // default false
  maxOutputBytes?: number; // a smaller per-operation limit
}
// Exported because preview callers must distinguish limits from a missing blob.
class GitQueryLimitError extends Error {
  readonly reason: "timeout" | "output";
}
// Existing returns remain { stdout: string; stderr: string } and string.
// Export factory for tests; production git/gitCapture use one default instance.
function createGitRunner(deps: {
  spawn(
    argv: string[],
    cwd: string,
  ): {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(): void;
  };
  timer(callback: () => void, delayMs: number): () => void; // returns cancel
}): {
  git(args: string[], cwd: string, options?: GitRunOptions): Promise<string>;
  gitCapture(
    args: string[],
    cwd: string,
    options?: GitRunOptions,
  ): Promise<{ stdout: string; stderr: string }>;
};

// ws.ts, replacing FileReadResponse's interface with this union.
type FileReadResponse =
  | { content: string; state?: never }
  | { state: "tooLarge" | "binary"; content?: never };
interface TaskDeleteResponse {
  success: true;
  cleanupError?: string;
}

// git.ts. Preserve normal successful payloads for current consumers.
type GitDiffFileResult =
  | { staged?: string; unstaged?: string; state?: never }
  | { state: "tooLarge"; staged?: never; unstaged?: never };
type GitFileContentPair =
  | { original: string; modified: string; state?: never }
  | {
      state: "tooLarge";
      limit: "diff" | "preview";
      original?: never;
      modified?: never;
    }
  | { state: "binary"; original?: never; modified?: never };
// GitDiffFile keeps its fields and adds state?: "tooLarge".
// GitDiffFileContentResult keeps staged/unstaged: GitFileContentPair | null.

// file-preview.ts. The source is a path or a Git blob expression, never shell text.
// The optional open adapter lets the growth/byte-boundary tests control reads.
function readFilePreview(
  path: string,
  deps?: {
    open(path: string): Promise<{
      size(): Promise<number>;
      read(buffer: Uint8Array): Promise<number>; // advances file position
      close(): Promise<void>;
    }>;
  },
): Promise<FileReadResponse>;
function readGitPreview(
  repoPath: string,
  refSpec: string,
  deps?: {
    git: typeof import("./git-helpers").git;
  },
): Promise<FileReadResponse | null>;
// worktree-removal.ts. Exported because git-worktree.ts consumes it.
function removeWorktreeDirectorySafely(worktreePath: string): Promise<void>;
// git-service.ts
// diffFile(existing arguments): Promise<GitDiffFileResult>
// getFileContent(existing arguments): Promise<FileReadResponse | null>
// getFileContentsForDiff and commitDiffFile retain their named shared return types.

// task-worktree-cleanup.ts; imports Task, TaskStore, GitService as types.
function cleanupTaskWorktree(
  task: Task,
  deleteWorktree: boolean,
  deps: {
    store: Pick<TaskStore, "getProject">;
    git: Pick<GitService, "removeWorktree" | "deleteBranch">;
  },
): Promise<string | undefined>; // user-visible cleanupError, never loses a second failure

// UI file-preview-error.ts. readFile still returns Promise<string>.
class FilePreviewError extends Error {
  readonly state: "tooLarge" | "binary";
}
// DiffPreview.tsx. TextView is only a test seam, defaulting to MonacoDiffViewer.
function DiffPreview(props: {
  pair: GitFileContentPair;
  language: string;
  TextView?: React.ComponentType<{
    original: string;
    modified: string;
    language: string;
  }>;
}): React.JSX.Element;
// editor-preview-access.ts. Used by EditorPaneImpl's load/change/save paths.
function createEditorPreviewAccess(): {
  reset(): void;
  allow(): void;
  canEdit(): boolean;
  save(write: () => Promise<void>): Promise<boolean>;
};
```

Implementation detail: keep successful payloads unchanged, use discriminated failure variants, and fail commit-message generation rather than generating from a partial changeset.

## Behavior

### Literal paths and bounded processes

- Add `--literal-pathspecs` before the subcommand, next to `--no-optional-locks`, only when `literalPathspecs: true`. Never encode filenames in a shell command. Keep `--` before path operands. Why: t3code `apps/server/src/vcs/GitVcsDriverCore.ts` prevents bracketed filenames from selecting other files.
- Set the opt-in on cached/working/fallback per-file diffs, stage-one, unstage-one, `rm` and `restore` during revert, including both paths of a rename. Blob expressions such as `HEAD:path` are revision operands, not pathspecs; do not rewrite them. `diff --no-index` remains without the opt-in. Worktree paths are positional operands and keep their own `--` separator.
- Verified prerequisite: `git version 2.54.0 (Apple Git-157)` accepts `git --literal-pathspecs -C <repo> rev-parse --is-inside-work-tree`, returning `true`. No fallback to magic pathspec syntax is needed for this installed Git.
- Mark every local read-only helper call explicitly `readOnly: true`: branch queries, status, numstat, diff, show/blob reads, log, rev-parse, remote get-url and worktree list. Add `--no-ext-diff --no-textconv` to diff/show patch queries so a preview does not run user diff helpers. Do not put checkout, worktree add/remove/prune, branch deletion, stage/restore/rm, commit, clone, fetch/pull/push, remote set-url or hook-running operations under this deadline.
- A read-only process has a 30,000 ms deadline and a combined stdout+stderr cap of 32 _ 1024 _ 1024 bytes. Count incoming bytes before decoding; drain both streams concurrently. On overflow or timeout, kill the child, settle its exit and both readers, clear the timer, then reject. Do not return a truncated success or leave a pipe pending. Exact messages: `Git query timed out after 30 seconds` and `Git query output exceeds 32 MiB`. A lower `maxOutputBytes` uses the same typed output reason, with message `Git query output limit exceeded`. Why: t3code `apps/server/src/vcs/VcsProcess.ts` bounds query resources.
- Use the injected `createGitRunner` spawn/clock dependency for both wrappers. Test it with readable byte streams and a manually fired timer, not real 30-second waits. Keep test-only types private; the exported factory is imported by the tests and used by the production wrappers.

### Diff and file content limits

- A per-file patch over 1,048,576 UTF-8 bytes returns `{ state: "tooLarge" }`. Exactly the limit passes. Apply to staged/unstaged combined bytes and untracked `--no-index` output. If either side exceeds the limit, return no patch strings for that file. Limit collection while streaming; do not first buffer 32 MiB and then inspect string length.
- `diff()` shares four workers across the combined staged/unstaged list, not four for each list. Preserve current staged-before-unstaged ordering and file order. Every worker awaits a file before taking another. Oversized entries keep their identity with `state: "tooLarge"`, `diff: ""`, additions/deletions zero. Before joining diffs, `generateCommitMessage` rejects if any selected entry is oversized with `Cannot generate commit message: a file diff exceeds 1 MiB`.
- `readFilePreview` opens once, checks the opened file's size, and reads at most 5 MiB + 1 bytes. A size over 5,242,880 or a file that grows over it returns `tooLarge`. Inspect at most the first 8,192 bytes for NUL before UTF-8 decoding; NUL returns `binary`. Size takes precedence over binary. Close the handle in `finally`. Do not change raw image/download routes. Why: t3code's bounded expansion avoids sending huge or binary text to the editor.
- `readGitPreview` applies the same policy to `git show <refSpec>`, counting stdout bytes before decoding. Use `cat-file -e <refSpec>` to distinguish an absent blob from a failed query when necessary; only a confirmed missing blob returns null. Limits/timeouts and other errors must not become empty strings in `getFileContent` or `git-history.ts:162`.
- For `GIT_DIFF_FILE_CONTENT` and historical `GIT_COMMIT_DIFF_FILE`, first obtain a bounded patch for the selected comparison and enforce the 1 MiB patch rule. For history use `git diff --no-ext-diff --no-textconv <hash>^ <hash> -- <previousPath> <path>` with literal pathspecs, or `git show --format= --root` for a root commit. Preserve first-parent merge behavior. Then read each original/modified blob or working file through the shared preview functions. A non-text side produces the same state for that pair, without either string. Missing added/deleted sides remain complete empty strings. Binary patch output alone does not bypass blob detection.
- `FILE_READ` returns the union. `file-store.readFile` returns text only or throws `FilePreviewError` with exact message `File preview exceeds 5 MiB` or `Binary file preview is unavailable`. Never return an empty string for a limited response. Increment the then-current `PROTOCOL_VERSION` once for this incompatible response change, following `constants.ts:3`; the checked baseline is 1, so use 2 if earlier sections have not bumped it. Existing version checks must reject an older backend/client before these new variants can be mistaken for empty writable content.
- Editor load start calls `reset()`. Only a full successful text load, or an existing complete dirty model, calls `allow()`. All model-change bookkeeping, keyboard saves and Save button actions consult this same guard. A failed/limited load stays read-only, shows the exact message, and cannot save the initial empty Monaco model. In particular, replace `EditorPaneImpl.tsx:196`'s unconditional readiness on failure. The guard's `save` returns false without invoking its callback when access is denied. Do not store placeholder prose in the model or mark it dirty.
- Markdown already re-reads before checkbox writes. Keep that behavior; a preview exception aborts the write and displays the message. Clear stale rendered content/loadedPath on a limited load. Do not enable task checkbox writes behind an error placeholder.
- `DiffPreview` checks `pair.state` before mounting Monaco. A patch cap sets `limit: "diff"`; a content cap sets `limit: "preview"`. Exact placeholders: `Diff exceeds 1 MiB`, `File preview exceeds 5 MiB`, and `Binary file`. Changes and History retain their existing request-id guards. The TUI maps a patch `tooLarge` to `Diff exceeds 1 MiB` in its existing `text` field.

### Worktree cleanup

- Port the relevant checks/removal behavior from `apps/server/src/vcs/worktreeRemoval.ts` without Effect. Copied blocks start with `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/server/src/vcs/worktreeRemoval.ts`.
- Resolve an absolute target once. Parse `git worktree list --porcelain -z` with NUL fields, preserving spaces/newlines. Compare normalized absolute paths, and canonical paths for existing directories, with Windows case folding. Reject the main entry, a filesystem root, the common Git directory, a foreign repo's worktree, and an existing unregistered directory before any removal. Exact refusals: `Refusing to remove the main worktree`, `Refusing to remove an unregistered worktree: <path>`, `Refusing to remove a locked worktree: <path>`. A registered locked entry is not overridden by the fallback. Reuse the port's `.git` admin-directory/backlink validation before filesystem deletion.
- If the target is already absent, prune and finish; do not delete an existing unregistered directory just because a previous task record named it. Permission/stat/list errors are errors, not proof of absence. A missing unregistered target is safe to prune without filesystem removal.
- On the design's normal path, call `git worktree remove --force -- <absolute target>`. If it fails after validation, safely remove that same directory, then `git worktree prune`. The filesystem remover uses `lstat`, unlinks symlinks/junctions, recurses only into actual directories, and never traverses a link target. Preserve the `.git` file on a partial failure as t3code does so a retry can still verify ownership. Test an outside sentinel directory. Windows ordering is subject to the open question below; do not silently ship the Git-first path on affected Windows versions.
- `cleanupTaskWorktree` skips subtasks and unrequested/unconfigured cleanup. It awaits removal, then attempts branch deletion even after removal failure. Catch the two operations separately, in that order. Join errors with `; ` and return `Task deleted, but worktree cleanup failed: <details>`. Include `remove worktree: <message>` and/or `delete branch: <message>`. If the project is missing return `Task deleted, but worktree cleanup failed: project not found`.
- Both HTTP and WS deletion await this helper after deleting the task and closing browser ownership. Return `{ success: true, cleanupError }` only when needed, otherwise `{ success: true }`. HTTP stays 200 since task deletion succeeded. In the UI store, remove the task family first, then show the existing queued `alert` from `packages/ui/src/stores/dialog-store.ts:106` with title `Worktree cleanup failed` and description `cleanupError`. Fire the queued alert without awaiting dismissal in the mutation; task deletion has already finished. Do not leave a deleted task visible or discard the warning. There is no CLI command/flag change; existing HTTP clients receive the additional JSON field.

## Task 8.1: Literal paths and the query runner

- [x] **Step 1:** Add real temporary-repository cases to `git-service.test.ts`, reusing its `run` and setup helpers: `stage treats brackets and wildcard characters as literal filenames`, `unstage changes only the selected literal path`, `revert leaves wildcard-matching siblings unchanged`, `renamed file diffs include both literal paths`, `untracked no-index diff still accepts exit code one`. Check actual index/worktree contents, not source text.
- [x] **Step 2:** Write runner tests: `literal pathspec option precedes the git subcommand`, `read-only query kills and rejects at 30000 milliseconds`, `combined stdout and stderr cannot exceed 32 MiB`, `a multi-byte chunk is counted as bytes`, `overflow drains both pipes and reaps the process`, `allowed exit codes still work`, `a mutating command has no query deadline`. Run `bun test packages/backend/tests/services/git-helpers.test.ts packages/backend/tests/services/git-service.test.ts`. Expected: FAIL for the new assertions.
- [x] **Step 3:** Implement the runner and call-site opts. Run that exact command. Expected: PASS.

## Task 8.2: Safe worktree cleanup and responses

- [x] **Step 4:** Write `git-worktree.test.ts` and `worktree-removal.test.ts`: `refuses the main worktree without invoking a remover`, `refuses an existing foreign or unregistered directory`, `refuses a locked linked worktree`, `registered paths containing spaces and newlines match exactly`, `already absent worktree is pruned`, `failed git removal safely deletes the registered directory then prunes`, `symlink and junction targets outside the worktree survive`, `partial failure preserves the git backlink when possible`. Inject Git/fs calls for forced failures; run actual symlink fixtures on POSIX and actual junction fixtures on Windows. A skipped Windows test is not Windows acceptance.
- [x] **Step 5:** Extend task handler fakes and add the HTTP fixture: `delete waits for worktree cleanup before replying`, `branch deletion still runs after removal fails`, `both cleanup failures reach the response`, `cleanup failure does not undo task deletion`, `subtask deletion never removes the shared worktree`. Add UI store test `a cleanup warning removes the task family and opens Worktree cleanup failed`. Use real store/socket helpers and assert dialog state. Run `bun test packages/backend/tests/services/git-worktree.test.ts packages/backend/tests/services/worktree-removal.test.ts packages/backend/tests/handlers/task.test.ts packages/backend/tests/api/task-worktree-cleanup.test.ts packages/ui/src/stores/task-store.cleanup.test.ts`. Expected: FAIL.
- [x] **Step 6:** Implement the Windows filesystem-first order from "Planner decisions", plus the portable checks, remover and shared task cleanup helper; wire both response paths and the UI warning. Run the Step 5 command. Expected: PASS on the current platform; record Windows execution separately.

## Task 8.3: Bounded previews and bulk diffs

- [x] **Step 7:** Write `file-preview.test.ts` and extend service/history/handler tests: `exactly 5 MiB of text is readable`, `a file larger than 5 MiB has no content field`, `a growing file cannot escape the preview cap`, `NUL in the first 8 KiB returns binary`, `NUL after the first 8 KiB does not trigger the binary rule`, `a patch exactly 1 MiB is returned and one byte more returns tooLarge`, `combined staged and unstaged patch bytes share the file cap`, `blob limits do not become an empty side`, `historical and working comparisons enforce the same limits`, `bulk diffs never exceed four simultaneous file jobs`, `oversized diffs prevent commit-message generation`. Use injected deferred calls for concurrency and real fixtures for byte boundaries.
- [x] **Step 8:** Run `bun test packages/backend/tests/services/file-preview.test.ts packages/backend/tests/services/git-service.test.ts packages/backend/tests/services/git-history.test.ts packages/backend/tests/services/git-pr.test.ts packages/backend/tests/handlers/file.test.ts packages/backend/tests/handlers/git.test.ts`. Expected: FAIL. Implement the shared preview reader, contracts, patch caps and workers. Run the same command. Expected: PASS.

## Task 8.4: Read-only placeholders and final validation

- [x] **Step 9:** Extend the socket-based file-store tests: `tooLarge rejects with File preview exceeds 5 MiB`, `binary rejects with Binary file preview is unavailable`, `an empty complete file still returns an empty string`. Write `editor-preview-access.test.ts`: `reset denies editing and saving`, `only a complete load enables saving`, `a failed later load cannot save an earlier buffer`. Test `DiffPreview` with an optional injected text-view component through props, defaulting to Monaco: `tooLarge renders Diff exceeds 1 MiB without constructing Monaco`, `binary renders Binary file without constructing Monaco`, `text renders both complete sides`. Follow existing React `act`/`createRoot` conventions, without adding `mock.module`. Extend TUI fake-Net tests: `tooLarge displays an explicit diff placeholder`.
- [ ] **Step 10:** Run `bun test packages/ui/src/stores/file-store.test.ts packages/ui/src/components/panes/editor-preview-access.test.ts packages/ui/src/components/panes/DiffPreview.test.tsx packages/tui/src/git/store.test.ts`. Expected: FAIL. Implement the UI guard, error mapping, shared diff wrapper, markdown handling and TUI mapping. Run again. Expected: PASS. Manually inspect loading text → oversized/binary → normal text and trigger both Save and Cmd/Ctrl-S while blocked; no write request may be sent. Check for running dev processes before starting a local app; do not reuse another agent's app.
- [x] **Step 11:** Run `bun run typecheck`; `bun test packages/backend`; `bun test packages/shared`; `bun test packages/ui`; `bun test packages/tui`. Expected: PASS. Run `bunx eslint <changed TS/TSX files>` and `bunx prettier --check <changed files>`; format only changed paths if needed. If an aggregate PTY suite hangs, record that boundary separately from focused passes. Record the Git global-option probe and Windows acceptance in handoff.
- [x] **Step 12:** Inspect `git diff --check`, stage only this section's files, and commit `fix(git): use literal paths and bound previews and worktree cleanup`. No push, branches, worktrees or trailers.

## Planner decisions (2026-10-30)

- **Windows removes the files first; POSIX asks git first.** Git for Windows before 2.54 follows junctions on `worktree remove`, so on Windows the validated safe filesystem removal (t3code's path in `apps/server/src/vcs/worktreeRemoval.ts`) runs first, then `git worktree prune` clears the metadata. POSIX keeps git first, with the safe remover as the fallback. No minimum git version is introduced. `design.md` §5 is amended to match.

## Implementation validation (2026-10-30)

Steps 1–6 were retained from the gate session. The authorized client timeout and archive warning changes were implemented before Step 7. Steps 7–12 are implemented; Step 10's checkbox remains open because its live manual check and Windows junction acceptance remain unverified under the boundaries in `handoff.md`. No branch, worktree or push was created.

Focused commands and final outcomes:

```sh
# PASS: 48 tests
bun test packages/backend/tests/services/git-helpers.test.ts packages/backend/tests/services/git-service.test.ts
# PASS: 42 tests, 1 Windows-only skip
bun test packages/backend/tests/services/git-worktree.test.ts packages/backend/tests/services/worktree-removal.test.ts packages/backend/tests/handlers/task.test.ts packages/backend/tests/api/task-worktree-cleanup.test.ts packages/ui/src/stores/task-store.cleanup.test.ts
# PASS: 24 tests; the first timeout/archive run failed as expected before implementation
bun test packages/ui/src/lib/connection-registry.test.ts packages/tui/src/archive/store.test.ts packages/tui/src/net/offline-guard.test.ts
# PASS: 92 tests; initial Step 8 run failed as expected before implementation
bun test packages/backend/tests/services/file-preview.test.ts packages/backend/tests/services/git-service.test.ts packages/backend/tests/services/git-history.test.ts packages/backend/tests/services/git-pr.test.ts packages/backend/tests/handlers/file.test.ts packages/backend/tests/handlers/git.test.ts
# PASS: 28 tests; initial Step 10 run failed as expected before implementation
bun test packages/ui/src/stores/file-store.test.ts packages/ui/src/components/panes/editor-preview-access.test.ts packages/ui/src/components/panes/DiffPreview.test.tsx packages/tui/src/git/store.test.ts
```

Aggregate, formatting, Git option and manual-check outcomes are in `handoff.md`. The UI aggregate was replaced with `bun test <file>` for each UI test file, as instructed. Additional invalid-byte regression: `bun test packages/backend/tests/services/git-service.test.ts -t 'UTF-8 cap'` failed before the decoded-byte cap fix and passes in the final focused suite.

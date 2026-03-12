# Commit Dialog Design

## Overview

A dialog for committing changes from within the Taskflow UI. Supports two modes: direct git operations and agent-delegated commits. Triggered from the project header.

## UI

### Trigger

Button in `TaskHeader.tsx`, placed before the existing diff button. Visibility: `!task && !!project` (project view only, independent of diff button's `onDiff` prop). Must include `[-webkit-app-region:no-drag]` class for Electron compatibility.

### Dialog Layout

- **Commit message textarea** — optional. Placeholder: "Leave empty to auto-generate".
- **Three switches:**
  - **Use agent** — delegates the entire operation to a claude/codex session
  - **Push** — push to remote after committing
  - **Create PR** — disabled until Push is ON; turning Push off auto-disables this
- **Commit button** — enters loading/disabled state during the operation

### Interaction Rules

- Create PR switch is disabled when Push is OFF
- Disabling Push also turns off Create PR
- Commit button is disabled while loading
- Dialog closes on success
- Errors display inline in the dialog
- All state (message, switches, errors, loading) resets when the dialog reopens

## Two Modes

### Direct Mode (Use Agent OFF)

1. User clicks Commit — button enters loading state
2. If message is empty, request a generated message via `GIT_GENERATE_COMMIT_MSG`
3. Send `GIT_COMMIT` with the message and push flag — backend runs `git add -A`, `git commit`, optionally `git push`
4. If Create PR is ON, send `GIT_CREATE_PR` — backend runs `gh pr create`
5. On success, close dialog
6. On error, show error in dialog

### Agent Mode (Use Agent ON)

1. User clicks Commit — dialog closes immediately
2. A new claude session is created via the existing `SESSION_CREATE` flow, scoped to the project (`projectId`). If claude is not available as a configured agent, fall back to codex.
3. A prompt is built from dialog state: commit message hint (if provided), push yes/no, create PR yes/no
4. The new agent tab opens and the user watches the agent work

## Backend

### New Message Types (MSG enum)

- `GIT_COMMIT` — stage all changes, commit with message, optionally push
- `GIT_GENERATE_COMMIT_MSG` — quick agent call to generate a commit message from the current diff
- `GIT_CREATE_PR` — create a pull request via `gh pr create`

### Git Service Additions (`git-service.ts`)

**`commit(repoPath: string, message: string, push: boolean)`**
- Runs `git add -A`
- Runs `git commit -m` with message passed as array arg to `Bun.spawn` (no shell interpolation)
- If push: runs `git push`
- Returns commit hash and message

**`createPr(repoPath: string, title: string, body?: string)`**
- Runs `gh pr create` with `--title` and `--body` as array args to `Bun.spawn`
- Returns PR URL

**`generateCommitMessage(repoPath: string)`**
- Uses the existing `diff()` method to get the full diff (covers staged, unstaged, and untracked files)
- Spawns a short-lived claude process with the diff as context
- Prompt: "Generate a concise git commit message for these changes. Output ONLY the commit message, nothing else."
- Returns the generated message string

### New Handlers (`git.ts`)

- `GIT_COMMIT` — validates path, calls `commit()`, returns `{ hash, message }`
- `GIT_GENERATE_COMMIT_MSG` — validates path, calls `generateCommitMessage()`, returns `{ message }`
- `GIT_CREATE_PR` — validates path, calls `createPr()`, returns `{ url }`

## Types

### New Types (`packages/shared/src/types/ws.ts`)

Following the existing pattern where all WebSocket payload/result types live in `ws.ts`:

```typescript
interface GitCommitPayload {
    path: string;
    message: string;
    push: boolean;
}

interface GitGenerateCommitMsgPayload {
    path: string;
}

interface GitCreatePrPayload {
    path: string;
    title: string;
    body?: string;
}

interface GitCommitResult {
    hash: string;
    message: string;
}

interface GitGenerateCommitMsgResult {
    message: string;
}

interface GitCreatePrResult {
    url: string;
}
```

Note: `GitGenerateCommitMsgPayload` has the same shape as the existing `GitStatusPayload`. Reuse `GitStatusPayload` if the project convention favors it; otherwise create the new type for clarity.

## Files to Create/Modify

### Create
- `packages/ui/src/components/workspace/CommitDialog.tsx` — dialog component

### Modify
- `packages/shared/src/constants.ts` — add `GIT_COMMIT`, `GIT_GENERATE_COMMIT_MSG`, `GIT_CREATE_PR` to MSG enum
- `packages/shared/src/types/ws.ts` — add new payload/result types
- `packages/backend/src/services/git-service.ts` — add `commit()`, `createPr()`, `generateCommitMessage()`
- `packages/backend/src/handlers/git.ts` — add handlers for the three new message types
- `packages/ui/src/components/workspace/TaskHeader.tsx` — add commit button before diff button

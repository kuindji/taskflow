# Worktree Post-Init Command Execution

## Overview

When a task is created with a worktree, allow an optional shell command to run in the worktree immediately after initialization and before the agent session starts. The command runs in a visible session tab with a 30-second timeout.

## Motivation

Worktree tasks often need setup steps (e.g. `bun install`, `./setup.sh`) before the agent can work effectively. Currently users must either run these manually or let the agent figure it out, wasting time. This feature automates that setup step.

## Design

### Data Model

Add `initCommand?: string` to the `Task` type. This is an optional field specified at task creation time.

```typescript
// In packages/shared/src/types/task.ts
interface Task {
    // ... existing fields
    initCommand?: string;
}
```

The `TASK_CREATE` message payload also gains `initCommand?: string`.

### CLI Interface

```
taskflow-cli task create "Fix login bug" --worktree --init "bun install"
```

The `--init` flag accepts a shell command string. It is only meaningful when `--worktree` is also specified.

### Backend Flow

The init command is handled in `worktree-setup.ts`, keeping the sequencing atomic in the backend.

After `gitService.createWorktree()` succeeds:

1. Update the task with `worktree.path`, `worktree.branch`, and `initCommand` (as today, plus new field).
2. If `initCommand` is set:
   a. Spawn a shell session in the worktree path via `session-lifecycle.createSession()`:
      - `type: "shell"`
      - `cwd: worktreePath`
      - `label: "Init"`
      - The command is written to stdin after spawn
   b. Wait for the session to exit, with a 30-second timeout (`Promise.race` between PTY exit and timer).
   c. On success: log info to task log.
   d. On failure (non-zero exit): log warning to task log, proceed anyway.
   e. On timeout: stop waiting, log warning. The session tab stays open (not killed).
3. Broadcast the `TASK_UPDATED` message (this unblocks the UI's pending agent start).

**Key change:** Today, `worktree-setup` broadcasts `TASK_UPDATED` immediately after setting the worktree path. With this change, the broadcast is deferred until after the init command completes or times out. The worktree path is set on the task before the init command runs (so the session can use it as cwd), but the broadcast that triggers agent start is held.

### Dependencies

`worktree-setup` currently depends on `taskStore`, `gitService`, `broadcast`, and `changeTracker`. Add:

- `createSession` from session-lifecycle — to spawn the init shell session
- A mechanism to await session exit — either a callback/promise from `createSession`, or listening on `ptyManager` for the session's exit event.

These are wired in `packages/backend/src/index.ts`.

### UI Changes

**`NewTaskDialog`:** Add a text input for the init command, visible when the worktree toggle is enabled. Placeholder: `bun install`. The value is passed as `initCommand` in the creation payload.

**`TaskCreationDialogHost`:** Pass `initCommand` through to the backend in the `TASK_CREATE` message. No sequencing changes — the existing "wait for `worktree.path`" logic works as-is since the backend delays the broadcast.

No other UI changes. The init session tab appears automatically via normal session broadcast.

### Session Visibility

The init session is a regular session tab on the task. It appears in the UI like any other shell session, labeled "Init". The user can watch the output in real time. It persists after completion.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/types/task.ts` | Add `initCommand?: string` to Task type |
| `packages/shared/src/types/messages.ts` | Add `initCommand` to `TASK_CREATE` payload |
| `packages/backend/src/handlers/task.ts` | Pass `initCommand` through to store and worktree setup |
| `packages/backend/src/services/worktree-setup.ts` | Accept `createSession` dep; spawn init shell, wait up to 30s, then broadcast |
| `packages/backend/src/services/title-generator.ts` | Pass `initCommand` through to `createWorktree` |
| `packages/backend/src/index.ts` | Wire `createSession` into worktree setup deps |
| `packages/ui/src/components/sidebar/NewTaskDialog.tsx` | Add init command input when worktree enabled |
| `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx` | Pass `initCommand` in create payload |
| CLI handler for `task create` | Add `--init` flag |
| Taskflow CLI skill/docs | Document `--init` flag |

## Constraints

- 30-second timeout: if the init command hasn't exited by then, agent start proceeds. The init session is not killed.
- On init command failure: log warning, proceed with agent start anyway.
- `--init` is only meaningful with `--worktree`. If specified without `--worktree`, it is ignored.
- Shell commands only (no action references or prompts) for the initial implementation.

# Move Session Between Owners — Design

Date: 2026-10-03
Status: approved in chat, pending spec review
Tracking: TaskTray TSK-3

## Problem

A session belongs to the owner it was started in (a task, a project or the
Master Workspace) for the rest of its life. Two cases need it moved:

- An agent creates a task for the work it is about to do and wants to continue
  there.
- A user started an agent in the wrong place and wants to file it under the
  right task.

Today the only option is to close the session and start a new one, which throws
away the agent's context.

## Goals

1. Move a live agent session to another owner: any task, project-level slot or
   Master Workspace on the same backend, in any direction.
2. Two ways in:
   - `taskflow-cli session move`, which by default moves the caller's own
     session;
   - dragging an agent tab from the tab bar onto a task card or project row in
     the desktop sidebar.
3. The process keeps running untouched: same PTY, same `cwd`, no restart.
4. After a move, `taskflow-cli` called from inside the session acts on the new
   owner.

## Non-goals

- Moving shell or editor sessions.
- Moving flow sessions (`SessionRef.flow` set) or the remote agent's session
  (`SessionRef.remoteControl`).
- Moves across machines (backends) or across instances (`main` / `dev-*`).
- Changing the session's `cwd`, worktree or agent system prompt. An agent that
  started at project scope keeps its project-scope instructions; only the CLI
  follows the move.
- A UI gesture for moving *into* the Master Workspace. It has no sidebar row;
  moves into Master go through the CLI.
- Keeping the tab's split pane or position across the move.
- A TUI gesture. TUI agents move through the CLI.
- Protecting a moved session from its source task's worktree being deleted.
  The session's `cwd` disappears, the same as for any process running in a
  deleted worktree.

## Terms

- **Owner**: `SessionOwner` (`packages/backend/src/services/session-lifecycle.ts:32-36`),
  exactly one of `{taskId}`, `{projectId}` or `{master: true}`.
- **Owner id**: the key used for session logs. It is the task id, the project
  id, or the literal `"master"` (`session-lifecycle.ts:504`).

## Backend

### Current owner registry

`createSession` captures `ownerId`, `task`, `resolvedProjectId` and `master` in
the closures it gives the PTY (`session-lifecycle.ts:543-598`) and the
native-session discovery callback (`:688-715`). After a move, all three would
act on the old owner:

- output goes on being appended to the old log file;
- on exit, the session is "removed" from an owner that no longer lists it, so
  the target keeps a stale live ref and its log is never deleted;
- a late-discovered `nativeSessionId` is written nowhere, so the session cannot
  be resumed after a restart.

The lifecycle therefore keeps a `Map<sessionId, SessionOwner>` holding the
current owner of every registered (non-`internal`) live session. It is written
by `createSession` (spawn and resume) and by the move, and deleted on exit.
`onData`, `onExit` and the discovery callback look the owner up from the map at
call time instead of using the captured values, and derive the owner id with
one shared helper, `ownerIdOf(owner)`. Internal sessions are never in the map
and keep their current behaviour.

### `moveSession(sessionId, target)`

A new lifecycle function. `target` is a `SessionOwner`. It runs these checks in
order, and the first failure throws an `Error` whose message is shown to the
user:

1. The session is in the registry and `ptyManager.has(sessionId)`: "Session is
   not running".
2. Its `SessionRef` exists in the current owner's list, `isAgentType(type)` is
   true, `flow` is unset and `remoteControl` is unset: "Only agent sessions can
   be moved", "Flow sessions cannot be moved", "The remote agent session cannot
   be moved".
3. `instance === config.instanceId`: "Session belongs to another instance".
4. The target is exactly one of task, project or master, and it exists:
   - a task must be active, not archived: "Task not found";
   - a project must exist: "Project not found";
   - master always exists.
5. The target is not the current owner: "Session is already there".

Then:

1. Remove the ref from the source list and append it, unchanged, to the target
   list. All fields are kept (`instance`, `bootId`, `state`, `cwd`,
   `nativeSessionId`, `agentOptions`, …). Task and project lists use the
   updater forms of `updateTask` / `updateProject`, so refs belonging to other
   instances are preserved. Master uses the master-session mutation helpers.
   The target is written before the source is removed, so a crash between the
   two leaves a duplicate (which the boot reconcile tolerates) rather than a
   lost session.
2. Rename the session log from `${sourceOwnerId}--${sid}.jsonl` to
   `${targetOwnerId}--${sid}.jsonl`. This is a new `TaskStore.moveSessionHistory`
   that holds the log mutation queues for both paths (`withSessionLogMutation`,
   `task-store.ts:686`) and moves the `sessionLogSizes` entry. A missing source
   log is not an error.
3. Update the registry.
4. Broadcast both owners: `TASK_UPDATED`, `PROJECT_UPDATED` or
   `MASTER_SESSIONS_LIST`, through the existing `broadcastTaskUpdate` /
   `broadcastProjectUpdate` helpers (`session-lifecycle.ts:210-228`).

The checks and steps 1–3 run under one per-session lock, so two concurrent
moves of the same session are serialized. The second sees the first one's
result: it either fails check 5 or moves the session on from where the first
left it. Step 4 runs after the lock is released.

### Owner lookup

`getSessionOwner(sessionId)` returns the registry entry. A task owner also
carries its `projectId`, so the CLI can set both variables. It returns null for
unknown and internal sessions.

### API

| Transport | Name | Payload | Result |
|---|---|---|---|
| WS | `MSG.SESSION_MOVE` | `{ sessionId, taskId? , projectId?, master? }` | `{ success: true }` |
| REST | `POST /api/sessions/:sessionId/move` | `{ taskId? , projectId?, master? }` | `{ success: true }` |
| REST | `GET /api/sessions/:sessionId/owner` | — | `{ taskId?, projectId?, master? }`, or 404 |

The payload types go in `packages/shared/src/types/ws.ts`, next to the other
session payloads. The REST routes go in `api/routes/session-routes.ts`; a
failed check returns 400 with the error message. The WS handler goes in
`handlers/session.ts`.

## CLI

Both implementations change the same way:
`packages/backend/src/services/taskflow-cli.sh` (POSIX, used on macOS/Linux)
and `taskflow-cli-bin.ts` (Windows).

### Owner resolution

After the global flags are parsed: if neither `--task` nor `--project-id` was
given and `TASKFLOW_SESSION_ID` is set, call
`GET /api/sessions/$TASKFLOW_SESSION_ID/owner`.

- On success, **replace** `TASKFLOW_TASK_ID` and `TASKFLOW_PROJECT_ID` with the
  result (both cleared first; master clears both).
- On any failure (404 for internal or headless sessions, connection error), keep
  the environment values.

Explicit flags always win. `--help` does not trigger the lookup.

### `session move`

```
taskflow-cli session move --task <id> [--session <id>]
taskflow-cli session move --project <id> [--session <id>]
taskflow-cli session move --master [--session <id>]
```

Exactly one target flag is allowed. `--session` defaults to
`$TASKFLOW_SESSION_ID`. The command prints the backend's JSON. An error exits
non-zero with the backend's message.

### Docs

- `taskflow-cli-session-commands.md`: document `session move` and say that the
  CLI follows a moved session.
- `taskflow-cli-task-commands.md:9`: the note on the task context gains one
  sentence saying that inside a session the context is the session's current
  owner.

## Desktop UI

### Dragging a tab out of the tab bar

Tab drag uses dnd-kit in one of two contexts: `TabBar`'s own when the workspace
is not split (`TabBar.tsx:143-166`), `SplitContainer`'s when it is
(`SplitContainer.tsx:69-205`). The sidebar has a separate context, and dnd-kit
cannot drop across contexts, so the sidebar is targeted by hit-testing instead
of with droppables.

- Sidebar drop targets get `data-session-drop="task:<id>"` (task card) or
  `data-session-drop="project:<id>"` (project row), plus the backend id in
  `data-session-drop-backend`.
- A hook, `useSessionMoveDrag(workspaceKey)`, returns `onDragStart`,
  `onDragMove`, `onDragEnd` and `onDragCancel`, and both contexts call it next
  to their existing handlers.
  - `onDragMove` computes the pointer position (activator coordinates plus
    delta), calls `document.elementFromPoint`, finds the closest
    `[data-session-drop]`, and stores the target in the UI store only if the
    drop is valid (below).
  - `onDragEnd` with a stored target sends `SESSION_MOVE` to the session's
    backend and skips the existing reorder and pane-move logic. With no target
    it falls through to that logic unchanged.
  - Cancel and end clear the stored target.
- The target element highlights while its id matches the stored target.
- `TabBar`'s context gets the same `DragOverlay` as `SplitContainer`, so the tab
  stays visible outside the clipped, scrolling tab strip.

The hook and a pure resolver (pointer element → candidate target) live in their
own module, so the rules can be unit-tested without dnd-kit.

### Valid drop

All of these must hold:

- The tab is an agent session whose `SessionRef` has neither `flow` nor
  `remoteControl`. The tab store already carries the session type; the two
  flags come from the owner's session list.
- The target's backend equals `sessionBackend(sessionId)`.
- The target is not the tab's current owner. The tab is in the workspace being
  dragged from, so its owner is the workspace key.

Invalid targets never highlight, and dropping on them does nothing extra.

### After the drop

There is no optimistic change. The backend's broadcasts drive the existing
session sync (`stores/session-sync.ts`): the tab leaves the source workspace and
appears at the end of the target's main pane. The user stays where they are. A
rejected move shows a toast with the backend's message.

### Terminal links

`terminal-links.ts:14-30` resolves relative paths against the owner's worktree
or project path. It switches to the session's own `SessionRef.cwd` when that is
set and falls back to the current behaviour otherwise, so a moved session's
links still resolve against the directory it is really in.

## TUI

No new gesture. Its session list and history replay must follow the owner
broadcasts. If they don't, that is fixed as part of this work
(`tui/src/opentui/session-bridge.ts:167-169`, `sessions/owner.ts`).

## Error handling summary

| Case | Where caught | User sees |
|---|---|---|
| Shell, editor, flow or remote-agent session | backend check; UI never highlights | CLI error / no drop target |
| Target on another machine | UI never highlights; backend "Task not found" | no drop target / CLI error |
| Archived or missing target | backend | CLI error / toast |
| Session exited mid-drag | backend "Session is not running" | toast |
| Owner lookup fails in CLI | CLI | silent fallback to env |

## Testing

- **Backend unit/integration** (`tests/handlers/session.test.ts` style, fake
  PTY):
  - each refusal;
  - task→task, project→task, task→project, master→task and task→master moves;
  - log rename, including output written after the move landing in the new file;
  - exit after a move removes the ref from the target and deletes the new log;
  - native-session-id discovery after a move writes to the target;
  - both owners broadcast;
  - other-instance refs survive.
- **Task store**: `moveSessionHistory` with a missing source log and with
  concurrent appends.
- **CLI** (`tests/services/taskflow-cli.test.ts`, fake curl):
  - `session move` for each target flag, plus the conflicting-flags error;
  - owner lookup replaces the environment variables;
  - explicit `--task` skips the lookup;
  - a 404 falls back to the environment.
  - The TS binary gets equivalent coverage where its tests exist.
- **UI**:
  - the pure resolver and valid-drop rules;
  - `terminal-links` cwd preference.
- **Manual** (dev backend sandbox): drag an agent tab from a project onto a
  task, then from that task onto another project; check that the transcript
  replays in the target; run `taskflow-cli session move --task` from inside an
  agent and confirm `taskflow-cli task` then reports the new task.

## Amendments (plan review, 2026-10-03)

The plan review (gpt-6.1-sol, each finding verified against the code) changed these points. Where they conflict with the sections above, these win.

- **Move order:** rename the log → add the ref to the target → remove it from the source → update the registry. Each step undoes the earlier ones if it fails (best effort). The earlier "target before source" note stands, but the log now moves first.
- **Boot repair:** `TaskStore.repairMovedSessions` runs before reconcile and the orphan sweep. A session listed by two owners keeps the copy whose log exists. A log filed under an owner that doesn't list its session is re-filed under the one owner that does. The earlier claim that boot reconcile "tolerates" a duplicate was wrong; this replaces it.
- **Owner locks:** a move holds `TaskStore.withOwnerLocks` on its source and target. Task archive and delete (WS and REST) and project removal (WS and REST) hold the same locks for their whole read → close → mutate sequence. Without this, archiving the task a session just joined could archive it with its process still running.
- **One queue per session:** output appends, history reads (`SESSION_HISTORY`), moves, exit cleanup and native-id discovery all run on it. A session is registered for moves only after its `SessionRef` is persisted, so a move can't copy the ref of a session still being created or resumed.
- **Shutdown:** `prepareForShutdown` stops admitting moves (`Taskflow is shutting down`) and waits for in-flight moves before marking sessions interrupted. Shutdown drains queued output after closing the PTYs.
- **UI hit-testing:** uses the real pointer position (a capturing `pointermove` listener), not dnd-kit's scroll-adjusted delta, and `document.elementsFromPoint`, so the drag overlay under the cursor doesn't hide the sidebar. A drop anywhere inside the sidebar is consumed (it moves on a valid target, otherwise does nothing). Only drops outside the sidebar reach the existing reorder and pane-move logic.
- **UI refusals:** use the existing `alert()` dialog, titled "Couldn't move session". There is no toast system.
- **Tabs:** they carry the session's `cwd`. Master tabs refresh through the shared `syncPaneTabs`. Terminal file links and in-app URL opening look the session's tab up when a link is used, so they follow the session after a move, including into Master.

### Round 2 (2026-10-03)

- **Owner locks** reserve all their keys at call time, so each key serves callers in call order. Nested per-key acquisition let a later caller overtake.
- **Master store:** add, remove and update write the new list first and only then replace the cached list. A failed write no longer leaves the cache disagreeing with disk.
- **Native discovery** releases the agent's launch lock as soon as the native id is identified, before it queues on the session. Holding it until the write finished made a lock cycle: move → archive → FlowRunner launch → discovery → move.
- **Shutdown:** an exit during shutdown deregisters the session on its queue, behind the output the PTY flushed just before exiting. That output lands in the current owner's log.
- **Client close:** `SESSION_CLOSE` removes the ref from the current owner on the session's queue, then kills the PTY.
- **Lock order:** the session queue, then owner locks, then FlowRunner's owner lock, then the native launch lock, then file locks.
- **Failed undo:** a move whose undo also fails logs it and rethrows the original error. Boot repair fixes a duplicate ref. A transcript left under the target's log name is lost from replay. This is accepted.
- **UI:** the drop zone is the whole sidebar panel (`AppShell`'s `data-panel="sidebar"` wrapper), including both toolbars. Terminal file links resolve the workspace and owner of the session's current tab at click time, not the ones the terminal was mounted with.
- **Not changed:** creates and resumes are not gated at shutdown. Boot reconcile marks a same-instance live ref from an earlier boot interrupted, so a late ref recovers the same way. Owner locks are per process. A cross-instance archive or delete already races with every live session, and each move step fails closed under the cross-process file locks.

### Round 3 (2026-10-03)

- **File links into Master:** `sessionWorkspace()` returns the owner as a `SessionOwnerRef`, `{ master: true }` for Master. Link activation passes it to `openFileInApp`, which takes a `SessionOwnerRef`. Before this, a CLI editor (`settings.editor.internalEditor`) opened nothing for a Master session's file link, because `createSession` rejects an empty owner.
- **Editor sessions follow the pane:** `openFileInApp` creates a CLI editor session in the workspace key it was given (`targetWorkspaceKey`), so a link clicked in a right pane opens its editor there.
- **Master write test seam:** `TaskStore` takes optional `FileOperations` for the Master list's write. Store tests make the write fail and check that the cache still matches disk after add, remove, update and reconcile.

### Round 4 (2026-10-03)

- **Bare filename links** pass the session's owner too. Before this, a CLI editor never opened a bare filename (`a.ts`), in any workspace.
- **Failed editor creates:** `createSession` releases its `pendingSessionCreates` mark in `finally`. A failed create aimed at a pane used to leave the mark set, and syncs then stopped giving that owner's new sessions a tab, including sessions moved into it.
- **Markdown links:** `MarkdownPaneImpl` passes its own pane key, so a CLI editor opened from a right-pane Markdown link opens in the right pane too.

### Round 5 (2026-10-03)

- No design change. The one finding was a test command in the plan.

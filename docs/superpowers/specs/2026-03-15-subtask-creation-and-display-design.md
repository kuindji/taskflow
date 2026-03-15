# Subtask Creation and Display Support

## Overview

Add single-level subtask support to Taskflow. Subtasks are regular tasks with a `parentId` linking them to a parent. They inherit the parent's project and worktree, appear nested in the sidebar, and cascade on archive/delete.

## Data Model

### Task type changes (`packages/shared/src/types/task.ts`)

Add `parentId?: string` to the `Task` interface. Undefined for top-level tasks, set for subtasks. This field is also added to the `createTask` input type in `task-store.ts`.

No `children` array — subtasks are derived by filtering tasks where `parentId === task.id`.

### WebSocket payload changes (`packages/shared/src/types/ws.ts`)

`TaskCreatePayload` gains `parentId?: string`. No new message types — subtasks use the same `task:create`, `task:update`, `task:archive`, `task:delete` messages.

### Storage

No structural changes. Subtasks are stored as regular task JSON files in the same `tasks/` directory. The `parentId` field is the only link.

## Backend Logic

### Task creation (`packages/backend/src/services/task-store.ts`, `packages/backend/src/handlers/task.ts`)

When `parentId` is provided in a create request:

1. Validate parent exists and is active (not archived)
2. Validate parent is not itself a subtask (enforce single level — `parent.parentId` must be undefined)
3. Copy parent's `projectId` to the subtask
4. Copy parent's worktree config to the subtask (`worktree: { enabled, path, branch }` from parent)

The `worktree` field in `TaskCreatePayload` is ignored for subtasks — always inherited.

### Archive cascade

- `archiveTask(id)`: If the task has subtasks, archive all of them and stop their active sessions (existing handler already calls `stopTaskSessions` for the target task — extend to subtasks).
- `unarchiveTask(id)`: If the task has archived subtasks, unarchive them all automatically (no prompt).
- The UI determines subtask count locally from its own `tasks` array — no preflight request needed. The confirmation dialog is shown before sending the archive request.

### Delete cascade

- `deleteTask(id)`: If the task has subtasks, delete all of them and stop their active sessions first.
- The UI determines subtask count locally and shows confirmation before sending the delete request.
- Worktree cleanup: Subtasks share the parent's worktree, so only the parent's delete dialog offers the "delete worktree" toggle. When deleting a single subtask (not via parent cascade), the delete dialog does not show the worktree toggle, and the backend ignores `deleteWorktree` for subtasks (tasks with `parentId`).

### Listing

`listTasks()` returns all tasks including subtasks (flat list). The UI groups them by `parentId`.

A helper `getSubtasks(parentId)` is added for convenience (filters active tasks by parentId).

### Session CWD

No changes. Subtasks inherit `worktree.path` from the parent, so the existing logic (`task.worktree.path || project.path`) works as-is.

## UI: Sidebar Task List

### Rendering logic in ProjectGroup

`ProjectGroup` receives the flat `tasks` array. It partitions tasks into:
- **Top-level tasks**: tasks where `parentId` is undefined
- **Subtask map**: `Map<string, Task[]>` keyed by `parentId`

For each top-level task, render:
1. The task card (with chevron if it has entries in the subtask map)
2. If expanded, render its subtasks indented below it

### Parent tasks with subtasks

- **Expand/collapse chevron**: Appears left of the title when a task has subtasks. Right-pointing when collapsed, rotated 90° when expanded. Tasks without subtasks show no chevron.
- **"+" button**: Appears on hover for all top-level tasks, next to the existing archive and delete buttons. Opens the NewTaskDialog configured for subtask creation.

### Subtask rendering

- Indented with left margin and a left border connector line
- Slightly smaller text (12px vs 13px)
- Show their own session badges
- No worktree badge (inherited from parent, not independently managed)
- No "+" button (single level only — subtasks cannot have children)
- No expand/collapse chevron

### Expand/collapse state

- All parent tasks start collapsed on app launch (not persisted)
- Managed in `useTaskStore` as `expandedTasks: Set<string>` with a `toggleTaskExpanded(taskId)` action
- Creating a subtask auto-expands its parent

## UI: NewTaskDialog Changes

When creating a subtask (triggered by "+" on a parent task), the dialog receives a `parentId` prop:

- **Dialog title**: "New subtask" instead of "New task"
- **Project selector**: Hidden — inherited from parent
- **Worktree toggle**: Hidden — inherited from parent
- **Description, title, "Start with" agent selector**: Same as regular task creation

The create payload includes `parentId`, and the backend handles project/worktree inheritance.

## UI: Confirmation Dialogs

Archive confirmation is a new dialog added to `TaskCard`. Currently archive has no confirmation — it fires immediately. With subtasks, a confirmation is needed only when the parent has subtasks.

### Archive parent with subtasks

> "This task has N subtasks that will also be archived. Archive all?"
> [Cancel] [Archive]

Shown only when the task has subtasks (count computed from UI store). Tasks without subtasks archive immediately as before.

### Delete parent with subtasks

> "This will permanently delete this task and its N subtasks, their sessions, and all logs. This action cannot be undone."
> [worktree toggle if applicable]
> [Cancel] [Delete]

### Unarchive

No dialog — silently unarchives parent and all subtasks.

## UI: State Management

- `useTaskStore` already holds a flat `tasks` array. Subtasks live in the same array.
- Derived helper: `getSubtasks(parentId)` — filters tasks by `parentId`
- New state: `expandedTasks: Set<string>` to track expanded parent tasks in the sidebar (ephemeral, not persisted)
- New action: `toggleTaskExpanded(taskId)` to flip expand/collapse
- `archiveTask(id)`: After the backend call, also remove subtasks from local `tasks` array (filter by `parentId === id`)
- `deleteTask(id)`: Same — remove subtasks locally after backend call
- `unarchiveTask(id)`: Re-fetch tasks after unarchive to pick up cascade-unarchived subtasks (or backend returns them)
- When the active task is a subtask whose parent gets archived/deleted, clear `activeTaskId`
- No changes to workspace store, session store, or WebSocket hooks

## UI: Workspace

Subtasks open in the same full workspace view as regular tasks — own session tabs, description, notes, log. Clicking a subtask in the sidebar sets it as the active task, identical to clicking a top-level task.

## Files to Modify

### Shared package
- `packages/shared/src/types/task.ts` — add `parentId` to Task
- `packages/shared/src/types/ws.ts` — add `parentId` to TaskCreatePayload

### Backend
- `packages/backend/src/services/task-store.ts` — creation validation, archive/delete cascade, getSubtasks helper
- `packages/backend/src/handlers/task.ts` — pass parentId through, return subtask counts for cascade operations

### UI
- `packages/ui/src/stores/task-store.ts` — expandedTasks state, toggleTaskExpanded, getSubtasks helper
- `packages/ui/src/components/sidebar/TaskCard.tsx` — chevron for parents, "+" button, subtask indent styling
- `packages/ui/src/components/sidebar/ProjectGroup.tsx` — render subtasks nested under parents
- `packages/ui/src/components/sidebar/NewTaskDialog.tsx` — parentId prop, hide project/worktree for subtasks

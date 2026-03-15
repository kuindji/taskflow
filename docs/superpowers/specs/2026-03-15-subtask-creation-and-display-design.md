# Subtask Creation and Display Support

## Overview

Add single-level subtask support to Taskflow. Subtasks are regular tasks with a `parentId` linking them to a parent. They inherit the parent's project and worktree, appear nested in the sidebar, and cascade on archive/delete.

## Data Model

### Task type changes (`packages/shared/src/types/task.ts`)

Add `parentId?: string` to the `Task` interface. Undefined for top-level tasks, set for subtasks.

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

- `archiveTask(id)`: If the task has subtasks, archive all of them. The handler returns the subtask count so the UI can show a confirmation dialog.
- `unarchiveTask(id)`: If the task has archived subtasks, unarchive them all automatically (no prompt).

### Delete cascade

- `deleteTask(id)`: If the task has subtasks, delete all of them. The handler returns the subtask count so the UI can show a confirmation dialog.
- Worktree cleanup: Subtasks share the parent's worktree, so only the parent's delete dialog offers the "delete worktree" toggle. Subtask deletion never touches the worktree.

### Listing

`listTasks()` returns all tasks including subtasks (flat list). The UI groups them by `parentId`.

A helper `getSubtasks(parentId)` is added for convenience (filters active tasks by parentId).

### Session CWD

No changes. Subtasks inherit `worktree.path` from the parent, so the existing logic (`task.worktree.path || project.path`) works as-is.

## UI: Sidebar Task List

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

## UI: NewTaskDialog Changes

When creating a subtask (triggered by "+" on a parent task), the dialog receives a `parentId` prop:

- **Dialog title**: "New subtask" instead of "New task"
- **Project selector**: Hidden — inherited from parent
- **Worktree toggle**: Hidden — inherited from parent
- **Description, title, "Start with" agent selector**: Same as regular task creation

The create payload includes `parentId`, and the backend handles project/worktree inheritance.

## UI: Confirmation Dialogs

### Archive parent with subtasks

> "This task has N subtasks that will also be archived. Archive all?"
> [Cancel] [Archive]

### Delete parent with subtasks

> "This will permanently delete this task and its N subtasks, their sessions, and all logs. This action cannot be undone."
> [worktree toggle if applicable]
> [Cancel] [Delete]

### Unarchive

No dialog — silently unarchives parent and all subtasks.

## UI: State Management

- `useTaskStore` already holds a flat `tasks` array. Subtasks live in the same array.
- Derived helper: `getSubtasks(parentId)` — filters tasks by `parentId`
- New state: `expandedTasks: Set<string>` to track expanded parent tasks in the sidebar
- New action: `toggleTaskExpanded(taskId)` to flip expand/collapse
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

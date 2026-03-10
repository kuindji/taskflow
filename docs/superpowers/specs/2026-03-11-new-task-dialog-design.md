# New Task Dialog + Internal Agent API

## Overview

Replace `window.prompt()` task creation with a custom dialog. Add an HTTP REST API so agents running in PTY sessions can call back into Taskflow. Auto-generate task titles from descriptions using a background Claude CLI call.

## 1. Internal HTTP API

### Transport

Add REST endpoints to the existing `Bun.serve` fetch handler in `ws/server.ts`. Currently non-WebSocket requests return a static "Taskflow backend" response — route them to an API handler instead.

### Endpoints

**`PATCH /api/tasks/:taskId`**
- Accepts JSON body with any updatable task fields: `title`, `description`, `notes`
- Returns the updated task object
- After mutation, broadcasts a `task:updated` WebSocket event so the UI updates reactively

**`POST /api/sessions/:sessionId/done`**
- Signals the session is complete
- Backend kills the PTY process and removes the session ref from the owning task
- Broadcasts `session:exited` WebSocket event

### Agent Environment Variables

Injected into every PTY spawn via `PtyManager`:
- `TASKFLOW_API_URL` — full base URL, e.g. `http://localhost:59234`
- `TASKFLOW_TASK_ID` — the task this session belongs to
- `TASKFLOW_SESSION_ID` — this session's ID

The session handler must pass port, taskId, and sessionId to `PtyManager.spawn()` so it can construct these env vars.

## 2. New Task Dialog

### Component

`NewTaskDialog.tsx` — a controlled dialog component using existing shadcn Dialog primitives.

### Layout (compact vertical)

Fields stacked vertically:
1. **Project** — dropdown/select (required). Pre-selected from active task's project or first project in list.
2. **Description** — textarea (required). Placeholder: "Describe what this task should accomplish..."
3. **Title** — text input (optional). Helper text: "auto-generated from description if left blank"
4. **Use git worktree** — toggle switch
5. **Footer** — Cancel and Create Task buttons

Create Task button disabled until project is selected and description is non-empty.

### Integration

`TaskSidebar.tsx` replaces `window.prompt()` with dialog open state. The `handleNewTask` function becomes a simple `setDialogOpen(true)`. The dialog's submit handler calls `createTask()` with the full payload.

## 3. Title Auto-Generation

### Flow

1. User submits dialog with no title
2. Task is created with `title: ""` in the backend
3. UI shows truncated description (with ellipsis) in sidebar: `task.title || truncate(task.description, 40) + '…'`
4. Backend spawns `claude -p "Generate a concise task title (3-7 words) for this task description: {description}"` using `Bun.spawn` with `stdout: 'pipe'` (not a PTY — this is a simple background process)
5. On completion, backend updates `task.title` and broadcasts the change via WebSocket
6. UI reactively swaps the display — no loading indicator, silent update

### Why not use the internal API for this?

Title generation is a backend-internal operation. No agent session needs to exist. Using `Bun.spawn` directly with piped stdout is simpler and faster than creating a full PTY session.

## 4. Shared Type Changes

### `TaskCreatePayload`

Add `worktree` field:
```typescript
interface TaskCreatePayload {
  projectId: string;
  title?: string;       // make optional
  description: string;  // make required
  worktree?: boolean;
}
```

### WebSocket Events

Add `task:updated` event type for broadcasting task mutations from the HTTP API. The UI task store listens for this event and merges the update.

## 5. Files Changed

| File | Change |
|------|--------|
| `packages/backend/src/ws/server.ts` | Route HTTP requests to API handler |
| `packages/backend/src/api/routes.ts` | New — HTTP route handler for REST endpoints |
| `packages/backend/src/services/pty-manager.ts` | Accept and inject `TASKFLOW_*` env vars |
| `packages/backend/src/handlers/session.ts` | Pass port/taskId/sessionId to PtyManager |
| `packages/backend/src/services/title-generator.ts` | New — background `claude -p` spawn, parse output, update task |
| `packages/backend/src/handlers/task.ts` | Trigger title generation when title is empty on create |
| `packages/shared/src/types/ws.ts` | Update `TaskCreatePayload`, add `task:updated` event |
| `packages/shared/src/types/task.ts` | No changes needed (Task type already has all fields) |
| `packages/shared/src/constants.ts` | Add `TASK_UPDATED` message constant |
| `packages/ui/src/components/sidebar/NewTaskDialog.tsx` | New — dialog component |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Replace `window.prompt` with dialog |
| `packages/ui/src/stores/task-store.ts` | Update `createTask` signature, listen for `task:updated` events |

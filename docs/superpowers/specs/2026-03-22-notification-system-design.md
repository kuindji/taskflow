# Notification System Design

## Overview

Introduce a notification system to Taskflow. Agents create notifications via `taskflow-cli notify "message"`. Notifications are stored on disk, displayed in the UI sidebar, and trigger native desktop alerts via Electron's `Notification` module.

## Data Model

```typescript
interface Notification {
  id: string;         // UUID
  projectId: string;  // required — which project
  sessionId: string;  // required — which session created it
  taskId?: string;    // optional — which task
  message: string;    // notification text
  read: boolean;      // read/unread state
  createdAt: string;  // ISO timestamp
}
```

Storage: `<dataDir>/notifications.json` as a JSON array. No auto-cleanup; notifications persist indefinitely.

## Backend

### NotificationStore

New store class at `packages/backend/src/services/notification-store.ts`. Follows the same `withMutation` serialization pattern as `TaskStore`, using a single mutex key since all operations contend on the same file.

Methods:
- `list()` — returns all notifications
- `create(projectId, sessionId, message, taskId?)` — generates UUID, appends to file, returns notification
- `markAsRead(id)` — sets `read: true`
- `delete(id)` — removes single notification
- `deleteAll()` — clears all notifications

No `init()` method needed — the file's parent directory (`dataDir`) already exists.

### HTTP API Routes

For CLI and UI consumption:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/notifications` | Create notification. Body: `{ message }`. `projectId`, `sessionId`, `taskId` from request headers (injected by CLI from env vars). Requires `projectId` and `sessionId`; returns 400 if missing. |
| `GET` | `/api/notifications` | List all notifications. |
| `PATCH` | `/api/notifications/:id` | Mark single notification as read (always sets `read: true`, body ignored). |
| `DELETE` | `/api/notifications/:id` | Delete single notification. |
| `DELETE` | `/api/notifications` | Delete all notifications. |

### WebSocket Messages

New message type constants in `packages/shared/src/constants.ts`:

```
NOTIFICATION_LIST: "notification:list"
NOTIFICATION_CREATED: "notification:created"
NOTIFICATION_UPDATED: "notification:updated"
NOTIFICATION_DELETED: "notification:deleted"
```

- `NOTIFICATION_LIST` — request/response to fetch all notifications on connect
- `NOTIFICATION_CREATED` — broadcast when a notification is created (payload: the notification object)
- `NOTIFICATION_UPDATED` — broadcast when a notification is marked as read (payload: the notification object)
- `NOTIFICATION_DELETED` — broadcast on delete:
  - Single delete payload: `{ id: string }`
  - Delete-all payload: `{ all: true }`

### Desktop Notification Delivery

The backend and Electron run as separate OS processes. Electron already connects to the backend's WebSocket for session events. To receive notification events:

- Electron's main process connects to the backend WebSocket (reusing the existing connection used for session monitoring)
- Listens for `NOTIFICATION_CREATED` events
- On receiving one, creates a native `Notification` via Electron's `Notification` module

This avoids any new IPC mechanism — just subscribes to the same broadcast channel the UI uses.

## CLI

Single new command added to `taskflow-cli.sh`:

```
taskflow-cli notify "message"
```

Creates a notification using the session's `TASKFLOW_PROJECT_ID`, `TASKFLOW_SESSION_ID`, and optionally `TASKFLOW_TASK_ID` environment variables. Exits with error if `TASKFLOW_PROJECT_ID` or `TASKFLOW_SESSION_ID` are not set.

The `taskflow-cli-skill.md` system prompt documentation is updated to include this command. No other system prompt changes.

## Electron Integration

### Creating Desktop Notifications

- Electron's main process listens for `NOTIFICATION_CREATED` on its WebSocket connection to the backend
- On event: creates `new Notification({ title: "Taskflow", body: message })`
- Works even when the renderer window is hidden/closed since `Notification` runs in the main process

### Handling Notification Click

- On click: show/focus the main window if hidden
- Send IPC event `notification-clicked` to renderer with `{ id, projectId, sessionId, taskId? }`
- Renderer handles navigation to the right project/task and session tab
- If the project, task, or session no longer exists, navigation is silently skipped

### Preload Bridge

Add `onNotificationClicked` to `preload.ts`:

```typescript
onNotificationClicked: (callback: (payload: { id: string; projectId: string; sessionId: string; taskId?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ...) => callback(payload);
    ipcRenderer.on("notification-clicked", listener);
    return () => ipcRenderer.removeListener("notification-clicked", listener);
}
```

## UI

### Sidebar Button

Located in the sidebar footer (left side, alongside existing buttons):
- Only rendered when `notifications.length > 0`
- Displays an unread count badge when `unreadCount > 0`
- Clicking opens a popover anchored to the button

### Notification Popup

- Header: "Notifications" title + "Dismiss all" button (deletes all notifications)
- Scrollable list, newest first
- Each item displays:
  - Message text
  - Project name
  - Relative timestamp (e.g. "2m ago")
- Unread items have a visual indicator (dot or highlighted background)
- Clicking a notification: marks as read, navigates to project/task/session tab
- Each item has a dismiss (X) button for individual deletion
- No empty state needed — button hides when there are no notifications

### State Management

- Zustand store for notification state
- Notifications fetched via WebSocket `NOTIFICATION_LIST` request on connect (same pattern as tasks/projects)
- Store updated reactively via `NOTIFICATION_CREATED`, `NOTIFICATION_UPDATED`, `NOTIFICATION_DELETED` WebSocket events
- Derived selectors: `notifications`, `unreadCount`
- Listens for `notification-clicked` IPC from Electron (desktop notification click) and handles navigation

## Config Changes

- Add `notificationsFile: join(dataDir, "notifications.json")` to `config.ts` `buildDataPaths()`
- No new directories needed (single file, not a directory)

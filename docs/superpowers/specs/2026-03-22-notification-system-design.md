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

New store class at `packages/backend/src/services/notification-store.ts`. Follows the same `withMutation` serialization pattern as `TaskStore`.

Methods:
- `list()` — returns all notifications
- `create(projectId, sessionId, message, taskId?)` — generates UUID, appends to file, returns notification
- `markAsRead(id)` — sets `read: true`
- `markAllAsRead()` — sets all to `read: true`
- `delete(id)` — removes single notification
- `deleteAll()` — clears all notifications

### HTTP API Routes

For CLI consumption:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/notifications` | Create notification. Body: `{ message }`. `projectId`, `sessionId`, `taskId` from request headers (injected by CLI from env vars). |
| `GET` | `/api/notifications` | List all notifications. |
| `PATCH` | `/api/notifications/:id` | Mark as read. Body: `{ read: true }`. |
| `DELETE` | `/api/notifications/:id` | Delete single notification. |
| `DELETE` | `/api/notifications` | Delete all notifications. |

### WebSocket Messages

New message type constants in `packages/shared/src/constants.ts`:

```
NOTIFICATION_CREATED: "notification:created"
NOTIFICATION_UPDATED: "notification:updated"
NOTIFICATION_DELETED: "notification:deleted"
```

- `NOTIFICATION_CREATED` — broadcast when a notification is created (payload: the notification object)
- `NOTIFICATION_UPDATED` — broadcast when a notification is marked as read (payload: the notification object)
- `NOTIFICATION_DELETED` — broadcast when notifications are deleted (payload: `{ id }` or `{ all: true }`)

### Desktop Notification Hook

The backend exposes a callback registration point. Electron's main process registers a callback at startup. When a notification is created via the HTTP API, the backend invokes this callback with `{ id, message, projectId, sessionId, taskId? }`. This allows the main process to fire native desktop notifications without listening to WebSocket.

## CLI

Single new command added to `taskflow-cli.sh`:

```
taskflow-cli notify "message"
```

Creates a notification using the session's `TASKFLOW_PROJECT_ID`, `TASKFLOW_SESSION_ID`, and optionally `TASKFLOW_TASK_ID` environment variables.

The `taskflow-cli-skill.md` system prompt documentation is updated to include this command. No other system prompt changes.

## Electron Integration

### Creating Desktop Notifications

- At startup, Electron registers a notification callback with the backend
- Callback receives `{ id, message, projectId, sessionId, taskId? }`
- Main process creates `new Notification({ title: "Taskflow", body: message })`
- Works even when the renderer window is hidden/closed since `Notification` runs in the main process

### Handling Notification Click

- On click: show/focus the main window if hidden
- Send IPC event `notification-clicked` to renderer with `{ id, projectId, sessionId, taskId? }`
- Renderer navigates to the project/task and activates the session tab
- If the project, task, or session no longer exists, navigation is silently skipped

## UI

### Sidebar Button

Located in the sidebar footer (left side, alongside existing buttons):
- Only rendered when `notifications.length > 0`
- Displays an unread count badge when `unreadCount > 0`
- Clicking opens a popover anchored to the button

### Notification Popup

- Header: "Notifications" title + "Dismiss all" button
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
- Notifications fetched via WebSocket `notification:list` request on connect (same pattern as tasks/projects)
- Store updated reactively via `NOTIFICATION_CREATED`, `NOTIFICATION_UPDATED`, `NOTIFICATION_DELETED` WebSocket events
- Derived selectors: `notifications`, `unreadCount`

## Config Changes

- Add `notificationsFile: join(dataDir, "notifications.json")` to `config.ts` `buildDataPaths()`
- No new directories needed (single file, not a directory)

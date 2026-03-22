# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notification system where agents create notifications via CLI, displayed in the UI sidebar with desktop alerts via Electron.

**Architecture:** Notifications stored in a single JSON file, managed by a NotificationStore. CLI creates via HTTP POST, backend broadcasts via WebSocket, UI renders in a sidebar popover. Electron main process polls the backend HTTP API for new notifications and fires native desktop alerts (matching the existing tray-state polling pattern since Electron's main process doesn't maintain a WebSocket connection to the backend).

**Tech Stack:** TypeScript, Bun, Zustand, React, Electron Notification API

**Spec:** `docs/superpowers/specs/2026-03-22-notification-system-design.md`

---

## File Structure

### New Files
- `packages/shared/src/types/notification.ts` — Notification type definition
- `packages/backend/src/services/notification-store.ts` — Persistence layer
- `packages/backend/src/handlers/notification.ts` — WebSocket handler registration
- `packages/ui/src/stores/notification-store.ts` — Zustand store
- `packages/ui/src/components/sidebar/NotificationPopover.tsx` — Popover UI component

### Modified Files
- `packages/shared/src/constants.ts` — Add notification MSG constants
- `packages/shared/src/types/ws.ts` — Add notification WS payload/event types
- `packages/shared/src/index.ts` — Re-export notification types
- `packages/backend/src/config.ts` — Add `notificationsFile` path
- `packages/backend/src/index.ts` — Initialize NotificationStore, register handlers
- `packages/backend/src/api/routes.ts` — Add notification HTTP routes
- `packages/backend/src/services/taskflow-cli.sh` — Add `notify` command
- `packages/backend/src/services/taskflow-cli-skill.md` — Document `notify` command
- `electron/src/main.ts` — Poll for notifications, fire desktop alerts
- `electron/src/preload.ts` — Add `onNotificationClicked` IPC bridge
- `packages/ui/src/env.d.ts` — Add `onNotificationClicked` to TaskflowBridge
- `packages/ui/src/components/sidebar/TaskSidebar.tsx` — Add notification button

---

### Task 1: Shared Types and Constants

**Files:**
- Create: `packages/shared/src/types/notification.ts`
- Modify: `packages/shared/src/constants.ts:2-123`
- Modify: `packages/shared/src/types/ws.ts:1-450`
- Modify: `packages/shared/src/index.ts:1-15`

- [ ] **Step 1: Create the Notification type**

```typescript
// packages/shared/src/types/notification.ts
export interface Notification {
    id: string;
    projectId: string;
    sessionId: string;
    taskId?: string;
    message: string;
    read: boolean;
    createdAt: string;
}
```

- [ ] **Step 2: Add MSG constants**

In `packages/shared/src/constants.ts`, add a `// Notifications` section before the `// System` section (before line 121):

```typescript
    // Notifications
    NOTIFICATION_LIST: "notification:list",
    NOTIFICATION_CREATED: "notification:created",
    NOTIFICATION_UPDATED: "notification:updated",
    NOTIFICATION_DELETED: "notification:deleted",
```

- [ ] **Step 3: Add WebSocket payload and event types**

In `packages/shared/src/types/ws.ts`, add the import at the top:

```typescript
import type { Notification } from "./notification";
```

Add at the end of the file — both request payload types (for WS handlers) and event types (for broadcasts):

```typescript
// Notification messages — request payloads
export interface NotificationMarkReadPayload {
    id: string;
}

export interface NotificationDeletePayload {
    id?: string;
    all?: boolean;
}

// Notification messages — response/event types
export interface NotificationListResponse {
    notifications: Notification[];
}

export interface NotificationCreatedEvent {
    notification: Notification;
}

export interface NotificationUpdatedEvent {
    notification: Notification;
}

export interface NotificationDeletedEvent {
    id?: string;
    all?: boolean;
}
```

- [ ] **Step 4: Re-export notification types**

In `packages/shared/src/index.ts`, add:

```typescript
export * from "./types/notification";
```

- [ ] **Step 5: Verify shared package builds**

Run: `cd packages/shared && bun run build`
Expected: Success, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add notification types and message constants"
```

---

### Task 2: NotificationStore

**Files:**
- Create: `packages/backend/src/services/notification-store.ts`
- Modify: `packages/backend/src/config.ts:23-36`

- [ ] **Step 1: Add notificationsFile to config**

In `packages/backend/src/config.ts`, inside `buildDataPaths()` (line 34), add after `schedulesFile`:

```typescript
        notificationsFile: join(dataDir, "notifications.json"),
```

- [ ] **Step 2: Create NotificationStore**

Create `packages/backend/src/services/notification-store.ts`:

```typescript
import type { Notification } from "@taskflow/shared";
import { readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class NotificationStore {
    private filePath: string;
    private mutation: Promise<void> = Promise.resolve();

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    private async withMutation<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.mutation;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.mutation = previous.catch(() => undefined).then(() => gate);
        await previous.catch(() => undefined);

        try {
            return await fn();
        } finally {
            release();
        }
    }

    private async readAll(): Promise<Notification[]> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            return JSON.parse(raw) as Notification[];
        } catch (error) {
            if (isMissingFileError(error)) return [];
            throw error;
        }
    }

    private async writeAll(notifications: Notification[]): Promise<void> {
        await writeFile(this.filePath, JSON.stringify(notifications, null, 2));
    }

    async list(): Promise<Notification[]> {
        return this.readAll();
    }

    async create(
        projectId: string,
        sessionId: string,
        message: string,
        taskId?: string,
    ): Promise<Notification> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const notification: Notification = {
                id: randomUUID(),
                projectId,
                sessionId,
                message,
                read: false,
                createdAt: new Date().toISOString(),
                ...(taskId ? { taskId } : {}),
            };
            notifications.push(notification);
            await this.writeAll(notifications);
            return notification;
        });
    }

    async markAsRead(id: string): Promise<Notification | null> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const notification = notifications.find((n) => n.id === id);
            if (!notification) return null;
            notification.read = true;
            await this.writeAll(notifications);
            return notification;
        });
    }

    async delete(id: string): Promise<boolean> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const index = notifications.findIndex((n) => n.id === id);
            if (index === -1) return false;
            notifications.splice(index, 1);
            await this.writeAll(notifications);
            return true;
        });
    }

    async deleteAll(): Promise<void> {
        return this.withMutation(async () => {
            await this.writeAll([]);
        });
    }
}
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/services/notification-store.ts
git commit -m "feat(backend): add NotificationStore with JSON file persistence"
```

---

### Task 3: WebSocket Handlers

**Files:**
- Create: `packages/backend/src/handlers/notification.ts`
- Modify: `packages/backend/src/index.ts:40-310`

- [ ] **Step 1: Create notification handler**

Create `packages/backend/src/handlers/notification.ts`. Use the `typed<T>()` helper pattern from `packages/backend/src/handlers/schedule.ts` to avoid `as` casts:

```typescript
import { MSG } from "@taskflow/shared";
import type {
    NotificationMarkReadPayload,
    NotificationDeletePayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { NotificationStore } from "../services/notification-store";

interface NotificationHandlerDeps {
    router: Router;
    notificationStore: NotificationStore;
    broadcast: (event: WsEvent) => void;
}

// Same typed-handler pattern as schedule.ts
function typed<T>(
    handler: (payload: T) => Promise<unknown>,
): (payload: unknown) => Promise<unknown> {
    return handler as (payload: unknown) => Promise<unknown>;
}

export function registerNotificationHandlers(deps: NotificationHandlerDeps): void {
    const { router, notificationStore, broadcast } = deps;

    router.register(MSG.NOTIFICATION_LIST, async () => {
        const notifications = await notificationStore.list();
        return { notifications };
    });

    router.register(
        MSG.NOTIFICATION_UPDATED,
        typed<NotificationMarkReadPayload>(async (payload) => {
            const notification = await notificationStore.markAsRead(payload.id);
            if (!notification) throw new Error("Notification not found");
            broadcast({ type: MSG.NOTIFICATION_UPDATED, payload: { notification } });
            return { notification };
        }),
    );

    router.register(
        MSG.NOTIFICATION_DELETED,
        typed<NotificationDeletePayload>(async (payload) => {
            if (payload.all) {
                await notificationStore.deleteAll();
                broadcast({ type: MSG.NOTIFICATION_DELETED, payload: { all: true } });
            } else if (payload.id) {
                const deleted = await notificationStore.delete(payload.id);
                if (!deleted) throw new Error("Notification not found");
                broadcast({ type: MSG.NOTIFICATION_DELETED, payload: { id: payload.id } });
            }
            return { success: true };
        }),
    );
}
```

- [ ] **Step 2: Initialize NotificationStore and register handler in index.ts**

In `packages/backend/src/index.ts`:

Add import at the top:
```typescript
import { NotificationStore } from "./services/notification-store";
import { registerNotificationHandlers } from "./handlers/notification";
```

After the `flowStore` initialization (around line 58), add:
```typescript
        const notificationStore = new NotificationStore(config.notificationsFile);
```

After the other `registerXxxHandlers` calls (around line 274), add:
```typescript
        registerNotificationHandlers({
            router,
            notificationStore,
            broadcast: server.broadcast,
        });
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/notification.ts packages/backend/src/index.ts
git commit -m "feat(backend): register notification WebSocket handlers"
```

---

### Task 4: HTTP API Routes

**Files:**
- Modify: `packages/backend/src/api/routes.ts:1-40`
- Modify: `packages/backend/src/index.ts` (pass notificationStore to registerApiRoutes)

- [ ] **Step 1: Add notificationStore to ApiRouteDeps**

In `packages/backend/src/api/routes.ts`, add to the `ApiRouteDeps` interface (around line 24):

```typescript
    notificationStore: NotificationStore;
```

Add import:
```typescript
import type { NotificationStore } from "../services/notification-store";
import type { NotificationDeletedEvent } from "@taskflow/shared";
```

- [ ] **Step 2: Add notification HTTP routes**

At the end of `registerApiRoutes()` function in `packages/backend/src/api/routes.ts`, add:

```typescript
    // ── Notifications ──────────────────────────────────────────────
    apiRouter.register("GET", "/api/notifications", async () => {
        const notifications = await deps.notificationStore.list();
        return jsonResponse({ notifications });
    });

    apiRouter.register("POST", "/api/notifications", async (req) => {
        const projectId = req.headers.get("x-taskflow-project-id");
        const sessionId = req.headers.get("x-taskflow-session-id");
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;

        if (!projectId || !sessionId) {
            return errorResponse("Missing required headers: x-taskflow-project-id, x-taskflow-session-id", 400);
        }

        let body: { message?: unknown };
        try {
            body = (await req.json()) as { message?: unknown };
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        if (typeof body.message !== "string" || !body.message.trim()) {
            return errorResponse("Field 'message' is required and must be a non-empty string", 400);
        }

        const notification = await deps.notificationStore.create(projectId, sessionId, body.message.trim(), taskId);
        deps.broadcast({ type: MSG.NOTIFICATION_CREATED, payload: { notification } });
        return jsonResponse(notification, 201);
    });

    apiRouter.register("PATCH", "/api/notifications/:id", async (_req, params) => {
        const notification = await deps.notificationStore.markAsRead(params.id);
        if (!notification) return errorResponse("Notification not found", 404);
        deps.broadcast({ type: MSG.NOTIFICATION_UPDATED, payload: { notification } });
        return jsonResponse(notification);
    });

    apiRouter.register("DELETE", "/api/notifications/:id", async (_req, params) => {
        const deleted = await deps.notificationStore.delete(params.id);
        if (!deleted) return errorResponse("Notification not found", 404);
        const event: NotificationDeletedEvent = { id: params.id };
        deps.broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });

    apiRouter.register("DELETE", "/api/notifications", async () => {
        await deps.notificationStore.deleteAll();
        const event: NotificationDeletedEvent = { all: true };
        deps.broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });
```

- [ ] **Step 3: Pass notificationStore to registerApiRoutes in index.ts**

In `packages/backend/src/index.ts`, update the `registerApiRoutes` call (around line 275) to include:

```typescript
            notificationStore,
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/api/routes.ts packages/backend/src/index.ts
git commit -m "feat(backend): add notification HTTP API routes"
```

---

### Task 5: CLI Command

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh:40-431`
- Modify: `packages/backend/src/services/taskflow-cli-skill.md:1-40`

- [ ] **Step 1: Add notify command to CLI shell script**

In `packages/backend/src/services/taskflow-cli.sh`, add a new case before the closing `esac` or after the last command case:

```sh
  notify)
    message="${1:-}"
    if [ -z "$message" ]; then
      echo "Usage: taskflow-cli notify <message>" >&2
      exit 1
    fi
    if [ -z "$TASKFLOW_PROJECT_ID" ]; then
      echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
      exit 1
    fi
    if [ -z "$TASKFLOW_SESSION_ID" ]; then
      echo "Error: TASKFLOW_SESSION_ID is not set" >&2
      exit 1
    fi
    payload=$(printf '{"message":%s}' "$(json_string "$message")")
    curl -sf -X POST "$TASKFLOW_API_URL/api/notifications" \
      -H "Content-Type: application/json" \
      -H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID" \
      -H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID" \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      -d "$payload"
    ;;
```

Note: `${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"}` only sends the header when the variable is set and non-empty.

- [ ] **Step 2: Update CLI documentation**

In `packages/backend/src/services/taskflow-cli-skill.md`, add a new section after the "## Agent commands" section:

```markdown
## Notification commands
`taskflow-cli notify "Build completed successfully"` Send a desktop notification
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.sh packages/backend/src/services/taskflow-cli-skill.md
git commit -m "feat(cli): add notify command for desktop notifications"
```

---

### Task 6: UI Notification Store

**Files:**
- Create: `packages/ui/src/stores/notification-store.ts`

- [ ] **Step 1: Create Zustand notification store with module-level event subscriptions**

Create `packages/ui/src/stores/notification-store.ts`. Follow the module-level event subscription pattern from `packages/ui/src/stores/schedule-store.ts:79-84`:

```typescript
import { create } from "zustand";
import type { Notification, NotificationCreatedEvent, NotificationUpdatedEvent, NotificationDeletedEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface NotificationStoreState {
    notifications: Notification[];
    loading: boolean;

    fetchNotifications(): Promise<void>;
    markAsRead(id: string): Promise<void>;
    deleteNotification(id: string): Promise<void>;
    deleteAll(): Promise<void>;
}

const useNotificationStore = create<NotificationStoreState>((set) => ({
    notifications: [],
    loading: false,

    async fetchNotifications() {
        set({ loading: true });
        try {
            const { notifications } = await sendRequest<{ notifications: Notification[] }>(
                MSG.NOTIFICATION_LIST,
                {},
            );
            set({ notifications });
        } finally {
            set({ loading: false });
        }
    },

    async markAsRead(id) {
        await sendRequest(MSG.NOTIFICATION_UPDATED, { id });
    },

    async deleteNotification(id) {
        await sendRequest(MSG.NOTIFICATION_DELETED, { id });
    },

    async deleteAll() {
        await sendRequest(MSG.NOTIFICATION_DELETED, { all: true });
    },
}));

// Module-level event listeners (same pattern as schedule-store.ts)
onEvent(MSG.NOTIFICATION_CREATED, (payload) => {
    const event = payload as NotificationCreatedEvent;
    if (event.notification) {
        useNotificationStore.setState((s) => ({
            notifications: [...s.notifications, event.notification],
        }));
    }
});

onEvent(MSG.NOTIFICATION_UPDATED, (payload) => {
    const event = payload as NotificationUpdatedEvent;
    if (event.notification) {
        useNotificationStore.setState((s) => ({
            notifications: s.notifications.map((n) =>
                n.id === event.notification.id ? event.notification : n,
            ),
        }));
    }
});

onEvent(MSG.NOTIFICATION_DELETED, (payload) => {
    const event = payload as NotificationDeletedEvent;
    if (event.all) {
        useNotificationStore.setState({ notifications: [] });
    } else if (event.id) {
        const deletedId = event.id;
        useNotificationStore.setState((s) => ({
            notifications: s.notifications.filter((n) => n.id !== deletedId),
        }));
    }
});

export { useNotificationStore };
```

- [ ] **Step 2: Verify UI compiles**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/notification-store.ts
git commit -m "feat(ui): add notification Zustand store with module-level event subscriptions"
```

---

### Task 7: Notification Popover Component

**Files:**
- Create: `packages/ui/src/components/sidebar/NotificationPopover.tsx`

- [ ] **Step 1: Create NotificationPopover component**

Create `packages/ui/src/components/sidebar/NotificationPopover.tsx`. Check `packages/ui/src/components/ui/` for the exact Popover, Button, etc. component imports used in the project. Adapt paths accordingly.

The component should:
- Accept `open` / `onOpenChange` props (controlled popover)
- Accept `onNavigate` callback receiving a `Notification`
- Show header with "Notifications" and "Dismiss all" button
- Render notifications sorted newest-first
- Each item: message, project name (from project store), relative time
- Unread items: dot indicator
- Click item: mark as read + call `onNavigate`
- X button per item: delete that notification
- Use `useNotificationStore` selectors (not destructuring) per the Zustand reactivity rules

```typescript
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useNotificationStore } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import type { Notification } from "@taskflow/shared";

function formatRelativeTime(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

interface NotificationPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNavigate: (notification: Notification) => void;
    children: React.ReactNode;
}

function NotificationPopover({ open, onOpenChange, onNavigate, children }: NotificationPopoverProps) {
    const notifications = useNotificationStore((s) => s.notifications);
    const markAsRead = useNotificationStore((s) => s.markAsRead);
    const deleteNotification = useNotificationStore((s) => s.deleteNotification);
    const deleteAll = useNotificationStore((s) => s.deleteAll);
    const projects = useProjectStore((s) => s.projects);

    const sorted = [...notifications].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    function getProjectName(projectId: string): string {
        return projects.find((p) => p.id === projectId)?.name ?? "Unknown project";
    }

    function handleClick(notification: Notification) {
        if (!notification.read) {
            void markAsRead(notification.id);
        }
        onNavigate(notification);
        onOpenChange(false);
    }

    function handleDelete(e: React.MouseEvent, id: string) {
        e.stopPropagation();
        void deleteNotification(id);
    }

    function handleDismissAll() {
        void deleteAll();
        onOpenChange(false);
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-80 p-0">
                <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">Notifications</span>
                    <Button variant="ghost" size="sm" onClick={handleDismissAll}>
                        Dismiss all
                    </Button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {sorted.map((n) => (
                        <div
                            key={n.id}
                            onClick={() => handleClick(n)}
                            className="flex items-start gap-2 border-b px-3 py-2 cursor-pointer hover:bg-muted/50"
                        >
                            {!n.read && (
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                            )}
                            {n.read && <span className="mt-1.5 h-2 w-2 shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm leading-snug">{n.message}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {getProjectName(n.projectId)} &middot; {formatRelativeTime(n.createdAt)}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={(e) => handleDelete(e, n.id)}
                                className="shrink-0 text-muted-foreground"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default NotificationPopover;
```

**Note:** Verify actual UI component import paths — check `packages/ui/src/components/ui/popover.tsx` and adapt `@/components/ui/...` or `../../components/ui/...` accordingly. Also check how `useProjectStore` is exported (named vs default).

- [ ] **Step 2: Verify UI compiles**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/NotificationPopover.tsx
git commit -m "feat(ui): add NotificationPopover component"
```

---

### Task 8: Integrate into Sidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:366-458`

- [ ] **Step 1: Add notification button to TaskSidebar**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`:

Add imports:
```typescript
import { Bell } from "lucide-react";
import { useNotificationStore } from "../../stores/notification-store";
import NotificationPopover from "./NotificationPopover";
import type { Notification } from "@taskflow/shared";
```

Inside the component, add state:
```typescript
const notifications = useNotificationStore((s) => s.notifications);
const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);

const unreadCount = notifications.filter((n) => !n.read).length;

// Fetch notifications on mount
useEffect(() => {
    void fetchNotifications();
}, [fetchNotifications]);
```

Add navigation handler (study existing sidebar navigation — how project/task selection works — and implement accordingly):
```typescript
function handleNotificationNavigate(notification: Notification) {
    // Set active project to notification.projectId
    // If notification.taskId exists, select that task
    // If notification.sessionId exists and the session is still active, switch to that tab
    // If any target doesn't exist, silently skip
}
```

In the sidebar footer toolbar (around line 368), add the notification button in the left `<div>`, alongside the update status buttons:

```tsx
{notifications.length > 0 && (
    <NotificationPopover
        open={notificationPopoverOpen}
        onOpenChange={setNotificationPopoverOpen}
        onNavigate={handleNotificationNavigate}
    >
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Notifications"
            tooltip="Notifications"
            tooltipSide="right"
            className="relative text-muted-foreground [-webkit-app-region:no-drag]"
        >
            <Bell className="h-3.5 w-3.5" />
            {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[10px] font-medium text-accent-foreground">
                    {unreadCount}
                </span>
            )}
        </Button>
    </NotificationPopover>
)}
```

- [ ] **Step 2: Implement handleNotificationNavigate**

Study existing navigation patterns in TaskSidebar (how clicking a task/project selects it). The implementation must:
1. Set the active project to `notification.projectId`
2. If `taskId` is present, select that task
3. If `sessionId` is present and exists, activate that session tab
4. If any entity no longer exists, silently skip (no error)

- [ ] **Step 3: Verify UI compiles**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat(ui): integrate notification button and popover into sidebar"
```

---

### Task 9: Electron Desktop Notifications

**Files:**
- Modify: `electron/src/main.ts:1-12` (import Notification)
- Modify: `electron/src/main.ts:74-109` (add notification polling)
- Modify: `electron/src/preload.ts:3-152` (add onNotificationClicked)
- Modify: `packages/ui/src/env.d.ts:3-43` (add onNotificationClicked to TaskflowBridge)

**Note:** The spec mentions using a WebSocket connection, but Electron's main process does not maintain a WebSocket connection to the backend — it uses HTTP polling for tray state. We follow the same pattern here for consistency.

- [ ] **Step 1: Add Notification import in Electron main**

In `electron/src/main.ts` line 1, add `Notification` to the electron import:

```typescript
import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    Notification,
    screen,
    shell,
    nativeTheme,
    Tray,
} from "electron";
```

- [ ] **Step 2: Add notification polling**

After the tray-state polling variables (around line 35), add:

```typescript
let lastNotificationCheck: string | null = null;
let notificationPollTimer: ReturnType<typeof setInterval> | null = null;
```

Add the polling functions (after `stopTrayStatePolling`):

```typescript
async function checkNewNotifications(): Promise<void> {
    if (!backendPort) return;

    try {
        const response = await fetch(`http://127.0.0.1:${backendPort}/api/notifications`, {
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return;

        const { notifications } = (await response.json()) as {
            notifications: Array<{
                id: string;
                projectId: string;
                sessionId: string;
                taskId?: string;
                message: string;
                read: boolean;
                createdAt: string;
            }>;
        };

        // Track the newest shown notification to avoid re-showing
        let newestShown = lastNotificationCheck;

        for (const n of notifications) {
            if (!n.read && (!lastNotificationCheck || n.createdAt > lastNotificationCheck)) {
                const desktopNotification = new Notification({
                    title: "Taskflow",
                    body: n.message,
                });
                desktopNotification.on("click", () => {
                    if (mainWindow) {
                        if (!mainWindow.isVisible()) mainWindow.show();
                        mainWindow.focus();
                        mainWindow.webContents.send("notification-clicked", {
                            id: n.id,
                            projectId: n.projectId,
                            sessionId: n.sessionId,
                            taskId: n.taskId,
                        });
                    }
                });
                desktopNotification.show();

                if (!newestShown || n.createdAt > newestShown) {
                    newestShown = n.createdAt;
                }
            }
        }

        if (newestShown) {
            lastNotificationCheck = newestShown;
        }
    } catch {
        // Ignore transient failures
    }
}

function startNotificationPolling(): void {
    if (notificationPollTimer) return;
    // Set initial check time to "now" to avoid showing old notifications on startup
    lastNotificationCheck = new Date().toISOString();
    notificationPollTimer = setInterval(() => {
        void checkNewNotifications();
    }, 3000);
}

function stopNotificationPolling(): void {
    if (!notificationPollTimer) return;
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
}
```

- [ ] **Step 3: Start/stop polling alongside tray-state polling**

Find where `startTrayStatePolling()` is called and add `startNotificationPolling()` next to it. Similarly for `stopTrayStatePolling()` and `stopNotificationPolling()`.

- [ ] **Step 4: Add onNotificationClicked to preload**

In `electron/src/preload.ts`, add before the closing `});` of `contextBridge.exposeInMainWorld` (before line 152):

```typescript
    onNotificationClicked: (
        callback: (payload: {
            id: string;
            projectId: string;
            sessionId: string;
            taskId?: string;
        }) => void,
    ) => {
        const listener = (
            _event: Electron.IpcRendererEvent,
            payload: { id: string; projectId: string; sessionId: string; taskId?: string },
        ) => callback(payload);
        ipcRenderer.on("notification-clicked", listener);
        return () => {
            ipcRenderer.removeListener("notification-clicked", listener);
        };
    },
```

- [ ] **Step 5: Update TaskflowBridge type declaration**

In `packages/ui/src/env.d.ts`, add to the `TaskflowBridge` interface (before the closing `}`):

```typescript
    onNotificationClicked(
        callback: (payload: {
            id: string;
            projectId: string;
            sessionId: string;
            taskId?: string;
        }) => void,
    ): () => void;
```

- [ ] **Step 6: Handle notification-clicked in TaskSidebar**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, add an effect that listens to the IPC event:

```typescript
useEffect(() => {
    const cleanup = window.taskflow?.onNotificationClicked?.((payload) => {
        handleNotificationNavigate(payload);
    });
    return cleanup;
}, []);
```

- [ ] **Step 7: Verify electron and UI compile**

Run: `cd electron && bun run build` and `cd packages/ui && bun run build`
Expected: Both succeed

- [ ] **Step 8: Commit**

```bash
git add electron/src/main.ts electron/src/preload.ts packages/ui/src/env.d.ts packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat(electron): add desktop notification polling and click-to-navigate"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Start the dev environment**

Run the app in dev mode and verify:
1. Backend starts without errors
2. UI loads with no console errors

- [ ] **Step 2: Test CLI notification creation**

In a terminal with the right env vars set, run:
```bash
taskflow-cli notify "Test notification message"
```

Verify:
- HTTP 201 response with notification JSON
- Notification appears in sidebar popover
- Desktop notification shows up
- Unread badge appears on bell button

- [ ] **Step 3: Test notification interactions**

- Click notification in popover: marks as read, navigates
- Click X on notification: deletes it
- Click "Dismiss all": clears all notifications
- Bell button hides when no notifications remain
- Desktop notification click: window focuses, navigates

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address e2e testing feedback for notification system"
```

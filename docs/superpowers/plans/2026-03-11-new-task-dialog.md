# New Task Dialog + Internal Agent API — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `window.prompt()` task creation with a custom dialog, add HTTP REST API for agent-to-backend communication, and auto-generate task titles from descriptions.

**Architecture:** The backend's existing `Bun.serve` fetch handler gets an HTTP router for REST endpoints. Agents receive env vars (`TASKFLOW_API_URL`, `TASKFLOW_TASK_ID`, `TASKFLOW_SESSION_ID`) to call back. A background `claude -p` process generates titles when omitted. The UI gets a new dialog component using existing shadcn primitives.

**Tech Stack:** Bun, TypeScript, React, Zustand, Radix UI (Dialog, Select), shadcn/ui components

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/backend/src/api/router.ts` | NEW — HTTP request router (method + path matching) |
| `packages/backend/src/api/routes.ts` | NEW — REST endpoint handlers (task PATCH, session done) |
| `packages/backend/src/services/title-generator.ts` | NEW — Spawns `claude -p` to generate titles, updates task |
| `packages/backend/src/ws/server.ts` | MODIFY — Route HTTP requests to API router |
| `packages/backend/src/handlers/session.ts` | MODIFY — Pass port/taskId/sessionId for env injection |
| `packages/backend/src/handlers/task.ts` | MODIFY — Trigger title generation on empty-title creates |
| `packages/backend/src/services/pty-manager.ts` | MODIFY — Accept and inject `TASKFLOW_*` env vars |
| `packages/backend/src/index.ts` | MODIFY — Wire up API router, pass port to session handlers |
| `packages/shared/src/constants.ts` | MODIFY — Add `TASK_UPDATED` message constant |
| `packages/shared/src/types/ws.ts` | MODIFY — Update `TaskCreatePayload` (title optional, description required, worktree field) |
| `packages/ui/src/components/sidebar/NewTaskDialog.tsx` | NEW — Dialog component with form fields |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | MODIFY — Replace `window.prompt` with dialog |
| `packages/ui/src/components/sidebar/TaskCard.tsx` | MODIFY — Display truncated description when title is empty |
| `packages/ui/src/stores/task-store.ts` | MODIFY — Update `createTask` signature, listen for `task:updated` events |

---

## Chunk 1: Internal HTTP API

### Task 1: HTTP Router

**Files:**
- Create: `packages/backend/src/api/router.ts`

- [ ] **Step 1: Create the HTTP router**

This is a simple method+path router that parses URL params and JSON bodies.

```typescript
// packages/backend/src/api/router.ts
type RouteHandler = (req: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class ApiRouter {
  private routes: Route[] = [];

  register(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      return route.handler(req, params);
    }

    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/api/router.ts
git commit -m "feat: add HTTP API router for REST endpoints"
```

---

### Task 2: REST Route Handlers

**Files:**
- Create: `packages/backend/src/api/routes.ts`

- [ ] **Step 1: Create REST route handlers**

These handlers wire up PATCH /api/tasks/:taskId and POST /api/sessions/:sessionId/done.

```typescript
// packages/backend/src/api/routes.ts
import type { ApiRouter } from './router';
import type { TaskStore } from '../services/task-store';
import type { PtyManager } from '../services/pty-manager';
import type { Task, WsEvent } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';

interface ApiRouteDeps {
  apiRouter: ApiRouter;
  taskStore: TaskStore;
  ptyManager: PtyManager;
  broadcast: (event: WsEvent) => void;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

export function registerApiRoutes(deps: ApiRouteDeps): void {
  const { apiRouter, taskStore, ptyManager, broadcast } = deps;

  apiRouter.register('PATCH', '/api/tasks/:taskId', async (req, params) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const allowedFields = ['title', 'description', 'notes'] as const;
    const updates: Partial<Pick<Task, 'title' | 'description' | 'notes'>> = {};
    for (const field of allowedFields) {
      if (field in body) {
        if (typeof body[field] !== 'string') {
          return errorResponse(`Field "${field}" must be a string`, 400);
        }
        updates[field] = body[field] as string;
      }
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid fields to update', 400);
    }

    try {
      const updated = await taskStore.updateTask(params.taskId, updates);
      broadcast({ type: MSG.TASK_UPDATED, payload: updated });
      return jsonResponse(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('not found')) {
        return errorResponse(message, 404);
      }
      return errorResponse(message, 500);
    }
  });

  apiRouter.register('POST', '/api/sessions/:sessionId/done', async (_req, params) => {
    const { sessionId } = params;

    if (!ptyManager.has(sessionId)) {
      return errorResponse(`Session not found: ${sessionId}`, 404);
    }

    ptyManager.close(sessionId);
    // Session cleanup (removing from task) is handled by the onExit callback in pty-manager

    return jsonResponse({ success: true });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/api/routes.ts
git commit -m "feat: add REST route handlers for task update and session done"
```

---

### Task 3: Add TASK_UPDATED Constant

**Files:**
- Modify: `packages/shared/src/constants.ts:8-13`

- [ ] **Step 1: Add TASK_UPDATED to MSG**

In `packages/shared/src/constants.ts`, add `TASK_UPDATED` after `TASK_UPDATE`:

```typescript
  TASK_UPDATED: 'task:updated',
```

The full Tasks section should read:
```typescript
  // Tasks
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_UPDATED: 'task:updated',
  TASK_ARCHIVE: 'task:archive',
  TASK_DELETE: 'task:delete',
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat: add TASK_UPDATED message constant"
```

---

### Task 4: Wire HTTP API into Server

**Files:**
- Modify: `packages/backend/src/ws/server.ts:5-8,23-27`
- Modify: `packages/backend/src/index.ts:36-54`

- [ ] **Step 1: Update server.ts to accept an ApiRouter and route HTTP requests**

The `createServer` function needs to accept an optional `ApiRouter` and use it in the `fetch` handler. Update `packages/backend/src/ws/server.ts`:

Change the function signature and imports:
```typescript
import type { Server, ServerWebSocket } from 'bun';
import type { WsRequest, WsResponse, WsEvent } from '@taskflow/shared';
import type { ApiRouter } from '../api/router';
import { Router } from './router';

export function createServer(
  router: Router,
  port: number = 0,
  apiRouter?: ApiRouter,
): {
```

Change the `fetch` handler inside `Bun.serve` (currently lines 25-27). **Important:** add `async` keyword — the original handler is synchronous:
```typescript
      async fetch(req, server) {
        if (server.upgrade(req)) return;
        if (apiRouter) {
          const response = await apiRouter.handle(req);
          if (response) return response;
        }
        return new Response('Taskflow backend', { status: 200 });
      },
```

- [ ] **Step 2: Wire up ApiRouter in index.ts**

In `packages/backend/src/index.ts`, import and create the ApiRouter, pass it to createServer, and register API routes.

Add imports after existing ones:
```typescript
import { ApiRouter } from './api/router';
import { registerApiRoutes } from './api/routes';
```

After the `const router = new Router();` line (line 36), add:
```typescript
    const apiRouter = new ApiRouter();
```

Change the `createServer` call (line 37) to:
```typescript
    const server = createServer(router, config.port, apiRouter);
```

After the `registerGitHandlers` call (line 54), add:
```typescript
    registerApiRoutes({
      apiRouter,
      taskStore: store,
      ptyManager,
      broadcast: server.broadcast,
    });
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/ws/server.ts packages/backend/src/index.ts
git commit -m "feat: wire HTTP API router into Bun server"
```

---

### Task 5: Inject TASKFLOW_* Env Vars into PTY Sessions

**Files:**
- Modify: `packages/backend/src/services/pty-manager.ts:4-12`
- Modify: `packages/backend/src/handlers/session.ts:47-96`

- [ ] **Step 1: Update PtyManager.spawn() to accept an optional id**

In `packages/backend/src/services/pty-manager.ts`, change the `spawn` method signature (line 49) and ID generation (line 50):

Change line 49 from:
```typescript
  spawn(options: SpawnOptions): string {
```
to:
```typescript
  spawn(options: SpawnOptions & { id?: string }): string {
```

Change line 50 from:
```typescript
    const id = randomUUID();
```
to:
```typescript
    const id = options.id ?? randomUUID();
```

The `SpawnOptions` interface (lines 4-12) already has an `env` field, so no other changes are needed.

- [ ] **Step 2: Update session handler to pass env vars**

The `registerSessionHandlers` function needs to know the server port so it can construct `TASKFLOW_API_URL`. Update `packages/backend/src/handlers/session.ts`:

Add `getPort` to the `SessionHandlerDeps` interface (a getter function so handler registration can stay before `server.start()`):
```typescript
interface SessionHandlerDeps {
  router: Router;
  ptyManager: PtyManager;
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
  getPort: () => number;
}
```

Add `getPort` to the destructuring:
```typescript
  const { router, ptyManager, taskStore, broadcast, getPort } = deps;
```

In the `SESSION_CREATE` handler, before the `ptyManager.spawn()` call, build the env:
```typescript
    const taskflowEnv: Record<string, string> = {
      TASKFLOW_API_URL: `http://localhost:${port}`,
      TASKFLOW_TASK_ID: taskId,
    };
```

Pass it to spawn (the sessionId is the return value so we need to add it after):
```typescript
    const sessionId = ptyManager.spawn({
      command, args, cwd,
      env: taskflowEnv,
      onData: (data) => { ... },
      onExit: (exitCode) => { ... },
    });

    // Now that we have the sessionId, we can't retroactively set it as env.
    // Instead, add TASKFLOW_SESSION_ID to the env before spawn.
```

Actually, since `sessionId` is generated inside `ptyManager.spawn()`, we need to either:
- Let the caller provide the sessionId, or
- Generate it outside and pass it in

The cleanest approach: generate the ID in the handler and pass it to spawn.

Update `PtyManager.spawn()` signature to accept an optional `id`:
```typescript
  spawn(options: SpawnOptions & { id?: string }): string {
    const id = options.id ?? randomUUID();
```

Then in the session handler, generate the ID first:
```typescript
    const sessionId = crypto.randomUUID();
    const taskflowEnv: Record<string, string> = {
      TASKFLOW_API_URL: `http://localhost:${getPort()}`,
      TASKFLOW_TASK_ID: taskId,
      TASKFLOW_SESSION_ID: sessionId,
    };

    ptyManager.spawn({
      id: sessionId,
      command, args, cwd,
      env: taskflowEnv,
      onData: (data) => {
        broadcast({
          type: MSG.TERMINAL_OUTPUT,
          payload: { sessionId, data },
        });
      },
      onExit: (exitCode) => {
        broadcast({
          type: MSG.SESSION_EXITED,
          payload: { sessionId, exitCode },
        });
        void removeSessionFromTask(sessionId, taskId);
      },
    });
```

- [ ] **Step 3: Update index.ts to pass port getter to session handlers**

In `packages/backend/src/index.ts`, keep `registerSessionHandlers` in its current position (before `server.start()`) but use a port getter so the actual port is resolved lazily at session creation time:

Add a mutable port variable before handler registration:
```typescript
    let serverPort = config.port;
```

Update the existing `registerSessionHandlers` call (line 47-50) to include `getPort`:
```typescript
    registerSessionHandlers({
      router, ptyManager, taskStore: store,
      broadcast: server.broadcast,
      getPort: () => serverPort,
    });
```

After `const startedServer = await server.start();` (line 62), update the port:
```typescript
    serverPort = startedServer.port;
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/pty-manager.ts packages/backend/src/handlers/session.ts packages/backend/src/index.ts
git commit -m "feat: inject TASKFLOW env vars into PTY sessions"
```

---

### Task 6: Title Generator Service

**Files:**
- Create: `packages/backend/src/services/title-generator.ts`

- [ ] **Step 1: Create the title generator**

This service spawns `claude -p` in the background to generate a title from a description. It uses `Bun.spawn` with piped stdout (not a PTY).

```typescript
// packages/backend/src/services/title-generator.ts
import type { TaskStore } from './task-store';
import type { WsEvent } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';

interface TitleGeneratorDeps {
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
  const { taskStore, broadcast } = deps;

  async function generate(taskId: string, description: string): Promise<void> {
    const prompt = `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: ${description}`;

    try {
      // Must strip CLAUDECODE and CLAUDE_CODE_ENTRYPOINT from env
      // (see MEMORY.md — required when spawning claude inside Claude Code)
      const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;

      const proc = Bun.spawn(['claude', '-p', prompt], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: cleanEnv,
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || !output.trim()) {
        return;
      }

      const title = output.trim().replace(/^["']|["']$/g, '');
      if (!title) return;

      const updated = await taskStore.updateTask(taskId, { title });
      broadcast({ type: MSG.TASK_UPDATED, payload: updated });
    } catch {
      // Silently fail — the description is shown as fallback
    }
  }

  return { generate };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/title-generator.ts
git commit -m "feat: add title generator service using claude CLI"
```

---

### Task 7: Trigger Title Generation on Task Create

**Files:**
- Modify: `packages/backend/src/handlers/task.ts:13-17,42-45`
- Modify: `packages/shared/src/types/ws.ts:49-53`

- [ ] **Step 1: Update TaskCreatePayload**

In `packages/shared/src/types/ws.ts`, change `TaskCreatePayload` (lines 49-53):

```typescript
export interface TaskCreatePayload {
  projectId: string;
  title?: string;
  description: string;
  worktree?: boolean;
}
```

Note: `title` becomes optional, `description` becomes required.

- [ ] **Step 2: Update task handler to accept title generator**

In `packages/backend/src/handlers/task.ts`, add the title generator to deps:

```typescript
interface TaskHandlerDeps {
  router: Router;
  store: TaskStore;
  closeSession?: (sessionId: string) => void;
  generateTitle?: (taskId: string, description: string) => void;
}
```

Update the destructuring:
```typescript
  const { router, store, closeSession, generateTitle } = deps;
```

Update the `TASK_CREATE` handler (lines 42-45):
```typescript
  router.register(MSG.TASK_CREATE, async (payload) => {
    const { projectId, title, description, worktree } = payload as TaskCreatePayload;
    const task = await store.createTask({
      projectId,
      title: title ?? '',
      description,
      worktree: worktree ? { enabled: true, path: null, branch: null } : undefined,
    });
    if (!title && description && generateTitle) {
      generateTitle(task.id, description);
    }
    return task;
  });
```

- [ ] **Step 3: Update backend TaskStore.createTask to accept worktree**

In `packages/backend/src/services/task-store.ts`, update the `createTask` method input type (lines 172-176):

```typescript
  async createTask(input: {
    projectId: string;
    title: string;
    description?: string;
    worktree?: TaskWorktree;
  }): Promise<Task> {
```

And inside the method, use the provided worktree:
```typescript
      worktree: input.worktree ?? { enabled: false, path: null, branch: null },
```

Also add the import for `TaskWorktree` at the top:
```typescript
import type { Project, Task, TaskWorktree } from '@taskflow/shared';
```

- [ ] **Step 4: Wire title generator in index.ts**

In `packages/backend/src/index.ts`, after creating the title generator deps become available. Import and create:

```typescript
import { createTitleGenerator } from './services/title-generator';
```

After `const server = createServer(...)` and before `registerTaskHandlers`:
```typescript
    const titleGenerator = createTitleGenerator({
      taskStore: store,
      broadcast: server.broadcast,
    });
```

Update `registerTaskHandlers` call:
```typescript
    registerTaskHandlers({
      router,
      store,
      closeSession: (sessionId) => {
        ptyManager.close(sessionId);
      },
      generateTitle: (taskId, description) => {
        void titleGenerator.generate(taskId, description);
      },
    });
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/ws.ts packages/backend/src/handlers/task.ts packages/backend/src/services/task-store.ts packages/backend/src/index.ts
git commit -m "feat: trigger title generation on empty-title task creation"
```

---

## Chunk 2: UI — New Task Dialog

### Task 8: Update UI Task Store

**Files:**
- Modify: `packages/ui/src/stores/task-store.ts`

- [ ] **Step 1: Update createTask signature and add TASK_UPDATED listener**

Update `packages/ui/src/stores/task-store.ts`:

Change the store interface:
```typescript
interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null;
  loading: boolean;
  fetchTasks(): Promise<void>;
  createTask(payload: {
    projectId: string;
    title?: string;
    description: string;
    worktree?: boolean;
  }): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<void>;
  archiveTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  setActiveTask(id: string | null): void;
  applyTaskUpdate(task: Task): void;
}
```

**Note:** `createTask` is only called from `TaskSidebar.tsx` (verified via grep), which is updated in Task 12.

Update `createTask` implementation:
```typescript
  async createTask(payload) {
    const task = await sendRequest<Task>(MSG.TASK_CREATE, payload);
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },
```

Add `applyTaskUpdate`:
```typescript
  applyTaskUpdate(task) {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
    }));
  },
```

Update the existing import on line 4 to add `onEvent`:
```typescript
import { sendRequest, onEvent } from '../hooks/useWebSocket';
```

Then, at module level (after the store creation), set up the event listener:

```typescript
// Listen for task updates from the HTTP API (e.g., title generation)
onEvent(MSG.TASK_UPDATED, (payload) => {
  const task = payload as Task;
  useTaskStore.getState().applyTaskUpdate(task);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/task-store.ts
git commit -m "feat: update task store for new create payload and task update events"
```

---

### Task 9: Add Switch UI Component

**Files:**
- Create: `packages/ui/src/components/ui/switch.tsx`

- [ ] **Step 1: Install radix switch if not already available**

Check if radix-ui already includes Switch (it's bundled in the `radix-ui` package used by the project). The project imports from `radix-ui` directly (e.g., `import { Dialog as DialogPrimitive } from "radix-ui"`), so Switch should be available as `import { Switch as SwitchPrimitive } from "radix-ui"`.

Create `packages/ui/src/components/ui/switch.tsx`:

```tsx
import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ui/switch.tsx
git commit -m "feat: add Switch UI component"
```

---

### Task 10: Add Label UI Component

**Files:**
- Create: `packages/ui/src/components/ui/label.tsx`

- [ ] **Step 1: Create Label component**

```tsx
// packages/ui/src/components/ui/label.tsx
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "text-xs font-medium text-muted-foreground uppercase tracking-wider peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ui/label.tsx
git commit -m "feat: add Label UI component"
```

---

### Task 11: Create NewTaskDialog Component

**Files:**
- Create: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
// packages/ui/src/components/sidebar/NewTaskDialog.tsx
import { useState, useCallback } from 'react';
import type { Project } from '@taskflow/shared';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  defaultProjectId?: string;
  onSubmit: (data: {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
  }) => void;
}

export function NewTaskDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  onSubmit,
}: NewTaskDialogProps) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [worktree, setWorktree] = useState(false);

  const resetForm = useCallback(() => {
    setDescription('');
    setTitle('');
    setWorktree(false);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    // Reset projectId to default when opening
    if (nextOpen) setProjectId(defaultProjectId ?? '');
    onOpenChange(nextOpen);
  }, [onOpenChange, resetForm, defaultProjectId]);

  const canSubmit = projectId !== '' && description.trim() !== '';

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      projectId,
      title: title.trim() || undefined,
      description: description.trim(),
      worktree,
    });
    resetForm();
    onOpenChange(false);
  }, [canSubmit, projectId, title, description, worktree, onSubmit, resetForm, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  }, [canSubmit, handleSubmit]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-task-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="new-task-project" className="w-full">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-task-description">Description</Label>
            <Textarea
              id="new-task-description"
              placeholder="Describe what this task should accomplish..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 max-h-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-task-title">
              Title{' '}
              <span className="text-muted-foreground/60 text-[10px] normal-case tracking-normal">
                (optional — auto-generated from description)
              </span>
            </Label>
            <Input
              id="new-task-title"
              placeholder="Short task name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="new-task-worktree"
              checked={worktree}
              onCheckedChange={setWorktree}
            />
            <Label htmlFor="new-task-worktree" className="normal-case tracking-normal cursor-pointer">
              Use git worktree
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx
git commit -m "feat: add NewTaskDialog component"
```

---

### Task 12: Wire Dialog into TaskSidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx`

- [ ] **Step 1: Replace window.prompt with NewTaskDialog**

Update `packages/ui/src/components/sidebar/TaskSidebar.tsx`:

Add import:
```typescript
import { NewTaskDialog } from './NewTaskDialog';
```

Update the React import on line 1 to add `useState`:
```typescript
import { useEffect, useMemo, useState } from 'react';
```

Add state inside the component:
```typescript
  const [newTaskOpen, setNewTaskOpen] = useState(false);
```

Replace the `handleNewTask` function (lines 54-61) with:
```typescript
  const handleNewTask = () => {
    if (projects.length === 0) {
      void handleAddProject().then((id) => {
        if (id) setNewTaskOpen(true);
      }).catch(() => {});
      return;
    }
    setNewTaskOpen(true);
  };

  const defaultProjectId = activeTaskId
    ? tasks.find((t) => t.id === activeTaskId)?.projectId ?? projects[0]?.id
    : projects[0]?.id;

  const handleCreateTask = async (data: {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
  }) => {
    try {
      const task = await createTask(data);
      setActiveTask(task.id);
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };
```

Add the dialog in the JSX, before the closing `</>`:
```tsx
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onSubmit={(data) => void handleCreateTask(data)}
      />
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: replace window.prompt with NewTaskDialog in TaskSidebar"
```

---

### Task 13: Update TaskCard to Show Description Fallback

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx:47-49`

- [ ] **Step 1: Show truncated description when title is empty**

In `packages/ui/src/components/sidebar/TaskCard.tsx`, update the title display (line 47-49):

Replace:
```tsx
      <div className={titleClasses}>
        {task.title}
      </div>
```

With:
```tsx
      <div className={titleClasses}>
        {task.title || (task.description.length > 40
          ? task.description.slice(0, 40) + '…'
          : task.description) || 'Untitled'}
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: show truncated description as fallback title in TaskCard"
```

---

### Task 14: Build & Verify

- [ ] **Step 1: Run TypeScript type check**

```bash
cd /Users/kuindji/Projects/taskflow
bun run --filter '*' tsc --noEmit
```

If type checking is not set up as a script, try:
```bash
cd packages/shared && bunx tsc --noEmit && cd ../backend && bunx tsc --noEmit && cd ../ui && bunx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run the dev server and verify manually**

```bash
# Terminal 1: backend
cd packages/backend && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT bun run dev

# Terminal 2: UI
cd packages/ui && VITE_BACKEND_PORT=9234 bun run dev
```

Verify:
1. Click "New Task" — dialog appears with Project, Description, Title, and Worktree toggle
2. Fill in description only, submit — task appears in sidebar with truncated description
3. After a few seconds, title should update to a generated one (if `claude` CLI is available)
4. Fill in both title and description — task appears with the provided title
5. Test PATCH endpoint directly: `curl -X PATCH http://localhost:9234/api/tasks/{taskId} -H 'Content-Type: application/json' -d '{"title":"New Title"}'`

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address build/type issues from new task dialog implementation"
```

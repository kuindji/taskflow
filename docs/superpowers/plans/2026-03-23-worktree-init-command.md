# Worktree Init Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow worktree tasks to run a shell command in the worktree immediately after initialization and before agent start, with a 30-second timeout.

**Architecture:** The init command is stored on the task, threaded through the title generator to worktree-setup, where it spawns a shell session in the worktree and waits for exit (up to 30s) before broadcasting task readiness. The CLI and UI both pass the new field through existing creation flows.

**Tech Stack:** TypeScript, Bun, shell script (taskflow-cli.sh)

**Spec:** `docs/superpowers/specs/2026-03-23-worktree-init-command-design.md`

---

### Task 1: Add `initCommand` to shared types

**Files:**
- Modify: `packages/shared/src/types/task.ts:24-37`
- Modify: `packages/shared/src/types/ws.ts:71-76`

- [ ] **Step 1: Add `initCommand` to `Task` interface**

In `packages/shared/src/types/task.ts`, add `initCommand` as an optional field on the `Task` interface:

```typescript
export interface Task {
    id: string;
    projectId: string;
    parentId?: string;
    title: string;
    description: string;
    notes: string;
    worktree: TaskWorktree;
    sessions: SessionRef[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
    pinned: boolean;
    initCommand?: string;
}
```

- [ ] **Step 2: Add `initCommand` to `TaskCreatePayload`**

In `packages/shared/src/types/ws.ts`, add `initCommand` to `TaskCreatePayload`:

```typescript
export interface TaskCreatePayload {
    projectId: string;
    parentId?: string;
    title?: string;
    description: string;
    worktree?: boolean;
    initCommand?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/task.ts packages/shared/src/types/ws.ts
git commit -m "feat: add initCommand field to Task and TaskCreatePayload types"
```

---

### Task 2: Thread `initCommand` through backend task creation (WebSocket handler)

**Files:**
- Modify: `packages/backend/src/handlers/task.ts:77-115`
- Modify: `packages/backend/src/services/task-store.ts:557-563`

- [ ] **Step 1: Accept `initCommand` in task store's `createTask`**

In `packages/backend/src/services/task-store.ts`, add `initCommand` to the `createTask` input and include it in the created task object:

```typescript
async createTask(input: {
    projectId: string;
    parentId?: string;
    title: string;
    description: string;
    worktree?: TaskWorktree;
    initCommand?: string;
}): Promise<Task> {
    const task: Task = {
        id: randomUUID(),
        projectId: input.projectId,
        parentId: input.parentId,
        title: input.title,
        description: input.description,
        notes: "",
        worktree: input.worktree ?? { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        createdAt: new Date().toISOString(),
        status: "active",
        archivedAt: null,
        pinned: false,
        ...(input.initCommand && { initCommand: input.initCommand }),
    };
```

- [ ] **Step 2: Pass `initCommand` in WebSocket handler**

In `packages/backend/src/handlers/task.ts`, extract `initCommand` from the payload and pass it through. The `initCommand` needs to reach `createWorktree` and `generateTitle`, both of which call `createWorktreeForTask`.

Update the `TaskHandlerDeps` interface — `createWorktree` and `generateTitle` need to accept `initCommand`:

```typescript
interface TaskHandlerDeps {
    router: Router;
    store: TaskStore;
    gitService: GitService;
    closeSession?: (sessionId: string) => void;
    generateTitle?: (taskId: string, description: string, initCommand?: string) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => void;
    flowStore?: FlowStore;
    flowRunner?: FlowRunner;
    changeTracker?: ChangeTracker;
}
```

Update the handler body to extract and pass `initCommand`:

```typescript
router.register(MSG.TASK_CREATE, async (payload) => {
    const { projectId, parentId, title, description, worktree, initCommand } =
        payload as TaskCreatePayload;

    // ... existing resolvedProjectId / resolvedWorktree logic unchanged ...

    const task = await store.createTask({
        projectId: resolvedProjectId,
        parentId,
        title: title ?? "",
        description,
        worktree: resolvedWorktree,
        initCommand: worktree && !parentId ? initCommand : undefined,
    });
    if (task.worktree.enabled && task.worktree.path && !task.parentId) {
        changeTracker?.track(task.id, task.worktree.path);
    }
    if (!title && description && generateTitle) {
        generateTitle(task.id, description, task.initCommand);
    } else if (title && task.worktree.enabled && !task.worktree.path && !task.parentId) {
        createWorktree?.(task.id, title, task.initCommand);
    }
    return task;
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/task.ts packages/backend/src/services/task-store.ts
git commit -m "feat: thread initCommand through WebSocket task creation handler"
```

---

### Task 3: Thread `initCommand` through title generator

**Files:**
- Modify: `packages/backend/src/services/title-generator.ts:8-12,17,38,44,54,57`

- [ ] **Step 1: Update title generator to accept and forward `initCommand`**

Update `TitleGeneratorDeps` and `generate` to pass `initCommand` through to `createWorktree`:

```typescript
interface TitleGeneratorDeps {
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
    const { taskStore, broadcast, createWorktree } = deps;

    async function generate(
        taskId: string,
        description: string,
        initCommand?: string,
    ): Promise<void> {
        // ... existing prompt/proc logic unchanged ...

        try {
            // ... existing proc spawn logic ...

            if (exitCode !== 0 || !output.trim()) {
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const title = output.trim().replace(/^["']|["']$/g, "");
            if (!title) {
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const updated = await taskStore.updateTask(taskId, { title });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });

            await createWorktree?.(taskId, title, initCommand);
        } catch {
            await createWorktree?.(taskId, description, initCommand).catch(() => {});
        }
    }

    return { generate };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/title-generator.ts
git commit -m "feat: thread initCommand through title generator to worktree setup"
```

---

### Task 4: Implement init command execution in worktree-setup

**Files:**
- Modify: `packages/backend/src/services/worktree-setup.ts`

This is the core change. After worktree creation, if `initCommand` is set, spawn a shell session, wait up to 30s, then broadcast.

- [ ] **Step 1: Update `WorktreeSetupDeps` and function signature**

Add `createSession`, `ptyManager`, `systemShellPath`, and `logToTask` to deps. Update `createWorktreeForTask` to accept `initCommand`:

```typescript
import { join } from "path";
import type { TaskStore } from "./task-store";
import type { GitService } from "./git-service";
import type { WsEvent } from "@taskflow/shared";
import type { ChangeTracker } from "./change-tracker";
import type { PtyManager } from "./pty-manager";
import type { CreateSessionOpts } from "./session-lifecycle";
import { MSG } from "@taskflow/shared";
import { slugify } from "../utils/slugify";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface WorktreeSetupDeps {
    taskStore: TaskStore;
    gitService: GitService;
    broadcast: (event: WsEvent) => void;
    changeTracker?: ChangeTracker;
    createSession?: (opts: CreateSessionOpts) => Promise<string>;
    ptyManager?: PtyManager;
    systemShellPath?: string | null;
    logToTask?: (taskId: string, type: "info" | "warning", message: string) => Promise<void>;
}
```

- [ ] **Step 2: Implement the init command runner**

Add a private helper `runInitCommand` and call it from `createWorktreeForTask`:

```typescript
export function createWorktreeSetup(deps: WorktreeSetupDeps) {
    const {
        taskStore,
        gitService,
        broadcast,
        changeTracker,
        createSession,
        ptyManager,
        systemShellPath,
        logToTask,
    } = deps;

    async function runInitCommand(
        taskId: string,
        worktreePath: string,
        initCommand: string,
    ): Promise<void> {
        if (!createSession || !ptyManager || !systemShellPath) return;

        const exitPromise = new Promise<number>((resolve) => {
            let resolved = false;
            void createSession({
                owner: { taskId },
                type: "shell",
                shell: systemShellPath,
                cwd: worktreePath,
                label: "Init",
                onSessionExited: (_sessionId, exitCode) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(exitCode);
                    }
                },
            }).then((sessionId) => {
                // Small delay to let the PTY initialize before writing
                setTimeout(() => {
                    try {
                        ptyManager.write(sessionId, `${initCommand}; exit $?\r`);
                    } catch {
                        // Session may have already exited
                        if (!resolved) {
                            resolved = true;
                            resolve(1);
                        }
                    }
                }, 100);
            });
        });

        const TIMEOUT_MS = 30_000;
        const timeoutPromise = new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), TIMEOUT_MS),
        );

        const result = await Promise.race([exitPromise, timeoutPromise]);

        if (result === "timeout") {
            await logToTask?.(taskId, "warning", `Init command timed out after 30s: ${initCommand}`);
        } else if (result !== 0) {
            await logToTask?.(
                taskId,
                "warning",
                `Init command exited with code ${result}: ${initCommand}`,
            );
        } else {
            await logToTask?.(taskId, "info", `Init command completed: ${initCommand}`);
        }
    }

    async function createWorktreeForTask(
        taskId: string,
        nameSource: string,
        initCommand?: string,
    ): Promise<void> {
        const task = await taskStore.getTask(taskId);
        if (!task || !task.worktree.enabled || task.worktree.path) return;

        const project = await taskStore.getProject(task.projectId);
        if (!project) return;

        const slug = slugify(nameSource);
        if (!slug) return;

        const branch = `task/${slug}`;
        const worktreePath = join(project.path, ".worktrees", slug);

        try {
            await gitService.createWorktree(project.path, branch, worktreePath);
            changeTracker?.track(taskId, worktreePath);

            // IMPORTANT: Do NOT persist worktree.path yet. If we do,
            // createSession (for the init shell) will broadcast TASK_UPDATED
            // with the path set, causing the UI to start the agent prematurely.
            // Instead, run the init command first using explicit `cwd`, then
            // persist the path and broadcast in one step.
            const cmd = initCommand ?? task.initCommand;
            if (cmd) {
                await runInitCommand(taskId, worktreePath, cmd);
            }

            // Now persist the worktree path and broadcast — this unblocks
            // the UI's pending agent start.
            const updated = await taskStore.updateTask(taskId, {
                worktree: { enabled: true, path: worktreePath, branch, pr: null },
            });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });
        } catch (error) {
            console.error(`Failed to create worktree for task ${taskId}:`, error);
            const updated = await taskStore.updateTask(taskId, {
                worktree: { enabled: false, path: null, branch: null, pr: null },
            });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });
        }
    }

    return { createWorktreeForTask };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/worktree-setup.ts
git commit -m "feat: run init command in worktree after creation with 30s timeout"
```

---

### Task 5: Wire new dependencies in index.ts

**Files:**
- Modify: `packages/backend/src/index.ts:138-148,225-233,322-327`

- [ ] **Step 1: Add logToTask helper and wire deps**

Add a `logToTask` helper and pass the new deps to `createWorktreeSetup`:

```typescript
// Helper to log to task log (used by worktree-setup for init command results)
// appendTaskLog signature: (taskId, sessionId, type, message, meta?)
async function logToTask(
    taskId: string,
    type: "info" | "warning",
    message: string,
): Promise<void> {
    try {
        await store.appendTaskLog(taskId, "system", type, message);
    } catch {
        // Best-effort logging
    }
}

const worktreeSetup = createWorktreeSetup({
    taskStore: store,
    gitService,
    broadcast: server.broadcast,
    changeTracker,
    createSession: (opts) => sessionLifecycle.createSession(opts),
    ptyManager,
    systemShellPath,
    logToTask,
});
```

Note: `sessionLifecycle` is created before `worktreeSetup` in the current code (line ~120-136), so it's available. Check the actual ordering — if `worktreeSetup` is created before `sessionLifecycle`, the closure-based reference pattern (like `flowRunner` uses) works since `createWorktreeForTask` is only called later.

- [ ] **Step 2: Update `generateTitle` and `createWorktree` calls in task handler wiring**

In the task handler registration (~line 225-233), update to pass `initCommand`:

```typescript
generateTitle: (taskId, description, initCommand) => {
    void titleGenerator.generate(taskId, description, initCommand);
},
createWorktree: (taskId, nameSource, initCommand) => {
    void worktreeSetup.createWorktreeForTask(taskId, nameSource, initCommand);
},
```

- [ ] **Step 3: Update routes wiring**

In the routes registration (~line 322-327), update the `createWorktree` passed to routes:

```typescript
createWorktree: worktreeSetup.createWorktreeForTask,
```

This already matches since `createWorktreeForTask` accepts the optional `initCommand` parameter.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: wire init command dependencies into worktree setup"
```

---

### Task 6: Thread `initCommand` through REST API (routes.ts)

**Files:**
- Modify: `packages/backend/src/api/routes.ts:365-410`

- [ ] **Step 1: Extract and pass `initCommand` in task creation route**

In the `POST /api/projects/:projectId/tasks` handler, extract `initCommand` from the request body and pass it to `createWorktree`:

```typescript
apiRouter.register("POST", "/api/projects/:projectId/tasks", async (req, params) => {
    // ... existing body parsing and validation ...

    const initCommand =
        typeof body.initCommand === "string" && body.initCommand.trim()
            ? body.initCommand.trim()
            : undefined;

    try {
        let task = await taskStore.createTask({
            projectId: params.projectId,
            title: title ?? "",
            description: description.trim(),
            worktree,
            initCommand: worktree ? initCommand : undefined,
        });

        if (worktree && createWorktree) {
            await createWorktree(task.id, title ?? description.trim(), task.initCommand);
            task = (await taskStore.getTask(task.id)) ?? task;
        }

        if (!title && generateTitle) {
            generateTitle(task.id, description.trim());
        }

        broadcast({ type: MSG.TASK_CREATED, payload: task });
        return jsonResponse(task, 201);
    } catch (err) {
        // ... existing error handling ...
    }
});
```

Note: In the REST path, when `worktree` is set AND `title` is provided, worktree creation is awaited directly (not via `generateTitle`). The `initCommand` is passed directly to `createWorktree`. When no title is given, `generateTitle` runs — but it doesn't receive `initCommand` here since the REST path generates the title first, then calls `createWorktree`. However, `initCommand` is persisted on the task, so `createWorktreeForTask` reads `task.initCommand` as a fallback. This is handled in Task 4's implementation where `const cmd = initCommand ?? task.initCommand`.

- [ ] **Step 2: Update `createWorktree` type in `ApiRouteDeps`**

In the `ApiRouteDeps` interface, update the `createWorktree` signature:

```typescript
createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/api/routes.ts
git commit -m "feat: pass initCommand through REST API task creation endpoint"
```

---

### Task 7: Update CLI shell script

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh:85-115`

- [ ] **Step 1: Add `--init` flag to `task create` command**

Update the `task create` section of `taskflow-cli.sh` to parse `--init` and include it in the JSON body:

```bash
    elif [ "$subcmd" = "create" ]; then
      shift
      if [ -z "$TASKFLOW_PROJECT_ID" ]; then
        echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
        exit 1
      fi
      description="${1:-}"
      if [ -z "$description" ]; then
        echo "Usage: taskflow-cli task create <description> [--title <title>] [--worktree] [--init <command>]" >&2
        exit 1
      fi
      shift

      title=""
      worktree=""
      init_command=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --title) title="${2:-}"; shift 2 ;;
          --worktree) worktree="true"; shift ;;
          --init) init_command="${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done

      json_body="$(printf '"description":%s' "$(json_string "$description")")"
      if [ -n "$title" ]; then
        json_body="$(printf '%s,"title":%s' "$json_body" "$(json_string "$title")")"
      fi
      if [ -n "$worktree" ]; then
        json_body="$json_body,\"worktree\":true"
      fi
      if [ -n "$init_command" ]; then
        json_body="$(printf '%s,"initCommand":%s' "$json_body" "$(json_string "$init_command")")"
      fi
```

- [ ] **Step 2: Update usage help text**

Update the help text at the bottom of the script (~line 1249):

```bash
    echo "  task create <desc> [--title t] [--worktree] [--init cmd]  Create a new task" >&2
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.sh
git commit -m "feat: add --init flag to taskflow-cli task create command"
```

---

### Task 8: Update CLI skill documentation

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli-skill.md`

- [ ] **Step 1: Update the skill doc**

Find the `task create` documentation in `taskflow-cli-skill.md` and add the `--init` flag. The exact location depends on the file contents, but add documentation like:

```
`taskflow-cli task create "Fix login timeout bug" --worktree --init "bun install"` Create task with worktree and init command
```

Also add a note explaining the behavior:
- The `--init` flag runs a shell command in the worktree after initialization, before agent start
- Has a 30-second timeout; if it hasn't finished by then, agent start proceeds anyway
- Only meaningful with `--worktree`

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/taskflow-cli-skill.md
git commit -m "docs: add --init flag to taskflow-cli skill documentation"
```

---

### Task 9: UI — Add init command input to NewTaskDialog

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx:33-42,53-78,114-149,166-312`
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx:96-147`

- [ ] **Step 1: Update `NewTaskDialogProps` onSubmit type**

Add `initCommand` to the onSubmit data type:

```typescript
onSubmit: (data: {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
    parentId?: string;
    startWith?: "claude" | "codex" | "opencode" | "gemini" | "cursor";
    agentOptions?: AgentLaunchOptions;
    startWithFlowId?: string;
    initCommand?: string;
}) => void;
```

- [ ] **Step 2: Add state and include in form**

Add state for `initCommand`:

```typescript
const [initCommand, setInitCommand] = useState("");
```

Update `resetForm` to clear it:

```typescript
const resetForm = useCallback(() => {
    setDescription("");
    setTitle("");
    setWorktree(false);
    setStartWith("none");
    setAgentOptions(undefined);
    setStartWithFlowId("");
    setInitCommand("");
}, []);
```

Update `handleSubmit` to include `initCommand`:

```typescript
onSubmit({
    projectId,
    title: title.trim() || undefined,
    description: description.trim(),
    worktree: isSubtask ? false : worktree,
    parentId: parentId ?? undefined,
    startWith: /* ... existing logic ... */,
    agentOptions,
    startWithFlowId: startWith === "flow" && startWithFlowId ? startWithFlowId : undefined,
    initCommand: worktree && initCommand.trim() ? initCommand.trim() : undefined,
});
```

Add `initCommand` to `handleSubmit`'s dependency array.

- [ ] **Step 3: Add the input field to the form**

Add an `Input` field right after the worktree switch, visible only when `worktree` is checked and not a subtask:

```tsx
{!isSubtask && worktree && (
    <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-task-init-command">
            Init command{" "}
            <span className="text-muted-foreground/60 text-xs tracking-normal normal-case">
                (optional — runs in worktree before agent starts)
            </span>
        </Label>
        <Input
            id="new-task-init-command"
            placeholder="bun install"
            value={initCommand}
            onChange={(e) => setInitCommand(e.target.value)}
        />
    </div>
)}
```

Place this JSX between the worktree switch block (line ~223-236) and the "Start immediately with" select (line ~238).

- [ ] **Step 4: Update `TaskCreationDialogHost` to pass `initCommand`**

In `TaskCreationDialogHost.tsx`, update the `handleCreateTask` callback to extract and pass `initCommand`. The `data` parameter type already gets `initCommand` from the updated `NewTaskDialog` onSubmit type.

Update the `createTask` call:

```typescript
const task = await createTask({
    ...data,
    // initCommand is already in data from the dialog
});
```

If `createTask` in the task store doesn't yet accept `initCommand`, update the call to include it in the payload sent to the backend.

- [ ] **Step 5: Update UI task store `createTask` payload type**

In `packages/ui/src/stores/task-store.ts`, the `createTask` method has its own payload type (line ~16-22) that must include `initCommand`. Update:

```typescript
createTask(payload: {
    projectId: string;
    title?: string;
    description: string;
    worktree?: boolean;
    parentId?: string;
    initCommand?: string;
}): Promise<Task>;
```

The implementation at line ~89 sends `MSG.TASK_CREATE` with this payload, which matches the shared `TaskCreatePayload` type.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx packages/ui/src/stores/task-store.ts
git commit -m "feat: add init command input to NewTaskDialog UI"
```

---

### Task 10: Verify end-to-end

- [ ] **Step 1: Build and verify no type errors**

```bash
cd /Users/kuindji/Projects/taskflow && bun run build
```

Expected: Clean build with no type errors.

- [ ] **Step 2: Run existing tests**

```bash
cd /Users/kuindji/Projects/taskflow && bun test
```

Expected: All existing tests pass.

- [ ] **Step 3: Manual verification**

Test the full flow:
1. Start the app
2. Create a task with worktree and init command via CLI: `taskflow-cli task create "Test init" --worktree --init "echo hello"`
3. Verify the "Init" session tab appears
4. Verify the command runs and the tab shows output
5. Verify the task log shows the init command result
6. Create a task with worktree and init command via the UI dialog
7. Verify the same behavior

- [ ] **Step 4: Final commit if any fixes needed**

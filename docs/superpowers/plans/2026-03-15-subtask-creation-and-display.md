# Subtask Creation and Display Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-level subtask support — create, display, archive/delete cascade, and inherit parent worktree.

**Architecture:** Subtasks are regular tasks with a `parentId` field. The backend validates single-level nesting and cascades archive/delete. The UI partitions tasks into parents and subtasks in the sidebar, with expand/collapse and a "+" button for subtask creation.

**Tech Stack:** TypeScript, Zustand, React, file-based JSON storage, WebSocket messaging.

**Spec:** `docs/superpowers/specs/2026-03-15-subtask-creation-and-display-design.md`

---

## Chunk 1: Shared Types and Backend

### Task 1: Add `parentId` to shared types

**Files:**
- Modify: `packages/shared/src/types/task.ts:16-27`
- Modify: `packages/shared/src/types/ws.ts:57-62`

- [ ] **Step 1: Add `parentId` to Task interface**

In `packages/shared/src/types/task.ts`, add `parentId` after `projectId`:

```typescript
export interface Task {
    id: string;
    projectId: string;
    parentId?: string;
    title: string;
    // ... rest unchanged
}
```

- [ ] **Step 2: Add `parentId` to TaskCreatePayload**

In `packages/shared/src/types/ws.ts`:

```typescript
export interface TaskCreatePayload {
    projectId: string;
    parentId?: string;
    title?: string;
    description: string;
    worktree?: boolean;
}
```

- [ ] **Step 3: Build to verify types compile**

Run: `cd packages/shared && bun run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/task.ts packages/shared/src/types/ws.ts
git commit -m "feat: add parentId to Task and TaskCreatePayload types"
```

---

### Task 2: Backend — subtask creation with validation

**Files:**
- Modify: `packages/backend/src/services/task-store.ts:509-529` (createTask method)
- Modify: `packages/backend/src/handlers/task.ts:47-59` (TASK_CREATE handler)

- [ ] **Step 1: Update `createTask` input to accept `parentId`**

In `packages/backend/src/services/task-store.ts`, update the `createTask` method signature to accept `parentId`:

```typescript
async createTask(input: {
    projectId: string;
    parentId?: string;
    title: string;
    description: string;
    worktree?: TaskWorktree;
}): Promise<Task> {
    const task: Task = {
        id: randomUUID(),
        projectId: input.projectId,
        parentId: input.parentId,
        title: input.title,
        description: input.description,
        notes: "",
        worktree: input.worktree ?? { enabled: false, path: null, branch: null },
        sessions: [],
        createdAt: new Date().toISOString(),
        status: "active",
        archivedAt: null,
    };
    await this.writeTask(this.taskPath(task.id), task);
    return task;
}
```

- [ ] **Step 2: Add `getSubtasks` helper to TaskStore**

Add after the `listTasks` method in `task-store.ts`:

```typescript
async getSubtasks(parentId: string): Promise<Task[]> {
    const tasks = await this.listTasks();
    return tasks.filter((t) => t.parentId === parentId);
}

async getArchivedSubtasks(parentId: string): Promise<Task[]> {
    const tasks = await this.listArchived();
    return tasks.filter((t) => t.parentId === parentId);
}
```

- [ ] **Step 3: Update TASK_CREATE handler with validation**

In `packages/backend/src/handlers/task.ts`, update the `TASK_CREATE` handler:

```typescript
router.register(MSG.TASK_CREATE, async (payload) => {
    const { projectId, parentId, title, description, worktree } = payload as TaskCreatePayload;

    let taskProjectId = projectId;
    let taskWorktree: TaskWorktree | undefined = worktree
        ? { enabled: true, path: null, branch: null }
        : undefined;

    if (parentId) {
        const parent = await store.getTask(parentId);
        if (!parent) throw new Error(`Parent task not found: ${parentId}`);
        if (parent.parentId) throw new Error("Subtasks cannot be nested: parent is already a subtask");
        if (parent.status !== "active") throw new Error("Cannot add subtask to archived task");
        taskProjectId = parent.projectId;
        taskWorktree = { ...parent.worktree };
    }

    const task = await store.createTask({
        projectId: taskProjectId,
        parentId,
        title: title ?? "",
        description,
        worktree: taskWorktree,
    });
    if (!title && description && generateTitle) {
        generateTitle(task.id, description);
    }
    return task;
});
```

Note: This requires importing `TaskWorktree` in `task.ts`. The file currently has two import blocks from `@taskflow/shared`:
- Lines 3-10: `import type { TaskListPayload, TaskCreatePayload, ... } from "@taskflow/shared";`
- Line 14: `import type { Task } from "@taskflow/shared";`

Merge them into one: move `Task` and add `TaskWorktree` into the lines 3-10 import block, then delete line 14:

```typescript
import type {
    TaskListPayload,
    TaskCreatePayload,
    TaskUpdatePayload,
    TaskArchivePayload,
    TaskUnarchivePayload,
    TaskDeletePayload,
    TaskLogListPayload,
    Task,
    TaskWorktree,
} from "@taskflow/shared";
```

- [ ] **Step 4: Build backend to verify**

Run: `cd packages/backend && bun run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/task-store.ts packages/backend/src/handlers/task.ts
git commit -m "feat: backend subtask creation with parent validation"
```

---

### Task 3: Backend — archive cascade

**Files:**
- Modify: `packages/backend/src/handlers/task.ts:66-72` (TASK_ARCHIVE handler)
- Modify: `packages/backend/src/handlers/task.ts:79-82` (TASK_UNARCHIVE handler)

- [ ] **Step 1: Update TASK_ARCHIVE handler to cascade**

Replace the existing `TASK_ARCHIVE` handler:

```typescript
router.register(MSG.TASK_ARCHIVE, async (payload) => {
    const { id } = payload as TaskArchivePayload;
    const task = await store.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    // Stop sessions and archive subtasks first
    const subtasks = await store.getSubtasks(id);
    for (const subtask of subtasks) {
        await stopTaskSessions(subtask, true);
        await store.archiveTask(subtask.id);
    }

    await stopTaskSessions(task, true);
    return store.archiveTask(id);
});
```

- [ ] **Step 2: Update TASK_UNARCHIVE handler to cascade**

Replace the existing `TASK_UNARCHIVE` handler:

```typescript
router.register(MSG.TASK_UNARCHIVE, async (payload) => {
    const { id } = payload as TaskUnarchivePayload;
    const result = await store.unarchiveTask(id);

    // Unarchive subtasks automatically
    const archivedSubtasks = await store.getArchivedSubtasks(id);
    for (const subtask of archivedSubtasks) {
        await store.unarchiveTask(subtask.id);
    }

    return result;
});
```

- [ ] **Step 3: Build backend to verify**

Run: `cd packages/backend && bun run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/task.ts
git commit -m "feat: archive/unarchive cascade for subtasks"
```

---

### Task 4: Backend — delete cascade

**Files:**
- Modify: `packages/backend/src/handlers/task.ts:84-109` (TASK_DELETE handler)

- [ ] **Step 1: Update TASK_DELETE handler to cascade and ignore worktree for subtasks**

Replace the existing `TASK_DELETE` handler:

```typescript
router.register(MSG.TASK_DELETE, async (payload) => {
    const { id, deleteWorktree } = payload as TaskDeletePayload;
    const task = (await store.getTask(id)) ?? (await store.getArchived(id));
    if (!task) throw new Error(`Task not found: ${id}`);

    // Delete subtasks first (only top-level tasks can have subtasks)
    if (!task.parentId) {
        const subtasks = [
            ...(await store.getSubtasks(id)),
            ...(await store.getArchivedSubtasks(id)),
        ];
        for (const subtask of subtasks) {
            if (subtask.status === "active") {
                await stopTaskSessions(subtask, false);
                await store.deleteTask(subtask.id);
            } else {
                await store.deleteArchived(subtask.id);
            }
        }
    }

    if (task.status === "active") {
        await stopTaskSessions(task, false);
        await store.deleteTask(id);
    } else {
        await store.deleteArchived(id);
    }

    // Only clean up worktree for top-level tasks (subtasks share parent's worktree)
    if (
        deleteWorktree &&
        !task.parentId &&
        task.worktree.enabled &&
        task.worktree.path &&
        task.worktree.branch
    ) {
        const project = await store.getProject(task.projectId);
        if (project) {
            try {
                await gitService.removeWorktree(project.path, task.worktree.path);
                await gitService.deleteBranch(project.path, task.worktree.branch);
            } catch (error) {
                console.error(`Failed to clean up worktree for task ${id}:`, error);
            }
        }
    }

    return { success: true };
});
```

- [ ] **Step 2: Build backend to verify**

Run: `cd packages/backend && bun run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/task.ts
git commit -m "feat: delete cascade for subtasks, ignore worktree on subtask delete"
```

---

## Chunk 2: UI State and Task Creation

### Task 5: UI store — expand state and subtask helpers

**Files:**
- Modify: `packages/ui/src/stores/task-store.ts`
- Modify: `packages/ui/src/stores/task-creation-store.ts`

- [ ] **Step 1: Add expand state and subtask helpers to TaskStore**

In `packages/ui/src/stores/task-store.ts`, update the interface:

```typescript
interface TaskStore {
    tasks: Task[];
    archivedTasks: Task[];
    showArchive: boolean;
    activeTaskId: string | null;
    loading: boolean;
    taskLogs: Record<string, TaskLogEntry[]>;
    expandedTasks: Record<string, boolean>;
    fetchTasks(): Promise<void>;
    fetchArchivedTasks(): Promise<void>;
    setShowArchive(show: boolean): void;
    createTask(payload: {
        projectId: string;
        parentId?: string;
        title?: string;
        description: string;
        worktree?: boolean;
    }): Promise<Task>;
    applyTaskUpdate(task: Task): void;
    updateTask(id: string, updates: Partial<Task>): Promise<void>;
    archiveTask(id: string): Promise<void>;
    unarchiveTask(id: string): Promise<void>;
    deleteTask(id: string, options?: { deleteWorktree?: boolean }): Promise<void>;
    setActiveTask(id: string | null): void;
    toggleTaskExpanded(taskId: string): void;
    fetchTaskLog(taskId: string): Promise<void>;
    appendLogEntry(taskId: string, entry: TaskLogEntry): void;
}
```

Add `expandedTasks: {}` to the initial state in `create<TaskStore>`.

- [ ] **Step 2: Add `toggleTaskExpanded` action**

```typescript
toggleTaskExpanded(taskId) {
    set((s) => ({
        expandedTasks: {
            ...s.expandedTasks,
            [taskId]: !s.expandedTasks[taskId],
        },
    }));
},
```

- [ ] **Step 3: Update `createTask` to accept and pass `parentId`, auto-expand parent**

```typescript
async createTask(payload) {
    const task = await sendRequest<Task>(MSG.TASK_CREATE, payload);
    set((s) => ({
        tasks: sortTasksByCreatedAtDesc([...s.tasks, task]),
        expandedTasks: payload.parentId
            ? { ...s.expandedTasks, [payload.parentId]: true }
            : s.expandedTasks,
    }));
    return task;
},
```

- [ ] **Step 4: Update `archiveTask` to also remove subtasks and clear activeTaskId for subtasks**

```typescript
async archiveTask(id) {
    await sendRequest(MSG.TASK_ARCHIVE, { id });
    set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id),
        activeTaskId:
            s.activeTaskId === id ||
            s.tasks.some((t) => t.parentId === id && t.id === s.activeTaskId)
                ? null
                : s.activeTaskId,
    }));
    if (useTaskStore.getState().showArchive) {
        void useTaskStore.getState().fetchArchivedTasks();
    }
},
```

- [ ] **Step 5: Update `deleteTask` to also remove subtasks and clear activeTaskId for subtasks**

```typescript
async deleteTask(id, options) {
    await sendRequest(MSG.TASK_DELETE, { id, deleteWorktree: options?.deleteWorktree });
    set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id),
        archivedTasks: s.archivedTasks.filter((t) => t.id !== id && t.parentId !== id),
        activeTaskId:
            s.activeTaskId === id ||
            s.tasks.some((t) => t.parentId === id && t.id === s.activeTaskId)
                ? null
                : s.activeTaskId,
    }));
},
```

**Note on `unarchiveTask`:** The current implementation already calls `fetchTasks()` after unarchive, which picks up cascade-unarchived subtasks. No changes needed.

- [ ] **Step 7: Add `parentId` to task-creation-store**

In `packages/ui/src/stores/task-creation-store.ts`, add subtask creation support:

```typescript
interface TaskCreationStore {
    newTaskOpen: boolean;
    newProjectOpen: boolean;
    openTaskAfterProject: boolean;
    projectError: string | null;
    parentTaskId: string | null;
    requestNewTask(): void;
    requestNewSubtask(parentTaskId: string): void;
    openProjectDialog(thenOpenTask?: boolean): void;
    setNewTaskOpen(open: boolean): void;
    setNewProjectOpen(open: boolean): void;
    setProjectError(error: string | null): void;
    handleProjectCreated(): void;
}
```

Add to initial state: `parentTaskId: null`

Add the `requestNewSubtask` action:

```typescript
requestNewSubtask(parentTaskId: string) {
    set({
        newTaskOpen: true,
        parentTaskId,
        newProjectOpen: false,
        openTaskAfterProject: false,
        projectError: null,
    });
},
```

Update `requestNewTask` to clear `parentTaskId`:

```typescript
requestNewTask() {
    const hasProjects = useProjectStore.getState().projects.length > 0;
    set({
        newTaskOpen: hasProjects,
        newProjectOpen: !hasProjects,
        openTaskAfterProject: !hasProjects,
        projectError: null,
        parentTaskId: null,
    });
},
```

Update `setNewTaskOpen` to clear `parentTaskId` when closing:

```typescript
setNewTaskOpen(open) {
    set(open ? { newTaskOpen: open } : { newTaskOpen: open, parentTaskId: null });
},
```

- [ ] **Step 8: Build UI to verify**

Run: `cd packages/ui && bun run build`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/stores/task-store.ts packages/ui/src/stores/task-creation-store.ts
git commit -m "feat: UI store support for subtask expand state and creation"
```

---

### Task 6: NewTaskDialog — subtask mode

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- [ ] **Step 1: Add `parentId` prop and adjust dialog**

Update `NewTaskDialogProps`:

```typescript
interface NewTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Project[];
    defaultProjectId?: string;
    parentId?: string | null;
    onSubmit: (data: {
        projectId: string;
        parentId?: string;
        title?: string;
        description: string;
        worktree: boolean;
        startWith?: "claude" | "codex";
        agentOptions?: AgentLaunchOptions;
    }) => void;
}
```

Update the component to accept `parentId` in props:

```typescript
export function NewTaskDialog({
    open,
    onOpenChange,
    projects,
    defaultProjectId,
    parentId,
    onSubmit,
}: NewTaskDialogProps) {
```

- [ ] **Step 2: Derive isSubtask and parent project**

Add after `descriptionRef`:

```typescript
const isSubtask = !!parentId;
```

- [ ] **Step 3: Update handleSubmit to include parentId**

In the `handleSubmit` callback, update the `onSubmit` call:

```typescript
const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
        projectId,
        parentId: parentId ?? undefined,
        title: title.trim() || undefined,
        description: description.trim(),
        worktree: isSubtask ? false : worktree,
        startWith: startWith === "claude" || startWith === "codex" ? startWith : undefined,
        agentOptions,
    });
    resetForm();
    onOpenChange(false);
}, [
    canSubmit,
    projectId,
    parentId,
    isSubtask,
    title,
    description,
    worktree,
    startWith,
    agentOptions,
    onSubmit,
    resetForm,
    onOpenChange,
]);
```

- [ ] **Step 4: Update dialog title**

Change the `DialogTitle`:

```tsx
<DialogTitle>{isSubtask ? "New Subtask" : "New Task"}</DialogTitle>
```

- [ ] **Step 5: Conditionally hide project selector and worktree toggle**

Wrap the project selector section:

```tsx
{!isSubtask && (
    <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-task-project">Project</Label>
        {/* ... existing Select component ... */}
    </div>
)}
```

Wrap the worktree toggle:

```tsx
{!isSubtask && (
    <div className="flex items-center gap-2">
        <Switch ... />
        <Label ...>Use git worktree</Label>
    </div>
)}
```

- [ ] **Step 6: Update canSubmit for subtasks (no projectId needed since inherited)**

```typescript
const canSubmit = (isSubtask || projectId !== "") && description.trim() !== "";
```

- [ ] **Step 7: Update Create button text**

```tsx
<Button
    onClick={handleSubmit}
    disabled={!canSubmit}
    className="bg-accent text-accent-foreground hover:bg-accent/90"
>
    {isSubtask ? "Create Subtask" : "Create Task"}
</Button>
```

- [ ] **Step 8: Build UI to verify**

Run: `cd packages/ui && bun run build`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx
git commit -m "feat: NewTaskDialog subtask mode — hide project/worktree, pass parentId"
```

---

### Task 7: Wire NewTaskDialog parentId from TaskCreationDialogHost

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`

- [ ] **Step 1: Read `parentTaskId` from task-creation-store and pass to NewTaskDialog**

In `TaskCreationDialogHost.tsx`, add to the destructured store values:

```typescript
const {
    newTaskOpen,
    newProjectOpen,
    projectError,
    parentTaskId,
    setNewTaskOpen,
    setNewProjectOpen,
    setProjectError,
    handleProjectCreated,
} = useTaskCreationStore();
```

Pass it to `NewTaskDialog`:

```tsx
<NewTaskDialog
    open={newTaskOpen}
    onOpenChange={setNewTaskOpen}
    projects={projects}
    defaultProjectId={defaultProjectId}
    parentId={parentTaskId}
    onSubmit={(data) => void handleCreateTask(data)}
/>
```

- [ ] **Step 2: Update `handleCreateTask` type to include `parentId`**

Update the `data` parameter type in `handleCreateTask`:

```typescript
const handleCreateTask = useCallback(
    async (data: {
        projectId: string;
        parentId?: string;
        title?: string;
        description: string;
        worktree: boolean;
        startWith?: "claude" | "codex";
        agentOptions?: AgentLaunchOptions;
    }) => {
        try {
            const task = await createTask(data);
            setActiveProject(task.projectId);
            setActiveTask(task.id);
            if (data.startWith) {
                if (data.worktree && !data.parentId) {
                    // Defer session start until worktree is ready
                    // (subtasks inherit worktree which is already ready)
                    pendingSessionRef.current = {
                        taskId: task.id,
                        type: data.startWith,
                        description: data.description,
                        agentOptions: data.agentOptions,
                    };
                } else {
                    await createSession(
                        { taskId: task.id },
                        data.startWith,
                        undefined,
                        data.description,
                        undefined,
                        data.agentOptions,
                    );
                }
            }
        } catch (err) {
            console.error("Failed to create task:", err);
        }
    },
    [createSession, createTask, setActiveProject, setActiveTask],
);
```

Note: For subtasks, `data.worktree` will be `false` (dialog hides it), but the created task inherits the parent's worktree (which already has a path). So session creation goes to the `else` branch directly — no deferred session needed.

- [ ] **Step 3: Build and verify**

Run: `cd packages/ui && bun run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx
git commit -m "feat: wire parentId from task-creation-store to NewTaskDialog"
```

---

## Chunk 3: Sidebar UI — Subtask Display

### Task 8: ProjectGroup — partition and render subtasks

**Files:**
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx`

- [ ] **Step 1: Partition tasks into top-level and subtask map**

Inside the `ProjectGroup` component, add the partitioning logic using `useMemo`:

```typescript
const { topLevelTasks, subtaskMap } = useMemo(() => {
    const topLevel: Task[] = [];
    const subtasks = new Map<string, Task[]>();
    for (const task of tasks) {
        if (task.parentId) {
            const list = subtasks.get(task.parentId) ?? [];
            list.push(task);
            subtasks.set(task.parentId, list);
        } else {
            topLevel.push(task);
        }
    }
    return { topLevelTasks: topLevel, subtaskMap: subtasks };
}, [tasks]);
```

- [ ] **Step 2: Import expand state from task store**

```typescript
const expandedTasks = useTaskStore((s) => s.expandedTasks);
const toggleTaskExpanded = useTaskStore((s) => s.toggleTaskExpanded);
```

Import `useTaskStore` at the top of the file.

- [ ] **Step 3: Update the task rendering in CollapsibleContent**

Replace the existing `tasks.map(...)` inside `CollapsibleContent`:

```tsx
<CollapsibleContent>
    {topLevelTasks.map((task) => {
        const subtasks = subtaskMap.get(task.id);
        const hasSubtasks = !!subtasks && subtasks.length > 0;
        const isExpanded = !!expandedTasks[task.id];

        return (
            <div key={task.id}>
                <TaskCard
                    task={task}
                    isActive={task.id === activeTaskId}
                    onClick={() => onTaskClick(task.id)}
                    archived={archived}
                    compact={compact}
                    diffStats={diffStatsByTask?.[task.id]}
                    hasSubtasks={hasSubtasks}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleTaskExpanded(task.id)}
                    isSubtask={false}
                />
                {hasSubtasks && isExpanded && (
                    <div className="ml-5 border-l border-border/60">
                        {subtasks.map((subtask) => (
                            <TaskCard
                                key={subtask.id}
                                task={subtask}
                                isActive={subtask.id === activeTaskId}
                                onClick={() => onTaskClick(subtask.id)}
                                archived={archived}
                                compact={compact}
                                diffStats={diffStatsByTask?.[subtask.id]}
                                isSubtask={true}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    })}
</CollapsibleContent>
```

**Note:** Do not build yet — Task 9 adds the new TaskCard props that this code depends on. Tasks 8 and 9 must be implemented together before building. Commit together at end of Task 9.

---

### Task 9: TaskCard — chevron, "+" button, subtask styling

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx`

- [ ] **Step 1: Update TaskCardProps interface**

Add new props:

```typescript
interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
    task: Task;
    isActive: boolean;
    onClick: () => void;
    className?: string;
    archived?: boolean;
    compact?: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    hasSubtasks?: boolean;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    isSubtask?: boolean;
}
```

- [ ] **Step 2: Destructure new props**

```typescript
export function TaskCard({
    task,
    isActive,
    onClick,
    className,
    archived,
    compact,
    diffStats,
    hasSubtasks,
    isExpanded,
    onToggleExpand,
    isSubtask,
}: TaskCardProps) {
```

- [ ] **Step 3: Add archive confirmation state and subtask count**

Add after the existing `deleteOpen` state:

```typescript
const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
const requestNewSubtask = useTaskCreationStore((s) => s.requestNewSubtask);
const subtaskCount = useTaskStore((s) =>
    isSubtask ? 0 : s.tasks.filter((t) => t.parentId === task.id).length,
);
```

Import `useTaskCreationStore` from `@/stores/task-creation-store` at the top.

- [ ] **Step 4: Add chevron button for expand/collapse**

Add the chevron import: `ChevronRight` from `lucide-react`.

In the card's main div, add the chevron before the title. Wrap the title area in a flex container:

```tsx
<div className="flex items-start gap-1">
    {hasSubtasks && (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
            }}
            className="text-muted-foreground mt-0.5 shrink-0 p-0"
            aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
        >
            <ChevronRight
                className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    isExpanded && "rotate-90",
                )}
            />
        </button>
    )}
    <div className="min-w-0 flex-1">
        <TruncatedText
            truncate={!!compact}
            tooltip={!!compact}
            tooltipSide="right"
            className={cn(
                "font-medium",
                isSubtask ? "text-xs" : "text-sm",
                isActive && "text-foreground",
            )}
        >
            {title}
        </TruncatedText>
        {!compact && description && (
            <TruncatedText className="text-muted-foreground mt-0.5 text-xs">
                {description}
            </TruncatedText>
        )}
    </div>
</div>
```

- [ ] **Step 5: Hide worktree badge for subtasks**

Update the worktree/session badges section to conditionally show worktree badge:

```tsx
{((!isSubtask && task.worktree.enabled) || task.sessions.length > 0) && (
    <div className="mt-1.5 flex min-w-0 gap-1.5">
        {!isSubtask && task.worktree.enabled && (
            // ... existing worktree badge ...
        )}
        {task.sessions.map((session) => (
            <SessionBadge key={session.id} session={session} />
        ))}
    </div>
)}
```

- [ ] **Step 6: Add "+" button for top-level tasks and update archive handler**

Import `Plus` from `lucide-react`.

Update the hover actions div. Add the "+" button before archive/delete, only for non-subtask, non-archived tasks:

```tsx
<div className="absolute right-1 bottom-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
    {!archived && !isSubtask && (
        <Button
            variant="ghost"
            size="xs"
            onClick={handleAddSubtask}
            className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground h-6 w-6 border p-0 shadow-xs"
            aria-label="Add subtask"
            tooltip="Add subtask"
            tooltipSide="top"
        >
            <Plus className="h-3.5 w-3.5" />
        </Button>
    )}
    {archived ? (
        // ... existing unarchive button ...
    ) : (
        <Button
            variant="ghost"
            size="xs"
            onClick={handleArchive}
            // ... rest unchanged ...
        >
            <Archive className="h-3.5 w-3.5" />
        </Button>
    )}
    {/* ... existing delete button ... */}
</div>
```

Add the handler:

```typescript
const handleAddSubtask = (e: MouseEvent) => {
    e.stopPropagation();
    requestNewSubtask(task.id);
};
```

- [ ] **Step 7: Update handleArchive to show confirmation when task has subtasks**

```typescript
const handleArchive = (e: MouseEvent) => {
    e.stopPropagation();
    if (subtaskCount > 0) {
        setArchiveConfirmOpen(true);
    } else {
        void archiveTask(task.id);
    }
};

const handleArchiveConfirm = useCallback(() => {
    void archiveTask(task.id);
}, [archiveTask, task.id]);
```

- [ ] **Step 8: Update delete dialog message for parent tasks with subtasks**

Update the `AlertDialogDescription` in the delete dialog:

```tsx
<AlertDialogDescription>
    {subtaskCount > 0
        ? `This will permanently delete this task and its ${subtaskCount} subtask${subtaskCount > 1 ? "s" : ""}, their sessions, and all logs. This action cannot be undone.`
        : "This will permanently delete this task, its sessions, and all logs. This action cannot be undone."}
</AlertDialogDescription>
```

Hide worktree toggle for subtasks in the delete dialog:

```tsx
{hasWorktree && !isSubtask && (
    // ... existing worktree switch ...
)}
```

- [ ] **Step 9: Add archive confirmation dialog**

Add after the existing delete `AlertDialog`:

```tsx
<AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
    <AlertDialogContent onClick={(e: MouseEvent) => e.stopPropagation()}>
        <AlertDialogHeader>
            <AlertDialogTitle>Archive task</AlertDialogTitle>
            <AlertDialogDescription>
                This task has {subtaskCount} subtask{subtaskCount > 1 ? "s" : ""} that
                will also be archived. Archive all?
            </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchiveConfirm}>
                Archive
            </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 10: Apply subtask-specific styling**

Update the card's root div to apply different padding for subtasks:

```tsx
<div
    onClick={onClick}
    className={cn(
        cardClasses,
        "group relative min-w-0 overflow-hidden [-webkit-app-region:no-drag]",
        compact && "py-1.5",
        isSubtask && "py-1.5",
    )}
>
```

- [ ] **Step 11: Build to verify**

Run: `cd packages/ui && bun run build`
Expected: No errors.

- [ ] **Step 12: Commit (together with Task 8)**

```bash
git add packages/ui/src/components/sidebar/ProjectGroup.tsx packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: sidebar subtask display — expand/collapse, indented subtasks, + button"
```

---

### Task 10: Diff stats — exclude subtasks from polling

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:87-98` (diffTargets)

- [ ] **Step 1: Filter out subtasks from diff polling targets**

Subtasks share the parent's worktree, so polling them separately would be redundant. Update the `diffTargets` memo:

```typescript
const diffTargets = useMemo(() => {
    const targets: Array<{ id: string; path: string }> = projects.map((p) => ({
        id: p.id,
        path: p.path,
    }));
    for (const task of tasks) {
        if (task.worktree.enabled && task.worktree.path && !task.parentId) {
            targets.push({ id: task.id, path: task.worktree.path });
        }
    }
    return targets;
}, [projects, tasks]);
```

- [ ] **Step 2: Build to verify**

Run: `cd packages/ui && bun run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "fix: exclude subtasks from diff stat polling (shared worktree)"
```

---

### Task 11: Final build and manual verification

- [ ] **Step 1: Full build**

Run from project root: `bun run build`
Expected: All packages build successfully.

- [ ] **Step 2: Verify type checking**

Run: `bun run typecheck` (or equivalent tsc command)
Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Expected: No new lint errors.

- [ ] **Step 4: Manual testing checklist**

Start the app and verify:
1. Create a top-level task — works as before, no regression
2. "+" button appears on hover for top-level tasks
3. Click "+" → dialog shows "New Subtask", no project/worktree fields
4. Create a subtask → parent auto-expands, subtask appears indented
5. Subtask inherits parent's worktree (check task JSON on disk)
6. Click subtask → opens full workspace
7. Collapse/expand parent task chevron works
8. Archive parent with subtasks → confirmation dialog shows → archives all
9. Unarchive parent → subtasks also restored, no dialog
10. Delete parent with subtasks → confirmation shows subtask count → deletes all
11. Delete a single subtask → no worktree toggle in dialog
12. App restart → all tasks collapsed (expand state not persisted)

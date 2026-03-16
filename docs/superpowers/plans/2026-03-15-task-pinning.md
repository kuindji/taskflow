# Task Pinning Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to pin/unpin tasks so pinned tasks float to the top of their project group in the sidebar.

**Architecture:** Add a `pinned: boolean` field to the Task type, persisted to disk. Update sort functions (backend + frontend) to order pinned tasks first. Add pin icon indicator and hover action button to TaskCard.

**Tech Stack:** TypeScript, React, Zustand, lucide-react (Pin icon), WebSocket

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/types/task.ts` | Modify | Add `pinned` field to `Task` interface |
| `packages/shared/src/types/ws.ts` | Modify | Add `pinned` to `TaskUpdatePayload` |
| `packages/backend/src/services/task-store.ts` | Modify | Default on create, update sort, normalize on read, add to updateTask type, reset on archive |
| `packages/ui/src/stores/task-store.ts` | Modify | Update sort function |
| `packages/ui/src/components/sidebar/TaskCard.tsx` | Modify | Pin indicator + pin/unpin action button |

---

## Chunk 1: Data Model & Backend

### Task 1: Add `pinned` to shared types

**Files:**
- Modify: `packages/shared/src/types/task.ts:16-27`
- Modify: `packages/shared/src/types/ws.ts:76-82`

- [ ] **Step 1: Add `pinned` to Task interface**

In `packages/shared/src/types/task.ts`, add `pinned` after `archivedAt`:

```typescript
export interface Task {
    id: string;
    projectId: string;
    title: string;
    description: string;
    notes: string;
    worktree: TaskWorktree;
    sessions: SessionRef[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
    pinned: boolean;
}
```

- [ ] **Step 2: Add `pinned` to TaskUpdatePayload**

In `packages/shared/src/types/ws.ts`, add `pinned` to `TaskUpdatePayload`:

```typescript
export interface TaskUpdatePayload {
    id: string;
    title?: string;
    description?: string;
    notes?: string;
    worktree?: TaskWorktree;
    pinned?: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/task.ts packages/shared/src/types/ws.ts
git commit -m "feat: add pinned field to Task type and TaskUpdatePayload"
```

### Task 2: Update backend task-store

**Files:**
- Modify: `packages/backend/src/services/task-store.ts:38-45` (sort function)
- Modify: `packages/backend/src/services/task-store.ts:153-154` (readTask normalization)
- Modify: `packages/backend/src/services/task-store.ts:515-526` (createTask default)
- Modify: `packages/backend/src/services/task-store.ts:564-572` (updateTask type)
- Modify: `packages/backend/src/services/task-store.ts:584-596` (archiveTask reset)

- [ ] **Step 1: Update sort function to put pinned tasks first**

Replace `compareTasksByCreatedAtDesc` (lines 38-45):

```typescript
function compareTasksByCreatedAtDesc(a: Task, b: Task): number {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) {
        return bPinned - aPinned;
    }

    const createdAtDiff = getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
    if (createdAtDiff !== 0) {
        return createdAtDiff;
    }

    return a.id.localeCompare(b.id);
}
```

- [ ] **Step 2: Normalize `pinned` when reading tasks from disk**

In the `readTask` method, after `JSON.parse(data) as Task` (line 154), normalize the field to handle old task files that lack `pinned`. Note: `readTasksFromDir` delegates to `readTask`, so this single normalization point covers all read paths.

```typescript
// Replace:
return JSON.parse(data) as Task;

// With:
const task = JSON.parse(data) as Task;
return { ...task, pinned: task.pinned ?? false };
```

- [ ] **Step 3: Set `pinned: false` in createTask**

In `createTask` (line 515-526), add `pinned: false` to the task object:

```typescript
const task: Task = {
    id: randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    notes: "",
    worktree: input.worktree ?? { enabled: false, path: null, branch: null },
    sessions: [],
    createdAt: new Date().toISOString(),
    status: "active",
    archivedAt: null,
    pinned: false,
};
```

- [ ] **Step 4: Add `pinned` to updateTask type signature**

Update `updateTask` (lines 564-572) to include `"pinned"` in the Pick union:

```typescript
async updateTask(
    id: string,
    updates:
        | Partial<Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions" | "pinned">>
        | ((
              task: Task,
          ) => Partial<
              Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions" | "pinned">
          >),
): Promise<Task> {
```

- [ ] **Step 5: Reset `pinned` to `false` in archiveTask**

In `archiveTask` (lines 588-592), add `pinned: false`:

```typescript
const archived: Task = {
    ...task,
    status: "archived",
    archivedAt: new Date().toISOString(),
    pinned: false,
};
```

- [ ] **Step 6: Note on `unarchiveTask`**

No code change needed for `unarchiveTask`. Since `archiveTask` resets `pinned` to `false` (Step 5), the spread in `unarchiveTask` carries `pinned: false` into the restored task automatically.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd packages/backend && bun run build 2>&1 | head -20`
Expected: No type errors related to `pinned`

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/task-store.ts
git commit -m "feat: backend support for task pinning"
```

### Task 3: Update frontend sort function

**Files:**
- Modify: `packages/ui/src/stores/task-store.ts:37-47`

- [ ] **Step 1: Update sort to put pinned tasks first**

Replace `sortTasksByCreatedAtDesc` (lines 37-47):

```typescript
function sortTasksByCreatedAtDesc(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const aPinned = a.pinned ? 1 : 0;
        const bPinned = b.pinned ? 1 : 0;
        if (aPinned !== bPinned) {
            return bPinned - aPinned;
        }

        const createdAtDiff =
            getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
        if (createdAtDiff !== 0) {
            return createdAtDiff;
        }

        return a.id.localeCompare(b.id);
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/task-store.ts
git commit -m "feat: frontend sort pinned tasks first"
```

---

## Chunk 2: UI — TaskCard Pin Icon & Button

### Task 4: Add pin indicator and action button to TaskCard

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx`

- [ ] **Step 1: Add Pin import**

Add `Pin` to the lucide-react import (line 3):

```typescript
import { Archive, ArchiveRestore, GitBranch, Pin, Trash2 } from "lucide-react";
```

- [ ] **Step 2: Add updateTask store selector**

After the existing store selectors (line 61), add:

```typescript
const updateTask = useTaskStore((s) => s.updateTask);
```

- [ ] **Step 3: Add pin toggle handler**

After `handleDeleteClick` (lines 87-91), add:

```typescript
const handlePinToggle = (e: MouseEvent) => {
    e.stopPropagation();
    void updateTask(task.id, { pinned: !task.pinned });
};
```

- [ ] **Step 4: Add subtle pin indicator before title**

In the `TruncatedText` for the title (lines 107-114), add a Pin icon before the title text when pinned:

```typescript
<TruncatedText
    truncate={!!compact}
    tooltip={!!compact}
    tooltipSide="right"
    className={cn("text-sm font-medium", isActive && "text-foreground")}
>
    {task.pinned && (
        <Pin className="text-muted-foreground mr-1 inline h-3 w-3 shrink-0" />
    )}
    {title}
</TruncatedText>
```

- [ ] **Step 5: Add pin/unpin button to hover actions**

In the hover action buttons div (line 152), add the pin button before the archive/delete buttons. Only show for non-archived tasks:

```typescript
<div className="absolute right-1 bottom-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
    {!archived && (
        <Button
            variant="ghost"
            size="xs"
            onClick={handlePinToggle}
            className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground h-6 w-6 border p-0 shadow-xs"
            aria-label={task.pinned ? "Unpin task" : "Pin task"}
            tooltip={task.pinned ? "Unpin task" : "Pin task"}
            tooltipSide="top"
        >
            <Pin className={cn("h-3.5 w-3.5", task.pinned && "fill-current")} />
        </Button>
    )}
    {archived ? (
```

The filled pin icon (`fill-current`) distinguishes the unpin action from the pin action visually.

- [ ] **Step 6: Verify UI compiles**

Run: `cd packages/ui && bun run build 2>&1 | head -20`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: add pin indicator and toggle button to TaskCard"
```

### Task 5: Manual verification

- [ ] **Step 1: Start the app and verify**

1. Open the app
2. Hover a task — pin button should appear alongside archive/delete
3. Click pin — task should move to top of its project group
4. Pinned task should show a subtle pin icon before its title
5. Hover the pinned task — pin button should show filled icon
6. Click pin again — task should unpin and return to chronological position
7. Archive a pinned task — verify it appears unpinned in archive view
8. Unarchive it — verify it comes back unpinned

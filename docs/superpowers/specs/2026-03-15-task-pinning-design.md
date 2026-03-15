# Task Pinning Design

## Overview

Allow users to pin and unpin tasks in the sidebar task list. Pinned tasks float to the top of their project group, making important tasks easy to find.

## Data Model

Add `pinned` field to the `Task` interface:

```typescript
// packages/shared/src/types/task.ts
export interface Task {
    // ... existing fields ...
    pinned: boolean;
}
```

- Default: `false` for new tasks
- Persisted to disk as part of the task JSON file
- Included in `TaskUpdatePayload` for toggling via WebSocket

## WebSocket API

No new messages. Reuse existing `TASK_UPDATE`:

```typescript
// packages/shared/src/types/ws.ts
export interface TaskUpdatePayload {
    id: string;
    title?: string;
    description?: string;
    notes?: string;
    worktree?: TaskWorktree;
    pinned?: boolean; // NEW
}
```

## Sorting

Update the compare function in both backend and frontend. Pinned tasks sort before unpinned, then by `createdAt` descending within each sub-group:

```
[ pinned tasks (newest first) ] → [ unpinned tasks (newest first) ]
```

Updated comparator logic:

```typescript
function compareTasks(a: Task, b: Task): number {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned; // pinned first

    const createdAtDiff = getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
    if (createdAtDiff !== 0) return createdAtDiff;

    return a.id.localeCompare(b.id);
}
```

Both `packages/backend/src/services/task-store.ts` (`compareTasksByCreatedAtDesc`) and `packages/ui/src/stores/task-store.ts` (`sortTasksByCreatedAtDesc`) need this change.

**Archive list**: The sort function applies to archived tasks too, but since `archiveTask()` resets `pinned` to `false` (see Edge Cases below), this has no practical effect.

## UI Changes

### TaskCard

Two visual elements:

1. **Pin indicator** (always visible on pinned tasks): A small, subtle pin icon displayed before the task title. Uses muted foreground color to stay unobtrusive.

2. **Pin/Unpin action button** (hover-reveal): Added to the existing hover action buttons area alongside archive and delete. For pinned tasks, this is an "unpin" action; for unpinned tasks, it's a "pin" action.

**Archive view**: The pin/unpin button is hidden for archived tasks. Pinning is an active-task organizational tool.

### Interaction

- Click the hover-reveal pin button to toggle the `pinned` state
- Calls `updateTask({ id, pinned: !task.pinned })` through the existing Zustand store
- Task immediately re-sorts to its new position in the list

## Backend

### task-store.ts

- `createTask()`: Set `pinned: false` as default
- `updateTask()`: Add `"pinned"` to the `Partial<Pick<Task, ...>>` type on the updates parameter
- Sort function: Pinned tasks sort before unpinned (updated comparator above)

### handlers/task.ts

No changes needed — the handler spreads `TaskUpdatePayload` into `store.updateTask()`, which will accept `pinned` once the type is updated.

### Migration

Existing task JSON files on disk won't have a `pinned` field. Normalize after parsing in the task-reading code path:

```typescript
// After JSON.parse in readTask / readTasksFromDir
return { ...parsed, pinned: parsed.pinned ?? false };
```

This follows the existing pattern used for `sessions` normalization in `listProjects()`.

## Edge Cases

### Archiving a pinned task
`archiveTask()` resets `pinned` to `false`. Pins are an "active work" organizational tool; carrying pin state into the archive has no purpose.

### Unarchiving a task
`unarchiveTask()` restores the task with `pinned: false` (since it was reset on archive). The task appears in its normal chronological position.

## Files to Modify

1. `packages/shared/src/types/task.ts` — Add `pinned: boolean` to `Task`
2. `packages/shared/src/types/ws.ts` — Add `pinned?: boolean` to `TaskUpdatePayload`
3. `packages/backend/src/services/task-store.ts` — Default `pinned: false` on create, add `pinned` to `updateTask` type, update sort function, normalize on read
4. `packages/ui/src/stores/task-store.ts` — Update sort function
5. `packages/ui/src/components/sidebar/TaskCard.tsx` — Add pin indicator icon and pin/unpin action button

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

Update the compare function in both backend and frontend to sort pinned tasks first, then by `createdAt` descending within each group:

```
[ pinned tasks (newest first) ] → [ unpinned tasks (newest first) ]
```

Both `packages/backend/src/services/task-store.ts` and `packages/ui/src/stores/task-store.ts` have identical sort functions (`compareTasksByCreatedAtDesc` / `sortTasksByCreatedAtDesc`) that need this change.

## UI Changes

### TaskCard

Two visual elements:

1. **Pin indicator** (always visible on pinned tasks): A small, subtle pin icon displayed before the task title. Uses muted foreground color to stay unobtrusive.

2. **Pin/Unpin action button** (hover-reveal): Added to the existing hover action buttons area alongside archive and delete. For pinned tasks, this is an "unpin" action; for unpinned tasks, it's a "pin" action.

### Interaction

- Click the hover-reveal pin button to toggle the `pinned` state
- Calls `updateTask({ id, pinned: !task.pinned })` through the existing Zustand store
- Task immediately re-sorts to its new position in the list

## Backend

### task-store.ts

- `createTask()`: Set `pinned: false` as default
- `updateTask()`: Allow `pinned` in the updates object (already handled by spread pattern)
- Sort function: Pinned tasks sort before unpinned

### Migration

Existing task JSON files on disk won't have a `pinned` field. The code should default missing `pinned` to `false` when reading tasks from disk. No explicit migration needed — just use `task.pinned ?? false` or set the default during read.

## Files to Modify

1. `packages/shared/src/types/task.ts` — Add `pinned: boolean` to `Task`
2. `packages/shared/src/types/ws.ts` — Add `pinned?: boolean` to `TaskUpdatePayload`
3. `packages/backend/src/services/task-store.ts` — Default `pinned: false` on create, update sort function, handle missing field on read
4. `packages/ui/src/stores/task-store.ts` — Update sort function
5. `packages/ui/src/components/sidebar/TaskCard.tsx` — Add pin indicator icon and pin/unpin action button

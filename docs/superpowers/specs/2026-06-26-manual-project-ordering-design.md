# Manual Project Ordering — Design

Date: 2026-06-26
Status: Approved (pre-implementation)

## Overview

Let users drag project groups in the sidebar to set a custom order. The order is
persisted as the array order in `projects.json` (no new field on `Project`). A
`taskflow-cli project move` command produces the same reordering for CLI users.

## Goals

- Drag-and-drop reordering of project groups in the sidebar.
- Persist order as array position in the existing projects JSON file.
- A CLI command to move a project to a new position.
- Cross-window sync so a reorder in one window updates the others.

## Non-goals (YAGNI)

- Per-project pinning.
- Manual task ordering.
- Alternative auto-sort modes (alphabetical, recent, etc.).

## Current state

- `Project` (`packages/shared/src/types/project.ts`) has no order/position field;
  has `createdAt`. No `pinned` for projects.
- `TaskStore` (`packages/backend/src/services/task-store.ts`) persists projects to a
  single JSON file, preserving insertion/array order. `listProjects` reads array
  order; `addProject`/`updateProject`/`removeProject` write via
  `stripEphemeralFields` + `writeFile`.
- The sidebar (`useSidebarData.ts`) filters projects to `visibleProjects`
  (drops `hidden`, and when viewing archive drops projects with no archived tasks)
  but does **not** sort — it renders backend array order.
  `TaskSidebar.tsx` (~line 291) maps `visibleProjects` to `ProjectGroup`.
- Two transport surfaces over the shared `TaskStore`:
  - WS handlers: `packages/backend/src/handlers/project.ts`, used by the UI via
    `sendRequest(MSG.*)`.
  - REST routes: `packages/backend/src/api/routes/project-routes.ts`, used by the
    compiled CLI binary (`taskflow-cli-bin.ts`).
- `@dnd-kit/core` + `@dnd-kit/sortable` already used for tabs
  (`TabBar.tsx`, `TabItem.tsx`) — the pattern to follow.

## Design

### 1. Persistence — `TaskStore` primitive

Add one method:

```ts
reorderProjects(orderedIds: string[]): Promise<Project[]>
```

Behavior:
- Read current projects.
- Build the new array: emit projects whose ids appear in `orderedIds`, in that
  order; then append any existing projects **not** listed (resilient to a project
  added concurrently); ignore unknown ids in `orderedIds`.
- Persist via the existing `stripEphemeralFields` + `writeFile` path.
- Return the new full list (with ephemeral `locationValid` re-populated as in
  `listProjects`).

This is the single backend reorder primitive. There is no separate backend "move"
operation — move semantics live in the CLI (see §4).

### 2. Transport

Shared type (`packages/shared`):

```ts
interface ProjectReorderPayload {
    orderedIds: string[];
}
```

- WS: new `MSG.PROJECT_REORDER = "project:reorder"` request handler in
  `handlers/project.ts` taking `ProjectReorderPayload`, calling
  `store.reorderProjects`, returning `{ projects }` (sessions filtered by
  instance like the list handler). After success, broadcast
  `MSG.PROJECT_REORDERED = "project:reordered"` with `{ orderedIds }`.
- REST: `PATCH /api/projects/reorder` in `project-routes.ts` taking
  `{ orderedIds }`, calling `store.reorderProjects`, broadcasting
  `PROJECT_REORDERED`, returning the new list. (Register this route before the
  `PATCH /api/projects/:id` route so `reorder` is not captured as an `:id`.)

### 3. UI — sidebar drag-and-drop

- `TaskSidebar.tsx`: wrap the `visibleProjects.map(...)` block in `DndContext`
  (PointerSensor, `activationConstraint: { distance: 5 }`, `closestCenter`) and
  `SortableContext` with `verticalListSortingStrategy`, mirroring `TabBar.tsx`.
- `ProjectGroup`: become a sortable item via `useSortable({ id: project.id })`,
  applying transform/transition and exposing a drag handle (the project header /
  drag affordance). Dragging must not conflict with the existing collapse/click
  behavior — use a distinct handle or the `distance` activation constraint.
- On drag end, compute the new **full** `orderedIds` with a slot-preserving merge
  helper:

  ```
  buildReorderedFullList(fullProjects, reorderedVisibleIds):
    - visibleIdSet = set of ids that are currently visible
    - queue = reorderedVisibleIds (the new order of just the visible subset)
    - walk fullProjects in order; for each project:
        - if its id is in visibleIdSet: take next id from queue
        - else: keep this project's id in place (hidden/filtered stays put)
    - result = list of ids
  ```

  This keeps hidden / archive-filtered projects pinned at their absolute index
  while reordering only what the user can see.
- `project-store.ts`: add `reorderProjects(orderedIds: string[])` that optimistically
  reorders the local `projects` array, then sends `MSG.PROJECT_REORDER`; on the
  returned list, reconcile to the server result. Add an
  `onEvent(MSG.PROJECT_REORDERED)` listener that reorders the local array by the
  broadcast `orderedIds` (same append-unknown rule) for cross-window sync.

### 4. CLI — `project move`

```
taskflow-cli project move <id> --to <n>        # 1-based target position
taskflow-cli project move <id> --before <id>   # place immediately before another
taskflow-cli project move <id> --after <id>    # place immediately after another
```

Implementation in `taskflow-cli-bin.ts`:
- `GET /api/projects` → current ordered ids.
- Compute the new `orderedIds` locally by moving `<id>` to the requested position
  (`--to` clamps to `[1, n]`; `--before`/`--after` position relative to the target
  id). Exactly one of the flags is required.
- `PATCH /api/projects/reorder` with `{ orderedIds }`.
- Error if `<id>` (or a `--before`/`--after` target) is unknown.
- Update `taskflow-cli-project-commands.md`.

### 5. Testing

- `reorderProjects`: normal reorder; unknown ids ignored; ids missing from
  `orderedIds` appended in their prior relative order; empty input is a no-op.
- Slot-preserving merge helper: hidden projects keep absolute position while the
  visible subset reorders; all-visible case equals a plain reorder.
- CLI move math: `--to` clamping, `--before`/`--after` relative placement, moving
  an item earlier vs. later, unknown id error.

## Files touched (anticipated)

- `packages/shared/src/types/project.ts` — `ProjectReorderPayload`.
- `packages/shared/src/constants.ts` — `PROJECT_REORDER`, `PROJECT_REORDERED`.
- `packages/backend/src/services/task-store.ts` — `reorderProjects`.
- `packages/backend/src/handlers/project.ts` — WS handler + broadcast.
- `packages/backend/src/api/routes/project-routes.ts` — REST route.
- `packages/backend/src/services/taskflow-cli-bin.ts` — `project move`.
- `packages/backend/src/services/taskflow-cli-project-commands.md` — docs.
- `packages/ui/src/stores/project-store.ts` — `reorderProjects` + event listener.
- `packages/ui/src/components/sidebar/TaskSidebar.tsx` — DnD wrapper + merge.
- `packages/ui/src/components/sidebar/ProjectGroup.tsx` — sortable item + handle.
- Tests alongside the above (store, merge helper, CLI math).

# Manual Project Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag project groups in the sidebar to set a custom order (persisted as array position in `projects.json`), with a matching `taskflow-cli project move` command and cross-window sync.

**Architecture:** A single backend reorder primitive (`TaskStore.reorderProjects(orderedIds)`) is exposed over both transport surfaces — a WS handler (`PROJECT_REORDER`, used by the UI) and a REST route (`PATCH /api/projects/reorder`, used by the CLI). Both broadcast `PROJECT_REORDERED` so other windows re-sync. Pure ordering helpers live in `@taskflow/shared` and are reused by the store, the UI, and the CLI. The sidebar reuses the existing `@dnd-kit/sortable` pattern from `TabBar.tsx`.

**Tech Stack:** Bun, TypeScript, React, Zustand, `@dnd-kit/core` + `@dnd-kit/sortable`, WebSocket + REST over a shared `TaskStore`.

## Global Constraints

- Use `bun`, never `npm`/`yarn`. Run tests with `bun test`, typecheck with `bun run typecheck`.
- No `as any`. Pursue proper types. Reuse existing types before adding new ones.
- Do not export symbols that are never consumed.
- Do not add `Co-authored-by` trailers to commits.
- Order is array position in `projects.json` — do NOT add an `order`/`position` field to `Project`.
- Canonical order = the array order returned by `TaskStore.listProjects()`; the sidebar must not re-sort it.

---

### Task 1: Shared constants, payload type, and pure ordering helpers

**Files:**
- Modify: `packages/shared/src/constants.ts` (add to the `// Projects` block, ~line 11)
- Modify: `packages/shared/src/types/ws.ts` (after `ProjectForkPayload`, ~line 65)
- Create: `packages/shared/src/utils/project-order.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Test: `packages/shared/tests/utils/project-order.test.ts`

**Interfaces:**
- Produces:
  - `MSG.PROJECT_REORDER = "project:reorder"`, `MSG.PROJECT_REORDERED = "project:reordered"`
  - `interface ProjectReorderPayload { orderedIds: string[] }`
  - `orderProjectsByIds<T extends { id: string }>(items: T[], orderedIds: string[]): T[]` — returns items whose ids appear in `orderedIds` (in that order), then all remaining items in their original relative order. Unknown ids in `orderedIds` are ignored.
  - `buildReorderedProjectIds(fullIds: string[], visibleIdsInNewOrder: string[]): string[]` — slot-preserving merge: walks `fullIds`; each id that is in the `visibleIdsInNewOrder` set is replaced, in order, by the next id from `visibleIdsInNewOrder`; all other ids keep their absolute position.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/utils/project-order.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { orderProjectsByIds, buildReorderedProjectIds } from "../../src/utils/project-order";

describe("orderProjectsByIds", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("reorders items to match orderedIds", () => {
        expect(orderProjectsByIds(items, ["c", "a", "b"]).map((i) => i.id)).toEqual([
            "c",
            "a",
            "b",
        ]);
    });

    it("appends items missing from orderedIds in original order", () => {
        expect(orderProjectsByIds(items, ["c"]).map((i) => i.id)).toEqual(["c", "a", "b"]);
    });

    it("ignores unknown ids in orderedIds", () => {
        expect(orderProjectsByIds(items, ["x", "b", "a"]).map((i) => i.id)).toEqual([
            "b",
            "a",
            "c",
        ]);
    });

    it("returns original order for empty orderedIds", () => {
        expect(orderProjectsByIds(items, []).map((i) => i.id)).toEqual(["a", "b", "c"]);
    });
});

describe("buildReorderedProjectIds", () => {
    it("reorders only visible ids, pinning others to their slots", () => {
        // full: a(hidden) b(vis) c(vis) d(hidden) e(vis); visible reordered to e,b,c
        const result = buildReorderedProjectIds(["a", "b", "c", "d", "e"], ["e", "b", "c"]);
        expect(result).toEqual(["a", "e", "b", "d", "c"]);
    });

    it("equals a plain reorder when all ids are visible", () => {
        expect(buildReorderedProjectIds(["a", "b", "c"], ["c", "a", "b"])).toEqual([
            "c",
            "a",
            "b",
        ]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/tests/utils/project-order.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/project-order`.

- [ ] **Step 3: Create the helper module**

Create `packages/shared/src/utils/project-order.ts`:

```typescript
/**
 * Reorder `items` so their order matches `orderedIds`. Items whose id appears
 * in `orderedIds` come first (in that order); any remaining items are appended
 * in their original relative order. Unknown ids in `orderedIds` are ignored.
 */
export function orderProjectsByIds<T extends { id: string }>(
    items: T[],
    orderedIds: string[],
): T[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const result: T[] = [];
    const used = new Set<string>();
    for (const id of orderedIds) {
        const item = byId.get(id);
        if (item && !used.has(id)) {
            result.push(item);
            used.add(id);
        }
    }
    for (const item of items) {
        if (!used.has(item.id)) {
            result.push(item);
        }
    }
    return result;
}

/**
 * Build a full id ordering from a reordering of only the visible subset.
 * Walks `fullIds`; positions holding a visible id are filled, in order, by
 * `visibleIdsInNewOrder`, while every other id keeps its absolute position.
 */
export function buildReorderedProjectIds(
    fullIds: string[],
    visibleIdsInNewOrder: string[],
): string[] {
    const visibleSet = new Set(visibleIdsInNewOrder);
    const queue = [...visibleIdsInNewOrder];
    return fullIds.map((id) => (visibleSet.has(id) ? (queue.shift() ?? id) : id));
}
```

- [ ] **Step 4: Add constants, payload type, and the index export**

In `packages/shared/src/constants.ts`, inside the `// Projects` block (after `PROJECT_UPDATED: "project:updated",`):

```typescript
    PROJECT_REORDER: "project:reorder",
    PROJECT_REORDERED: "project:reordered",
```

In `packages/shared/src/types/ws.ts`, after the `ProjectForkPayload` interface:

```typescript
export interface ProjectReorderPayload {
    orderedIds: string[];
}
```

In `packages/shared/src/index.ts`, add alongside the other exports:

```typescript
export * from "./utils/project-order";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/shared/tests/utils/project-order.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts packages/shared/src/utils/project-order.ts packages/shared/src/index.ts packages/shared/tests/utils/project-order.test.ts
git commit -m "feat(shared): add project reorder constants, payload, and ordering helpers"
```

---

### Task 2: `TaskStore.reorderProjects`

**Files:**
- Modify: `packages/backend/src/services/task-store.ts` (add method in the `// --- Projects ---` section, after `removeProject`, ~line 373)
- Test: `packages/backend/tests/services/task-store.test.ts` (create)

**Interfaces:**
- Consumes: `orderProjectsByIds` from `@taskflow/shared`; existing private `stripEphemeralFields`, `config.projectsFile`, `listProjects`.
- Produces: `TaskStore.reorderProjects(orderedIds: string[]): Promise<Project[]>` — persists the reordered array and returns the new full list (with `locationValid` populated, like `listProjects`).

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/task-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("TaskStore.reorderProjects", () => {
    let store: TaskStore;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-test-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    async function addProject(name: string): Promise<string> {
        const dir = join(tempDir, name);
        await mkdir(dir, { recursive: true });
        const project = await store.addProject({ name, path: dir });
        return project.id;
    }

    it("persists the requested order", async () => {
        const a = await addProject("a");
        const b = await addProject("b");
        const c = await addProject("c");

        await store.reorderProjects([c, a, b]);

        const ids = (await store.listProjects()).map((p) => p.id);
        expect(ids).toEqual([c, a, b]);
    });

    it("appends projects missing from orderedIds", async () => {
        const a = await addProject("a");
        const b = await addProject("b");
        const c = await addProject("c");

        await store.reorderProjects([c]);

        const ids = (await store.listProjects()).map((p) => p.id);
        expect(ids).toEqual([c, a, b]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/services/task-store.test.ts`
Expected: FAIL — `store.reorderProjects is not a function`.

- [ ] **Step 3: Implement `reorderProjects`**

In `packages/backend/src/services/task-store.ts`, add the import to the existing `@taskflow/shared` import group near the top (find the line importing types from `@taskflow/shared` and add a value import; if the file only imports types, add a separate `import { orderProjectsByIds } from "@taskflow/shared";`):

```typescript
import { orderProjectsByIds } from "@taskflow/shared";
```

Add the method right after `removeProject` (before `// --- Tasks ---`):

```typescript
    async reorderProjects(orderedIds: string[]): Promise<Project[]> {
        const projects = await this.listProjects();
        const reordered = orderProjectsByIds(projects, orderedIds);
        await writeFile(
            this.config.projectsFile,
            JSON.stringify(this.stripEphemeralFields(reordered), null, 2),
        );
        return reordered;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/backend/tests/services/task-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
git commit -m "feat(backend): add TaskStore.reorderProjects"
```

---

### Task 3: WS `PROJECT_REORDER` handler + cross-window broadcast

**Files:**
- Modify: `packages/backend/src/handlers/project.ts` (signature + new handler)
- Modify: `packages/backend/src/index.ts:247-255` (pass `broadcast` to `registerProjectHandlers`)
- Test: `packages/backend/tests/handlers/project.test.ts` (add cases)

**Interfaces:**
- Consumes: `store.reorderProjects`, `ProjectReorderPayload`, `filterProjectSessions`, `MSG.PROJECT_REORDER`, `MSG.PROJECT_REORDERED`.
- Produces: WS request `PROJECT_REORDER` returning `{ projects: Project[] }` (sessions filtered by instance); broadcasts `{ type: PROJECT_REORDERED, payload: { orderedIds } }`.
- Signature change: `registerProjectHandlers(router, store, gitService, closeSession?, changeTracker?, broadcast?)`.

- [ ] **Step 1: Write the failing test**

In `packages/backend/tests/handlers/project.test.ts`, capture broadcasts by passing a stub. Change the `beforeEach` registration line and add a `broadcasts` array:

```typescript
    let broadcasts: Array<{ type: string; payload: unknown }>;
```

In `beforeEach`, after `router = new Router();`:

```typescript
        broadcasts = [];
        registerProjectHandlers(router, store, new GitService(), undefined, undefined, (event) =>
            broadcasts.push(event),
        );
```

(Remove the old `registerProjectHandlers(router, store, new GitService());` line.)

Add these tests inside the `describe` block:

```typescript
    it("reorders projects and broadcasts the new order", async () => {
        const dirA = await createProjectDir("a");
        const dirB = await createProjectDir("b");
        const a = (await router.handle(MSG.PROJECT_ADD, { name: "a", path: dirA })) as {
            id: string;
        };
        const b = (await router.handle(MSG.PROJECT_ADD, { name: "b", path: dirB })) as {
            id: string;
        };

        const result = (await router.handle(MSG.PROJECT_REORDER, {
            orderedIds: [b.id, a.id],
        })) as { projects: Array<{ id: string }> };

        expect(result.projects.map((p) => p.id)).toEqual([b.id, a.id]);
        expect(broadcasts).toContainEqual({
            type: MSG.PROJECT_REORDERED,
            payload: { orderedIds: [b.id, a.id] },
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/handlers/project.test.ts`
Expected: FAIL — `registerProjectHandlers` has no 6th param / `PROJECT_REORDER` unhandled.

- [ ] **Step 3: Update the handler signature and add the handler**

In `packages/backend/src/handlers/project.ts`, add `ProjectReorderPayload` to the type import from `@taskflow/shared`, add `WsEvent` to the type import, and extend the function signature:

```typescript
export function registerProjectHandlers(
    router: Router,
    store: TaskStore,
    gitService: GitService,
    closeSession?: (sessionId: string) => void,
    changeTracker?: ChangeTracker,
    broadcast?: (event: WsEvent) => void,
): void {
```

Add this handler inside the function (e.g. after the `PROJECT_UPDATE` handler):

```typescript
    router.register(MSG.PROJECT_REORDER, async (payload) => {
        const { orderedIds } = payload as ProjectReorderPayload;
        const projects = await store.reorderProjects(orderedIds);
        broadcast?.({ type: MSG.PROJECT_REORDERED, payload: { orderedIds } });
        return { projects: projects.map((p) => filterProjectSessions(p, config.instanceId)) };
    });
```

- [ ] **Step 4: Wire `broadcast` at the call site**

In `packages/backend/src/index.ts`, update the `registerProjectHandlers(...)` call (lines ~247-255) to pass `server.broadcast` as the final argument:

```typescript
        registerProjectHandlers(
            router,
            store,
            gitService,
            (sessionId) => {
                ptyManager.close(sessionId);
            },
            changeTracker,
            server.broadcast,
        );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/backend/tests/handlers/project.test.ts`
Expected: PASS (existing cases + the new reorder case).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handlers/project.ts packages/backend/src/index.ts packages/backend/tests/handlers/project.test.ts
git commit -m "feat(backend): add PROJECT_REORDER ws handler with broadcast"
```

---

### Task 4: REST `PATCH /api/projects/reorder` route

**Files:**
- Modify: `packages/backend/src/api/routes/project-routes.ts` (register the `reorder` route BEFORE `PATCH /api/projects/:id`, ~line 114)
- Test: `packages/backend/tests/api/routes.test.ts` (add a case following the existing project-route patterns there)

**Interfaces:**
- Consumes: `taskStore.reorderProjects`, `broadcast`, `MSG.PROJECT_REORDERED`, `filterProjectSessions`, `jsonResponse`, `errorResponse`.
- Produces: `PATCH /api/projects/reorder` with body `{ orderedIds: string[] }` → `200` `{ projects: Project[] }`; broadcasts `PROJECT_REORDERED`.

- [ ] **Step 1: Write the failing test**

Open `packages/backend/tests/api/routes.test.ts`, locate the existing project-route tests to mirror their setup (how `apiRouter.handle`/requests and project creation are done there), and add:

```typescript
    it("PATCH /api/projects/reorder reorders projects", async () => {
        const a = await addProjectViaApi("a"); // use the file's existing helper/pattern
        const b = await addProjectViaApi("b");

        const res = await handlePatch("/api/projects/reorder", { orderedIds: [b, a] });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { projects: Array<{ id: string }> };
        expect(body.projects.map((p) => p.id)).toEqual([b, a]);
    });
```

> Note for the implementer: match the helper names and request style already used in this test file (e.g. how it builds a `Request`, how it adds a project, and how it asserts). Do not invent new harness helpers if the file already has them.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/api/routes.test.ts`
Expected: FAIL — route returns 404/405 (no `reorder` route; or it is captured by `:id` and 404s as "Project not found").

- [ ] **Step 3: Register the route before `:id`**

In `packages/backend/src/api/routes/project-routes.ts`, add this **above** the `apiRouter.register("PATCH", "/api/projects/:id", ...)` registration so `reorder` is not matched as an `:id`:

```typescript
    apiRouter.register("PATCH", "/api/projects/reorder", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        if (
            !Array.isArray(body.orderedIds) ||
            !body.orderedIds.every((id) => typeof id === "string")
        ) {
            return errorResponse("orderedIds must be an array of strings", 400);
        }
        const orderedIds = body.orderedIds as string[];
        try {
            const projects = await taskStore.reorderProjects(orderedIds);
            broadcast({ type: MSG.PROJECT_REORDERED, payload: { orderedIds } });
            return jsonResponse({
                projects: projects.map((p) => filterProjectSessions(p, config.instanceId)),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[api] PATCH /api/projects/reorder failed:", err);
            return errorResponse(message, 500);
        }
    });
```

> If `ApiRouter` matches routes by registration order, placing this first is sufficient. If it matches by specificity, this still works because the path is literal. Verify the existing router behavior in `packages/backend/src/api/router.ts` while implementing; if `:id` would still shadow it, the literal route must be registered first (it is).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/backend/tests/api/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/api/routes/project-routes.ts packages/backend/tests/api/routes.test.ts
git commit -m "feat(backend): add PATCH /api/projects/reorder route"
```

---

### Task 5: UI — project-store reorder + sidebar drag-and-drop

**Files:**
- Modify: `packages/ui/src/stores/project-store.ts` (add `reorderProjects` + `PROJECT_REORDERED` listener)
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx` (wrap project list in DnD; compute full order on drag end)
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx` (make the group a sortable item with a drag handle)

**Interfaces:**
- Consumes: `buildReorderedProjectIds`, `orderProjectsByIds` from `@taskflow/shared`; `MSG.PROJECT_REORDER`, `MSG.PROJECT_REORDERED`; `sendRequest`, `onEvent`; `@dnd-kit/core`, `@dnd-kit/sortable`.
- Produces: `useProjectStore().reorderProjects(orderedIds: string[]): Promise<void>`.

- [ ] **Step 1: Add `reorderProjects` to the store interface and implementation**

In `packages/ui/src/stores/project-store.ts`:

Add to the `ProjectStore` interface:

```typescript
    reorderProjects(orderedIds: string[]): Promise<void>;
```

Add the import at the top (extend the existing `@taskflow/shared` import or add a value import):

```typescript
import { orderProjectsByIds } from "@taskflow/shared";
```

Add the action inside `create<ProjectStore>(...)` (e.g. after `forkProject`):

```typescript
    async reorderProjects(orderedIds) {
        // Optimistic local reorder, then confirm with the server.
        set((s) => ({ projects: orderProjectsByIds(s.projects, orderedIds) }));
        const { projects } = await sendRequest<ProjectListResponse>(MSG.PROJECT_REORDER, {
            orderedIds,
        });
        set({ projects });
    },
```

Add a cross-window listener next to the other `onEvent` subscriptions (and add it to the `import.meta.hot.dispose` cleanup list):

```typescript
const _unsubProjectReordered = onEvent(MSG.PROJECT_REORDERED, (payload) => {
    if (payload && typeof payload === "object" && "orderedIds" in payload) {
        const { orderedIds } = payload as { orderedIds: string[] };
        const state = useProjectStore.getState();
        useProjectStore.setState({
            projects: orderProjectsByIds(state.projects, orderedIds),
        });
    }
});
```

In the `import.meta.hot` block, add:

```typescript
        _unsubProjectReordered();
```

- [ ] **Step 2: Typecheck the store change**

Run: `bun run --filter '@taskflow/ui' typecheck` (or `bun run typecheck`)
Expected: PASS (no type errors).

- [ ] **Step 3: Make `ProjectGroup` a sortable item**

In `packages/ui/src/components/sidebar/ProjectGroup.tsx`, add the import:

```typescript
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
```

Inside the component body, add the sortable hook (use `project.id` as the id):

```typescript
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: project.id,
    });
    const sortableStyle = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
    };
```

Apply `ref={setNodeRef}` and `style={sortableStyle}` to the group's outermost wrapper element. Attach `{...attributes}` and `{...listeners}` to a dedicated drag-handle element in the project header (e.g. a small grip area), NOT the whole header — the header already handles click/collapse. Reuse the existing `distance: 5` activation constraint (Task 5 Step 5) so a click still toggles the group and only a deliberate drag reorders. If there is no obvious place for a grip, attach the drag listeners to the project name label while keeping `onProjectClick` on click (the `distance` constraint disambiguates click vs. drag).

- [ ] **Step 4: Wrap the project list with DnD in `TaskSidebar.tsx`**

Add imports:

```typescript
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { buildReorderedProjectIds } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
```

In the component, set up sensors, the visible id list, and the drag-end handler (place near other hooks):

```typescript
    const reorderProjects = useProjectStore((s) => s.reorderProjects);
    const allProjects = useProjectStore((s) => s.projects);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    );
    const visibleProjectIds = useMemo(
        () => visibleProjects.map((p) => p.id),
        [visibleProjects],
    );

    const handleProjectDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const oldIndex = visibleProjectIds.indexOf(String(active.id));
            const newIndex = visibleProjectIds.indexOf(String(over.id));
            if (oldIndex === -1 || newIndex === -1) return;
            const reorderedVisible = arrayMove(visibleProjectIds, oldIndex, newIndex);
            const fullIds = allProjects.map((p) => p.id);
            void reorderProjects(buildReorderedProjectIds(fullIds, reorderedVisible));
        },
        [visibleProjectIds, allProjects, reorderProjects],
    );
```

Add `arrayMove` to the `@dnd-kit/sortable` import and ensure `useMemo`/`useCallback` are imported from `react`.

Wrap the existing `visibleProjects.map((project, index) => { ... })` block (around line 291) so it renders inside:

```tsx
<DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    onDragEnd={handleProjectDragEnd}>
    <SortableContext items={visibleProjectIds} strategy={verticalListSortingStrategy}>
        {visibleProjects.map((project, index) => {
            /* ...existing ProjectGroup rendering unchanged... */
        })}
    </SortableContext>
</DndContext>
```

> Do not change the `visibleProjects` filtering or add any sort — order comes from the backend array. The archive view is also draggable; that is acceptable and reorders the same underlying array.

- [ ] **Step 5: Typecheck and build the UI**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run build:ui`
Expected: builds without errors.

- [ ] **Step 6: Manual verification**

Start the app (`bun run dev:electron` or the project's run flow). In the sidebar:
1. Drag a project group above/below another → order changes and persists after reload.
2. A single click on the project header still selects/collapses it (no accidental reorder).
3. Hide a project (`taskflow-cli project update <id> --hidden`), reorder visible ones, unhide → the previously hidden project keeps its relative slot.
Confirm each behaves as described before committing.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/project-store.ts packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx
git commit -m "feat(ui): drag-and-drop manual project ordering in sidebar"
```

---

### Task 6: CLI `project move` command

**Files:**
- Create: `packages/backend/src/services/project-move.ts` (pure move helper)
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts` (`handleProject` — add `move` case + usage)
- Modify: `packages/backend/src/services/taskflow-cli-project-commands.md` (docs)
- Test: `packages/backend/tests/services/project-move.test.ts` (create)

**Interfaces:**
- Produces: `computeMovedOrder(orderedIds: string[], id: string, target: { to?: number; before?: string; after?: string }): string[]` — returns a new ordering with `id` moved. `to` is 1-based and clamped to `[1, n]`. Exactly one of `to`/`before`/`after` is honored (precedence: `to`, then `before`, then `after`). Throws `Error` if `id` (or a `before`/`after` target) is not present.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/project-move.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { computeMovedOrder } from "../../src/services/project-move";

describe("computeMovedOrder", () => {
    const ids = ["a", "b", "c", "d"];

    it("moves to a 1-based position (later)", () => {
        expect(computeMovedOrder(ids, "a", { to: 3 })).toEqual(["b", "c", "a", "d"]);
    });

    it("moves to a 1-based position (earlier)", () => {
        expect(computeMovedOrder(ids, "d", { to: 1 })).toEqual(["d", "a", "b", "c"]);
    });

    it("clamps to out-of-range positions", () => {
        expect(computeMovedOrder(ids, "a", { to: 99 })).toEqual(["b", "c", "d", "a"]);
        expect(computeMovedOrder(ids, "c", { to: 0 })).toEqual(["c", "a", "b", "d"]);
    });

    it("moves before a target id", () => {
        expect(computeMovedOrder(ids, "d", { before: "b" })).toEqual(["a", "d", "b", "c"]);
    });

    it("moves after a target id", () => {
        expect(computeMovedOrder(ids, "a", { after: "c" })).toEqual(["b", "c", "a", "d"]);
    });

    it("throws on unknown id", () => {
        expect(() => computeMovedOrder(ids, "x", { to: 1 })).toThrow();
    });

    it("throws on unknown target", () => {
        expect(() => computeMovedOrder(ids, "a", { before: "x" })).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/services/project-move.test.ts`
Expected: FAIL — cannot resolve `../../src/services/project-move`.

- [ ] **Step 3: Implement the helper**

Create `packages/backend/src/services/project-move.ts`:

```typescript
export function computeMovedOrder(
    orderedIds: string[],
    id: string,
    target: { to?: number; before?: string; after?: string },
): string[] {
    if (!orderedIds.includes(id)) {
        throw new Error(`Unknown project id: ${id}`);
    }
    const without = orderedIds.filter((x) => x !== id);

    let index: number;
    if (target.to !== undefined) {
        // 1-based, clamp into [1, without.length + 1]
        index = Math.min(Math.max(target.to, 1), without.length + 1) - 1;
    } else if (target.before !== undefined) {
        index = without.indexOf(target.before);
        if (index === -1) throw new Error(`Unknown project id: ${target.before}`);
    } else if (target.after !== undefined) {
        index = without.indexOf(target.after);
        if (index === -1) throw new Error(`Unknown project id: ${target.after}`);
        index += 1;
    } else {
        throw new Error("One of --to, --before, or --after is required");
    }

    return [...without.slice(0, index), id, ...without.slice(index)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/backend/tests/services/project-move.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the `move` subcommand into the CLI**

In `packages/backend/src/services/taskflow-cli-bin.ts`, add the import near the top:

```typescript
import { computeMovedOrder } from "./project-move";
```

Add a `move` case to the `switch (subcmd)` in `handleProject` (before `default`):

```typescript
        case "move": {
            const projId = subArgs[0] ?? "";
            if (!projId) {
                process.stderr.write(
                    "Usage: taskflow-cli project move <id> (--to <n> | --before <id> | --after <id>)\n",
                );
                process.exit(1);
            }
            const { flags } = parseFlags(subArgs.slice(1), {
                to: "string",
                before: "string",
                after: "string",
            });
            const target: { to?: number; before?: string; after?: string } = {};
            if (flags.to !== undefined) {
                const n = Number.parseInt(flags.to, 10);
                if (Number.isNaN(n)) {
                    process.stderr.write("--to must be a number\n");
                    process.exit(1);
                }
                target.to = n;
            } else if (flags.before !== undefined) {
                target.before = flags.before;
            } else if (flags.after !== undefined) {
                target.after = flags.after;
            } else {
                process.stderr.write("One of --to, --before, or --after is required\n");
                process.exit(1);
            }
            const listed = JSON.parse(await api("GET", "/api/projects")) as {
                projects: Array<{ id: string }>;
            };
            const orderedIds = listed.projects.map((p) => p.id);
            let next: string[];
            try {
                next = computeMovedOrder(orderedIds, projId, target);
            } catch (err) {
                process.stderr.write(`${err instanceof Error ? err.message : "Error"}\n`);
                process.exit(1);
            }
            process.stdout.write(
                await api("PATCH", "/api/projects/reorder", { orderedIds: next }),
            );
            break;
        }
```

Update the `default` usage line in `handleProject` to include `move`:

```typescript
            process.stderr.write(
                "Usage: taskflow-cli project <list|add|remove|update|fork|move>\n",
            );
```

- [ ] **Step 6: Update the docs**

In `packages/backend/src/services/taskflow-cli-project-commands.md`, add under the project commands list:

```
taskflow-cli project move <id> --to <n>          # Move project to 1-based position n
taskflow-cli project move <id> --before <id>     # Move project before another project
taskflow-cli project move <id> --after <id>      # Move project after another project
```

- [ ] **Step 7: Run the helper test + typecheck**

Run: `bun test packages/backend/tests/services/project-move.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/project-move.ts packages/backend/tests/services/project-move.test.ts packages/backend/src/services/taskflow-cli-bin.ts packages/backend/src/services/taskflow-cli-project-commands.md
git commit -m "feat(cli): add 'project move' command for manual ordering"
```

---

## Final verification

- [ ] Run the full suite: `bun test` — all pass.
- [ ] Typecheck everything: `bun run typecheck` — clean.
- [ ] Lint: `bun run lint` — clean (no disabled rules).
- [ ] Manual: drag-reorder in sidebar persists across reload; `taskflow-cli project move <id> --to 1` reflects in the UI live (cross-window broadcast).

## Spec coverage check

- Persistence as array position, no new `Project` field → Task 2 (`reorderProjects` writes array order; no schema change).
- WS handler + `PROJECT_REORDER`/`PROJECT_REORDERED` → Tasks 1, 3.
- REST route for CLI → Task 4.
- Drag-and-drop sidebar + hidden-project slot preservation → Tasks 1 (`buildReorderedProjectIds`), 5.
- Cross-window sync → Tasks 3, 4 (broadcast), 5 (`PROJECT_REORDERED` listener).
- CLI `project move` (`--to`/`--before`/`--after`) + docs → Task 6.
- Tests for store, merge helper, CLI math → Tasks 1, 2, 6.

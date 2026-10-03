# Section 5: Desktop drag-to-sidebar

Read first: the plan index, `handoff.md`, and the spec section "Desktop UI". Section 3 has to be done: it provides `MSG.SESSION_MOVE`. Section 4 is not needed.

Run UI tests **from the repo root**: `bun test packages/ui/src/...`. The DOM preload lives in the root `bunfig.toml`, and running them from `packages/ui` fails before any test runs.

**Design recap.**
- Tab dragging uses dnd-kit in one of two contexts: `TabBar`'s own when the workspace isn't split, `SplitContainer`'s when it is.
- The sidebar has a separate dnd-kit context, so it can't be a droppable for tab drags. Instead, while a tab is dragged, `elementFromPoint` is checked against sidebar elements marked with `data-session-drop`.
- A valid hovered target is kept in the UI store so the card can highlight.
- On drop over a target, `SESSION_MOVE` is sent and the existing reorder and pane-move logic is skipped.
- Refusals show the app's existing `alert()` dialog. The app has no toast system, which is a deliberate deviation from the spec's "toast".

### Task 8: Movable flag on tabs, and the pure drop resolver

**Files:**
- Modify: `packages/ui/src/stores/session-helpers.ts`. Add `movable` to `Tab` (lines 6-36), add `isMovableSession`, and set the flag in `createSessionTab` (line 70).
- Modify: `packages/ui/src/stores/session-sync.ts`. `syncPaneTabs` (lines 37-73) refreshes `movable`.
- Create: `packages/ui/src/lib/session-drop.ts`
- Test: `packages/ui/src/lib/session-drop.test.ts`, `packages/ui/src/stores/session-sync.test.ts`

**Interfaces:**
- Produces:
  - `Tab.movable?: true`. Present only on agent session tabs that are neither flow nor remote-agent sessions.
  - `isMovableSession(session: SessionRef): boolean` in `session-helpers.ts`.
  - `interface SessionDropTarget { kind: "task" | "project"; id: string; backendId: string; key: string }`, where `key` is the workspace key (`task:<id>` / `project:<id>`).
  - `readSessionDropTarget(element: Element | null): SessionDropTarget | null`
  - `isValidSessionDrop(args: { tab: Tab | undefined; sourceWorkspaceKey: string; sourceBackendId: string | null; target: SessionDropTarget }): boolean`
  - `sessionMovePayload(sessionId: string, target: SessionDropTarget): SessionMovePayload`

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/lib/session-drop.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { Tab } from "@/stores/session-helpers";
import { isValidSessionDrop, readSessionDropTarget, sessionMovePayload } from "./session-drop";

function marked(value: string, backendId = "local"): HTMLElement {
    const host = document.createElement("div");
    host.dataset.sessionDrop = value;
    host.dataset.sessionDropBackend = backendId;
    const child = document.createElement("span");
    host.appendChild(child);
    return child;
}

const agentTab: Tab = { id: "s1", type: "claude", label: "Claude", sessionId: "s1", movable: true };
const taskB = { kind: "task" as const, id: "b", backendId: "local", key: "task:b" };

describe("readSessionDropTarget", () => {
    it("reads the nearest marked ancestor", () => {
        expect(readSessionDropTarget(marked("task:b"))).toEqual(taskB);
        expect(readSessionDropTarget(marked("project:p1"))).toEqual({
            kind: "project",
            id: "p1",
            backendId: "local",
            key: "project:p1",
        });
    });

    it("ignores unmarked, malformed and backend-less elements", () => {
        expect(readSessionDropTarget(null)).toBeNull();
        expect(readSessionDropTarget(document.createElement("div"))).toBeNull();
        expect(readSessionDropTarget(marked("master"))).toBeNull();
        expect(readSessionDropTarget(marked("task:"))).toBeNull();
        expect(readSessionDropTarget(marked("task:b", ""))).toBeNull();
    });
});

describe("isValidSessionDrop", () => {
    const base = {
        tab: agentTab,
        sourceWorkspaceKey: "task:a",
        sourceBackendId: "local",
        target: taskB,
    };

    it("accepts a movable tab onto another owner on the same machine", () => {
        expect(isValidSessionDrop(base)).toBe(true);
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "master" })).toBe(true);
    });

    it("rejects shells, unflagged tabs and unknown tabs", () => {
        expect(isValidSessionDrop({ ...base, tab: { ...agentTab, movable: undefined } })).toBe(
            false,
        );
        expect(
            isValidSessionDrop({ ...base, tab: { id: "x", type: "shell", label: "zsh", sessionId: "x" } }),
        ).toBe(false);
        expect(isValidSessionDrop({ ...base, tab: undefined })).toBe(false);
    });

    it("rejects the current owner, including from its right pane", () => {
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "task:b" })).toBe(false);
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "task:b:right" })).toBe(false);
    });

    it("rejects another machine or an unknown source machine", () => {
        expect(isValidSessionDrop({ ...base, target: { ...taskB, backendId: "laptop" } })).toBe(
            false,
        );
        expect(isValidSessionDrop({ ...base, sourceBackendId: null })).toBe(false);
    });
});

describe("sessionMovePayload", () => {
    it("names exactly one owner", () => {
        expect(sessionMovePayload("s1", taskB)).toEqual({ sessionId: "s1", taskId: "b" });
        expect(
            sessionMovePayload("s1", { kind: "project", id: "p", backendId: "local", key: "project:p" }),
        ).toEqual({ sessionId: "s1", projectId: "p" });
    });
});
```

Add to `packages/ui/src/stores/session-sync.test.ts` (inside `describe("syncOwnerTabs")`):

```ts
    test("marks only plain agent sessions movable and refreshes the flag", () => {
        const agent = makeSession("agent");
        const flow = { ...makeSession("flow"), flow: { flowId: "f", actionEntryId: "e" } };
        const remote = { ...makeSession("remote"), remoteControl: true };
        const shell = { ...makeSession("shell", "zsh"), type: "shell" as const };

        expect(createSessionTab(agent).movable).toBe(true);
        expect(createSessionTab(flow).movable).toBeUndefined();
        expect(createSessionTab(remote).movable).toBeUndefined();
        expect(createSessionTab(shell).movable).toBeUndefined();

        const stale = { ...createSessionTab(agent), movable: undefined };
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [agent] }],
            tabsByWorkspace: { "task:t1": [stale] },
            activeTabByWorkspace: { "task:t1": stale.id },
        });
        expect(result.tabsByWorkspace["task:t1"]?.[0]?.movable).toBe(true);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from the repo root): `bun test packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores/session-sync.test.ts`
Expected: FAIL. The module is missing and `movable` is undefined.

- [ ] **Step 3: Implement**

`session-helpers.ts`. Add to `Tab`, after `resumeAvailable?`:

```ts
    /** Agent session tab that can be dragged onto another task or project. */
    movable?: true;
```

Add `isAgentType` to the imports (`import { isAgentType } from "@taskflow/shared";`). Then:

```ts
/** Flow sessions stay with their flow run; the remote agent belongs to its service. */
function isMovableSession(session: SessionRef): boolean {
    return isAgentType(session.type) && !session.flow && !session.remoteControl;
}
```

In `createSessionTab`, add `...(isMovableSession(session) && { movable: true }),`. Export `isMovableSession` with the other helpers (`session-sync.ts` uses it).

`session-sync.ts` `syncPaneTabs`. Compute `const movable = isMovableSession(session) ? true : undefined;`, add `tab.movable === movable &&` to the unchanged check, and add `movable,` to the refreshed object. Import `isMovableSession` from `./session-helpers`.

`packages/ui/src/lib/session-drop.ts`:

```ts
import type { SessionMovePayload } from "@taskflow/shared";
import type { Tab } from "@/stores/session-helpers";
import { baseWorkspaceKey } from "@/stores/session-helpers";

/** A sidebar element a session tab can be dropped on (`data-session-drop`). */
interface SessionDropTarget {
    kind: "task" | "project";
    id: string;
    backendId: string;
    /** The target's workspace key: `task:<id>` or `project:<id>`. */
    key: string;
}

function readSessionDropTarget(element: Element | null): SessionDropTarget | null {
    const host = element?.closest<HTMLElement>("[data-session-drop]");
    const value = host?.dataset.sessionDrop ?? "";
    const backendId = host?.dataset.sessionDropBackend ?? "";
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (separator < 0 || !id || !backendId) return null;
    if (kind !== "task" && kind !== "project") return null;
    return { kind, id, backendId, key: value };
}

function isValidSessionDrop(args: {
    tab: Tab | undefined;
    sourceWorkspaceKey: string;
    sourceBackendId: string | null;
    target: SessionDropTarget;
}): boolean {
    const { tab, sourceWorkspaceKey, sourceBackendId, target } = args;
    return (
        tab?.movable === true &&
        sourceBackendId !== null &&
        target.backendId === sourceBackendId &&
        target.key !== baseWorkspaceKey(sourceWorkspaceKey)
    );
}

function sessionMovePayload(sessionId: string, target: SessionDropTarget): SessionMovePayload {
    return target.kind === "task"
        ? { sessionId, taskId: target.id }
        : { sessionId, projectId: target.id };
}

export { readSessionDropTarget, isValidSessionDrop, sessionMovePayload };
export type { SessionDropTarget };
```

`baseWorkspaceKey` already exists in `session-helpers.ts` (`session-sync.ts` imports it). Check that it strips `:right`. If it isn't exported, export it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores/session-sync.test.ts packages/ui/src/stores/session-sync.backend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/session-helpers.ts packages/ui/src/stores/session-sync.ts packages/ui/src/lib/session-drop.ts packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores/session-sync.test.ts
git commit -m "feat(ui): mark movable session tabs and resolve sidebar drop targets"
```

### Task 9: Drag hook, tab-bar wiring and sidebar targets

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`. Add `sessionDropTarget` and `setSessionDropTarget` (state interface around line 60, actions around line 109, initial state around line 140, implementation near `setMasterWorkspaceActive` around line 261).
- Create: `packages/ui/src/components/workspace/useSessionMoveDrag.ts`
- Create: `packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
- Modify: `packages/ui/src/components/workspace/SplitContainer.tsx` (handlers lines 71-158, `DndContext` lines 188-200).
- Modify: `packages/ui/src/components/workspace/TabBar.tsx` (the non-external `DndContext` branch, lines 143-166).
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx` (the `cardBody` root `div`, lines 255-274).
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx` (the `projectHeader` root `div`, lines 257-269).

**Interfaces:**
- Consumes: everything Task 8 produces; `MSG.SESSION_MOVE`; `sendRequest` from `@/lib/connection-registry`; `workspaceBackendId` from `@/hooks/useActiveWorkspace`; `alert` from `@/stores/dialog-store`.
- Produces:
  - `useUIStore` state `sessionDropTarget: SessionDropTarget | null` and action `setSessionDropTarget(target: SessionDropTarget | null)`.
  - `interface TabDragEvent { active: { id: UniqueIdentifier }; activatorEvent: Event; delta: { x: number; y: number } }`, the subset of dnd-kit's events the hook reads.
  - `useSessionMoveDrag(): { onDragMove(event: TabDragEvent): void; onDragEnd(event: TabDragEvent): boolean; onDragCancel(): void }`. `onDragEnd` returns `true` when it handled the drop, in which case the caller must skip its own logic.

- [ ] **Step 1: Write the failing hook tests**

The hook has no React state of its own, so its handlers are plain functions over the stores and the DOM. `createSessionMoveDrag` builds them, and `useSessionMoveDrag` memoises it. The test calls `createSessionMoveDrag` directly. It is exported because the test imports it.

`packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import type { TabDragEvent } from "./useSessionMoveDrag";

const sent: Array<{ backendId: string; type: string; payload: unknown }> = [];
let reject: Error | null = null;
await mock.module("@/lib/connection-registry", () => ({
    sendRequest: (backendId: string, type: string, payload: unknown) => {
        sent.push({ backendId, type, payload });
        return reject ? Promise.reject(reject) : Promise.resolve({ success: true });
    },
    getPrimary: () => "local",
    onPrimaryChange: () => () => {},
    onEvent: () => () => {},
}));
const alerts: Array<{ title: string; description: string }> = [];
await mock.module("@/stores/dialog-store", () => ({
    alert: (options: { title: string; description: string }) => {
        alerts.push(options);
        return Promise.resolve();
    },
}));

const { createSessionMoveDrag } = await import("./useSessionMoveDrag");
const { useSessionStore } = await import("@/stores/session-store");
const { useTaskStore } = await import("@/stores/task-store");
const { useUIStore } = await import("@/stores/ui-store");

function event(id: string, x: number, y: number): TabDragEvent {
    return {
        active: { id },
        activatorEvent: new MouseEvent("pointerdown", { clientX: 0, clientY: 0 }),
        delta: { x, y },
    };
}

let card: HTMLElement;

beforeEach(() => {
    sent.length = 0;
    alerts.length = 0;
    reject = null;
    card = document.createElement("div");
    card.dataset.sessionDrop = "task:b";
    card.dataset.sessionDropBackend = "local";
    document.body.appendChild(card);
    document.elementFromPoint = (x: number) => (x > 100 ? card : document.body);
    const taskA: Task & { backendId: string } = {
        id: "a",
        projectId: "p1",
        title: "A",
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "2026-10-03T00:00:00.000Z",
        status: "active",
        archivedAt: null,
        pinned: false,
        backendId: "local",
    };
    useTaskStore.setState({ tasks: [taskA] });
    useSessionStore.setState({
        tabsByWorkspace: {
            "task:a": [
                { id: "s1", type: "claude", label: "Claude", sessionId: "s1", movable: true },
                { id: "sh", type: "shell", label: "zsh", sessionId: "sh" },
            ],
        },
    });
    useUIStore.getState().setSessionDropTarget(null);
});

afterEach(() => {
    card.remove();
});

describe("session move drag", () => {
    it("highlights a valid target and moves the session on drop", async () => {
        const drag = createSessionMoveDrag();
        drag.onDragMove(event("s1", 200, 0));
        expect(useUIStore.getState().sessionDropTarget?.key).toBe("task:b");

        expect(drag.onDragEnd(event("s1", 200, 0))).toBe(true);
        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(sent).toEqual([
            { backendId: "local", type: MSG.SESSION_MOVE, payload: { sessionId: "s1", taskId: "b" } },
        ]);
    });

    it("leaves drops elsewhere to the existing handlers", () => {
        const drag = createSessionMoveDrag();
        drag.onDragMove(event("s1", 10, 0));

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(event("s1", 10, 0))).toBe(false);
        expect(sent).toEqual([]);
    });

    it("never targets the sidebar for a shell tab", () => {
        const drag = createSessionMoveDrag();
        drag.onDragMove(event("sh", 200, 0));

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(event("sh", 200, 0))).toBe(false);
    });

    it("clears the target on cancel", () => {
        const drag = createSessionMoveDrag();
        drag.onDragMove(event("s1", 200, 0));
        drag.onDragCancel();

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
    });

    it("shows the backend's refusal", async () => {
        reject = new Error("Flow sessions cannot be moved");
        const drag = createSessionMoveDrag();
        drag.onDragMove(event("s1", 200, 0));
        drag.onDragEnd(event("s1", 200, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(alerts).toEqual([
            { title: "Couldn't move session", description: "Flow sessions cannot be moved" },
        ]);
    });
});
```

`mock.module` is global and leaks across files (see memory `project_bun_test_mock_module`), so run this file on its own. The stubbed `connection-registry` exports must cover everything the imported stores use at import time. If importing a store throws "is not a function", add that export to the stub.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement the store field and the hook**

`ui-store.ts`:
- Add `import type { SessionDropTarget } from "@/lib/session-drop";`.
- Add `sessionDropTarget: SessionDropTarget | null;` to the state interface, `setSessionDropTarget(target: SessionDropTarget | null): void;` to the actions, and `sessionDropTarget: null,` to the initial state.
- Implementation:

```ts
    setSessionDropTarget(target) {
        if (get().sessionDropTarget?.key === target?.key) return;
        set({ sessionDropTarget: target });
    },
```

If the store's `create` callback doesn't take `get`, use `set((state) => (state.sessionDropTarget?.key === target?.key ? state : { sessionDropTarget: target }))`.

`useSessionMoveDrag.ts`:

```ts
import { useMemo } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { isValidSessionDrop, readSessionDropTarget, sessionMovePayload } from "@/lib/session-drop";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { alert } from "@/stores/dialog-store";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";

function findTab(tabId: string): { tab: Tab; workspaceKey: string } | null {
    for (const [workspaceKey, tabs] of Object.entries(useSessionStore.getState().tabsByWorkspace)) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (tab) return { tab, workspaceKey };
    }
    return null;
}

/** The part of dnd-kit's DragMoveEvent / DragEndEvent this hook reads. */
interface TabDragEvent {
    active: { id: UniqueIdentifier };
    activatorEvent: Event;
    delta: { x: number; y: number };
}

function pointerOf(event: TabDragEvent): { x: number; y: number } | null {
    const start = event.activatorEvent;
    if (!(start instanceof MouseEvent)) return null;
    return { x: start.clientX + event.delta.x, y: start.clientY + event.delta.y };
}

/**
 * Drag a session tab onto a sidebar task card or project row. The sidebar
 * lives in another dnd-kit context, so it is hit-tested rather than
 * registered as a droppable. Both tab contexts (TabBar unsplit,
 * SplitContainer split) call these next to their own handlers.
 */
function createSessionMoveDrag() {
    function onDragMove(event: TabDragEvent): void {
        const found = findTab(String(event.active.id));
        const pointer = pointerOf(event);
        const target = pointer
            ? readSessionDropTarget(document.elementFromPoint(pointer.x, pointer.y))
            : null;
        const valid =
            found !== null &&
            target !== null &&
            isValidSessionDrop({
                tab: found.tab,
                sourceWorkspaceKey: found.workspaceKey,
                sourceBackendId: workspaceBackendId(found.workspaceKey),
                target,
            });
        useUIStore.getState().setSessionDropTarget(valid ? target : null);
    }

    function onDragEnd(event: TabDragEvent): boolean {
        const target = useUIStore.getState().sessionDropTarget;
        useUIStore.getState().setSessionDropTarget(null);
        const found = findTab(String(event.active.id));
        if (!target || !found?.tab.sessionId) return false;
        sendRequest(
            target.backendId,
            MSG.SESSION_MOVE,
            sessionMovePayload(found.tab.sessionId, target),
        ).catch((error: unknown) => {
            void alert({
                title: "Couldn't move session",
                description: error instanceof Error ? error.message : String(error),
            });
        });
        return true;
    }

    function onDragCancel(): void {
        useUIStore.getState().setSessionDropTarget(null);
    }

    return { onDragMove, onDragEnd, onDragCancel };
}

function useSessionMoveDrag() {
    return useMemo(createSessionMoveDrag, []);
}

export { useSessionMoveDrag, createSessionMoveDrag };
export type { TabDragEvent };
```

dnd-kit's `DragMoveEvent` and `DragEndEvent` are structurally assignable to `TabDragEvent`, so the contexts pass their events straight through.

`target.backendId` equals the source backend; `isValidSessionDrop` already checked that.

- [ ] **Step 4: Run the hook tests**

Run: `bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tab contexts**

`SplitContainer.tsx`:
- Import `useSessionMoveDrag`. Add `const sessionMove = useSessionMoveDrag();` after the sensors.
- In `handleDragEnd`, right after `setDraggedTab(null);`, add `if (sessionMove.onDragEnd(event)) return;`, and add `sessionMove` to its dependency list.
- Make `handleDragCancel` call `sessionMove.onDragCancel()` as well as `setDraggedTab(null)`, with `[sessionMove]` as deps.
- Pass `onDragMove={sessionMove.onDragMove}` to the `DndContext`.

`TabBar.tsx`, the non-external branch. It needs a drag overlay so the tab stays visible outside the clipped strip, and the same three handlers:

```tsx
    const sessionMove = useSessionMoveDrag();
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            setDraggedTab(tabs.find((tab) => tab.id === String(event.active.id)) ?? null);
        },
        [tabs],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            setDraggedTab(null);
            if (sessionMove.onDragEnd(event)) return;
            const { active, over } = event;
            if (over && active.id !== over.id) {
                onTabReorder(String(active.id), String(over.id));
            }
        },
        [onTabReorder, sessionMove],
    );

    const handleDragCancel = useCallback(() => {
        setDraggedTab(null);
        sessionMove.onDragCancel();
    }, [sessionMove]);
```

Then give the non-external `DndContext` these props: `onDragStart={handleDragStart}`, `onDragMove={sessionMove.onDragMove}`, `onDragEnd={handleDragEnd}`, `onDragCancel={handleDragCancel}`. After the `SortableContext`, inside the `DndContext`, add:

```tsx
                    <DragOverlay dropAnimation={null}>
                        {draggedTab && (
                            <TabItemOverlay tab={draggedTab} isActive={draggedTab.id === activeTabId} />
                        )}
                    </DragOverlay>
```

Update the imports: `DragOverlay` and the `DragStartEvent` type from `@dnd-kit/core`; `useState` from `react`; `TabItemOverlay` from `./TabItem` (it is already exported, as `SplitContainer` imports it).

`TaskCard.tsx`. On the `cardBody` root `div` (the one with `role="button"`), add:

```tsx
            data-session-drop={`task:${task.id}`}
            data-session-drop-backend={task.backendId}
```

Then add a highlight. Above the JSX, add `const isSessionDropTarget = useUIStore((s) => s.sessionDropTarget?.key === \`task:${task.id}\`);` (import `useUIStore` if it isn't imported yet), and add `isSessionDropTarget && "ring-accent ring-2"` to the `cn(...)` list.

`ProjectGroup.tsx`. On the `projectHeader` root `div`, add `data-session-drop={\`project:${project.id}\`}` and `data-session-drop-backend={project.backendId}`. Then add the same highlight: `const isSessionDropTarget = useUIStore((s) => s.sessionDropTarget?.key === \`project:${project.id}\`);` and `isSessionDropTarget && "ring-accent ring-2"` in its `cn(...)`.

The selectors return booleans, so they are stable (memory `project_zustand_reactivity`).

- [ ] **Step 6: Run the UI tests**

```bash
bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts
bun test packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores
for f in packages/ui/src/components/sidebar/*.test.tsx packages/ui/src/components/workspace/*.test.tsx; do bun test "$f" || echo "FAILED: $f"; done
```

Expected: everything passes. Component tests run one file at a time because of `mock.module` leakage.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/ui/src/stores/ui-store.ts packages/ui/src/components/workspace/useSessionMoveDrag.ts packages/ui/src/components/workspace/useSessionMoveDrag.test.ts packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/TabBar.tsx packages/ui/src/components/sidebar/TaskCard.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx
bunx prettier --check packages/ui/src/stores/ui-store.ts packages/ui/src/components/workspace/useSessionMoveDrag.ts packages/ui/src/components/workspace/useSessionMoveDrag.test.ts packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/TabBar.tsx packages/ui/src/components/sidebar/TaskCard.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx
git add packages/ui/src/stores/ui-store.ts packages/ui/src/components/workspace packages/ui/src/components/sidebar/TaskCard.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx
git commit -m "feat(ui): drag an agent tab onto a sidebar task or project to move it"
```

Update `handoff.md`: Section 5 is done, with the commit hashes.

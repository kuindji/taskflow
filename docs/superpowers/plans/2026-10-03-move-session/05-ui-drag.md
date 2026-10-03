# Section 5: Desktop drag-to-sidebar

Read first: the plan index, `handoff.md`, and the spec sections "Desktop UI" and "Amendments". Section 3 has to be done: it provides `MSG.SESSION_MOVE`. Section 4 is not needed.

Run UI tests **from the repo root**: `bun test packages/ui/src/...`. The DOM preload lives in the root `bunfig.toml`. Do **not** use `mock.module` in new tests: it is global and leaks into other files. Inject dependencies instead.

**Design.**
- Tab dragging uses dnd-kit in one of two contexts: `TabBar`'s own when the workspace isn't split, `SplitContainer`'s when it is.
- The sidebar has a separate dnd-kit context, so it can't be a droppable for tab drags. Instead, the hook tracks the real pointer position with a capturing `pointermove` listener for the length of the drag. It hit-tests with `document.elementsFromPoint`, which returns every element under the point, so the `DragOverlay` sitting under the cursor doesn't hide the sidebar.
- dnd-kit's `delta` is not used: after the tab strip auto-scrolls, `delta` is scroll-adjusted and no longer equals the cursor's movement.
- A drop anywhere inside the sidebar (`data-session-drop-zone`) is consumed. It moves the session if it lands on a valid target, and does nothing otherwise. Only drops outside the sidebar fall through to the existing reorder and pane-move logic, because `closestCenter` always reports *some* nearest tab as `over`.
- Refusals use the app's `alert()` dialog. The app has no toast system.

### Task 8: Tab fields, master tab refresh, and the pure drop resolver

**Files:**
- Modify: `packages/ui/src/stores/session-helpers.ts`:
  - add `movable` and `cwd` to `Tab` (lines 6-36);
  - add `isMovableSession`;
  - `createSessionTab` (line 70) sets both fields.
- Modify: `packages/ui/src/stores/session-sync.ts`. Export `syncPaneTabs` (lines 37-73), and make it refresh `movable` and `cwd`.
- Modify: `packages/ui/src/stores/session-store.ts`:
  - the direct tab creation (lines 216-223) sets `movable`;
  - `syncWithMasterSessions` (lines 616-660) uses `syncPaneTabs` instead of its two hand-written refresh loops;
  - add an exported `findSessionTab`.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts`. Replace the private `findTabForSession` (line 61, used at line 237) with `findSessionTab`.
- Create: `packages/ui/src/lib/session-drop.ts`
- Test: `packages/ui/src/lib/session-drop.test.ts`, `packages/ui/src/stores/session-sync.test.ts`, `packages/ui/src/stores/session-store.master-movable.test.ts` (new).

**Interfaces:**
- Produces:
  - `Tab.movable?: true`. Present only on agent session tabs that are neither flow nor remote-agent sessions.
  - `Tab.cwd?: string`, the session's recorded working directory. Section 6 uses it.
  - `isMovableSession(session: SessionRef): boolean` (`session-helpers.ts`).
  - `syncPaneTabs(existing: Tab[], sessionsById: Map<string, SessionRef>): Tab[]`, now exported.
  - `findSessionTab(sessionId: string): { workspaceKey: string; tab: Tab } | null` (`session-store.ts`).
  - `interface SessionDropTarget { kind: "task" | "project"; id: string; backendId: string; key: string }`, where `key` is the workspace key (`task:<id>` or `project:<id>`).
  - `resolveSessionDrop(elements: Element[]): { inZone: boolean; target: SessionDropTarget | null }`. `target` comes from the first element that is, or is inside, a `[data-session-drop]`. `inZone` is true when any element is inside `[data-session-drop-zone]`.
  - `isValidSessionDrop(args: { tab: Tab | undefined; sourceWorkspaceKey: string; sourceBackendId: string | null; target: SessionDropTarget }): boolean`
  - `sessionMovePayload(sessionId: string, target: SessionDropTarget): SessionMovePayload`

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/lib/session-drop.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { Tab } from "@/stores/session-helpers";
import { isValidSessionDrop, resolveSessionDrop, sessionMovePayload } from "./session-drop";

function sidebar(): { zone: HTMLElement; card: (value: string, backendId?: string) => HTMLElement } {
    const zone = document.createElement("div");
    zone.dataset.sessionDropZone = "";
    return {
        zone,
        card(value, backendId = "local") {
            const host = document.createElement("div");
            host.dataset.sessionDrop = value;
            host.dataset.sessionDropBackend = backendId;
            const child = document.createElement("span");
            host.appendChild(child);
            zone.appendChild(host);
            return child;
        },
    };
}

const agentTab: Tab = { id: "s1", type: "claude", label: "Claude", sessionId: "s1", movable: true };
const taskB = { kind: "task" as const, id: "b", backendId: "local", key: "task:b" };

describe("resolveSessionDrop", () => {
    it("finds a card under an overlay and reports the zone", () => {
        const { card } = sidebar();
        const overlay = document.createElement("div");

        expect(resolveSessionDrop([overlay, card("task:b")])).toEqual({
            inZone: true,
            target: taskB,
        });
        expect(resolveSessionDrop([card("project:p1")]).target).toEqual({
            kind: "project",
            id: "p1",
            backendId: "local",
            key: "project:p1",
        });
    });

    it("reports a sidebar gap as in the zone without a target", () => {
        const { zone } = sidebar();
        expect(resolveSessionDrop([zone])).toEqual({ inZone: true, target: null });
    });

    it("ignores the workspace and malformed markers", () => {
        const { card } = sidebar();
        expect(resolveSessionDrop([document.createElement("div")])).toEqual({
            inZone: false,
            target: null,
        });
        expect(resolveSessionDrop([card("master")]).target).toBeNull();
        expect(resolveSessionDrop([card("task:")]).target).toBeNull();
        expect(resolveSessionDrop([card("task:b", "")]).target).toBeNull();
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
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "master:right" })).toBe(true);
    });

    it("rejects shells, unflagged tabs and unknown tabs", () => {
        expect(isValidSessionDrop({ ...base, tab: { ...agentTab, movable: undefined } })).toBe(
            false,
        );
        expect(
            isValidSessionDrop({
                ...base,
                tab: { id: "x", type: "shell", label: "zsh", sessionId: "x" },
            }),
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
            sessionMovePayload("s1", {
                kind: "project",
                id: "p",
                backendId: "local",
                key: "project:p",
            }),
        ).toEqual({ sessionId: "s1", projectId: "p" });
    });
});
```

Add to `packages/ui/src/stores/session-sync.test.ts` (inside `describe("syncOwnerTabs")`):

```ts
    test("marks only plain agent sessions movable and refreshes movable and cwd", () => {
        const agent = { ...makeSession("agent"), cwd: "/repo/a" };
        const flow = { ...makeSession("flow"), flow: { flowId: "f", actionEntryId: "e" } };
        const remote = { ...makeSession("remote"), remoteControl: true };
        const shell = { ...makeSession("shell", "zsh"), type: "shell" as const };

        expect(createSessionTab(agent)).toMatchObject({ movable: true, cwd: "/repo/a" });
        expect(createSessionTab(flow).movable).toBeUndefined();
        expect(createSessionTab(remote).movable).toBeUndefined();
        expect(createSessionTab(shell).movable).toBeUndefined();

        const stale: Tab = { id: "agent", type: "claude", label: "Claude", sessionId: "agent" };
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [agent] }],
            tabsByWorkspace: { "task:t1": [stale] },
            activeTabByWorkspace: { "task:t1": stale.id },
        });
        expect(result.tabsByWorkspace["task:t1"]?.[0]).toMatchObject({
            movable: true,
            cwd: "/repo/a",
        });
    });
```

Import `type Tab` from `./session-helpers` there if it isn't imported yet.

`packages/ui/src/stores/session-store.master-movable.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { useSessionStore } from "./session-store";

describe("master workspace tabs", () => {
    it("refresh movable and cwd in both panes", () => {
        const session: SessionRef = {
            id: "m1",
            type: "claude",
            label: "Claude",
            createdAt: "2026-10-03T00:00:00.000Z",
            instance: "main",
            cwd: "/home/me",
        };
        useSessionStore.setState({
            tabsByWorkspace: {
                "master:right": [{ id: "m1", type: "claude", label: "Claude", sessionId: "m1" }],
            },
            activeTabByWorkspace: { "master:right": "m1" },
        });

        useSessionStore.getState().syncWithMasterSessions("local", [session]);

        expect(useSessionStore.getState().tabsByWorkspace["master:right"]?.[0]).toMatchObject({
            movable: true,
            cwd: "/home/me",
        });
        expect(useSessionStore.getState().tabsByWorkspace.master).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from the repo root): `bun test packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores/session-sync.test.ts packages/ui/src/stores/session-store.master-movable.test.ts`
Expected: FAIL. The module is missing and the fields are undefined.

- [ ] **Step 3: Implement**

`session-helpers.ts`. Add to `Tab`, after `resumeAvailable?`:

```ts
    /** Agent session tab that can be dragged onto another task or project. */
    movable?: true;
    /** The session's recorded working directory; it does not change when the session moves. */
    cwd?: string;
```

Add `import { isAgentType } from "@taskflow/shared";` and:

```ts
/** Flow sessions stay with their flow run; the remote agent belongs to its service. */
function isMovableSession(session: SessionRef): boolean {
    return isAgentType(session.type) && !session.flow && !session.remoteControl;
}
```

In `createSessionTab`, add:

```ts
        ...(isMovableSession(session) && { movable: true }),
        ...(session.cwd && { cwd: session.cwd }),
```

Export `isMovableSession`. Check that `baseWorkspaceKey` (already imported by `session-sync.ts`) strips `:right`. If it isn't exported, export it.

`session-sync.ts` `syncPaneTabs`. Compute:

```ts
        const movable = isMovableSession(session) ? true : undefined;
        const cwd = session.cwd;
```

Add `tab.movable === movable && tab.cwd === cwd &&` to the unchanged check, and `movable, cwd,` to the refreshed object. Export `syncPaneTabs` next to `syncOwnerTabs`, and import `isMovableSession`.

`session-store.ts`:
- In the direct tab literal (lines 216-223), add `...(isAgentType(type) && { movable: true }),`. A tab created from the UI is never a flow or remote-agent session. Its `cwd` arrives with the next sync.
- In `syncWithMasterSessions`, replace both `existing…Tabs.filter(...).map(...)` blocks with:

```ts
            const rightTabs = syncPaneTabs(state.tabsByWorkspace[rightKey] ?? [], sessionsById);
            const tabs = [...syncPaneTabs(state.tabsByWorkspace[workspaceKey] ?? [], sessionsById)];
```

  The copy keeps the `tabs.push(...)` below working. `syncPaneTabs` returns the original array when nothing changed, and that array must not be mutated.
- Add, after the store definition:

```ts
/** The workspace and tab showing a session, if any. */
export function findSessionTab(sessionId: string): { workspaceKey: string; tab: Tab } | null {
    for (const [workspaceKey, tabs] of Object.entries(useSessionStore.getState().tabsByWorkspace)) {
        const tab = tabs.find((candidate) => candidate.sessionId === sessionId);
        if (tab) return { workspaceKey, tab };
    }
    return null;
}
```

`terminal-lifecycle.ts`: delete `findTabForSession` and use `findSessionTab` from `@/stores/session-store` at its call site. It returns `null` instead of `undefined`, so adjust the check if it compares strictly.

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

function readTarget(host: HTMLElement): SessionDropTarget | null {
    const value = host.dataset.sessionDrop ?? "";
    const backendId = host.dataset.sessionDropBackend ?? "";
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (separator < 0 || !id || !backendId) return null;
    if (kind !== "task" && kind !== "project") return null;
    return { kind, id, backendId, key: value };
}

/** `elements` is the stack under the pointer (document.elementsFromPoint), topmost first. */
function resolveSessionDrop(elements: Element[]): {
    inZone: boolean;
    target: SessionDropTarget | null;
} {
    const host = elements
        .map((element) => element.closest<HTMLElement>("[data-session-drop]"))
        .find((found) => found !== null);
    return {
        inZone: elements.some((element) => element.closest("[data-session-drop-zone]") !== null),
        target: host ? readTarget(host) : null,
    };
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

export { resolveSessionDrop, isValidSessionDrop, sessionMovePayload };
export type { SessionDropTarget };
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/ui/src/lib/session-drop.test.ts packages/ui/src/stores
for f in packages/ui/src/components/panes/terminal/*.test.ts; do bun test "$f" || echo "FAILED: $f"; done
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores packages/ui/src/lib/session-drop.ts packages/ui/src/lib/session-drop.test.ts packages/ui/src/components/panes/terminal/terminal-lifecycle.ts
git commit -m "feat(ui): mark movable session tabs and resolve sidebar drop targets"
```

### Task 9: Drag hook, tab-bar wiring and sidebar targets

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`. Add `sessionDropTarget` and `setSessionDropTarget` (state interface around line 60, actions around line 109, initial state around line 140, implementation near `setMasterWorkspaceActive` around line 261).
- Create: `packages/ui/src/components/workspace/useSessionMoveDrag.ts`
- Create: `packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
- Modify: `packages/ui/src/components/workspace/SplitContainer.tsx` (handlers lines 71-158, `DndContext` lines 188-200).
- Modify: `packages/ui/src/components/workspace/TabBar.tsx` (the non-external `DndContext` branch, lines 143-166).
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx`. Mark the scrolling list (`TaskDropZone`, line 441) as the drop zone.
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx` (the `cardBody` root `div`, lines 255-274).
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx` (the `projectHeader` root `div`, lines 257-269).

**Interfaces:**
- Consumes: everything Task 8 produces; `MSG.SESSION_MOVE`; `sendRequest`; `workspaceBackendId`; `alert`.
- Produces:
  - `useUIStore` state `sessionDropTarget: SessionDropTarget | null` and action `setSessionDropTarget(target: SessionDropTarget | null)`.
  - `interface TabDragEvent { active: { id: UniqueIdentifier }; activatorEvent: Event }`, the subset of dnd-kit's drag events the hook reads.
  - `interface SessionMoveDragDeps { send(backendId: string, payload: SessionMovePayload): Promise<unknown>; report(message: string): void; elementsAt(x: number, y: number): Element[]; pointerEvents: EventTarget }`
  - `createSessionMoveDrag(deps?: SessionMoveDragDeps)` and `useSessionMoveDrag()`. Each returns `{ onDragStart(event: TabDragEvent): void; onDragMove(event: TabDragEvent): void; onDragEnd(event: TabDragEvent): boolean; onDragCancel(): void }`. When `onDragEnd` returns `true` the drop was in the sidebar and was handled, and the caller must skip its own logic.

- [ ] **Step 1: Write the failing hook tests**

`packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { SessionMovePayload, Task } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { createSessionMoveDrag, type TabDragEvent } from "./useSessionMoveDrag";

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

const zone = document.createElement("div");
zone.dataset.sessionDropZone = "";
const card = document.createElement("div");
card.dataset.sessionDrop = "task:b";
card.dataset.sessionDropBackend = "local";
zone.appendChild(card);
const workspace = document.createElement("div");

let sent: Array<{ backendId: string; payload: SessionMovePayload }>;
let reported: string[];
let failWith: Error | null;
let pointerEvents: EventTarget;

function setup() {
    return createSessionMoveDrag({
        send: (backendId, payload) => {
            sent.push({ backendId, payload });
            return failWith ? Promise.reject(failWith) : Promise.resolve({ success: true });
        },
        report: (message) => reported.push(message),
        // x < 100 is the workspace, 100-199 a sidebar gap, 200+ the card;
        // an overlay always sits on top, as dnd-kit's DragOverlay does.
        elementsAt: (x) => [
            document.createElement("div"),
            ...(x >= 200 ? [card, zone] : x >= 100 ? [zone] : [workspace]),
        ],
        pointerEvents,
    });
}

function dragEvent(id: string): TabDragEvent {
    return { active: { id }, activatorEvent: new MouseEvent("pointerdown", { clientX: 0 }) };
}

function movePointer(x: number) {
    pointerEvents.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 0 }));
}

beforeEach(() => {
    sent = [];
    reported = [];
    failWith = null;
    pointerEvents = new EventTarget();
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

describe("session move drag", () => {
    it("highlights a valid card under the overlay and moves the session on drop", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        expect(useUIStore.getState().sessionDropTarget?.key).toBe("task:b");

        expect(drag.onDragEnd(dragEvent("s1"))).toBe(true);
        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(sent).toEqual([{ backendId: "local", payload: { sessionId: "s1", taskId: "b" } }]);
    });

    it("leaves drops in the workspace to the existing handlers", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(10);
        drag.onDragMove(dragEvent("s1"));

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(dragEvent("s1"))).toBe(false);
        expect(sent).toEqual([]);
    });

    it("swallows a drop on a sidebar gap or an invalid card", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("sh"));
        movePointer(250);
        drag.onDragMove(dragEvent("sh"));
        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(dragEvent("sh"))).toBe(true);

        drag.onDragStart(dragEvent("s1"));
        movePointer(150);
        expect(drag.onDragEnd(dragEvent("s1"))).toBe(true);
        expect(sent).toEqual([]);
    });

    it("uses where the pointer is at drop time", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        movePointer(10);

        expect(drag.onDragEnd(dragEvent("s1"))).toBe(false);
        expect(sent).toEqual([]);
    });

    it("stops tracking the pointer and clears the target on cancel", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        drag.onDragCancel();

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
    });

    it("reports the backend's refusal", async () => {
        failWith = new Error("Flow sessions cannot be moved");
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragEnd(dragEvent("s1"));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(reported).toEqual(["Flow sessions cannot be moved"]);
    });
});
```

If `useTaskStore.setState({ tasks: [taskA] })` doesn't type-check because the store's task type differs from `Task & { backendId: string }`, use that store's exported task type for the fixture (look at `task-store.ts`). Never cast.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement the store field and the hook**

`ui-store.ts`:
- Add `import type { SessionDropTarget } from "@/lib/session-drop";`.
- Add `sessionDropTarget: SessionDropTarget | null;` to the state interface, `setSessionDropTarget(target: SessionDropTarget | null): void;` to the actions, and `sessionDropTarget: null,` to the initial state.
- Implementation, which keeps the reference stable while the hovered key doesn't change:

```ts
    setSessionDropTarget(target) {
        set((state) =>
            state.sessionDropTarget?.key === target?.key ? state : { sessionDropTarget: target },
        );
    },
```

`useSessionMoveDrag.ts`:

```ts
import { useMemo } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { MSG } from "@taskflow/shared";
import type { SessionMovePayload } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { isValidSessionDrop, resolveSessionDrop, sessionMovePayload } from "@/lib/session-drop";
import type { SessionDropTarget } from "@/lib/session-drop";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { alert } from "@/stores/dialog-store";
import { findSessionTab } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";

/** The part of dnd-kit's drag events this hook reads. */
interface TabDragEvent {
    active: { id: UniqueIdentifier };
    activatorEvent: Event;
}

interface SessionMoveDragDeps {
    send(backendId: string, payload: SessionMovePayload): Promise<unknown>;
    report(message: string): void;
    /** Every element under a point, topmost first. */
    elementsAt(x: number, y: number): Element[];
    /** Where pointer moves are observed for the length of a drag. */
    pointerEvents: EventTarget;
}

const browserDeps: SessionMoveDragDeps = {
    send: (backendId, payload) => sendRequest(backendId, MSG.SESSION_MOVE, payload),
    report: (message) => void alert({ title: "Couldn't move session", description: message }),
    elementsAt: (x, y) => document.elementsFromPoint(x, y),
    pointerEvents: window,
};

/**
 * Drag a session tab onto a sidebar task card or project row. The sidebar
 * lives in another dnd-kit context, so it is hit-tested rather than
 * registered as a droppable, at the real pointer position: dnd-kit's delta is
 * scroll-adjusted, and its DragOverlay sits under the cursor.
 */
function createSessionMoveDrag(deps: SessionMoveDragDeps = browserDeps) {
    let pointer: { x: number; y: number } | null = null;
    const track = (event: Event) => {
        if (event instanceof MouseEvent) pointer = { x: event.clientX, y: event.clientY };
    };

    function stopTracking(): void {
        deps.pointerEvents.removeEventListener("pointermove", track, true);
        useUIStore.getState().setSessionDropTarget(null);
    }

    /** Where the pointer is now: outside the sidebar, or in it with a valid target or none. */
    function hitTest(
        event: TabDragEvent,
    ): { inZone: false } | { inZone: true; target: SessionDropTarget | null } {
        if (!pointer) return { inZone: false };
        const { inZone, target } = resolveSessionDrop(deps.elementsAt(pointer.x, pointer.y));
        if (!inZone) return { inZone: false };
        const found = findSessionTab(String(event.active.id));
        const valid =
            found !== null &&
            target !== null &&
            isValidSessionDrop({
                tab: found.tab,
                sourceWorkspaceKey: found.workspaceKey,
                sourceBackendId: workspaceBackendId(found.workspaceKey),
                target,
            });
        return { inZone: true, target: valid ? target : null };
    }

    function onDragStart(event: TabDragEvent): void {
        const start = event.activatorEvent;
        pointer = start instanceof MouseEvent ? { x: start.clientX, y: start.clientY } : null;
        deps.pointerEvents.addEventListener("pointermove", track, true);
    }

    function onDragMove(event: TabDragEvent): void {
        const hit = hitTest(event);
        useUIStore.getState().setSessionDropTarget(hit.inZone ? hit.target : null);
    }

    function onDragEnd(event: TabDragEvent): boolean {
        const hit = hitTest(event);
        stopTracking();
        if (!hit.inZone) return false;
        const sessionId = findSessionTab(String(event.active.id))?.tab.sessionId;
        if (hit.target && sessionId) {
            deps.send(hit.target.backendId, sessionMovePayload(sessionId, hit.target)).catch(
                (error: unknown) => {
                    deps.report(error instanceof Error ? error.message : String(error));
                },
            );
        }
        return true;
    }

    function onDragCancel(): void {
        stopTracking();
    }

    return { onDragStart, onDragMove, onDragEnd, onDragCancel };
}

function useSessionMoveDrag() {
    return useMemo(() => createSessionMoveDrag(), []);
}

export { useSessionMoveDrag, createSessionMoveDrag };
export type { TabDragEvent, SessionMoveDragDeps };
```

dnd-kit's `DragStartEvent`, `DragMoveEvent` and `DragEndEvent` are structurally assignable to `TabDragEvent`, so the contexts pass them straight through. `SessionMoveDragDeps` is exported because the test builds one.

- [ ] **Step 4: Run the hook tests**

Run: `bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tab contexts and the sidebar**

`SplitContainer.tsx`:
- Import `useSessionMoveDrag` and add `const sessionMove = useSessionMoveDrag();` after the sensors.
- In `handleDragStart`, call `sessionMove.onDragStart(event);` first, and add `sessionMove` to its deps.
- In `handleDragEnd`, right after `setDraggedTab(null);`, add `if (sessionMove.onDragEnd(event)) return;`, and add `sessionMove` to its deps.
- `handleDragCancel` becomes:

```ts
    const handleDragCancel = useCallback(() => {
        setDraggedTab(null);
        sessionMove.onDragCancel();
    }, [sessionMove]);
```

- Pass `onDragMove={sessionMove.onDragMove}` to the `DndContext`.

`TabBar.tsx`, the non-external branch. It gets a drag overlay (so the tab is visible outside the clipped strip) and the same handlers:

```tsx
    const sessionMove = useSessionMoveDrag();
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            sessionMove.onDragStart(event);
            setDraggedTab(tabs.find((tab) => tab.id === String(event.active.id)) ?? null);
        },
        [tabs, sessionMove],
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

Give the non-external `DndContext` these props: `onDragStart={handleDragStart}`, `onDragMove={sessionMove.onDragMove}`, `onDragEnd={handleDragEnd}`, `onDragCancel={handleDragCancel}`. After its `SortableContext`, add:

```tsx
                    <DragOverlay dropAnimation={null}>
                        {draggedTab && (
                            <TabItemOverlay tab={draggedTab} isActive={draggedTab.id === activeTabId} />
                        )}
                    </DragOverlay>
```

Imports: `DragOverlay` and the `DragStartEvent` type from `@dnd-kit/core`; `useState`; `TabItemOverlay` from `./TabItem`.

`TaskSidebar.tsx`: add `data-session-drop-zone=""` to the `TaskDropZone` at line 441. If `TaskDropZone` doesn't pass unknown props through to its root element, add a `...rest: HTMLAttributes<HTMLDivElement>` passthrough to it rather than wrapping it in another `div`. Its layout classes must keep applying to the scrolling element.

`TaskCard.tsx`: on the `cardBody` root `div` (the one with `role="button"`), add:

```tsx
            data-session-drop={`task:${task.id}`}
            data-session-drop-backend={task.backendId}
```

Above the JSX, add `const isSessionDropTarget = useUIStore((s) => s.sessionDropTarget?.key === \`task:${task.id}\`);` (import `useUIStore` if it isn't already). Add `isSessionDropTarget && "ring-accent ring-2"` to that `div`'s `cn(...)`.

`ProjectGroup.tsx`: on the `projectHeader` root `div`, add `data-session-drop={\`project:${project.id}\`}` and `data-session-drop-backend={project.backendId}`. Add the same highlight using `project:${project.id}`.

The selectors return booleans, so they are stable (memory `project_zustand_reactivity`).

- [ ] **Step 6: Run the UI tests**

```bash
bun test packages/ui/src/components/workspace/useSessionMoveDrag.test.ts packages/ui/src/lib packages/ui/src/stores
for f in packages/ui/src/components/sidebar/*.test.tsx packages/ui/src/components/workspace/*.test.tsx; do bun test "$f" || echo "FAILED: $f"; done
bun test packages/ui
```

Expected: PASS. `bun test packages/ui` runs everything together, and the new tests use no `mock.module`, so they can't leak.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/ui/src
bunx prettier --check packages/ui/src/stores/ui-store.ts packages/ui/src/components/workspace/useSessionMoveDrag.ts packages/ui/src/components/workspace/useSessionMoveDrag.test.ts packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/TabBar.tsx packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/components/sidebar/TaskCard.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx
git add packages/ui/src/stores/ui-store.ts packages/ui/src/components/workspace packages/ui/src/components/sidebar
git commit -m "feat(ui): drag an agent tab onto a sidebar task or project to move it"
```

Update `handoff.md`: Section 5 is done, with the commit hashes.

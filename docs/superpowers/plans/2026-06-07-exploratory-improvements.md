# Exploratory Improvements Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix verified correctness, type-hygiene, and DX issues per the approved spec (`docs/superpowers/specs/2026-06-07-exploratory-improvements-design.md`): backend fire-and-forget error handling, shared↔UI type-contract cleanup, UI reference churn + store hygiene, CLI + API quick wins.

**Architecture:** Four independent workstreams (A–D), one commit each, on one branch. Workstream C extracts the duplicated tab-sync logic from `session-store.ts` into a pure, testable module with reference preservation. Workstream D extracts CLI flag parsing into a pure module so it can be unit-tested.

**Tech Stack:** Bun (runtime, `bun test`), TypeScript strict, Zustand (UI stores), monorepo workspaces (`packages/shared`, `packages/backend`, `packages/ui`).

**Project rules that apply (from CLAUDE.md):** use `bun` only; no `as any`; no co-authored-by lines in commits; don't export unless used; don't disable eslint rules.

**Spec false-positives — do NOT "fix" these (verified fine):** `flow-runner.ts` skipAction persistence, `scheduler-service.ts` execute error handling, `ProjectGroup.tsx` selector, `ui-store.ts` registeredPanels.

---

## Task 0: Branch setup

- [ ] **Step 1: Create branch**

```bash
cd /Users/kuindji/Projects/taskflow
git checkout -b chore/exploratory-improvements
```

- [ ] **Step 2: Baseline check**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all pass (if baseline is broken, stop and report — don't build on a broken base).

---

# Workstream A — Backend fire-and-forget error handling

### Task 1: session-lifecycle catch handlers

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts` (two sites in the `ptyManager.spawn({...})` options, around lines 430–470)

- [ ] **Step 1: Add once-per-session guard + catch to `appendSessionOutput` (hot `onData` path)**

Just above the `ptyManager.spawn({` call, add:

```typescript
let appendErrorLogged = false;
```

In the `onData` callback, change:

```typescript
void taskStore.appendSessionOutput(ownerId, sessionId, sequence, data);
```

to:

```typescript
void taskStore.appendSessionOutput(ownerId, sessionId, sequence, data).catch((err) => {
    if (!appendErrorLogged) {
        appendErrorLogged = true;
        console.error(`[session] Failed to persist output for session ${sessionId}:`, err);
    }
});
```

The guard exists because `onData` fires per terminal chunk — a persistent disk error must not emit one log line per chunk.

- [ ] **Step 2: Add catch to `removeSessionFromOwner` in `onExit`**

Change:

```typescript
void removeSessionFromOwner(
    sessionId,
    master
        ? { master: true }
        : {
              taskId: task?.id,
              projectId: resolvedProjectId,
          },
);
```

to:

```typescript
void removeSessionFromOwner(
    sessionId,
    master
        ? { master: true }
        : {
              taskId: task?.id,
              projectId: resolvedProjectId,
          },
).catch((err) => {
    console.error(`[session] Failed to remove session ${sessionId} from owner:`, err);
});
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: pass.

### Task 2: remote-agent-service and pty-manager catch handlers

**Files:**
- Modify: `packages/backend/src/services/remote-agent-service.ts:159`
- Modify: `packages/backend/src/services/pty-manager.ts:206`

- [ ] **Step 1: remote-agent-service — catch on settings read in `handleSessionExit`**

Change:

```typescript
void this.deps.settingsStore.get().then((settings) => {
    if (settings.remoteAgent.autoStart && !this.explicitlyStopped) {
        this.scheduleRestart();
    }
});
```

to:

```typescript
void this.deps.settingsStore
    .get()
    .then((settings) => {
        if (settings.remoteAgent.autoStart && !this.explicitlyStopped) {
            this.scheduleRestart();
        }
    })
    .catch((err) => {
        console.error("[remote-agent] Failed to read settings after session exit:", err);
    });
```

- [ ] **Step 2: pty-manager — catch on exit cleanup**

Change:

```typescript
void proc.exited.then(cleanup);
```

to:

```typescript
void proc.exited.then(cleanup).catch((err) => {
    console.error(`[pty] Exit cleanup failed for session ${id}:`, err);
});
```

(`id` is the spawn option already in scope in this function.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: pass.

### Task 3: pty-session-win kill timer + commit Workstream A

**Files:**
- Modify: `packages/backend/src/services/pty-session-win.ts` (class fields ~line 42, constructor `proc.exited` handler ~line 74, `kill()` ~line 141)

The finding is **confirmed**: `kill()` creates a 500ms `setTimeout` that is never tracked, so it can fire after the process already exited and keeps the event loop busy.

- [ ] **Step 1: Add tracked timer field**

In the class field declarations (next to `private alive = true;`):

```typescript
private killTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: Clear the timer when the process exits**

In the constructor, change:

```typescript
void this.proc.exited.then((code) => {
    if (this.alive) {
        this.alive = false;
        opts.onExit(code ?? 1);
    }
});
```

to:

```typescript
void this.proc.exited.then((code) => {
    if (this.killTimer !== null) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
    }
    if (this.alive) {
        this.alive = false;
        opts.onExit(code ?? 1);
    }
});
```

- [ ] **Step 3: Store the timer in `kill()`**

Change:

```typescript
kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.send({ type: "kill" });
    setTimeout(() => {
        try {
            this.proc.kill();
        } catch {
            /* already dead */
        }
    }, 500);
}
```

to:

```typescript
kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.send({ type: "kill" });
    this.killTimer = setTimeout(() => {
        this.killTimer = null;
        try {
            this.proc.kill();
        } catch {
            /* already dead */
        }
    }, 500);
}
```

- [ ] **Step 4: Verify and commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all pass.

```bash
git add packages/backend/src/services/session-lifecycle.ts packages/backend/src/services/remote-agent-service.ts packages/backend/src/services/pty-manager.ts packages/backend/src/services/pty-session-win.ts
git commit -m "fix(backend): surface errors from fire-and-forget promises"
```

---

# Workstream B — Type-contract cleanup (shared ↔ UI)

### Task 4: Add missing response types to ws.ts

**Files:**
- Modify: `packages/shared/src/types/ws.ts` (imports at top, new interfaces at end)

- [ ] **Step 1: Add type imports**

At the top of `ws.ts`, alongside the existing `import type` lines, add:

```typescript
import type { Schedule } from "./schedule";
import type { ActionDefinition, FlowDefinition, FlowRun } from "./flow";
```

(If the exact exported names in `types/schedule.ts` / `types/flow.ts` differ, use the names the UI stores import from `@taskflow/shared` — `Schedule`, `FlowDefinition`, `ActionDefinition`, `FlowRun`.)

- [ ] **Step 2: Add the four response interfaces**

At the end of `ws.ts`:

```typescript
export interface ScheduleListResponse {
    schedules: Schedule[];
}

export interface FlowDefinitionsListResponse {
    flows: FlowDefinition[];
}

export interface FlowActionsListResponse {
    actions: ActionDefinition[];
}

export interface FlowRunsListResponse {
    runs: FlowRun[];
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: pass (these are not yet imported anywhere — that's fixed in Task 5; eslint may warn about unused exports only if such a rule exists, which it doesn't here).

### Task 5: Replace inline response shapes in the UI

**Files (all Modify):**
- `packages/ui/src/stores/task-store.ts:67,81,145`
- `packages/ui/src/stores/project-store.ts:39`
- `packages/ui/src/stores/session-store.ts:94`
- `packages/ui/src/stores/notification-store.ts:31`
- `packages/ui/src/stores/schedule-store.ts:26`
- `packages/ui/src/stores/flow-store.ts:68,89,164`
- `packages/ui/src/stores/file-store.ts:175,279`
- `packages/ui/src/components/sidebar/hooks/useSidebarData.ts:67`
- `packages/ui/src/components/workspace/Workspace.tsx:123`
- `packages/ui/src/components/workspace/CommitDialog.tsx:67,102,106,120,124`

All shared types come from `@taskflow/shared` (the index re-exports `types/ws`). For each file: add the type name to the existing `import type { ... } from "@taskflow/shared"` line, then swap the inline generic.

- [ ] **Step 1: task-store.ts**

Add `TaskListResponse, TaskLogListResponse` to the shared import. Replace:
- line 67 and 81: `sendRequest<{ tasks: Task[] }>` → `sendRequest<TaskListResponse>`
- line 145: `sendRequest<{ entries: TaskLogEntry[] }>` → `sendRequest<TaskLogListResponse>`

- [ ] **Step 2: project-store.ts**

Add `ProjectListResponse`. Replace line 39: `sendRequest<{ projects: Project[] }>` → `sendRequest<ProjectListResponse>`

- [ ] **Step 3: session-store.ts**

Add `SessionCreateResponse`. Replace line 94: `sendRequest<{ sessionId: string }>` → `sendRequest<SessionCreateResponse>`

- [ ] **Step 4: notification-store.ts**

Add `NotificationListResponse`. Replace line 31: `sendRequest<{ notifications: Notification[] }>` → `sendRequest<NotificationListResponse>`

- [ ] **Step 5: schedule-store.ts**

Add `ScheduleListResponse`. Replace line 26: `sendRequest<{ schedules: Schedule[] }>` → `sendRequest<ScheduleListResponse>`

- [ ] **Step 6: flow-store.ts**

Add `FlowDefinitionsListResponse, FlowActionsListResponse, FlowRunsListResponse`. Replace:
- line 68: `sendRequest<{ flows: FlowDefinition[] }>` → `sendRequest<FlowDefinitionsListResponse>`
- line 89: `sendRequest<{ actions: ActionDefinition[] }>` → `sendRequest<FlowActionsListResponse>`
- line 164: `sendRequest<{ runs: FlowRun[] }>` → `sendRequest<FlowRunsListResponse>`

- [ ] **Step 7: file-store.ts**

Add `GitStatusResponse, FileReadResponse`. Replace:
- line 175: `sendRequest<{ status: GitStatusResult }>` → `sendRequest<GitStatusResponse>`
- line 279: `sendRequest<{ content: string }>` → `sendRequest<FileReadResponse>`

- [ ] **Step 8: useSidebarData.ts**

Add `MasterSessionsListResponse`. Replace line 67: `sendRequest<{ sessions: SessionRef[] }>` → `sendRequest<MasterSessionsListResponse>`

- [ ] **Step 9: Workspace.tsx**

First check the shape of `FileStatResponse` (ws.ts:293). If it is `{ exists: boolean }` (possibly with extra optional fields), add `FileStatResponse` to imports and replace line 123: `sendRequest<{ exists: boolean }>` → `sendRequest<FileStatResponse>`. If its required fields differ from what the handler actually returns, leave this site as-is and note it in the commit message.

- [ ] **Step 10: CommitDialog.tsx**

Add `GitStatusResponse, GitCreatePrResult`. Replace:
- lines 67, 102, 120: `sendRequest<{ status: GitStatusResult }>` → `sendRequest<GitStatusResponse>`
- lines 106, 124: `sendRequest<{ url: string; number: number }>` → `sendRequest<GitCreatePrResult>`

If `GitStatusResult` is no longer referenced in a file after the swap, remove it from that file's imports.

- [ ] **Step 11: Sweep for stragglers**

Run: `grep -rn "sendRequest<{" packages/ui/src`
For each remaining hit: if a matching response type exists in `ws.ts`, replace it the same way. Hits with no matching shared type (e.g. one-off `{ pr: TaskWorktreePr | null }`) stay as-is — do NOT invent new shared types for single-use shapes (YAGNI).

- [ ] **Step 12: Typecheck**

Run: `bun run typecheck`
Expected: pass. A failure here means a shared type's shape doesn't match what the UI actually destructures — investigate the mismatch (that's exactly the drift this workstream exists to catch); fix the shared type only if the backend handler confirms the UI's shape is right.

### Task 6: Delete dead exports from ws.ts + commit Workstream B

**Files:**
- Modify: `packages/shared/src/types/ws.ts`

- [ ] **Step 1: Identify dead response/event types**

Run:

```bash
for t in FileTreeResponse GitDiffResponse GitDiffFileResponse GitCommitResult FileChangedEvent; do
  echo "$t: $(grep -rn "\b$t\b" packages --include='*.ts' --include='*.tsx' | grep -v 'shared/src/types/ws.ts' | wc -l | tr -d ' ') uses"
done
```

- [ ] **Step 2: Delete every type reporting 0 uses**

Delete the full `export interface ...` block (or the `export type FileChangedEvent = FileChangeEvent;` alias line) for each 0-use type. If deleting `FileChangedEvent` leaves `FileChangeEvent` unimported in ws.ts, remove it from the import line too.

- [ ] **Step 3: Verify and commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all pass.

```bash
git add packages/shared/src/types/ws.ts packages/ui/src
git commit -m "refactor(types): use shared WS response types in UI, drop dead exports"
```

---

# Workstream C — UI reference churn + store hygiene

### Task 7: Pure tab-sync helper with reference preservation (TDD)

`syncWithTasks` and `syncWithProjects` in `session-store.ts` are near-duplicates that rebuild every tab object and both top-level maps on every call. Extract one pure helper that preserves references when nothing changed.

**Files:**
- Create: `packages/ui/src/stores/session-sync.ts`
- Test: `packages/ui/src/stores/session-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/session-sync.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { syncOwnerTabs } from "./session-sync";
import { createSessionTab } from "./session-helpers";

function makeSession(id: string, label = "Claude"): SessionRef {
    return {
        id,
        type: "claude",
        label,
        createdAt: "2026-01-01T00:00:00.000Z",
        instance: "test",
    };
}

const baseArgs = {
    keyPrefix: "task:",
    getWorkspaceKey: (id: string) => `task:${id}`,
    pendingSessionCreates: new Set<string>(),
};

describe("syncOwnerTabs", () => {
    test("returns identical references when nothing changed", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const tabsByWorkspace = { "task:t1": [tab] };
        const activeTabByWorkspace = { "task:t1": tab.id };

        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace,
            activeTabByWorkspace,
        });

        expect(result.tabsByWorkspace).toBe(tabsByWorkspace);
        expect(result.activeTabByWorkspace).toBe(activeTabByWorkspace);
    });

    test("changed label produces new refs only for the affected workspace", () => {
        const s1 = makeSession("s1");
        const s2 = makeSession("s2");
        const tab1 = createSessionTab(s1);
        const tab2 = createSessionTab(s2);
        const tabsByWorkspace = { "task:t1": [tab1], "task:t2": [tab2] };
        const activeTabByWorkspace = { "task:t1": tab1.id, "task:t2": tab2.id };

        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [
                { id: "t1", sessions: [s1] },
                { id: "t2", sessions: [{ ...s2, label: "Renamed" }] },
            ],
            tabsByWorkspace,
            activeTabByWorkspace,
        });

        expect(result.tabsByWorkspace).not.toBe(tabsByWorkspace);
        expect(result.tabsByWorkspace["task:t1"]).toBe(tabsByWorkspace["task:t1"]);
        expect(result.tabsByWorkspace["task:t2"]).not.toBe(tabsByWorkspace["task:t2"]);
        expect(result.tabsByWorkspace["task:t2"][0].label).toBe("Renamed");
    });

    test("drops tabs whose session no longer exists", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [] }],
            tabsByWorkspace: { "task:t1": [tab] },
            activeTabByWorkspace: { "task:t1": tab.id },
        });
        expect(result.tabsByWorkspace["task:t1"]).toBeUndefined();
        expect(result.activeTabByWorkspace["task:t1"]).toBeUndefined();
    });

    test("auto-adds new sessions to the base pane", () => {
        const session = makeSession("s1");
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace: {},
            activeTabByWorkspace: {},
        });
        const tabs = result.tabsByWorkspace["task:t1"];
        expect(tabs).toHaveLength(1);
        expect(tabs[0].sessionId).toBe("s1");
        expect(result.activeTabByWorkspace["task:t1"]).toBe(tabs[0].id);
    });

    test("does not auto-add sessions while a create is pending for the owner", () => {
        const session = makeSession("s1");
        const result = syncOwnerTabs({
            ...baseArgs,
            pendingSessionCreates: new Set(["t1"]),
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace: {},
            activeTabByWorkspace: {},
        });
        expect(result.tabsByWorkspace["task:t1"]).toBeUndefined();
    });

    test("preserves workspace keys with other prefixes by reference", () => {
        const otherTabs = [createSessionTab(makeSession("other"))];
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [],
            tabsByWorkspace: { "project:p1": otherTabs },
            activeTabByWorkspace: { "project:p1": otherTabs[0].id },
        });
        expect(result.tabsByWorkspace["project:p1"]).toBe(otherTabs);
    });
});
```

Note: if `SessionRef` has more required fields than `makeSession` provides, add them with dummy values — do NOT cast with `as`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/stores/session-sync.test.ts`
Expected: FAIL — `session-sync.ts` does not exist. (If the failure is instead an import-time crash from `session-helpers.ts` touching browser globals, stop and report — the helper extraction needs a different seam.)

- [ ] **Step 3: Implement the helper**

Create `packages/ui/src/stores/session-sync.ts`:

```typescript
import type { SessionRef } from "@taskflow/shared";
import type { Tab } from "./session-helpers";
import { createSessionTab, normalizeSessionLabel } from "./session-helpers";

interface SyncOwner {
    id: string;
    sessions: SessionRef[];
}

interface WorkspaceTabState {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
}

interface SyncOwnerTabsArgs extends WorkspaceTabState {
    owners: SyncOwner[];
    keyPrefix: string;
    getWorkspaceKey: (ownerId: string) => string;
    pendingSessionCreates: ReadonlySet<string>;
}

/**
 * Reconcile an existing tab (filter out dead sessions, refresh type/label)
 * while preserving object references when nothing changed. Returns the
 * original array reference if no tab was added, removed, or modified.
 */
function syncPaneTabs(existing: Tab[], sessionsById: Map<string, SessionRef>): Tab[] {
    let changed = false;
    const next: Tab[] = [];
    for (const tab of existing) {
        if (!tab.sessionId) {
            next.push(tab);
            continue;
        }
        const session = sessionsById.get(tab.sessionId);
        if (!session) {
            changed = true;
            continue;
        }
        const label =
            tab.autoTitle !== true
                ? normalizeSessionLabel(session.type, session.label)
                : tab.label;
        if (tab.type === session.type && tab.label === label) {
            next.push(tab);
        } else {
            changed = true;
            next.push({
                ...tab,
                type: session.type,
                ...(tab.autoTitle !== true && { label }),
            });
        }
    }
    return changed ? next : existing;
}

function sameRecord<T>(a: Record<string, T>, b: Record<string, T>): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

/**
 * Rebuild the workspace tab maps for all owners under a key prefix
 * ("task:" or "project:"). Behavior matches the previous inline
 * syncWithTasks/syncWithProjects logic exactly, with one addition:
 * when the result is identical, the ORIGINAL map references are
 * returned so Zustand subscribers don't re-render.
 */
function syncOwnerTabs(args: SyncOwnerTabsArgs): WorkspaceTabState {
    const { owners, keyPrefix, getWorkspaceKey, pendingSessionCreates } = args;

    const nextTabs: Record<string, Tab[]> = {};
    for (const [key, value] of Object.entries(args.tabsByWorkspace)) {
        if (!key.startsWith(keyPrefix)) nextTabs[key] = value;
    }
    const nextActive: Record<string, string> = {};
    for (const [key, value] of Object.entries(args.activeTabByWorkspace)) {
        if (!key.startsWith(keyPrefix)) nextActive[key] = value;
    }

    for (const owner of owners) {
        const workspaceKey = getWorkspaceKey(owner.id);
        const rightKey = `${workspaceKey}:right`;
        const sessionsById = new Map(owner.sessions.map((session) => [session.id, session]));

        // Right-pane tabs: filter by session existence only, no new sessions added
        const rightTabs = syncPaneTabs(args.tabsByWorkspace[rightKey] ?? [], sessionsById);
        if (rightTabs.length > 0) {
            nextTabs[rightKey] = rightTabs;
            const currentRightActiveId = args.activeTabByWorkspace[rightKey];
            nextActive[rightKey] = rightTabs.some((tab) => tab.id === currentRightActiveId)
                ? currentRightActiveId
                : rightTabs[0].id;
        }

        // Base-pane tabs
        let tabs = syncPaneTabs(args.tabsByWorkspace[workspaceKey] ?? [], sessionsById);
        if (!pendingSessionCreates.has(owner.id)) {
            let additions: Tab[] | null = null;
            for (const session of owner.sessions) {
                const alreadyInBase = tabs.some((tab) => tab.sessionId === session.id);
                const alreadyInRight = rightTabs.some((tab) => tab.sessionId === session.id);
                const alreadyAdded =
                    additions?.some((tab) => tab.sessionId === session.id) ?? false;
                if (!alreadyInBase && !alreadyInRight && !alreadyAdded) {
                    (additions ??= []).push(createSessionTab(session));
                }
            }
            if (additions) tabs = [...tabs, ...additions];
        }

        if (tabs.length === 0) {
            continue;
        }

        nextTabs[workspaceKey] = tabs;
        const currentActiveId = args.activeTabByWorkspace[workspaceKey];
        nextActive[workspaceKey] = tabs.some((tab) => tab.id === currentActiveId)
            ? currentActiveId
            : tabs[0].id;
    }

    if (
        sameRecord(nextTabs, args.tabsByWorkspace) &&
        sameRecord(nextActive, args.activeTabByWorkspace)
    ) {
        return {
            tabsByWorkspace: args.tabsByWorkspace,
            activeTabByWorkspace: args.activeTabByWorkspace,
        };
    }
    return { tabsByWorkspace: nextTabs, activeTabByWorkspace: nextActive };
}

export { syncOwnerTabs };
```

Note on TS: `currentRightActiveId` / `currentActiveId` index accesses type as `string` only if `noUncheckedIndexedAccess` is off (it is off — the original `session-store.ts` code relies on the same). If typecheck complains, mirror however the original handled it; do not add `as` casts.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/ui/src/stores/session-sync.test.ts`
Expected: PASS (6 tests). If "returns identical references" fails: check whether `createSessionTab` sets a label that differs from `normalizeSessionLabel(type, label)` for the same session — if so, fix the TEST's expectation builder (construct the tab via `createSessionTab` exactly as the store does), not the helper.

### Task 8: Wire session-store to the helper

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts` (`syncWithTasks` ~line 386, `syncWithProjects` ~line 477)

- [ ] **Step 1: Replace both method bodies**

Add to imports: `import { syncOwnerTabs } from "./session-sync";`

Replace the entire `syncWithTasks(tasks) { ... }` method with:

```typescript
syncWithTasks(tasks) {
    set((state) =>
        syncOwnerTabs({
            owners: tasks,
            keyPrefix: "task:",
            getWorkspaceKey: getTaskWorkspaceKey,
            pendingSessionCreates,
            tabsByWorkspace: state.tabsByWorkspace,
            activeTabByWorkspace: state.activeTabByWorkspace,
        }),
    );
},
```

Replace the entire `syncWithProjects(projects) { ... }` method with:

```typescript
syncWithProjects(projects) {
    set((state) =>
        syncOwnerTabs({
            owners: projects,
            keyPrefix: "project:",
            getWorkspaceKey: getProjectWorkspaceKey,
            pendingSessionCreates,
            tabsByWorkspace: state.tabsByWorkspace,
            activeTabByWorkspace: state.activeTabByWorkspace,
        }),
    );
},
```

When the helper returns the original references, the `set` partial contains identical refs, so selector-based subscribers do not re-render.

- [ ] **Step 2: Remove now-unused imports**

If `createSessionTab` and/or `normalizeSessionLabel` are no longer referenced anywhere else in `session-store.ts`, remove them from its `./session-helpers` import (check with grep before removing — other methods may use them).

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test packages/ui/src/stores/session-sync.test.ts`
Expected: pass.

- [ ] **Step 4: Manual smoke test (recommended, requires the app)**

Run `bun run dev:electron`; open a task, create a session, close it, rename a session, create a split-pane session. Tabs must behave exactly as before. If you cannot run the app, state that explicitly when reporting completion.

### Task 9: HMR disposal + dead export cleanup + commit Workstream C

**Files:**
- Modify: `packages/ui/src/stores/task-store.ts` (after the module-level listeners, ~line 190)
- Modify: `packages/ui/src/stores/diff-store.ts:79-81`

- [ ] **Step 1: Add HMR dispose to task-store**

After the three module-level listeners (`_unsubTaskUpdated`, `_unsubTaskCreated`, `_unsubTaskLogAdded`), add (same pattern as `notification-store.ts:93`):

```typescript
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubTaskUpdated();
        _unsubTaskCreated();
        _unsubTaskLogAdded();
    });
}
```

- [ ] **Step 2: Fix diff-store — remove dead export, add HMR dispose**

Replace:

```typescript
// Keep the export to prevent tree-shaking of the side-effect
export { _unsubChangeStats };
```

with:

```typescript
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubChangeStats();
    });
}
```

(The module-level `const` keeps the listener alive; the export had zero importers. Using it in the dispose hook also satisfies no-unused-vars.)

- [ ] **Step 3: Audit remaining stores**

Run: `grep -ln "onEvent(" packages/ui/src/stores/*.ts` and `grep -ln "import.meta.hot" packages/ui/src/stores/*.ts`
Any file in the first list but not the second gets the same `import.meta.hot.dispose` block covering ALL its module-level `onEvent` unsubscribers.

- [ ] **Step 4: Verify and commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all pass.

```bash
git add packages/ui/src/stores
git commit -m "perf(ui): preserve references in session tab sync, add HMR cleanup to stores"
```

---

# Workstream D — CLI + API quick wins

### Task 10: Extract testable flag parser (TDD)

**Files:**
- Create: `packages/backend/src/services/cli-flags.ts`
- Test: `packages/backend/tests/services/cli-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/cli-flags.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { consumeFlags } from "../../src/services/cli-flags";

describe("consumeFlags", () => {
    test("parses known string and boolean flags", () => {
        const result = consumeFlags(["create", "--name", "foo", "--force"], {
            name: "string",
            force: "boolean",
        });
        expect(result.flags).toEqual({ name: "foo", force: true });
        expect(result.positional).toEqual(["create"]);
        expect(result.unknown).toEqual([]);
    });

    test("collects unknown flags instead of silently skipping", () => {
        const result = consumeFlags(["--typo"], { name: "string" });
        expect(result.unknown).toEqual(["--typo"]);
    });

    test("unknown flag does not consume the following value as its own", () => {
        const result = consumeFlags(["--typo", "value", "pos"], {});
        expect(result.unknown).toEqual(["--typo"]);
        expect(result.positional).toEqual(["value", "pos"]);
    });

    test("string flag at end of args gets empty value", () => {
        const result = consumeFlags(["--name"], { name: "string" });
        expect(result.flags.name).toBe("");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/backend/tests/services/cli-flags.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `cli-flags.ts`**

Create `packages/backend/src/services/cli-flags.ts` (logic is the existing `consumeFlags` from `taskflow-cli-bin.ts:131-153` plus the `unknown` array):

```typescript
type FlagSpec = Record<string, "string" | "boolean">;

interface ParsedFlags {
    flags: Record<string, string | boolean>;
    positional: string[];
    unknown: string[];
}

function consumeFlags(args: string[], spec: FlagSpec): ParsedFlags {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    const unknown: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const kind = spec[name];
            if (kind === "boolean") {
                flags[name] = true;
                i++;
            } else if (kind === "string") {
                flags[name] = args[i + 1] ?? "";
                i += 2;
            } else {
                unknown.push(arg);
                i++;
            }
        } else {
            positional.push(arg);
            i++;
        }
    }
    return { flags, positional, unknown };
}

export { consumeFlags };
```

(`FlagSpec` and `ParsedFlags` stay unexported — nothing outside this module names them, and the project rule is "don't export unless used".)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/backend/tests/services/cli-flags.test.ts`
Expected: PASS (4 tests).

### Task 11: Wire the CLI binary

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts` (old `consumeFlags` at lines ~131-153; ~20 call sites; `default` branch at ~1189)

- [ ] **Step 1: Delete the old `consumeFlags` function**

Remove the entire `function consumeFlags(...) { ... }` definition (lines ~131-153, under `// --- Flag parsing helpers ---`).

- [ ] **Step 2: Rename remaining call sites**

Replace ALL occurrences of `consumeFlags(` with `parseFlags(` in `taskflow-cli-bin.ts` (do this BEFORE adding the new code below, so the rename can't touch it). There are ~20 call sites.

- [ ] **Step 3: Add the import and the strict wrapper**

Where the old function was (under `// --- Flag parsing helpers ---`), add:

```typescript
import { consumeFlags } from "./cli-flags";

function parseFlags(
    args: string[],
    spec: Record<string, "string" | "boolean">,
): { flags: Record<string, string | boolean>; positional: string[] } {
    const { flags, positional, unknown } = consumeFlags(args, spec);
    if (unknown.length > 0) {
        process.stderr.write(`Error: unknown flag "${unknown[0]}"\n`);
        process.exit(1);
    }
    return { flags, positional };
}
```

(Move the `import` to the top of the file with any other imports; the bin is compiled with `bun build --compile`, which bundles local imports.)

- [ ] **Step 4: Unknown command error**

In the command `switch` `default` branch, change:

```typescript
default:
    process.stderr.write(await api("GET", "/api/cli-help"));
    process.exit(1);
```

to:

```typescript
default:
    if (cmd !== "") {
        process.stderr.write(`Error: unknown command "${cmd}"\n\n`);
    }
    process.stderr.write(await api("GET", "/api/cli-help"));
    process.exit(1);
```

(The `cmd !== ""` guard keeps bare `taskflow-cli` invocations printing plain help.)

- [ ] **Step 5: Verify CLI still builds**

Run: `bun run typecheck` and `cd packages/backend && bun run build:bin && cd ../..`
Expected: both succeed. (If `build:bin` is mac-only/slow, `bun build src/services/taskflow-cli-bin.ts --target=bun --outdir /tmp/cli-check` from `packages/backend` is a sufficient bundling check.)

### Task 12: API route error logging + final verification + commit Workstream D

**Files:**
- Modify: all of `packages/backend/src/api/routes/{task,session,flow,schedule,notification,project,settings}-routes.ts`

- [ ] **Step 1: Enumerate the 5xx catch sites**

Run:

```bash
grep -rn -B6 "errorResponse(.*500" packages/backend/src/api/routes/*.ts | grep -E "catch|500"
```

(~35 `errorResponse(..., 500)` sites.)

- [ ] **Step 2: Add logging to every catch that can return a 5xx**

Pattern — for each catch block, insert a `console.error` immediately before the 5xx return, naming the method and path of the enclosing route handler. Example (`task-routes.ts:193`):

```typescript
} catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api] POST /api/tasks/:taskId/log failed:", err);
    return errorResponse(message, 500);
}
```

Rules:
- Use the actual METHOD and path of the route the catch lives in (read the surrounding route registration to get it).
- Mixed catches that return 404 for "not found" and 500 otherwise: log ONLY before the 500 return, after the 404 early-return.
- Bare `catch {` blocks that return a 5xx: change to `catch (err)` and log. Bare `catch {` blocks returning 4xx or a fallback value: leave untouched.
- Log the `err` object itself (not just `message`) so stack traces survive.

- [ ] **Step 3: Full verification**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all pass, including the existing `packages/backend/tests/api/routes.test.ts`.

- [ ] **Step 4: Commit Workstream D**

```bash
git add packages/backend/src/services/cli-flags.ts packages/backend/src/services/taskflow-cli-bin.ts packages/backend/tests/services/cli-flags.test.ts packages/backend/src/api/routes
git commit -m "feat(cli): error on unknown flags and commands; log API route failures"
```

---

## Final checklist (after all workstreams)

- [ ] `bun run typecheck` — pass
- [ ] `bun run lint` — pass
- [ ] `bun test` — pass, including the two new test files
- [ ] `git log --oneline main..HEAD` shows exactly 4 commits (plus none with co-authored-by lines)
- [ ] Report any spec deviations (e.g. Task 5 Step 9 skipped, Task 8 Step 4 smoke test not run)

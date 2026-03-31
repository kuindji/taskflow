# Workspace Vertical Split View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vertical split view to workspaces so users can view two independent pane groups (each with its own tab bar and tab content) side by side.

**Architecture:** Extract a `WorkspacePane` component from the current Workspace internals. The `Workspace` component becomes an orchestrator rendering `TaskHeader` + `SplitContainer`, where `SplitContainer` manages one or two `WorkspacePane` instances separated by a `ResizeHandle`. Split state lives in the UI store (ephemeral, not persisted). Session store keys are extended with a `:right` suffix for the right pane.

**Tech Stack:** React, Zustand, @dnd-kit, Tailwind CSS, lucide-react icons

---

## File Map

**New files:**
- `packages/ui/src/components/workspace/WorkspacePane.tsx` — Self-contained pane component (TabBar + TabContent)
- `packages/ui/src/components/workspace/SplitContainer.tsx` — Manages left/right panes with resize handle

**Modified files:**
- `packages/ui/src/stores/ui-store.ts` — Add `splitByWorkspace` state and split actions
- `packages/ui/src/components/workspace/Workspace.tsx` — Refactor to use SplitContainer/WorkspacePane
- `packages/ui/src/components/workspace/TaskHeader.tsx` — Add split toggle button
- `packages/ui/src/components/workspace/TabBar.tsx` — Lift DndContext out, accept external sensors/handlers
- `packages/ui/src/stores/session-helpers.ts` — Update `isSessionFocused` for split panes

---

### Task 1: Add split state to UI store

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add split state type and fields to UIStore interface**

In `packages/ui/src/stores/ui-store.ts`, add the split state type and interface members. Add this type above the `UIStore` interface:

```typescript
type PaneId = "left" | "right";

interface WorkspaceSplit {
    open: boolean;
    ratio: number;
    activePane: PaneId;
}
```

Export `PaneId` alongside the existing export (add to the existing `export type { PanelId }` line):

```typescript
export type { PanelId, PaneId };
```

Add these fields to the `UIStore` interface:

```typescript
splitByWorkspace: Record<string, WorkspaceSplit>;
toggleSplit(workspaceKey: string): void;
setSplitRatio(workspaceKey: string, ratio: number): void;
setActivePane(workspaceKey: string, pane: PaneId): void;
getSplit(workspaceKey: string): WorkspaceSplit | undefined;
```

- [ ] **Step 2: Implement the split state and actions in the store**

Add default state:

```typescript
splitByWorkspace: {},
```

Implement the actions:

```typescript
toggleSplit(workspaceKey) {
    set((s) => {
        const current = s.splitByWorkspace[workspaceKey];
        if (current?.open) {
            const { [workspaceKey]: _, ...rest } = s.splitByWorkspace;
            return { splitByWorkspace: rest };
        }
        return {
            splitByWorkspace: {
                ...s.splitByWorkspace,
                [workspaceKey]: { open: true, ratio: 0.5, activePane: "left" },
            },
        };
    });
},
setSplitRatio(workspaceKey, ratio) {
    set((s) => {
        const current = s.splitByWorkspace[workspaceKey];
        if (!current?.open) return s;
        return {
            splitByWorkspace: {
                ...s.splitByWorkspace,
                [workspaceKey]: { ...current, ratio: Math.max(0.2, Math.min(0.8, ratio)) },
            },
        };
    });
},
setActivePane(workspaceKey, pane) {
    set((s) => {
        const current = s.splitByWorkspace[workspaceKey];
        if (!current?.open || current.activePane === pane) return s;
        return {
            splitByWorkspace: {
                ...s.splitByWorkspace,
                [workspaceKey]: { ...current, activePane: pane },
            },
        };
    });
},
getSplit(workspaceKey) {
    return get().splitByWorkspace[workspaceKey];
},
```

Note: `toggleSplit` removes the entry entirely when closing. The session store merge (moving right-pane tabs to left) is handled by the component that calls `toggleSplit` — see Task 4.

- [ ] **Step 3: Verify the store compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to ui-store.ts

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add workspace split state to UI store"
```

---

### Task 2: Add mergeSplitTabs to session store

When the split is closed, tabs from the right pane need to merge into the left pane. This is a session store concern.

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Add mergeSplitTabs method to SessionStore interface**

In `packages/ui/src/stores/session-store.ts`, add to the `SessionStore` interface:

```typescript
mergeSplitTabs(workspaceKey: string): void;
```

- [ ] **Step 2: Implement mergeSplitTabs**

Add the implementation in the store creator:

```typescript
mergeSplitTabs(workspaceKey) {
    const rightKey = `${workspaceKey}:right`;
    set((s) => {
        const rightTabs = s.tabsByWorkspace[rightKey];
        if (!rightTabs || rightTabs.length === 0) {
            const { [rightKey]: _, ...restTabs } = s.tabsByWorkspace;
            const { [rightKey]: __, ...restActive } = s.activeTabByWorkspace;
            return {
                tabsByWorkspace: restTabs,
                activeTabByWorkspace: restActive,
            };
        }
        const leftTabs = s.tabsByWorkspace[workspaceKey] ?? [];
        const { [rightKey]: _, ...restTabs } = s.tabsByWorkspace;
        const { [rightKey]: __, ...restActive } = s.activeTabByWorkspace;
        return {
            tabsByWorkspace: {
                ...restTabs,
                [workspaceKey]: [...leftTabs, ...rightTabs],
            },
            activeTabByWorkspace: restActive,
        };
    });
},
```

- [ ] **Step 3: Verify the store compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to session-store.ts

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: add mergeSplitTabs to session store"
```

---

### Task 3: Add moveTabToPane to session store

Dragging a tab between panes requires moving a tab from one workspace key to another.

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Add moveTabToPane method to SessionStore interface**

```typescript
moveTabToPane(sourceKey: string, targetKey: string, tabId: string, insertIndex?: number): void;
```

- [ ] **Step 2: Implement moveTabToPane**

```typescript
moveTabToPane(sourceKey, targetKey, tabId, insertIndex) {
    set((s) => {
        const sourceTabs = s.tabsByWorkspace[sourceKey];
        if (!sourceTabs) return s;
        const tabIndex = sourceTabs.findIndex((t) => t.id === tabId);
        if (tabIndex === -1) return s;

        const tab = sourceTabs[tabIndex];
        const newSourceTabs = sourceTabs.filter((t) => t.id !== tabId);
        const targetTabs = [...(s.tabsByWorkspace[targetKey] ?? [])];

        if (typeof insertIndex === "number" && insertIndex >= 0) {
            targetTabs.splice(insertIndex, 0, tab);
        } else {
            targetTabs.push(tab);
        }

        // Update active tab for source: pick the next tab or last tab
        const sourceActiveId = s.activeTabByWorkspace[sourceKey];
        const newSourceActive =
            sourceActiveId === tabId
                ? (newSourceTabs[Math.min(tabIndex, newSourceTabs.length - 1)]?.id ?? "")
                : sourceActiveId;

        return {
            tabsByWorkspace: {
                ...s.tabsByWorkspace,
                [sourceKey]: newSourceTabs,
                [targetKey]: targetTabs,
            },
            activeTabByWorkspace: {
                ...s.activeTabByWorkspace,
                [sourceKey]: newSourceActive,
                [targetKey]: tab.id,
            },
        };
    });
},
```

- [ ] **Step 3: Verify the store compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: add moveTabToPane to session store"
```

---

### Task 4: Update syncWithTasks/syncWithProjects to preserve right-pane tabs

The sync methods currently filter workspace keys by prefix (`task:`, `project:`). They need to also handle `:right` suffixed keys.

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Update syncWithTasks**

In the `syncWithTasks` method, the initial filtering removes all `task:*` entries. This also catches `task:{id}:right` keys. We need to preserve right-pane tabs during sync, applying the same session-existence filtering.

Replace the opening of `syncWithTasks`:

```typescript
syncWithTasks(tasks) {
    set((state) => {
        const nextTabsByWorkspace: Record<string, Tab[]> = Object.fromEntries(
            Object.entries(state.tabsByWorkspace).filter(
                ([key]) => !key.startsWith("task:"),
            ),
        );
        const nextActiveTabByWorkspace: Record<string, string> = Object.fromEntries(
            Object.entries(state.activeTabByWorkspace).filter(
                ([key]) => !key.startsWith("task:"),
            ),
        );

        for (const task of tasks) {
            const workspaceKey = getTaskWorkspaceKey(task.id);
            const sessionsById = new Map(task.sessions.map((session) => [session.id, session]));

            // Process both the main key and the :right key
            for (const key of [workspaceKey, `${workspaceKey}:right`]) {
                const existingTabs = state.tabsByWorkspace[key] ?? [];
                if (existingTabs.length === 0 && key.endsWith(":right")) continue;

                const tabs = existingTabs
                    .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                    .map((tab) => {
                        if (!tab.sessionId) return tab;
                        const session = sessionsById.get(tab.sessionId);
                        if (!session) return tab;
                        return {
                            ...tab,
                            type: session.type,
                            ...(tab.autoTitle !== true && {
                                label: normalizeSessionLabel(session.type, session.label),
                            }),
                        };
                    });

                // Only add new sessions to the main key, not the :right key
                if (!key.endsWith(":right")) {
                    for (const session of task.sessions) {
                        if (
                            !tabs.some((tab) => tab.sessionId === session.id) &&
                            !(state.tabsByWorkspace[`${workspaceKey}:right`] ?? []).some(
                                (tab) => tab.sessionId === session.id,
                            )
                        ) {
                            tabs.push(createSessionTab(session));
                        }
                    }
                }

                if (tabs.length === 0) continue;

                nextTabsByWorkspace[key] = tabs;
                const currentActiveId = state.activeTabByWorkspace[key];
                nextActiveTabByWorkspace[key] = tabs.some(
                    (tab) => tab.id === currentActiveId,
                )
                    ? currentActiveId
                    : tabs[0].id;
            }
        }

        return {
            tabsByWorkspace: nextTabsByWorkspace,
            activeTabByWorkspace: nextActiveTabByWorkspace,
        };
    });
},
```

- [ ] **Step 2: Update syncWithProjects**

Apply the same pattern to `syncWithProjects`. Replace the method body:

```typescript
syncWithProjects(projects) {
    set((state) => {
        const nextTabsByWorkspace: Record<string, Tab[]> = Object.fromEntries(
            Object.entries(state.tabsByWorkspace).filter(
                ([key]) => !key.startsWith("project:"),
            ),
        );
        const nextActiveTabByWorkspace: Record<string, string> = Object.fromEntries(
            Object.entries(state.activeTabByWorkspace).filter(
                ([key]) => !key.startsWith("project:"),
            ),
        );

        for (const project of projects) {
            const workspaceKey = getProjectWorkspaceKey(project.id);
            const sessionsById = new Map(
                project.sessions.map((session) => [session.id, session]),
            );

            for (const key of [workspaceKey, `${workspaceKey}:right`]) {
                const existingTabs = state.tabsByWorkspace[key] ?? [];
                if (existingTabs.length === 0 && key.endsWith(":right")) continue;

                const tabs = existingTabs
                    .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                    .map((tab) => {
                        if (!tab.sessionId) return tab;
                        const session = sessionsById.get(tab.sessionId);
                        if (!session) return tab;
                        return {
                            ...tab,
                            type: session.type,
                            ...(tab.autoTitle !== true && {
                                label: normalizeSessionLabel(session.type, session.label),
                            }),
                        };
                    });

                if (!key.endsWith(":right")) {
                    for (const session of project.sessions) {
                        if (
                            !tabs.some((tab) => tab.sessionId === session.id) &&
                            !(state.tabsByWorkspace[`${workspaceKey}:right`] ?? []).some(
                                (tab) => tab.sessionId === session.id,
                            )
                        ) {
                            tabs.push(createSessionTab(session));
                        }
                    }
                }

                if (tabs.length === 0) continue;

                nextTabsByWorkspace[key] = tabs;
                const currentActiveId = state.activeTabByWorkspace[key];
                nextActiveTabByWorkspace[key] = tabs.some(
                    (tab) => tab.id === currentActiveId,
                )
                    ? currentActiveId
                    : tabs[0].id;
            }
        }

        return {
            tabsByWorkspace: nextTabsByWorkspace,
            activeTabByWorkspace: nextActiveTabByWorkspace,
        };
    });
},
```

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: sync methods preserve right-pane tabs"
```

---

### Task 5: Update isSessionFocused for split panes

The `isSessionFocused` helper in `session-helpers.ts` checks only the base workspace key. It needs to also check the `:right` key.

**Files:**
- Modify: `packages/ui/src/stores/session-helpers.ts`

- [ ] **Step 1: Update isSessionFocused**

Replace the `isSessionFocused` function:

```typescript
function isSessionFocused(
    sessionId: string,
    getSessionState: () => {
        activeTabByWorkspace: Record<string, string>;
        tabsByWorkspace: Record<string, Tab[]>;
    },
): boolean {
    if (!windowFocused) return false;
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const activeProjectId = useUIStore.getState().activeProjectId;
    const masterWorkspaceActive = useUIStore.getState().masterWorkspaceActive;
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : masterWorkspaceActive
            ? "master"
            : null;
    if (!workspaceKey) return false;
    const store = getSessionState();

    // Check both panes (base key and :right key)
    for (const key of [workspaceKey, `${workspaceKey}:right`]) {
        const activeTabId = store.activeTabByWorkspace[key];
        const tabs = store.tabsByWorkspace[key] ?? [];
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab?.sessionId === sessionId) return true;
    }

    return false;
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/session-helpers.ts
git commit -m "feat: isSessionFocused checks both split panes"
```

---

### Task 6: Create WorkspacePane component

Extract the TabBar + TabContent pair into a reusable pane component.

**Files:**
- Create: `packages/ui/src/components/workspace/WorkspacePane.tsx`

- [ ] **Step 1: Create WorkspacePane.tsx**

This component encapsulates the TabBar and TabContent for a single pane. It receives its workspace key (either the base key or `{base}:right`) and renders independently.

```typescript
import { useCallback } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
} from "@taskflow/shared";
import type { AgentType } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import { isEditorDirty, clearEditorDirty } from "@/components/panes/editor-dirty-state";
import { confirm } from "@/stores/dialog-store";
import { isSessionExited } from "@/stores/session-helpers";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import type { Tab } from "@/stores/session-store";
import type { PaneId } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

interface WorkspacePaneProps {
    workspaceKey: string;
    paneId: PaneId;
    isFocused: boolean;
    onFocus: () => void;
    tabs: Tab[];
    activeTabId: string;
    projectPath?: string | null;
    onNewTab: (
        type: AgentType | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => void;
    onRunTab: (type: AgentType, agentOptions?: AgentLaunchOptions) => void;
    onRunScript: (scriptName: string) => void;
    onRunAction: (action: ActionDefinition) => void;
    onRunAgentCommand: (command: AgentCommand) => void;
    onStartFlow: (flowId: string) => void;
    onManageFlows: () => void;
    scripts: Record<string, string>;
    defaultRuntime: string;
    flows: FlowDefinition[];
    standaloneActions: ActionDefinition[];
    agentCommands: AgentCommand[];
    activeFlowRun: FlowRun | null;
    showRunButton: boolean;
    showAgentOptions: boolean;
    allowSessionTabs: boolean;
    isElectron?: boolean;
    className?: string;
}

function WorkspacePane({
    workspaceKey,
    paneId,
    isFocused,
    onFocus,
    tabs,
    activeTabId,
    projectPath,
    onNewTab,
    onRunTab,
    onRunScript,
    onRunAction,
    onRunAgentCommand,
    onStartFlow,
    onManageFlows,
    scripts,
    defaultRuntime,
    flows,
    standaloneActions,
    agentCommands,
    activeFlowRun,
    showRunButton,
    showAgentOptions,
    allowSessionTabs,
    isElectron,
    className,
}: WorkspacePaneProps) {
    const setActiveTab = useSessionStore((s) => s.setActiveTab);
    const renameTab = useSessionStore((s) => s.renameTab);
    const reorderTabs = useSessionStore((s) => s.reorderTabs);

    const handleTabClose = useCallback(
        (id: string) => {
            const tab = tabs.find((t) => t.id === id);
            const closeTab = useSessionStore.getState().closeTab;

            const doClose = () => {
                if (tab?.filePath) clearEditorDirty(tab.filePath);
                if (tab?.sessionId) destroyTerminal(tab.sessionId);
                void closeTab(workspaceKey, id);
            };

            if (tab?.type === "editor" && tab.filePath && isEditorDirty(tab.filePath)) {
                void confirm({
                    title: "Unsaved Changes",
                    description: `"${tab.filePath.split("/").pop()}" has unsaved changes that will be lost.`,
                    confirmLabel: "Close Without Saving",
                    cancelLabel: "Cancel",
                    variant: "destructive",
                    onConfirm: async () => doClose(),
                });
                return;
            }

            if (tab?.type === "editor" && tab.sessionId && !isSessionExited(tab.sessionId)) {
                void confirm({
                    title: "Editor Still Running",
                    description: `"${tab.label}" is still running. Unsaved changes will be lost.`,
                    confirmLabel: "Close Editor",
                    cancelLabel: "Cancel",
                    variant: "destructive",
                    onConfirm: async () => doClose(),
                });
                return;
            }

            doClose();
        },
        [tabs, workspaceKey],
    );

    return (
        <div
            className={cn("flex min-w-0 flex-1 flex-col", className)}
            onPointerDown={onFocus}
        >
            <TabBar
                className={cn(
                    isElectron && paneId === "left" ? "[-webkit-app-region:drag]" : undefined,
                    !isFocused && "opacity-70",
                )}
                tabs={tabs}
                activeTabId={activeTabId}
                projectPath={projectPath}
                onTabClick={(id) => setActiveTab(workspaceKey, id)}
                onTabClose={handleTabClose}
                onTabRename={(id, newLabel) => renameTab(workspaceKey, id, newLabel)}
                onTabReorder={(activeId, overId) => reorderTabs(workspaceKey, activeId, overId)}
                onNewTab={onNewTab}
                onRunTab={onRunTab}
                onRunScript={onRunScript}
                onRunAction={onRunAction}
                onRunAgentCommand={onRunAgentCommand}
                onStartFlow={onStartFlow}
                onManageFlows={onManageFlows}
                scripts={scripts}
                defaultRuntime={defaultRuntime}
                flows={flows}
                standaloneActions={standaloneActions}
                agentCommands={agentCommands}
                activeFlowRun={activeFlowRun}
                showRunButton={showRunButton}
                showAgentOptions={showAgentOptions}
                allowSessionTabs={allowSessionTabs}
            />
            <TabContent tabs={tabs} activeTabId={activeTabId} />
        </div>
    );
}

export { WorkspacePane };
export type { WorkspacePaneProps };
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/WorkspacePane.tsx
git commit -m "feat: create WorkspacePane component"
```

---

### Task 7: Create SplitContainer component

**Files:**
- Create: `packages/ui/src/components/workspace/SplitContainer.tsx`

- [ ] **Step 1: Create SplitContainer.tsx**

This component manages the left/right panes with a resize handle between them.

```typescript
import { useCallback, useRef } from "react";
import { useUIStore } from "@/stores/ui-store";
import type { PaneId } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { ResizeHandle } from "@/components/ResizeHandle";
import { WorkspacePane } from "./WorkspacePane";
import type { WorkspacePaneProps } from "./WorkspacePane";

type SharedPaneProps = Omit<
    WorkspacePaneProps,
    "workspaceKey" | "paneId" | "isFocused" | "onFocus" | "tabs" | "activeTabId" | "className"
>;

interface SplitContainerProps extends SharedPaneProps {
    workspaceKey: string;
}

const emptyTabs: WorkspacePaneProps["tabs"] = [];

function SplitContainer({ workspaceKey, ...sharedProps }: SplitContainerProps) {
    const split = useUIStore((s) => s.splitByWorkspace[workspaceKey]);
    const setSplitRatio = useUIStore((s) => s.setSplitRatio);
    const setActivePane = useUIStore((s) => s.setActivePane);
    const containerRef = useRef<HTMLDivElement>(null);

    const leftTabs = useSessionStore(
        (s) => s.tabsByWorkspace[workspaceKey] ?? emptyTabs,
    );
    const leftActiveTabId = useSessionStore(
        (s) => s.activeTabByWorkspace[workspaceKey] ?? "",
    );

    const rightKey = `${workspaceKey}:right`;
    const rightTabs = useSessionStore(
        (s) => s.tabsByWorkspace[rightKey] ?? emptyTabs,
    );
    const rightActiveTabId = useSessionStore(
        (s) => s.activeTabByWorkspace[rightKey] ?? "",
    );

    const handleSetActivePane = useCallback(
        (pane: PaneId) => {
            setActivePane(workspaceKey, pane);
        },
        [workspaceKey, setActivePane],
    );

    const handleResize = useCallback(
        (delta: number) => {
            const container = containerRef.current;
            if (!container) return;
            const containerWidth = container.getBoundingClientRect().width;
            if (containerWidth === 0) return;
            const currentRatio = split?.ratio ?? 0.5;
            const newRatio = currentRatio + delta / containerWidth;
            setSplitRatio(workspaceKey, newRatio);
        },
        [workspaceKey, split?.ratio, setSplitRatio],
    );

    const isOpen = split?.open === true;
    const activePane = split?.activePane ?? "left";
    const ratio = split?.ratio ?? 0.5;

    return (
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-row">
            <WorkspacePane
                workspaceKey={workspaceKey}
                paneId="left"
                isFocused={!isOpen || activePane === "left"}
                onFocus={() => handleSetActivePane("left")}
                tabs={leftTabs}
                activeTabId={leftActiveTabId}
                style={isOpen ? { flex: `0 0 ${ratio * 100}%` } : undefined}
                {...sharedProps}
            />
            {isOpen && (
                <>
                    <ResizeHandle
                        onResize={handleResize}
                        panelGap={1}
                        orientation="vertical"
                        align="center"
                    />
                    <WorkspacePane
                        workspaceKey={rightKey}
                        paneId="right"
                        isFocused={activePane === "right"}
                        onFocus={() => handleSetActivePane("right")}
                        tabs={rightTabs}
                        activeTabId={rightActiveTabId}
                        {...sharedProps}
                    />
                </>
            )}
        </div>
    );
}

export { SplitContainer };
```

Note: The `WorkspacePane` needs a `style` prop for the left pane's flex basis. We'll add that in the next step.

- [ ] **Step 2: Add style prop to WorkspacePane**

In `packages/ui/src/components/workspace/WorkspacePane.tsx`, add `style?: React.CSSProperties` to the `WorkspacePaneProps` interface and apply it to the outer div:

Add to interface:
```typescript
style?: React.CSSProperties;
```

Add to the destructured props and update the outer div:
```typescript
<div
    className={cn("flex min-w-0 flex-1 flex-col", className)}
    style={style}
    onPointerDown={onFocus}
>
```

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/WorkspacePane.tsx
git commit -m "feat: create SplitContainer component"
```

---

### Task 8: Add split toggle button to TaskHeader

**Files:**
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

- [ ] **Step 1: Add split toggle button**

Import the icon and store hooks at the top of `TaskHeader.tsx`:

```typescript
import { Columns2 } from "lucide-react";
```

Add the split state hooks inside the `TaskHeader` component function, after the existing hook calls:

```typescript
const splitOpen = useUIStore((s) =>
    task
        ? s.splitByWorkspace[`task:${task.id}`]?.open
        : project
          ? s.splitByWorkspace[`project:${project.id}`]?.open
          : false,
);
const toggleSplit = useUIStore((s) => s.toggleSplit);
const mergeSplitTabs = useSessionStore((s) => s.mergeSplitTabs);
```

Add the import for useSessionStore if not already present (it is not — add it):

```typescript
import { useSessionStore } from "@/stores/session-store";
```

Add a `handleToggleSplit` callback:

```typescript
const handleToggleSplit = useCallback(() => {
    const workspaceKey = task
        ? `task:${task.id}`
        : project
          ? `project:${project.id}`
          : null;
    if (!workspaceKey) return;
    // If closing, merge right-pane tabs first
    if (splitOpen) {
        mergeSplitTabs(workspaceKey);
    }
    toggleSplit(workspaceKey);
}, [task, project, splitOpen, mergeSplitTabs, toggleSplit]);
```

Add the `TaskHeaderProps` interface update — add `onDiff` already exists but we need to add a prop for the workspace key. Actually, we don't need a new prop — we compute the workspace key from task/project directly.

Add the split toggle button in the JSX, right before the task info toggle button (before the `<Button variant={taskInfoOpen ? ...>` block at line ~470). Find the existing task info button and place the split button before it:

```tsx
<Button
    variant={splitOpen ? "secondary" : "ghost"}
    size="icon-xs"
    onClick={handleToggleSplit}
    aria-pressed={!!splitOpen}
    aria-label={splitOpen ? "Close split view" : "Split view"}
    tooltip={splitOpen ? "Close split view" : "Split view"}
    tooltipSide="bottom"
    className="[-webkit-app-region:no-drag]">
    <Columns2 className="h-4 w-4" />
</Button>
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat: add split toggle button to TaskHeader"
```

---

### Task 9: Refactor Workspace to use SplitContainer

Replace the inline TabBar + TabContent in the main `Workspace.tsx` with `SplitContainer`.

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Replace TabBar + TabContent with SplitContainer**

Import `SplitContainer` and remove direct `TabBar`/`TabContent` imports:

Remove these imports:
```typescript
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
```

Add this import:
```typescript
import { SplitContainer } from "./SplitContainer";
```

In the non-master `return` block (the one starting with `<TaskHeader>`), replace the `<TabBar ... /><TabContent ... />` block (lines ~426-510) with:

```tsx
<SplitContainer
    workspaceKey={workspace.workspaceKey}
    projectPath={workspace.workingDir}
    onNewTab={handleNewTab}
    onRunTab={handleRunTab}
    onRunScript={handleRunScript}
    onRunAction={handleRunAction}
    onRunAgentCommand={handleRunAgentCommand}
    onStartFlow={handleStartFlow}
    onManageFlows={toggleFlowManagement}
    scripts={scripts}
    defaultRuntime={defaultRuntime}
    flows={flowRunsReady ? flowDefinitions : []}
    standaloneActions={standaloneActions}
    agentCommands={agentCommands}
    activeFlowRun={activeFlowRun ?? null}
    showRunButton={
        workspace.scope === "task" ||
        hasScripts ||
        standaloneActions.length > 0 ||
        agentCommands.length > 0 ||
        (flowRunsReady && flowDefinitions.length > 0)
    }
    showAgentOptions={workspace.scope === "task"}
    allowSessionTabs={true}
    isElectron={isElectron}
/>
```

For the master workspace `return` block (lines ~290-344), also replace with `SplitContainer`:

```tsx
return (
    <>
        <SplitContainer
            workspaceKey={workspace.workspaceKey}
            projectPath={workspace.workingDir}
            onNewTab={handleNewTab}
            onRunTab={() => {}}
            onRunScript={() => {}}
            onRunAction={handleRunAction}
            onRunAgentCommand={handleRunAgentCommand}
            onStartFlow={handleStartFlow}
            onManageFlows={toggleFlowManagement}
            scripts={{}}
            defaultRuntime={defaultRuntime}
            flows={flowRunsReady ? flowDefinitions : []}
            standaloneActions={standaloneActions}
            agentCommands={agentCommands}
            activeFlowRun={activeFlowRun ?? null}
            showRunButton={
                agentCommands.length > 0 ||
                standaloneActions.length > 0 ||
                (flowRunsReady && flowDefinitions.length > 0)
            }
            showAgentOptions={false}
            allowSessionTabs={true}
            isElectron={isElectron}
        />
    </>
);
```

Note: The master workspace previously had `className` on TabBar for electron drag region — this is now handled inside `WorkspacePane`.

The `useSessionSync` hook still runs in Workspace and its results (`visibleTabs`, `activeTab`, etc.) are no longer needed for direct rendering — but they're still needed for keyboard shortcuts and tab ops. However, the tabs/activeTab are now consumed via store selectors inside `SplitContainer`/`WorkspacePane`. We can remove the `visibleTabs` and `activeTab` destructuring if they're no longer used directly in Workspace.tsx. Check: `handleDiffTab` uses `visibleTabs` to find existing changes tab, and keyboard shortcuts use `activeTab`.

Actually, `handleDiffTab` searches `visibleTabs` for an existing changes tab. This needs to also check the right pane. Update `handleDiffTab`:

```typescript
const handleDiffTab = () => {
    if (!workspace.workspaceKey) return;
    const store = useSessionStore.getState();
    const allTabs = [
        ...(store.tabsByWorkspace[workspace.workspaceKey] ?? []),
        ...(store.tabsByWorkspace[`${workspace.workspaceKey}:right`] ?? []),
    ];
    const existingChangesTab = allTabs.find((tab) => tab.type === "changes");
    if (existingChangesTab) {
        // Find which pane it's in and activate there
        const rightKey = `${workspace.workspaceKey}:right`;
        const rightTabs = store.tabsByWorkspace[rightKey] ?? [];
        if (rightTabs.some((t) => t.id === existingChangesTab.id)) {
            useSessionStore.getState().setActiveTab(rightKey, existingChangesTab.id);
        } else {
            useSessionStore.getState().setActiveTab(workspace.workspaceKey, existingChangesTab.id);
        }
        return;
    }
    // Add to the focused pane
    const split = useUIStore.getState().splitByWorkspace[workspace.workspaceKey];
    const targetKey = split?.open && split.activePane === "right"
        ? `${workspace.workspaceKey}:right`
        : workspace.workspaceKey;
    useSessionStore.getState().addTab(targetKey, {
        id: crypto.randomUUID(),
        type: "changes",
        label: "Changes",
    });
};
```

Remove the direct import of `addTab` and `setActiveTab` from the top-level store selectors since `handleDiffTab` now uses `getState()` directly. Actually, `setActiveTab` is still used by keyboard shortcuts — keep it but check carefully.

Actually, the simpler approach: keep `useSessionSync` as-is (it works on the base workspace key — the left pane). The `activeTab` from `useSessionSync` represents the left pane's active tab, which is fine for keyboard shortcuts (they operate on the focused pane anyway). We'll update keyboard shortcuts in a separate task.

- [ ] **Step 2: Clean up unused imports**

Remove imports that are no longer directly used in Workspace.tsx after the refactor. The `TabBar` and `TabContent` imports were removed above. Also check if `isEditorDirty`, `clearEditorDirty`, `isSessionExited` are still used — they've moved to `WorkspacePane`, so remove them from Workspace.tsx:

```typescript
// Remove these imports:
import { isEditorDirty, clearEditorDirty } from "@/components/panes/editor-dirty-state";
```

Keep `destroyTerminal` if it's still used in the master block. Actually, with SplitContainer, tab close is now handled inside WorkspacePane, so remove `destroyTerminal` import too if no longer referenced.

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: refactor Workspace to use SplitContainer"
```

---

### Task 10: Cross-pane tab drag-and-drop

Lift the `DndContext` from `TabBar` up to `SplitContainer` so tabs can be dragged between panes.

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`
- Modify: `packages/ui/src/components/workspace/SplitContainer.tsx`

- [ ] **Step 1: Make DndContext optional in TabBar**

The `TabBar` currently owns a `DndContext`. When used inside a split, the parent `SplitContainer` provides the `DndContext`. Add an optional prop to TabBar to skip its own DndContext:

In `TabBar.tsx`, add to `TabBarProps`:

```typescript
externalDnd?: boolean;
```

In the `TabBar` component, conditionally wrap:

Replace the current `<DndContext>` block with:

```tsx
const sortableContent = (
    <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto [-webkit-app-region:no-drag]"
            style={{ scrollbarWidth: "none" }}>
            {tabs.map((tab, index) => (
                <TabItem
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    index={index}
                    cmdHeld={showBadges}
                    projectPath={projectPath}
                    onTabClick={onTabClick}
                    onTabClose={onTabClose}
                    onTabRename={onTabRename}
                />
            ))}
        </div>
    </SortableContext>
);

// ... in the JSX return:
{externalDnd ? (
    sortableContent
) : (
    <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}>
        {sortableContent}
    </DndContext>
)}
```

- [ ] **Step 2: Add DndContext to SplitContainer**

In `SplitContainer.tsx`, add the necessary dnd imports:

```typescript
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
```

Add sensors and drag handler inside the component:

```typescript
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const activeId = String(active.id);
        const overId = String(over.id);

        // Determine which pane each tab belongs to
        const leftTabs = useSessionStore.getState().tabsByWorkspace[workspaceKey] ?? [];
        const rKey = `${workspaceKey}:right`;
        const rTabs = useSessionStore.getState().tabsByWorkspace[rKey] ?? [];

        const activeInLeft = leftTabs.some((t) => t.id === activeId);
        const overInLeft = leftTabs.some((t) => t.id === overId);
        const activeInRight = rTabs.some((t) => t.id === activeId);
        const overInRight = rTabs.some((t) => t.id === overId);

        const sourceKey = activeInLeft ? workspaceKey : activeInRight ? rKey : null;
        const targetKey = overInLeft ? workspaceKey : overInRight ? rKey : null;

        if (!sourceKey || !targetKey) return;

        if (sourceKey === targetKey) {
            // Same pane: reorder
            useSessionStore.getState().reorderTabs(sourceKey, activeId, overId);
        } else {
            // Cross-pane: move tab
            const targetTabs = useSessionStore.getState().tabsByWorkspace[targetKey] ?? [];
            const insertIndex = targetTabs.findIndex((t) => t.id === overId);
            useSessionStore.getState().moveTabToPane(sourceKey, targetKey, activeId, insertIndex);
            // Set focus to the target pane
            const targetPane: PaneId = targetKey.endsWith(":right") ? "right" : "left";
            setActivePane(workspaceKey, targetPane);
        }
    },
    [workspaceKey, setActivePane],
);
```

Wrap the panes with `DndContext` when split is open. Update the return JSX:

```tsx
const content = (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-row">
        <WorkspacePane
            workspaceKey={workspaceKey}
            paneId="left"
            isFocused={!isOpen || activePane === "left"}
            onFocus={() => handleSetActivePane("left")}
            tabs={leftTabs}
            activeTabId={leftActiveTabId}
            style={isOpen ? { flex: `0 0 ${ratio * 100}%` } : undefined}
            externalDnd={isOpen}
            {...sharedProps}
        />
        {isOpen && (
            <>
                <ResizeHandle
                    onResize={handleResize}
                    panelGap={1}
                    orientation="vertical"
                    align="center"
                />
                <WorkspacePane
                    workspaceKey={rightKey}
                    paneId="right"
                    isFocused={activePane === "right"}
                    onFocus={() => handleSetActivePane("right")}
                    tabs={rightTabs}
                    activeTabId={rightActiveTabId}
                    externalDnd
                    {...sharedProps}
                />
            </>
        )}
    </div>
);

if (isOpen) {
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}>
            {content}
        </DndContext>
    );
}

return content;
```

Also pass `externalDnd` through `WorkspacePane` — add to its props interface and pass to `TabBar`:

In `WorkspacePane.tsx`, add to props:
```typescript
externalDnd?: boolean;
```

And pass to TabBar:
```tsx
<TabBar
    externalDnd={externalDnd}
    ...
/>
```

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/WorkspacePane.tsx
git commit -m "feat: cross-pane tab drag-and-drop"
```

---

### Task 11: Wire up handleNewTab to target focused pane

Currently `handleNewTab` in `Workspace.tsx` calls `addTab(workspace.workspaceKey, ...)` and `createSession(...)` which adds to the base workspace key. When the split is open, new tabs should go to the focused pane.

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Create a helper to get the focused pane's workspace key**

Add a helper inside `Workspace.tsx` (or as a local function):

```typescript
function getFocusedWorkspaceKey(baseKey: string): string {
    const split = useUIStore.getState().splitByWorkspace[baseKey];
    if (split?.open && split.activePane === "right") {
        return `${baseKey}:right`;
    }
    return baseKey;
}
```

- [ ] **Step 2: Update handleNewTab to use focused pane key**

In `handleNewTab`, replace `workspace.workspaceKey` with the focused key for `addTab` calls. The `createSession` call adds to the base workspace key via the owner-based logic — this is handled by the session store's `addTab` internally. We need to intercept and redirect.

Actually, `createSession` computes the workspace key internally from the owner and calls `addTab`. We can't easily change that. Instead, after `createSession` returns, we can move the newly created tab to the right pane if that's focused.

A simpler approach: for non-session tabs (like browser), use the focused key directly. For session tabs, `createSession` will add to the base key, then we immediately move it if the right pane is focused:

```typescript
const handleNewTab = async (
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "browser" | "shell",
    shellPath?: string,
    agentOptions?: AgentLaunchOptions,
    skipCursorRulesCheck?: boolean,
) => {
    if (!workspace.workspaceKey) return;
    // ... cursor rules check remains unchanged ...

    const focusedKey = getFocusedWorkspaceKey(workspace.workspaceKey);

    if (type === "browser") {
        setFocusedPanel("workspace");
        addTab(focusedKey, {
            id: crypto.randomUUID(),
            type: "browser",
            label: "New Tab",
            url: "about:blank",
        });
    } else if (type === "shell" && shellPath) {
        setFocusedPanel("workspace");
        const sessionId = await createSession(
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const },
            "shell",
            getShellSessionLabel(shellPath),
            undefined,
            shellPath,
        );
        // Move to right pane if that's focused
        if (focusedKey !== workspace.workspaceKey) {
            useSessionStore.getState().moveTabToPane(
                workspace.workspaceKey,
                focusedKey,
                sessionId,
            );
        }
    } else {
        setFocusedPanel("workspace");
        const sessionId = await createSession(
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const },
            type,
            undefined,
            undefined,
            undefined,
            agentOptions,
        );
        if (focusedKey !== workspace.workspaceKey) {
            useSessionStore.getState().moveTabToPane(
                workspace.workspaceKey,
                focusedKey,
                sessionId,
            );
        }
    }
};
```

Apply the same pattern to `handleRunTab`, `handleRunAgentCommand`, `handleRunAction`, `handleRunScript`.

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: new tabs target focused split pane"
```

---

### Task 12: Update keyboard shortcuts for split panes

The `Cmd+1-9` tab switching in `useWorkspaceKeyboardShortcuts` currently uses the base workspace key. It should use the focused pane's key.

**Files:**
- Modify: `packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts`

- [ ] **Step 1: Update tab switching shortcut**

In the `Cmd+1-9` handler section, replace the current logic:

```typescript
if (!e.shiftKey && !e.altKey) {
    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= 9) {
        const state = useUIStore.getState();
        if (
            state.focusedPanel === "workspace" &&
            !state.navigationMode &&
            workspaceKey
        ) {
            e.preventDefault();
            const split = state.splitByWorkspace[workspaceKey];
            const targetKey =
                split?.open && split.activePane === "right"
                    ? `${workspaceKey}:right`
                    : workspaceKey;
            const tabs = useSessionStore.getState().tabsByWorkspace[targetKey];
            if (tabs && digit <= tabs.length) {
                useSessionStore
                    .getState()
                    .setActiveTab(targetKey, tabs[digit - 1].id);
            }
        }
    }
}
```

- [ ] **Step 2: Update Cmd+W (close active tab) for focused pane**

The `handleCloseActiveTab` in `useWorkspaceTabOps` needs to know which pane is focused. Update `useWorkspaceTabOps.ts`:

In `useWorkspaceTabOps.ts`, update `handleCloseActiveTab`:

```typescript
const handleCloseActiveTab = useCallback(() => {
    if (!workspace.workspaceKey) {
        if (workspace.scope === "task") setActiveTask(null);
        else if (workspace.scope === "project") setActiveProject(null);
        return;
    }

    const split = useUIStore.getState().splitByWorkspace[workspace.workspaceKey];
    const targetKey =
        split?.open && split.activePane === "right"
            ? `${workspace.workspaceKey}:right`
            : workspace.workspaceKey;
    const targetActiveTab = useSessionStore.getState().getActiveTab(targetKey);

    if (targetActiveTab) {
        if (targetActiveTab.sessionId) destroyTerminal(targetActiveTab.sessionId);
        void closeTab(targetKey, targetActiveTab.id);
    } else if (workspace.scope === "task") {
        setActiveTask(null);
    } else if (workspace.scope === "project") {
        setActiveProject(null);
    }
}, [workspace.workspaceKey, workspace.scope, closeTab, setActiveTask, setActiveProject]);
```

- [ ] **Step 3: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts packages/ui/src/components/workspace/hooks/useWorkspaceTabOps.ts
git commit -m "feat: keyboard shortcuts respect focused split pane"
```

---

### Task 13: Update session subscriptions for split panes

When a task is activated and has an attention tab in the right pane, the subscription should switch to it.

**Files:**
- Modify: `packages/ui/src/stores/session-subscriptions.ts`

- [ ] **Step 1: Update attention tab switching for split panes**

In the `_unsubActiveTask` subscription handler, update to check both panes:

Replace the task activation block:

```typescript
if (state.activeTaskId) {
    const workspaceKey = getTaskWorkspaceKey(state.activeTaskId);
    for (const key of [workspaceKey, `${workspaceKey}:right`]) {
        const tabs = sessionStore.tabsByWorkspace[key] ?? [];
        const attentionTab = tabs.find(
            (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
        );
        if (attentionTab) {
            sessionStore.setActiveTab(key, attentionTab.id);
        }
    }
    return;
}
```

Apply the same pattern to the project deactivation block and the `_unsubActiveProject` handler:

```typescript
// In deactivation block:
if (activeProjectId) {
    const workspaceKey = getProjectWorkspaceKey(activeProjectId);
    for (const key of [workspaceKey, `${workspaceKey}:right`]) {
        const tabs = sessionStore.tabsByWorkspace[key] ?? [];
        const attentionTab = tabs.find(
            (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
        );
        if (attentionTab) {
            sessionStore.setActiveTab(key, attentionTab.id);
        }
    }
}
```

```typescript
// In _unsubActiveProject:
const workspaceKey = getProjectWorkspaceKey(state.activeProjectId);
for (const key of [workspaceKey, `${workspaceKey}:right`]) {
    const tabs = sessionStore.tabsByWorkspace[key] ?? [];
    const attentionTab = tabs.find(
        (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
    );
    if (attentionTab) {
        sessionStore.setActiveTab(key, attentionTab.id);
    }
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/session-subscriptions.ts
git commit -m "feat: session subscriptions check both split panes"
```

---

### Task 14: Handle drop on empty pane content area

When a tab is dragged to an empty pane's content area (not its tab bar), the tab should move there. The `TabContent` component needs to be a drop target.

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx`

- [ ] **Step 1: Make the empty state a droppable area**

Import `useDroppable` from `@dnd-kit/core`:

```typescript
import { useDroppable } from "@dnd-kit/core";
```

In the `TabContent` component, add a droppable for the empty state. Add a `workspaceKey` prop:

Update the interface:
```typescript
interface TabContentProps {
    tabs: Tab[];
    activeTabId: string;
    workspaceKey?: string;
}
```

Update the function signature:
```typescript
function TabContent({ tabs, activeTabId, workspaceKey }: TabContentProps) {
```

Add droppable:
```typescript
const { setNodeRef: setDropRef } = useDroppable({
    id: workspaceKey ? `pane-drop:${workspaceKey}` : "pane-drop",
});
```

Update the empty state to use the droppable ref:
```typescript
if (tabs.length === 0) {
    return (
        <div ref={setDropRef} className="flex flex-1 overflow-hidden rounded-md">
            <div className="text-muted-foreground flex flex-1 items-center justify-center">
                No active tab. Create a session with + or drag a tab here
            </div>
        </div>
    );
}
```

Also wrap the main content area with the droppable ref so drops on the content area work even when there are tabs:

```typescript
return (
    <div ref={setDropRef} className="relative flex flex-1 overflow-hidden rounded-md">
        {/* ... existing tab rendering ... */}
    </div>
);
```

- [ ] **Step 2: Update SplitContainer drag handler to handle pane drops**

In `SplitContainer.tsx`, update `handleDragEnd` to handle drops on the pane content area:

```typescript
const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = String(active.id);
        const overId = String(over.id);

        // Handle drop on pane content area
        if (overId.startsWith("pane-drop:")) {
            const targetKey = overId.slice("pane-drop:".length);
            const store = useSessionStore.getState();
            const leftTabs = store.tabsByWorkspace[workspaceKey] ?? [];
            const rKey = `${workspaceKey}:right`;
            const rTabs = store.tabsByWorkspace[rKey] ?? [];

            const sourceKey = leftTabs.some((t) => t.id === activeId)
                ? workspaceKey
                : rTabs.some((t) => t.id === activeId)
                  ? rKey
                  : null;

            if (sourceKey && sourceKey !== targetKey) {
                store.moveTabToPane(sourceKey, targetKey, activeId);
                const targetPane: PaneId = targetKey.endsWith(":right") ? "right" : "left";
                setActivePane(workspaceKey, targetPane);
            }
            return;
        }

        if (activeId === overId) return;

        // ... rest of the existing logic for tab-to-tab drops ...
    },
    [workspaceKey, setActivePane],
);
```

- [ ] **Step 3: Pass workspaceKey to TabContent in WorkspacePane**

In `WorkspacePane.tsx`, pass the workspace key:

```tsx
<TabContent tabs={tabs} activeTabId={activeTabId} workspaceKey={workspaceKey} />
```

- [ ] **Step 4: Verify compiles**

Run: `cd packages/ui && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/workspace/SplitContainer.tsx packages/ui/src/components/workspace/WorkspacePane.tsx
git commit -m "feat: support dropping tabs on empty pane content area"
```

---

### Task 15: Final integration test and polish

**Files:**
- All modified files

- [ ] **Step 1: Full type check**

Run: `cd packages/ui && bunx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 2: Lint check**

Run: `cd packages/ui && bun run lint 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Build check**

Run: `bun run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: address lint and type issues in split view"
```

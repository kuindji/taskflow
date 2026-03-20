# Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add context-sensitive keyboard navigation across panels, tabs, tasks, and projects using `Cmd` modifier shortcuts with visual key-badge indicators.

**Architecture:** A `focusedPanel` state in the UI store determines how `Cmd+<n>` and `Cmd+Arrow` shortcuts behave. A new `useKeyboardNavigation` hook centralizes all keyboard handling. Visual key-badge indicators appear on navigable items while `Cmd` is held. Electron menu accelerators handle `Cmd+Shift+Left/Right` for panel focus cycling.

**Tech Stack:** React, Zustand, Electron IPC, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-20-keyboard-navigation-design.md`

---

### Task 1: Add Focus State to UI Store

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add focusedPanel and sidebarFocusedItem to UIStore interface**

In `packages/ui/src/stores/ui-store.ts`, add to the `UIStore` interface (after line 36 `appearanceOpen`):

```typescript
focusedPanel: 'sidebar' | 'workspace' | 'taskinfo';
sidebarFocusedItem: { type: 'project' | 'task'; id: string } | null;
setFocusedPanel(panel: 'sidebar' | 'workspace' | 'taskinfo'): void;
setSidebarFocusedItem(item: { type: 'project' | 'task'; id: string } | null): void;
```

- [ ] **Step 2: Add state initialization and setters**

Add initial values after line 74 (`appearanceOpen: false`):

```typescript
focusedPanel: 'workspace' as const,
sidebarFocusedItem: null,
```

Add setter methods after `toggleAppearance()` (line 101):

```typescript
setFocusedPanel(panel) {
    set({ focusedPanel: panel });
},
setSidebarFocusedItem(item) {
    set({ sidebarFocusedItem: item });
},
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No type errors related to ui-store

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add focusedPanel and sidebarFocusedItem state to UI store"
```

---

### Task 2: Create KeyBadge Component

**Files:**
- Create: `packages/ui/src/components/ui/key-badge.tsx`

- [ ] **Step 1: Create the KeyBadge component**

Create `packages/ui/src/components/ui/key-badge.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface KeyBadgeProps {
    number: number;
    className?: string;
}

function KeyBadge({ number, className }: KeyBadgeProps) {
    return (
        <span
            className={cn(
                "flex h-[18px] min-w-[18px] items-center justify-center rounded px-1",
                "border border-[#4a4a5e] border-b-2 bg-[#2a2a3e]",
                "text-[10px] font-semibold leading-none text-foreground",
                className,
            )}>
            {number}
        </span>
    );
}

export { KeyBadge };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ui/key-badge.tsx
git commit -m "feat: add KeyBadge component for keyboard navigation indicators"
```

---

### Task 3: Add Key Badges to TabBar

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`

- [ ] **Step 1: Add cmdHeld prop and key badge to TabItem**

In `packages/ui/src/components/workspace/TabBar.tsx`:

Add to `TabItemProps` interface (line 88):

```typescript
interface TabItemProps {
    tab: Tab;
    isActive: boolean;
    index: number;
    cmdHeld: boolean;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
}
```

Update the TabItem function signature (line 96) and replace the close button section (lines 164-174). When `cmdHeld` is true and `index < 9`, show KeyBadge instead of close button:

```tsx
{cmdHeld && index < 9 ? (
    <div className="ml-0.5">
        <KeyBadge number={index + 1} />
    </div>
) : (
    <Button
        variant="ghost"
        size="icon-sm"
        className="ml-0.5 h-4 w-4 p-0"
        aria-label="Close tab"
        onClick={(e) => {
            e.stopPropagation();
            onTabClose(tab.id);
        }}>
        <X className="size-3" />
    </Button>
)}
```

Import `KeyBadge` at the top of the file.

- [ ] **Step 2: Add useCmdHeld hook and use it in TabBar**

First, create a shared hook `packages/ui/src/hooks/useCmdHeld.ts`:

```typescript
import { useState, useEffect } from "react";

export function useCmdHeld() {
    const [cmdHeld, setCmdHeld] = useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Meta") setCmdHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Meta") setCmdHeld(false);
        };
        const onBlur = () => setCmdHeld(false);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    return cmdHeld;
}
```

Then in TabBar, use the shared hook and read `focusedPanel` — only show badges when workspace is focused:

```typescript
import { useCmdHeld } from "@/hooks/useCmdHeld";

const cmdHeld = useCmdHeld();
const focusedPanel = useUIStore((s) => s.focusedPanel);
const showBadges = cmdHeld && focusedPanel === 'workspace';
```

Update the tab rendering loop from `tabs.map((tab) =>` to `tabs.map((tab, index) =>` and pass both new props:

```tsx
<TabItem key={tab.id} tab={tab} isActive={...} index={index} cmdHeld={showBadges} onTabClick={...} onTabClose={...} onTabRename={...} />
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: show key badges on tabs when Cmd is held"
```

---

### Task 4: Add Key Badges to ProjectGroup

**Files:**
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx`

- [ ] **Step 1: Add keyBadgeNumber prop to ProjectGroup**

Add a `keyBadgeNumber` prop to the ProjectGroup component's props. When provided and `> 0`, show `KeyBadge` in place of the right-side `ArrowRight` icon (line 215).

Replace the right-side area (lines 205-217):

```tsx
<div className="relative mr-1.5 flex shrink-0 items-center">
    {!locationInvalid && diffStats && (
        <Badge
            variant="outline"
            className="border-border/60 bg-muted/50 gap-0.5 px-1.5 py-0 text-[10px] font-medium transition-opacity group-hover:opacity-0">
            <span className="text-success">+{diffStats.additions}</span>
            <span className="text-destructive">-{diffStats.deletions}</span>
        </Badge>
    )}
    {keyBadgeNumber != null ? (
        <KeyBadge number={keyBadgeNumber} />
    ) : (
        !locationInvalid && (
            <ArrowRight className="text-accent absolute right-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        )
    )}
</div>
```

Import `KeyBadge` at the top of the file.

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/ProjectGroup.tsx
git commit -m "feat: show key badge on project groups when Cmd is held"
```

---

### Task 5: Add Key Badges to TaskCard

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx`

- [ ] **Step 1: Add keyBadgeNumber prop to TaskCard**

Add `keyBadgeNumber?: number` to the TaskCard props. When provided, render a `KeyBadge` in the top-right corner of the card (after line 154, inside the main div):

```tsx
{keyBadgeNumber != null && (
    <div className="absolute right-2 top-2">
        <KeyBadge number={keyBadgeNumber} />
    </div>
)}
```

Import `KeyBadge` at the top of the file.

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: show key badge on task cards when Cmd is held"
```

---

### Task 6: Wire Key Badges in TaskSidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx`

- [ ] **Step 1: Add cmdHeld state and badge logic to TaskSidebar**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, add:

1. Use the shared `useCmdHeld()` hook from `@/hooks/useCmdHeld` (created in Task 3)
2. Read `focusedPanel` and `sidebarFocusedItem` from ui store
3. Compute `showBadges = cmdHeld && focusedPanel === 'sidebar'`

When rendering projects (lines 293-315), pass `keyBadgeNumber` to `ProjectGroup`:
- If `sidebarFocusedItem?.type === 'project'` and `showBadges`: pass `index + 1` (1-indexed, max 9)
- Otherwise: pass `undefined`

When rendering tasks inside `ProjectGroup`, pass `keyBadgeNumber` to `TaskCard`:
- If `sidebarFocusedItem?.type === 'task'` and the task belongs to the same project as `sidebarFocusedItem` and `showBadges`: pass the task's index within the project (1-indexed, max 9)
- Otherwise: pass `undefined`

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: wire key badge numbers to sidebar projects and tasks"
```

---

### Task 7: Create useKeyboardNavigation Hook

**Files:**
- Create: `packages/ui/src/hooks/useKeyboardNavigation.ts`

This is the core logic. Creates a single `keydown` event listener that handles all navigation shortcuts.

- [ ] **Step 1: Create the hook file**

Create `packages/ui/src/hooks/useKeyboardNavigation.ts`:

```typescript
import { useEffect, useCallback } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
```

The hook needs access to these store values:
- `focusedPanel`, `setFocusedPanel`, `sidebarFocusedItem`, `setSidebarFocusedItem` from UIStore
- `activeProjectId`, `setActiveProject`, `collapsedProjectIds`, `setProjectCollapsed` from UIStore
- `taskInfoOpen`, `fileExplorerOpen` from UIStore
- `tabsByWorkspace`, `activeTabByWorkspace`, `setActiveTab` from SessionStore
- `tasks`, `activeTaskId`, `setActiveTask` from TaskStore
- `projects` from ProjectStore

Use `useXxxStore.getState()` inside event handlers (not selectors) to avoid stale closures. Only subscribe to `focusedPanel` via selector since it determines which branch of the handler runs.

- [ ] **Step 2: Implement panel focus cycling (Cmd+Shift+Left/Right)**

```typescript
// Determine visible panels in order
const getPanelOrder = (): Array<'sidebar' | 'workspace' | 'taskinfo'> => {
    const panels: Array<'sidebar' | 'workspace' | 'taskinfo'> = ['sidebar', 'workspace'];
    if (useUIStore.getState().taskInfoOpen) panels.push('taskinfo');
    return panels;
};

// Cycle focus
const cycleFocus = (direction: 'left' | 'right') => {
    const panels = getPanelOrder();
    const current = useUIStore.getState().focusedPanel;
    const idx = panels.indexOf(current);
    const next = direction === 'right'
        ? panels[(idx + 1) % panels.length]
        : panels[(idx - 1 + panels.length) % panels.length];
    useUIStore.getState().setFocusedPanel(next);

    // When focusing sidebar, set sidebarFocusedItem based on active task/project
    if (next === 'sidebar') {
        const { activeTaskId } = useTaskStore.getState();
        const { activeProjectId } = useUIStore.getState();
        if (activeTaskId) {
            useUIStore.getState().setSidebarFocusedItem({ type: 'task', id: activeTaskId });
        } else if (activeProjectId) {
            useUIStore.getState().setSidebarFocusedItem({ type: 'project', id: activeProjectId });
        }
    }

    // When focusing taskinfo, focus first input
    if (next === 'taskinfo') {
        requestAnimationFrame(() => {
            const panel = document.querySelector('[data-panel="taskinfo"]');
            const input = panel?.querySelector('input, textarea, select') as HTMLElement | null;
            input?.focus();
        });
    }
};
```

- [ ] **Step 3: Implement Cmd+<n> for workspace (tab switching)**

```typescript
const handleWorkspaceNumber = (n: number) => {
    const state = useSessionStore.getState();
    // Need the current workspace key - get from active task/project
    const { activeTaskId } = useTaskStore.getState();
    const { activeProjectId } = useUIStore.getState();
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : null;
    if (!workspaceKey) return;

    const tabs = state.tabsByWorkspace[workspaceKey];
    if (!tabs || n > tabs.length) return;
    state.setActiveTab(workspaceKey, tabs[n - 1].id);
};
```

Import `getTaskWorkspaceKey` and `getProjectWorkspaceKey` from `@/hooks/useActiveWorkspace`.

- [ ] **Step 4: Implement Cmd+<n> for sidebar (task/project jumping)**

```typescript
const handleSidebarNumber = (n: number) => {
    const { sidebarFocusedItem } = useUIStore.getState();
    if (!sidebarFocusedItem) return;

    if (sidebarFocusedItem.type === 'project') {
        // Jump to nth project
        const { projects } = useProjectStore.getState();
        if (n > projects.length) return;
        const target = projects[n - 1];
        useUIStore.getState().setActiveProject(target.id);
        useTaskStore.getState().setActiveTask(null);
        useUIStore.getState().setSidebarFocusedItem({ type: 'project', id: target.id });
    } else {
        // Jump to nth task within the same project
        const task = useTaskStore.getState().tasks.find(t => t.id === sidebarFocusedItem.id);
        if (!task) return;
        const projectTasks = useTaskStore.getState().tasks.filter(
            t => t.projectId === task.projectId && !t.parentId
        );
        if (n > projectTasks.length) return;
        const target = projectTasks[n - 1];
        useTaskStore.getState().setActiveTask(target.id);
        useUIStore.getState().setActiveProject(target.projectId);
        useUIStore.getState().setSidebarFocusedItem({ type: 'task', id: target.id });
    }
};
```

- [ ] **Step 5: Implement Cmd+Arrow for sidebar navigation**

```typescript
const handleSidebarArrow = (key: string) => {
    const { sidebarFocusedItem, collapsedProjectIds } = useUIStore.getState();
    const { projects } = useProjectStore.getState();
    const { tasks } = useTaskStore.getState();

    if (key === 'ArrowLeft') {
        if (!sidebarFocusedItem) return;
        if (sidebarFocusedItem.type === 'task') {
            // Move focus to parent project
            const task = tasks.find(t => t.id === sidebarFocusedItem.id);
            if (task) {
                useUIStore.getState().setSidebarFocusedItem({ type: 'project', id: task.projectId });
            }
        } else {
            // Collapse project
            useUIStore.getState().setProjectCollapsed(sidebarFocusedItem.id, true);
        }
        return;
    }

    if (key === 'ArrowRight') {
        if (!sidebarFocusedItem || sidebarFocusedItem.type === 'task') return;
        // Expand project
        useUIStore.getState().setProjectCollapsed(sidebarFocusedItem.id, false);
        return;
    }

    // ArrowUp / ArrowDown — build flat list of visible items
    const visibleItems: Array<{ type: 'project' | 'task'; id: string }> = [];
    for (const project of projects) {
        visibleItems.push({ type: 'project', id: project.id });
        if (!collapsedProjectIds.includes(project.id)) {
            const projectTasks = tasks.filter(
                t => t.projectId === project.id && !t.parentId
            );
            for (const task of projectTasks) {
                visibleItems.push({ type: 'task', id: task.id });
            }
        }
    }

    if (!sidebarFocusedItem) {
        // Focus first item
        if (visibleItems.length > 0) {
            const item = visibleItems[0];
            useUIStore.getState().setSidebarFocusedItem(item);
            if (item.type === 'project') {
                useUIStore.getState().setActiveProject(item.id);
                useTaskStore.getState().setActiveTask(null);
            } else {
                const task = tasks.find(t => t.id === item.id);
                useTaskStore.getState().setActiveTask(item.id);
                useUIStore.getState().setActiveProject(task?.projectId ?? null);
            }
        }
        return;
    }

    const currentIdx = visibleItems.findIndex(
        i => i.type === sidebarFocusedItem.type && i.id === sidebarFocusedItem.id
    );
    if (currentIdx === -1) return;

    const nextIdx = key === 'ArrowUp' ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx < 0 || nextIdx >= visibleItems.length) return; // no-op at boundaries

    const nextItem = visibleItems[nextIdx];
    useUIStore.getState().setSidebarFocusedItem(nextItem);

    // Also select the item
    if (nextItem.type === 'project') {
        useUIStore.getState().setActiveProject(nextItem.id);
        useTaskStore.getState().setActiveTask(null);
    } else {
        const task = tasks.find(t => t.id === nextItem.id);
        useTaskStore.getState().setActiveTask(nextItem.id);
        useUIStore.getState().setActiveProject(task?.projectId ?? null);
    }
};
```

- [ ] **Step 6: Assemble the keydown handler**

```typescript
export function useKeyboardNavigation() {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;

            // Cmd+Shift+Left/Right: panel focus cycling
            // Skip if Electron IPC handles this (avoid double-firing)
            if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                if (window.taskflow?.onFocusPanelLeft) return; // handled via Electron IPC
                // Suppress when text input has focus
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
                e.preventDefault();
                cycleFocus(e.key === 'ArrowLeft' ? 'left' : 'right');
                return;
            }

            // Cmd+1..9: context-sensitive number navigation
            const digit = parseInt(e.key, 10);
            if (digit >= 1 && digit <= 9 && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                const { focusedPanel } = useUIStore.getState();
                if (focusedPanel === 'workspace') {
                    handleWorkspaceNumber(digit);
                } else if (focusedPanel === 'sidebar') {
                    handleSidebarNumber(digit);
                }
                return;
            }

            // Cmd+Arrow: sidebar navigation (only when sidebar focused)
            if (useUIStore.getState().focusedPanel === 'sidebar' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                handleSidebarArrow(e.key);
                return;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
```

- [ ] **Step 7: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/hooks/useKeyboardNavigation.ts
git commit -m "feat: add useKeyboardNavigation hook with panel focus and navigation logic"
```

---

### Task 8: Add Panel Focus Outline to AppShell

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`

- [ ] **Step 1: Add focus outline classes and data-panel attributes**

In `packages/ui/src/components/AppShell.tsx`:

1. Read `focusedPanel` from ui store
2. Add a `focusOutline` state with a 1.5s fade timer that resets on `focusedPanel` changes
3. Add `data-panel` attributes to the sidebar div (line 90), workspace div (line 137), and taskinfo div (line 150)
4. Conditionally add an outline class when the panel is focused:

```typescript
const focusedPanel = useUIStore((s) => s.focusedPanel);
const [showOutline, setShowOutline] = useState(false);
const prevPanel = useRef(focusedPanel);

useEffect(() => {
    if (focusedPanel !== prevPanel.current) {
        setShowOutline(true);
        prevPanel.current = focusedPanel;
        const timer = setTimeout(() => setShowOutline(false), 1500);
        return () => clearTimeout(timer);
    }
}, [focusedPanel]);
```

Add to each panel div a conditional outline class:

```typescript
// Sidebar (line 90-97):
className={cn(
    "bg-card border-border/50 flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border shadow-lg shadow-black/20",
    showOutline && focusedPanel === 'sidebar' && "ring-1 ring-accent/50 transition-[box-shadow] duration-500"
)}
data-panel="sidebar"

// Workspace (line 137-139):
className={cn(
    "bg-card border-border/50 flex flex-1 flex-col overflow-hidden rounded-[var(--window-radius)] border shadow-lg shadow-black/20",
    showOutline && focusedPanel === 'workspace' && "ring-1 ring-accent/50 transition-[box-shadow] duration-500"
)}
data-panel="workspace"

// TaskInfo (line 150-154):
className={cn(
    "bg-card border-border/50 flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border shadow-lg shadow-black/20",
    showOutline && focusedPanel === 'taskinfo' && "ring-1 ring-accent/50 transition-[box-shadow] duration-500"
)}
data-panel="taskinfo"
```

- [ ] **Step 2: Add click-to-focus handlers**

Add `onClick` handlers on each panel div to set `focusedPanel`:

```typescript
const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);

// On sidebar div: onClick={() => setFocusedPanel('sidebar')}
// On workspace div: onClick={() => setFocusedPanel('workspace')}
// On taskinfo div: onClick={() => setFocusedPanel('taskinfo')}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx
git commit -m "feat: add panel focus outline and click-to-focus handlers"
```

---

### Task 9: Wire useKeyboardNavigation and Add Electron IPC

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`
- Modify: `electron/src/main.ts`
- Modify: `electron/src/preload.ts`
- Modify: `packages/ui/src/env.d.ts`

- [ ] **Step 1: Call useKeyboardNavigation in Workspace**

In `packages/ui/src/components/workspace/Workspace.tsx`, import and call the hook:

```typescript
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";

// Inside the Workspace component, near the top:
useKeyboardNavigation();
```

- [ ] **Step 2: Add Electron menu accelerators for Cmd+Shift+Left/Right**

In `electron/src/main.ts`, add to the Window submenu (after "Close Tab" entry, line 415):

```typescript
{
    label: "Focus Panel Left",
    accelerator: "CmdOrCtrl+Shift+Left",
    click: () => {
        mainWindow?.webContents.send("focus-panel-left");
    },
},
{
    label: "Focus Panel Right",
    accelerator: "CmdOrCtrl+Shift+Right",
    click: () => {
        mainWindow?.webContents.send("focus-panel-right");
    },
},
```

- [ ] **Step 3: Add preload IPC listeners**

In `electron/src/preload.ts`, add before the closing `});` (before line 114):

```typescript
onFocusPanelLeft: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("focus-panel-left", listener);
    return () => {
        ipcRenderer.removeListener("focus-panel-left", listener);
    };
},
onFocusPanelRight: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("focus-panel-right", listener);
    return () => {
        ipcRenderer.removeListener("focus-panel-right", listener);
    };
},
```

- [ ] **Step 4: Update TaskflowBridge type**

In `packages/ui/src/env.d.ts`, add to the `TaskflowBridge` interface (before line 37):

```typescript
onFocusPanelLeft(callback: () => void): () => void;
onFocusPanelRight(callback: () => void): () => void;
```

- [ ] **Step 5: Handle Electron IPC in useKeyboardNavigation hook**

In `packages/ui/src/hooks/useKeyboardNavigation.ts`, add Electron IPC listener registration alongside the keydown listener:

```typescript
const cleanupFns: Array<() => void> = [];

const onFocusPanelLeft = window.taskflow?.onFocusPanelLeft;
const onFocusPanelRight = window.taskflow?.onFocusPanelRight;

if (onFocusPanelLeft) {
    cleanupFns.push(onFocusPanelLeft(() => cycleFocus('left')));
}
if (onFocusPanelRight) {
    cleanupFns.push(onFocusPanelRight(() => cycleFocus('right')));
}

// ... existing keydown listener ...

return () => {
    window.removeEventListener('keydown', onKeyDown);
    cleanupFns.forEach(fn => fn());
};
```

When Electron IPC handles `Cmd+Shift+Left/Right`, remove those key combos from the `keydown` handler to avoid double-firing (same pattern as existing shortcuts in Workspace.tsx).

- [ ] **Step 6: Verify build**

Run: `cd packages/ui && bun run build --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/hooks/useKeyboardNavigation.ts electron/src/main.ts electron/src/preload.ts packages/ui/src/env.d.ts
git commit -m "feat: wire keyboard navigation hook and add Electron IPC for panel focus"
```

---

### Task 10: Manual Testing and Polish

**Files:**
- Possibly modify any of the above files for fixes

- [ ] **Step 1: Start the app and test panel focus cycling**

Run the app. Test:
- `Cmd+Shift+Right` cycles: sidebar → workspace → taskinfo (if open)
- `Cmd+Shift+Left` cycles in reverse
- Panel outline appears briefly on focus change
- Clicking a panel sets focus to it

- [ ] **Step 2: Test Cmd+<n> tab switching**

With workspace focused:
- `Cmd+1` switches to first tab
- `Cmd+2` switches to second tab
- Key badges appear on tabs while Cmd is held
- Pressing a number beyond tab count does nothing

- [ ] **Step 3: Test Cmd+<n> sidebar navigation**

With sidebar focused:
- When a task is selected, `Cmd+1..N` switches between tasks in the same project
- When a project is selected, `Cmd+1..N` switches between projects
- Key badges appear in correct positions

- [ ] **Step 4: Test Cmd+Arrow sidebar navigation**

With sidebar focused:
- `Cmd+Up/Down` moves through visible items
- Collapsed projects are treated as single items
- `Cmd+Left` on task → focuses parent project
- `Cmd+Left` on project → collapses it
- `Cmd+Right` on project → expands it
- No-op at list boundaries

- [ ] **Step 5: Test conflict avoidance**

- With workspace focused, terminal/editor arrow keys work normally
- `Cmd+Shift+Left/Right` does not trigger when typing in Task Info input fields
- `Cmd+N` (new task), `Cmd+T` (new terminal), `Cmd+W` (close tab) still work

- [ ] **Step 6: Fix any issues found and commit**

```bash
git add -u
git commit -m "fix: polish keyboard navigation based on manual testing"
```

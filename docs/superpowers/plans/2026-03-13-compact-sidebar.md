# Compact Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Compact Sidebar" toggle to the View menu (Cmd+Shift+C) that reduces task cards to title + badges only.

**Architecture:** A `compactSidebar` boolean is added to `PanelSettings`, persisted via the existing settings system. The Electron View menu gets a checkbox menu item that sends IPC to the renderer, which toggles the setting and syncs the checked state back. TaskCard conditionally hides the description and reduces padding.

**Tech Stack:** Electron IPC, Zustand, React, TypeScript

---

## Chunk 1: Full Implementation

### Task 1: Add `compactSidebar` to shared types

**Files:**
- Modify: `packages/shared/src/types/settings.ts:30-34`

- [ ] **Step 1: Add field to PanelSettings**

In `packages/shared/src/types/settings.ts`, add `compactSidebar` to `PanelSettings`:

```typescript
export interface PanelSettings {
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    compactSidebar: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types/settings.ts
git commit -m "feat: add compactSidebar to PanelSettings type"
```

---

### Task 2: Add default value in backend settings store

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts:29`

- [ ] **Step 1: Add default**

In `packages/backend/src/services/settings-store.ts`, update the panels default on line 29:

```typescript
panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220, compactSidebar: false },
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/settings-store.ts
git commit -m "feat: add compactSidebar default to settings store"
```

---

### Task 3: Add Electron preload bridge methods

**Files:**
- Modify: `electron/src/preload.ts:30-33`

- [ ] **Step 1: Add bridge methods**

In `electron/src/preload.ts`, add two new methods after the `sendArchiveState` method (line 33), before the closing `});`:

```typescript
onToggleCompactSidebar: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("toggle-compact-sidebar", listener);
    return () => {
        ipcRenderer.removeListener("toggle-compact-sidebar", listener);
    };
},
sendCompactSidebarState: (compact: boolean) => {
    ipcRenderer.send("compact-sidebar-changed", compact);
},
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/preload.ts
git commit -m "feat: add compact sidebar IPC bridge methods"
```

---

### Task 4: Add TypeScript declarations for bridge methods

**Files:**
- Modify: `packages/ui/src/env.d.ts:11-12`

- [ ] **Step 1: Extend TaskflowBridge**

In `packages/ui/src/env.d.ts`, add after the `sendArchiveState` line (line 12):

```typescript
onToggleCompactSidebar(callback: () => void): () => void;
sendCompactSidebarState(compact: boolean): void;
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/env.d.ts
git commit -m "feat: add compact sidebar bridge type declarations"
```

---

### Task 5: Add Electron View menu item and IPC handler

**Files:**
- Modify: `electron/src/main.ts:278-298` (View menu), `electron/src/main.ts:405-411` (IPC handlers)

- [ ] **Step 1: Add checkbox menu item to View menu**

In `electron/src/main.ts`, in the View menu submenu array (after the existing `toggle-archive` item and its separator), add:

```typescript
{
    id: "compact-sidebar",
    label: "Compact Sidebar",
    type: "checkbox",
    checked: false,
    accelerator: "CmdOrCtrl+Shift+C",
    click: () => {
        mainWindow?.webContents.send("toggle-compact-sidebar");
    },
},
```

Place it after the `toggle-archive` item, before the separator that precedes `reload`.

- [ ] **Step 2: Add IPC listener for state sync**

In `electron/src/main.ts`, after the existing `archive-state-changed` handler (line 411), add:

```typescript
ipcMain.on("compact-sidebar-changed", (_event, compact: boolean) => {
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("compact-sidebar");
    if (item) {
        item.checked = compact;
    }
});
```

- [ ] **Step 3: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat: add Compact Sidebar menu item with Cmd+Shift+C shortcut"
```

---

### Task 6: Wire up settings store to IPC

**Files:**
- Modify: `packages/ui/src/stores/settings-store.ts`

- [ ] **Step 1: Sync initial state on fetch**

In `packages/ui/src/stores/settings-store.ts`, inside `fetchSettings()`, after the `hydrateLayout` call (line 20), add:

```typescript
window.taskflow?.sendCompactSidebarState(settings.layout?.panels?.compactSidebar ?? false);
```

This syncs the persisted compact state to the Electron menu checkbox on startup.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/settings-store.ts
git commit -m "feat: sync compact sidebar state to menu on settings fetch"
```

---

### Task 7: Listen for toggle IPC in TaskSidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:56-63`

- [ ] **Step 1: Add compact sidebar selector and IPC listener**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, add a selector for the current compact value:

```typescript
const compactSidebar = useSettingsStore((s) => s.settings?.layout?.panels?.compactSidebar ?? false);
```

Add a new `useEffect` after the existing `onToggleArchive` effect (after line 63):

```typescript
useEffect(() => {
    const cleanup = window.taskflow?.onToggleCompactSidebar(() => {
        const current = useSettingsStore.getState().settings?.layout?.panels?.compactSidebar ?? false;
        const next = !current;
        void useSettingsStore.getState().updateSettings({ layout: { panels: { compactSidebar: next } } });
        window.taskflow?.sendCompactSidebarState(next);
    });
    return cleanup;
}, []);
```

- [ ] **Step 2: Pass compact prop to ProjectGroup**

In the same file, in the `ProjectGroup` JSX (around line 172), add the `compact` prop:

```tsx
<ProjectGroup
    key={project.id}
    project={project}
    tasks={projectTasks}
    activeTaskId={activeTaskId}
    isActive={!activeTaskId && activeProjectId === project.id}
    diffStats={diffStatsByProject[project.id]}
    onProjectClick={handleProjectClick}
    onTaskClick={handleTaskClick}
    archived={showArchive}
    isFirstVisibleProject={index === 0}
    compact={compactSidebar}
/>
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: wire compact sidebar toggle IPC and pass prop to ProjectGroup"
```

---

### Task 8: Thread `compact` prop through ProjectGroup

**Files:**
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx:10-32,87-95`

- [ ] **Step 1: Add compact to props interface**

In `packages/ui/src/components/sidebar/ProjectGroup.tsx`, add `compact?: boolean;` to `ProjectGroupProps` (after line 18):

```typescript
interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    onProjectClick: (projectId: string) => void;
    onTaskClick: (taskId: string) => void;
    archived?: boolean;
    isFirstVisibleProject?: boolean;
    compact?: boolean;
}
```

- [ ] **Step 2: Destructure and forward**

Add `compact` to the destructured props (line 31), and pass it to each `TaskCard`:

```tsx
<TaskCard
    key={task.id}
    task={task}
    isActive={task.id === activeTaskId}
    onClick={() => onTaskClick(task.id)}
    archived={archived}
    compact={compact}
/>
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/ProjectGroup.tsx
git commit -m "feat: thread compact prop through ProjectGroup to TaskCard"
```

---

### Task 9: Implement compact mode in TaskCard

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx:22-41,104-125`

- [ ] **Step 1: Add compact to props**

In `packages/ui/src/components/sidebar/TaskCard.tsx`, add `compact?: boolean;` to `TaskCardProps`:

```typescript
interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
    task: Task;
    isActive: boolean;
    onClick: () => void;
    className?: string;
    archived?: boolean;
    compact?: boolean;
}
```

Destructure it in the function signature:

```typescript
export function TaskCard({ task, isActive, onClick, className, archived, compact }: TaskCardProps) {
```

- [ ] **Step 2: Apply compact styling**

Update the outer div to conditionally reduce padding:

```tsx
<div onClick={onClick} className={cn(cardClasses, "relative group [-webkit-app-region:no-drag]", compact && "py-1.5")}>
```

Conditionally hide the description row by wrapping the existing description block:

```tsx
{!compact && description && (
    <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
        {description}
    </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: implement compact mode in TaskCard - hide description, reduce padding"
```

---

### Task 10: Verify and test

- [ ] **Step 1: Build the project**

```bash
cd /Users/kuindji/Projects/taskflow && bun run build
```

Verify no TypeScript errors.

- [ ] **Step 2: Manual testing**

Launch the app and verify:
1. View menu shows "Compact Sidebar" checkbox item with Cmd+Shift+C shortcut
2. Toggling it hides descriptions and reduces card height
3. The checkmark state persists after restarting the app
4. Cmd+Shift+C keyboard shortcut works

- [ ] **Step 3: Final commit if any fixes needed**

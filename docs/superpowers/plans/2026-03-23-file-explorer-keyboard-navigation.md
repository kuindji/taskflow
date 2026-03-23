# File Explorer Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyboard navigation to the file explorer tree so users can browse files with arrow keys, Enter, Home/End — without a mouse.

**Architecture:** Tree-walker approach with path-based focus tracking. A pure utility module computes next/previous/parent/first-child from the tree data + expanded state. Focus path and expanded directories live in the file store. The file explorer joins the existing panel focus cycle so Cmd+Shift+Arrow can land on it.

**Tech Stack:** React, Zustand, TypeScript, Tailwind CSS, Radix UI Collapsible

---

### Task 1: Add `expandedDirs` to file store and lift local state

**Files:**
- Modify: `packages/ui/src/stores/file-store.ts`
- Modify: `packages/ui/src/components/panels/FileTree.tsx`

Currently each `FileTree` instance manages its own `open` state via `useState`. This needs to move to a centralized `expandedDirs: Set<string>` in the file store so the tree-walker can compute visible items.

- [ ] **Step 1: Add expandedDirs state and actions to file store**

In `packages/ui/src/stores/file-store.ts`, add to the `FileStore` interface:

```typescript
expandedDirs: Set<string>;
toggleDir(path: string): void;
expandDir(path: string): Promise<void>;
collapseDir(path: string): void;
```

Add initial state:

```typescript
expandedDirs: new Set<string>(),
```

Implement actions:

```typescript
toggleDir(path) {
    const { expandedDirs } = get();
    const next = new Set(expandedDirs);
    if (next.has(path)) {
        next.delete(path);
    } else {
        next.add(path);
    }
    set({ expandedDirs: next });
    // If we just expanded and children aren't loaded, fetch them
    const tree = get().tree;
    if (next.has(path) && tree && !isDirLoaded(tree, path)) {
        void get().fetchDir(path);
    }
},
async expandDir(path) {
    const { expandedDirs } = get();
    if (expandedDirs.has(path)) return;
    const next = new Set(expandedDirs);
    next.add(path);
    set({ expandedDirs: next });
    const tree = get().tree;
    if (tree && !isDirLoaded(tree, path)) {
        await get().fetchDir(path);
    }
},
collapseDir(path) {
    const { expandedDirs } = get();
    if (!expandedDirs.has(path)) return;
    const next = new Set(expandedDirs);
    next.delete(path);
    set({ expandedDirs: next });
},
```

Also reset `expandedDirs` in `clearExplorerState()`:

```typescript
expandedDirs: new Set<string>(),
```

And in `fetchTree`, after setting the root node, auto-expand the root:

```typescript
set({ tree: rootNode, treePath: path, gitignorePatterns, loading: false, expandedDirs: new Set([path]) });
```

- [ ] **Step 2: Update expandToPathAndLoad to use expandedDirs**

In `expandToPathAndLoad`, after loading all ancestor directories, add them to `expandedDirs`:

```typescript
// After loading dirs, expand all ancestors + target
const expandedDirs = new Set(get().expandedDirs);
for (const dir of dirsToLoad) {
    expandedDirs.add(dir);
}
set({ expandToPath: targetPath, expandedDirs });
```

- [ ] **Step 3: Refactor FileTree to use store's expandedDirs instead of local useState**

In `packages/ui/src/components/panels/FileTree.tsx`:

Remove the local `useState` for `open`. Replace with reading from the store:

```typescript
const expandedDirs = useFileStore((s) => s.expandedDirs);
const toggleDir = useFileStore((s) => s.toggleDir);
const open = node.type === "directory" && expandedDirs.has(node.path);
```

Replace `handleOpenChange` with:

```typescript
const handleOpenChange = useCallback(() => {
    toggleDir(node.path);
}, [toggleDir, node.path]);
```

Remove the `useEffect` that watched `expandedPaths` — that latching behavior is now handled by `expandToPathAndLoad` writing to `expandedDirs` directly.

Remove `expandedPaths` from the `FileTreeProps` interface and all call sites.

- [ ] **Step 4: Remove expandedPaths prop from FileExplorer**

In `packages/ui/src/components/panels/FileExplorer.tsx`, remove the `expandedPaths` memo computation and the `expandedPaths` prop from the `<FileTree>` call. The `expandToPath` effect that clears via `setExpandToPath(null)` can also be removed — `expandToPathAndLoad` now writes directly to `expandedDirs`.

- [ ] **Step 5: Verify expand/collapse still works**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-keyboard-navigation-to-file-explorer && bun run build:ui`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/file-store.ts packages/ui/src/components/panels/FileTree.tsx packages/ui/src/components/panels/FileExplorer.tsx
git commit -m "refactor: lift expanded-folder state from FileTree local state into file store"
```

---

### Task 2: Add focusedPath to file store

**Files:**
- Modify: `packages/ui/src/stores/file-store.ts`

- [ ] **Step 1: Add focusedPath state and action**

Add to `FileStore` interface:

```typescript
focusedPath: string | null;
setFocusedPath(path: string | null): void;
```

Add initial state and implementation:

```typescript
focusedPath: null,
setFocusedPath(path) {
    set({ focusedPath: path });
},
```

Also reset `focusedPath` in `clearExplorerState()`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/file-store.ts
git commit -m "feat: add focusedPath state to file store for keyboard navigation tracking"
```

---

### Task 3: Create tree-walker utility

**Files:**
- Create: `packages/ui/src/lib/tree-walker.ts`

Pure functions that operate on the `FileNode` tree + `expandedDirs` set to compute navigation targets. No React, no store dependencies.

- [ ] **Step 1: Implement getVisibleItems**

```typescript
import type { FileNode } from "@taskflow/shared";

/** Returns a flat array of paths for all currently visible nodes in tree order. */
function getVisibleItems(root: FileNode, expandedDirs: Set<string>): string[] {
    const result: string[] = [];

    function walk(node: FileNode) {
        result.push(node.path);
        if (node.type === "directory" && expandedDirs.has(node.path) && node.children) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }

    // Root is always expanded, walk its children directly
    if (root.children) {
        for (const child of root.children) {
            walk(child);
        }
    }

    return result;
}
```

- [ ] **Step 2: Implement navigation functions**

```typescript
function getNextItem(root: FileNode, expandedDirs: Set<string>, currentPath: string): string | null {
    const items = getVisibleItems(root, expandedDirs);
    const idx = items.indexOf(currentPath);
    if (idx === -1 || idx === items.length - 1) return null;
    return items[idx + 1];
}

function getPreviousItem(root: FileNode, expandedDirs: Set<string>, currentPath: string): string | null {
    const items = getVisibleItems(root, expandedDirs);
    const idx = items.indexOf(currentPath);
    if (idx <= 0) return null;
    return items[idx - 1];
}

function getFirstItem(root: FileNode): string | null {
    if (!root.children || root.children.length === 0) return null;
    return root.children[0].path;
}

function getLastItem(root: FileNode, expandedDirs: Set<string>): string | null {
    const items = getVisibleItems(root, expandedDirs);
    if (items.length === 0) return null;
    return items[items.length - 1];
}

function getParentPath(root: FileNode, targetPath: string): string | null {
    let found: string | null = null;

    function walk(node: FileNode): boolean {
        if (node.children) {
            for (const child of node.children) {
                if (child.path === targetPath) {
                    // Don't return root path as parent (root is the working dir, not shown)
                    found = node.path === root.path ? null : node.path;
                    return true;
                }
                if (walk(child)) return true;
            }
        }
        return false;
    }

    walk(root);
    return found;
}

function findNode(root: FileNode, path: string): FileNode | null {
    if (root.path === path) return root;
    if (!root.children) return null;
    for (const child of root.children) {
        const found = findNode(child, path);
        if (found) return found;
    }
    return null;
}

export { getVisibleItems, getNextItem, getPreviousItem, getFirstItem, getLastItem, getParentPath, findNode };
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/tree-walker.ts
git commit -m "feat: add tree-walker utility for file explorer keyboard navigation"
```

---

### Task 4: Add file explorer to panel focus cycle

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`
- Modify: `packages/ui/src/hooks/useKeyboardNavigation.ts`
- Modify: `packages/ui/src/components/AppShell.tsx`

- [ ] **Step 1: Extract PanelId type and extend to include "fileexplorer"**

In `packages/ui/src/stores/ui-store.ts`, extract a shared type and add `"fileexplorer"`:

```typescript
type PanelId = "sidebar" | "fileexplorer" | "workspace" | "taskinfo";
export type { PanelId };
```

Update all occurrences in the interface:

```typescript
focusedPanel: PanelId;
setFocusedPanel(panel: PanelId): void;
```

Note: `PanelId` in `useKeyboardNavigation.ts` is already derived via `ReturnType<typeof useUIStore.getState>["focusedPanel"]`, so it will pick up the new type automatically.

- [ ] **Step 2: Update getPanelOrder in useKeyboardNavigation**

In `packages/ui/src/hooks/useKeyboardNavigation.ts`, update `getPanelOrder()`:

```typescript
function getPanelOrder(): PanelId[] {
    const panels: PanelId[] = ["sidebar"];
    if (useUIStore.getState().fileExplorerOpen) panels.push("fileexplorer");
    panels.push("workspace");
    if (useUIStore.getState().taskInfoOpen) panels.push("taskinfo");
    return panels;
}
```

- [ ] **Step 3: Add file explorer panel focus handling in useKeyboardNavigation**

Add a handler for arrow keys when file explorer is focused. After the existing sidebar arrow key block (around line 258), add:

```typescript
// Cmd+Arrow: file explorer navigation (only when file explorer focused)
if (useUIStore.getState().focusedPanel === "fileexplorer" && ARROW_KEYS.includes(e.key)) {
    if (isEditableElement(document.activeElement)) return;
    e.preventDefault();
    handleFileExplorerArrow(e.key);
    return;
}
```

Add `handleFileExplorerArrow` function (import tree-walker utilities):

```typescript
import { getNextItem, getPreviousItem, getFirstItem, getLastItem, getParentPath, findNode } from "@/lib/tree-walker";
import { useFileStore } from "@/stores/file-store";
```

```typescript
function handleFileExplorerArrow(key: string) {
    const { tree, expandedDirs, focusedPath, setFocusedPath, expandDir, collapseDir } = useFileStore.getState();
    if (!tree) return;

    if (key === "ArrowDown") {
        if (!focusedPath) {
            const first = getFirstItem(tree);
            if (first) setFocusedPath(first);
            return;
        }
        const next = getNextItem(tree, expandedDirs, focusedPath);
        if (next) setFocusedPath(next);
        return;
    }

    if (key === "ArrowUp") {
        if (!focusedPath) {
            const first = getFirstItem(tree);
            if (first) setFocusedPath(first);
            return;
        }
        const prev = getPreviousItem(tree, expandedDirs, focusedPath);
        if (prev) setFocusedPath(prev);
        return;
    }

    if (key === "ArrowRight") {
        if (!focusedPath) return;
        const node = findNode(tree, focusedPath);
        if (!node || node.type !== "directory") return;
        if (!expandedDirs.has(focusedPath)) {
            // Expand and focus first child when loaded
            const pathAtExpand = focusedPath;
            void expandDir(focusedPath).then(() => {
                // Guard: if user navigated away during load, don't move focus
                if (useFileStore.getState().focusedPath !== pathAtExpand) return;
                const updatedTree = useFileStore.getState().tree;
                if (!updatedTree) return;
                const updatedNode = findNode(updatedTree, pathAtExpand);
                if (updatedNode?.children?.[0]) {
                    useFileStore.getState().setFocusedPath(updatedNode.children[0].path);
                }
            });
        } else if (node.children?.[0]) {
            setFocusedPath(node.children[0].path);
        }
        return;
    }

    if (key === "ArrowLeft") {
        if (!focusedPath) return;
        const node = findNode(tree, focusedPath);
        if (node?.type === "directory" && expandedDirs.has(focusedPath)) {
            collapseDir(focusedPath);
        } else {
            const parent = getParentPath(tree, focusedPath);
            if (parent) setFocusedPath(parent);
        }
        return;
    }
}
```

- [ ] **Step 4: Add Enter and Home/End key handling for file explorer**

In the `onKeyDown` handler, add a block for file explorer keys (before the arrow key block). These fire on `Cmd+Enter`, `Cmd+Home`, `Cmd+End`:

```typescript
// Cmd+Enter: open focused file / toggle focused folder
if (e.key === "Enter" && useUIStore.getState().focusedPanel === "fileexplorer") {
    if (isEditableElement(document.activeElement)) return;
    e.preventDefault();
    handleFileExplorerEnter();
    return;
}

// Cmd+Home/End: jump to first/last item in file explorer
if ((e.key === "Home" || e.key === "End") && useUIStore.getState().focusedPanel === "fileexplorer") {
    if (isEditableElement(document.activeElement)) return;
    e.preventDefault();
    const { tree, expandedDirs, setFocusedPath } = useFileStore.getState();
    if (!tree) return;
    const target = e.key === "Home" ? getFirstItem(tree) : getLastItem(tree, expandedDirs);
    if (target) setFocusedPath(target);
    return;
}
```

Add `handleFileExplorerEnter`. Instead of using a custom DOM event, add an `onOpenFile` callback to the file store that FileExplorer sets:

First, add to `FileStore` interface in `packages/ui/src/stores/file-store.ts`:

```typescript
onOpenFile: ((path: string) => void) | null;
setOnOpenFile(callback: ((path: string) => void) | null): void;
```

With implementation:

```typescript
onOpenFile: null,
setOnOpenFile(callback) {
    set({ onOpenFile: callback });
},
```

Then `handleFileExplorerEnter`:

```typescript
function handleFileExplorerEnter() {
    const { tree, focusedPath } = useFileStore.getState();
    if (!tree || !focusedPath) return;
    const node = findNode(tree, focusedPath);
    if (!node) return;

    if (node.type === "directory") {
        useFileStore.getState().toggleDir(focusedPath);
    } else {
        useFileStore.getState().onOpenFile?.(focusedPath);
    }
}
```

- [ ] **Step 5: Update AppShell to include file explorer in panel focus system**

In `packages/ui/src/components/AppShell.tsx`, update the file explorer `<div>` (around line 148) to include `data-panel`, focus outline, pointer/click handlers:

```tsx
{fileExplorerOpen && (
    <div
        className={cn(
            "bg-card border-border/50 flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border shadow-lg shadow-black/20",
            (showOutline || cmdShiftHeld) &&
                focusedPanel === "fileexplorer" &&
                "ring-accent/50 ring-1 transition-[box-shadow] duration-500",
        )}
        data-panel="fileexplorer"
        onPointerDown={handlePanelPointerDown}
        onClick={() => handlePanelClick("fileexplorer")}
        style={{ width: fileExplorerWidth }}>
        {fileExplorer}
    </div>
)}
```

Update `handlePanelClick` to use the exported `PanelId` type:

```typescript
import type { PanelId } from "@/stores/ui-store";

const handlePanelClick = useCallback(
    (panel: PanelId) => {
        setFocusedPanel(panel);
    },
    [setFocusedPanel],
);
```

- [ ] **Step 6: Build check**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-keyboard-navigation-to-file-explorer && bun run build:ui`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts packages/ui/src/hooks/useKeyboardNavigation.ts packages/ui/src/components/AppShell.tsx
git commit -m "feat: add file explorer to panel focus cycle with keyboard navigation"
```

---

### Task 5: Add focus styling and click-to-focus to FileTree items

**Files:**
- Modify: `packages/ui/src/components/panels/FileTree.tsx`
- Modify: `packages/ui/src/components/panels/FileExplorer.tsx`

- [ ] **Step 1: Add focus styling to FileTree items**

In `packages/ui/src/components/panels/FileTree.tsx`, read `focusedPath` and `setFocusedPath` from the store:

```typescript
const focusedPath = useFileStore((s) => s.focusedPath);
const setFocusedPath = useFileStore((s) => s.setFocusedPath);
const isFocused = focusedPath === node.path;
```

Add a focus ring class to both file and directory elements. For files, update the div:

```tsx
<div
    onClick={() => {
        setFocusedPath(node.path);
        onFileClick(node.path);
    }}
    // ... existing props ...
    className={cn(
        fileClasses,
        "flex min-w-0 items-center gap-1.5",
        isFocused && "bg-accent/20 ring-accent/40 ring-1",
    )}
```

For directories, update the `CollapsibleTrigger`:

```tsx
<CollapsibleTrigger
    // ... existing props ...
    onClick={() => setFocusedPath(node.path)}
    className={cn(
        directoryClasses,
        isFocused && "bg-accent/20 ring-accent/40 ring-1",
    )}
```

- [ ] **Step 2: Add scroll-into-view for focused items**

Add a ref and effect to scroll focused items into view. For files, apply `ref` to the clickable div. For directories, apply `ref` to the `Collapsible` root element (Radix Collapsible renders a div and accepts a `ref`):

```typescript
const itemRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    if (isFocused && itemRef.current) {
        itemRef.current.scrollIntoView({ block: "nearest" });
    }
}, [isFocused]);
```

For files:
```tsx
<div ref={itemRef} onClick={...} className={...}>
```

For directories, pass `ref` to the Collapsible root:
```tsx
<Collapsible ref={itemRef} open={open} onOpenChange={handleOpenChange}>
```

- [ ] **Step 3: Register file-open callback in FileExplorer**

In `packages/ui/src/components/panels/FileExplorer.tsx`, wrap `handleFileClick` in `useCallback` and register it with the file store:

```typescript
const handleFileClick = useCallback(
    (path: string) => {
        const owner = workspace.task
            ? { taskId: workspace.task.id }
            : workspace.project
              ? { projectId: workspace.project.id }
              : undefined;
        void openFileInApp(path, workspace.workspaceKey, owner);
    },
    [workspace],
);

const setOnOpenFile = useFileStore((s) => s.setOnOpenFile);

useEffect(() => {
    setOnOpenFile(handleFileClick);
    return () => setOnOpenFile(null);
}, [handleFileClick, setOnOpenFile]);
```

- [ ] **Step 4: Set focusedPath on click (activate keyboard nav on click)**

Already handled in step 1 — clicking a file or directory sets `focusedPath`. Additionally, when the file explorer panel is clicked and gains focus, if no `focusedPath` is set, it should not auto-focus any item (per requirements: no auto-focus).

- [ ] **Step 5: Clear focusedPath when panel loses focus**

In `packages/ui/src/hooks/useKeyboardNavigation.ts`, in the `cycleFocus` function, clear `focusedPath` when leaving the file explorer:

```typescript
if (current === "fileexplorer" && next !== "fileexplorer") {
    useFileStore.getState().setFocusedPath(null);
}
```

When entering file explorer via panel cycling, set focus to first item to enable immediate keyboard navigation:

```typescript
if (next === "fileexplorer") {
    const { tree, focusedPath, setFocusedPath } = useFileStore.getState();
    if (tree && !focusedPath) {
        const first = getFirstItem(tree);
        if (first) setFocusedPath(first);
    }
}
```

- [ ] **Step 6: Build check**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-keyboard-navigation-to-file-explorer && bun run build:ui`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/panels/FileTree.tsx packages/ui/src/components/panels/FileExplorer.tsx packages/ui/src/hooks/useKeyboardNavigation.ts
git commit -m "feat: add focus styling and click-to-focus for file explorer keyboard navigation"
```

---

### Task 6: Update KeyboardShortcutsDialog

**Files:**
- Modify: `packages/ui/src/components/KeyboardShortcutsDialog.tsx`

- [ ] **Step 1: Add File Explorer shortcut group**

Add a new `ShortcutGroup` after the Sidebar group:

```tsx
<ShortcutGroup title="File Explorer (when focused)">
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd>&#8593;</Kbd>
                <Kbd>&#8595;</Kbd>
            </>
        }
        description="Navigate through files and folders"
    />
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd>&#8594;</Kbd>
            </>
        }
        description="Expand folder or enter first child"
    />
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd>&#8592;</Kbd>
            </>
        }
        description="Collapse folder or go to parent"
    />
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd>&#8629;</Kbd>
            </>
        }
        description="Open file or toggle folder"
    />
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd className="text-xs">Home</Kbd>
            </>
        }
        description="Jump to first item"
    />
    <ShortcutRow
        keys={
            <>
                <Kbd>&#8984;</Kbd>
                <Kbd className="text-xs">End</Kbd>
            </>
        }
        description="Jump to last item"
    />
</ShortcutGroup>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/KeyboardShortcutsDialog.tsx
git commit -m "docs: add file explorer keyboard shortcuts to shortcuts dialog"
```

---

### Task 7: Manual testing and polish

- [ ] **Step 1: Build the full app**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-keyboard-navigation-to-file-explorer && bun run build`
Expected: Build succeeds.

- [ ] **Step 2: Test keyboard navigation manually**

Verify:
1. Cmd+Shift+Arrow cycles through panels and now includes file explorer (between sidebar and workspace)
2. When file explorer is focused, focus outline appears
3. Cmd+Arrow Up/Down moves through visible items
4. Cmd+Arrow Right on collapsed folder expands it, waits for load, then moves to first child
5. Cmd+Arrow Right on expanded folder moves to first child
6. Cmd+Arrow Left on expanded folder collapses it
7. Cmd+Arrow Left on file or collapsed folder moves to parent
8. Cmd+Enter on file opens it
9. Cmd+Enter on folder toggles expand/collapse
10. Cmd+Home jumps to first item, Cmd+End to last
11. Clicking a file/folder sets focus (enables keyboard nav)
12. Focus ring is visually distinct from selected file highlighting
13. Focused item scrolls into view when navigating

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit if needed**

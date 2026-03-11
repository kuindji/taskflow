# Island Panel Styling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all panels as floating islands with rounded corners, gradient-fade resize handles, and inset content areas — matching shadcn default aesthetics.

**Architecture:** CSS-only approach — add Tailwind classes to existing components, one new CSS variable, no new components. The dark "crust" base color shows between rounded island panels.

**Tech Stack:** Tailwind CSS v4, React, shadcn/ui conventions

**Spec:** `docs/superpowers/specs/2026-03-11-island-styling-design.md`

---

## Chunk 1: Foundation & Layout

### Task 1: Add island-base CSS variable

**Files:**
- Modify: `packages/ui/src/styles/global.css`

- [ ] **Step 1: Add the CSS variable to `:root`**

In `packages/ui/src/styles/global.css`, add `--island-base: #11111b;` at the end of the `:root` block (after `--info-foreground: #1e1e2e;`).

```css
    --info-foreground: #1e1e2e;
    --island-base: #11111b;
}
```

- [ ] **Step 2: Map it in `@theme inline`**

In the same file, add `--color-island-base: var(--island-base);` at the end of the `@theme inline` block (after the `--radius-xl` line).

```css
    --radius-xl: calc(var(--radius) + 4px);
    --color-island-base: var(--island-base);
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles/global.css
git commit -m "style: add island-base CSS variable for dark panel base"
```

---

### Task 2: Restyle AppShell as island layout

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`

- [ ] **Step 1: Update the outer container**

Change line 62 from:
```tsx
<div className="flex h-screen flex-col overflow-hidden">
```
to:
```tsx
<div className="bg-island-base flex h-screen flex-col overflow-hidden">
```

- [ ] **Step 2: Remove the Electron title bar**

Delete lines 63-65 (the entire `isElectron && (...)` block that renders the title bar div):
```tsx
{isElectron && (
    <div className="bg-card flex h-9 shrink-0 items-center px-20 [-webkit-app-region:drag]" />
)}
```

- [ ] **Step 3: Add padding and gap to the content row**

Change line 66 from:
```tsx
<div className="flex flex-1 overflow-hidden">
```
to:
```tsx
<div className="flex flex-1 gap-1.5 overflow-hidden p-1.5">
```

- [ ] **Step 4: Add island styling to the sidebar panel**

Change line 67 from:
```tsx
<div className="bg-card flex shrink-0 flex-col" style={{ width: sidebarWidth }}>
```
to:
```tsx
<div
    className={`bg-card flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/50 ${isElectron ? "pt-8" : ""}`}
    style={{ width: sidebarWidth }}
>
```

Note: `pt-8` (32px) provides space for macOS traffic lights when running in Electron.

- [ ] **Step 5: Add island styling to the file explorer panel**

Change lines 74-76 from:
```tsx
<div
    className="bg-card flex shrink-0 flex-col"
    style={{ width: fileExplorerWidth }}
>
```
to:
```tsx
<div
    className="bg-card flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/50"
    style={{ width: fileExplorerWidth }}
>
```

- [ ] **Step 6: Add island styling to the workspace panel**

Change line 86 from:
```tsx
<div className="flex flex-1 flex-col overflow-hidden">{workspace}</div>
```
to:
```tsx
<div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border border-border/50">
    {workspace}
</div>
```

- [ ] **Step 7: Add island styling to the task info panel**

Change lines 93-95 from:
```tsx
<div
    className="bg-card flex shrink-0 flex-col"
    style={{ width: taskInfoWidth }}
>
```
to:
```tsx
<div
    className="bg-card flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/50"
    style={{ width: taskInfoWidth }}
>
```

- [ ] **Step 8: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx
git commit -m "style: convert panels to floating islands with rounded corners"
```

---

### Task 3: Restyle ResizeHandle

**Files:**
- Modify: `packages/ui/src/components/ResizeHandle.tsx`

- [ ] **Step 1: Update the width calculation**

Change line 43 from:
```tsx
const width = Math.max(panelGap, 4);
```
to:
```tsx
const width = Math.max(panelGap, 8);
```

- [ ] **Step 2: Replace the handle markup**

Replace lines 45-53 (the entire return statement) with:
```tsx
return (
    <div
        onMouseDown={handleMouseDown}
        style={{ width }}
        className="group relative flex shrink-0 cursor-col-resize items-center justify-center"
    >
        <div className="bg-border/40 group-hover:bg-border/70 h-8 w-0.5 rounded-full transition-colors" />
    </div>
);
```

This replaces the full-height 1px border line with a centered 32px pill indicator that brightens on hover. The handle background is transparent, letting the dark `island-base` show through.

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ResizeHandle.tsx
git commit -m "style: replace resize handle border with centered pill indicator"
```

---

## Chunk 2: Content Inset & Drag Region

### Task 4: Add inset content wrapper to TabContent

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx`

- [ ] **Step 1: Wrap the empty state in the inset container**

Change lines 19-24 from:
```tsx
if (tabs.length === 0) {
    return (
        <div className="text-muted-foreground flex flex-1 items-center justify-center">
            No active tab. Create a session with +
        </div>
    );
}
```
to:
```tsx
if (tabs.length === 0) {
    return (
        <div className="m-1.5 flex flex-1 overflow-hidden rounded-md border border-border/30">
            <div className="text-muted-foreground flex flex-1 items-center justify-center">
                No active tab. Create a session with +
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Replace the fragment with an inset wrapper div**

Change line 31 from:
```tsx
return (
    <>
```
to:
```tsx
return (
    <div className="m-1.5 flex flex-1 overflow-hidden rounded-md border border-border/30">
```

And change line 83-84 from:
```tsx
        </>
    );
```
to:
```tsx
        </div>
    );
```

- [ ] **Step 3: Change `display: contents` to `display: flex` for active tabs**

Change line 79 from:
```tsx
<div style={{ display: isActive ? "contents" : "none" }}>{pane}</div>
```
to:
```tsx
<div className="flex-1" style={{ display: isActive ? "flex" : "none" }}>{pane}</div>
```

The `display: contents` was used to make the pane participate in the parent's flex layout directly, but it would bypass the new wrapper's `overflow-hidden` and `rounded-md` clipping. Using `display: flex` with `flex: 1` achieves proper sizing while respecting the rounded border clipping.

- [ ] **Step 4: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx
git commit -m "style: add inset rounded content wrapper to tab content area"
```

---

### Task 5: Add Electron drag region to TaskHeader

**Files:**
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

- [ ] **Step 1: Import the useIsElectron hook**

Add after the existing imports (after line 15):
```tsx
import useIsElectron from "@/hooks/useIsElectron";
```

- [ ] **Step 2: Use the hook in the component**

Add after the existing hook calls (after line 28, below `const deleteTask = ...`):
```tsx
const isElectron = useIsElectron();
```

- [ ] **Step 3: Conditionally apply drag region to the header container**

Change line 50 from:
```tsx
<div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
```
to:
```tsx
<div className={`border-border flex items-center gap-2 border-b px-3 py-1.5 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
```

- [ ] **Step 4: Add no-drag to all interactive elements**

Add `[-webkit-app-region:no-drag]` class to each `Button` component (there are 4 buttons). For each `<Button` tag, add the class to the `className` prop. If no `className` prop exists, add one.

Button 1 (toggle file explorer, line 51): No existing className — add `className="[-webkit-app-region:no-drag]"`

Button 2 (archive, line 71): No existing className — add `className="[-webkit-app-region:no-drag]"`

Button 3 (delete, line 79): Has `className="text-destructive hover:text-destructive"` — change to `className="text-destructive hover:text-destructive [-webkit-app-region:no-drag]"`

Button 4 (toggle task info, line 88): No existing className — add `className="[-webkit-app-region:no-drag]"`

Also add no-drag to the Badge (line 66-68): Change to:
```tsx
<Badge variant="outline" className="px-1.5 py-0 text-[9px] [-webkit-app-region:no-drag]">
```

- [ ] **Step 5: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "style: add Electron drag region to task header"
```

---

### Task 6: Visual verification

- [ ] **Step 1: Start the dev server**

Run: `cd packages/ui && bun run dev`

- [ ] **Step 2: Verify in browser**

Open the app and visually confirm:
1. Dark base color (`#11111b`) visible between all panels
2. All panels have rounded corners with subtle borders
3. Resize handles show a small centered pill, no full-height line
4. Resize handles brighten on hover
5. Dragging resize handles still works correctly
6. Workspace content area (terminal/editor) has inset rounded corners
7. No title bar visible — panels start from the top
8. File explorer and task info panels toggle correctly with rounded corners
9. Empty workspace state ("Select a task") renders inside the island

- [ ] **Step 3: Verify in Electron (if available)**

Open in Electron and confirm:
1. Sidebar has extra top padding for traffic lights
2. Task header is draggable (window moves when dragging header)
3. Buttons in header remain clickable (not intercepted by drag region)
4. Traffic lights are visible and functional over the sidebar island

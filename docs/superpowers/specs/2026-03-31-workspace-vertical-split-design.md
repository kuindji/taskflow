# Workspace Vertical Split View

## Overview

Add a vertical split view to workspaces, allowing users to view two independent pane groups side by side within a single workspace. Each pane has its own tab bar and tab content. The split is limited to one vertical split (two panes) but the architecture leaves room for future N-way splits.

## Requirements

- Single vertical split only (left/right)
- Single shared TaskHeader; each pane gets its own TabBar + TabContent
- Split toggled via a button in the TaskHeader (to the left of the task info toggle)
- Button renders as "pressed" (active variant) while split is open
- Clicking the button when split is closed opens it; clicking when open closes it
- Split opens with an empty right pane
- Split closes by merging right pane tabs into the left pane (appended at end)
- Tabs are draggable between split panes
- Split state is ephemeral (not persisted to settings)
- Empty panes remain open until explicitly closed via the toggle button

## State Model

### UI Store

New field (ephemeral, not persisted):

```typescript
splitByWorkspace: Record<string, {
  open: boolean
  ratio: number        // 0.0–1.0, proportion of left pane width, default 0.5
  activePane: "left" | "right"  // which pane has focus
}>
```

Keyed by workspace key (`task:{id}`, `project:{id}`, `master`).

### Session Store

No schema changes. The left pane uses the existing workspace key. The right pane uses `{workspaceKey}:right`.

- When split opens: a new `{key}:right` entry is created with empty tabs
- When split closes: tabs from `{key}:right` are appended to `{key}`, then the right entry is removed
- Zero migration needed for existing data

## Component Architecture

```
Workspace
+-- TaskHeader              (single, shared — includes split toggle button)
+-- SplitContainer          (flex row, manages panes + resize handle)
    +-- WorkspacePane       (left — always present)
    +-- ResizeHandle        (only when split is open)
    +-- WorkspacePane       (right — only when split is open)
```

### WorkspacePane

Extracted from current Workspace internals. Each pane owns its TabBar and TabContent.

Props:
- `workspaceKey` — session store key (base key or `{base}:right`)
- `paneId` — `"left" | "right"`
- `isFocused` — whether this pane currently has focus
- `onFocus` — callback to set this pane as active
- `scope` — workspace scope (task/project/master)

### SplitContainer

Renders panes in a flex row. When split is closed, renders only the left pane at full width. When open, renders both panes separated by a ResizeHandle.

### Split Toggle Button

Added to TaskHeader, to the left of the task info toggle. Uses a vertical split icon. Pressed/active state when split is open.

## Tab Drag-and-Drop Between Panes

The `DndContext` (from `@dnd-kit`) moves up from individual TabBars to the SplitContainer level, encompassing both panes.

### Drop behavior

- **Within same pane:** reorder as today
- **To other pane's tab bar:** remove from source, add to target at drop position
- **To other pane's content area (empty pane):** move tab to that pane

### After move

- Moved tab becomes active in the target pane
- Source pane activates its next tab (or becomes empty)
- Dragging always moves, never copies — a session lives in one pane at a time

## Focus Management

### What sets focus

- Clicking anywhere in a pane (tab bar or content area)
- Creating a new tab in a pane
- Dragging a tab to the other pane (target becomes focused)
- On split close, focus resets to left

### Visual indication

Focused pane's TabBar gets a subtle visual distinction (accent color on tab bar bottom border or slightly brighter background). Unfocused pane's TabBar is slightly muted.

### New tab targeting

- Agent dropdown in each TabBar creates sessions in that pane
- Global keyboard shortcuts target the focused pane
- External triggers (e.g. "open file in editor") target the focused pane

### Keyboard navigation

- Existing panel cycle (sidebar -> fileexplorer -> workspace -> taskinfo) treats the focused pane as "workspace"
- Tab cycling shortcuts cycle within the focused pane only
- No special shortcut for pane-to-pane focus switching (clicking suffices)

## Edge Cases

### Terminal off-screen strategy

Each pane's TabContent independently positions inactive terminals at `left: -9999em`. A terminal is visible only when it's the active tab in a visible pane.

### Resize behavior

Drag the split resize handle to adjust ratio. Clamped to min/max (each pane at least 20% of workspace width). Ratio resets to 0.5 on next split open.

### Window resize

Both panes scale proportionally based on the stored ratio via flex layout.

### Workspace switching

Split state is per workspace key. Switching workspaces shows/hides the split based on each workspace's state.

### Tab type restrictions

None. Any tab type (terminal, editor, browser, changes, markdown) can live in either pane.

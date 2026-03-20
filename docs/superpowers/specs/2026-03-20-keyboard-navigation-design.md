# Keyboard Navigation Design

## Overview

Context-sensitive keyboard navigation across panels, tabs, tasks, and projects. Uses `Cmd` modifier family throughout for consistency. Navigation behavior adapts based on which panel has focus.

## Panel Focus System

Three panels can receive keyboard focus: **Sidebar**, **Workspace**, and **Task Info** (when visible). File Explorer is excluded for now (future work).

### Focus Toggle

`Cmd+Shift+Left/Right` cycles focus between panels in order:

```
Sidebar ↔ Workspace ↔ Task Info (if visible)
```

- `Cmd+Shift+Right` moves focus rightward
- `Cmd+Shift+Left` moves focus leftward
- Panels that are not visible are skipped

### Visual Indicators

**Panel focus outline:** While `Cmd+Shift` is held, the currently focused panel shows a subtle outline. After a focus change, the outline persists for 1-2 seconds then fades, giving the user feedback about where focus landed.

**Number key badges:** While `Cmd` is held and `Cmd+<n>` shortcuts are available, number badges appear on navigable items using a keyboard-key visual style:

- **Style:** Flat background (`#2a2a3e`), 1px border (`#4a4a5e`), 2px bottom border, 4px border-radius, 10px font, 18×18px size
- **Tabs (workspace focused):** Badge replaces the close button (same position)
- **Tasks (sidebar focused, task selected):** Badge appears in the top-right corner of the task card
- **Projects (sidebar focused, project selected):** Badge replaces the right-side arrow

Badges are only shown on the items that `Cmd+<n>` would target in the current context (max 9).

## Shortcuts by Panel

### Workspace Focused (default)

| Shortcut | Action |
|----------|--------|
| `Cmd+<n>` | Jump to Nth tab |

All other keys pass through to the terminal/editor normally.

### Sidebar Focused

| Shortcut | Action |
|----------|--------|
| `Cmd+<n>` | Jump to Nth task (if a task is selected) or Nth project (if a project is selected) |
| `Cmd+Up/Down` | Move between all visible sidebar items |
| `Cmd+Left` | On a task: move focus to its parent project. On a project: collapse it |
| `Cmd+Right` | On a project: expand it. On a task: no-op |

#### Sidebar Item Visibility

"Visible items" means all items that are currently rendered in the sidebar list:
- All projects are always visible
- Tasks within a project are visible only when the project is expanded
- `Cmd+Down` on a collapsed project skips to the next project (does not enter collapsed children)
- At the top or bottom of the list, `Cmd+Up/Down` is a no-op (no wrapping)
- If `Cmd+<n>` is pressed and N exceeds the number of available items, it is a no-op

#### Context-Sensitive `Cmd+<n>`

The behavior of `Cmd+<n>` in the sidebar depends on what type of item is currently selected:
- **Task selected**: `Cmd+<n>` jumps to the Nth task within the same project
- **Project selected**: `Cmd+<n>` jumps to the Nth project in the list

### Task Info Focused

When Task Info panel receives focus, it focuses the first input field in the panel. No additional keyboard shortcuts.

## Existing Shortcuts (Unchanged)

These existing shortcuts remain and work regardless of panel focus:

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New Task |
| `Cmd+T` | New Terminal |
| `Cmd+W` | Close Tab |
| `Cmd+E` | Toggle File Explorer |
| `Cmd+I` | Toggle Task Info |
| `Cmd+Shift+C` | Compact Sidebar |
| `Cmd+,` | Open Settings |
| `Alt+Z` | Toggle Word Wrap |

## Architecture

### Electron Path

Electron menu accelerators (`main.ts`) → IPC → preload bridge (`preload.ts`) → UI handlers

New accelerators for `Cmd+Shift+Left/Right` should be registered in the Electron menu with IPC channels `focus-panel-left` and `focus-panel-right`. The `Cmd+1..9` shortcuts must be handled exclusively in the UI keydown handler (not as Electron menu accelerators) because their behavior depends on `focusedPanel` state. Similarly, `Cmd+Arrow` shortcuts for sidebar navigation are UI-layer only.

### UI Path

Keyboard event handlers in the Workspace/AppShell component. A focus state tracked in a Zustand store (or local component state) determines which panel owns `Cmd+<n>` and arrow shortcuts.

### Focus State

A `focusedPanel` state with values: `'sidebar' | 'workspace' | 'taskinfo'`

- Defaults to `'workspace'`
- Updated by `Cmd+Shift+Left/Right`
- Updated by mouse clicks: clicking within a panel sets `focusedPanel` to that panel
- Sidebar tracks which item has virtual focus (project or task, by ID)

### Conflict Avoidance

- No modifier+arrow shortcuts are active when workspace is focused — terminals and editors work normally
- `Cmd+<n>` in workspace context triggers tab switching (1-9), which does not conflict with `Cmd+N` (new task) since `N` there refers to the letter, not a digit
- Sidebar arrow shortcuts use `Cmd+Arrow` which is safe because no terminal/editor is focused when sidebar has focus
- `Cmd+Shift+Left/Right` for panel focus is suppressed when a text input or textarea has DOM focus (e.g., in Task Info panel) to avoid conflicting with text selection

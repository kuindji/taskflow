# Compact Sidebar View

## Overview

Add a "Compact Sidebar" toggle to the macOS View menu (Cmd+Shift+C) that condenses task cards in the sidebar to show only the title and session/worktree badges, hiding the description line and reducing vertical padding.

## Changes

### Types — `packages/shared/src/types/settings.ts`

Add `compactSidebar: boolean` to `PanelSettings`. Default: `false`.

### Backend defaults — `packages/backend/src/services/settings-store.ts`

Add `compactSidebar: false` to the default panel settings object.

### Electron menu — `electron/src/main.ts`

Replace `{ role: "viewMenu" }` with a custom View menu containing:

- Standard view items: Reload, Force Reload, Toggle Developer Tools, separators, zoom controls
- Separator
- **Compact Sidebar** — checkable menu item, accelerator `CmdOrCtrl+Shift+C`

On click, send `toggle-compact-sidebar` IPC event to the renderer. The menu item's `checked` state is kept in sync: the renderer sends `compact-sidebar-changed` back to main whenever the value changes, and main updates the menu item.

### UI settings store — `packages/ui/src/stores/settings-store.ts`

- Listen for `toggle-compact-sidebar` IPC event from Electron
- Toggle `settings.layout.panels.compactSidebar` and persist via `updateSettings()`
- After toggling, send `compact-sidebar-changed` IPC to Electron with the new value
- On initial settings fetch, also send `compact-sidebar-changed` so the menu reflects the persisted state

### TaskCard — `packages/ui/src/components/sidebar/TaskCard.tsx`

Accept a `compact` prop (boolean).

When `compact` is true:
- Hide the description row
- Reduce vertical padding from `py-2.5` to `py-1.5`
- Title and badges (session + worktree) still render on two lines

### TaskSidebar — `packages/ui/src/components/sidebar/TaskSidebar.tsx`

Read `compactSidebar` from the settings store and pass it to each `TaskCard` as the `compact` prop.

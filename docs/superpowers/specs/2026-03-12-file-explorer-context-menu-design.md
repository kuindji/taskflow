# File Explorer Context Menu — Rename, Delete & Utility Actions

## Overview

Add a right-click context menu to FileTree items (files and directories) with rename, delete, copy path, open in external editor, and reveal in Finder actions.

## Context Menu

Right-clicking any file or directory node in `FileTree` opens a context menu with:

| Action | Scope | Description |
|---|---|---|
| Rename | Files & dirs | Opens a rename dialog |
| Delete | Files & dirs | Opens a delete confirmation dialog |
| *(separator)* | | |
| Copy Path | Files & dirs | Copies absolute path to clipboard |
| Copy Relative Path | Files & dirs | Copies path relative to project root to clipboard |
| *(separator)* | | |
| Open in External Editor | Files only | Opens file in `$EDITOR` or `code` |
| Reveal in Finder | Files & dirs | Opens parent dir in Finder with item selected |

### Implementation

Use `@radix-ui/react-context-menu` (shadcn `ContextMenu` component — needs to be added). Wrap each file/directory node in `FileTree` with `ContextMenuTrigger`.

## Rename Dialog

- Uses the existing shadcn `Dialog` component.
- Text input pre-filled with the current item name (not full path).
- For files: auto-selects the name portion before the last `.` extension. For directories: selects all.
- **Validation:**
  - Name must not be empty.
  - Name must not contain `/` or `\0`.
  - Name must not collide with an existing sibling (checked via `FILE_STAT` on the target path).
- Inline error message below the input on validation failure.
- Enter confirms, Escape cancels.
- On confirm: sends `FILE_RENAME` message to backend. Tree auto-refreshes via `FILE_CHANGED` events from FileWatcher.

## Delete Confirmation Dialog

- Uses the existing shadcn `AlertDialog` component.
- Message: `Delete "name"?` for files, `Delete "name" and all its contents?` for directories.
- Subtext: "This cannot be undone."
- Two buttons: Cancel (secondary) and Delete (destructive variant).
- On confirm: sends `FILE_DELETE` message to backend. Tree auto-refreshes via `FILE_CHANGED` events.

## Backend Messages

### `FILE_RENAME`

- **Constant:** `MSG.FILE_RENAME = "file:rename"`
- **Payload type:** `FileRenamePayload { oldPath: string; newPath: string }`
- **Handler:**
  1. Validate both paths with `assertWorkspacePath`.
  2. Check target doesn't exist (`stat`). If it does, return error.
  3. `rename(oldPath, newPath)` via `fs/promises`.
  4. Return `{ success: true }`.
- FileWatcher detects the change and broadcasts `FILE_CHANGED`.

### `FILE_DELETE`

- **Constant:** `MSG.FILE_DELETE_FILE = "file:delete"`
- **Payload type:** `FileDeletePayload { path: string }`
- **Handler:**
  1. Validate path with `assertWorkspacePath`.
  2. `rm(path, { recursive: true })` via `fs/promises`.
  3. Return `{ success: true }`.
- FileWatcher detects the change and broadcasts `FILE_CHANGED`.

### `FILE_OPEN_EXTERNAL`

- **Constant:** `MSG.FILE_OPEN_EXTERNAL = "file:open-external"`
- **Payload type:** `FileOpenExternalPayload { path: string }`
- **Handler:**
  1. Validate path with `assertWorkspacePath`.
  2. Determine editor: `process.env.EDITOR` or fall back to `"code"`.
  3. Spawn `editor <path>` detached.
  4. Return `{ success: true }`.

### `FILE_REVEAL`

- **Constant:** `MSG.FILE_REVEAL = "file:reveal"`
- **Payload type:** `FileRevealPayload { path: string }`
- **Handler:**
  1. Validate path with `assertWorkspacePath`.
  2. Spawn `open -R <path>` (macOS).
  3. Return `{ success: true }`.

## UI Components

### New files

- `packages/ui/src/components/ui/context-menu.tsx` — shadcn ContextMenu primitive (generated via shadcn CLI or manually from Radix).
- `packages/ui/src/components/panels/FileContextMenu.tsx` — wraps FileTree nodes, renders the menu items, manages dialog state.
- `packages/ui/src/components/panels/RenameFileDialog.tsx` — rename dialog with input, validation, and submit.
- `packages/ui/src/components/panels/DeleteFileDialog.tsx` — delete confirmation alert dialog.

### Modified files

- `packages/shared/src/constants.ts` — add `FILE_RENAME`, `FILE_DELETE_FILE`, `FILE_OPEN_EXTERNAL`, `FILE_REVEAL` to `MSG`.
- `packages/shared/src/types/ws.ts` — add payload types for the four new messages.
- `packages/backend/src/handlers/file.ts` — register handlers for the four new messages.
- `packages/ui/src/components/panels/FileTree.tsx` — wrap file/dir nodes with `FileContextMenu`.
- `packages/ui/src/stores/file-store.ts` — add `renameFile`, `deleteFile`, `openExternal`, `revealInFinder` actions that send WS messages.

## Data Flow

```
User right-clicks file → ContextMenu appears
User clicks "Rename" → RenameFileDialog opens
User edits name, presses Enter → fileStore.renameFile(oldPath, newPath)
  → WS FILE_RENAME → backend rename() → success
  → FileWatcher detects change → broadcasts FILE_CHANGED
  → FileStore receives event → triggers tree refresh
```

Delete follows the same pattern with `FILE_DELETE` instead.

Copy Path / Copy Relative Path are client-only (`navigator.clipboard.writeText`).

Open in External Editor and Reveal in Finder send WS messages; no tree refresh needed.

## Edge Cases

- **Rename to same name:** No-op, close dialog without sending message.
- **Target already exists:** Show inline error "A file with this name already exists."
- **File deleted externally between menu open and action:** Backend returns error; show toast or ignore gracefully.
- **Long file names in rename dialog:** Input should scroll horizontally; dialog width is fixed.
- **Context menu on root node:** All actions available (rename/delete the project root would be blocked by `assertWorkspacePath` if it equals the workspace root).

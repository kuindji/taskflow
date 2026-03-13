# Gitignore-Based File Explorer Filtering

## Problem

The git service runs `git ls-files --others --ignored --exclude-standard` on every `status()` call, returning ~21,562 absolute file paths (~1.7MB) in `GitStatusResult.ignoredPaths`. This data is polled every 15 seconds and on file change events (debounced to 150ms). The large WebSocket payloads block the backend event loop during serialization and the UI main thread during parsing, causing keystroke loss in terminal sessions.

The only consumer of `ignoredPaths` is `FileExplorer.tsx`, which uses it to style git-ignored files with dimmed text.

## Solution

Replace the expensive `git ls-files` subprocess + large path array with lightweight `.gitignore` pattern strings returned alongside the file tree. The UI matches patterns against tree nodes client-side using the `ignore` npm package.

## Changes

### 1. Backend: `FileWatcher.buildTree()`

**File:** `packages/backend/src/services/file-watcher.ts`

Read `.gitignore` from the root of the requested directory during tree build. Parse into raw pattern lines (strip comments and blank lines). Return alongside the tree.

If `.gitignore` does not exist, return an empty array.

**Updated return shape:** `{ tree: FileNode, gitignorePatterns: string[] }`

### 2. Shared types

**Files:** `packages/shared/src/types/git.ts`, `packages/shared/src/types/file.ts` (or wherever `FileTreeResponse` is defined)

- Add `gitignorePatterns: string[]` to the file tree response type.
- Remove `ignoredPaths: string[]` from `GitStatusResult`.

### 3. Backend: `git-service.ts`

**File:** `packages/backend/src/services/git-service.ts`

Remove the `git ls-files --others --ignored --exclude-standard` call and the `ignoredPaths` field from `status()` return value.

### 4. UI: `file-store.ts`

**File:** `packages/ui/src/stores/file-store.ts`

Store `gitignorePatterns: string[]` received from the tree response. Remove any `ignoredPaths` handling tied to git status.

### 5. UI: `FileExplorer.tsx`

**File:** `packages/ui/src/components/panels/FileExplorer.tsx`

Create an `ignore` instance from stored `gitignorePatterns`. Build the `ignoredFiles` set by testing each file tree node's path (converted to relative path from working dir) against the matcher. Pass to `FileTree.tsx` as today.

### 6. Dependencies

Add `ignore` npm package to `packages/ui`.

## What stays the same

- `FileTree.tsx` rendering and the "ignored" styling variant.
- Git status polling (just without the heavy `ignoredPaths` payload).
- File watcher polling interval and debounce logic.
- Hardcoded directory exclusions in `FileWatcher` (`node_modules`, `.git`, etc.).

## Scope limitations

- Only the root `.gitignore` is read (no nested `.gitignore` files, `.git/info/exclude`, or global gitignore).
- This can be extended later if needed.

## Impact

- Eliminates ~1.7MB per git status WebSocket response.
- Removes a 0.3s `git ls-files` subprocess from every status poll.
- Resolves keystroke loss in terminal sessions caused by event loop starvation.

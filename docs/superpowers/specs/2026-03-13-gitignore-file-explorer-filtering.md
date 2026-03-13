# Gitignore-Based File Explorer Filtering

## Problem

The git service runs `git ls-files --others --ignored --exclude-standard` on every `status()` call, returning ~21,562 absolute file paths (~1.7MB) in `GitStatusResult.ignoredPaths`. This data is polled every 15 seconds and on file change events (debounced to 150ms). The large WebSocket payloads block the backend event loop during serialization and the UI main thread during parsing, causing keystroke loss in terminal sessions.

The only consumer of `ignoredPaths` is `FileExplorer.tsx`, which uses it to style git-ignored files with dimmed text.

## Solution

Replace the expensive `git ls-files` subprocess + large path array with lightweight `.gitignore` pattern strings returned alongside the file tree. The UI matches patterns against tree nodes client-side using the `ignore` npm package.

## Changes

### 1. Backend: `FileWatcher.buildTree()`

**File:** `packages/backend/src/services/file-watcher.ts`

Read `.gitignore` from the root of the requested directory at depth 0 only (not on recursive calls). Pass the raw file content as-is — the `ignore` package handles comments and blank lines natively, so no pre-processing is needed. Return alongside the tree.

If `.gitignore` does not exist, return an empty array.

**Updated return shape:** `{ tree: FileNode, gitignorePatterns: string[] }`

### 2. Backend: `handlers/file.ts`

**File:** `packages/backend/src/handlers/file.ts`

Update the `FILE_TREE` handler to destructure the new return value from `buildTree()` and pass `gitignorePatterns` through in the response.

### 3. Shared types

**File:** `packages/shared/src/types/ws.ts`

- Add `gitignorePatterns: string[]` to `FileTreeResponse` (defined in `ws.ts`, not `file.ts`).

**File:** `packages/shared/src/types/git.ts`

- Remove `ignoredPaths: string[]` from `GitStatusResult`.

### 4. Backend: `git-service.ts`

**File:** `packages/backend/src/services/git-service.ts`

Remove the `git ls-files --others --ignored --exclude-standard` call and the `ignoredPaths` field from `status()` return value.

### 5. UI: `file-store.ts`

**File:** `packages/ui/src/stores/file-store.ts`

- Add `gitignorePatterns: string[]` field to the store.
- Update the `sendRequest` generic in `fetchTree()` from `{ tree: FileNode }` to include `gitignorePatterns`, and store the returned patterns.
- Reset `gitignorePatterns` to `[]` in `clearExplorerState()`.

### 6. UI: `FileExplorer.tsx`

**File:** `packages/ui/src/components/panels/FileExplorer.tsx`

Create an `ignore` instance from stored `gitignorePatterns`. Test each file tree node's path (converted to a relative path from working dir via `path.slice(workingDir.length + 1)`) against the matcher. Populate the `ignoredFiles` set with the **absolute** `node.path` values so `FileTree.tsx` continues to match via `ignoredFiles.has(node.path)` unchanged.

### 7. Dependencies

Add `ignore` npm package to `packages/ui` (`bun add ignore`).

## What stays the same

- `FileTree.tsx` rendering and the "ignored" styling variant.
- Git status polling (just without the heavy `ignoredPaths` payload).
- File watcher polling interval and debounce logic.
- Hardcoded directory exclusions in `FileWatcher` (`node_modules`, `.git`, etc.).

## Notes

- Editing `.gitignore` triggers a `FILE_CHANGED` event which causes `fetchTree()` to re-run. Since `buildTree()` reads `.gitignore` as part of the same call, patterns refresh automatically — no separate watcher needed.
- Other callers of `git.status()` (e.g. `resolveFileStatus()`) are unaffected by the removal of `ignoredPaths`.

## Scope limitations

- Only the root `.gitignore` is read (no nested `.gitignore` files, `.git/info/exclude`, or global gitignore).
- This can be extended later if needed.

## Impact

- Eliminates ~1.7MB per git status WebSocket response.
- Removes a 0.3s `git ls-files` subprocess from every status poll.
- Resolves keystroke loss in terminal sessions caused by event loop starvation.

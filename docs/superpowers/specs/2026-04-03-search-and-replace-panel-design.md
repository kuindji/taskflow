# Search & Replace Panel Design

## Overview

Add a Search & Replace panel to Taskflow, similar to Cursor/VS Code's sidebar search. The panel occupies the same slot as the file explorer — opening one closes the other. It supports searching file contents across the workspace using ripgrep, with find-and-replace capabilities at individual match, per-file, and global levels.

## Architecture

Three layers:

1. **Backend** — new `search` handler that shells out to `rg --json`
2. **Shared** — new MSG constants and payload/result types
3. **Frontend** — new `SearchPanel` component, `search-store` Zustand store, UI store/AppShell integration

## Backend: Search Handler

### New message types (`packages/shared/src/constants.ts`)

```
SEARCH_QUERY: "search:query"
SEARCH_CANCEL: "search:cancel"
SEARCH_REPLACE: "search:replace"
SEARCH_REPLACE_ALL: "search:replace-all"
```

### Handler (`packages/backend/src/handlers/search.ts`)

- Shells out to `rg --json` for structured JSON output per match
- Supports flags: `--case-sensitive`/`-i`, `--word-regexp`, `--pcre2` (regex), `--glob` (include/exclude patterns)
- Respects `.gitignore` by default (ripgrep native behavior)
- Parses `rg` JSON output into structured results grouped by file
- Search is cancellable — stores child process handle keyed by search ID, kills on cancel

### Replace handler

- **Individual/per-file replace:** read file, apply replacements at exact byte offsets from rg output, write back
- **Replace-all:** iterate all matched files, same read-replace-write
- After each file write, returns the updated file path so the frontend can refresh

## Shared Types (`packages/shared/src/types/search.ts`)

```typescript
interface SearchMatch {
    line: number
    column: number
    matchLength: number
    lineContent: string
}

interface SearchFileResult {
    path: string
    matches: SearchMatch[]
}

interface SearchResult {
    files: SearchFileResult[]
    totalMatches: number
    searchId: string
}
```

Payload types for each message:

- `SearchQueryPayload` — `{ path, query, caseSensitive, wholeWord, useRegex, includePattern, excludePattern }`
- `SearchCancelPayload` — `{ searchId }`
- `SearchReplacePayload` — `{ path, query, replacement, matches, caseSensitive, wholeWord, useRegex }` (single match or per-file)
- `SearchReplaceAllPayload` — `{ path, query, replacement, caseSensitive, wholeWord, useRegex, includePattern, excludePattern, filePath? }` (optional filePath scopes to one file)

## Frontend: Search Store (`packages/ui/src/stores/search-store.ts`)

### State

- `query: string` — search text
- `replacement: string` — replace text
- `caseSensitive: boolean`, `wholeWord: boolean`, `useRegex: boolean` — toggle flags
- `includePattern: string`, `excludePattern: string` — file glob filters
- `results: SearchFileResult[]` — grouped results
- `totalMatches: number`
- `searchId: string | null` — for cancellation
- `searching: boolean` — loading state
- `expandedFiles: Set<string>` — which file groups are expanded in results tree
- `error: string | null`

### Actions

- `setQuery()`, `setReplacement()`, `toggleCaseSensitive()`, etc.
- `search(rootPath)` — sends `SEARCH_QUERY`, cancels any in-flight search first
- `cancel()` — sends `SEARCH_CANCEL`
- `replaceMatch(filePath, match)` — replace single match
- `replaceInFile(filePath)` — replace all matches in one file
- `replaceAll()` — replace all matches across all files
- `toggleFileExpanded(path)` — expand/collapse file group in results
- `clear()` — reset all state

Uses `sendRequest()` pattern, same as `file-store`.

## Frontend: SearchPanel Component

### Component hierarchy

```
SearchPanel
├── Toolbar (header with "Search" label + close button)
├── SearchInputs (sticky top section)
│   ├── Search field with inline toggle buttons (case, whole word, regex)
│   ├── Replace field with replace-all button
│   ├── Collapsible "files to include" input
│   └── Collapsible "files to exclude" input
└── SearchResults (scrollable results area)
    └── SearchFileGroup (one per file, collapsible)
        ├── File header (icon + relative path + match count + replace-in-file button)
        └── SearchMatchLine (one per match)
            ├── Line content with highlighted match
            └── Replace-single + dismiss buttons on hover
```

### Key behaviors

- Search auto-triggers on 3+ chars with 300ms debounce, or on Enter for shorter queries
- Toggle buttons (Aa, Ab|, .*) sit inside the search input field, right-aligned
- Include/exclude fields hidden by default, revealed via a Filter toggle icon
- File groups expanded by default, collapsible
- Match lines show line content with matched portion highlighted (bold + accent background)
- Hover on match line reveals individual replace and dismiss buttons
- File header row shows replace-in-file button on hover
- Replace-all button sits inline with the replace input field
- When replace text is empty, replace buttons still work (deletes matched text)
- Result count summary between inputs and results: "N results in M files"

### Keyboard shortcuts

- `Cmd+Shift+F` opens the search panel (global shortcut)
- `Escape` in any input closes the panel if results are empty, otherwise clears the query

## UI Store & AppShell Integration

### UI store changes (`packages/ui/src/stores/ui-store.ts`)

- Add `searchPanelOpen: boolean` (default `false`)
- Add `toggleSearchPanel()` — toggles `searchPanelOpen`, closes `fileExplorerOpen` when opening
- Modify `toggleFileExplorer()` — closes `searchPanelOpen` when opening

### AppShell changes (`packages/ui/src/components/AppShell.tsx`)

- New `searchPanel` prop of type `ReactNode`
- Shared render slot: render if `fileExplorerOpen || searchPanelOpen`
- Inside the slot, conditionally render either `fileExplorer` or `searchPanel`
- Panel registration: register `"fileexplorer"` panel ID when either is open (shared physical slot)
- Search panel reuses `fileExplorerWidth` and its resize handle

### TaskHeader changes (`packages/ui/src/components/workspace/TaskHeader.tsx`)

- New `Search` icon button next to the `FolderTree` button
- Uses `variant={searchPanelOpen ? "secondary" : "ghost"}` active state pattern
- Existing `FolderTree` button unchanged — `toggleFileExplorer` handles closing search panel

## Files to create

- `packages/shared/src/types/search.ts` — search types
- `packages/backend/src/handlers/search.ts` — search/replace handlers
- `packages/ui/src/stores/search-store.ts` — Zustand store
- `packages/ui/src/components/panels/SearchPanel.tsx` — main panel component
- `packages/ui/src/components/panels/SearchResults.tsx` — results tree
- `packages/ui/src/components/panels/SearchMatchLine.tsx` — individual match line

## Files to modify

- `packages/shared/src/constants.ts` — add SEARCH_* message constants
- `packages/shared/src/types/index.ts` — export search types
- `packages/backend/src/handlers/index.ts` (or equivalent registration) — register search handler
- `packages/ui/src/stores/ui-store.ts` — add `searchPanelOpen`, `toggleSearchPanel()`, modify `toggleFileExplorer()`
- `packages/ui/src/components/AppShell.tsx` — shared panel slot, new prop
- `packages/ui/src/components/workspace/TaskHeader.tsx` — search toggle button
- `packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts` — Cmd+Shift+F shortcut

## Dependencies

- ripgrep (`rg`) must be available on PATH — it is already installed on the dev machine. For distribution, consider bundling `@vscode/ripgrep` npm package as a fallback.

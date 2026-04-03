# Search & Replace Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code/Cursor-style Search & Replace panel that searches file contents across the workspace using ripgrep, with individual/per-file/global replace capabilities.

**Architecture:** Backend handler shells out to `rg --json` for search, reads/writes files for replacements. Frontend has a dedicated Zustand store and panel component that shares the file explorer's slot in AppShell — opening one closes the other.

**Tech Stack:** TypeScript, React 19, Zustand 5, Radix UI, Tailwind CSS 4, Lucide React, ripgrep (CLI)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/shared/src/types/search.ts` | Search payload, result, and match types |
| `packages/backend/src/handlers/search.ts` | Backend handler: rg spawning, result parsing, replace logic |
| `packages/ui/src/stores/search-store.ts` | Frontend state: query, flags, results, replace actions |
| `packages/ui/src/components/panels/SearchPanel.tsx` | Top-level panel: toolbar, inputs, results container |
| `packages/ui/src/components/panels/SearchResults.tsx` | Results tree: file groups with collapsible match lines |

### Modified files

| File | Change |
|------|--------|
| `packages/shared/src/constants.ts` | Add `SEARCH_*` message constants |
| `packages/shared/src/index.ts` | Re-export search types |
| `packages/shared/src/types/ws.ts` | Add search payload/response interfaces |
| `packages/backend/src/index.ts` | Import and register search handlers |
| `packages/ui/src/stores/ui-store.ts` | Add `searchPanelOpen`, `toggleSearchPanel()`, modify `toggleFileExplorer()` |
| `packages/ui/src/components/AppShell.tsx` | Add `searchPanel` prop, shared render slot |
| `packages/ui/src/App.tsx` | Pass `<SearchPanel />` to AppShell |
| `packages/ui/src/components/workspace/TaskHeader.tsx` | Add search toggle button |
| `packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts` | Add Cmd+Shift+F shortcut |

---

### Task 1: Shared types and constants

**Files:**
- Create: `packages/shared/src/types/search.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/types/ws.ts`

- [ ] **Step 1: Create search types**

Create `packages/shared/src/types/search.ts`:

```typescript
export interface SearchMatch {
    line: number;
    column: number;
    matchLength: number;
    lineContent: string;
}

export interface SearchFileResult {
    path: string;
    matches: SearchMatch[];
}

export interface SearchResult {
    files: SearchFileResult[];
    totalMatches: number;
    searchId: string;
}
```

- [ ] **Step 2: Add MSG constants**

In `packages/shared/src/constants.ts`, add after the `// Files` section (after `FILE_REVEAL`):

```typescript
    // Search
    SEARCH_QUERY: "search:query",
    SEARCH_CANCEL: "search:cancel",
    SEARCH_REPLACE: "search:replace",
    SEARCH_REPLACE_ALL: "search:replace-all",
```

- [ ] **Step 3: Add payload types to ws.ts**

In `packages/shared/src/types/ws.ts`, add the import at the top alongside existing type imports:

```typescript
import type { SearchFileResult, SearchMatch, SearchResult } from "./search";
```

Then add after the `FileChangedEvent` type alias (around line 301):

```typescript
// Search messages
export interface SearchQueryPayload {
    path: string;
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includePattern: string;
    excludePattern: string;
}

export interface SearchQueryResponse {
    result: SearchResult;
}

export interface SearchCancelPayload {
    searchId: string;
}

export interface SearchReplacePayload {
    path: string;
    filePath: string;
    query: string;
    replacement: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    matches: SearchMatch[];
}

export interface SearchReplaceResponse {
    replacedCount: number;
}

export interface SearchReplaceAllPayload {
    path: string;
    query: string;
    replacement: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includePattern: string;
    excludePattern: string;
    filePath?: string;
}

export interface SearchReplaceAllResponse {
    replacedCount: number;
    filesModified: number;
}
```

- [ ] **Step 4: Re-export search types**

In `packages/shared/src/index.ts`, add:

```typescript
export * from "./types/search";
```

- [ ] **Step 5: Verify build**

Run: `cd packages/shared && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/search.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/src/types/ws.ts
git commit -m "feat: add search and replace shared types and constants"
```

---

### Task 2: Backend search handler

**Files:**
- Create: `packages/backend/src/handlers/search.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create the search handler file**

Create `packages/backend/src/handlers/search.ts`:

```typescript
import { MSG } from "@taskflow/shared";
import type {
    SearchQueryPayload,
    SearchCancelPayload,
    SearchReplacePayload,
    SearchReplaceAllPayload,
    SearchQueryResponse,
    SearchReplaceResponse,
    SearchReplaceAllResponse,
} from "@taskflow/shared";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { assertWorkspacePath } from "../utils/path-validation";
import { readFile, writeFile } from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { buildShellPath } from "../services/shell-path";
import { randomUUID } from "crypto";

interface SearchHandlerDeps {
    router: Router;
    taskStore: TaskStore;
}

// Active search processes keyed by searchId, so we can cancel them.
const activeSearches = new Map<string, ChildProcess>();

function buildRgArgs(payload: SearchQueryPayload): string[] {
    const args = ["--json", "--line-number", "--column"];

    if (!payload.caseSensitive) {
        args.push("--ignore-case");
    }
    if (payload.wholeWord) {
        args.push("--word-regexp");
    }
    if (payload.useRegex) {
        args.push("--pcre2");
    }
    if (payload.includePattern) {
        for (const pattern of payload.includePattern.split(",")) {
            const trimmed = pattern.trim();
            if (trimmed) args.push("--glob", trimmed);
        }
    }
    if (payload.excludePattern) {
        for (const pattern of payload.excludePattern.split(",")) {
            const trimmed = pattern.trim();
            if (trimmed) args.push("--glob", `!${trimmed}`);
        }
    }

    args.push("--", payload.query, payload.path);
    return args;
}

interface RgMatchData {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
}

function parseRgOutput(stdout: string): { files: SearchFileResult[]; totalMatches: number } {
    const fileMap = new Map<string, SearchMatch[]>();
    let totalMatches = 0;

    for (const line of stdout.split("\n")) {
        if (!line) continue;
        let parsed: { type: string; data: RgMatchData };
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (parsed.type !== "match") continue;

        const data = parsed.data;
        const filePath = data.path.text;
        const lineContent = data.lines.text.replace(/\n$/, "");

        if (!fileMap.has(filePath)) {
            fileMap.set(filePath, []);
        }
        const matches = fileMap.get(filePath)!;

        for (const sub of data.submatches) {
            matches.push({
                line: data.line_number,
                column: sub.start + 1,
                matchLength: sub.end - sub.start,
                lineContent,
            });
            totalMatches++;
        }
    }

    const files: SearchFileResult[] = [];
    for (const [path, matches] of fileMap) {
        files.push({ path, matches });
    }
    // Sort files alphabetically
    files.sort((a, b) => a.path.localeCompare(b.path));

    return { files, totalMatches };
}

function buildSearchRegex(query: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): RegExp {
    let pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) {
        pattern = `\\b${pattern}\\b`;
    }
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
}

async function replaceInFile(
    filePath: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    useRegex: boolean,
    matchFilter?: SearchMatch[],
): Promise<number> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    let replacedCount = 0;

    // If matchFilter is provided, only replace at those specific positions
    if (matchFilter && matchFilter.length > 0) {
        // Process from bottom to top so line/column offsets stay valid
        const sorted = [...matchFilter].sort((a, b) =>
            a.line !== b.line ? b.line - a.line : b.column - a.column,
        );
        for (const match of sorted) {
            const lineIdx = match.line - 1;
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            const line = lines[lineIdx];
            const colIdx = match.column - 1;
            if (colIdx < 0 || colIdx > line.length) continue;
            lines[lineIdx] =
                line.slice(0, colIdx) +
                replacement +
                line.slice(colIdx + match.matchLength);
            replacedCount++;
        }
    } else {
        // Replace all occurrences using regex
        const regex = buildSearchRegex(query, caseSensitive, wholeWord, useRegex);
        for (let i = 0; i < lines.length; i++) {
            const original = lines[i];
            lines[i] = original.replace(regex, replacement);
            // Count replacements by comparing
            regex.lastIndex = 0;
            const matches = original.match(regex);
            if (matches) replacedCount += matches.length;
        }
    }

    if (replacedCount > 0) {
        await writeFile(filePath, lines.join("\n"), "utf-8");
    }
    return replacedCount;
}

export function registerSearchHandlers(deps: SearchHandlerDeps): void {
    const { router, taskStore } = deps;

    router.register(MSG.SEARCH_QUERY, async (payload) => {
        const { path, query } = payload as SearchQueryPayload;
        if (!query) return { result: { files: [], totalMatches: 0, searchId: "" } };

        await assertWorkspacePath(taskStore, path);

        const searchId = randomUUID();
        const args = buildRgArgs(payload as SearchQueryPayload);

        return new Promise<SearchQueryResponse>((resolve) => {
            const child = spawn("rg", args, {
                env: { ...process.env, PATH: buildShellPath() },
                stdio: ["ignore", "pipe", "pipe"],
            });

            activeSearches.set(searchId, child);
            const chunks: Buffer[] = [];

            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

            child.on("close", () => {
                activeSearches.delete(searchId);
                const stdout = Buffer.concat(chunks).toString("utf-8");
                const { files, totalMatches } = parseRgOutput(stdout);
                resolve({ result: { files, totalMatches, searchId } });
            });

            child.on("error", () => {
                activeSearches.delete(searchId);
                resolve({ result: { files: [], totalMatches: 0, searchId } });
            });
        });
    });

    router.register(MSG.SEARCH_CANCEL, async (payload) => {
        const { searchId } = payload as SearchCancelPayload;
        const child = activeSearches.get(searchId);
        if (child) {
            child.kill("SIGTERM");
            activeSearches.delete(searchId);
        }
        return {};
    });

    router.register(MSG.SEARCH_REPLACE, async (payload) => {
        const p = payload as SearchReplacePayload;
        await assertWorkspacePath(taskStore, p.path);

        const replacedCount = await replaceInFile(
            p.filePath,
            p.query,
            p.replacement,
            p.caseSensitive,
            p.wholeWord,
            p.useRegex,
            p.matches,
        );
        return { replacedCount } satisfies SearchReplaceResponse;
    });

    router.register(MSG.SEARCH_REPLACE_ALL, async (payload) => {
        const p = payload as SearchReplaceAllPayload;
        await assertWorkspacePath(taskStore, p.path);

        // First, run a search to find all current matches
        const args = buildRgArgs({
            path: p.path,
            query: p.query,
            caseSensitive: p.caseSensitive,
            wholeWord: p.wholeWord,
            useRegex: p.useRegex,
            includePattern: p.includePattern,
            excludePattern: p.excludePattern,
        });

        const searchResult = await new Promise<{ files: SearchFileResult[] }>((resolve) => {
            const child = spawn("rg", args, {
                env: { ...process.env, PATH: buildShellPath() },
                stdio: ["ignore", "pipe", "pipe"],
            });

            const chunks: Buffer[] = [];
            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

            child.on("close", () => {
                const stdout = Buffer.concat(chunks).toString("utf-8");
                resolve(parseRgOutput(stdout));
            });

            child.on("error", () => resolve({ files: [] }));
        });

        // Filter to a single file if filePath is specified
        const filesToProcess = p.filePath
            ? searchResult.files.filter((f) => f.path === p.filePath)
            : searchResult.files;

        let totalReplaced = 0;
        let filesModified = 0;

        for (const file of filesToProcess) {
            const count = await replaceInFile(
                file.path,
                p.query,
                p.replacement,
                p.caseSensitive,
                p.wholeWord,
                p.useRegex,
            );
            if (count > 0) {
                totalReplaced += count;
                filesModified++;
            }
        }

        return { replacedCount: totalReplaced, filesModified } satisfies SearchReplaceAllResponse;
    });
}
```

- [ ] **Step 2: Register the handler in backend index**

In `packages/backend/src/index.ts`, add the import alongside the other handler imports (around line 48):

```typescript
import { registerSearchHandlers } from "./handlers/search";
```

Then add the registration call after `registerTypeScriptHandlers` (around line 294):

```typescript
        registerSearchHandlers({
            router,
            taskStore: store,
        });
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/search.ts packages/backend/src/index.ts
git commit -m "feat: add backend search and replace handler using ripgrep"
```

---

### Task 3: UI store changes

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add searchPanelOpen state and actions**

In `packages/ui/src/stores/ui-store.ts`, add to the `UIStore` interface (after `fileExplorerOpen: boolean;`):

```typescript
    searchPanelOpen: boolean;
```

Add to the interface actions section (after `toggleFileExplorer(): void;`):

```typescript
    toggleSearchPanel(): void;
```

Add the default state (after `fileExplorerOpen: false,`):

```typescript
    searchPanelOpen: false,
```

- [ ] **Step 2: Modify toggleFileExplorer**

Replace the existing `toggleFileExplorer` implementation:

```typescript
    toggleFileExplorer() {
        set((s) => ({
            fileExplorerOpen: !s.fileExplorerOpen,
            ...(!s.fileExplorerOpen ? { searchPanelOpen: false } : {}),
        }));
    },
```

- [ ] **Step 3: Add toggleSearchPanel**

Add after `toggleFileExplorer`:

```typescript
    toggleSearchPanel() {
        set((s) => ({
            searchPanelOpen: !s.searchPanelOpen,
            ...(!s.searchPanelOpen ? { fileExplorerOpen: false } : {}),
        }));
    },
```

- [ ] **Step 4: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add searchPanelOpen state and mutual exclusion with file explorer"
```

---

### Task 4: Search store

**Files:**
- Create: `packages/ui/src/stores/search-store.ts`

- [ ] **Step 1: Create the search store**

Create `packages/ui/src/stores/search-store.ts`:

```typescript
import { create } from "zustand";
import type { SearchFileResult, SearchMatch, SearchResult } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import type {
    SearchQueryResponse,
    SearchReplaceResponse,
    SearchReplaceAllResponse,
} from "@taskflow/shared";

interface SearchStore {
    query: string;
    replacement: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includePattern: string;
    excludePattern: string;
    results: SearchFileResult[];
    totalMatches: number;
    searchId: string | null;
    searching: boolean;
    expandedFiles: Set<string>;
    error: string | null;

    setQuery(query: string): void;
    setReplacement(replacement: string): void;
    toggleCaseSensitive(): void;
    toggleWholeWord(): void;
    toggleUseRegex(): void;
    setIncludePattern(pattern: string): void;
    setExcludePattern(pattern: string): void;
    search(rootPath: string): Promise<void>;
    cancel(): Promise<void>;
    replaceMatch(rootPath: string, filePath: string, match: SearchMatch): Promise<void>;
    replaceInFile(rootPath: string, filePath: string): Promise<void>;
    replaceAll(rootPath: string, filePath?: string): Promise<void>;
    toggleFileExpanded(path: string): void;
    removeMatch(filePath: string, match: SearchMatch): void;
    removeFile(filePath: string): void;
    clear(): void;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    includePattern: "",
    excludePattern: "",
    results: [],
    totalMatches: 0,
    searchId: null,
    searching: false,
    expandedFiles: new Set<string>(),
    error: null,

    setQuery(query) {
        set({ query });
    },
    setReplacement(replacement) {
        set({ replacement });
    },
    toggleCaseSensitive() {
        set((s) => ({ caseSensitive: !s.caseSensitive }));
    },
    toggleWholeWord() {
        set((s) => ({ wholeWord: !s.wholeWord }));
    },
    toggleUseRegex() {
        set((s) => ({ useRegex: !s.useRegex }));
    },
    setIncludePattern(pattern) {
        set({ includePattern: pattern });
    },
    setExcludePattern(pattern) {
        set({ excludePattern: pattern });
    },

    async search(rootPath) {
        const state = get();
        if (!state.query) {
            set({ results: [], totalMatches: 0, searchId: null, error: null });
            return;
        }

        // Cancel any in-flight search
        if (state.searchId) {
            await get().cancel();
        }

        set({ searching: true, error: null });

        try {
            const response = await sendRequest<SearchQueryResponse>(MSG.SEARCH_QUERY, {
                path: rootPath,
                query: state.query,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
            });

            // Expand all files by default
            const expanded = new Set<string>();
            for (const file of response.result.files) {
                expanded.add(file.path);
            }

            set({
                results: response.result.files,
                totalMatches: response.result.totalMatches,
                searchId: response.result.searchId,
                searching: false,
                expandedFiles: expanded,
            });
        } catch (err) {
            set({
                searching: false,
                error: err instanceof Error ? err.message : "Search failed",
            });
        }
    },

    async cancel() {
        const { searchId } = get();
        if (searchId) {
            try {
                await sendRequest(MSG.SEARCH_CANCEL, { searchId });
            } catch {
                // Ignore cancel errors
            }
            set({ searchId: null, searching: false });
        }
    },

    async replaceMatch(rootPath, filePath, match) {
        const state = get();
        try {
            await sendRequest<SearchReplaceResponse>(MSG.SEARCH_REPLACE, {
                path: rootPath,
                filePath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                matches: [match],
            });

            // Remove the replaced match from results
            get().removeMatch(filePath, match);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceInFile(rootPath, filePath) {
        const state = get();
        try {
            await sendRequest<SearchReplaceAllResponse>(MSG.SEARCH_REPLACE_ALL, {
                path: rootPath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
                filePath,
            });

            // Remove the file from results
            get().removeFile(filePath);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceAll(rootPath, filePath) {
        const state = get();
        try {
            await sendRequest<SearchReplaceAllResponse>(MSG.SEARCH_REPLACE_ALL, {
                path: rootPath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
                filePath,
            });

            if (filePath) {
                get().removeFile(filePath);
            } else {
                set({ results: [], totalMatches: 0 });
            }
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace all failed" });
        }
    },

    toggleFileExpanded(path) {
        set((s) => {
            const next = new Set(s.expandedFiles);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return { expandedFiles: next };
        });
    },

    removeMatch(filePath, match) {
        set((s) => {
            const results = s.results
                .map((file) => {
                    if (file.path !== filePath) return file;
                    const filtered = file.matches.filter(
                        (m) => m.line !== match.line || m.column !== match.column,
                    );
                    if (filtered.length === 0) return null;
                    return { ...file, matches: filtered };
                })
                .filter((f): f is SearchFileResult => f !== null);

            const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
            return { results, totalMatches };
        });
    },

    removeFile(filePath) {
        set((s) => {
            const results = s.results.filter((f) => f.path !== filePath);
            const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
            return { results, totalMatches };
        });
    },

    clear() {
        set({
            query: "",
            replacement: "",
            results: [],
            totalMatches: 0,
            searchId: null,
            searching: false,
            expandedFiles: new Set<string>(),
            error: null,
        });
    },
}));
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/search-store.ts
git commit -m "feat: add search store with query, replace, and result management"
```

---

### Task 5: SearchResults component

**Files:**
- Create: `packages/ui/src/components/panels/SearchResults.tsx`

- [ ] **Step 1: Create the SearchResults component**

Create `packages/ui/src/components/panels/SearchResults.tsx`:

```typescript
import { useCallback, Fragment } from "react";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import { useSearchStore } from "@/stores/search-store";
import { ChevronDown, ChevronRight, Replace, ReplaceAll, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileIcon } from "./FileIcon";
import { cn } from "@/lib/utils";

interface SearchResultsProps {
    rootPath: string;
    results: SearchFileResult[];
    totalMatches: number;
    onFileClick: (path: string, line: number) => void;
}

function HighlightedLine({ lineContent, column, matchLength }: {
    lineContent: string;
    column: number;
    matchLength: number;
}) {
    const before = lineContent.slice(0, column - 1);
    const match = lineContent.slice(column - 1, column - 1 + matchLength);
    const after = lineContent.slice(column - 1 + matchLength);

    return (
        <span className="whitespace-pre">
            {before}
            <span className="bg-accent/30 text-accent-foreground font-semibold rounded-sm">
                {match}
            </span>
            {after}
        </span>
    );
}

function MatchLine({
    match,
    filePath,
    rootPath,
    replacement,
    onFileClick,
}: {
    match: SearchMatch;
    filePath: string;
    rootPath: string;
    replacement: string;
    onFileClick: (path: string, line: number) => void;
}) {
    const replaceMatch = useSearchStore((s) => s.replaceMatch);
    const removeMatch = useSearchStore((s) => s.removeMatch);

    const handleReplace = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            void replaceMatch(rootPath, filePath, match);
        },
        [replaceMatch, rootPath, filePath, match],
    );

    const handleDismiss = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            removeMatch(filePath, match);
        },
        [removeMatch, filePath, match],
    );

    return (
        <div
            className="group hover:bg-muted/50 flex cursor-pointer items-center gap-1 py-0.5 pr-1"
            style={{ paddingLeft: 32 }}
            onClick={() => onFileClick(filePath, match.line)}>
            <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
                {match.line}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
                <HighlightedLine
                    lineContent={match.lineContent}
                    column={match.column}
                    matchLength={match.matchLength}
                />
            </span>
            {replacement !== undefined && (
                <Button
                    variant="ghost"
                    size="icon-2xs"
                    onClick={handleReplace}
                    aria-label="Replace this match"
                    className="shrink-0 opacity-0 group-hover:opacity-100">
                    <Replace className="h-3 w-3" />
                </Button>
            )}
            <Button
                variant="ghost"
                size="icon-2xs"
                onClick={handleDismiss}
                aria-label="Dismiss this match"
                className="shrink-0 opacity-0 group-hover:opacity-100">
                <X className="h-3 w-3" />
            </Button>
        </div>
    );
}

function FileGroup({
    file,
    rootPath,
    replacement,
    onFileClick,
}: {
    file: SearchFileResult;
    rootPath: string;
    replacement: string;
    onFileClick: (path: string, line: number) => void;
}) {
    const expanded = useSearchStore((s) => s.expandedFiles.has(file.path));
    const toggleFileExpanded = useSearchStore((s) => s.toggleFileExpanded);
    const replaceInFile = useSearchStore((s) => s.replaceInFile);
    const removeFile = useSearchStore((s) => s.removeFile);

    const relativePath = file.path.startsWith(rootPath + "/")
        ? file.path.slice(rootPath.length + 1)
        : file.path;
    const fileName = relativePath.split("/").pop() ?? relativePath;
    const dirPath = relativePath.includes("/")
        ? relativePath.slice(0, relativePath.lastIndexOf("/"))
        : "";

    const handleToggle = useCallback(() => {
        toggleFileExpanded(file.path);
    }, [toggleFileExpanded, file.path]);

    const handleReplaceInFile = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            void replaceInFile(rootPath, file.path);
        },
        [replaceInFile, rootPath, file.path],
    );

    const handleDismissFile = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            removeFile(file.path);
        },
        [removeFile, file.path],
    );

    return (
        <div>
            <div
                className="group hover:bg-muted/50 flex cursor-pointer items-center gap-1 px-1 py-0.5"
                onClick={handleToggle}>
                {expanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <FileIcon name={fileName} isDirectory={false} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-xs font-medium">{fileName}</span>
                {dirPath && (
                    <span className="text-muted-foreground min-w-0 shrink truncate text-xs">
                        {dirPath}
                    </span>
                )}
                <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-1.5 text-xs tabular-nums">
                    {file.matches.length}
                </span>
                {replacement !== undefined && (
                    <Button
                        variant="ghost"
                        size="icon-2xs"
                        onClick={handleReplaceInFile}
                        aria-label="Replace all in file"
                        className="shrink-0 opacity-0 group-hover:opacity-100">
                        <ReplaceAll className="h-3 w-3" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon-2xs"
                    onClick={handleDismissFile}
                    aria-label="Dismiss file"
                    className="shrink-0 opacity-0 group-hover:opacity-100">
                    <X className="h-3 w-3" />
                </Button>
            </div>
            {expanded &&
                file.matches.map((match, idx) => (
                    <MatchLine
                        key={`${match.line}:${match.column}:${idx}`}
                        match={match}
                        filePath={file.path}
                        rootPath={rootPath}
                        replacement={replacement}
                        onFileClick={onFileClick}
                    />
                ))}
        </div>
    );
}

function SearchResults({ rootPath, results, totalMatches, onFileClick }: SearchResultsProps) {
    const replacement = useSearchStore((s) => s.replacement);

    if (results.length === 0) return null;

    return (
        <div className="flex flex-col">
            <div className="text-muted-foreground px-2 py-1 text-xs">
                {totalMatches} result{totalMatches !== 1 ? "s" : ""} in {results.length} file
                {results.length !== 1 ? "s" : ""}
            </div>
            <div>
                {results.map((file) => (
                    <FileGroup
                        key={file.path}
                        file={file}
                        rootPath={rootPath}
                        replacement={replacement}
                        onFileClick={onFileClick}
                    />
                ))}
            </div>
        </div>
    );
}

export { SearchResults };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/SearchResults.tsx
git commit -m "feat: add SearchResults component with file groups and match highlighting"
```

---

### Task 6: SearchPanel component

**Files:**
- Create: `packages/ui/src/components/panels/SearchPanel.tsx`

- [ ] **Step 1: Create the SearchPanel component**

Create `packages/ui/src/components/panels/SearchPanel.tsx`:

```typescript
import { useCallback, useEffect, useRef } from "react";
import {
    X,
    CaseSensitive,
    WholeWord,
    Regex,
    Filter,
    ReplaceAll,
} from "lucide-react";
import { useSearchStore } from "@/stores/search-store";
import { useUIStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { openFileInApp } from "@/lib/open-file";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";
import useIsElectron from "@/hooks/useIsElectron";
import { SearchResults } from "./SearchResults";
import { cn } from "@/lib/utils";
import { useState } from "react";

function SearchPanel() {
    const workspace = useActiveWorkspace();
    const workingDir = workspace.workingDir;
    const taskId = workspace.task?.id;
    const projectId = workspace.project?.id;
    const workspaceKey = workspace.workspaceKey;
    const isElectron = useIsElectron();
    const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel);

    const query = useSearchStore((s) => s.query);
    const replacement = useSearchStore((s) => s.replacement);
    const caseSensitive = useSearchStore((s) => s.caseSensitive);
    const wholeWord = useSearchStore((s) => s.wholeWord);
    const useRegex = useSearchStore((s) => s.useRegex);
    const includePattern = useSearchStore((s) => s.includePattern);
    const excludePattern = useSearchStore((s) => s.excludePattern);
    const results = useSearchStore((s) => s.results);
    const totalMatches = useSearchStore((s) => s.totalMatches);
    const searching = useSearchStore((s) => s.searching);
    const error = useSearchStore((s) => s.error);

    const setQuery = useSearchStore((s) => s.setQuery);
    const setReplacement = useSearchStore((s) => s.setReplacement);
    const toggleCaseSensitive = useSearchStore((s) => s.toggleCaseSensitive);
    const toggleWholeWord = useSearchStore((s) => s.toggleWholeWord);
    const toggleUseRegex = useSearchStore((s) => s.toggleUseRegex);
    const setIncludePattern = useSearchStore((s) => s.setIncludePattern);
    const setExcludePattern = useSearchStore((s) => s.setExcludePattern);
    const search = useSearchStore((s) => s.search);
    const replaceAll = useSearchStore((s) => s.replaceAll);
    const clear = useSearchStore((s) => s.clear);

    const [showFilters, setShowFilters] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-search with debounce
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (!workingDir || !query) {
            return;
        }

        // Auto-trigger on 3+ chars, otherwise wait for Enter
        if (query.length >= 3) {
            debounceRef.current = setTimeout(() => {
                void search(workingDir);
            }, 300);
        }

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, caseSensitive, wholeWord, useRegex, includePattern, excludePattern, workingDir, search]);

    // Focus search input on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && workingDir) {
                e.preventDefault();
                void search(workingDir);
            }
            if (e.key === "Escape") {
                if (results.length > 0 || query) {
                    clear();
                } else {
                    toggleSearchPanel();
                }
            }
        },
        [workingDir, search, results.length, query, clear, toggleSearchPanel],
    );

    const handleReplaceKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                if (results.length > 0 || query) {
                    clear();
                } else {
                    toggleSearchPanel();
                }
            }
        },
        [results.length, query, clear, toggleSearchPanel],
    );

    const handleReplaceAll = useCallback(() => {
        if (!workingDir) return;
        void replaceAll(workingDir);
    }, [workingDir, replaceAll]);

    const handleFileClick = useCallback(
        (path: string, line: number) => {
            const owner = taskId ? { taskId } : projectId ? { projectId } : undefined;
            void openFileInApp(path, workspaceKey, owner, line);
        },
        [taskId, projectId, workspaceKey],
    );

    return (
        <div className="flex h-full flex-col">
            <Toolbar className={`gap-2 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
                <span className="text-muted-foreground ml-2 flex h-6 items-center text-xs font-medium">
                    Search
                </span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleSearchPanel}
                    aria-label="Hide search panel"
                    tooltip="Hide search panel"
                    tooltipSide="bottom"
                    className="[-webkit-app-region:no-drag]">
                    <X className="h-3 w-3" />
                </Button>
            </Toolbar>

            <div className="flex flex-col gap-1.5 p-2">
                {/* Search input */}
                <div className="border-border bg-background flex items-center rounded-md border">
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search"
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
                    />
                    <Button
                        variant={caseSensitive ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleCaseSensitive}
                        aria-label="Match case"
                        tooltip="Match case"
                        tooltipSide="bottom">
                        <CaseSensitive className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={wholeWord ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleWholeWord}
                        aria-label="Match whole word"
                        tooltip="Match whole word"
                        tooltipSide="bottom">
                        <WholeWord className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={useRegex ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleUseRegex}
                        aria-label="Use regular expression"
                        tooltip="Use regular expression"
                        tooltipSide="bottom">
                        <Regex className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Replace input */}
                <div className="border-border bg-background flex items-center rounded-md border">
                    <input
                        type="text"
                        value={replacement}
                        onChange={(e) => setReplacement(e.target.value)}
                        onKeyDown={handleReplaceKeyDown}
                        placeholder="Replace"
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
                    />
                    <Button
                        variant="ghost"
                        size="icon-2xs"
                        onClick={handleReplaceAll}
                        disabled={results.length === 0}
                        aria-label="Replace all"
                        tooltip="Replace all"
                        tooltipSide="bottom">
                        <ReplaceAll className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={showFilters ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={() => setShowFilters(!showFilters)}
                        aria-label="Toggle file filters"
                        tooltip="Toggle file filters"
                        tooltipSide="bottom">
                        <Filter className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* File filters */}
                {showFilters && (
                    <div className="flex flex-col gap-1">
                        <input
                            type="text"
                            value={includePattern}
                            onChange={(e) => setIncludePattern(e.target.value)}
                            placeholder="Files to include (e.g. *.ts, src/**)"
                            className="border-border bg-background rounded-md border px-2 py-1 text-xs outline-none"
                        />
                        <input
                            type="text"
                            value={excludePattern}
                            onChange={(e) => setExcludePattern(e.target.value)}
                            placeholder="Files to exclude (e.g. *.test.ts, dist/**)"
                            className="border-border bg-background rounded-md border px-2 py-1 text-xs outline-none"
                        />
                    </div>
                )}

                {/* Status */}
                {searching && (
                    <div className="text-muted-foreground text-xs">Searching...</div>
                )}
                {error && (
                    <div className="text-destructive text-xs">{error}</div>
                )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-x-auto overflow-y-auto">
                {workingDir && (
                    <SearchResults
                        rootPath={workingDir}
                        results={results}
                        totalMatches={totalMatches}
                        onFileClick={handleFileClick}
                    />
                )}
                {!searching && query && results.length === 0 && !error && (
                    <div className="text-muted-foreground px-2 py-1 text-xs">No results found</div>
                )}
            </div>
        </div>
    );
}

export { SearchPanel };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/SearchPanel.tsx
git commit -m "feat: add SearchPanel component with search/replace inputs and filter controls"
```

---

### Task 7: Wire up AppShell, App.tsx, and TaskHeader

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

- [ ] **Step 1: Update AppShell props and render slot**

In `packages/ui/src/components/AppShell.tsx`:

Add `searchPanel` to the interface:

```typescript
interface AppShellProps {
    sidebar: ReactNode;
    fileExplorer: ReactNode;
    searchPanel: ReactNode;
    flowPanel?: ReactNode;
    workspace: ReactNode;
    taskInfo: ReactNode;
}
```

Update the destructured props:

```typescript
export function AppShell({ sidebar, fileExplorer, searchPanel, flowPanel, workspace, taskInfo }: AppShellProps) {
```

Add `searchPanelOpen` state reader alongside `fileExplorerOpen` (around line 32):

```typescript
    const searchPanelOpen = useUIStore((s) => s.searchPanelOpen);
```

Replace the `fileExplorerOpen` panel registration effect (lines 129-134) to cover both panels:

```typescript
    useEffect(() => {
        if (fileExplorerOpen || searchPanelOpen) {
            registerPanel("fileexplorer");
            return () => unregisterPanel("fileexplorer");
        }
    }, [fileExplorerOpen, searchPanelOpen, registerPanel, unregisterPanel]);
```

Replace the file explorer render block (lines 201-223) — the two conditional blocks for the panel and its resize handle — with:

```typescript
                {(fileExplorerOpen || searchPanelOpen) && (
                    <div
                        className={cn(
                            "bg-card border-border/50 panel-shadow flex shrink-0 flex-col overflow-hidden rounded-(--window-radius) border",
                            (showOutline || navigationMode) &&
                                focusedPanel === "fileexplorer" &&
                                "ring-accent/50 ring-1 transition-shadow duration-500",
                        )}
                        data-panel="fileexplorer"
                        onPointerDown={handlePanelPointerDown}
                        onClick={() => handlePanelClick("fileexplorer")}
                        style={{ width: fileExplorerWidth }}>
                        {fileExplorerOpen ? fileExplorer : searchPanel}
                    </div>
                )}

                {(fileExplorerOpen || searchPanelOpen) && (
                    <ResizeHandle
                        onResize={handleFileExplorerResize}
                        onResizeEnd={handleResizeEnd}
                        panelGap={innerPanelGap}
                    />
                )}
```

- [ ] **Step 2: Pass SearchPanel in App.tsx**

In `packages/ui/src/App.tsx`, add the import:

```typescript
import { SearchPanel } from "@/components/panels/SearchPanel";
```

Add the `searchPanel` prop to the `<AppShell>` call (after `fileExplorer={<FileExplorer />}`):

```typescript
                    <AppShell
                        sidebar={<TaskSidebar />}
                        fileExplorer={<FileExplorer />}
                        searchPanel={<SearchPanel />}
                        flowPanel={...}
```

- [ ] **Step 3: Add search toggle button to TaskHeader**

In `packages/ui/src/components/workspace/TaskHeader.tsx`, add the import:

```typescript
import { Search } from "lucide-react";
```

Add state readers near the existing `toggleFileExplorer` (around line 86-87):

```typescript
    const searchPanelOpen = useUIStore((s) => s.searchPanelOpen);
    const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel);
```

Add the search button right after the file explorer button (after the `<FolderTree>` button, around line 295):

```typescript
                    <Button
                        variant={searchPanelOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={toggleSearchPanel}
                        aria-pressed={searchPanelOpen}
                        aria-label={searchPanelOpen ? "Hide search" : "Show search"}
                        tooltip={searchPanelOpen ? "Hide search" : "Show search"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]">
                        <Search className="h-4 w-4" />
                    </Button>
```

- [ ] **Step 4: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx packages/ui/src/App.tsx packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat: wire search panel into AppShell, App, and TaskHeader toggle"
```

---

### Task 8: Keyboard shortcut (Cmd+Shift+F)

**Files:**
- Modify: `packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts`

- [ ] **Step 1: Add Cmd+Shift+F shortcut**

In `packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts`:

Add `toggleSearchPanel` to the store readers (after `toggleFileExplorer` around line 30):

```typescript
    const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel);
```

Add a fallback flag (after `needsTaskInfoFallback` around line 130):

```typescript
        const needsSearchPanelFallback = !window.taskflow?.onToggleSearchPanel;
```

Add the keyboard handler in the `onKeyDown` function, after the `needsMarkdownInputFallback` block (after line 180) and before the `needsFileExplorerFallback` block:

```typescript
            if (e.shiftKey && needsSearchPanelFallback && e.key.toLowerCase() === "f") {
                e.preventDefault();
                toggleSearchPanel();
                return;
            }
```

Add `toggleSearchPanel` to the effect dependency array (around line 253).

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/hooks/useWorkspaceKeyboardShortcuts.ts
git commit -m "feat: add Cmd+Shift+F keyboard shortcut to toggle search panel"
```

---

### Task 9: Verify openFileInApp supports line parameter

**Files:**
- Potentially modify: `packages/ui/src/lib/open-file.ts`

- [ ] **Step 1: Check openFileInApp signature**

Read `packages/ui/src/lib/open-file.ts` and check if `openFileInApp` accepts a `line` parameter. In Task 6, `SearchPanel` calls `openFileInApp(path, workspaceKey, owner, line)` with a line number.

If the function does not accept a `line` parameter, add it as an optional fourth parameter and pass it through to the session creation payload (the `SessionCreatePayload` type already has a `line?: number` field).

If it already supports a line parameter, this task is a no-op.

- [ ] **Step 2: Verify build if changed**

Run: `cd packages/ui && bun run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit if changed**

```bash
git add packages/ui/src/lib/open-file.ts
git commit -m "feat: support line parameter in openFileInApp for search result navigation"
```

---

### Task 10: Manual integration test

- [ ] **Step 1: Start the app**

Run: `bun run dev` (or however the dev server starts)

- [ ] **Step 2: Verify panel toggle**

1. Select a project or task
2. Click the Search icon in the task header — search panel should appear, file explorer should close
3. Click the FolderTree icon — file explorer should appear, search panel should close
4. Press `Cmd+Shift+F` — search panel should toggle

- [ ] **Step 3: Verify search**

1. Open search panel
2. Type a search query with 3+ chars — results should appear after debounce
3. Toggle case sensitivity, whole word, regex buttons — results should update
4. Click the filter icon, add include/exclude patterns — results should update
5. Click a match line — file should open in editor at that line

- [ ] **Step 4: Verify replace**

1. Type a replacement string
2. Hover a match line — replace button should appear; click it — match should be replaced and removed from results
3. Hover a file header — replace-in-file button should appear; click it — all matches in that file should be replaced
4. Click replace-all button next to replace input — all matches should be replaced

- [ ] **Step 5: Verify keyboard shortcuts**

1. Press Escape with results showing — should clear query
2. Press Escape with empty query — should close panel
3. Press Enter in search input — should trigger search

- [ ] **Step 6: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during search panel integration testing"
```

# Command Palette (Cmd+Shift+P) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cmd+Shift+P command palette that fuzzy-filters and runs standalone Taskflow actions and package.json scripts in the current task context.

**Architecture:** New `CommandPaletteDialog` built on the existing Radix `Dialog` primitives, with open state in `ui-store`. Data and execution come entirely from the existing `useRunMenu` hook (scripts + standalone actions + `onRunScript`/`onRunAction` callbacks). A small in-house fuzzy matcher in `lib/` drives filtering and match highlighting. The shortcut is registered the same dual way as `Cmd+/`: an Electron menu accelerator (View menu → IPC → preload bridge) plus a native `keydown` fallback in `usePanelNavigation`.

**Tech Stack:** React 19, TypeScript, Zustand, Radix Dialog (`radix-ui`), Tailwind, `bun test`, Electron.

**Spec:** `docs/superpowers/specs/2026-06-07-command-palette-design.md`

**Project rules (from CLAUDE.md):**
- Use `bun`, never npm/yarn.
- No `Co-Authored-By` lines in commits.
- No `as any`. No exports that aren't consumed.
- This session runs inside a Taskflow task. After each commit, log it:
  `taskflow-cli log commit "<message>" --hash <short-hash>` and log each
  edited file: `taskflow-cli log file "<path relative to repo root>"`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/ui/src/lib/fuzzy-match.ts` | Create | Fuzzy subsequence matcher with scoring + match indices |
| `packages/ui/src/lib/fuzzy-match.test.ts` | Create | Unit tests for the matcher |
| `packages/ui/src/stores/ui-store.ts` | Modify | `commandPaletteOpen` state + setter/toggle |
| `packages/ui/src/components/CommandPaletteDialog.tsx` | Create | The palette dialog: input, grouped list, keyboard nav, execution |
| `packages/ui/src/App.tsx` | Modify | Mount `<CommandPaletteDialog />` |
| `packages/ui/src/hooks/usePanelNavigation.ts` | Modify | Web `Cmd+Shift+P` keydown fallback |
| `electron/src/app-menu.ts` | Modify | View menu item with `CmdOrCtrl+Shift+P` accelerator |
| `electron/src/preload.ts` | Modify | `onOpenCommandPalette` IPC bridge |
| `packages/ui/src/env.d.ts` | Modify | `onOpenCommandPalette` on `TaskflowBridge` |
| `packages/ui/src/components/KeyboardShortcutsDialog.tsx` | Modify | Document the new shortcut |

---

### Task 1: Fuzzy matcher

**Files:**
- Create: `packages/ui/src/lib/fuzzy-match.ts`
- Test: `packages/ui/src/lib/fuzzy-match.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/lib/fuzzy-match.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { fuzzyMatch } from "./fuzzy-match";

describe("fuzzyMatch", () => {
    it("matches a subsequence and returns its indices", () => {
        const result = fuzzyMatch("dpl", "deploy");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([0, 2, 4]);
    });

    it("returns null when the query is not a subsequence", () => {
        expect(fuzzyMatch("xyz", "deploy")).toBeNull();
        expect(fuzzyMatch("deployx", "deploy")).toBeNull();
    });

    it("matches everything with an empty query", () => {
        expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    });

    it("is case-insensitive but reports indices of the original text", () => {
        const result = fuzzyMatch("BD", "Build: Dev");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([0, 7]);
    });

    it("scores an exact contiguous match above a scattered match", () => {
        const exact = fuzzyMatch("dev", "dev");
        const scattered = fuzzyMatch("dev", "deploy:verify");
        expect(exact).not.toBeNull();
        expect(scattered).not.toBeNull();
        expect(exact!.score).toBeGreaterThan(scattered!.score);
    });

    it("scores word-start matches above mid-word matches", () => {
        const wordStart = fuzzyMatch("lf", "lint:fix");
        const midWord = fuzzyMatch("lf", "wolfram");
        expect(wordStart).not.toBeNull();
        expect(midWord).not.toBeNull();
        expect(wordStart!.score).toBeGreaterThan(midWord!.score);
    });

    it("prefers the shorter candidate when bonuses are equal", () => {
        const short = fuzzyMatch("build", "build");
        const long = fuzzyMatch("build", "build:backend");
        expect(short!.score).toBeGreaterThan(long!.score);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kuindji/Projects/taskflow && bun test packages/ui/src/lib/fuzzy-match.test.ts`
Expected: FAIL — cannot resolve `./fuzzy-match`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/lib/fuzzy-match.ts`:

```ts
interface FuzzyMatchResult {
    score: number;
    indices: number[];
}

const WORD_CHAR = /[a-z0-9]/i;

/**
 * Case-insensitive greedy subsequence match.
 *
 * Scoring: +1 per matched char, +4 when the match continues the previous
 * one (consecutive), +3 when it lands on a word start (string start or
 * preceded by a non-alphanumeric char). The total is scaled by 100 and the
 * candidate length subtracted so shorter candidates win ties.
 *
 * Greedy matching is not guaranteed to find the highest-scoring alignment;
 * that's an accepted trade-off for the small lists the palette filters.
 *
 * Returns null when `query` is not a subsequence of `text`.
 */
function fuzzyMatch(query: string, text: string): FuzzyMatchResult | null {
    if (query.length === 0) return { score: 0, indices: [] };

    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const indices: number[] = [];
    let score = 0;
    let searchFrom = 0;

    for (const char of q) {
        const idx = t.indexOf(char, searchFrom);
        if (idx === -1) return null;

        let charScore = 1;
        if (indices.length > 0 && idx === indices[indices.length - 1] + 1) {
            charScore += 4;
        }
        if (idx === 0 || !WORD_CHAR.test(text[idx - 1])) {
            charScore += 3;
        }

        score += charScore;
        indices.push(idx);
        searchFrom = idx + 1;
    }

    return { score: score * 100 - text.length, indices };
}

// FuzzyMatchResult is intentionally not exported — nothing consumes it yet
// (project rule: don't export until necessary).
export { fuzzyMatch };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kuindji/Projects/taskflow && bun test packages/ui/src/lib/fuzzy-match.test.ts`
Expected: 7 pass, 0 fail.

Sanity-check the two comparison tests by hand if anything fails:
`"dev"` vs `"dev"` → (1+3) + (1+4) + (1+4) = 14 → 1397; `"dev"` vs `"deploy:verify"` → d=4, e=5, v(idx 7, after ":")=4 → 13 → 1287.

- [ ] **Step 5: Commit and log**

```bash
git add packages/ui/src/lib/fuzzy-match.ts packages/ui/src/lib/fuzzy-match.test.ts
git commit -m "feat(ui): fuzzy subsequence matcher for command palette"
taskflow-cli log commit "feat(ui): fuzzy subsequence matcher for command palette" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "packages/ui/src/lib/fuzzy-match.ts"
taskflow-cli log file "packages/ui/src/lib/fuzzy-match.test.ts"
```

---

### Task 2: Palette open state in ui-store

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add state + actions**

In the `UIStore` interface, after `agentOperationsHelpOpen: boolean;` (line 62):

```ts
    commandPaletteOpen: boolean;
```

After `setAgentOperationsHelpOpen(open: boolean): void;` (line 88):

```ts
    setCommandPaletteOpen(open: boolean): void;
    toggleCommandPalette(): void;
```

In the store initializer, after `agentOperationsHelpOpen: false,` (line 129):

```ts
    commandPaletteOpen: false,
```

After the `setAgentOperationsHelpOpen` implementation (lines 187–189):

```ts
    setCommandPaletteOpen(open) {
        set({ commandPaletteOpen: open });
    },
    toggleCommandPalette() {
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen }));
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/kuindji/Projects/taskflow/packages/ui && bun run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit and log**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat(ui): command palette open state in ui-store"
taskflow-cli log commit "feat(ui): command palette open state in ui-store" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "packages/ui/src/stores/ui-store.ts"
```

---

### Task 3: CommandPaletteDialog component

**Files:**
- Create: `packages/ui/src/components/CommandPaletteDialog.tsx`
- Modify: `packages/ui/src/App.tsx`

Context for the engineer:
- `useRunMenu` (`packages/ui/src/hooks/useRunMenu.ts`) already fetches package.json scripts (lazily, when `enabled` and `projectPath` are set) and exposes standalone actions plus `onRunScript(name)` / `onRunAction(action)` callbacks that navigate to the task, focus the workspace, and spawn the session. The palette consumes only those parts and ignores the hook's flows/agent-command/run-tab data.
- `useActiveWorkspace` (`packages/ui/src/hooks/useActiveWorkspace.ts`) returns `{ scope, task, project, workingDir, workspaceKey }`; `workingDir` is already the worktree path when the task has one. The palette only operates when `scope === "task"`.
- The Radix `DialogContent` (`packages/ui/src/components/ui/dialog.tsx:42`) centers via `fixed inset-0 m-auto h-fit`; the palette overrides to sit near the top. `cn` uses tailwind-merge, so later classes win.
- Radix `Dialog` handles Esc and click-outside via `onOpenChange`. It autofocuses the first focusable element — the search input.

- [ ] **Step 1: Create the component**

Create `packages/ui/src/components/CommandPaletteDialog.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionDefinition } from "@taskflow/shared";
import { SquareTerminal, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fuzzyMatch } from "@/lib/fuzzy-match";
import { isDialogOpen } from "@/lib/global-shortcuts";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useRunMenu } from "@/hooks/useRunMenu";
import { useUIStore } from "@/stores/ui-store";

type PaletteEntry =
    | { kind: "action"; action: ActionDefinition }
    | { kind: "script"; name: string };

interface PaletteRow {
    entry: PaletteEntry;
    label: string;
    detail: string;
    disabled: boolean;
    indices: number[];
}

interface PaletteGroup {
    title: string;
    rows: PaletteRow[];
}

function entryKey(entry: PaletteEntry): string {
    return entry.kind === "action" ? `action:${entry.action.id}` : `script:${entry.name}`;
}

function HighlightedLabel({ text, indices }: { text: string; indices: number[] }) {
    if (indices.length === 0) return <>{text}</>;
    const matched = new Set(indices);
    return (
        <>
            {Array.from(text, (char, i) =>
                matched.has(i) ? (
                    <span key={i} className="text-foreground font-semibold">
                        {char}
                    </span>
                ) : (
                    <span key={i}>{char}</span>
                ),
            )}
        </>
    );
}

function CommandPaletteDialog() {
    const open = useUIStore((s) => s.commandPaletteOpen);
    const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const workspace = useActiveWorkspace();
    const hasTask = workspace.scope === "task" && workspace.task !== null;

    const { data, callbacks } = useRunMenu({
        projectId: workspace.project?.id ?? "",
        projectPath: workspace.workingDir ?? "",
        taskId: workspace.task?.id,
        showAgentOptions: false,
        enabled: open && hasTask,
    });

    // Reset transient state whenever the palette opens
    useEffect(() => {
        if (open) {
            setQuery("");
            setSelectedIndex(0);
        }
    }, [open]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const groups: PaletteGroup[] = useMemo(() => {
        if (!hasTask) return [];

        const filterRows = (rows: PaletteRow[]): PaletteRow[] => {
            if (!query) return rows;
            const scored: Array<{ row: PaletteRow; score: number }> = [];
            for (const row of rows) {
                const match = fuzzyMatch(query, row.label);
                if (!match) continue;
                scored.push({ row: { ...row, indices: match.indices }, score: match.score });
            }
            scored.sort((a, b) => b.score - a.score);
            return scored.map((s) => s.row);
        };

        const actionRows: PaletteRow[] = data.standaloneActions.map((action) => ({
            entry: { kind: "action", action },
            label: action.name,
            detail: data.online ? action.sessionType : "offline",
            disabled: !data.online,
            indices: [],
        }));

        const scriptRows: PaletteRow[] = Object.keys(data.scripts).map((name) => ({
            entry: { kind: "script", name },
            label: name,
            detail: data.defaultRuntime,
            disabled: false,
            indices: [],
        }));

        return [
            { title: "Actions", rows: filterRows(actionRows) },
            { title: "package.json", rows: filterRows(scriptRows) },
        ].filter((group) => group.rows.length > 0);
    }, [hasTask, data.standaloneActions, data.scripts, data.defaultRuntime, data.online, query]);

    const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

    const runRow = useCallback(
        (row: PaletteRow) => {
            if (row.disabled) return;
            if (row.entry.kind === "script") {
                callbacks.onRunScript(row.entry.name);
            } else {
                callbacks.onRunAction(row.entry.action);
            }
            setOpen(false);
        },
        [callbacks, setOpen],
    );

    const onInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (flatRows.length > 0) {
                    setSelectedIndex((i) => (i + 1) % flatRows.length);
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (flatRows.length > 0) {
                    setSelectedIndex((i) => (i - 1 + flatRows.length) % flatRows.length);
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                const row = flatRows[selectedIndex];
                if (row) runRow(row);
            }
        },
        [flatRows, selectedIndex, runRow],
    );

    // Keep the selected row visible while navigating with arrows
    useEffect(() => {
        const el = listRef.current?.querySelector("[data-selected='true']");
        el?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex, groups]);

    // Electron menu accelerator (CmdOrCtrl+Shift+P). The palette itself
    // renders a dialog-content, so isDialogOpen() is true while it is open —
    // the !commandPaletteOpen guard keeps toggle-to-close working while still
    // blocking the shortcut when some other dialog is open.
    useEffect(() => {
        const subscribe = window.taskflow?.onOpenCommandPalette;
        if (!subscribe) return;
        return subscribe(() => {
            const store = useUIStore.getState();
            if (isDialogOpen() && !store.commandPaletteOpen) return;
            store.toggleCommandPalette();
        });
    }, []);

    let rowIndex = -1;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                showCloseButton={false}
                className="top-[12vh] bottom-auto my-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
                <DialogTitle className="sr-only">Command Palette</DialogTitle>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    placeholder="Run an action or script..."
                    spellCheck={false}
                    className="placeholder:text-muted-foreground border-border w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
                />
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
                    {!hasTask ? (
                        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                            Select a task to run actions
                        </p>
                    ) : flatRows.length === 0 ? (
                        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                            {query ? "No results" : "No actions or scripts available"}
                        </p>
                    ) : (
                        groups.map((group) => (
                            <div key={group.title}>
                                <div className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
                                    {group.title}
                                </div>
                                {group.rows.map((row) => {
                                    rowIndex += 1;
                                    const index = rowIndex;
                                    const Icon = row.entry.kind === "action" ? Zap : SquareTerminal;
                                    return (
                                        <div
                                            key={entryKey(row.entry)}
                                            data-selected={index === selectedIndex}
                                            onMouseMove={() => setSelectedIndex(index)}
                                            onClick={() => runRow(row)}
                                            className={cn(
                                                "text-muted-foreground flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                                                index === selectedIndex && "bg-accent text-accent-foreground",
                                                row.disabled && "cursor-default opacity-50",
                                            )}>
                                            <Icon className="h-4 w-4 shrink-0" />
                                            <span className="truncate">
                                                <HighlightedLabel text={row.label} indices={row.indices} />
                                            </span>
                                            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                                                {row.detail}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
                <div className="text-muted-foreground border-border flex items-center gap-3 border-t px-3 py-1.5 text-xs">
                    <span>&#8593;&#8595; navigate</span>
                    <span>&#8629; run</span>
                    <span>esc close</span>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { CommandPaletteDialog };
```

Note: `window.taskflow?.onOpenCommandPalette` does not exist yet — Task 5 adds it to the bridge and `env.d.ts`. Until then this file produces exactly one typecheck error; Tasks 3–5 typecheck clean together at the end of Task 5.

- [ ] **Step 2: Mount in App.tsx**

In `packages/ui/src/App.tsx`, add the import after the `KeyboardShortcutsDialog` import (line 11):

```tsx
import { CommandPaletteDialog } from "@/components/CommandPaletteDialog";
```

Render it after `<KeyboardShortcutsDialog />` (line 136):

```tsx
                <CommandPaletteDialog />
```

- [ ] **Step 3: Verify the component compiles standalone**

Run: `cd /Users/kuindji/Projects/taskflow/packages/ui && bun run typecheck`
Expected: ONE error in `CommandPaletteDialog.tsx` — `onOpenCommandPalette` missing on `TaskflowBridge` (fixed in Task 5). Any other error must be fixed now.

- [ ] **Step 4: Commit and log**

```bash
git add packages/ui/src/components/CommandPaletteDialog.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): command palette dialog listing actions and scripts"
taskflow-cli log commit "feat(ui): command palette dialog listing actions and scripts" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "packages/ui/src/components/CommandPaletteDialog.tsx"
taskflow-cli log file "packages/ui/src/App.tsx"
```

---

### Task 4: Web keyboard shortcut (Cmd+Shift+P fallback)

**Files:**
- Modify: `packages/ui/src/hooks/usePanelNavigation.ts:121-136`

In Electron the menu accelerator consumes the keydown before the renderer sees it (same as the existing `Cmd+/` dual registration), so this listener only fires in browser/dev mode — registering both is the established pattern.

- [ ] **Step 1: Add the shortcut**

In `onKeyDown` (currently lines 112–137), insert between `if (!(e.metaKey || e.ctrlKey)) return;` and `if (isDialogOpen()) return;`:

```ts
            // Cmd+Shift+P: toggle command palette (also allowed while the
            // palette itself is open so the shortcut closes it)
            if (e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
                if (isDialogOpen() && !store.commandPaletteOpen) return;
                e.preventDefault();
                store.toggleCommandPalette();
                return;
            }
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/kuindji/Projects/taskflow/packages/ui && bun run typecheck`
Expected: still only the known `onOpenCommandPalette` error from Task 3.

- [ ] **Step 3: Commit and log**

```bash
git add packages/ui/src/hooks/usePanelNavigation.ts
git commit -m "feat(ui): Cmd+Shift+P web shortcut for command palette"
taskflow-cli log commit "feat(ui): Cmd+Shift+P web shortcut for command palette" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "packages/ui/src/hooks/usePanelNavigation.ts"
```

---

### Task 5: Electron menu item + preload bridge

**Files:**
- Modify: `electron/src/app-menu.ts:188`
- Modify: `electron/src/preload.ts:61-67`
- Modify: `packages/ui/src/env.d.ts:33`

- [ ] **Step 1: Add the View menu item**

In `electron/src/app-menu.ts`, at the top of the View submenu (line 188, before the `toggle-archive` item):

```ts
                {
                    label: "Command Palette…",
                    accelerator: "CmdOrCtrl+Shift+P",
                    click: () => {
                        mainWindow?.webContents.send("open-command-palette");
                    },
                },
                { type: "separator" },
```

- [ ] **Step 2: Add the preload bridge method**

In `electron/src/preload.ts`, after the `onOpenKeyboardShortcuts` block (lines 61–67):

```ts
    onOpenCommandPalette: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("open-command-palette", listener);
        return () => {
            ipcRenderer.removeListener("open-command-palette", listener);
        };
    },
```

- [ ] **Step 3: Add the bridge type**

In `packages/ui/src/env.d.ts`, after `onOpenKeyboardShortcuts(callback: () => void): () => void;` (line 33):

```ts
    onOpenCommandPalette(callback: () => void): () => void;
```

- [ ] **Step 4: Typecheck everything**

Run: `cd /Users/kuindji/Projects/taskflow && bun run typecheck`
Expected: exit 0 across all packages (the Task 3 error is now resolved).

- [ ] **Step 5: Run the full test suite**

Run: `cd /Users/kuindji/Projects/taskflow && bun test`
Expected: all tests pass, including `fuzzy-match.test.ts`.

- [ ] **Step 6: Commit and log**

```bash
git add electron/src/app-menu.ts electron/src/preload.ts packages/ui/src/env.d.ts
git commit -m "feat(electron): Command Palette menu item and IPC bridge"
taskflow-cli log commit "feat(electron): Command Palette menu item and IPC bridge" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "electron/src/app-menu.ts"
taskflow-cli log file "electron/src/preload.ts"
taskflow-cli log file "packages/ui/src/env.d.ts"
```

---

### Task 6: Document the shortcut in KeyboardShortcutsDialog

**Files:**
- Modify: `packages/ui/src/components/KeyboardShortcutsDialog.tsx:196`

- [ ] **Step 1: Add the row**

In the `General` group (line 196), add as the first `ShortcutRow` (before "Open settings"):

```tsx
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8679;</Kbd>
                                    <Kbd className="text-xs">P</Kbd>
                                </>
                            }
                            description="Open command palette"
                        />
```

- [ ] **Step 2: Lint and typecheck**

Run: `cd /Users/kuindji/Projects/taskflow && bun run lint && bun run typecheck`
Expected: exit 0. Fix any lint issues in files this plan touched (without disabling rules).

- [ ] **Step 3: Commit and log**

```bash
git add packages/ui/src/components/KeyboardShortcutsDialog.tsx
git commit -m "docs(ui): list Cmd+Shift+P in keyboard shortcuts dialog"
taskflow-cli log commit "docs(ui): list Cmd+Shift+P in keyboard shortcuts dialog" --hash $(git rev-parse --short HEAD)
taskflow-cli log file "packages/ui/src/components/KeyboardShortcutsDialog.tsx"
```

---

### Task 7: Manual verification

No automated UI tests exist in this repo; verify by running the app.

- [ ] **Step 1: Start backend and UI**

Run in separate background shells from the repo root:
- `bun run dev:backend`
- `bun run dev:ui` (note the Vite port it prints; the UI needs `VITE_BACKEND_PORT` to match the backend dev port — check `packages/ui/.env*` / existing dev setup before assuming)

- [ ] **Step 2: Walk the checklist in a browser**

1. Select a task in the sidebar → press `Cmd+Shift+P` → palette opens, input focused, two groups visible (Actions if any standalone actions exist, package.json scripts of the task's project).
2. Type a few characters → list filters, matched characters render bold, best matches first within each group.
3. ArrowUp/ArrowDown moves the highlight (wraps at the ends); Enter on a script → palette closes, a new terminal tab opens in the task and runs `<runtime> run <script>`.
4. Reopen, Enter on an action → palette closes, a new agent session tab opens with the action's prompt.
5. `Cmd+Shift+P` while the palette is open → it closes. Esc and click-outside also close it.
6. Deselect tasks (e.g. switch to a project-only or master view) → palette shows "Select a task to run actions".
7. Open Settings, press `Cmd+Shift+P` → nothing happens (other dialog open).

- [ ] **Step 3: Log the result**

```bash
taskflow-cli log info "Command palette implemented and manually verified: shortcut (web), fuzzy filter, keyboard nav, script run, action run, no-task and dialog-guard states"
```

Electron-only checks (menu item + accelerator) require `bun run dev:electron`; if not feasible in this environment, note it in the final report so the user can verify in the desktop app.

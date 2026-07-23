# Taskflow Markdown Support (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `.md` file in every Taskflow project open in a real markdown reader — preview by default, scroll preserved, anchors and relative links working, readable measure, checkboxes, images, mermaid and math.

**Architecture:** The existing `markdown` tab type gains a `mode` field (`preview` | `edit`) plus tab-local navigation history and a stored scroll offset, so one tab per file swaps its pane in place instead of opening a second `editor` tab. `MarkdownPane` becomes a thin shell (toolbar + mode switch) around the existing lazy-loaded preview and the existing lazy-loaded Monaco `EditorPane`. All markdown parsing/routing logic that can be pure is extracted into `packages/ui/src/lib/markdown/*` so it is unit-testable without a DOM. One new backend HTTP route serves relative image bytes under the existing workspace-root path guard.

**Tech Stack:** Bun, TypeScript, React 19, Zustand, react-markdown 10 (unified 11), remark/rehype plugins, Monaco, Tailwind 4, `bun test` + happy-dom for component tests.

## Global Constraints

- Always use `bun`, never `npm` or `yarn`, for installing dependencies and running commands.
- Do not add `Co-Authored-By` trailers to commits.
- Avoid `as any` in TypeScript. Pursue proper type usage.
- Keep types reusable and, where it makes sense, separate from implementation. Check `packages/shared/src/types/` before adding a new type.
- Do not export a symbol until something outside its module imports it.
- Do not disable eslint rules. Find the proper fix.
- Code style is enforced by prettier (4-space indent, double quotes). Run `bun run format` before committing if unsure.
- Verification commands, run from the repo root: `bun test`, `bun run typecheck`, `bun run lint`.
- Work on the `main` branch. Do not create worktrees or feature branches.
- Markdown file detection means extension `.md` or `.markdown`, case-insensitive, everywhere in this plan.

## File Structure

**New — pure logic (UI), each with a co-located `.test.ts`:**

| File | Responsibility |
|---|---|
| `packages/ui/src/lib/open-file-plan.ts` | Decide where a file open lands (markdown preview / markdown edit / monaco / CLI editor) |
| `packages/ui/src/lib/markdown/paths.ts` | POSIX-style path helpers (`dirnameOf`, `joinRelative`) — no Node `path` in the renderer |
| `packages/ui/src/lib/markdown/link-target.ts` | Classify an `<a href>` into a navigation action |
| `packages/ui/src/lib/markdown/frontmatter.ts` | Split and parse YAML frontmatter from markdown source |
| `packages/ui/src/lib/markdown/outline.ts` | Extract headings + `rehype-slug`-compatible ids from markdown source |
| `packages/ui/src/lib/markdown/task-list.ts` | Flip the Nth `- [ ]` in markdown source |
| `packages/ui/src/lib/backend-url.ts` | Build the backend HTTP origin for asset URLs |

**New — components (UI):**

| File | Responsibility |
|---|---|
| `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx` | Back/forward, edit/preview toggle |
| `packages/ui/src/components/panes/markdown/CodeBlock.tsx` | Syntax-highlighted code block with copy button |
| `packages/ui/src/components/panes/markdown/FrontmatterHeader.tsx` | Compact rendering of parsed frontmatter |
| `packages/ui/src/components/panes/markdown/MermaidBlock.tsx` | Lazy-imported mermaid renderer |

**New — backend:**

| File | Responsibility |
|---|---|
| `packages/backend/src/api/routes/file-routes.ts` | `GET /api/file/raw?path=` |
| `packages/backend/tests/api/file-routes.test.ts` | Route behaviour + adversarial path tests |

**Modified:**

- `packages/ui/src/stores/session-helpers.ts` — `Tab` gains `mode`, `previewScrollTop`, `history`, `historyIndex`; pure history helpers.
- `packages/ui/src/stores/session-store.ts` — `setTabMode`, `setTabScrollTop`, `navigateTab`, `stepTabHistory`.
- `packages/ui/src/components/workspace/TabContent.tsx` — markdown becomes always-mounted; passes new props.
- `packages/ui/src/components/panes/MarkdownPane.tsx` — shell: toolbar + mode switch.
- `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` — preview: plugins, link handling, scroll, checkboxes, images.
- `packages/ui/src/lib/open-file.ts` — uses `planFileOpen`.
- `packages/ui/src/components/panels/FileContextMenu.tsx` — "Preview Markdown" becomes "Open in Editor".
- `packages/ui/src/styles/global.css` — prose measure, break rules, katex/mermaid full-bleed.
- `packages/shared/src/types/settings.ts`, `packages/shared/src/constants.ts` — `editor.markdownWidth`.
- `packages/backend/src/services/settings-store.ts` — default for `markdownWidth`.
- `packages/ui/src/components/settings/sections/DefaultsSection.tsx`, `packages/ui/src/components/settings/SettingsModal.tsx` — the width control.
- `packages/backend/src/api/routes.ts` — register file routes.
- `packages/ui/package.json` — new dependencies.

---

## Task 1: Tab model — markdown tabs get a mode, and `.md` stops opening in `editor` tabs

**Files:**

- Create: `packages/ui/src/lib/open-file-plan.ts`
- Create: `packages/ui/src/lib/open-file-plan.test.ts`
- Modify: `packages/ui/src/stores/session-helpers.ts` (the `Tab` interface, lines 6–26)
- Modify: `packages/ui/src/stores/session-store.ts` (the `SessionStore` interface and store body)
- Modify: `packages/ui/src/lib/open-file.ts` (whole file)
- Modify: `packages/ui/src/components/workspace/TabContent.tsx` (the `markdown` case, lines 133–141)
- Modify: `packages/ui/src/components/panes/MarkdownPane.tsx` (whole file)
- Create: `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx`
- Modify: `packages/ui/src/components/panels/FileContextMenu.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `type FileOpenPlan = { kind: "markdown"; mode: "preview" | "edit"; line?: number } | { kind: "monaco"; line?: number } | { kind: "cli-editor"; line?: number }`
  - `function isMarkdownPath(filePath: string): boolean`
  - `function planFileOpen(args: { filePath: string; line?: number; internalEditor: string; editorAvailable: boolean }): FileOpenPlan`
  - `Tab` gains `mode?: "preview" | "edit"`, `previewScrollTop?: number`, `history?: string[]`, `historyIndex?: number`
  - Session store action `setTabMode(workspaceKey: string, tabId: string, mode: "preview" | "edit"): void`

- [ ] **Step 1: Write the failing test for the open plan**

Create `packages/ui/src/lib/open-file-plan.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { isMarkdownPath, planFileOpen } from "./open-file-plan";

const MONACO = { internalEditor: "monaco", editorAvailable: false };
const NVIM = { internalEditor: "nvim", editorAvailable: true };

describe("isMarkdownPath", () => {
    it("accepts .md and .markdown in any case", () => {
        expect(isMarkdownPath("/a/b/README.md")).toBe(true);
        expect(isMarkdownPath("/a/b/README.MD")).toBe(true);
        expect(isMarkdownPath("/a/b/notes.markdown")).toBe(true);
    });

    it("rejects other extensions and lookalikes", () => {
        expect(isMarkdownPath("/a/b/index.ts")).toBe(false);
        expect(isMarkdownPath("/a/b/md")).toBe(false);
        expect(isMarkdownPath("/a/b/file.mdx")).toBe(false);
    });
});

describe("planFileOpen", () => {
    it("sends a markdown file with no line to preview", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", ...MONACO })).toEqual({
            kind: "markdown",
            mode: "preview",
        });
    });

    it("sends a markdown file with a line to edit mode at that line", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", line: 214, ...MONACO })).toEqual({
            kind: "markdown",
            mode: "edit",
            line: 214,
        });
    });

    it("still uses in-tab edit mode for a markdown line when a CLI editor is configured", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", line: 12, ...NVIM })).toEqual({
            kind: "markdown",
            mode: "edit",
            line: 12,
        });
    });

    it("still previews a markdown file with no line when a CLI editor is configured", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", ...NVIM })).toEqual({
            kind: "markdown",
            mode: "preview",
        });
    });

    it("sends non-markdown files to monaco when monaco is selected", () => {
        expect(planFileOpen({ filePath: "/w/a.ts", line: 3, ...MONACO })).toEqual({
            kind: "monaco",
            line: 3,
        });
    });

    it("falls back to monaco when the configured CLI editor is unavailable", () => {
        expect(
            planFileOpen({
                filePath: "/w/a.ts",
                internalEditor: "nvim",
                editorAvailable: false,
            }),
        ).toEqual({ kind: "monaco" });
    });

    it("sends non-markdown files to an available CLI editor", () => {
        expect(planFileOpen({ filePath: "/w/a.ts", ...NVIM })).toEqual({ kind: "cli-editor" });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/lib/open-file-plan.test.ts`
Expected: FAIL — `Cannot find module './open-file-plan'`.

- [ ] **Step 3: Implement the open plan**

Create `packages/ui/src/lib/open-file-plan.ts`:

```ts
/** Where a file-open request should land. */
type FileOpenPlan =
    | { kind: "markdown"; mode: "preview" | "edit"; line?: number }
    | { kind: "monaco"; line?: number }
    | { kind: "cli-editor"; line?: number };

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

function isMarkdownPath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface PlanFileOpenArgs {
    filePath: string;
    line?: number;
    internalEditor: string;
    editorAvailable: boolean;
}

/**
 * Preview cannot honour "line 214", so a markdown open that carries a line
 * number goes to the tab's own edit mode. That holds even when a CLI editor is
 * configured: the design routes search hits and terminal `file:line` links into
 * the markdown tab, and reserves the CLI-editor handoff for the Edit button.
 */
function planFileOpen({
    filePath,
    line,
    internalEditor,
    editorAvailable,
}: PlanFileOpenArgs): FileOpenPlan {
    const useCliEditor = internalEditor !== "monaco" && editorAvailable;

    if (isMarkdownPath(filePath)) {
        if (line === undefined) return { kind: "markdown", mode: "preview" };
        return { kind: "markdown", mode: "edit", line };
    }

    if (!useCliEditor) return line === undefined ? { kind: "monaco" } : { kind: "monaco", line };
    return line === undefined ? { kind: "cli-editor" } : { kind: "cli-editor", line };
}

export type { FileOpenPlan };
export { isMarkdownPath, planFileOpen };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/ui/src/lib/open-file-plan.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Extend the `Tab` type**

In `packages/ui/src/stores/session-helpers.ts`, replace the `Tab` interface (lines 6–26) with:

```ts
interface Tab {
    id: string;
    type:
        | "claude"
        | "codex"
        | "opencode"
        | "pi"
        | "kimi"
        | "shell"
        | "editor"
        | "changes"
        | "history"
        | "browser"
        | "markdown";
    label: string;
    sessionId?: string;
    filePath?: string;
    url?: string;
    autoTitle?: boolean;
    trayExclude?: boolean;
    /** markdown tabs only — which pane the tab currently shows. Absent means "preview". */
    mode?: "preview" | "edit";
    /** markdown tabs only — scroll offset of the preview pane, restored across pane swaps. */
    previewScrollTop?: number;
    /** markdown tabs only — file paths visited in this tab, oldest first. */
    history?: string[];
    /** markdown tabs only — index into `history` of the currently shown file. */
    historyIndex?: number;
}
```

- [ ] **Step 6: Add `setTabMode` to the session store**

In `packages/ui/src/stores/session-store.ts`, add to the `SessionStore` interface, next to `renameTab`:

```ts
    setTabMode(workspaceKey: string, tabId: string, mode: "preview" | "edit"): void;
```

And add the implementation to the store body, next to `renameTab`:

```ts
    setTabMode(workspaceKey, tabId, mode) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId || (tab.mode ?? "preview") === mode) return tab;
                changed = true;
                return { ...tab, mode };
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
```

- [ ] **Step 7: Route file opens through the plan**

Replace the body of `openFileInApp` in `packages/ui/src/lib/open-file.ts` (lines 29–84) with:

```ts
async function openFileInApp(
    filePath: string,
    workspaceKey: string | null,
    owner?: { taskId?: string; projectId?: string },
    line?: number,
): Promise<void> {
    if (!workspaceKey) return;

    await ensureEditorsCached();

    const store = useSessionStore.getState();
    const settings = useSettingsStore.getState().settings;
    const internalEditor = settings?.editor.internalEditor ?? "monaco";
    const editorAvailable = cachedEditors.some(
        (e) => e.id === internalEditor && e.type === "internal",
    );
    const plan = planFileOpen({ filePath, line, internalEditor, editorAvailable });
    const label = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;

    if (plan.kind === "cli-editor") {
        if (!owner) return;
        void store.createSession(
            owner,
            "editor",
            `${internalEditor}: ${label}`,
            undefined,
            undefined,
            undefined,
            { editorId: internalEditor, filePath, line: plan.line },
        );
        return;
    }

    const tabType = plan.kind === "markdown" ? "markdown" : "editor";
    const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const existing = existingTabs.find(
        (t) => t.type === tabType && t.filePath === filePath && !t.sessionId,
    );

    if (plan.line !== undefined) {
        setPendingLine(filePath, plan.line);
    }

    if (existing) {
        if (plan.kind === "markdown") {
            store.setTabMode(workspaceKey, existing.id, plan.mode);
        }
        store.setActiveTab(workspaceKey, existing.id);
        if (plan.line !== undefined) {
            window.dispatchEvent(
                new CustomEvent("editor-navigate", { detail: { filePath, line: plan.line } }),
            );
        }
        return;
    }

    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: tabType,
        label,
        filePath,
        ...(plan.kind === "markdown" && {
            mode: plan.mode,
            history: [filePath],
            historyIndex: 0,
        }),
    });
}
```

And add the import at the top of the file, after the existing imports:

```ts
import { planFileOpen } from "@/lib/open-file-plan";
```

- [ ] **Step 8: Create the markdown toolbar**

Create `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx`:

```tsx
import { Eye, Pencil } from "lucide-react";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";

interface MarkdownToolbarProps {
    mode: "preview" | "edit";
    onToggleMode: () => void;
}

function MarkdownToolbar({ mode, onToggleMode }: MarkdownToolbarProps) {
    return (
        <Toolbar className="justify-end gap-1">
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onToggleMode}
                aria-label={mode === "preview" ? "Edit" : "Preview"}
                tooltip={mode === "preview" ? "Edit" : "Preview"}
                tooltipSide="bottom">
                {mode === "preview" ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
        </Toolbar>
    );
}

export { MarkdownToolbar };
```

- [ ] **Step 9: Turn `MarkdownPane` into the mode-switching shell**

Replace `packages/ui/src/components/panes/MarkdownPane.tsx` entirely:

```tsx
import { Suspense, lazy, useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { EditorPane } from "@/components/panes/EditorPane";
import { MarkdownToolbar } from "@/components/panes/markdown/MarkdownToolbar";
import { ensureEditorsCached, getInternalEditorId } from "@/lib/open-file";

interface MarkdownPaneProps {
    filePath: string;
    mode: "preview" | "edit";
    tabId: string;
    workspaceKey: string;
}

const LazyMarkdownPane = lazy(() => import("./MarkdownPaneImpl"));

function MarkdownPane({ filePath, mode, tabId, workspaceKey }: MarkdownPaneProps) {
    const workspace = useActiveWorkspace();
    const internalEditor = useSettingsStore(
        (s) => s.settings?.editor.internalEditor ?? "monaco",
    );

    const handleToggleMode = useCallback(async () => {
        const store = useSessionStore.getState();
        if (mode === "edit") {
            store.setTabMode(workspaceKey, tabId, "preview");
            return;
        }
        // The editor list is fetched over the WebSocket, which may not have been
        // open when this module loaded. Awaiting here (a user click, so latency
        // is fine) is what makes the CLI-editor branch reliable on first use.
        await ensureEditorsCached();
        // A configured, available CLI editor opens in a terminal session and the
        // markdown tab stays in preview — matching how non-markdown files behave.
        const cliEditorId = getInternalEditorId(internalEditor);
        if (cliEditorId) {
            const owner =
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : workspace.scope === "project"
                      ? { projectId: workspace.project.id }
                      : undefined;
            if (owner) {
                const label = filePath.split("/").pop() ?? filePath;
                void store.createSession(
                    owner,
                    "editor",
                    `${cliEditorId}: ${label}`,
                    undefined,
                    undefined,
                    undefined,
                    { editorId: cliEditorId, filePath },
                );
                return;
            }
        }
        store.setTabMode(workspaceKey, tabId, "edit");
    }, [filePath, internalEditor, mode, tabId, workspace, workspaceKey]);

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MarkdownToolbar mode={mode} onToggleMode={() => void handleToggleMode()} />
            {mode === "edit" ? (
                <EditorPane filePath={filePath} />
            ) : (
                <Suspense
                    fallback={
                        <div className="text-muted-foreground flex flex-1 items-center justify-center">
                            Loading preview...
                        </div>
                    }>
                    <LazyMarkdownPane filePath={filePath} />
                </Suspense>
            )}
        </div>
    );
}

export { MarkdownPane };
```

- [ ] **Step 10: Expose the CLI-editor check from `open-file.ts`**

`MarkdownPane` needs to know whether the configured internal editor is an available CLI editor, and that knowledge already lives behind the module-level `cachedEditors` in `open-file.ts`. Add to `packages/ui/src/lib/open-file.ts`, before the `export` line:

```ts
/**
 * Returns the configured internal editor id when it is a detected CLI editor,
 * or null when Monaco should be used. Reads the editor cache synchronously —
 * callers must `await ensureEditorsCached()` first.
 */
function getInternalEditorId(internalEditor: string): string | null {
    if (internalEditor === "monaco") return null;
    const available = cachedEditors.some(
        (e) => e.id === internalEditor && e.type === "internal",
    );
    return available ? internalEditor : null;
}
```

and change the final export line to:

```ts
export { ensureEditorsCached, getInternalEditorId, openFileInApp };
```

Do **not** try to warm the cache at module load: `sendRequest` rejects outright when the WebSocket is not yet open (`useWebSocket.ts:108`), so a load-time call would silently leave the cache empty and make the first Edit click fall through to Monaco even with `nvim` configured. `MarkdownPane` awaits `ensureEditorsCached()` inside the click handler instead.

- [ ] **Step 11: Pass the new props from `TabContent`**

In `packages/ui/src/components/workspace/TabContent.tsx`, change the props interface so `workspaceKey` is required (the only caller, `WorkspacePane.tsx:162`, always passes it):

```ts
interface TabContentProps {
    tabs: Tab[];
    activeTabId: string;
    workspaceKey: string;
}
```

and update the droppable id line to:

```ts
        id: `pane-drop:${workspaceKey}`,
```

Then replace the `markdown` case (lines 133–141) with:

```tsx
                    case "markdown":
                        label = tab.filePath?.split("/").pop() ?? "Preview";
                        if (!isActive) return null;
                        pane = tab.filePath ? (
                            <MarkdownPane
                                filePath={tab.filePath}
                                mode={tab.mode ?? "preview"}
                                tabId={tab.id}
                                workspaceKey={workspaceKey}
                            />
                        ) : (
                            <div className="text-muted-foreground p-3">No file specified</div>
                        );
                        break;
```

(The `if (!isActive) return null;` line disappears in Task 2 — leave it for now so this task stays behaviour-complete on its own.)

- [ ] **Step 12: Extend the unsaved-changes guard to markdown tabs**

`WorkspacePane.tsx:98` currently gates the "Unsaved Changes" confirmation on `tab?.type === "editor"`. A markdown tab in edit mode now hosts the same Monaco pane and the same `dirtyModels` entry, so without this a user who edits a `.md` and closes the tab loses the edits silently. In `packages/ui/src/components/workspace/WorkspacePane.tsx`, change the first guard in `handleTabClose`:

```tsx
        if (
            (tab?.type === "editor" || tab?.type === "markdown") &&
            tab.filePath &&
            isEditorDirty(tab.filePath)
        ) {
```

Leave the second guard (`tab?.type === "editor" && tab.sessionId`) alone — it is about a running CLI editor session, which a markdown tab never has.

- [ ] **Step 13: Replace the explorer's "Preview Markdown" entry with "Open in Editor"**

Explorer clicks now preview by default, so the preview entry is dead weight; the useful inverse is opening the editor. In `packages/ui/src/components/panels/FileContextMenu.tsx`:

First fix the detection at line 70, which only recognises a lowercase `.md`:

```tsx
    const isMarkdown = !isDirectory && isMarkdownPath(filePath);
```

with `import { isMarkdownPath } from "@/lib/open-file-plan";`.

Replace the `handlePreviewMarkdown` callback (lines 72–89) with:

```tsx
    const handleOpenInEditor = useCallback(() => {
        const workspaceKey = workspace.workspaceKey;
        if (!workspaceKey) return;
        const store = useSessionStore.getState();
        const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
        const existing = existingTabs.find((t) => t.type === "markdown" && t.filePath === filePath);
        if (existing) {
            store.setTabMode(workspaceKey, existing.id, "edit");
            store.setActiveTab(workspaceKey, existing.id);
            return;
        }
        const label = filePath.split("/").pop() ?? filePath;
        store.addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "markdown",
            label,
            filePath,
            mode: "edit",
            history: [filePath],
            historyIndex: 0,
        });
    }, [filePath, workspace.workspaceKey]);
```

In the native-menu branch, replace:

```tsx
            if (isMarkdown) {
                items.push({ id: "preview-markdown", label: "Preview Markdown" });
                actions["preview-markdown"] = handlePreviewMarkdown;
            }
```

with:

```tsx
            if (isMarkdown) {
                items.push({ id: "open-in-editor", label: "Open in Editor" });
                actions["open-in-editor"] = handleOpenInEditor;
            }
```

and in that callback's dependency array replace `handlePreviewMarkdown` with `handleOpenInEditor`.

In the Radix menu branch, replace:

```tsx
                        {isMarkdown && (
                            <ContextMenuItem onSelect={handlePreviewMarkdown}>
                                <Eye />
                                Preview Markdown
                            </ContextMenuItem>
                        )}
```

with:

```tsx
                        {isMarkdown && (
                            <ContextMenuItem onSelect={handleOpenInEditor}>
                                <Pencil />
                                Open in Editor
                            </ContextMenuItem>
                        )}
```

Remove `Eye` from the `lucide-react` import list (`Pencil` is already imported).

- [ ] **Step 14: Verify the whole repo**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all tests pass, no type errors, no lint errors.

- [ ] **Step 15: Commit**

```bash
git add packages/ui/src/lib/open-file-plan.ts packages/ui/src/lib/open-file-plan.test.ts \
        packages/ui/src/lib/open-file.ts packages/ui/src/stores/session-helpers.ts \
        packages/ui/src/stores/session-store.ts packages/ui/src/components/workspace/TabContent.tsx \
        packages/ui/src/components/workspace/WorkspacePane.tsx \
        packages/ui/src/components/panes/MarkdownPane.tsx \
        packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx \
        packages/ui/src/components/panels/FileContextMenu.tsx
git commit -m "feat(markdown): open .md files in a preview/edit markdown tab"
```

---

## Task 2: Scroll preservation across tab switches and pane swaps

**Files:**

- Modify: `packages/ui/src/components/workspace/TabContent.tsx` (`isAlwaysMounted`, the `markdown` case)
- Modify: `packages/ui/src/stores/session-store.ts` (add `setTabScrollTop`)
- Create: `packages/ui/src/stores/session-store.markdown.test.ts`
- Modify: `packages/ui/src/components/panes/MarkdownPane.tsx` (pass scroll props through)
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` (scroll container ref, restore, throttled writes)

**Interfaces:**

- Consumes: `Tab.previewScrollTop`, `Tab.mode` and `setTabMode` from Task 1.
- Produces:
  - Session store action `setTabScrollTop(workspaceKey: string, tabId: string, scrollTop: number): void`
  - `MarkdownPaneImpl` props `{ filePath: string; tabId: string; workspaceKey: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/session-store.markdown.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { useSessionStore } from "./session-store";

const KEY = "task:t1";

function seedMarkdownTab(): string {
    const id = "tab-1";
    useSessionStore.setState({
        tabsByWorkspace: {
            [KEY]: [
                {
                    id,
                    type: "markdown",
                    label: "doc.md",
                    filePath: "/w/doc.md",
                    mode: "preview",
                    history: ["/w/doc.md"],
                    historyIndex: 0,
                },
            ],
        },
        activeTabByWorkspace: { [KEY]: id },
    });
    return id;
}

function readTab(id: string) {
    return useSessionStore.getState().tabsByWorkspace[KEY]?.find((t) => t.id === id);
}

describe("markdown tab state", () => {
    beforeEach(() => {
        useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
    });

    it("stores the preview scroll offset on the tab", () => {
        const id = seedMarkdownTab();
        useSessionStore.getState().setTabScrollTop(KEY, id, 640);
        expect(readTab(id)?.previewScrollTop).toBe(640);
    });

    it("keeps the scroll offset when the tab swaps to edit mode and back", () => {
        const id = seedMarkdownTab();
        const store = useSessionStore.getState();
        store.setTabScrollTop(KEY, id, 640);
        store.setTabMode(KEY, id, "edit");
        expect(readTab(id)?.previewScrollTop).toBe(640);
        store.setTabMode(KEY, id, "preview");
        expect(readTab(id)?.previewScrollTop).toBe(640);
        expect(readTab(id)?.mode).toBe("preview");
    });

    it("leaves the tab array reference untouched when the offset is unchanged", () => {
        const id = seedMarkdownTab();
        useSessionStore.getState().setTabScrollTop(KEY, id, 100);
        const before = useSessionStore.getState().tabsByWorkspace[KEY];
        useSessionStore.getState().setTabScrollTop(KEY, id, 100);
        expect(useSessionStore.getState().tabsByWorkspace[KEY]).toBe(before);
    });

    it("ignores writes for an unknown workspace or tab", () => {
        const id = seedMarkdownTab();
        const before = useSessionStore.getState().tabsByWorkspace;
        useSessionStore.getState().setTabScrollTop("task:nope", id, 10);
        useSessionStore.getState().setTabScrollTop(KEY, "nope", 10);
        expect(useSessionStore.getState().tabsByWorkspace).toBe(before);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/stores/session-store.markdown.test.ts`
Expected: FAIL — `setTabScrollTop is not a function`.

- [ ] **Step 3: Implement `setTabScrollTop`**

In `packages/ui/src/stores/session-store.ts`, add to the `SessionStore` interface next to `setTabMode`:

```ts
    setTabScrollTop(workspaceKey: string, tabId: string, scrollTop: number): void;
```

and to the store body next to `setTabMode`:

```ts
    setTabScrollTop(workspaceKey, tabId, scrollTop) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId || tab.previewScrollTop === scrollTop) return tab;
                changed = true;
                return { ...tab, previewScrollTop: scrollTop };
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/ui/src/stores/session-store.markdown.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Keep markdown tabs mounted when inactive**

In `packages/ui/src/components/workspace/TabContent.tsx`, add `markdown` to `isAlwaysMounted`:

```ts
function isAlwaysMounted(tab: Tab): boolean {
    if (tab.type === "editor" && tab.sessionId) return true;
    return (
        tab.type === "claude" ||
        tab.type === "codex" ||
        tab.type === "opencode" ||
        tab.type === "pi" ||
        tab.type === "kimi" ||
        tab.type === "shell" ||
        tab.type === "browser" ||
        tab.type === "markdown"
    );
}
```

Delete the `if (!isActive) return null;` line from the `markdown` case.

This routes markdown through the existing off-screen `left:-9999em` branch — deliberately *not* the `<Activity>`/`display:none` branch used by browser tabs, because `display:none` drops the scroll container's `scrollTop` and would not fix the reported bug. Off-screen positioning also keeps layout alive, which mermaid needs in order to measure.

Add a comment above the `markdown` case explaining this, so a later reader does not "simplify" it into the `Activity` branch:

```tsx
                    // Markdown tabs stay mounted off-screen (never display:none):
                    // the preview's scrollTop is only preserved while the scroll
                    // container keeps its layout box.
```

- [ ] **Step 6: Thread the scroll props through `MarkdownPane`**

In `packages/ui/src/components/panes/MarkdownPane.tsx`, change the lazy render to pass the tab identity:

```tsx
                    <LazyMarkdownPane
                        filePath={filePath}
                        tabId={tabId}
                        workspaceKey={workspaceKey}
                    />
```

- [ ] **Step 7: Restore and record scroll in the preview**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

Change the props interface:

```ts
interface MarkdownPaneImplProps {
    filePath: string;
    tabId: string;
    workspaceKey: string;
}
```

Change the signature to `function MarkdownPaneImpl({ filePath, tabId, workspaceKey }: MarkdownPaneImplProps) {` and add, after the existing `loadIdRef` declaration:

```tsx
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Read once: the pane owns the live value from here on, and subscribing
    // to the store would re-render the pane on every scroll tick.
    const initialScrollTopRef = useRef(
        useSessionStore
            .getState()
            .tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId)?.previewScrollTop ?? 0,
    );

    const handleScroll = useCallback(() => {
        if (scrollWriteRef.current) return;
        scrollWriteRef.current = setTimeout(() => {
            scrollWriteRef.current = null;
            const top = scrollRef.current?.scrollTop;
            if (top === undefined) return;
            useSessionStore.getState().setTabScrollTop(workspaceKey, tabId, top);
        }, 150);
    }, [tabId, workspaceKey]);

    // Flush the pending offset on unmount (the preview→edit swap unmounts this pane).
    useEffect(() => {
        return () => {
            if (scrollWriteRef.current) clearTimeout(scrollWriteRef.current);
            const top = scrollRef.current?.scrollTop;
            if (top !== undefined) {
                useSessionStore.getState().setTabScrollTop(workspaceKey, tabId, top);
            }
        };
    }, [tabId, workspaceKey]);

    // Restore once the content has rendered and the container has a scroll height.
    useEffect(() => {
        if (loading) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = initialScrollTopRef.current;
    }, [loading]);
```

Add `useSessionStore` to the imports:

```ts
import { useSessionStore } from "@/stores/session-store";
```

Finally, attach the ref and handler to the scroll container in the return (line 119):

```tsx
        <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
```

- [ ] **Step 8: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

Then verify by hand: open a long `.md`, scroll to the middle, switch to a terminal tab, switch back — the scroll position is where you left it. Toggle Edit then Preview — same.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/stores/session-store.ts \
        packages/ui/src/stores/session-store.markdown.test.ts \
        packages/ui/src/components/panes/MarkdownPane.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "fix(markdown): preserve preview scroll across tab switches and pane swaps"
```

---

## Task 3: Typography — readable measure and no mid-word breaks

**Files:**

- Modify: `packages/shared/src/types/settings.ts` (`EditorSettings`)
- Modify: `packages/shared/src/constants.ts` (defaults + width map)
- Create: `packages/shared/src/markdown-width.test.ts`
- Modify: `packages/backend/src/services/settings-store.ts` (`DEFAULTS.editor`)
- Modify: `packages/ui/src/styles/global.css` (lines 226–306 region)
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` (apply the width)
- Modify: `packages/ui/src/components/settings/sections/DefaultsSection.tsx` (the control)
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx` (the handler)

**Interfaces:**

- Consumes: `MarkdownPaneImpl` props from Task 2.
- Produces:
  - `type MarkdownWidth = "narrow" | "medium" | "wide" | "full"` in `packages/shared/src/types/settings.ts`
  - `EditorSettings.markdownWidth: MarkdownWidth`
  - `const DEFAULT_EDITOR_MARKDOWN_WIDTH: MarkdownWidth` and `function markdownWidthCss(width: MarkdownWidth): string` in `packages/shared/src/constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/markdown-width.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { DEFAULT_EDITOR_MARKDOWN_WIDTH, markdownWidthCss } from "./constants";

describe("markdownWidthCss", () => {
    it("defaults to medium", () => {
        expect(DEFAULT_EDITOR_MARKDOWN_WIDTH).toBe("medium");
    });

    it("maps each width to a reading measure", () => {
        expect(markdownWidthCss("narrow")).toBe("62ch");
        expect(markdownWidthCss("medium")).toBe("74ch");
        expect(markdownWidthCss("wide")).toBe("88ch");
    });

    it("maps full to no cap", () => {
        expect(markdownWidthCss("full")).toBe("none");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/shared/src/markdown-width.test.ts`
Expected: FAIL — `markdownWidthCss is not a function`.

- [ ] **Step 3: Add the type and the constants**

In `packages/shared/src/types/settings.ts`, add above `EditorSettings`:

```ts
export type MarkdownWidth = "narrow" | "medium" | "wide" | "full";
```

and add the field to `EditorSettings`:

```ts
export interface EditorSettings {
    fontFamily: string;
    fontSize: number;
    wordWrap: boolean;
    internalEditor: string;
    externalEditor: string;
    markdownWidth: MarkdownWidth;
}
```

In `packages/shared/src/constants.ts`, next to `DEFAULT_EDITOR_WORD_WRAP` (line 186), add:

```ts
export const DEFAULT_EDITOR_MARKDOWN_WIDTH: MarkdownWidth = "medium";

export const ALL_MARKDOWN_WIDTHS: readonly MarkdownWidth[] = [
    "narrow",
    "medium",
    "wide",
    "full",
];

export const MARKDOWN_WIDTH_LABELS: Record<MarkdownWidth, string> = {
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    full: "Full width",
};

/**
 * Reading measure for markdown prose. 74ch is the default: at 88ch the long
 * bullets in real wiki content start orphaning two or three words onto a
 * second line, which is the specific failure this caps.
 */
export function markdownWidthCss(width: MarkdownWidth): string {
    switch (width) {
        case "narrow":
            return "62ch";
        case "medium":
            return "74ch";
        case "wide":
            return "88ch";
        case "full":
            return "none";
    }
}
```

Add the type import at the top of `packages/shared/src/constants.ts`:

```ts
import type { MarkdownWidth } from "./types/settings";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/shared/src/markdown-width.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the backend default**

In `packages/backend/src/services/settings-store.ts`, extend `DEFAULTS.editor`:

```ts
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
        wordWrap: DEFAULT_EDITOR_WORD_WRAP,
        internalEditor: "monaco",
        externalEditor: "system",
        markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
    },
```

and add `DEFAULT_EDITOR_MARKDOWN_WIDTH` to the existing `@taskflow/shared` import in that file. No migration code is needed — the load path already merges `{ ...defaults.editor, ...parsed.editor }` (line 263), so settings files written before this change pick up the default.

- [ ] **Step 6: Fix the CSS**

In `packages/ui/src/styles/global.css`, replace the rule at lines 230–238 with:

```css
.markdown-preview p,
.markdown-preview li,
.markdown-preview blockquote,
.markdown-preview td,
.markdown-preview th,
.markdown-preview figcaption {
    /* overflow-wrap alone breaks only strings that cannot fit (long URLs and
       paths). word-break: break-word additionally splits ordinary words
       mid-syllable, which turned wide list items into an unreadable stagger. */
    overflow-wrap: break-word;
}
```

and append at the end of the markdown block (after the `img` rule at line 306):

```css
/* Prose is capped to a reading measure and centred; wide content breaks out. */
.markdown-preview {
    margin-inline: auto;
    max-width: var(--markdown-measure, 74ch);
}

.markdown-preview > pre,
.markdown-preview > table,
.markdown-preview > .markdown-fullbleed {
    max-width: none;
    width: 100%;
}
```

- [ ] **Step 7: Apply the width in the preview**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`, read the setting:

```tsx
    const markdownWidth = useSettingsStore(
        (s) => s.settings?.editor?.markdownWidth ?? DEFAULT_EDITOR_MARKDOWN_WIDTH,
    );
```

add `DEFAULT_EDITOR_MARKDOWN_WIDTH` and `markdownWidthCss` to the `@taskflow/shared` import, and set the custom property on the prose container:

```tsx
            <div
                className="markdown-preview prose prose-invert min-w-0"
                style={{
                    fontSize: editorFontSize,
                    fontFamily: editorFontFamily,
                    ["--markdown-measure" as string]: markdownWidthCss(markdownWidth),
                }}>
```

Note the removal of `max-w-none` — the CSS rule above now owns the measure.

- [ ] **Step 8: Add the settings control**

In `packages/ui/src/components/settings/sections/DefaultsSection.tsx`:

Add to `DefaultsSectionProps`:

```ts
    onMarkdownWidth: (value: string) => void;
```

Add `onMarkdownWidth` to the destructured parameter list, add to the `@taskflow/shared` import:

```ts
    ALL_MARKDOWN_WIDTHS,
    MARKDOWN_WIDTH_LABELS,
```

and insert this `SettingRow` immediately after the "External Editor" row (after line 104):

```tsx
            <SettingRow
                label="Markdown Width"
                hint="Reading measure for the markdown preview">
                <Select value={settings.editor.markdownWidth} onValueChange={onMarkdownWidth}>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ALL_MARKDOWN_WIDTHS.map((width) => (
                            <SelectItem key={width} value={width}>
                                {MARKDOWN_WIDTH_LABELS[width]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
```

In `packages/ui/src/components/settings/SettingsModal.tsx`, add a handler next to `handleInternalEditor` (line 246):

```tsx
    const handleMarkdownWidth = useCallback(
        (value: string) =>
            updateSettings({ editor: { markdownWidth: value as MarkdownWidth } }),
        [updateSettings],
    );
```

import the type:

```ts
    type MarkdownWidth,
```

and pass it to `<DefaultsSection ... onMarkdownWidth={handleMarkdownWidth} />`.

The `value as MarkdownWidth` cast is the one narrowing the Radix `Select` requires — its `onValueChange` is typed `(value: string) => void`; the option list is generated from `ALL_MARKDOWN_WIDTHS`, so no other value can reach it. This is a narrowing cast to a specific union, not `as any`.

- [ ] **Step 9: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand: open a long markdown file with bulleted prose, widen the pane past ~1200px, confirm bullets no longer orphan words; switch the setting through narrow/medium/wide/full and confirm the measure changes.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/types/settings.ts packages/shared/src/constants.ts \
        packages/shared/src/markdown-width.test.ts \
        packages/backend/src/services/settings-store.ts \
        packages/ui/src/styles/global.css \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx \
        packages/ui/src/components/settings/sections/DefaultsSection.tsx \
        packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat(markdown): cap prose to a reading measure and stop mid-word breaks"
```

---

## Task 4: Anchors, relative links and tab-local history

**Files:**

- Create: `packages/ui/src/lib/markdown/paths.ts`
- Create: `packages/ui/src/lib/markdown/paths.test.ts`
- Create: `packages/ui/src/lib/markdown/link-target.ts`
- Create: `packages/ui/src/lib/markdown/link-target.test.ts`
- Modify: `packages/ui/src/stores/session-helpers.ts` (history helpers)
- Create: `packages/ui/src/stores/session-helpers.history.test.ts`
- Modify: `packages/ui/src/stores/session-store.ts` (`navigateTab`, `stepTabHistory`)
- Modify: `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx` (back/forward)
- Modify: `packages/ui/src/components/panes/MarkdownPane.tsx` (wire history)
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` (`rehype-slug`, delegated click handler)
- Modify: `packages/ui/package.json` (`rehype-slug`)

**Interfaces:**

- Consumes: `Tab.history`, `Tab.historyIndex` from Task 1; `MarkdownPaneImpl` props from Task 2.
- Produces:
  - `function dirnameOf(filePath: string): string`
  - `function joinRelative(baseDir: string, relative: string): string`
  - `type LinkAction = { kind: "anchor"; hash: string } | { kind: "markdown"; path: string; hash?: string } | { kind: "file"; path: string } | { kind: "external"; url: string } | { kind: "ignore" }`
  - `function resolveLinkTarget(href: string, currentFilePath: string): LinkAction`
  - `function pushHistory(tab: Tab, filePath: string): Tab`
  - `function stepHistory(tab: Tab, delta: -1 | 1): Tab`
  - Session store actions `navigateTab(workspaceKey: string, tabId: string, filePath: string): void` and `stepTabHistory(workspaceKey: string, tabId: string, delta: -1 | 1): void`

- [ ] **Step 1: Write the failing path-helper test**

Create `packages/ui/src/lib/markdown/paths.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { dirnameOf, joinRelative } from "./paths";

describe("dirnameOf", () => {
    it("drops the last segment", () => {
        expect(dirnameOf("/w/docs/wiki/business/money.md")).toBe("/w/docs/wiki/business");
    });

    it("normalises backslashes", () => {
        expect(dirnameOf("C:\\w\\docs\\money.md")).toBe("C:/w/docs");
    });

    it("returns the root for a top-level path", () => {
        expect(dirnameOf("/money.md")).toBe("");
    });
});

describe("joinRelative", () => {
    it("resolves a sibling", () => {
        expect(joinRelative("/w/docs", "./other.md")).toBe("/w/docs/other.md");
    });

    it("resolves a bare relative segment", () => {
        expect(joinRelative("/w/docs", "other.md")).toBe("/w/docs/other.md");
    });

    it("resolves parent traversal", () => {
        expect(joinRelative("/w/docs/business", "../money/currency.md")).toBe(
            "/w/docs/money/currency.md",
        );
    });

    it("collapses redundant segments", () => {
        expect(joinRelative("/w/docs", "./a/./b/../c.md")).toBe("/w/docs/a/c.md");
    });

    it("returns an absolute target unchanged", () => {
        expect(joinRelative("/w/docs", "/etc/hosts")).toBe("/etc/hosts");
    });

    it("does not climb above the filesystem root", () => {
        expect(joinRelative("/w", "../../../etc/hosts")).toBe("/etc/hosts");
    });

    it("decodes percent-encoded segments", () => {
        expect(joinRelative("/w/docs", "my%20page.md")).toBe("/w/docs/my page.md");
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/paths.test.ts`
Expected: FAIL — `Cannot find module './paths'`.

- [ ] **Step 3: Implement the path helpers**

Create `packages/ui/src/lib/markdown/paths.ts`:

```ts
/**
 * POSIX-style path helpers for the renderer. Node's `path` is not available
 * in the browser bundle, and workspace paths are already normalised to
 * forward slashes by the backend (`file-watcher.ts` `normalizePath`).
 */

function toPosix(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function dirnameOf(filePath: string): string {
    const normalized = toPosix(filePath);
    const index = normalized.lastIndexOf("/");
    return index <= 0 ? "" : normalized.slice(0, index);
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/** POSIX root, or a Windows drive prefix once backslashes are normalised. */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;
const DRIVE = /^([A-Za-z]:)\//;

function isAbsolutePath(filePath: string): boolean {
    return ABSOLUTE.test(toPosix(filePath));
}

/**
 * Resolve `relative` against `baseDir`. An absolute `relative` wins outright.
 * `..` never climbs above the root (or the drive prefix), so a crafted link
 * cannot produce a path shaped like an escape; the backend still re-validates
 * every path it is handed.
 */
function joinRelative(baseDir: string, relative: string): string {
    const target = toPosix(relative);
    const base = toPosix(baseDir);
    const source = isAbsolutePath(target) ? target : `${base}/${target}`;
    const drive = DRIVE.exec(source)?.[1] ?? "";
    const rooted = drive !== "" || source.startsWith("/");
    const segments = source.slice(drive.length).split("/");
    const out: string[] = [];

    for (const raw of segments) {
        const segment = decodeSegment(raw);
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            out.pop();
            continue;
        }
        out.push(segment);
    }

    const joined = out.join("/");
    if (drive !== "") return `${drive}/${joined}`;
    return rooted ? `/${joined}` : joined;
}

export { dirnameOf, joinRelative };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/paths.test.ts`
Expected: PASS, 10 tests.

Note the `C:\w\docs\money.md` case yields `C:/w/docs`, and `joinRelative` on a non-rooted base does not prefix `/` — that is why `rooted` exists.

- [ ] **Step 5: Write the failing link-classification test**

Create `packages/ui/src/lib/markdown/link-target.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { resolveLinkTarget } from "./link-target";

const CURRENT = "/w/docs/wiki/business/money.md";

describe("resolveLinkTarget", () => {
    it("treats a bare fragment as an in-page anchor", () => {
        expect(resolveLinkTarget("#currency-notes", CURRENT)).toEqual({
            kind: "anchor",
            hash: "currency-notes",
        });
    });

    it("routes a relative markdown link to the same tab", () => {
        expect(resolveLinkTarget("./glossary.md", CURRENT)).toEqual({
            kind: "markdown",
            path: "/w/docs/wiki/business/glossary.md",
        });
    });

    it("carries a fragment on a markdown link", () => {
        expect(resolveLinkTarget("../money/currency.md#rates", CURRENT)).toEqual({
            kind: "markdown",
            path: "/w/docs/wiki/money/currency.md",
            hash: "rates",
        });
    });

    it("routes other relative files to the file opener", () => {
        expect(resolveLinkTarget("./diagram.png", CURRENT)).toEqual({
            kind: "file",
            path: "/w/docs/wiki/business/diagram.png",
        });
    });

    it("routes http and https to the external browser", () => {
        expect(resolveLinkTarget("https://example.com/x", CURRENT)).toEqual({
            kind: "external",
            url: "https://example.com/x",
        });
        expect(resolveLinkTarget("http://example.com", CURRENT)).toEqual({
            kind: "external",
            url: "http://example.com",
        });
    });

    it("ignores empty hrefs and unsupported schemes", () => {
        expect(resolveLinkTarget("", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("#", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("javascript:alert(1)", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("mailto:a@b.c", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("data:text/html,<b>", CURRENT)).toEqual({ kind: "ignore" });
    });

    it("treats a Windows drive letter as a path, not a URL scheme", () => {
        expect(resolveLinkTarget("C:/w/docs/other.md", "C:/w/docs/money.md")).toEqual({
            kind: "markdown",
            path: "C:/w/docs/other.md",
        });
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/link-target.test.ts`
Expected: FAIL — `Cannot find module './link-target'`.

- [ ] **Step 7: Implement link classification**

Create `packages/ui/src/lib/markdown/link-target.ts`:

```ts
import { dirnameOf, joinRelative } from "./paths";
import { isMarkdownPath } from "@/lib/open-file-plan";

/** What a click on a rendered markdown link should do. */
type LinkAction =
    | { kind: "anchor"; hash: string }
    | { kind: "markdown"; path: string; hash?: string }
    | { kind: "file"; path: string }
    | { kind: "external"; url: string }
    | { kind: "ignore" };

function resolveLinkTarget(href: string, currentFilePath: string): LinkAction {
    const trimmed = href.trim();
    if (trimmed === "" || trimmed === "#") return { kind: "ignore" };

    if (trimmed.startsWith("#")) {
        return { kind: "anchor", hash: decodeURIComponent(trimmed.slice(1)) };
    }

    if (/^https?:\/\//i.test(trimmed)) return { kind: "external", url: trimmed };

    // Any other scheme (javascript:, data:, mailto:, vscode:, ...) is not ours to
    // open. Two or more characters before the colon, so a Windows drive letter
    // ("C:/w/doc.md") is treated as a path rather than an unknown scheme.
    if (/^[a-z][a-z0-9+.-]+:/i.test(trimmed)) return { kind: "ignore" };

    const hashIndex = trimmed.indexOf("#");
    const rawPath = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
    const hash = hashIndex === -1 ? undefined : decodeURIComponent(trimmed.slice(hashIndex + 1));
    if (rawPath === "") return { kind: "ignore" };

    const path = joinRelative(dirnameOf(currentFilePath), rawPath);
    if (isMarkdownPath(path)) {
        return hash === undefined || hash === ""
            ? { kind: "markdown", path }
            : { kind: "markdown", path, hash };
    }
    return { kind: "file", path };
}

export type { LinkAction };
export { resolveLinkTarget };
```

- [ ] **Step 8: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/link-target.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Write the failing history test**

Create `packages/ui/src/stores/session-helpers.history.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { pushHistory, stepHistory } from "./session-helpers";
import type { Tab } from "./session-helpers";

function markdownTab(overrides: Partial<Tab> = {}): Tab {
    return {
        id: "t",
        type: "markdown",
        label: "a.md",
        filePath: "/w/a.md",
        mode: "preview",
        history: ["/w/a.md"],
        historyIndex: 0,
        ...overrides,
    };
}

describe("pushHistory", () => {
    it("appends and moves to the new entry", () => {
        const next = pushHistory(markdownTab(), "/w/b.md");
        expect(next.history).toEqual(["/w/a.md", "/w/b.md"]);
        expect(next.historyIndex).toBe(1);
        expect(next.filePath).toBe("/w/b.md");
        expect(next.label).toBe("b.md");
    });

    it("resets the stored scroll offset for the new page", () => {
        const next = pushHistory(markdownTab({ previewScrollTop: 900 }), "/w/b.md");
        expect(next.previewScrollTop).toBe(0);
    });

    it("truncates the forward entries", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md", "/w/c.md"], historyIndex: 0 });
        const next = pushHistory(tab, "/w/d.md");
        expect(next.history).toEqual(["/w/a.md", "/w/d.md"]);
        expect(next.historyIndex).toBe(1);
    });

    it("is a no-op when navigating to the page already shown", () => {
        const tab = markdownTab();
        expect(pushHistory(tab, "/w/a.md")).toBe(tab);
    });

    it("seeds history for a tab that has none", () => {
        const tab = markdownTab({ history: undefined, historyIndex: undefined });
        const next = pushHistory(tab, "/w/b.md");
        expect(next.history).toEqual(["/w/a.md", "/w/b.md"]);
        expect(next.historyIndex).toBe(1);
    });
});

describe("stepHistory", () => {
    it("goes back", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 1 });
        const next = stepHistory(tab, -1);
        expect(next.historyIndex).toBe(0);
        expect(next.filePath).toBe("/w/a.md");
        expect(next.label).toBe("a.md");
    });

    it("goes forward", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 0 });
        expect(stepHistory(tab, 1).filePath).toBe("/w/b.md");
    });

    it("returns the same tab at either end", () => {
        const atStart = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 0 });
        expect(stepHistory(atStart, -1)).toBe(atStart);
        const atEnd = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 1 });
        expect(stepHistory(atEnd, 1)).toBe(atEnd);
    });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `bun test packages/ui/src/stores/session-helpers.history.test.ts`
Expected: FAIL — `pushHistory is not a function`.

- [ ] **Step 11: Implement the history helpers**

Add to `packages/ui/src/stores/session-helpers.ts`, before the export block:

```ts
function labelForPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

/**
 * Move a markdown tab to `filePath`, truncating any forward entries. Returns
 * the original tab unchanged when the target is already shown, so Zustand
 * subscribers do not re-render on a redundant navigation.
 */
function pushHistory(tab: Tab, filePath: string): Tab {
    const history = tab.history ?? (tab.filePath ? [tab.filePath] : []);
    const index = tab.historyIndex ?? history.length - 1;
    if (history[index] === filePath) return tab;
    const nextHistory = [...history.slice(0, index + 1), filePath];
    return {
        ...tab,
        filePath,
        label: labelForPath(filePath),
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        previewScrollTop: 0,
    };
}

/** Step a markdown tab back (-1) or forward (+1) through its own history. */
function stepHistory(tab: Tab, delta: -1 | 1): Tab {
    const history = tab.history;
    if (!history || history.length === 0) return tab;
    const index = tab.historyIndex ?? history.length - 1;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= history.length) return tab;
    const filePath = history[nextIndex];
    return {
        ...tab,
        filePath,
        label: labelForPath(filePath),
        historyIndex: nextIndex,
        previewScrollTop: 0,
    };
}
```

and add `pushHistory` and `stepHistory` to the export block.

- [ ] **Step 12: Run it to verify it passes**

Run: `bun test packages/ui/src/stores/session-helpers.history.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 13: Add the store actions**

In `packages/ui/src/stores/session-store.ts`, add to the `SessionStore` interface next to `setTabScrollTop`:

```ts
    navigateTab(workspaceKey: string, tabId: string, filePath: string): void;
    stepTabHistory(workspaceKey: string, tabId: string, delta: -1 | 1): void;
```

add `pushHistory, stepHistory` to the existing import from `./session-helpers`, and add to the store body:

```ts
    navigateTab(workspaceKey, tabId, filePath) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId) return tab;
                const updated = pushHistory(tab, filePath);
                if (updated !== tab) changed = true;
                return updated;
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
    stepTabHistory(workspaceKey, tabId, delta) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId) return tab;
                const updated = stepHistory(tab, delta);
                if (updated !== tab) changed = true;
                return updated;
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
```

- [ ] **Step 14: Add back/forward to the toolbar**

Replace `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx`:

```tsx
import { ArrowLeft, ArrowRight, Eye, Pencil } from "lucide-react";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";

interface MarkdownToolbarProps {
    mode: "preview" | "edit";
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onToggleMode: () => void;
}

function MarkdownToolbar({
    mode,
    canGoBack,
    canGoForward,
    onBack,
    onForward,
    onToggleMode,
}: MarkdownToolbarProps) {
    return (
        <Toolbar className="gap-1">
            <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canGoBack}
                onClick={onBack}
                aria-label="Back"
                tooltip="Back"
                tooltipSide="bottom">
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canGoForward}
                onClick={onForward}
                aria-label="Forward"
                tooltip="Forward"
                tooltipSide="bottom">
                <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onToggleMode}
                aria-label={mode === "preview" ? "Edit" : "Preview"}
                tooltip={mode === "preview" ? "Edit" : "Preview"}
                tooltipSide="bottom">
                {mode === "preview" ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
        </Toolbar>
    );
}

export { MarkdownToolbar };
```

- [ ] **Step 15: Wire history into `MarkdownPane`**

In `packages/ui/src/components/panes/MarkdownPane.tsx`, add:

```tsx
    const historyState = useSessionStore((s) => {
        const tab = s.tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId);
        const length = tab?.history?.length ?? 0;
        const index = tab?.historyIndex ?? 0;
        return { canGoBack: index > 0, canGoForward: index < length - 1 };
    });

    const handleBack = useCallback(() => {
        useSessionStore.getState().stepTabHistory(workspaceKey, tabId, -1);
    }, [tabId, workspaceKey]);

    const handleForward = useCallback(() => {
        useSessionStore.getState().stepTabHistory(workspaceKey, tabId, 1);
    }, [tabId, workspaceKey]);
```

The selector returns a fresh object each call, which would re-render on every store write. Guard it with `useShallow`:

```tsx
import { useShallow } from "zustand/react/shallow";
```

and wrap the selector: `useSessionStore(useShallow((s) => { ... }))`.

Then pass the props:

```tsx
            <MarkdownToolbar
                mode={mode}
                canGoBack={historyState.canGoBack}
                canGoForward={historyState.canGoForward}
                onBack={handleBack}
                onForward={handleForward}
                onToggleMode={handleToggleMode}
            />
```

- [ ] **Step 16: Add `rehype-slug` and the delegated click handler**

Install the plugin:

```bash
cd packages/ui && bun add rehype-slug@^6.0.0 && cd ../..
```

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

```ts
import rehypeSlug from "rehype-slug";
import { resolveLinkTarget } from "@/lib/markdown/link-target";
import { openFileInApp } from "@/lib/open-file";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
```

Replace the plugin constant:

```ts
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSlug];
```

Add the click handler inside the component:

```tsx
    const workspace = useActiveWorkspace();

    const handleClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const anchor = target.closest("a");
            if (!anchor) return;
            const href = anchor.getAttribute("href");
            if (href === null) return;

            // Nothing in a markdown preview should ever navigate the webview itself.
            event.preventDefault();
            const action = resolveLinkTarget(href, filePath);

            switch (action.kind) {
                case "anchor":
                    scrollToHash(scrollRef.current, action.hash);
                    break;
                case "markdown":
                    useSessionStore.getState().navigateTab(workspaceKey, tabId, action.path);
                    if (action.hash !== undefined) setPendingHash(action.path, action.hash);
                    break;
                case "file": {
                    const owner =
                        workspace.scope === "task"
                            ? { taskId: workspace.task.id }
                            : workspace.scope === "project"
                              ? { projectId: workspace.project.id }
                              : undefined;
                    void openFileInApp(action.path, workspaceKey, owner);
                    break;
                }
                case "external":
                    void window.taskflow?.openExternalUrl(action.url);
                    break;
                case "ignore":
                    break;
            }
        },
        [filePath, tabId, workspace, workspaceKey],
    );
```

Attach it to the scroll container:

```tsx
        <div
            ref={scrollRef}
            onScroll={handleScroll}
            onClick={handleClick}
            className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
```

and pass the rehype plugins to `<Markdown>`:

```tsx
                <Markdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={components}>
```

- [ ] **Step 17: Add cross-page anchor support**

A link like `../money/currency.md#rates` navigates *and* scrolls, so the target hash must survive the pane's content reload. Add a module-level map at the top of `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`, below the imports:

```ts
/** Pending "#heading" for a page about to be navigated to in this tab. */
const pendingHashes = new Map<string, string>();

function setPendingHash(filePath: string, hash: string): void {
    pendingHashes.set(filePath, hash);
}

/**
 * Scroll to a heading. Tries the fragment verbatim first, then its slugged
 * form, because a hand-written `#Exchange Rates` (and, in Stage 2, a
 * `[[page#Exchange Rates]]`) must reach the id `rehype-slug` actually emitted.
 */
function scrollToHash(container: HTMLElement | null, hash: string): void {
    if (!container || hash === "") return;
    const slugged = new GithubSlugger().slug(hash);
    for (const candidate of [hash, slugged]) {
        const target = container.querySelector(`#${CSS.escape(candidate)}`);
        if (target) {
            target.scrollIntoView({ block: "start" });
            return;
        }
    }
}
```

with `import GithubSlugger from "github-slugger";` (already a dependency after Task 6 — if you are doing Task 4 first, install it now with `cd packages/ui && bun add github-slugger@^2.0.0`).

Consume it in the existing "restore scroll" effect from Task 2, which becomes:

```tsx
    useEffect(() => {
        if (loading) return;
        const el = scrollRef.current;
        if (!el) return;
        const hash = pendingHashes.get(filePath);
        if (hash !== undefined) {
            pendingHashes.delete(filePath);
            scrollToHash(el, hash);
            return;
        }
        el.scrollTop = initialScrollTopRef.current;
    }, [filePath, loading]);
```

Because `filePath` now changes in place when the tab navigates, also reset `initialScrollTopRef` when it does — replace its declaration with:

```tsx
    const initialScrollTopRef = useRef(0);
    useEffect(() => {
        initialScrollTopRef.current =
            useSessionStore
                .getState()
                .tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId)?.previewScrollTop ?? 0;
    }, [filePath, tabId, workspaceKey]);
```

- [ ] **Step 18: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand, in a project with a docs folder: click a table-of-contents anchor (scrolls within the pane, window does not navigate); click a relative `./other.md` link (same tab, back button becomes enabled); press back (returns to the first page); click an `https://` link (opens the system browser).

- [ ] **Step 19: Commit**

```bash
git add packages/ui/package.json bun.lock \
        packages/ui/src/lib/markdown/paths.ts packages/ui/src/lib/markdown/paths.test.ts \
        packages/ui/src/lib/markdown/link-target.ts packages/ui/src/lib/markdown/link-target.test.ts \
        packages/ui/src/stores/session-helpers.ts \
        packages/ui/src/stores/session-helpers.history.test.ts \
        packages/ui/src/stores/session-store.ts \
        packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx \
        packages/ui/src/components/panes/MarkdownPane.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "feat(markdown): resolve anchors and relative links with tab-local history"
```

---

## Task 5: Frontmatter — parse it, render it as a header

**Files:**

- Create: `packages/ui/src/lib/markdown/frontmatter.ts`
- Create: `packages/ui/src/lib/markdown/frontmatter.test.ts`
- Create: `packages/ui/src/components/panes/markdown/FrontmatterHeader.tsx`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
- Modify: `packages/ui/package.json` (`remark-frontmatter`, `yaml`)

**Interfaces:**

- Consumes: `resolveLinkTarget`, `joinRelative`, `dirnameOf` from Task 4.
- Produces:
  - `interface PageFrontmatter { title?: string; parents: string[]; children: string[]; relatedPages: string[]; lastUpdated?: string; extra: Record<string, string> }`
  - `function parseFrontmatter(source: string): PageFrontmatter | null`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/lib/markdown/frontmatter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "./frontmatter";

const PAGE = `---
title: Currency
parents:
  - business/money
children:
  - business/money/currency/rates
related_pages:
  - business/glossary
last_updated: 2026-05-04
owner: finance
---

# Currency

Body text.
`;

describe("parseFrontmatter", () => {
    it("reads the known wiki fields", () => {
        const fm = parseFrontmatter(PAGE);
        expect(fm?.title).toBe("Currency");
        expect(fm?.parents).toEqual(["business/money"]);
        expect(fm?.children).toEqual(["business/money/currency/rates"]);
        expect(fm?.relatedPages).toEqual(["business/glossary"]);
        expect(fm?.lastUpdated).toBe("2026-05-04");
    });

    it("keeps unrecognised scalar fields in extra", () => {
        expect(parseFrontmatter(PAGE)?.extra).toEqual({ owner: "finance" });
    });

    it("accepts an inline-sequence list", () => {
        const fm = parseFrontmatter("---\nparents: [a/b, c/d]\n---\n# t\n");
        expect(fm?.parents).toEqual(["a/b", "c/d"]);
    });

    it("returns null when there is no frontmatter", () => {
        expect(parseFrontmatter("# Heading\n\ntext")).toBeNull();
    });

    it("returns null for a horizontal rule that only looks like a fence", () => {
        expect(parseFrontmatter("---\n\nnot frontmatter\n")).toBeNull();
    });

    it("returns null when the YAML is malformed rather than throwing", () => {
        expect(parseFrontmatter("---\ntitle: [unclosed\n---\n# t\n")).toBeNull();
    });

    it("coerces a single string where a list is expected", () => {
        const fm = parseFrontmatter("---\nparents: business/money\n---\n# t\n");
        expect(fm?.parents).toEqual(["business/money"]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/frontmatter.test.ts`
Expected: FAIL — `Cannot find module './frontmatter'`.

- [ ] **Step 3: Install the dependencies**

```bash
cd packages/ui && bun add remark-frontmatter@^5.0.0 yaml@^2.7.0 && cd ../..
```

- [ ] **Step 4: Implement the parser**

Create `packages/ui/src/lib/markdown/frontmatter.ts`:

```ts
import { parse as parseYaml } from "yaml";

/** The frontmatter fields the wikis actually use, plus anything else as strings. */
interface PageFrontmatter {
    title?: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    extra: Record<string, string>;
}

const KNOWN_KEYS = new Set(["title", "parents", "children", "related_pages", "last_updated"]);

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function toStringList(value: unknown): string[] {
    if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string").map((s) => s.trim());
}

function toOptionalString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return undefined;
}

/**
 * Extract and parse a leading YAML frontmatter block. Returns null when the
 * document has none or the block is not parseable — a broken block must never
 * take the whole preview down.
 */
function parseFrontmatter(source: string): PageFrontmatter | null {
    const match = FENCE.exec(source);
    if (!match) return null;

    let data: unknown;
    try {
        data = parseYaml(match[1]);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

    const record = data as Record<string, unknown>;
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
        if (KNOWN_KEYS.has(key)) continue;
        const asString = toOptionalString(value);
        if (asString !== undefined) extra[key] = asString;
    }

    return {
        title: toOptionalString(record.title),
        parents: toStringList(record.parents),
        children: toStringList(record.children),
        relatedPages: toStringList(record.related_pages),
        lastUpdated: toOptionalString(record.last_updated),
        extra,
    };
}

export type { PageFrontmatter };
export { parseFrontmatter };
```

Note: `yaml` parses `last_updated: 2026-05-04` as a string, not a `Date` — `toOptionalString` handles the `Date` case only for safety if a document quotes a timestamp form that `yaml` does date-coerce.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/frontmatter.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Build the header component**

Create `packages/ui/src/components/panes/markdown/FrontmatterHeader.tsx`:

```tsx
import type { PageFrontmatter } from "@/lib/markdown/frontmatter";

interface FrontmatterHeaderProps {
    frontmatter: PageFrontmatter;
    /** Called with the raw target of a parent/child/related entry. */
    onNavigate: (target: string) => void;
}

interface LinkRowProps {
    label: string;
    targets: string[];
    onNavigate: (target: string) => void;
}

function LinkRow({ label, targets, onNavigate }: LinkRowProps) {
    if (targets.length === 0) return null;
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
            {targets.map((target) => (
                <button
                    key={target}
                    type="button"
                    className="text-accent text-xs hover:underline"
                    onClick={() => onNavigate(target)}>
                    {target}
                </button>
            ))}
        </div>
    );
}

function FrontmatterHeader({ frontmatter, onNavigate }: FrontmatterHeaderProps) {
    const { title, parents, children, relatedPages, lastUpdated } = frontmatter;
    const hasContent =
        title !== undefined ||
        lastUpdated !== undefined ||
        parents.length > 0 ||
        children.length > 0 ||
        relatedPages.length > 0;
    if (!hasContent) return null;

    return (
        <div className="border-border/60 mb-6 flex flex-col gap-1.5 border-b pb-3 not-prose">
            {title !== undefined && (
                <div className="text-foreground text-lg font-semibold">{title}</div>
            )}
            {lastUpdated !== undefined && (
                <div className="text-muted-foreground text-xs">Updated {lastUpdated}</div>
            )}
            <LinkRow label="Parents" targets={parents} onNavigate={onNavigate} />
            <LinkRow label="Children" targets={children} onNavigate={onNavigate} />
            <LinkRow label="Related" targets={relatedPages} onNavigate={onNavigate} />
        </div>
    );
}

export { FrontmatterHeader };
```

- [ ] **Step 7: Render the header and hide the raw block**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

```ts
import remarkFrontmatter from "remark-frontmatter";
import { parseFrontmatter } from "@/lib/markdown/frontmatter";
import { FrontmatterHeader } from "@/components/panes/markdown/FrontmatterHeader";
```

Change the plugin constant:

```ts
const remarkPlugins = [remarkGfm, remarkFrontmatter];
```

`remark-frontmatter` turns the block into an mdast `yaml` node, which react-markdown's mdast→hast conversion drops — so the raw YAML stops rendering as visual garbage without any further work.

Add, next to the other derived values:

```tsx
    const frontmatter = useMemo(() => parseFrontmatter(content), [content]);

    // Frontmatter targets are wiki-style page paths without an extension
    // ("business/money"). Until a wiki root exists (Stage 2) they are resolved
    // relative to the current file, which is correct for same-folder siblings
    // and harmless otherwise — a missing file simply fails to open.
    const handleFrontmatterNavigate = useCallback(
        (target: string) => {
            const withExt = /\.mdx?$|\.markdown$/i.test(target) ? target : `${target}.md`;
            const path = joinRelative(dirnameOf(filePath), withExt);
            useSessionStore.getState().navigateTab(workspaceKey, tabId, path);
        },
        [filePath, tabId, workspaceKey],
    );
```

with imports `useMemo` from react and `dirnameOf, joinRelative` from `@/lib/markdown/paths`.

Render it inside the prose container, above `<Markdown>`:

```tsx
                {frontmatter && (
                    <FrontmatterHeader
                        frontmatter={frontmatter}
                        onNavigate={handleFrontmatterNavigate}
                    />
                )}
```

- [ ] **Step 8: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand: open a wiki page that carries frontmatter. The YAML block no longer renders as text; a compact header shows the title, the update date, and clickable parent/child entries.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/package.json bun.lock \
        packages/ui/src/lib/markdown/frontmatter.ts packages/ui/src/lib/markdown/frontmatter.test.ts \
        packages/ui/src/components/panes/markdown/FrontmatterHeader.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "feat(markdown): parse frontmatter and render it as a page header"
```

---

## Task 6: Checkboxes, copy button, outline extraction

**Files:**

- Create: `packages/ui/src/lib/markdown/task-list.ts`
- Create: `packages/ui/src/lib/markdown/task-list.test.ts`
- Create: `packages/ui/src/lib/markdown/rehype-task-list-line.ts`
- Create: `packages/ui/src/lib/markdown/outline.ts`
- Create: `packages/ui/src/lib/markdown/outline.test.ts`
- Create: `packages/ui/src/components/panes/markdown/CodeBlock.tsx`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
- Modify: `packages/ui/package.json` (`github-slugger`, `unist-util-visit`, `@types/hast`)

**Interfaces:**

- Consumes: `MarkdownPaneImpl` props and the delegated click handler from Task 4.
- Produces:
  - `function toggleTaskListItemAtLine(source: string, line: number): string`
  - `function rehypeTaskListLine(): (tree: Root) => void`
  - `interface OutlineEntry { depth: number; text: string; id: string }`
  - `function extractOutline(source: string): OutlineEntry[]`

The checkbox is located by **source line**, taken from the mdast position that survives into the hast tree, exactly as the spec asks. Counting rendered checkboxes and matching them to the Nth regex hit in the source was considered and rejected: remark-gfm renders task items inside blockquotes (`> - [ ] x`), which a line-start regex misses, and does *not* render task-looking lines inside an indented code block, which a regex counts — either divergence silently toggles the wrong line.

- [ ] **Step 1: Write the failing task-list test**

Create `packages/ui/src/lib/markdown/task-list.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { toggleTaskListItemAtLine } from "./task-list";

const DOC = [
    "# Plan", // 1
    "", // 2
    "- [ ] first", // 3
    "- [x] second", // 4
    "  - [ ] nested", // 5
    "", // 6
    "> - [ ] quoted", // 7
    "", // 8
    "1. [ ] ordered", // 9
    "", // 10
    "* [ ] star bullet", // 11
    "", // 12
    "prose", // 13
].join("\n");

describe("toggleTaskListItemAtLine", () => {
    it("checks an unchecked item", () => {
        expect(toggleTaskListItemAtLine(DOC, 3)).toContain("- [x] first");
    });

    it("unchecks a checked item", () => {
        expect(toggleTaskListItemAtLine(DOC, 4)).toContain("- [ ] second");
    });

    it("handles a nested item", () => {
        expect(toggleTaskListItemAtLine(DOC, 5)).toContain("  - [x] nested");
    });

    it("handles an item inside a blockquote", () => {
        expect(toggleTaskListItemAtLine(DOC, 7)).toContain("> - [x] quoted");
    });

    it("handles an ordered-list item", () => {
        expect(toggleTaskListItemAtLine(DOC, 9)).toContain("1. [x] ordered");
    });

    it("handles a star bullet", () => {
        expect(toggleTaskListItemAtLine(DOC, 11)).toContain("* [x] star bullet");
    });

    it("returns the source unchanged for a line with no checkbox", () => {
        expect(toggleTaskListItemAtLine(DOC, 13)).toBe(DOC);
    });

    it("returns the source unchanged for an out-of-range line", () => {
        expect(toggleTaskListItemAtLine(DOC, 0)).toBe(DOC);
        expect(toggleTaskListItemAtLine(DOC, 999)).toBe(DOC);
    });

    it("preserves CRLF line endings", () => {
        const crlf = "- [ ] a\r\n- [ ] b\r\n";
        expect(toggleTaskListItemAtLine(crlf, 2)).toBe("- [ ] a\r\n- [x] b\r\n");
    });

    it("leaves every other byte identical", () => {
        const out = toggleTaskListItemAtLine(DOC, 3);
        expect(out.replace("- [x] first", "- [ ] first")).toBe(DOC);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/task-list.test.ts`
Expected: FAIL — `Cannot find module './task-list'`.

- [ ] **Step 3: Implement the toggle**

Create `packages/ui/src/lib/markdown/task-list.ts`:

```ts
/** A GFM task marker at the start of a list item, allowing blockquote prefixes. */
const TASK_ITEM = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Flip the checkbox on a 1-based source line. The line comes from the mdast
 * position stamped onto the rendered `<li>`, so only lines the renderer
 * actually turned into a checkbox can ever be passed here. Every other byte of
 * the document is preserved.
 */
function toggleTaskListItemAtLine(source: string, line: number): string {
    const lines = source.split("\n");
    const index = line - 1;
    if (index < 0 || index >= lines.length) return source;

    const text = lines[index];
    const item = TASK_ITEM.exec(text);
    if (!item) return source;

    const next = item[2] === " " ? "x" : " ";
    lines[index] = `${item[1]}${next}${text.slice(item[1].length + 1)}`;
    return lines.join("\n");
}

export { toggleTaskListItemAtLine };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/task-list.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 4a: Stamp the source line onto rendered list items**

Install the AST helpers:

```bash
cd packages/ui && bun add unist-util-visit@^5.0.0 && bun add -d @types/hast@^3.0.4 && cd ../..
```

Create `packages/ui/src/lib/markdown/rehype-task-list-line.ts`:

```ts
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

/**
 * Copy each list item's source line onto the rendered element as
 * `data-source-line`. `mdast-util-to-hast` carries the mdast `position` through
 * to the hast node, so this is the renderer's own idea of where the item came
 * from — not a second guess at parsing the document.
 */
function rehypeTaskListLine() {
    return (tree: Root): void => {
        visit(tree, "element", (node: Element) => {
            if (node.tagName !== "li") return;
            const line = node.position?.start.line;
            if (line === undefined) return;
            node.properties = { ...node.properties, dataSourceLine: line };
        });
    };
}

export { rehypeTaskListLine };
```

- [ ] **Step 5: Write the failing outline test**

Create `packages/ui/src/lib/markdown/outline.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { extractOutline } from "./outline";

describe("extractOutline", () => {
    it("collects ATX headings with depth, text and slug", () => {
        expect(extractOutline("# Money\n\ntext\n\n## Currency notes\n")).toEqual([
            { depth: 1, text: "Money", id: "money" },
            { depth: 2, text: "Currency notes", id: "currency-notes" },
        ]);
    });

    it("strips inline markup before slugging, matching rehype-slug", () => {
        expect(extractOutline("## The `rates` *table*\n")).toEqual([
            { depth: 2, text: "The rates table", id: "the-rates-table" },
        ]);
    });

    it("uses the link text of a heading link", () => {
        expect(extractOutline("## See [the glossary](./g.md)\n")).toEqual([
            { depth: 2, text: "See the glossary", id: "see-the-glossary" },
        ]);
    });

    it("deduplicates repeated headings the way github-slugger does", () => {
        expect(extractOutline("# Notes\n# Notes\n").map((h) => h.id)).toEqual([
            "notes",
            "notes-1",
        ]);
    });

    it("ignores headings inside fenced code blocks", () => {
        expect(extractOutline("```\n# not a heading\n```\n\n# real\n")).toEqual([
            { depth: 1, text: "real", id: "real" },
        ]);
    });

    it("ignores a leading frontmatter block", () => {
        expect(extractOutline("---\ntitle: x\n---\n\n# Real\n")).toEqual([
            { depth: 1, text: "Real", id: "real" },
        ]);
    });

    it("ignores trailing closing hashes", () => {
        expect(extractOutline("## Money ##\n")).toEqual([
            { depth: 2, text: "Money", id: "money" },
        ]);
    });

    it("returns an empty list for a document with no headings", () => {
        expect(extractOutline("just prose\n")).toEqual([]);
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/outline.test.ts`
Expected: FAIL — `Cannot find module './outline'`.

- [ ] **Step 7: Install `github-slugger` and implement the outline**

```bash
cd packages/ui && bun add github-slugger@^2.0.0 && cd ../..
```



`rehype-slug` generates heading ids with `github-slugger`, so using the same library here guarantees the outline's ids match the ids actually present in the DOM.

Create `packages/ui/src/lib/markdown/outline.ts`:

```ts
import GithubSlugger from "github-slugger";

interface OutlineEntry {
    depth: number;
    text: string;
    id: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Reduce inline markdown to the plain text rehype-slug would see. */
function stripInline(text: string): string {
    return text
        .replace(/`([^`]*)`/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/~~(.*?)~~/g, "$1")
        .trim();
}

/**
 * Extract the heading outline from markdown source, skipping fenced code and a
 * leading frontmatter block. Ids come from `github-slugger`, the same generator
 * `rehype-slug` uses, so they match the rendered DOM including its `-1`, `-2`
 * disambiguation suffixes.
 */
function extractOutline(source: string): OutlineEntry[] {
    const lines = source.split("\n");
    const slugger = new GithubSlugger();
    const out: OutlineEntry[] = [];
    let fenceMarker: string | null = null;
    let start = 0;

    if (lines[0]?.trimEnd() === "---") {
        const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
        if (end > 0) start = end + 1;
    }

    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            if (fenceMarker === null) fenceMarker = fence[1];
            else if (fence[1] === fenceMarker) fenceMarker = null;
            continue;
        }
        if (fenceMarker !== null) continue;

        const heading = HEADING.exec(line);
        if (!heading) continue;
        const text = stripInline(heading[2]);
        if (text === "") continue;
        out.push({ depth: heading[1].length, text, id: slugger.slug(text) });
    }

    return out;
}

export type { OutlineEntry };
export { extractOutline };
```

- [ ] **Step 8: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/outline.test.ts`
Expected: PASS, 8 tests.

`extractOutline` is unused in Stage 1 — it is the input to the Stage 2 context rail, and it is built here so that the outline and the rendered heading ids are proven consistent by tests before anything depends on them. Do not export it from a barrel file until Stage 2 consumes it.

- [ ] **Step 9: Extract the code block into a component with a copy button**

Create `packages/ui/src/components/panes/markdown/CodeBlock.tsx`:

```tsx
import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
    code: string;
    language: string;
    fontSize: number;
}

function CodeBlock({ code, language, fontSize }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [code]);

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy code"}
                className="border-border/60 bg-card text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <SyntaxHighlighter
                style={oneDark}
                language={language}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: "0.375rem", fontSize }}>
                {code}
            </SyntaxHighlighter>
        </div>
    );
}

export { CodeBlock };
```

- [ ] **Step 10: Use `CodeBlock` and handle checkbox clicks**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`, replace the `match` branch of the `code` component (lines 80–93) with:

```tsx
            if (match) {
                return (
                    <CodeBlock
                        code={codeString}
                        language={match[1]}
                        fontSize={editorFontSize}
                    />
                );
            }
```

and drop the now-unused `SyntaxHighlighter` / `oneDark` imports, adding:

```ts
import { CodeBlock } from "@/components/panes/markdown/CodeBlock";
import { toggleTaskListItemAtLine } from "@/lib/markdown/task-list";
import { rehypeTaskListLine } from "@/lib/markdown/rehype-task-list-line";
```

Add the plugin to the rehype list:

```ts
const rehypePlugins = [rehypeSlug, rehypeTaskListLine];
```

Then extend the delegated click handler from Task 4 — insert this block at the very top of `handleClick`, before the anchor lookup:

```tsx
            if (target instanceof HTMLInputElement && target.type === "checkbox") {
                const item = target.closest<HTMLElement>("li[data-source-line]");
                const line = Number(item?.dataset.sourceLine);
                if (!Number.isFinite(line)) return;
                const next = toggleTaskListItemAtLine(content, line);
                if (next === content) return;
                setContent(next);
                void writeFile(filePath, next).catch(() => {
                    // The FILE_CHANGED subscription reloads from disk on failure.
                    void loadContent();
                });
                return;
            }
```

and make the rendered checkboxes clickable by overriding the `input` component (react-markdown renders GFM task checkboxes with `disabled`):

```tsx
        input({ ...rest }) {
            if (rest.type === "checkbox") {
                return <input {...rest} disabled={false} readOnly />;
            }
            return <input {...rest} />;
        },
```

Add `writeFile` to the store bindings near `readFile`:

```tsx
    const writeFile = useFileStore((s) => s.writeFile);
```

and add `content`, `writeFile`, `loadContent` to `handleClick`'s dependency array.

- [ ] **Step 11: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand: open a file with a `- [ ]` list, click a checkbox — it fills in, and re-opening the file from disk shows `- [x]`. Repeat with a task item nested two levels deep and with one inside a `>` blockquote; both toggle their own line. Hover a fenced code block — a copy button appears in the corner and copies the code.

- [ ] **Step 12: Commit**

```bash
git add packages/ui/package.json bun.lock \
        packages/ui/src/lib/markdown/task-list.ts packages/ui/src/lib/markdown/task-list.test.ts \
        packages/ui/src/lib/markdown/rehype-task-list-line.ts \
        packages/ui/src/lib/markdown/outline.ts packages/ui/src/lib/markdown/outline.test.ts \
        packages/ui/src/components/panes/markdown/CodeBlock.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "feat(markdown): toggle task list checkboxes, copy code blocks, extract outlines"
```

---

## Task 7: Relative images via a guarded raw-file route

**Files:**

- Create: `packages/backend/src/api/routes/file-routes.ts`
- Create: `packages/backend/tests/api/file-routes.test.ts`
- Modify: `packages/backend/src/api/routes.ts`
- Create: `packages/ui/src/lib/backend-url.ts`
- Modify: `packages/ui/src/hooks/useWebSocket.ts` (expose the connected port)
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` (rewrite `img src`)

**Interfaces:**

- Consumes: `dirnameOf`, `joinRelative` from Task 4.
- Produces:
  - Backend `function registerFileRoutes(deps: Pick<ApiRouteDeps, "apiRouter" | "taskStore">): void`
  - HTTP `GET /api/file/raw?path=<absolute path>` → 200 bytes / 400 / 403 / 404
  - UI `function backendHttpOrigin(): string | null` and `function rawFileUrl(absolutePath: string): string | null`

- [ ] **Step 1: Write the failing route test**

Create `packages/backend/tests/api/file-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerFileRoutes } from "../../src/api/routes/file-routes";

const BASE = "http://localhost";

describe("GET /api/file/raw", () => {
    let tempDir: string;
    let projectDir: string;
    let outsideDir: string;
    let store: TaskStore;
    let apiRouter: ApiRouter;

    async function get(path: string): Promise<Response> {
        const url = `${BASE}/api/file/raw?path=${encodeURIComponent(path)}`;
        const res = await apiRouter.handle(new Request(url));
        if (!res) throw new Error(`No route matched ${url}`);
        return res;
    }

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-raw-")));
        projectDir = join(tempDir, "project");
        outsideDir = join(tempDir, "outside");
        await mkdir(join(projectDir, "docs"), { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeFile(join(projectDir, "docs", "diagram.png"), "PNGDATA");
        await writeFile(join(outsideDir, "secret.txt"), "TOPSECRET");

        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        await store.addProject({ path: projectDir });

        apiRouter = new ApiRouter();
        registerFileRoutes({ apiRouter, taskStore: store });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("serves a file inside a project root with a content type", async () => {
        const res = await get(join(projectDir, "docs", "diagram.png"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await res.text()).toBe("PNGDATA");
    });

    it("rejects a path outside every workspace root", async () => {
        const res = await get(join(outsideDir, "secret.txt"));
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("TOPSECRET");
    });

    it("rejects dot-dot traversal out of a project root", async () => {
        const res = await get(join(projectDir, "docs", "..", "..", "outside", "secret.txt"));
        expect(res.status).toBe(403);
    });

    it("rejects percent-encoded traversal", async () => {
        const url = `${BASE}/api/file/raw?path=${encodeURIComponent(projectDir)}%2F..%2Foutside%2Fsecret.txt`;
        const res = await apiRouter.handle(new Request(url));
        expect(res?.status).toBe(403);
    });

    it("rejects a symlink inside the root that points outside it", async () => {
        await symlink(join(outsideDir, "secret.txt"), join(projectDir, "docs", "leak.txt"));
        const res = await get(join(projectDir, "docs", "leak.txt"));
        expect(res.status).toBe(403);
    });

    it("returns 404 for a missing file inside the root", async () => {
        const res = await get(join(projectDir, "docs", "nope.png"));
        expect(res.status).toBe(404);
    });

    it("returns 400 when the path parameter is absent", async () => {
        const res = await apiRouter.handle(new Request(`${BASE}/api/file/raw`));
        expect(res?.status).toBe(400);
    });

    it("returns 403 for a directory rather than streaming it", async () => {
        const res = await get(join(projectDir, "docs"));
        expect(res.status).toBe(403);
    });

    it("serves svg with a locked-down CSP", async () => {
        await writeFile(join(projectDir, "docs", "d.svg"), "<svg/>");
        const res = await get(join(projectDir, "docs", "d.svg"));
        expect(res.headers.get("content-type")).toBe("image/svg+xml");
        expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    });
});
```

The fixture above mirrors `packages/backend/tests/api/attribute-routes.test.ts:35–55` exactly — all five `TaskStoreConfig` fields, `await store.init()` before use, and `addProject({ path })` with no `name`. If that file has since changed, copy its current calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/backend/tests/api/file-routes.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/routes/file-routes'`.

- [ ] **Step 3: Implement the route**

Create `packages/backend/src/api/routes/file-routes.ts`:

```ts
import { stat } from "fs/promises";
import { extname } from "path";
import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import { assertWorkspacePath } from "../../utils/path-validation";

interface FileRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
}

const CONTENT_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

function registerFileRoutes({ apiRouter, taskStore }: FileRouteDeps): void {
    /**
     * Serve raw bytes for an asset referenced from a markdown preview.
     *
     * This is a security boundary: `assertWorkspacePath` resolves the real path
     * (following symlinks) and requires the result to sit inside a known project
     * or worktree root, so traversal, encoded traversal and symlink escapes all
     * fail closed. Nothing else about the request is trusted.
     */
    apiRouter.register("GET", "/api/file/raw", async (req) => {
        const requested = new URL(req.url).searchParams.get("path");
        if (!requested) return new Response("Missing path", { status: 400 });

        let resolved: string;
        try {
            resolved = await assertWorkspacePath(taskStore, requested);
        } catch {
            return new Response("Forbidden", { status: 403 });
        }

        let isDirectory: boolean;
        try {
            isDirectory = (await stat(resolved)).isDirectory();
        } catch {
            return new Response("Not found", { status: 404 });
        }
        if (isDirectory) return new Response("Forbidden", { status: 403 });

        const extension = extname(resolved).toLowerCase();
        const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
        };
        // An SVG served same-origin can carry script; an <img> will not run it,
        // but a direct navigation would. Deny every subresource for these bytes.
        if (extension === ".svg") headers["Content-Security-Policy"] = "default-src 'none'";

        return new Response(Bun.file(resolved), { headers });
    });
}

export { registerFileRoutes };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/backend/tests/api/file-routes.test.ts`
Expected: PASS, 9 tests.

If the symlink test returns 404 instead of 403, `assertWorkspacePath` resolved the link and rejected it before `stat` ran — check the ordering; the guard must come first, which it does above.

- [ ] **Step 5: Register the route**

In `packages/backend/src/api/routes.ts`, add the import:

```ts
import { registerFileRoutes } from "./routes/file-routes";
```

and the call inside `registerApiRoutes`:

```ts
    registerFileRoutes(deps);
```

- [ ] **Step 6: Expose the backend origin to the renderer**

In `packages/ui/src/hooks/useWebSocket.ts`, add near the other exports:

```ts
export function getBackendPort(): number | null {
    return wsPort;
}
```

Create `packages/ui/src/lib/backend-url.ts`:

```ts
import { getBackendPort } from "@/hooks/useWebSocket";

function backendHttpOrigin(): string | null {
    const port = getBackendPort();
    return port === null ? null : `http://localhost:${port}`;
}

/** URL for the raw bytes of an absolute workspace path, or null before connect. */
function rawFileUrl(absolutePath: string): string | null {
    const origin = backendHttpOrigin();
    if (origin === null) return null;
    return `${origin}/api/file/raw?path=${encodeURIComponent(absolutePath)}`;
}

export { rawFileUrl };
```

(`backendHttpOrigin` stays module-private until something else needs it.)

- [ ] **Step 7: Rewrite image sources in the preview**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`, add to `components`:

```tsx
        img({ src, alt, ...rest }) {
            const source = typeof src === "string" ? src : "";
            if (source === "" || /^(https?:|data:)/i.test(source)) {
                return <img src={source} alt={alt ?? ""} {...rest} />;
            }
            const absolute = joinRelative(dirnameOf(filePath), source);
            const url = rawFileUrl(absolute);
            if (url === null) return <img alt={alt ?? ""} {...rest} />;
            return <img src={url} alt={alt ?? ""} {...rest} />;
        },
```

with `import { rawFileUrl } from "@/lib/backend-url";`.

Because `components` closes over `filePath`, wrap it in `useMemo` keyed on `[editorFontSize, filePath]` so a navigation inside the tab rebuilds it:

```tsx
    const components: Components = useMemo(
        () => ({ /* code, input, img as above */ }),
        [editorFontSize, filePath],
    );
```

- [ ] **Step 8: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand: put a PNG next to a markdown file, reference it as `![](img.png)`, open the preview — the image renders.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/api/routes/file-routes.ts packages/backend/src/api/routes.ts \
        packages/backend/tests/api/file-routes.test.ts \
        packages/ui/src/hooks/useWebSocket.ts packages/ui/src/lib/backend-url.ts \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "feat(markdown): serve relative images through a workspace-guarded raw route"
```

---

## Task 8: Mermaid and math

**Files:**

- Create: `packages/ui/src/components/panes/markdown/MermaidBlock.tsx`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
- Modify: `packages/ui/src/styles/global.css`
- Modify: `packages/ui/package.json` (`mermaid`, `remark-math`, `rehype-katex`, `katex`)

**Interfaces:**

- Consumes: `CodeBlock` from Task 6, the full-bleed CSS hook `.markdown-fullbleed` from Task 3.
- Produces: nothing consumed by later Stage 1 tasks.

- [ ] **Step 1: Install the dependencies**

```bash
cd packages/ui && bun add mermaid@^11.4.0 remark-math@^6.0.0 rehype-katex@^7.0.1 katex@^0.16.11 && cd ../..
```

- [ ] **Step 2: Build the mermaid block**

Create `packages/ui/src/components/panes/markdown/MermaidBlock.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
    code: string;
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

/**
 * Load mermaid on first use only. The library is large and most pages contain
 * no diagrams, so it must never sit in the main chunk.
 */
function loadMermaid(): Promise<typeof import("mermaid").default> {
    mermaidReady ??= import("mermaid").then((module) => {
        module.default.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
        });
        return module.default;
    });
    return mermaidReady;
}

function MermaidBlock({ code }: MermaidBlockProps) {
    const reactId = useId();
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const renderIdRef = useRef(0);

    useEffect(() => {
        const renderId = ++renderIdRef.current;
        setError(null);
        void loadMermaid()
            .then((mermaid) =>
                mermaid.render(`mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`, code),
            )
            .then(({ svg: rendered }) => {
                if (renderId !== renderIdRef.current) return;
                setSvg(rendered);
            })
            .catch((err: unknown) => {
                if (renderId !== renderIdRef.current) return;
                setError(err instanceof Error ? err.message : "Failed to render diagram");
            });
    }, [code, reactId]);

    if (error !== null) {
        return (
            <pre className="border-destructive/40 text-destructive markdown-fullbleed overflow-x-auto rounded-md border p-3 text-xs">
                {error}
                {"\n\n"}
                {code}
            </pre>
        );
    }

    if (svg === null) {
        return <div className="text-muted-foreground p-3 text-xs">Rendering diagram…</div>;
    }

    // mermaid renders trusted-by-construction SVG from the document's own text
    // with securityLevel "strict" (no click handlers, HTML labels escaped).
    return (
        <div
            className="markdown-fullbleed my-4 flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

export { MermaidBlock };
```

- [ ] **Step 3: Route mermaid code fences to it, and add math plugins**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

```ts
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MermaidBlock } from "@/components/panes/markdown/MermaidBlock";
```

Update the plugin arrays:

```ts
const remarkPlugins = [remarkGfm, remarkFrontmatter, remarkMath];
const rehypePlugins = [rehypeSlug, rehypeTaskListLine, rehypeKatex];
```

and in the `code` component, before the `CodeBlock` return:

```tsx
            if (match?.[1] === "mermaid") {
                return <MermaidBlock code={codeString} />;
            }
```

- [ ] **Step 4: Let diagrams and math break out of the measure**

Append to `packages/ui/src/styles/global.css`:

```css
.markdown-preview .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
}

.markdown-preview .markdown-fullbleed svg {
    max-width: 100%;
    height: auto;
}
```

- [ ] **Step 5: Assert mermaid stays out of the main chunk**

Run: `bun run build:ui`

Then inspect the output:

```bash
grep -rl "mermaid" packages/ui/dist/assets/*.js | head
```

Expected: the matches are in their own chunk file(s), and the entry chunk (`packages/ui/dist/assets/index-*.js`) is **not** among them. If the entry chunk matches, the dynamic import was hoisted — check that nothing imports `mermaid` statically.

- [ ] **Step 6: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green.

By hand: create a scratch `.md` containing a ` ```mermaid ` block with `graph TD; A-->B;` and an inline `$E = mc^2$`. Both render. A deliberately broken mermaid block shows the error and the source rather than blanking the page.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/package.json bun.lock \
        packages/ui/src/components/panes/markdown/MermaidBlock.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx \
        packages/ui/src/styles/global.css
git commit -m "feat(markdown): render mermaid diagrams and KaTeX math"
```

---

## Deviations from the spec, and why

Record these in the PR description or commit body — they are deliberate.

1. **No tab migration step.** The spec's §2 "Migration" assumes tabs are persisted. They are not: `session-store.ts:75` initialises `tabsByWorkspace: {}` on every load, and non-session tabs are rebuilt only from live backend sessions via `syncOwnerTabs`. There is no persisted `editor` tab pointing at a `.md` file to rewrite. For the same reason, §3's "The same field persists across app restarts" does not hold for `previewScrollTop` — it survives tab switches and preview↔edit swaps within a session, which is what the reported bug was about.

2. **Checkboxes use the source *line*, not a byte range.** The spec asks for remark node positions; this uses them, via a rehype plugin that copies each `<li>`'s mdast start line onto the element. Flipping the marker on that line is equivalent to a byte range for the single character being changed, and it is simpler than carrying offsets through the render. Counting rendered checkboxes and matching them to regex hits in the source was rejected — blockquoted task items and indented-code decoys make the two orderings diverge.

3. **`extractOutline` is source-scanning, not AST-walking.** It shares `github-slugger` with `rehype-slug`, and the "deduplicates repeated headings" test locks that consistency down. It is also the one piece Stage 2 needs on the *backend*, where no render pipeline exists.

## Self-review notes

- Spec §2 tab model → Task 1. §3 scroll → Task 2. §5 typography → Task 3. §4 `rehype-slug` and §6 link handling → Task 4. §4 frontmatter → Task 5. §7 checkboxes/copy/outline → Task 6. §7 images → Task 7. §4 mermaid + math → Task 8. §4 wiki-links and "no `rehype-raw`" — wiki-links are Stage 2; `rehype-raw` is simply never added, and nothing in this plan adds it.
- §12's "component test for the link-routing table" is satisfied by `link-target.test.ts` as a pure test rather than a DOM test; a happy-dom test cannot meaningfully assert scroll restoration because happy-dom has no layout (`scrollHeight` is always 0), so Task 2 tests the store round-trip instead. This is called out rather than faked.

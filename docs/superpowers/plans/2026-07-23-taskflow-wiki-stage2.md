# Taskflow Wiki (Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `docs/superpowers/plans/2026-07-23-taskflow-markdown-stage1.md` must be complete and merged. This plan imports helpers it created (`joinRelative`, `dirnameOf`, `parseFrontmatter`, `extractOutline`, `resolveLinkTarget`, `navigateTab`, the markdown tab `mode`).

**Goal:** Turn a project folder declared by a `wiki` attribute into a navigable wiki inside Taskflow — a page tree in the sidebar, `[[wiki-links]]` that resolve, backlinks and outline beside the page, an Obsidian handoff, and a health view of broken links and orphans.

**Architecture:** The wiki root is resolved entirely in the renderer from the attribute layers already in the stores (project → parent task → task), so a task in a worktree automatically gets that worktree's copy. The renderer sends the resolved absolute root to a backend `WikiIndexService`, which parses every markdown file under it into a page graph, keeps it fresh with a chokidar watcher, and pushes changes over the existing WebSocket event channel. Markdown primitives that both sides need (frontmatter parsing, outline extraction, path joining) move into `@taskflow/shared` first so there is one implementation.

**Tech Stack:** Bun, TypeScript, React 19, Zustand, chokidar, react-markdown/remark, `bun test` + happy-dom.

## Global Constraints

- Always use `bun`, never `npm` or `yarn`, for installing dependencies and running commands.
- Do not add `Co-Authored-By` trailers to commits.
- Avoid `as any` in TypeScript. Pursue proper type usage.
- Keep types reusable and, where it makes sense, separate from implementation. Check `packages/shared/src/types/` before adding a new type.
- Do not export a symbol until something outside its module imports it.
- Do not disable eslint rules. Find the proper fix.
- Verification commands, run from the repo root: `bun test`, `bun run typecheck`, `bun run lint`.
- Work on the `main` branch. Do not create worktrees or feature branches.
- The wiki attribute name is exactly `wiki`, lowercase, matched exactly. Attribute names are user-authored free text — no fuzzy matching, no case folding, no aliases.
- A `wiki` value pointing at a missing path or a non-directory is "no wiki", surfaced as a warning in the panel. It is never an error and never throws.
- One wiki root per project. Absence of the attribute is not a degraded state — everything from Stage 1 keeps working untouched.

## File Structure

**Moved into `@taskflow/shared` (Task 1):**

| From | To |
|---|---|
| `packages/ui/src/lib/markdown/paths.ts` | `packages/shared/src/utils/markdown/paths.ts` |
| `packages/ui/src/lib/markdown/frontmatter.ts` | `packages/shared/src/utils/markdown/frontmatter.ts` |
| `packages/ui/src/lib/markdown/outline.ts` | `packages/shared/src/utils/markdown/outline.ts` |
| (each with its co-located `.test.ts`) | |

`link-target.ts` and `task-list.ts` stay in the UI — the backend has no use for them.

**New — shared:**

| File | Responsibility |
|---|---|
| `packages/shared/src/types/wiki.ts` | `WikiPage`, `WikiHeading`, `WikiTreeNode`, `WikiIndexData`, `WikiUnresolvedLink`, `ObsidianState` |
| `packages/shared/src/utils/wiki-root.ts` | `WIKI_ATTRIBUTE_NAME`, `resolveWikiRoot` |
| `packages/shared/src/utils/wiki-link.ts` | `parseWikiLinks` — find `[[...]]` spans in a string |

**New — backend:**

| File | Responsibility |
|---|---|
| `packages/backend/src/services/wiki-page.ts` | Parse one markdown file into a `WikiPage` (pure) |
| `packages/backend/src/services/wiki-graph.ts` | Build tree, backlinks, unresolved links, orphans from pages (pure) |
| `packages/backend/src/services/wiki-index.ts` | `WikiIndexService` — scan, cache, watch, patch |
| `packages/backend/src/services/obsidian-detector.ts` | Detect the app, read the vault registry, classify a path |
| `packages/backend/src/handlers/wiki.ts` | `WIKI_INDEX`, `WIKI_OBSIDIAN_STATE` handlers |
| `packages/backend/tests/services/wiki-page.test.ts` | |
| `packages/backend/tests/services/wiki-graph.test.ts` | |
| `packages/backend/tests/services/wiki-index.test.ts` | |
| `packages/backend/tests/services/obsidian-detector.test.ts` | |

**New — UI:**

| File | Responsibility |
|---|---|
| `packages/ui/src/stores/wiki-store.ts` | Index cache per root, fetch + live patch |
| `packages/ui/src/hooks/useWikiRoot.ts` | Resolve the active workspace's wiki root |
| `packages/ui/src/lib/markdown/remark-wiki-link.ts` | `[[...]]` → link nodes |
| `packages/ui/src/components/panels/WikiPanel.tsx` | Filter box + page tree + `⋯` menu |
| `packages/ui/src/components/panels/WikiTree.tsx` | The tree itself |
| `packages/ui/src/components/panels/WikiHealth.tsx` | Orphans and broken links |
| `packages/ui/src/components/panes/markdown/WikiRail.tsx` | On this page / Children / Linked from |

**Modified:** `packages/shared/src/constants.ts` (MSG), `packages/shared/src/index.ts`, `packages/shared/src/types/ws.ts`, `packages/backend/src/index.ts`, `packages/ui/src/stores/ui-store.ts`, `packages/ui/src/components/AppShell.tsx`, `packages/ui/src/components/workspace/TaskHeader.tsx`, `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`, `packages/ui/src/styles/global.css`, `packages/ui/package.json`, `packages/shared/package.json`.

---

## Task 1: Move the markdown primitives into `@taskflow/shared`

Mechanical but load-bearing: the backend index and the renderer must agree byte-for-byte on frontmatter fields and heading slugs, and the only way to guarantee that is one implementation.

**Files:**

- Create: `packages/shared/src/utils/markdown/paths.ts`, `paths.test.ts`
- Create: `packages/shared/src/utils/markdown/frontmatter.ts`, `frontmatter.test.ts`
- Create: `packages/shared/src/utils/markdown/outline.ts`, `outline.test.ts`
- Delete: the six equivalent files under `packages/ui/src/lib/markdown/`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json`
- Modify: `packages/ui/package.json` (drop `yaml` only — `github-slugger` is still imported by UI code)
- Modify: every UI importer of the moved modules

**Interfaces:**

- Consumes: the Stage 1 modules verbatim.
- Produces: `dirnameOf`, `joinRelative`, `isAbsolutePath`, `parseFrontmatter`, `PageFrontmatter`, `extractOutline`, `OutlineEntry` — all exported from `@taskflow/shared`.

- [ ] **Step 1: Add the dependencies to shared, remove them from the UI**

```bash
cd packages/shared && bun add yaml@^2.7.0 github-slugger@^2.0.0 && cd ../..
cd packages/ui && bun remove yaml && cd ../..
```

`github-slugger` stays a UI dependency: `MarkdownPaneImpl`'s `scrollToHash` (Stage 1 Task 4) imports it directly. Only `yaml`, which nothing in the UI imports once `frontmatter.ts` has moved, is dropped.

- [ ] **Step 2: Move the files**

```bash
mkdir -p packages/shared/src/utils/markdown
git mv packages/ui/src/lib/markdown/paths.ts packages/shared/src/utils/markdown/paths.ts
git mv packages/ui/src/lib/markdown/paths.test.ts packages/shared/src/utils/markdown/paths.test.ts
git mv packages/ui/src/lib/markdown/frontmatter.ts packages/shared/src/utils/markdown/frontmatter.ts
git mv packages/ui/src/lib/markdown/frontmatter.test.ts packages/shared/src/utils/markdown/frontmatter.test.ts
git mv packages/ui/src/lib/markdown/outline.ts packages/shared/src/utils/markdown/outline.ts
git mv packages/ui/src/lib/markdown/outline.test.ts packages/shared/src/utils/markdown/outline.test.ts
```

- [ ] **Step 3: Export `isAbsolutePath` and re-export from the barrel**

In `packages/shared/src/utils/markdown/paths.ts`, change the final line to:

```ts
export { dirnameOf, isAbsolutePath, joinRelative };
```

Add to `packages/shared/src/index.ts`:

```ts
export * from "./utils/markdown/paths";
export * from "./utils/markdown/frontmatter";
export * from "./utils/markdown/outline";
```

- [ ] **Step 4: Repoint the UI imports**

Find every importer:

```bash
grep -rn "lib/markdown/paths\|lib/markdown/frontmatter\|lib/markdown/outline" packages/ui/src
```

Expected hits, all three of them:

| File | Replace with |
|---|---|
| `packages/ui/src/lib/markdown/link-target.ts` | `import { dirnameOf, joinRelative } from "@taskflow/shared";` |
| `packages/ui/src/components/panes/MarkdownPaneImpl.tsx` | fold `dirnameOf`, `joinRelative`, `parseFrontmatter` into the existing `@taskflow/shared` import |
| `packages/ui/src/components/panes/markdown/FrontmatterHeader.tsx` | `import type { PageFrontmatter } from "@taskflow/shared";` |

Do not skip the third: it imports only the *type*, so missing it fails at `bun run typecheck` rather than at test time.

Then confirm nothing is left behind:

```bash
grep -rn "lib/markdown/paths\|lib/markdown/frontmatter\|lib/markdown/outline" packages/ui/src
```

Expected: no output.

- [ ] **Step 5: Run the tests to verify nothing broke**

Run: `bun test packages/shared/src/utils/markdown && bun run typecheck && bun run lint`
Expected: all three moved test files pass at their new location (10 + 7 + 8 tests), no type errors, no lint errors.

Then the full suite: `bun test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A packages/shared packages/ui bun.lock
git commit -m "refactor(markdown): move frontmatter, outline and path helpers into shared"
```

---

## Task 2: Resolve the `wiki` attribute to a root path

**Files:**

- Create: `packages/shared/src/utils/wiki-root.ts`
- Create: `packages/shared/src/utils/wiki-root.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/ui/src/hooks/useWikiRoot.ts`

**Interfaces:**

- Consumes: `isAbsolutePath`, `joinRelative` from Task 1; `resolveAttributes` and `AttributeLayer` from `@taskflow/shared`.
- Produces:
  - `const WIKI_ATTRIBUTE_NAME = "wiki"`
  - `function resolveWikiRoot(args: { layers: AttributeLayer[]; workingDir: string | null }): string | null`
  - `function useWikiRoot(): string | null` (UI hook)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/utils/wiki-root.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { AttributeLayer } from "../types/attribute";
import { resolveWikiRoot } from "./wiki-root";

function layers(...entries: Array<[AttributeLayer["scope"], string, string]>): AttributeLayer[] {
    const byScope = new Map<AttributeLayer["scope"], AttributeLayer>();
    entries.forEach(([scope, name, value], i) => {
        const layer = byScope.get(scope) ?? { scope, attributes: [] };
        layer.attributes.push({ id: `a${i}`, name, value });
        byScope.set(scope, layer);
    });
    return ["project", "parent", "task"]
        .map((scope) => byScope.get(scope as AttributeLayer["scope"]))
        .filter((layer): layer is AttributeLayer => layer !== undefined);
}

describe("resolveWikiRoot", () => {
    it("resolves a relative value against the working dir", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/wiki");
    });

    it("uses an absolute value as-is", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "/srv/notes"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/srv/notes");
    });

    it("resolves against a worktree working dir, not the main checkout", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: "/w/repo/.worktrees/feature",
            }),
        ).toBe("/w/repo/.worktrees/feature/docs/wiki");
    });

    it("lets a task-scoped value shadow the project value", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"], ["task", "wiki", "docs/other"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/other");
    });

    it("matches the attribute name exactly", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "Wiki", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBeNull();
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki-root", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBeNull();
    });

    it("returns null with no wiki attribute, no working dir, or an empty value", () => {
        expect(resolveWikiRoot({ layers: layers(), workingDir: "/w/repo" })).toBeNull();
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: null,
            }),
        ).toBeNull();
        expect(
            resolveWikiRoot({ layers: layers(["project", "wiki", "  "]), workingDir: "/w/repo" }),
        ).toBeNull();
    });

    it("strips a trailing slash", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki/"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/wiki");
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/shared/src/utils/wiki-root.test.ts`
Expected: FAIL — `Cannot find module './wiki-root'`.

- [ ] **Step 3: Implement it**

Create `packages/shared/src/utils/wiki-root.ts`:

```ts
import type { AttributeLayer } from "../types/attribute";
import { resolveAttributes } from "./attributes";
import { isAbsolutePath, joinRelative } from "./markdown/paths";

/**
 * The one attribute that declares a wiki. Attribute names are user-authored
 * free text, so this is matched exactly — no case folding, no aliases.
 */
const WIKI_ATTRIBUTE_NAME = "wiki";

interface ResolveWikiRootArgs {
    layers: AttributeLayer[];
    workingDir: string | null;
}

/**
 * Resolve the wiki root for a workspace, honouring the normal attribute
 * layering so a task shadows its parent shadows its project. A relative value
 * resolves against `workingDir`, which for a task in a worktree is that
 * worktree — the correct behaviour when a task is editing docs.
 *
 * Returns null when there is no `wiki` attribute, no working dir, or an empty
 * value. Whether the path actually exists is not decided here.
 */
function resolveWikiRoot({ layers, workingDir }: ResolveWikiRootArgs): string | null {
    const resolved = resolveAttributes(layers);
    const attribute = resolved.find((entry) => entry.name === WIKI_ATTRIBUTE_NAME);
    const value = attribute?.value.trim() ?? "";
    if (value === "") return null;

    const withoutTrailingSlash = value.replace(/[/\\]+$/, "");
    if (withoutTrailingSlash === "") return null;

    if (isAbsolutePath(withoutTrailingSlash)) {
        return joinRelative("", withoutTrailingSlash);
    }
    if (workingDir === null) return null;
    return joinRelative(workingDir, withoutTrailingSlash);
}

export { WIKI_ATTRIBUTE_NAME, resolveWikiRoot };
```

Add to `packages/shared/src/index.ts`:

```ts
export * from "./utils/wiki-root";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/shared/src/utils/wiki-root.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the UI hook**

Create `packages/ui/src/hooks/useWikiRoot.ts`:

```ts
import { useMemo } from "react";
import type { AttributeLayer } from "@taskflow/shared";
import { resolveWikiRoot } from "@taskflow/shared";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useTaskStore } from "@/stores/task-store";

/**
 * Absolute wiki root for the active workspace, or null when the workspace has
 * no `wiki` attribute. Mirrors the layering TaskInfoPanel builds for the
 * attributes editor: project, then parent task, then the task itself.
 */
function useWikiRoot(): string | null {
    const workspace = useActiveWorkspace();
    const task = workspace.task;
    const project = workspace.project;
    const parentTask = useTaskStore((s) =>
        task?.parentId ? s.tasks.find((t) => t.id === task.parentId) : undefined,
    );

    return useMemo(() => {
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: project?.attributes ?? [] },
        ];
        if (task?.parentId) {
            layers.push({ scope: "parent", attributes: parentTask?.attributes ?? [] });
        }
        if (task) layers.push({ scope: "task", attributes: task.attributes });
        return resolveWikiRoot({ layers, workingDir: workspace.workingDir });
    }, [parentTask, project, task, workspace.workingDir]);
}

export { useWikiRoot };
```

- [ ] **Step 6: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green. (`useWikiRoot` is unused until Task 4 — that is expected and lint does not flag unused exports.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/utils/wiki-root.ts packages/shared/src/utils/wiki-root.test.ts \
        packages/shared/src/index.ts packages/ui/src/hooks/useWikiRoot.ts
git commit -m "feat(wiki): resolve the wiki attribute to an absolute root path"
```

---

## Task 3: Parse a page and build the graph

Two pure modules with no filesystem access, so the whole index is testable from strings.

**Files:**

- Create: `packages/shared/src/types/wiki.ts`
- Create: `packages/shared/src/utils/wiki-link.ts`, `wiki-link.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/backend/src/services/wiki-page.ts`
- Create: `packages/backend/tests/services/wiki-page.test.ts`
- Create: `packages/backend/src/services/wiki-graph.ts`
- Create: `packages/backend/tests/services/wiki-graph.test.ts`

**Interfaces:**

- Consumes: `parseFrontmatter`, `extractOutline`, `dirnameOf`, `joinRelative` from Task 1.
- Produces:
  - `interface WikiLinkSpan { start: number; end: number; target: string; alias?: string; hash?: string }` and `function parseWikiLinks(source: string): WikiLinkSpan[]`
  - `interface WikiHeading { depth: number; text: string; id: string }`
  - `interface WikiPage { id: string; path: string; title: string; parents: string[]; children: string[]; relatedPages: string[]; lastUpdated?: string; headings: WikiHeading[]; links: string[]; mtimeMs: number }`
  - `interface WikiTreeNode { name: string; type: "page" | "folder"; id?: string; children?: WikiTreeNode[] }`
  - `interface WikiUnresolvedLink { from: string; target: string }`
  - `interface WikiIndexData { root: string; pages: WikiPage[]; tree: WikiTreeNode[]; backlinks: Record<string, string[]>; unresolved: WikiUnresolvedLink[]; orphans: string[] }`
  - `function parseWikiPage(args: { pageId: string; relativePath: string; source: string; mtimeMs: number }): WikiPage`
  - `function buildWikiGraph(root: string, pages: ParsedWikiPage[], rootExists: boolean): WikiIndexData`

- [ ] **Step 1: Write the failing wiki-link test**

Create `packages/shared/src/utils/wiki-link.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseWikiLinks } from "./wiki-link";

describe("parseWikiLinks", () => {
    it("finds a plain path link", () => {
        // "see " is 4 chars; "[[business/money/currency]]" is 27, so end is 31.
        expect(parseWikiLinks("see [[business/money/currency]] now")).toEqual([
            { start: 4, end: 31, target: "business/money/currency" },
        ]);
    });

    it("splits an alias", () => {
        const [link] = parseWikiLinks("[[business/money|the money page]]");
        expect(link.target).toBe("business/money");
        expect(link.alias).toBe("the money page");
    });

    it("splits a heading fragment", () => {
        const [link] = parseWikiLinks("[[business/money#exchange rates]]");
        expect(link.target).toBe("business/money");
        expect(link.hash).toBe("exchange rates");
    });

    it("splits a fragment and an alias together", () => {
        const [link] = parseWikiLinks("[[a/b#c|D]]");
        expect(link).toMatchObject({ target: "a/b", hash: "c", alias: "D" });
    });

    it("finds several links on one line", () => {
        expect(parseWikiLinks("[[a]] and [[b]]").map((l) => l.target)).toEqual(["a", "b"]);
    });

    it("trims surrounding whitespace inside the brackets", () => {
        expect(parseWikiLinks("[[  a/b  ]]")[0].target).toBe("a/b");
    });

    it("ignores empty and unterminated brackets", () => {
        expect(parseWikiLinks("[[]] and [[ ]] and [[unterminated")).toEqual([]);
    });

    it("ignores a normal markdown link", () => {
        expect(parseWikiLinks("[label](./a.md)")).toEqual([]);
    });

    it("reports offsets that slice back to the original text", () => {
        const source = "x [[a/b|c]] y";
        const [link] = parseWikiLinks(source);
        expect(source.slice(link.start, link.end)).toBe("[[a/b|c]]");
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/shared/src/utils/wiki-link.test.ts`
Expected: FAIL — `Cannot find module './wiki-link'`.

- [ ] **Step 3: Implement `parseWikiLinks`**

Create `packages/shared/src/utils/wiki-link.ts`:

```ts
/** One `[[target#hash|alias]]` span found in a source string. */
interface WikiLinkSpan {
    start: number;
    end: number;
    target: string;
    alias?: string;
    hash?: string;
}

const WIKI_LINK = /\[\[([^\][]+)\]\]/g;

/**
 * Find every wiki-link in a string. Targets in the observed wikis are
 * path-based ("business/money/currency"), not title-based, so no title lookup
 * happens here — resolution against a root is the caller's job.
 */
function parseWikiLinks(source: string): WikiLinkSpan[] {
    const out: WikiLinkSpan[] = [];
    WIKI_LINK.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK.exec(source)) !== null) {
        const inner = match[1];
        const pipeIndex = inner.indexOf("|");
        const beforeAlias = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
        const alias = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1).trim();

        const hashIndex = beforeAlias.indexOf("#");
        const target = (hashIndex === -1 ? beforeAlias : beforeAlias.slice(0, hashIndex)).trim();
        const hash = hashIndex === -1 ? undefined : beforeAlias.slice(hashIndex + 1).trim();

        if (target === "") continue;

        out.push({
            start: match.index,
            end: match.index + match[0].length,
            target,
            ...(alias !== undefined && alias !== "" && { alias }),
            ...(hash !== undefined && hash !== "" && { hash }),
        });
    }

    return out;
}

export type { WikiLinkSpan };
export { parseWikiLinks };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/shared/src/utils/wiki-link.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the wiki types**

Create `packages/shared/src/types/wiki.ts`:

```ts
export interface WikiHeading {
    depth: number;
    text: string;
    id: string;
}

export interface WikiPage {
    /** Path relative to the wiki root, without the extension. The page id. */
    id: string;
    /** Path relative to the wiki root, with the extension. */
    path: string;
    title: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    headings: WikiHeading[];
    /** Page ids this page links to, deduplicated, in first-appearance order. */
    links: string[];
    /** Link targets that did not resolve to a page id. */
    brokenLinks: string[];
    mtimeMs: number;
}

export interface WikiTreeNode {
    name: string;
    type: "page" | "folder";
    /** Page id — present on pages, and on folders that have an index page. */
    id?: string;
    children?: WikiTreeNode[];
}

export interface WikiUnresolvedLink {
    from: string;
    target: string;
}

export interface WikiIndexData {
    root: string;
    /**
     * False when the `wiki` attribute points at a path that is missing or is
     * not a directory. The UI shows a warning; it is never an error.
     */
    rootExists: boolean;
    pages: WikiPage[];
    tree: WikiTreeNode[];
    /** page id → ids of pages linking to it */
    backlinks: Record<string, string[]>;
    unresolved: WikiUnresolvedLink[];
    /** Page ids with no incoming links and no declared parent. */
    orphans: string[];
}
```

Add to `packages/shared/src/index.ts`:

```ts
export * from "./types/wiki";
export * from "./utils/wiki-link";
```

- [ ] **Step 6: Write the failing page-parse test**

Create `packages/backend/tests/services/wiki-page.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseWikiPage } from "../../src/services/wiki-page";

function parse(source: string, pageId = "business/money") {
    return parseWikiPage({
        pageId,
        relativePath: `${pageId}.md`,
        source,
        mtimeMs: 1000,
    });
}

describe("parseWikiPage", () => {
    it("prefers the frontmatter title", () => {
        expect(parse("---\ntitle: Money\n---\n\n# Something else\n").title).toBe("Money");
    });

    it("falls back to the first H1", () => {
        expect(parse("# Something else\n\ntext\n").title).toBe("Something else");
    });

    it("falls back to the filename when there is neither", () => {
        expect(parse("just prose\n", "business/money").title).toBe("money");
    });

    it("carries the frontmatter relationship fields", () => {
        const page = parse(
            "---\nparents:\n  - business\nchildren:\n  - business/money/rates\nrelated_pages:\n  - g\nlast_updated: 2026-05-04\n---\n\n# Money\n",
        );
        expect(page.parents).toEqual(["business"]);
        expect(page.children).toEqual(["business/money/rates"]);
        expect(page.relatedPages).toEqual(["g"]);
        expect(page.lastUpdated).toBe("2026-05-04");
    });

    it("collects headings with slugs", () => {
        expect(parse("# Money\n\n## Exchange rates\n").headings).toEqual([
            { depth: 1, text: "Money", id: "money" },
            { depth: 2, text: "Exchange rates", id: "exchange-rates" },
        ]);
    });

    it("collects wiki-link targets", () => {
        expect(parse("# t\n\nsee [[business/glossary]] and [[a/b|alias]]\n").rawLinks).toEqual([
            "business/glossary",
            "a/b",
        ]);
    });

    it("collects relative markdown link targets, resolved against the page", () => {
        expect(parse("# t\n\n[g](./glossary.md) and [r](../rates.md)\n").rawLinks).toEqual([
            "business/glossary",
            "rates",
        ]);
    });

    it("ignores external links", () => {
        expect(parse("# t\n\n[x](https://example.com)\n").rawLinks).toEqual([]);
    });

    it("deduplicates repeated targets, keeping first-appearance order", () => {
        expect(parse("# t\n\n[[b]] [[a]] [[b]]\n").rawLinks).toEqual(["b", "a"]);
    });

    it("interleaves markdown links and wiki-links in source order", () => {
        expect(parse("# t\n\n[m](./m.md) then [[w]] then [n](./n.md)\n").rawLinks).toEqual([
            "business/m",
            "w",
            "business/n",
        ]);
    });

    it("ignores links inside fenced code blocks", () => {
        const source = "# t\n\n```md\n[[not-a-link]] and [x](./x.md)\n```\n\n[[real]]\n";
        expect(parse(source).rawLinks).toEqual(["real"]);
    });

    it("keeps the id, path and mtime it was given", () => {
        const page = parse("# t\n");
        expect(page.id).toBe("business/money");
        expect(page.path).toBe("business/money.md");
        expect(page.mtimeMs).toBe(1000);
    });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `bun test packages/backend/tests/services/wiki-page.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/wiki-page'`.

- [ ] **Step 8: Implement `parseWikiPage`**

Note the test asserts on `rawLinks`, not `links`: link *resolution* needs the set of all page ids, which only `buildWikiGraph` has. `parseWikiPage` therefore emits candidate targets, and the graph builder splits them into `links` and `brokenLinks`.

Create `packages/backend/src/services/wiki-page.ts`:

```ts
import type { WikiHeading } from "@taskflow/shared";
import { dirnameOf, extractOutline, joinRelative, parseFrontmatter, parseWikiLinks } from "@taskflow/shared";

/** A page as parsed from a single file, before links are resolved against the graph. */
interface ParsedWikiPage {
    id: string;
    path: string;
    title: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    headings: WikiHeading[];
    /** Candidate page ids, deduplicated, in first-appearance order. */
    rawLinks: string[];
    mtimeMs: number;
}

interface ParseWikiPageArgs {
    pageId: string;
    relativePath: string;
    source: string;
    mtimeMs: number;
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE = /^\s*(```|~~~)/;

function stripExtension(path: string): string {
    return path.replace(/\.(md|markdown)$/i, "");
}

/**
 * Blank out the contents of fenced code blocks, preserving length and newlines
 * so offsets still line up. A `[[link]]` shown as an example is documentation,
 * not a graph edge, and counting it would corrupt backlinks and orphans.
 */
function blankFencedCode(source: string): string {
    const lines = source.split("\n");
    let marker: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const fence = FENCE.exec(lines[i]);
        if (fence) {
            if (marker === null) marker = fence[1];
            else if (fence[1] === marker) marker = null;
            lines[i] = " ".repeat(lines[i].length);
            continue;
        }
        if (marker !== null) lines[i] = " ".repeat(lines[i].length);
    }
    return lines.join("\n");
}

/** Resolve a relative markdown link to a page id relative to the wiki root. */
function relativeLinkToPageId(pageId: string, href: string): string | null {
    if (href === "" || href.startsWith("#")) return null;
    if (/^[a-z][a-z0-9+.-]+:/i.test(href)) return null;
    const withoutHash = href.split("#")[0];
    if (withoutHash === "") return null;
    if (!/\.(md|markdown)$/i.test(withoutHash)) return null;
    const resolved = joinRelative(dirnameOf(pageId), withoutHash);
    return stripExtension(resolved.replace(/^\/+/, ""));
}

function parseWikiPage({
    pageId,
    relativePath,
    source,
    mtimeMs,
}: ParseWikiPageArgs): ParsedWikiPage {
    const frontmatter = parseFrontmatter(source);
    const headings = extractOutline(source);
    const firstH1 = headings.find((heading) => heading.depth === 1);
    const title =
        frontmatter?.title ??
        firstH1?.text ??
        (pageId.split("/").pop() ?? pageId);

    // Both link syntaxes are collected with their offsets and merged, so
    // `rawLinks` really is first-appearance order across the whole document.
    const scanned = blankFencedCode(source);
    const found: Array<{ at: number; target: string }> = [];

    for (const link of parseWikiLinks(scanned)) {
        found.push({ at: link.start, target: link.target });
    }

    MARKDOWN_LINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK.exec(scanned)) !== null) {
        const target = relativeLinkToPageId(pageId, match[1]);
        if (target !== null) found.push({ at: match.index, target });
    }

    found.sort((a, b) => a.at - b.at);

    const rawLinks: string[] = [];
    const seen = new Set<string>();
    for (const { target } of found) {
        if (target === "" || seen.has(target)) continue;
        seen.add(target);
        rawLinks.push(target);
    }

    return {
        id: pageId,
        path: relativePath,
        title,
        parents: frontmatter?.parents ?? [],
        children: frontmatter?.children ?? [],
        relatedPages: frontmatter?.relatedPages ?? [],
        ...(frontmatter?.lastUpdated !== undefined && { lastUpdated: frontmatter.lastUpdated }),
        headings,
        rawLinks,
        mtimeMs,
    };
}

export type { ParsedWikiPage };
export { parseWikiPage };
```

- [ ] **Step 9: Run it to verify it passes**

Run: `bun test packages/backend/tests/services/wiki-page.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 10: Write the failing graph test**

Create `packages/backend/tests/services/wiki-graph.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ParsedWikiPage } from "../../src/services/wiki-page";
import { buildWikiGraph } from "../../src/services/wiki-graph";

function page(id: string, overrides: Partial<ParsedWikiPage> = {}): ParsedWikiPage {
    return {
        id,
        path: `${id}.md`,
        title: id.split("/").pop() ?? id,
        parents: [],
        children: [],
        relatedPages: [],
        headings: [],
        rawLinks: [],
        mtimeMs: 0,
        ...overrides,
    };
}

describe("buildWikiGraph", () => {
    it("splits resolved links from broken ones", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["b", "nope"] }),
            page("b"),
        ]);
        const a = graph.pages.find((p) => p.id === "a");
        expect(a?.links).toEqual(["b"]);
        expect(a?.brokenLinks).toEqual(["nope"]);
        expect(graph.unresolved).toEqual([{ from: "a", target: "nope" }]);
    });

    it("builds the reverse backlink map", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["c"] }),
            page("b", { rawLinks: ["c"] }),
            page("c"),
        ]);
        expect(graph.backlinks["c"]).toEqual(["a", "b"]);
        expect(graph.backlinks["a"]).toBeUndefined();
    });

    it("resolves a link that omits an index suffix to the folder index page", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["business"] }),
            page("business/index"),
        ]);
        expect(graph.pages.find((p) => p.id === "a")?.links).toEqual(["business/index"]);
    });

    it("nests pages under folders in the tree", () => {
        const graph = buildWikiGraph("/root", true, [page("business/money"), page("readme")]);
        expect(graph.tree).toEqual([
            {
                name: "business",
                type: "folder",
                children: [{ name: "money", type: "page", id: "business/money" }],
            },
            { name: "readme", type: "page", id: "readme" },
        ]);
    });

    it("sorts folders before pages, then alphabetically", () => {
        const graph = buildWikiGraph("/root", true, [
            page("zeta"),
            page("alpha"),
            page("mid/one"),
        ]);
        expect(graph.tree.map((node) => node.name)).toEqual(["mid", "alpha", "zeta"]);
    });

    it("hoists a folder's index page onto the folder node", () => {
        const graph = buildWikiGraph("/root", true, [
            page("business/index"),
            page("business/alpha"),
        ]);
        const folder = graph.tree.find((node) => node.name === "business");
        expect(folder?.id).toBe("business/index");
        expect(folder?.children?.map((node) => node.id)).toEqual(["business/alpha"]);
    });

    it("also accepts README as a folder's index page", () => {
        const graph = buildWikiGraph("/root", true, [page("business/README")]);
        expect(graph.tree.find((node) => node.name === "business")?.id).toBe("business/README");
    });

    it("orders a folder's children by the index page's declared children list", () => {
        const graph = buildWikiGraph("/root", true, [
            page("business/index", { children: ["business/zeta", "business/alpha"] }),
            page("business/alpha"),
            page("business/zeta"),
        ]);
        const folder = graph.tree.find((node) => node.name === "business");
        expect(folder?.children?.map((node) => node.id)).toEqual([
            "business/zeta",
            "business/alpha",
        ]);
    });

    it("reports pages with no incoming links and no declared parent as orphans", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["b"] }),
            page("b"),
            page("lonely"),
            page("has-parent", { parents: ["a"] }),
        ]);
        expect(graph.orphans).toEqual(["a", "lonely"]);
    });

    it("carries the root and its existence through", () => {
        expect(buildWikiGraph("/root", true, []).root).toBe("/root");
        expect(buildWikiGraph("/root", false, []).rootExists).toBe(false);
    });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `bun test packages/backend/tests/services/wiki-graph.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/wiki-graph'`.

- [ ] **Step 12: Implement `buildWikiGraph`**

Create `packages/backend/src/services/wiki-graph.ts`:

```ts
import type { WikiIndexData, WikiPage, WikiTreeNode, WikiUnresolvedLink } from "@taskflow/shared";
import type { ParsedWikiPage } from "./wiki-page";

const INDEX_NAMES = ["index", "README", "readme"];

/** Resolve a raw link target to a page id, allowing folder → folder index. */
function resolveTarget(target: string, byId: Map<string, ParsedWikiPage>): string | null {
    const normalized = target.replace(/^\.?\//, "").replace(/\/+$/, "");
    if (byId.has(normalized)) return normalized;
    for (const name of INDEX_NAMES) {
        const candidate = `${normalized}/${name}`;
        if (byId.has(candidate)) return candidate;
    }
    return null;
}

interface TreeBuilder {
    folders: Map<string, TreeBuilder>;
    pages: Array<{ name: string; id: string }>;
}

function emptyBuilder(): TreeBuilder {
    return { folders: new Map(), pages: [] };
}

function insert(builder: TreeBuilder, segments: string[], id: string): void {
    if (segments.length === 1) {
        builder.pages.push({ name: segments[0], id });
        return;
    }
    const [head, ...rest] = segments;
    const child = builder.folders.get(head) ?? emptyBuilder();
    builder.folders.set(head, child);
    insert(child, rest, id);
}

function findIndexPageId(pages: Array<{ name: string; id: string }>): string | undefined {
    return pages.find((entry) => INDEX_NAMES.includes(entry.name))?.id;
}

/**
 * Order a folder's pages by the `children` list its index page declares, then
 * alphabetically — the declared hierarchy is authoritative where it exists.
 * `hoistedId`, when given, is the index page that has already become the folder
 * node itself and must not appear again as one of its own children.
 */
function orderPages(
    pages: Array<{ name: string; id: string }>,
    byId: Map<string, ParsedWikiPage>,
    hoistedId: string | undefined,
): Array<{ name: string; id: string }> {
    const indexId = hoistedId ?? findIndexPageId(pages);
    const declared = indexId === undefined ? [] : (byId.get(indexId)?.children ?? []);
    const rank = new Map<string, number>();
    declared.forEach((id, i) => rank.set(id, i));

    return pages
        .filter((entry) => entry.id !== hoistedId)
        .sort((a, b) => {
            if (a.id === indexId) return -1;
            if (b.id === indexId) return 1;
            const rankA = rank.get(a.id);
            const rankB = rank.get(b.id);
            if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
            if (rankA !== undefined) return -1;
            if (rankB !== undefined) return 1;
            return a.name.localeCompare(b.name);
        });
}

/**
 * `hoistedId` is threaded down one level: a folder's `index.md` becomes the
 * folder node's own page, so the recursive call must not also list it as a
 * child. At the root there is no folder node, so nothing is hoisted and a root
 * `index.md` stays an ordinary top-level page.
 */
function toNodes(
    builder: TreeBuilder,
    byId: Map<string, ParsedWikiPage>,
    hoistedId?: string,
): WikiTreeNode[] {
    const folders: WikiTreeNode[] = [...builder.folders.entries()]
        .map(([name, child]) => {
            const indexId = findIndexPageId(child.pages);
            return {
                name,
                type: "folder" as const,
                ...(indexId !== undefined && { id: indexId }),
                children: toNodes(child, byId, indexId),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const pages: WikiTreeNode[] = orderPages(builder.pages, byId, hoistedId).map((entry) => ({
        name: entry.name,
        type: "page" as const,
        id: entry.id,
    }));

    return [...folders, ...pages];
}

/**
 * Turn parsed pages into the full index: resolved links, the reverse backlink
 * map, the page tree, unresolved links and orphans.
 */
function buildWikiGraph(
    root: string,
    rootExists: boolean,
    parsed: ParsedWikiPage[],
): WikiIndexData {
    const byId = new Map(parsed.map((page) => [page.id, page]));
    const backlinks: Record<string, string[]> = {};
    const unresolved: WikiUnresolvedLink[] = [];

    const pages: WikiPage[] = parsed.map((page) => {
        const links: string[] = [];
        const brokenLinks: string[] = [];
        for (const target of page.rawLinks) {
            const resolved = resolveTarget(target, byId);
            if (resolved === null || resolved === page.id) {
                if (resolved === null) {
                    brokenLinks.push(target);
                    unresolved.push({ from: page.id, target });
                }
                continue;
            }
            links.push(resolved);
            (backlinks[resolved] ??= []).push(page.id);
        }
        const { rawLinks: _rawLinks, ...rest } = page;
        return { ...rest, links, brokenLinks };
    });

    for (const list of Object.values(backlinks)) list.sort();

    const builder = emptyBuilder();
    for (const page of parsed) insert(builder, page.id.split("/"), page.id);

    const orphans = pages
        .filter((page) => (backlinks[page.id]?.length ?? 0) === 0 && page.parents.length === 0)
        .map((page) => page.id)
        .sort();

    return {
        root,
        rootExists,
        pages,
        tree: toNodes(builder, byId),
        backlinks,
        unresolved,
        orphans,
    };
}

export { buildWikiGraph };
```

- [ ] **Step 13: Run it to verify it passes**

Run: `bun test packages/backend/tests/services/wiki-graph.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/types/wiki.ts packages/shared/src/utils/wiki-link.ts \
        packages/shared/src/utils/wiki-link.test.ts packages/shared/src/index.ts \
        packages/backend/src/services/wiki-page.ts packages/backend/src/services/wiki-graph.ts \
        packages/backend/tests/services/wiki-page.test.ts \
        packages/backend/tests/services/wiki-graph.test.ts
git commit -m "feat(wiki): parse pages and build the link graph"
```

---

## Task 4: The index service, its watcher, and the WebSocket wiring

**Files:**

- Create: `packages/backend/src/services/wiki-index.ts`
- Create: `packages/backend/tests/services/wiki-index.test.ts`
- Create: `packages/backend/src/handlers/wiki.ts`
- Modify: `packages/shared/src/constants.ts` (MSG), `packages/shared/src/types/ws.ts`
- Modify: `packages/backend/src/index.ts`
- Create: `packages/ui/src/stores/wiki-store.ts`

**Interfaces:**

- Consumes: `parseWikiPage`, `buildWikiGraph` from Task 3; `assertWorkspacePath` from `packages/backend/src/utils/path-validation.ts`.
- Produces:
  - `class WikiIndexService { constructor(deps: { onChange: (data: WikiIndexData) => void }); get(root: string): Promise<WikiIndexData>; stopAll(): Promise<void> }`
  - `MSG.WIKI_INDEX = "wiki:index"`, `MSG.WIKI_INDEX_CHANGED = "wiki:index-changed"`
  - `interface WikiIndexPayload { root: string }`
  - UI store `useWikiStore` with `{ indexByRoot: Record<string, WikiIndexData>; fetchIndex(root: string): Promise<void> }`

- [ ] **Step 1: Write the failing service test**

Create `packages/backend/tests/services/wiki-index.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { WikiIndexData } from "@taskflow/shared";
import { WikiIndexService } from "../../src/services/wiki-index";

async function waitFor<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe("WikiIndexService", () => {
    let root: string;
    let service: WikiIndexService;
    let changes: WikiIndexData[];

    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-wiki-")));
        await mkdir(join(root, "business"), { recursive: true });
        await writeFile(join(root, "index.md"), "# Home\n\nsee [[business/money]]\n");
        await writeFile(join(root, "business", "money.md"), "---\ntitle: Money\n---\n\n# Money\n");
        changes = [];
        service = new WikiIndexService({
            onChange: (data) => changes.push(data),
            debounceMs: 30,
        });
    });

    afterEach(async () => {
        await service.stopAll();
        await rm(root, { recursive: true, force: true });
    });

    it("indexes every markdown file under the root", async () => {
        const data = await service.get(root);
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "index"]);
        expect(data.pages.find((p) => p.id === "business/money")?.title).toBe("Money");
        expect(data.backlinks["business/money"]).toEqual(["index"]);
    });

    it("ignores non-markdown files and ignored directories", async () => {
        await mkdir(join(root, "node_modules"), { recursive: true });
        await writeFile(join(root, "node_modules", "pkg.md"), "# nope\n");
        await writeFile(join(root, "notes.txt"), "not markdown");
        const data = await service.get(root);
        expect(data.pages.map((p) => p.id).sort()).toEqual(["business/money", "index"]);
    });

    it("serves the cached index on a second call without rescanning", async () => {
        const first = await service.get(root);
        expect(await service.get(root)).toBe(first);
    });

    it("pushes a new index when a page changes on disk", async () => {
        await service.get(root);
        await writeFile(join(root, "business", "money.md"), "---\ntitle: Renamed\n---\n\n# x\n");
        const data = await waitFor(() => changes.at(-1));
        expect(data.pages.find((p) => p.id === "business/money")?.title).toBe("Renamed");
    });

    it("pushes a new index when a page is added", async () => {
        await service.get(root);
        await writeFile(join(root, "extra.md"), "# Extra\n");
        const data = await waitFor(() =>
            changes.at(-1)?.pages.some((p) => p.id === "extra") ? changes.at(-1) : undefined,
        );
        expect(data.pages.map((p) => p.id).sort()).toEqual([
            "business/money",
            "extra",
            "index",
        ]);
    });

    it("pushes a new index when a page is deleted", async () => {
        await service.get(root);
        await rm(join(root, "business", "money.md"));
        const data = await waitFor(() =>
            changes.at(-1)?.pages.every((p) => p.id !== "business/money")
                ? changes.at(-1)
                : undefined,
        );
        expect(data.pages.map((p) => p.id)).toEqual(["index"]);
        expect(data.unresolved).toEqual([{ from: "index", target: "business/money" }]);
    });

    it("flags a missing root rather than throwing", async () => {
        const data = await service.get(join(root, "does-not-exist"));
        expect(data.rootExists).toBe(false);
        expect(data.pages).toEqual([]);
        expect(data.tree).toEqual([]);
    });

    it("flags a root that is a file, not a directory", async () => {
        const data = await service.get(join(root, "index.md"));
        expect(data.rootExists).toBe(false);
        expect(data.pages).toEqual([]);
    });

    it("distinguishes an existing but empty wiki from a missing one", async () => {
        const empty = join(root, "empty");
        await mkdir(empty, { recursive: true });
        const data = await service.get(empty);
        expect(data.rootExists).toBe(true);
        expect(data.pages).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/backend/tests/services/wiki-index.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/wiki-index'`.

- [ ] **Step 3: Implement the service**

Create `packages/backend/src/services/wiki-index.ts`:

```ts
import chokidar, { type FSWatcher } from "chokidar";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import type { WikiIndexData } from "@taskflow/shared";
import { parseWikiPage, type ParsedWikiPage } from "./wiki-page";
import { buildWikiGraph } from "./wiki-graph";

const IGNORED_NAMES = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "dist",
    ".next",
    ".superpowers",
    ".obsidian",
    ".DS_Store",
]);

const MARKDOWN = /\.(md|markdown)$/i;

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

function toPageId(root: string, filePath: string): string {
    return normalizePath(relative(root, filePath)).replace(MARKDOWN, "");
}

interface WikiIndexServiceDeps {
    onChange: (data: WikiIndexData) => void;
    /** Coalescing window for filesystem events. */
    debounceMs?: number;
}

interface RootState {
    data: WikiIndexData;
    parsed: Map<string, ParsedWikiPage>;
    watcher: FSWatcher | null;
    timer: ReturnType<typeof setTimeout> | null;
    pending: Set<string>;
}

/**
 * One in-memory wiki index per root, kept fresh by a chokidar watcher. A
 * changed file re-parses alone and the graph is rebuilt from the cached page
 * map — at ~110 files a full rebuild is milliseconds, so nothing is persisted.
 */
class WikiIndexService {
    private readonly onChange: (data: WikiIndexData) => void;
    private readonly debounceMs: number;
    private readonly roots = new Map<string, RootState>();
    private readonly building = new Map<string, Promise<WikiIndexData>>();

    constructor({ onChange, debounceMs = 150 }: WikiIndexServiceDeps) {
        this.onChange = onChange;
        this.debounceMs = debounceMs;
    }

    async get(root: string): Promise<WikiIndexData> {
        const existing = this.roots.get(root);
        if (existing) return existing.data;

        const inFlight = this.building.get(root);
        if (inFlight) return inFlight;

        const build = this.build(root).finally(() => this.building.delete(root));
        this.building.set(root, build);
        return build;
    }

    async stopAll(): Promise<void> {
        const states = [...this.roots.values()];
        this.roots.clear();
        await Promise.all(
            states.map(async (state) => {
                if (state.timer) clearTimeout(state.timer);
                await state.watcher?.close();
            }),
        );
    }

    private async build(root: string): Promise<WikiIndexData> {
        const usable = await stat(root)
            .then((stats) => stats.isDirectory())
            .catch(() => false);

        if (!usable) {
            // Not cached and not watched: the folder may be created later, and
            // the next request should notice.
            return buildWikiGraph(root, false, []);
        }

        const parsed = new Map<string, ParsedWikiPage>();
        for (const filePath of await this.listMarkdown(root)) {
            const page = await this.parseFile(root, filePath);
            if (page) parsed.set(filePath, page);
        }

        const data = buildWikiGraph(root, true, [...parsed.values()]);
        const state: RootState = { data, parsed, watcher: null, timer: null, pending: new Set() };
        this.roots.set(root, state);
        state.watcher = await this.watch(root, state);
        return data;
    }

    private async listMarkdown(dir: string): Promise<string[]> {
        const out: string[] = [];
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return out;
        }
        for (const entry of entries) {
            if (IGNORED_NAMES.has(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) out.push(...(await this.listMarkdown(full)));
            else if (MARKDOWN.test(entry.name)) out.push(full);
        }
        return out;
    }

    private async parseFile(root: string, filePath: string): Promise<ParsedWikiPage | null> {
        try {
            const [source, stats] = await Promise.all([
                readFile(filePath, "utf-8"),
                stat(filePath),
            ]);
            return parseWikiPage({
                pageId: toPageId(root, filePath),
                relativePath: normalizePath(relative(root, filePath)),
                source,
                mtimeMs: stats.mtimeMs,
            });
        } catch {
            return null;
        }
    }

    private async watch(root: string, state: RootState): Promise<FSWatcher> {
        const watcher = chokidar.watch(root, {
            ignored: (path) =>
                normalizePath(path)
                    .split("/")
                    .filter(Boolean)
                    .some((segment) => IGNORED_NAMES.has(segment)),
            ignoreInitial: true,
            ignorePermissionErrors: true,
            persistent: true,
        });

        const queue = (path: string) => {
            if (!MARKDOWN.test(path)) return;
            state.pending.add(path);
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                state.timer = null;
                void this.flush(root, state);
            }, this.debounceMs);
        };

        watcher.on("add", queue);
        watcher.on("change", queue);
        watcher.on("unlink", queue);

        await new Promise<void>((resolve) => {
            watcher.once("ready", () => resolve());
            watcher.once("error", () => resolve());
        });

        return watcher;
    }

    private async flush(root: string, state: RootState): Promise<void> {
        const paths = [...state.pending];
        state.pending.clear();

        for (const path of paths) {
            const page = await this.parseFile(root, path);
            if (page) state.parsed.set(path, page);
            else state.parsed.delete(path);
        }

        state.data = buildWikiGraph(root, true, [...state.parsed.values()]);
        this.onChange(state.data);
    }
}

export { WikiIndexService };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/backend/tests/services/wiki-index.test.ts`
Expected: PASS, 9 tests.

If the "missing root" test hangs, check that `build` returns before installing a watcher when `usable` is false — it does above, and it deliberately does not cache, so a wiki created later is picked up on the next request.

- [ ] **Step 5: Add the message types**

In `packages/shared/src/constants.ts`, add a block after the `// Files` group:

```ts
    // Wiki
    WIKI_INDEX: "wiki:index",
    WIKI_INDEX_CHANGED: "wiki:index-changed",
    WIKI_OBSIDIAN_STATE: "wiki:obsidian-state",
```

In `packages/shared/src/types/ws.ts`, add near the file messages:

```ts
// Wiki messages
export interface WikiIndexPayload {
    root: string;
}
```

and add the import of `WikiIndexData` to that file's type imports if a response type is declared there; the response *is* `WikiIndexData`, so no new response interface is needed.

- [ ] **Step 6: Add the handler**

Create `packages/backend/src/handlers/wiki.ts`:

```ts
import { MSG } from "@taskflow/shared";
import type { WikiIndexPayload, WsEvent } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { WikiIndexService } from "../services/wiki-index";
import { assertWorkspacePath } from "../utils/path-validation";

interface WikiHandlerDeps {
    router: Router;
    taskStore: TaskStore;
    wikiIndex: WikiIndexService;
}

export function registerWikiHandlers({ router, taskStore, wikiIndex }: WikiHandlerDeps): void {
    router.register(MSG.WIKI_INDEX, async (payload) => {
        const { root } = payload as WikiIndexPayload;
        // The root arrives from the renderer, so it is re-validated here just
        // like every other path the renderer names.
        const workspaceRoot = await assertWorkspacePath(taskStore, root);
        return wikiIndex.get(workspaceRoot);
    });
}

export type { WsEvent };
```

Remove the trailing `export type { WsEvent };` — it is only there to show the import shape; the file must not export it. Final line of the file is the closing brace of `registerWikiHandlers`.

- [ ] **Step 7: Wire it into the backend**

In `packages/backend/src/index.ts`:

```ts
import { WikiIndexService } from "./services/wiki-index";
import { registerWikiHandlers } from "./handlers/wiki";
```

After `const fileWatcher = new FileWatcher();` and after `server` exists (so `server.broadcast` is available — place it next to `const changeTracker = ...`, line 93):

```ts
        const wikiIndex = new WikiIndexService({
            onChange: (data) =>
                server.broadcast({ type: MSG.WIKI_INDEX_CHANGED, payload: data }),
        });
```

and next to the other `register*Handlers` calls:

```ts
        registerWikiHandlers({ router, taskStore: store, wikiIndex });
```

Finally, add the watcher teardown to the shutdown handler. `shutdown` is a plain (non-async) function at `packages/backend/src/index.ts:476`, and the existing async cleanup beside it is fire-and-forget, so match it exactly — do not `await`:

```ts
            void fileWatcher.stopAll();
            void wikiIndex.stopAll();
```

- [ ] **Step 8: Add the UI store**

Create `packages/ui/src/stores/wiki-store.ts`:

```ts
import { create } from "zustand";
import { MSG } from "@taskflow/shared";
import type { WikiIndexData, WikiIndexPayload } from "@taskflow/shared";
import { sendRequest, onEvent } from "@/hooks/useWebSocket";

interface WikiStore {
    indexByRoot: Record<string, WikiIndexData>;
    /** Roots whose value failed to resolve to a usable directory. */
    errorByRoot: Record<string, string>;
    fetchIndex(root: string): Promise<void>;
}

const inFlight = new Set<string>();

export const useWikiStore = create<WikiStore>((set) => ({
    indexByRoot: {},
    errorByRoot: {},
    async fetchIndex(root) {
        if (inFlight.has(root)) return;
        inFlight.add(root);
        try {
            const payload: WikiIndexPayload = { root };
            const data = await sendRequest<WikiIndexData>(MSG.WIKI_INDEX, payload);
            set((s) => {
                const { [root]: _dropped, ...errors } = s.errorByRoot;
                return { indexByRoot: { ...s.indexByRoot, [root]: data }, errorByRoot: errors };
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to read the wiki";
            set((s) => ({ errorByRoot: { ...s.errorByRoot, [root]: message } }));
        } finally {
            inFlight.delete(root);
        }
    },
}));

onEvent(MSG.WIKI_INDEX_CHANGED, (payload) => {
    const data = payload as WikiIndexData;
    useWikiStore.setState((s) => ({ indexByRoot: { ...s.indexByRoot, [data.root]: data } }));
});
```

Check how other stores subscribe to broadcast events (`packages/ui/src/stores/session-subscriptions.ts`) and follow the same registration point if module-level `onEvent` is not the convention there.

- [ ] **Step 9: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/services/wiki-index.ts packages/backend/src/handlers/wiki.ts \
        packages/backend/tests/services/wiki-index.test.ts packages/backend/src/index.ts \
        packages/shared/src/constants.ts packages/shared/src/types/ws.ts \
        packages/ui/src/stores/wiki-store.ts
git commit -m "feat(wiki): index service with a watcher and websocket delivery"
```

---

## Task 5: The sidebar wiki panel

**Files:**

- Modify: `packages/ui/src/stores/ui-store.ts`
- Create: `packages/ui/src/stores/ui-store.wiki.test.ts`
- Create: `packages/ui/src/components/panels/WikiTree.tsx`
- Create: `packages/ui/src/components/panels/WikiPanel.tsx`
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

**Interfaces:**

- Consumes: `useWikiRoot` (Task 2), `useWikiStore` (Task 4), `WikiTreeNode` (Task 3), `openFileInApp` (Stage 1).
- Produces: `wikiPanelOpen` and `toggleWikiPanel()` on the UI store; `<WikiPanel />`.

- [ ] **Step 1: Write the failing store test**

Create `packages/ui/src/stores/ui-store.wiki.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { useUIStore } from "./ui-store";

describe("wiki panel toggle", () => {
    beforeEach(() => {
        useUIStore.setState({
            fileExplorerOpen: false,
            searchPanelOpen: false,
            wikiPanelOpen: false,
        });
    });

    it("opens the wiki panel and closes its siblings", () => {
        useUIStore.setState({ fileExplorerOpen: true });
        useUIStore.getState().toggleWikiPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(true);
        expect(useUIStore.getState().fileExplorerOpen).toBe(false);
    });

    it("closes the wiki panel when opening the file explorer", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleFileExplorer();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
        expect(useUIStore.getState().fileExplorerOpen).toBe(true);
    });

    it("closes the wiki panel when opening search", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleSearchPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
        expect(useUIStore.getState().searchPanelOpen).toBe(true);
    });

    it("toggles itself off", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleWikiPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/stores/ui-store.wiki.test.ts`
Expected: FAIL — `toggleWikiPanel is not a function`.

- [ ] **Step 3: Add the state**

In `packages/ui/src/stores/ui-store.ts`, add `wikiPanelOpen: boolean;` to the `UIStore` interface next to `searchPanelOpen`, add `toggleWikiPanel(): void;` next to `toggleSearchPanel()`, add `wikiPanelOpen: false,` to the initial state, and replace the three toggles so all of them are mutually exclusive:

```ts
    toggleFileExplorer() {
        set((s) => ({
            fileExplorerOpen: !s.fileExplorerOpen,
            ...(!s.fileExplorerOpen ? { searchPanelOpen: false, wikiPanelOpen: false } : {}),
        }));
    },
    toggleSearchPanel() {
        set((s) => ({
            searchPanelOpen: !s.searchPanelOpen,
            ...(!s.searchPanelOpen ? { fileExplorerOpen: false, wikiPanelOpen: false } : {}),
        }));
    },
    toggleWikiPanel() {
        set((s) => ({
            wikiPanelOpen: !s.wikiPanelOpen,
            ...(!s.wikiPanelOpen ? { fileExplorerOpen: false, searchPanelOpen: false } : {}),
        }));
    },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/ui/src/stores/ui-store.wiki.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the tree component**

Create `packages/ui/src/components/panels/WikiTree.tsx`:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { WikiTreeNode } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface WikiTreeProps {
    nodes: WikiTreeNode[];
    activePageId: string | null;
    onOpen: (pageId: string) => void;
    depth?: number;
}

function WikiTree({ nodes, activePageId, onOpen, depth = 0 }: WikiTreeProps) {
    return (
        <div className="flex flex-col">
            {nodes.map((node) =>
                node.type === "folder" ? (
                    <WikiFolder
                        key={`${depth}:${node.name}`}
                        node={node}
                        activePageId={activePageId}
                        onOpen={onOpen}
                        depth={depth}
                    />
                ) : (
                    <button
                        key={node.id}
                        type="button"
                        onClick={() => node.id && onOpen(node.id)}
                        className={cn(
                            "hover:bg-island-base flex items-center gap-1.5 rounded-sm py-0.5 text-left text-[13px]",
                            node.id === activePageId && "bg-island-base text-foreground",
                        )}
                        style={{ paddingLeft: 6 + depth * 12 }}>
                        <FileText className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{node.name}</span>
                    </button>
                ),
            )}
        </div>
    );
}

interface WikiFolderProps {
    node: WikiTreeNode;
    activePageId: string | null;
    onOpen: (pageId: string) => void;
    depth: number;
}

function WikiFolder({ node, activePageId, onOpen, depth }: WikiFolderProps) {
    const [open, setOpen] = useState(true);
    // A folder with an index.md has its own page: the chevron expands, the name
    // opens the page. Without one, the whole row is just a toggle.
    const hasPage = node.id !== undefined;
    return (
        <>
            <div
                className={cn(
                    "hover:bg-island-base flex items-center gap-1 rounded-sm py-0.5 text-[13px] font-medium",
                    node.id !== undefined && node.id === activePageId && "bg-island-base",
                )}
                style={{ paddingLeft: 6 + depth * 12 }}>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}>
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() =>
                        hasPage && node.id ? onOpen(node.id) : setOpen((value) => !value)
                    }
                    className="min-w-0 flex-1 truncate text-left">
                    {node.name}
                </button>
            </div>
            {open && node.children && (
                <WikiTree
                    nodes={node.children}
                    activePageId={activePageId}
                    onOpen={onOpen}
                    depth={depth + 1}
                />
            )}
        </>
    );
}

export { WikiTree };
```

Note `filterTree` in the next step must keep a folder whose own `id` matches the filter even when none of its children do — otherwise a folder page becomes unreachable while filtering.
```

- [ ] **Step 6: Build the panel**

Create `packages/ui/src/components/panels/WikiPanel.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { WikiTreeNode } from "@taskflow/shared";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUIStore } from "@/stores/ui-store";
import { useWikiStore } from "@/stores/wiki-store";
import { useWikiRoot } from "@/hooks/useWikiRoot";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { openFileInApp } from "@/lib/open-file";
import { WikiTree } from "./WikiTree";

/** Keep only pages whose id matches the filter, and the folders containing them. */
function filterTree(nodes: WikiTreeNode[], query: string, prefix = ""): WikiTreeNode[] {
    const needle = query.toLowerCase();
    const out: WikiTreeNode[] = [];
    for (const node of nodes) {
        if (node.type === "folder") {
            const children = filterTree(node.children ?? [], query, `${prefix}${node.name}/`);
            const selfMatches =
                node.id !== undefined && `${prefix}${node.name}`.toLowerCase().includes(needle);
            if (children.length > 0 || selfMatches) out.push({ ...node, children });
            continue;
        }
        if (`${prefix}${node.name}`.toLowerCase().includes(needle)) out.push(node);
    }
    return out;
}

function WikiPanel() {
    const [query, setQuery] = useState("");
    const toggleWikiPanel = useUIStore((s) => s.toggleWikiPanel);
    const workspace = useActiveWorkspace();
    const root = useWikiRoot();
    const index = useWikiStore((s) => (root ? s.indexByRoot[root] : undefined));
    const error = useWikiStore((s) => (root ? s.errorByRoot[root] : undefined));
    const fetchIndex = useWikiStore((s) => s.fetchIndex);

    useEffect(() => {
        if (root) void fetchIndex(root);
    }, [fetchIndex, root]);

    const tree = useMemo(
        () => (query.trim() === "" ? (index?.tree ?? []) : filterTree(index?.tree ?? [], query)),
        [index, query],
    );

    const handleOpen = useCallback(
        (pageId: string) => {
            if (!root) return;
            const page = index?.pages.find((entry) => entry.id === pageId);
            if (!page) return;
            void openFileInApp(`${root}/${page.path}`, workspace.workspaceKey);
        },
        [index, root, workspace.workspaceKey],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Toolbar className="justify-between">
                <span className="text-secondary-foreground text-[13px] font-medium">Wiki</span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleWikiPanel}
                    aria-label="Hide wiki">
                    <X className="h-4 w-4" />
                </Button>
            </Toolbar>

            {root === null ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    No wiki for this project. Add a project attribute named{" "}
                    <code className="text-foreground">wiki</code> whose value is the wiki folder,
                    for example <code className="text-foreground">docs/wiki</code>.
                </div>
            ) : error !== undefined ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    The <code className="text-foreground">wiki</code> attribute points at{" "}
                    <code className="text-foreground">{root}</code>, which could not be read.
                </div>
            ) : index && !index.rootExists ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    The <code className="text-foreground">wiki</code> attribute points at{" "}
                    <code className="text-foreground">{root}</code>, which is not a folder. Check
                    the attribute value.
                </div>
            ) : index && index.pages.length === 0 ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    No markdown files under <code className="text-foreground">{root}</code>.
                </div>
            ) : (
                <>
                    <div className="px-2 pt-2">
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter pages"
                            className="h-7 text-[13px]"
                        />
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                        <WikiTree nodes={tree} activePageId={null} onOpen={handleOpen} />
                    </div>
                </>
            )}
        </div>
    );
}

export { WikiPanel };
```

Check `packages/ui/src/components/ui/` for the actual `Input` component name and props before using it; `SearchPanel.tsx` shows the house style for a filter box — copy it if `Input` differs.

- [ ] **Step 7: Mount the panel and add the toolbar toggle**

In `packages/ui/src/components/AppShell.tsx`:

- read `const wikiPanelOpen = useUIStore((s) => s.wikiPanelOpen);` next to the other two;
- render `const wikiPanel = <WikiPanel />;` alongside the existing `fileExplorer` / `searchPanel` locals (follow how those are constructed in that file);
- change both `(fileExplorerOpen || searchPanelOpen)` conditions to `(fileExplorerOpen || searchPanelOpen || wikiPanelOpen)`;
- change the body to `{fileExplorerOpen ? fileExplorer : searchPanelOpen ? searchPanel : wikiPanel}`;
- include `wikiPanelOpen` in the `registerPanel`/`unregisterPanel` effect's condition and dependency array.

In `packages/ui/src/components/workspace/TaskHeader.tsx`, add a third button immediately after the Search button:

```tsx
                        <Button
                            variant={wikiPanelOpen ? "secondary" : "ghost"}
                            size="icon-xs"
                            onClick={toggleWikiPanel}
                            aria-pressed={wikiPanelOpen}
                            aria-label={wikiPanelOpen ? "Hide wiki" : "Show wiki"}
                            tooltip={wikiPanelOpen ? "Hide wiki" : "Show wiki"}
                            tooltipSide="bottom"
                            className="[-webkit-app-region:no-drag]">
                            <BookText className="h-4 w-4" />
                        </Button>
```

with `BookText` added to the `lucide-react` import and

```tsx
    const wikiPanelOpen = useUIStore((s) => s.wikiPanelOpen);
    const toggleWikiPanel = useUIStore((s) => s.toggleWikiPanel);
```

added next to the existing panel selectors.

- [ ] **Step 8: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

By hand: on a project with no `wiki` attribute, open the panel — it explains how to add one and does not error. Add a project attribute `wiki` = `docs/wiki`, reopen — the page tree appears; clicking a page opens it in a preview tab; the filter box narrows the tree; editing a page on disk updates the tree without a reload.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts packages/ui/src/stores/ui-store.wiki.test.ts \
        packages/ui/src/components/panels/WikiPanel.tsx \
        packages/ui/src/components/panels/WikiTree.tsx \
        packages/ui/src/components/AppShell.tsx \
        packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat(wiki): sidebar page tree panel with a toolbar toggle"
```

---

## Task 6: `[[wiki-links]]` in the preview

**Files:**

- Create: `packages/ui/src/lib/markdown/remark-wiki-link.ts`
- Create: `packages/ui/src/lib/markdown/remark-wiki-link.test.ts`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
- Modify: `packages/ui/src/styles/global.css`
- Modify: `packages/ui/package.json` (`unist-util-visit`, `@types/mdast`)

**Interfaces:**

- Consumes: `parseWikiLinks` (Task 3), the index from `useWikiStore` (Task 4), `resolveLinkTarget` (Stage 1).
- Produces: `function remarkWikiLink(options: { resolve: (target: string) => { href: string; exists: boolean } }): (tree: Root) => void`

- [ ] **Step 1: Install the dependencies**

`unist-util-visit` and `github-slugger` are already UI dependencies (Stage 1 Tasks 6 and 4). Only the mdast types are new:

```bash
cd packages/ui && bun add -d @types/mdast@^4.0.4 && cd ../..
```

- [ ] **Step 2: Write the failing test**

Create `packages/ui/src/lib/markdown/remark-wiki-link.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { Paragraph, Root, Text } from "mdast";
import { remarkWikiLink } from "./remark-wiki-link";

function paragraph(value: string): Root {
    const text: Text = { type: "text", value };
    const node: Paragraph = { type: "paragraph", children: [text] };
    return { type: "root", children: [node] };
}

const resolve = (target: string) => ({
    href: `/root/${target}.md`,
    exists: target !== "missing",
});

function run(value: string): Paragraph {
    const tree = paragraph(value);
    remarkWikiLink({ resolve })(tree);
    return tree.children[0] as Paragraph;
}

describe("remarkWikiLink", () => {
    it("replaces a wiki-link with a link node", () => {
        const node = run("see [[a/b]] now");
        expect(node.children.map((child) => child.type)).toEqual(["text", "link", "text"]);
        const link = node.children[1];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md");
        expect((link.children[0] as Text).value).toBe("a/b");
    });

    it("uses the alias as the link text", () => {
        const link = run("[[a/b|Money]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect((link.children[0] as Text).value).toBe("Money");
    });

    it("appends the heading fragment to the url", () => {
        const link = run("[[a/b#rates]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md#rates");
    });

    it("slugs a multi-word fragment so it matches the rendered heading id", () => {
        const link = run("[[a/b#Exchange Rates]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md#exchange-rates");
    });

    it("marks an unresolvable target as broken", () => {
        const link = run("[[missing]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.data?.hProperties).toEqual({ className: "wiki-link wiki-link-broken" });
    });

    it("marks a resolvable target as valid", () => {
        const link = run("[[a/b]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.data?.hProperties).toEqual({ className: "wiki-link" });
    });

    it("handles several links in one text node", () => {
        expect(run("[[a]] and [[b]]").children.map((c) => c.type)).toEqual([
            "link",
            "text",
            "link",
        ]);
    });

    it("leaves text without wiki-links untouched", () => {
        const node = run("plain text");
        expect(node.children).toHaveLength(1);
        expect(node.children[0].type).toBe("text");
    });

    it("does not rewrite text inside an existing link", () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "link",
                            url: "./x.md",
                            children: [{ type: "text", value: "[[a/b]]" }],
                        },
                    ],
                },
            ],
        };
        remarkWikiLink({ resolve })(tree);
        const outer = (tree.children[0] as Paragraph).children[0];
        if (outer.type !== "link") throw new Error("expected a link node");
        expect(outer.children[0].type).toBe("text");
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/ui/src/lib/markdown/remark-wiki-link.test.ts`
Expected: FAIL — `Cannot find module './remark-wiki-link'`.

- [ ] **Step 4: Implement the plugin**

Create `packages/ui/src/lib/markdown/remark-wiki-link.ts`:

```ts
import { visit, SKIP } from "unist-util-visit";
import type { Link, Parent, Root, RootContent, Text } from "mdast";
import GithubSlugger from "github-slugger";
import { parseWikiLinks } from "@taskflow/shared";

interface WikiLinkResolution {
    href: string;
    exists: boolean;
}

interface RemarkWikiLinkOptions {
    /** Map a `[[target]]` to an href, and say whether the page exists. */
    resolve: (target: string) => WikiLinkResolution;
}

/**
 * Rewrite `[[path]]`, `[[path|alias]]` and `[[path#heading]]` into ordinary
 * link nodes so the preview's existing delegated click handler routes them.
 * Unresolvable targets get a distinct class rather than silently looking valid.
 */
function remarkWikiLink({ resolve }: RemarkWikiLinkOptions) {
    return (tree: Root): void => {
        visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
            if (parent === undefined || index === undefined) return;
            // Text inside an existing link must stay literal — a wiki-link
            // inside a markdown link is the author's text, not a target.
            if (parent.type === "link" || parent.type === "linkReference") return SKIP;

            const spans = parseWikiLinks(node.value);
            if (spans.length === 0) return;

            const replacement: RootContent[] = [];
            let cursor = 0;

            for (const span of spans) {
                if (span.start > cursor) {
                    replacement.push({ type: "text", value: node.value.slice(cursor, span.start) });
                }
                const { href, exists } = resolve(span.target);
                // `[[page#Exchange Rates]]` must land on the id rehype-slug
                // emitted ("exchange-rates"), so slug the fragment here.
                const url =
                    span.hash === undefined
                        ? href
                        : `${href}#${new GithubSlugger().slug(span.hash)}`;
                const link: Link = {
                    type: "link",
                    url,
                    children: [{ type: "text", value: span.alias ?? span.target }],
                    data: {
                        hProperties: {
                            className: exists ? "wiki-link" : "wiki-link wiki-link-broken",
                        },
                    },
                };
                replacement.push(link);
                cursor = span.end;
            }

            if (cursor < node.value.length) {
                replacement.push({ type: "text", value: node.value.slice(cursor) });
            }

            parent.children.splice(index, 1, ...replacement);
            return index + replacement.length;
        });
    };
}

export { remarkWikiLink };
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/ui/src/lib/markdown/remark-wiki-link.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Enable it in the preview when a wiki root exists**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

```ts
import { remarkWikiLink } from "@/lib/markdown/remark-wiki-link";
import { useWikiRoot } from "@/hooks/useWikiRoot";
import { useWikiStore } from "@/stores/wiki-store";
```

Replace the module-level `remarkPlugins` constant with a memo inside the component, because the plugin needs the live index:

```tsx
    const wikiRoot = useWikiRoot();
    const wikiIndex = useWikiStore((s) => (wikiRoot ? s.indexByRoot[wikiRoot] : undefined));
    const fetchIndex = useWikiStore((s) => s.fetchIndex);

    useEffect(() => {
        if (wikiRoot) void fetchIndex(wikiRoot);
    }, [fetchIndex, wikiRoot]);

    const remarkPlugins = useMemo(() => {
        const base = [remarkGfm, remarkFrontmatter, remarkMath];
        // Wiki-links are only meaningful with a root to resolve against.
        if (wikiRoot === null) return base;
        const byId = new Map((wikiIndex?.pages ?? []).map((page) => [page.id, page]));
        return [
            ...base,
            [
                remarkWikiLink,
                {
                    resolve: (target: string) => {
                        const page = byId.get(target.replace(/^\.?\//, ""));
                        return page
                            ? { href: `${wikiRoot}/${page.path}`, exists: true }
                            : { href: `${wikiRoot}/${target}.md`, exists: false };
                    },
                },
            ] as const,
        ];
    }, [wikiIndex, wikiRoot]);
```

Delete the old module-level `const remarkPlugins = [...]` line and keep `rehypePlugins` as it is.

Because the resolved `href` is an absolute path, the Stage 1 delegated click handler already routes it: `resolveLinkTarget` sees no scheme, `joinRelative` returns it unchanged, and `isMarkdownPath` sends it to `navigateTab`. No change to the click handler is needed.

- [ ] **Step 7: Style broken links**

Append to `packages/ui/src/styles/global.css`:

```css
.markdown-preview a.wiki-link-broken {
    color: var(--destructive);
    text-decoration: underline dotted;
}
```

- [ ] **Step 8: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

By hand, in a project with a wiki: a page containing `[[business/money]]` renders it as a link that opens that page in the same tab; `[[does/not/exist]]` renders in the destructive colour with a dotted underline; `[[a|alias]]` shows the alias; on a project *without* a `wiki` attribute the same text stays literal, exactly as before.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/package.json bun.lock \
        packages/ui/src/lib/markdown/remark-wiki-link.ts \
        packages/ui/src/lib/markdown/remark-wiki-link.test.ts \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx \
        packages/ui/src/styles/global.css
git commit -m "feat(wiki): resolve [[wiki-links]] and mark broken targets"
```

---

## Task 7: The context rail

**Files:**

- Create: `packages/ui/src/components/panes/markdown/WikiRail.tsx`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
- Modify: `packages/ui/src/stores/ui-store.ts` (rail width + collapsed flag)
- Modify: `packages/shared/src/types/settings.ts` (`PanelSettings`)
- Modify: `packages/backend/src/services/settings-store.ts` (defaults)

**Interfaces:**

- Consumes: `extractOutline` (Task 1), the index (Task 4), `navigateTab` (Stage 1).
- Produces: `<WikiRail />`; `PanelSettings.wikiRailOpen` and `PanelSettings.wikiRailWidth`.

- [ ] **Step 1: Add the rail's UI state and persist it**

The spec requires the rail to be collapsible with its width persisted, so it goes through the same `PanelSettings` path the other panel widths use — a `ui-store` field alone is lost on restart.

In `packages/shared/src/types/settings.ts`, add to `PanelSettings`:

```ts
    wikiRailOpen: boolean;
    wikiRailWidth: number;
```

In `packages/backend/src/services/settings-store.ts`, add to `DEFAULTS.layout.panels`:

```ts
            wikiRailOpen: true,
            wikiRailWidth: 220,
```

(The load path's `{ ...defaults.editor, ...parsed.editor }`-style merge covers the panels block the same way, so no migration code is needed.)

In `packages/ui/src/stores/ui-store.ts`, add the min/max next to the existing ones:

```ts
const WIKI_RAIL_MIN = 160;
const WIKI_RAIL_MAX = 400;
```

add to the `UIStore` interface:

```ts
    wikiRailOpen: boolean;
    wikiRailWidth: number;
    toggleWikiRail(): void;
    setWikiRailWidth(width: number): void;
```

to the initial state:

```ts
    wikiRailOpen: true,
    wikiRailWidth: 220,
```

to the body:

```ts
    toggleWikiRail() {
        set((s) => ({ wikiRailOpen: !s.wikiRailOpen }));
    },
    setWikiRailWidth(width) {
        set({ wikiRailWidth: clamp(width, WIKI_RAIL_MIN, WIKI_RAIL_MAX) });
    },
```

and to `hydrateLayout` — both its parameter type and its body:

```ts
    hydrateLayout(panels: {
        // ...existing fields...
        wikiRailOpen?: boolean;
        wikiRailWidth?: number;
    }): void;
```

```ts
            wikiRailOpen: panels.wikiRailOpen ?? true,
            wikiRailWidth: clamp(panels.wikiRailWidth ?? 220, WIKI_RAIL_MIN, WIKI_RAIL_MAX),
```

- [ ] **Step 1a: Save the rail width and collapsed state**

`AppShell.tsx:87` has a single `handleResizeEnd` that writes every panel width at once, but the rail lives inside a pane, not the shell. Give it its own writer in `MarkdownPane.tsx`:

```tsx
    const updateSettings = useSettingsStore((s) => s.updateSettings);

    const persistRail = useCallback(() => {
        const { wikiRailOpen, wikiRailWidth } = useUIStore.getState();
        void updateSettings({ layout: { panels: { wikiRailOpen, wikiRailWidth } } });
    }, [updateSettings]);
```

Call `persistRail()` from the rail's toggle handler and from the resize handle's `onResizeEnd` (reuse `packages/ui/src/components/…/ResizeHandle`, the same component `AppShell` uses — check its exact path and props before wiring).

- [ ] **Step 2: Build the rail**

Create `packages/ui/src/components/panes/markdown/WikiRail.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { OutlineEntry, WikiIndexData } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface WikiRailProps {
    outline: OutlineEntry[];
    index: WikiIndexData;
    pageId: string;
    /** The pane's scroll container, used to observe headings and to scroll. */
    scrollContainer: HTMLElement | null;
    onOpenPage: (pageId: string) => void;
}

interface RailSectionProps {
    title: string;
    children: React.ReactNode;
}

function RailSection({ title, children }: RailSectionProps) {
    return (
        <div className="flex flex-col gap-1">
            <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {title}
            </div>
            {children}
        </div>
    );
}

function WikiRail({ outline, index, pageId, scrollContainer, onOpenPage }: WikiRailProps) {
    const [activeId, setActiveId] = useState<string | null>(null);

    const page = useMemo(
        () => index.pages.find((entry) => entry.id === pageId),
        [index, pageId],
    );
    const backlinks = index.backlinks[pageId] ?? [];
    const children = page?.children ?? [];

    useEffect(() => {
        if (!scrollContainer || outline.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]?.target.id) setActiveId(visible[0].target.id);
            },
            { root: scrollContainer, rootMargin: "0px 0px -70% 0px", threshold: 0 },
        );
        for (const entry of outline) {
            const element = scrollContainer.querySelector(`#${CSS.escape(entry.id)}`);
            if (element) observer.observe(element);
        }
        return () => observer.disconnect();
    }, [outline, scrollContainer]);

    if (outline.length === 0 && backlinks.length === 0 && children.length === 0) return null;

    return (
        <div className="border-border/50 flex flex-col gap-4 overflow-auto border-l p-3 text-[13px]">
            {outline.length > 0 && (
                <RailSection title="On this page">
                    {outline.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() =>
                                scrollContainer
                                    ?.querySelector(`#${CSS.escape(entry.id)}`)
                                    ?.scrollIntoView({ block: "start" })
                            }
                            className={cn(
                                "hover:text-foreground truncate text-left",
                                entry.id === activeId
                                    ? "text-foreground"
                                    : "text-muted-foreground",
                            )}
                            style={{ paddingLeft: (entry.depth - 1) * 8 }}>
                            {entry.text}
                        </button>
                    ))}
                </RailSection>
            )}

            {children.length > 0 && (
                <RailSection title="Children">
                    {children.map((childId) => (
                        <button
                            key={childId}
                            type="button"
                            onClick={() => onOpenPage(childId)}
                            className="text-accent truncate text-left hover:underline">
                            {childId}
                        </button>
                    ))}
                </RailSection>
            )}

            {backlinks.length > 0 && (
                <RailSection title="Linked from">
                    {backlinks.map((from) => (
                        <button
                            key={from}
                            type="button"
                            onClick={() => onOpenPage(from)}
                            className="text-accent truncate text-left hover:underline">
                            {index.pages.find((entry) => entry.id === from)?.title ?? from}
                        </button>
                    ))}
                </RailSection>
            )}
        </div>
    );
}

export { WikiRail };
```

- [ ] **Step 3: Mount the rail in the preview**

In `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`:

```ts
import { extractOutline } from "@taskflow/shared";
import { WikiRail } from "@/components/panes/markdown/WikiRail";
```

Add:

```tsx
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
    const outline = useMemo(() => extractOutline(content), [content]);
    const wikiPageId = useMemo(() => {
        if (wikiRoot === null || !filePath.startsWith(`${wikiRoot}/`)) return null;
        return filePath.slice(wikiRoot.length + 1).replace(/\.(md|markdown)$/i, "");
    }, [filePath, wikiRoot]);

    const handleOpenPage = useCallback(
        (targetId: string) => {
            if (wikiRoot === null) return;
            const page = wikiIndex?.pages.find((entry) => entry.id === targetId);
            const path = page ? `${wikiRoot}/${page.path}` : `${wikiRoot}/${targetId}.md`;
            useSessionStore.getState().navigateTab(workspaceKey, tabId, path);
        },
        [tabId, wikiIndex, wikiRoot, workspaceKey],
    );
```

Set the callback ref on the scroll container so both `scrollRef` (Stage 1) and `scrollEl` are populated:

```tsx
        <div className="flex min-h-0 min-w-0 flex-1">
            <div
                ref={(node) => {
                    scrollRef.current = node;
                    setScrollEl(node);
                }}
                onScroll={handleScroll}
                onClick={handleClick}
                className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
                {/* existing prose container */}
            </div>
            {wikiPageId !== null && wikiIndex && wikiRailOpen && (
                <div style={{ width: wikiRailWidth }} className="shrink-0">
                    <WikiRail
                        outline={outline}
                        index={wikiIndex}
                        pageId={wikiPageId}
                        scrollContainer={scrollEl}
                        onOpenPage={handleOpenPage}
                    />
                </div>
            )}
        </div>
```

with `wikiRailOpen` / `wikiRailWidth` read from `useUIStore`. `scrollRef` must change type to `useRef<HTMLDivElement | null>(null)` if it is not already, so the callback ref can assign to it.

- [ ] **Step 4: Add the rail toggle to the toolbar**

In `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx`, add props `showRailToggle: boolean`, `railOpen: boolean`, `onToggleRail: () => void`, and render a `PanelRight` button before the edit toggle when `showRailToggle` is true. Pass `showRailToggle` from `MarkdownPane` as "the file sits under a wiki root" — compute it there with `useWikiRoot()` and a `filePath.startsWith` check.

- [ ] **Step 5: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

By hand: open a wiki page with several headings — the rail lists them, the entry for the heading currently at the top of the viewport is highlighted, and clicking one scrolls the pane. "Children" lists the frontmatter children; "Linked from" lists the pages the index says link here, and clicking one navigates in the same tab (back returns). Open a `.md` file *outside* the wiki root — no rail. Collapse the rail and resize it, then restart the app — both stick.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/panes/markdown/WikiRail.tsx \
        packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx \
        packages/ui/src/components/panes/MarkdownPane.tsx \
        packages/ui/src/components/panes/MarkdownPaneImpl.tsx \
        packages/ui/src/stores/ui-store.ts packages/shared/src/types/settings.ts \
        packages/backend/src/services/settings-store.ts
git commit -m "feat(wiki): outline, children and backlinks rail beside wiki pages"
```

---

## Task 8: Obsidian integration

**Files:**

- Create: `packages/backend/src/services/obsidian-detector.ts`
- Create: `packages/backend/tests/services/obsidian-detector.test.ts`
- Create: `packages/ui/src/lib/wiki/open-in-obsidian.ts`
- Modify: `packages/backend/src/handlers/wiki.ts`
- Modify: `packages/shared/src/types/wiki.ts`
- Modify: `packages/ui/src/components/panels/WikiPanel.tsx`
- Modify: `packages/ui/src/components/panes/MarkdownPane.tsx`
- Modify: `packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx`
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

**Interfaces:**

- Consumes: `MSG.WIKI_OBSIDIAN_STATE` (Task 4).
- Produces:
  - `type ObsidianVaultState = "registered" | "unregistered-vault" | "plain-folder"`
  - `interface ObsidianState { installed: boolean; vault: ObsidianVaultState | null }`
  - `function matchVault(path: string, vaultPaths: string[]): string | null`
  - `function classifyPath(args: { path: string; vaultPaths: string[]; hasObsidianDir: boolean }): ObsidianVaultState`
  - `function openInObsidian(absolutePath: string): void`
  - `function fetchObsidianState(root: string): Promise<ObsidianState>`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/obsidian-detector.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { classifyPath, matchVault, parseVaultRegistry } from "../../src/services/obsidian-detector";

describe("matchVault", () => {
    it("matches a path inside a registered vault", () => {
        expect(matchVault("/w/notes/docs/wiki", ["/w/notes"])).toBe("/w/notes");
    });

    it("matches the vault root itself", () => {
        expect(matchVault("/w/notes", ["/w/notes"])).toBe("/w/notes");
    });

    it("picks the longest matching prefix", () => {
        expect(matchVault("/w/notes/docs/wiki", ["/w", "/w/notes", "/w/notes/docs"])).toBe(
            "/w/notes/docs",
        );
    });

    it("does not match a sibling with a shared prefix", () => {
        expect(matchVault("/w/notes-other/x", ["/w/notes"])).toBeNull();
    });

    it("returns null with no vaults", () => {
        expect(matchVault("/w/notes", [])).toBeNull();
    });
});

describe("classifyPath", () => {
    it("reports a registered vault", () => {
        expect(
            classifyPath({ path: "/w/notes/wiki", vaultPaths: ["/w/notes"], hasObsidianDir: true }),
        ).toBe("registered");
    });

    it("reports an unregistered folder that has .obsidian", () => {
        expect(classifyPath({ path: "/w/notes", vaultPaths: [], hasObsidianDir: true })).toBe(
            "unregistered-vault",
        );
    });

    it("reports a plain folder", () => {
        expect(classifyPath({ path: "/w/notes", vaultPaths: [], hasObsidianDir: false })).toBe(
            "plain-folder",
        );
    });
});

describe("parseVaultRegistry", () => {
    it("reads the vault paths", () => {
        const json = JSON.stringify({
            vaults: {
                abc: { path: "/w/notes", ts: 1 },
                def: { path: "/w/other", ts: 2 },
            },
        });
        expect(parseVaultRegistry(json).sort()).toEqual(["/w/notes", "/w/other"]);
    });

    it("degrades to no vaults on malformed json", () => {
        expect(parseVaultRegistry("{not json")).toEqual([]);
    });

    it("degrades to no vaults on an unexpected shape", () => {
        expect(parseVaultRegistry(JSON.stringify({ vaults: "nope" }))).toEqual([]);
        expect(parseVaultRegistry(JSON.stringify({}))).toEqual([]);
    });

    it("skips entries with no path", () => {
        const json = JSON.stringify({ vaults: { a: { ts: 1 }, b: { path: "/w/x" } } });
        expect(parseVaultRegistry(json)).toEqual(["/w/x"]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/backend/tests/services/obsidian-detector.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/obsidian-detector'`.

- [ ] **Step 3: Implement the detector**

Create `packages/backend/src/services/obsidian-detector.ts`:

```ts
import { readFile, stat } from "fs/promises";
import { homedir, platform } from "os";
import { join, sep } from "path";
import type { ObsidianState, ObsidianVaultState } from "@taskflow/shared";

function isWithin(candidate: string, root: string): boolean {
    return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/** Longest registered-vault prefix containing `path`, or null. */
function matchVault(path: string, vaultPaths: string[]): string | null {
    let best: string | null = null;
    for (const vault of vaultPaths) {
        if (!isWithin(path, vault)) continue;
        if (best === null || vault.length > best.length) best = vault;
    }
    return best;
}

interface ClassifyArgs {
    path: string;
    vaultPaths: string[];
    hasObsidianDir: boolean;
}

function classifyPath({ path, vaultPaths, hasObsidianDir }: ClassifyArgs): ObsidianVaultState {
    if (matchVault(path, vaultPaths) !== null) return "registered";
    return hasObsidianDir ? "unregistered-vault" : "plain-folder";
}

/**
 * Read vault paths out of Obsidian's `obsidian.json`. The format is private and
 * undocumented, so any surprise degrades to "no vaults known" rather than
 * throwing — the caller then disables the menu entries.
 */
function parseVaultRegistry(json: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const vaults = (parsed as Record<string, unknown>).vaults;
    if (typeof vaults !== "object" || vaults === null || Array.isArray(vaults)) return [];

    const out: string[] = [];
    for (const entry of Object.values(vaults as Record<string, unknown>)) {
        if (typeof entry !== "object" || entry === null) continue;
        const path = (entry as Record<string, unknown>).path;
        if (typeof path === "string" && path !== "") out.push(path);
    }
    return out;
}

function appPath(): string {
    switch (platform()) {
        case "darwin":
            return "/Applications/Obsidian.app";
        case "win32":
            return join(process.env.LOCALAPPDATA ?? "", "Obsidian", "Obsidian.exe");
        default:
            return join(homedir(), ".local", "share", "applications", "obsidian.desktop");
    }
}

function registryPath(): string {
    switch (platform()) {
        case "darwin":
            return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
        case "win32":
            return join(process.env.APPDATA ?? "", "obsidian", "obsidian.json");
        default:
            return join(homedir(), ".config", "obsidian", "obsidian.json");
    }
}

async function exists(path: string): Promise<boolean> {
    return stat(path).then(
        () => true,
        () => false,
    );
}

/**
 * Current Obsidian state for a wiki root. The registry is read fresh on every
 * query because it changes whenever the user adds a vault.
 */
async function detectObsidian(wikiRoot: string | null): Promise<ObsidianState> {
    const installed = await exists(appPath());
    if (!installed || wikiRoot === null) return { installed, vault: null };

    const json = await readFile(registryPath(), "utf-8").catch(() => "");
    const vaultPaths = json === "" ? [] : parseVaultRegistry(json);
    const hasObsidianDir = await exists(join(wikiRoot, ".obsidian"));

    return { installed, vault: classifyPath({ path: wikiRoot, vaultPaths, hasObsidianDir }) };
}

export { classifyPath, detectObsidian, matchVault, parseVaultRegistry };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/backend/tests/services/obsidian-detector.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the types and the handler**

In `packages/shared/src/types/wiki.ts`:

```ts
export type ObsidianVaultState = "registered" | "unregistered-vault" | "plain-folder";

export interface ObsidianState {
    installed: boolean;
    /** null when Obsidian is not installed or no wiki root was given. */
    vault: ObsidianVaultState | null;
}
```

In `packages/backend/src/handlers/wiki.ts`, add:

```ts
    router.register(MSG.WIKI_OBSIDIAN_STATE, async (payload) => {
        const { root } = payload as WikiIndexPayload;
        const workspaceRoot = await assertWorkspacePath(taskStore, root);
        return detectObsidian(workspaceRoot);
    });
```

with `import { detectObsidian } from "../services/obsidian-detector";`.

- [ ] **Step 6: Add a shared open-in-Obsidian helper**

Create `packages/ui/src/lib/wiki/open-in-obsidian.ts`:

```ts
import { MSG } from "@taskflow/shared";
import type { ObsidianState } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

/**
 * `obsidian://open?path=<absolute path>` resolves against Obsidian's registered
 * vaults and opens whatever the path names — on a `.md` file, that page; on a
 * folder, the vault. Pass the page path whenever there is one.
 */
function openInObsidian(absolutePath: string): void {
    void window.taskflow?.openExternalUrl(
        `obsidian://open?path=${encodeURIComponent(absolutePath)}`,
    );
}

/** Ask the backend about Obsidian for a wiki root. Hits the disk — call on demand. */
function fetchObsidianState(root: string): Promise<ObsidianState> {
    return sendRequest<ObsidianState>(MSG.WIKI_OBSIDIAN_STATE, { root });
}

export { fetchObsidianState, openInObsidian };
```

- [ ] **Step 7: Add the wiki actions menu**

Add a `⋯` button to `WikiPanel`'s toolbar (and the same menu on right-click of the toolbar wiki button in `TaskHeader.tsx`, following the `handleNativeContextMenu` pattern already in `TaskHeader.tsx` for the project menu). Entries:

| Entry | Enabled when | Action |
|---|---|---|
| Open in Obsidian | `installed && vault === "registered"` | `openInObsidian(root)` |
| Reveal in Finder | always | `useFileStore.getState().revealInFinder(root)` |
| New page | always | `useFileStore.getState().createFile(root + "/" + name)` via the existing `CreateFileDialog` |

When `installed` is false, the "Open in Obsidian" entry is **not rendered at all**. When `installed` is true but `vault !== "registered"`, the entry is rendered **disabled**, with the tooltip:

```
Not an Obsidian vault. In Obsidian: Open folder as vault.
```

Call `fetchObsidianState(root)` when the menu opens, not on every render — the registry read hits the disk.

There is no supported way to register a folder as a vault from outside Obsidian: `obsidian://open?path=` resolves only against already-registered vaults, and the official CLI exposes no vault-registration command and requires the app to be running. Writing directly into `obsidian.json` is deliberately not attempted — it is private, read only at startup, and a bad write could disturb the user's existing vaults.

- [ ] **Step 8: Open the *current page* from the markdown pane**

The spec's requirement is that opening a `.md` file lands on that page in Obsidian, so the action also has to exist where a page is open. In `packages/ui/src/components/panes/MarkdownPane.tsx`:

```tsx
    const [obsidian, setObsidian] = useState<ObsidianState | null>(null);
    const wikiRoot = useWikiRoot();
    const inWiki = wikiRoot !== null && filePath.startsWith(`${wikiRoot}/`);

    useEffect(() => {
        if (!inWiki || wikiRoot === null) {
            setObsidian(null);
            return;
        }
        let cancelled = false;
        void fetchObsidianState(wikiRoot).then(
            (state) => {
                if (!cancelled) setObsidian(state);
            },
            () => {},
        );
        return () => {
            cancelled = true;
        };
    }, [inWiki, wikiRoot]);

    const canOpenInObsidian = obsidian?.installed === true && obsidian.vault === "registered";
    const handleOpenInObsidian = useCallback(() => {
        openInObsidian(filePath);
    }, [filePath]);
```

and pass `canOpenInObsidian` / `handleOpenInObsidian` to `MarkdownToolbar`, which renders a button (lucide `ExternalLink`, `aria-label="Open in Obsidian"`) only when `canOpenInObsidian` is true. Note it passes `filePath`, not the root — that is what makes Obsidian open the page rather than the vault.

- [ ] **Step 9: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

By hand, on the target machine: with the wiki inside a registered vault, open a wiki page and click the Obsidian button — Obsidian opens *that page*, not just the vault. From the panel's `⋯` menu, "Open in Obsidian" opens the vault at the root. Point the `wiki` attribute at a plain folder — the panel entry is present but disabled with the tooltip above, and the pane button does not appear.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/services/obsidian-detector.ts \
        packages/backend/tests/services/obsidian-detector.test.ts \
        packages/backend/src/handlers/wiki.ts packages/shared/src/types/wiki.ts \
        packages/ui/src/lib/wiki/open-in-obsidian.ts \
        packages/ui/src/components/panels/WikiPanel.tsx \
        packages/ui/src/components/panes/MarkdownPane.tsx \
        packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx \
        packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat(wiki): detect Obsidian vaults and open the current page in Obsidian"
```

---

## Task 9: Wiki health — orphans and broken links

**Files:**

- Create: `packages/ui/src/components/panels/WikiHealth.tsx`
- Modify: `packages/ui/src/components/panels/WikiPanel.tsx`

**Interfaces:**

- Consumes: `WikiIndexData.unresolved` and `.orphans` (Task 3), the panel from Task 5.
- Produces: `<WikiHealth />`.

The graph work is already done and tested in Task 3 — this task is presentation only, which is why it carries no new unit test. Its correctness is covered by `wiki-graph.test.ts`'s "unresolved" and "orphans" cases.

- [ ] **Step 1: Build the health section**

Create `packages/ui/src/components/panels/WikiHealth.tsx`:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WikiIndexData } from "@taskflow/shared";

interface WikiHealthProps {
    index: WikiIndexData;
    onOpenPage: (pageId: string) => void;
}

interface HealthGroupProps {
    title: string;
    count: number;
    children: React.ReactNode;
}

function HealthGroup({ title, count, children }: HealthGroupProps) {
    const [open, setOpen] = useState(false);
    if (count === 0) return null;
    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-0.5 text-left text-[12px]">
                {open ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                )}
                {title} ({count})
            </button>
            {open && <div className="flex flex-col pl-5">{children}</div>}
        </div>
    );
}

function WikiHealth({ index, onOpenPage }: WikiHealthProps) {
    if (index.unresolved.length === 0 && index.orphans.length === 0) return null;

    return (
        <div className="border-border/50 flex flex-col gap-1 border-t px-2 py-2">
            <HealthGroup title="Broken links" count={index.unresolved.length}>
                {index.unresolved.map((link) => (
                    <button
                        key={`${link.from}->${link.target}`}
                        type="button"
                        onClick={() => onOpenPage(link.from)}
                        className="truncate text-left text-[12px]">
                        <span className="text-muted-foreground">{link.from}</span>
                        <span className="text-destructive"> → {link.target}</span>
                    </button>
                ))}
            </HealthGroup>
            <HealthGroup title="Orphans" count={index.orphans.length}>
                {index.orphans.map((pageId) => (
                    <button
                        key={pageId}
                        type="button"
                        onClick={() => onOpenPage(pageId)}
                        className="text-muted-foreground hover:text-foreground truncate text-left text-[12px]">
                        {pageId}
                    </button>
                ))}
            </HealthGroup>
        </div>
    );
}

export { WikiHealth };
```

- [ ] **Step 2: Mount it under the tree**

In `packages/ui/src/components/panels/WikiPanel.tsx`, after the scrolling tree container and inside the same branch:

```tsx
                    {index && <WikiHealth index={index} onOpenPage={handleOpen} />}
```

with `import { WikiHealth } from "./WikiHealth";`.

- [ ] **Step 3: Verify**

Run: `bun test && bun run typecheck && bun run lint`
Expected: green.

By hand: add a `[[does/not/exist]]` link to a wiki page and save — "Broken links (1)" appears at the bottom of the panel within a second and expands to show `page → does/not/exist`. Remove the link — the group disappears.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/panels/WikiHealth.tsx \
        packages/ui/src/components/panels/WikiPanel.tsx
git commit -m "feat(wiki): surface broken links and orphan pages in the panel"
```

---

## Deviations from the spec, and why

1. **The wiki root is resolved in the renderer, not by a per-project backend service.** The spec places `resolveAttributes` layering in the backend index service. The renderer already holds every attribute layer it needs (`TaskInfoPanel.tsx:71–78` builds exactly this), so duplicating the layering server-side would be a second implementation of the same precedence rule. The backend instead keys its cache on the resolved absolute root and re-validates it through `assertWorkspacePath` — which is the correct trust boundary either way, since the root arrives over the wire. Worktree behaviour is unchanged: `workspace.workingDir` is already the worktree path for a task in a worktree.

2. **`WikiIndexService` rebuilds the graph rather than patching it.** The spec says "a changed file re-parses alone and patches the graph". Only the *parse* is incremental here; the graph rebuild from the cached page map is O(pages) with no I/O and takes single-digit milliseconds at the observed 110-page scale. Incremental backlink patching would be more code and more ways to drift out of sync for no measurable gain. If a wiki ever grows to the point where this matters, the page map is already the right data structure to patch against.

3. **Markdown links count toward the link graph, not only `[[wiki-links]]`.** `parseWikiPage` resolves relative `.md` links into page ids too, so backlinks and orphan detection reflect the whole graph. The observed wikis use wiki-links heavily but not exclusively, and a page reachable only through a plain markdown link is not an orphan.

## Self-review notes

- Spec §1 (what a wiki is, exact name match, missing path is a warning, worktree resolution, one per project) → Task 2, plus the panel's empty/error states in Task 5.
- §8 (index service: per-page fields, tree/backlinks/unresolved/orphans, incremental watcher, in-memory, `WIKI_INDEX` / `WIKI_INDEX_CHANGED`) → Tasks 3 and 4.
- §9 (sidebar panel sharing the `fileExplorerOpen` / `searchPanelOpen` exclusive group and width, toolbar toggle after Search, filter box and tree; context rail with outline + IntersectionObserver, Children, Linked from, collapsible with persisted width; wiki actions in a `⋯` menu and on toolbar right-click) → Tasks 5, 7 and 8.
- §10 (Obsidian detection, registry read fresh, longest-prefix matching, the three states, entries absent when not installed, `obsidian://open?path=` via `openExternalUrl`, fail-soft registry parse) → Task 8.
- §11's Stage 2 order (attribute → index → panel → wiki-links → rail → Obsidian → health) is the task order here.
- §12 unit-testing list: wiki-link parsing and resolution (Tasks 3 and 6), frontmatter extraction (Stage 1, relocated in Task 1), index graph and backlink construction (Task 3), Obsidian longest-prefix matching (Task 8). Checkbox source-position rewriting was covered in Stage 1.
- §13 risks: index rebuild cost is addressed by the debounced watcher plus the cheap in-memory rebuild (deviation 2); the private-registry risk by `parseVaultRegistry` degrading to `[]`.

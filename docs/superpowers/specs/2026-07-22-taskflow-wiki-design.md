# Taskflow Wiki & Markdown Support — Design

Date: 2026-07-22
Status: Approved, ready for implementation planning

## Problem

Taskflow's markdown support is inconvenient enough that project wikis are painful to use inside the app. Concretely, today:

- `.md` files always open in Monaco. Preview is reachable only via right-click → "Preview" in the file explorer (`FileContextMenu.tsx:70`).
- Switching away from a preview tab and back loses scroll position. Cause: `TabContent.tsx:135` returns `null` for inactive markdown tabs, unmounting the pane. Terminals and browser tabs are exempted via `isAlwaysMounted()`; markdown is not.
- Anchor links (`#some-heading`) do nothing. No `rehype-slug`, so headings render without `id`s, and there is no click interception, so an in-page anchor would try to navigate the whole webview.
- Prose runs edge-to-edge (`prose max-w-none`, `MarkdownPaneImpl.tsx:121`) and `global.css:236` sets `word-break: break-word`, which breaks ordinary words mid-syllable. On wide panes long list items orphan two or three words onto a second line, turning lists into an unreadable stagger.
- No mermaid, no math, no frontmatter handling, no wiki-links.
- Relative links (`./other.md`) and relative images (`![](img.png)`) are broken.
- No integration with Obsidian or any external markdown editor.

## Evidence base

Design decisions below are grounded in the user's real wikis: `TheFloorr/monorepo/docs/wiki` (110 markdown files, 716K), `TheFloorr/shopify/docs/wiki`, and `silentium-wiki`.

Observed in that content:

- Every page carries YAML frontmatter with `title`, `parents`, `children`, `related_pages`, `last_updated`. **The page hierarchy is already declared**; the index does not have to infer it. Today this block renders as visual garbage.
- Wiki-links are used heavily and are **path-based** (`[[business/money/currency]]`), not title-based. They render as literal `[[...]]` text today.
- **Zero inline HTML** across all three wikis.
- **Zero mermaid blocks, zero math, zero images** across all three wikis.

The last two facts drive two decisions: omitting `rehype-raw` costs nothing today, and mermaid/KaTeX/images are forward-looking capability rather than repairs — they are the natural cut line if the work needs to ship sooner.

## Scope

Delivered in two stages. Stage 1 is self-contained and ships alone; Stage 2 adds the wiki concept on top without reworking Stage 1.

---

## 1. What "a wiki" is

A project attribute whose name is exactly `wiki` (lowercase, matched exactly — attribute names are user-authored free text, so no fuzzy matching) and whose value is a folder path, relative to the project root (`docs/wiki`) or absolute. Nothing else declares a wiki.

A value pointing at a missing or non-directory path is treated as "no wiki", surfaced as a warning in the panel rather than an error.

Resolution reuses the existing attribute layering (`resolveAttributes`), so a task inherits its project's `wiki` and resolves it against the workspace working dir. A task running in a worktree therefore gets *that worktree's* copy of the wiki, not the main checkout's — the correct behaviour when a task is editing docs.

One wiki per project. The user's two TheFloorr wikis are already separate Taskflow projects, so multi-root support buys nothing and is out of scope.

**Absence of the `wiki` attribute is not a degraded state.** Everything in Stage 1 applies to every `.md` file in every project. The attribute gates only what genuinely needs a root: the sidebar tree, `[[wiki-links]]`, backlinks, and the Obsidian entries.

## 2. Tab model

The `markdown` tab type gains `mode: "preview" | "edit"`. `editor` tabs are no longer used for `.md` files. One tab per file; the pane swaps in place.

Routing in `openFileInApp`:

| Opened from | Lands in |
|---|---|
| Explorer click, wiki-link, relative link | `markdown` tab, preview mode |
| Search result (carries a line number) | `markdown` tab, **edit** mode, cursor on that line |
| Terminal file link with `:line` | `markdown` tab, edit mode at the line |

The line-number rule is load-bearing: when a search hit is clicked, preview cannot honour "line 214", so edit mode is the only correct destination.

The Edit button honours the existing `internalEditor` setting. Monaco swaps the pane in place. A configured CLI editor (nvim etc.) spawns a terminal session exactly as today, and the tab remains in preview.

**Migration.** Tabs are persisted, so existing sessions will hold `editor` tabs pointing at `.md` files. On load, an `editor` tab with a `.md` `filePath` and no `sessionId` is rewritten to a `markdown` tab in `edit` mode — preserving what the user was doing rather than yanking them into preview. Tabs with a `sessionId` (CLI editors running in a terminal) are left untouched.

## 3. Scroll preservation

Two distinct losses, two fixes.

**Tab switching.** Add `markdown` to `isAlwaysMounted()` in `TabContent.tsx`, using the off-screen `left:-9999em` pattern that terminal tabs use — *not* the `<Activity>` / `display:none` path used by browser tabs. `display:none` drops the scroll container's `scrollTop`, so `Activity` would not fix the reported bug. Off-screen positioning keeps layout alive, which mermaid also requires in order to measure and render.

**Preview ↔ edit swap.** This genuinely unmounts one pane, so the tab record carries `previewScrollTop`, restored on remount, with throttled writes. The same field persists across app restarts.

## 4. Rendering pipeline

Added to the existing `remark-gfm`:

- `rehype-slug` — heading `id`s, the prerequisite for anchor links resolving at all.
- `remark-frontmatter` plus a small parser — strip the YAML block and render it as a compact header (title, `last_updated`, `parents`/`children` as navigable links).
- `remark-math` + `rehype-katex`.
- **Mermaid** — a lazy-imported renderer for ` ```mermaid ` code blocks, so the library loads only on pages that use it. Themed to match the dark UI.
- **Wiki-links** — a remark plugin handling `[[path/to/page]]`, `[[path|alias]]`, `[[page#heading]]`, resolved against the wiki root. Unresolvable targets render in a distinct "broken" colour rather than silently appearing valid. Active only when a wiki root exists.
- **No `rehype-raw`.** Inline HTML stays escaped. Repository content is not necessarily authored by the user, and the observed wikis contain no inline HTML, so this opens an injection path for no benefit.

## 5. Typography

- Remove `word-break: break-word` from the `p`/`li`/`td` rule in `global.css:236`; keep `overflow-wrap: break-word` so long URLs and paths still break but ordinary prose never does.
- Cap prose at a reading measure, centred in the pane. `pre`, `table`, mermaid diagrams and images break out to full pane width.
- New setting `editor.markdownWidth`: `narrow` (62ch) / **`medium` (74ch, default)** / `wide` (88ch) / `full`.

The default was chosen by rendering real excerpts from `business/money.md` and `business/glossary.md` at each width; at 88ch the longer bullets begin orphaning words again, which is the specific failure being fixed.

## 6. Link handling

A single delegated click handler on the preview container:

| Target | Behaviour |
|---|---|
| `#anchor` | Scroll within the pane. Never navigates the webview. |
| Relative `.md` | Navigate **in the same tab**, pushed onto tab-local history |
| `[[wiki-link]]` | Resolve against wiki root, then navigate as above |
| Other relative file | Delegate to `openFileInApp` |
| `http(s)://` | Open in the external browser |

Back/forward buttons in the preview toolbar drive the tab-local history. Without them, following a link is a one-way trip.

## 7. Remaining Stage 1 items

- **Images.** Relative image sources cannot be fixed client-side. Add `GET /api/file/raw?path=` to the existing HTTP router, serving with a content type, **hard-restricted to paths inside known project roots with `..` rejected**. `<img src>` is rewritten to it.
- **Checkboxes.** Clicking a `- [ ]` in preview rewrites that line and saves. remark node positions give an exact source byte range, avoiding a regex guess.
- **Copy button** on code blocks.
- **Outline extraction** from heading nodes. Unused in Stage 1; it is what feeds the Stage 2 context rail, so it is built here.

---

## 8. Wiki index (Stage 2)

Backend service `wiki-index.ts`, one instance per project that has a `wiki` attribute.

**Per page**: relative path (the page id), title (frontmatter `title` → first H1 → filename), frontmatter fields, heading list, outgoing links, mtime.

**Derived**: the page tree (filesystem structure, ordered and enriched by `parents`/`children` where present), a backlink map (reverse of outgoing links), unresolved links, orphans.

**Incremental** via a chokidar watcher on the root, reusing `FileWatcher`'s ignore rules. A changed file re-parses alone and patches the graph; debounced. Held in memory only — at 110 files / 716K a cold rebuild is milliseconds, so persistence is unwarranted.

New WS messages `WIKI_INDEX` (fetch) and `WIKI_INDEX_CHANGED` (push), following the existing `FILE_*` pattern.

## 9. The two views

**Sidebar panel.** `wikiPanelOpen` joins `fileExplorerOpen` / `searchPanelOpen` in the same mutually-exclusive group in `ui-store`, sharing their width. The toolbar toggle sits directly after Search. Contents: a filter box and the page tree; clicking a page opens it in a preview tab.

**Context rail.** Inside `MarkdownPane`, shown only for files under a wiki root: "On this page" (outline, with the active heading tracked by an `IntersectionObserver`), "Children", "Linked from". Independently collapsible, width persisted.

**Wiki actions** (Open in Obsidian, Reveal in Finder, New page) live in a `⋯` menu in the panel header *and* on right-click of the toolbar button — reachable without opening the panel, without adding a second toolbar control.

## 10. Obsidian integration

Backend `obsidian-detector.ts`.

**Installed?** macOS `/Applications/Obsidian.app` (bundle id `md.obsidian`); Windows `%LOCALAPPDATA%\Obsidian\Obsidian.exe`; Linux desktop entry / flatpak.

**Vault registry**: macOS `~/Library/Application Support/obsidian/obsidian.json`, Windows `%APPDATA%\obsidian\`, Linux `~/.config/obsidian/`. Read fresh on each query, since it changes when the user adds a vault.

**Path resolution** by longest registered-vault-prefix match, yielding one of three states:

1. **Registered vault** — entries enabled.
2. **Has `.obsidian/` but is not in the registry** — entry shown **disabled**, tooltip: "Not an Obsidian vault. In Obsidian: Open folder as vault."
3. **Plain folder** — same disabled treatment.

Obsidian not installed → the entries do not exist at all.

Opening uses `obsidian://open?path=<encoded absolute path>` via the existing `openExternalUrl` → `shell.openExternal`. No new IPC. On a `.md` file this opens *that page*, not merely the vault.

**Verified constraint:** there is no supported way to open an unregistered folder as a vault. `obsidian://open?path=` resolves only against already-registered vaults ("searches for the most specific vault which contains the specified file path"), and the official CLI (Obsidian 1.12.7, `/usr/local/bin/obsidian` → `obsidian-cli`) exposes `daily`, `search`, `create`, `read`, `files`, `unresolved` and similar, with no vault-registration command — and requires the app to already be running. Writing directly into `obsidian.json` was considered and rejected: it is a private undocumented file, read only at startup, and a malformed write could disturb existing vaults.

The registry format being private, a parse failure degrades to "no vaults known" and disables the entries rather than throwing.

## 11. Build order

**Stage 1** — tab model + edit toggle → scroll fixes → typography + width setting → slugs, link routing, tab history → frontmatter → checkboxes, copy button, outline extraction → images route → mermaid + KaTeX.

**Stage 2** — `wiki` attribute + resolution + index service + watcher → sidebar panel + toolbar toggle → wiki-links + broken-link styling → context rail → Obsidian → health section (orphans, broken links).

Images, mermaid and KaTeX are the natural cut line: they are the only Stage 1 items that repair nothing in the user's current content.

## 12. Testing

**Unit**: wiki-link parsing and resolution; frontmatter extraction; checkbox source-position rewriting; index graph and backlink construction; Obsidian longest-prefix vault matching.

**Component** (bun + happy-dom, following the `AttributesSection.test.tsx` precedent): the link-routing table; scroll restoration across a tab switch.

**Security**: `/api/file/raw` gets explicit adversarial tests — encoded traversal, symlinks pointing outside the root, absolute paths outside any project root. This is the one piece of the design that is a security boundary rather than a UX nicety.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Mermaid bundle bloat | Lazy import; assert it stays out of the main chunk |
| Many off-screen markdown tabs held in memory | Cheap relative to terminals, but measure before assuming |
| Obsidian's private registry format changes | Fail soft to "no vaults known" |
| Index rebuild cost on a large wiki | Debounced incremental patching |

## Explicitly out of scope

- CLI commands for agents (`taskflow-cli wiki …`). Agents already have full filesystem access to the repo.
- Multiple wiki roots per project.
- Integration with markdown editors other than Obsidian. Only Obsidian is installed on the target machine; the detector's shape leaves room for others without committing to them now.
- Editor/preview split view with synced scroll.
- PDF export, tag indexes.

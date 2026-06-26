# SwiftUI UI Rebuild — Effort Scope

**Date:** 2026-06-26
**Status:** Scoping estimate. Feeds the native-rewrite go/no-go.
**Inputs:** `2026-06-26-native-macos-libghostty-viability.md` (assessment),
`2026-06-26-native-macos-libghostty-spike-results.md` (terminal + backend proven).
**Subject:** the React frontend at `packages/ui` — **31,822 LOC across 197 files**.

## Context

The spike de-risked the terminal and the backend bridge. The assessment said the **UI rebuild**
is the real cost and the actual decision driver. This doc scopes that rebuild: what must be
re-expressed in SwiftUI, what can be discarded, what can be bridged, where the genuinely hard parts
are, and a rough effort shape — enough to make a go/no-go.

**Assumptions for all sizing below:** one experienced macOS/SwiftUI engineer; "throwaway-spike"
discipline does **not** apply (this is production parity); backend + `@taskflow/shared` reused
unchanged (decisions D2/D3); macOS 13+. T-shirt sizes are primary; week ranges are rough and
compound-uncertain — treat them as order-of-magnitude, not commitments.

## Two corrections to the prior risk picture

1. **The terminal is no longer an island.** Both inventory passes reflexively tagged xterm.js as
   "needs a WKWebView island." For *this* project that's now false — the spike proved **libghostty
   renders all terminal panes natively** (`.exec` for interactive, `.inMemory` for watched). The 6
   xterm packages + `time-budgeted-writer` + terminal link/viewport helpers are **replaced, not
   ported**.
2. **Monaco is replaceable by a native editor — there are likely _zero_ web islands.** Reading the
   actual editor code (`EditorPaneImpl.tsx`), Monaco here is **not used as an IDE**: semantic
   validation is explicitly **off** (`noSemanticValidation`, `noSuggestionDiagnostics`), there's no
   autocomplete/minimap. The real feature surface is *syntax-highlighted editing + save + go-to-line +
   Cmd+click-open-import*, plus a **read-only** diff viewer. Cross-file import navigation is already
   resolved by the **backend** (`TS_RESOLVE_IMPORT`/`TS_RESOLVE_TSCONFIG`); Monaco only draws the
   underline and opens the file. The single feature that genuinely needs Monaco's language worker is
   **same-file go-to-definition of local TS/JS symbols** — minor, and reproducible via tree-sitter or
   the backend TS API. So the editor goes **native** (see "The editor" below), markdown is a plain
   text view, and the app can plausibly ship with no `WKWebView` at all.

## Reuse / rebuild / discard split

The non-visual layers (8,553 LOC of stores/hooks/lib/transport) break down as:

| Bucket | LOC | Meaning for the rewrite |
|---|---:|---|
| **Portable logic** | ~4,216 (49%) | Real domain logic → **reimplement in Swift** (stores, WS transport, fuzzy match, run-menu, agent-option normalize, terminal/theme math) |
| **React glue** | ~3,832 (45%) | DOM/CSS/hook plumbing → **discard**; SwiftUI replaces it with far less code (native state, styling, layout) |
| **Bridgeable** | ~562 (7%) | **Don't rebuild** — call the backend / import `@taskflow/shared` (settings, theme JSON, agent status) |

The ~22k LOC of *visual* component code is the bulk of the work: it must be re-expressed in SwiftUI,
but idiomatic SwiftUI is typically far terser than the Tailwind+Radix wrappers, so target LOC is
materially lower than 1:1.

## Visual components — area-by-area scope

| Area | LOC | SwiftUI approach | Difficulty | Size |
|---|---:|---|---|---|
| `ui/` primitives (buttons, inputs, dialogs, selects, tabs, tooltips, badges) | 2,353 | Build an app-styled component kit; mostly native (Button, Toggle, Menu, Sheet, Popover). Do **first** — everything depends on it. | Moderate | **M** (~2w) |
| `workspace/` (split container, tab bars, **draggable tabs**, agent-options, task header/git) | 4,346 | `NSSplitView`/`HSplitView` (resizable panes come **free**, replacing the custom `ResizeHandle`); tabs + native drag/drop. The structural heart. | Hard | **L** (~3–4w) |
| `panes/` (Editor→**native code view**, Terminal→**libghostty native**, Browser→`WKWebView`, Changes→native diff, Markdown→native text) | 3,014 | Native code-editor component + libghostty + one real `WKWebView` only for the actual browser pane; logic is in stores. Terminal already proven. | Mixed | **M–L** (~3w) |
| `sidebar/` (task/project list, **drag-reorder**, notifications, toolbar) | 2,990 | `List`/`OutlineGroup` + `.draggable`/`.dropDestination` + `Menu`. | Moderate | **M–L** (~2–3w) |
| `panels/` (file explorer/tree w/ git-status colors + context menu, search/replace) | 2,619 | `OutlineGroup` + context menus; search results list. | Moderate | **M** (~2–3w) |
| `flows/` (flow editor, management, action editor) | 2,078 | Forms + lists; no exotic rendering. | Moderate | **M** (~2w) |
| `settings/` (multi-tab modal, model selects, agent options) | 1,984 | `TabView`/`Form` + `Picker`s; reuses `shared/` fragments. | Easy–Mod | **M** (~2w) |
| top-level (AppShell 6-pane, **command palette**, shortcuts dialog, dialog host) | 1,221 | Split layout native; command palette = custom fuzzy overlay. | Moderate | **M** (~2–3w) |
| `schedules/` (schedule form + helpers) | 893 | Forms. | Easy | **S–M** (~1w) |
| `shared/` (per-agent option fragments) | 752 | Reusable SwiftUI views; shared across settings/run menus. | Easy | **S** (~1w) |
| `appearance/` (theme grid/cards, fonts, import) | 479 | `LazyVGrid` of swatches. | Easy | **S** (~1w) |
| `icons/` (agent brand icons) | 86 | Asset catalog; lucide → **SF Symbols** (57 icons, ~95% direct map). | Trivial | **XS** |

## Non-visual layers — scope

| Layer | LOC (portable) | Approach | Size |
|---|---:|---|---|
| WS transport (correlationId RPC + broadcast + 30s timeout + exp-backoff reconnect) | 207 | **Already prototyped** in the spike (`BackendWatch.swift`); productionize into a generic client. | **S** (~1w) |
| Stores → `ObservableObject`s (session/task/project/flow/search/file/theme + helpers) | ~2,400 | Reimplement domain logic as `@Published` view models; mind module-level event registration + stable-selector equivalent. | **L** (~3–4w) |
| `lib/` portable logic (fuzzy-match, run-menu, terminal links, normalize-agent-options, editor-language) | ~1,200 | Direct Swift port; pure functions. | **M** (~1–2w) |
| Theming (bundled JSON + `deriveTheme`) | — | **Bridge**: codegen Swift from `@taskflow/shared` (D3); map 42 CSS vars → an `AppTheme` struct; feed ANSI colors to libghostty config. | **S–M** (~1w) |
| Type/theme codegen bridge (`@taskflow/shared`) | — | Build-time TS→Swift structs; per assessment D3. | **S** (~1w) |

## The editor (native) — and the one genuine web view

The earlier draft called Monaco "the only unavoidable web island." Re-reading the code, that's wrong:
the editor's feature set is small enough to go native, which removes the largest remaining integration
unknown (a JS↔Swift Monaco bridge) from the whole rewrite.

- **Code editor + diff → native component.** Options, in order of fit:
  - **CodeEditSourceEditor** (CodeEdit project) — SwiftUI **and** AppKit, tree-sitter highlighting,
    find/replace, **built-in text diff**, current-line highlight, bracket matching. One dependency
    covers both the editor pane and the read-only diff viewer. ⚠️ self-described "in development, not
    production-ready" — vendor/pin it, same posture as the `libghostty-spm` fork.
  - **STTextView** (krzyzanowskim) — production-grade TextKit2 `NSTextView` + SwiftUI wrapper; add
    tree-sitter highlighting yourself. Stable, more wiring.
  - **Highlightr** — highlight.js via JavaScriptCore → `NSAttributedString` in a native `NSTextView`.
    No web view; trivial effort; the "can't-fail but basic" floor.
- **Preserve Cmd+click import-open natively:** reuse the specifier regex from `monaco-import-navigation.ts`,
  call the existing `TS_RESOLVE_IMPORT` backend message, open the file. The smarts are already backend-side.
- **Accept losing:** same-file local go-to-definition (Monaco's one real language-worker feature).
  Reproduce later via tree-sitter or the backend TS API if it's missed.
- **Markdown pane** (`MarkdownPaneImpl`) and the two markdown dialogs use Monaco/markdown only as
  word-wrapped text — a plain `NSTextView`/`TextEditor` (+ optional native highlighter) replaces them. Size: **S**.
- **The only real `WKWebView`** left is the actual **Browser pane** — which is genuinely web content,
  not an island wrapping a JS lib.

## Effort shape (rough)

Summing midpoints across visual + non-visual + native-editor + codegen lands around **~30–40
engineer-weeks (~7–9 months solo, ~3–4 months for a small team) to production parity** — consistent
with the assessment's "large." Dropping the Monaco bridge trims integration risk but not the headline
range, because cost is dominated by breadth, not that one component. Distribution:

- **~60%** is breadth: re-expressing many forms/lists/dialogs/panels in SwiftUI (individually easy, collectively the bulk).
- **~25%** is the structural spine: app shell + workspace split/tabs/drag + store/view-model layer.
- **~10%** is the native code-editor component + diff + import-open wiring (was a JS bridge; now a dependency-integration task).
- **~5%** is the terminal + WS transport — **already de-risked/prototyped**.

Cheap wins (do early, build momentum): icons (SF Symbols), appearance grid, schedules/settings forms,
the WS client, the theme codegen. True long poles: **workspace split/tab/drag** and the
**store→view-model port** — the editor is no longer one of them.

## Risks specific to the UI rebuild

1. **Breadth fatigue, not technical blockers.** No single screen is hard; there are ~12 feature areas
   and dozens of dialogs. The risk is sustained volume, and parity drift (keyboard shortcuts, focus
   rings, resize persistence, context menus) that's invisible until a user misses it. **This is now the
   dominant risk** — there's no remaining hard integration unknown to hide behind.
2. **Native code-editor dependency maturity.** CodeEditSourceEditor is pre-production; either accept
   vendoring/tracking it (like the libghostty fork) or take the more-wiring STTextView+tree-sitter
   path. Lower-stakes than a JS bridge, but a real choice. Losing same-file go-to-definition is a known,
   minor trade.
3. **Two render worlds, not three.** libghostty (Metal) + native SwiftUI in one window — focus,
   theming, and key-routing must be unified. The Monaco/WebView seam is gone; only the real Browser
   pane is web content.
4. **Parity is a moving target.** `packages/ui` keeps evolving; a long rewrite chases a live codebase.
   Mitigate by freezing scope to a parity snapshot and reusing the backend so behavior is shared.

## Recommended next step — a UI vertical-slice spike

Before committing to the full rebuild, prove the *UI* integration the way we proved the terminal:
a **thin vertical slice** exercising the hardest seams end-to-end —

> app shell (`HSplitView`) + sidebar task list + one task workspace with a **tabbed split** hosting a
> **libghostty terminal pane** and a **native code-editor pane** (CodeEditSourceEditor or STTextView),
> driven by a real Swift **WS store layer** against the live backend.

That slice hits split/tabs/drag, the store→view-model pattern, the WS transport, the native editor +
theming in one go — without building all 12 areas. Its result is the true commit-or-not signal for the
native rewrite.

## Bottom line

The UI rebuild is **large but de-risked in kind**: no blockers, the terminal is solved natively, and
the editor goes native too (Monaco was a quick-edit affordance, not an IDE) — so the app can ship with
no web islands beyond the real Browser pane. Cost is dominated by breadth (~12 feature areas, many
dialogs) plus a structural spine (workspace split/tabs/drag + a Swift store layer); the remaining risk
is volume and parity drift, not any single hard component. Order-of-magnitude **~7–9 months solo /
~3–4 months small team** to parity. The next de-risking move is a UI vertical-slice spike, not a full
commitment.

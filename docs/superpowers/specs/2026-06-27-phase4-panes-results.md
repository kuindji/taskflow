# Phase 4 (Panes) — Results & Acceptance Note

**Date:** 2026-06-27
**Plan:** `docs/superpowers/plans/2026-06-27-phase4-panes.md`
**Master plan:** `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md` (Phase 4 = units 4.1–4.5)
**Commit range:** `8b06b8b` (Phase-3 close / plan base) · `a08ec00..c0c1469` (Tasks 1–11 + final-review fix wave)
**Status:** ✅ **Phase 4 complete (code gate).** Real pane content is wired into the spine. Live in-app
visual verification is a documented **human-dogfood** item (see "Verification" below).

Execution followed subagent-driven-development: a fresh implementer per task, an independent
per-task spec+quality review, fixes re-verified, then a final whole-branch review (opus) whose two
cross-task findings were fixed. Per-task detail + minor triage: `.superpowers/sdd/progress.md`.

---

## Headline architecture decision (D4 resolution)

The master plan's **D4** specified *hybrid* PTY ownership (app-spawned `.exec` interactive +
backend-owned `.inMemory` watched). While grounding the plan we confirmed the Bun backend **already
owns every PTY** — interactive *and* scheduled — and streams `terminal:output` exactly as the
Electron `xterm.js` frontend consumes today, and the Phase-0 spike already proved `.inMemory`-over-WS
renders a live interactive agent (its blessed "option (d)"). **Product owner confirmed (2026-06-27):
render all terminal sessions through one `.inMemory` WS path.** Consequences:

- **Lower risk, guaranteed parity** with Electron; **zero backend changes**.
- **The per-spawn env-scrub isolation hazard is moot** — the app never spawns a PTY; the already
  sandboxed sidecar owns spawning. (Carry-forward #1 from Phase 3 retired by design, not by code.)
- Keystrokes round-trip through the backend WS (identical to current behavior); spike showed latency
  is fine. `.exec` is **not** used in production panes.

---

## What each task landed

- **Task 1 — `SessionViewModel` terminal-activity seam.** `SessionActivity` (500ms interaction
  time-window `INTERACTION_SUPPRESSION_MS` + 3000ms settle timer `ACTIVITY_TIMEOUT`, injectable
  clock) + `bind()` now subscribes to `terminal:output` / `session:status` / `session:exited`;
  `usesActivityStatus` = the 6 AI types (claude/codex/opencode/gemini/cursor/pi) per
  `session-helpers.ts`. **Controller fix mid-task:** the brief's persistent-Set suppression was a bug
  (would suppress "working" forever after the first keystroke); replaced with the faithful 500ms
  window. Focus-aware `settleInactiveSession` deferred to Phase 5 (no window/tab focus tracking yet).

- **Task 2 — `FileViewModel.file:changed` debounce seam.** Pure `changedDirsToRefresh` (parent-dir,
  loaded-only, deduped) + `loadedDirSet` tree-walker + the lazy `client.on(.fileChanged)` handler
  kept INSIDE the `fileChangeSubscriptionReady` guard (Phase-3 placement requirement honored), 150ms
  cancel/replace debounce → refetch affected dirs + git status. Phase-5 diff-store seam preserved.

- **Task 3 — `TerminalSessionBridge`.** Subscribe-before-snapshot (no lost-chunk gap), snapshot-first
  with `cursorHidden` DECTCEM + `session:history` fallback + graceful empty-start; pure `nonisolated
  reconcile` (drop ≤ lastSequence, sort ascending, advance to max); live chunks gated `seq >
  lastSequence`. Generated `sequence`/`lastSequence` are `Double` → `Int` at the boundary (no precision
  risk). **After the final-review fix wave the bridge is output-only** (snapshot + stream → `receive`;
  `start`/`stop`).

- **Task 4 — `TerminalSurfaceCache` + `TerminalPane`.** Per-`sessionId` cached `AppTerminalView` +
  `InMemoryTerminalSession` + bridge, so a session survives tab switches without re-snapshotting;
  `.inMemory` setup faithful to the spike; theme via `GhosttyThemeConfig.pairs`. Fixes during review:
  broke a `BridgeBox` retain cycle (later removed entirely in the fix wave), DEBUG guard on the
  nil-client stub, deterministic `ThemeStore.currentFile` fallback.

- **Task 5 — `EditorPane` + `LanguageDetection` + `EditorTheme`.** `CodeEditSourceEditor`, **WS-only**
  file load/save (never the local FS), `CodeLanguage.detectLanguageFrom(url:)` with `.default`
  fallback, `AppTheme`→`EditorTheme` map, ⌘S save (errors surfaced, not swallowed), go-to-line,
  `.id(filePath)` fresh-editor file-swap, and a `LoadKey(path, connected)` `.task` so the editor
  **reloads when the sidecar connects** instead of staying blank. Surfaced an explicit
  `CodeEditLanguages 0.1.20` dependency — byte-identical to the version `CodeEditSourceEditor 0.12.0`
  already pins transitively (no drift; within the exact-pinning rule).

- **Task 6 — Cmd+click import-open.** `ImportNavigation.specifier(inLine:column:)` (pure port of
  `src/lib/monaco-import-navigation.ts`; 1-based↔0-based handled) + `resolve` using the generated
  `TsResolveImportResponse.resolvedPath`; the gesture uses `onChange(of: cursors)` + `NSEvent`
  modifier flags (CodeEditSourceEditor 0.12.0 exposes no hit-testing) — ⌘+Arrow false-trigger proven
  harmless (specifier → nil → no RPC).

- **Task 7 — `DiffView`.** Pure unified-diff parser (fileHeader classified **before** `+`/`-` so
  `--- a/x` ≠ deletion; marker-stripped; empty → `[]`) + a read-only monospaced renderer with
  success/destructive ±tint.

- **Task 8 — `ChangesPane`.** `git:diff` via a thin local `GitDiffEnvelope { diff: GitDiffResult }`
  (the codegen emits no wrapper for this message) reusing generated `GitDiffResult`/`GitDiffFile`;
  file list (staged/unstaged badge, ±counts) + selected file's `.diff` via `DiffView`. **Controller
  correction:** `git:diff-file-content` returns content pairs, not a unified diff — used `git:diff`,
  whose per-file `.diff` strings need no secondary fetch. Index selection is double-guarded against
  repo-switch out-of-bounds. **Known limitation:** `git:diff` omits untracked files (Phase-5 breadth).

- **Task 9 — `BrowserPane`.** `WKWebView` `NSViewRepresentable`. **Controller-caught bug (was in the
  plan's own sample):** `coordinator.lastURL` was never assigned → the web view reloaded on every
  redraw; fixed by recording it in `load()`.

- **Task 10 — `MarkdownPane`.** Word-wrapped, selectable, WS-loaded text (markdown → plain text per the
  UI-scope decision), same `LoadKey` reload-on-connect pattern as the editor.

- **Task 11 — `PaneHost` router (integration gate).** `switch TabType` → Terminal/Editor/Markdown/
  Browser/Changes panes (sessionId/filePath/url/repoPath), nil-field → muted empty. `repoPath` =
  `WorkspaceKey.base` then task→`worktree.path` (fallback project path) / project→`path` / master→nil.
  `SplitContainer` call site swapped; **`PanePlaceholder` deleted** (zero type references).
  `FileViewModel.onOpenFile` wired in `AppEnvironment` — active-key resolution
  (task→project→master) matches `WorkspaceView` exactly, so files open in the visible workspace.
  Fix: id-based dedup in `SessionViewModel.addTab` (editor tabs have no `sessionId`, so reopening a
  file now focuses the existing tab instead of duplicating).

- **Final-review fix wave (commit `c0c1469`).** The opus whole-branch review found two cross-task
  integration defects that no per-task review could see, both fixed:
  1. **Interaction-suppression was dead end-to-end** — live input flowed
     `InMemoryTerminalSession.write → bridge.sendInput → client.send`, bypassing
     `SessionViewModel.sendInput` where `markInteraction`/`lastTerminalSize` live. Re-routed terminal
     input/resize **through `SessionViewModel`** (now the single live input path; `[weak session]`
     captures; `BridgeBox`/`@unchecked Sendable` removed; bridge is output-only).
  2. **`TerminalSurfaceCache.evict` had no caller → leak** — added `SessionViewModel.onTerminalEvict`
     (injected closure, wired in `AppEnvironment` to `terminalSurfaces.evict`), called on
     `session:exited` and in `closeSession` **before** the close RPC so eviction fires even if the RPC
     throws.

---

## Test results

- `swift test`: **143 XCTest cases, 0 failures** (Phase-3's 102 + Phase-4 additions:
  `SessionActivityTests`, `FileChangeDebounceTests`, `TerminalSequenceTests`, `LanguageDetectionTests`,
  `ImportNavigationTests`, `DiffParseTests`, plus the tab-dedup + eviction-wiring tests). Re-run at
  close 2026-06-27 — all suites 0 failures (the one ~30s suite is the existing `WSClient` timeout test).
- `swift build`: clean. (The `TreeSitter*` "unable to open object file" lines are pre-existing harmless
  linker warnings from the prebuilt language grammars.)

## Acceptance vs master-plan units

- **4.1 Terminal pane** → Tasks 1+3+4 (one `.inMemory`-over-WS path covers interactive *and* watched;
  activity status seam filled). ✅ (live render = dogfood)
- **4.2 Native code editor + diff** → Task 5 (editor, WS load/save, theming) + Task 7 (read-only diff). ✅
- **4.3 Cmd+click import-open** → Task 6 (known accepted loss: same-file local go-to-definition). ✅
- **4.4 Browser pane** → Task 9. ✅
- **4.5 Changes + Markdown panes** → Task 8 (changes) + Task 10 (markdown). ✅
- Carry-forward seams: SessionViewModel activity (T1), FileViewModel file:changed (T2), session
  persistence across tab switches (T4 cache), editor in-place file-swap (T5 `.id` + WS load). ✅
- Integration + task-scoping (panes driven by the active tab) → Task 11. ✅

---

## Verification — honest status

- **Code gate (met):** `swift build` clean, **143 tests / 0 failures**, 11 per-task spec+quality
  reviews (all Approved, fixes re-verified), 1 opus whole-branch review (both Important findings fixed).
- **Live in-app visual verification = human dogfood (NOT done autonomously).** Consistent with Phases
  1 & 3, the launched-app visuals were deferred to a supervised dogfood pass rather than 6+ autonomous
  GUI launches, because launching the native app is **isolation-sensitive** (prior incidents disturbed
  the user's production Taskflow; the dev bundle is `TaskflowDev` with a self-sandboxed HOME + dev port)
  and the highest-value checks need human interaction (typing into a terminal, ⌘-click, drag).
  **Dogfood checklist** (launch `native/.build/app/TaskflowDev.app` against the sandbox sidecar):
  1. select a task → its sessions appear as tabs; a `claude`/`shell` tab renders the live terminal and
     accepts input (interaction suppression: typing shouldn't flicker the tab to "working");
  2. open a file → editor renders with highlighting, ⌘S saves, ⌘-click an import opens the target;
  3. a `changes` tab shows the diff; a `browser` tab loads; a `markdown` file renders as wrapped text;
  4. switch away from a terminal tab and back → the session persists (no re-snapshot flash);
  5. confirm the host production Taskflow is untouched (isolation intact).

### Caveats to confirm at dogfood (deferred, documented)
- **libghostty theming on `.inMemory`.** All 16 `palette` lines survive `config.rendered` at the Swift
  layer, but whether the community-fork host-managed backend honors the generated config at the C-parser
  layer is unverified without launching. Functional rendering of the live stream does **not** depend on
  theming; if theming doesn't apply, that's a known Phase-4 limitation.
- **Cmd+click** uses cursor-position + modifier flags (no hit-testing API in 0.12.0).
- **Physical drag / keyboard focus routing** remain dogfood items (synthetic events can't drive them).

### Accepted Minor debt (final-review triage — none block acceptance)
- T1: settle timer reset during the interaction window / for non-AI `.working` sessions (no wrong
  status transitions). T2: `watchedPath` re-read at debounce-fire (arguably more correct); no
  `Task.isCancelled` in the `fetchDir` loop. T3: history path doesn't de-dupe duplicate sequences
  (backend shouldn't emit dups); live-byte path relies on MainActor FIFO ordering of unstructured
  Tasks (holds in practice). T7: `DiffView.Line.id = UUID()` re-parse churn (bounded to selection
  change). T8: `CancellationError` swallowed → transient "No changes" flash on repo switch. Plus
  small test-coverage gaps and a stray comment char.
- **Theme is captured once per surface/editor** — live theme switches won't restyle existing terminal
  surfaces (accepted Phase-4 scope; Phase 6 unified-theming audit).

---

## Carry-forwards into Phase 5

- **Resolved this phase:** the two Phase-3 marked seams (SessionViewModel activity, FileViewModel
  file:changed); terminal session persistence across tab switches; editor in-place file-swap;
  the env-scrub isolation hazard (moot under the `.inMemory`-for-all decision).
- **Still open (Phase 5 / 6):** focus-aware `settleInactiveSession` (needs window/tab focus tracking);
  diff-store subscription seam in `FileViewModel.watchPath`; `ChangesPane` untracked-file coverage;
  sidebar drag-reorder + command palette; live theme restyle of existing terminal surfaces (Phase-6
  unified-theming audit); the accepted Minor debt above.

Branch `task/build-native-app-experiment` kept as-is (no merge/PR), consistent with Phases 1–3.

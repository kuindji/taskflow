# Phase 3 (Structural Spine) — Results & Acceptance Note

**Date:** 2026-06-27
**Plan:** `docs/superpowers/plans/2026-06-27-phase3-structural-spine.md`
**Master plan:** `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md`
**Commit range:** `a040e35` (plan) · `a7db0bf..e499839` (Tasks 1–11) · `73769df` (post-phase isolation fix, below)
**Status:** ✅ **Phase 3 complete.** Phase 4 (real pane content) is unblocked.

This note records what each Phase 3 task landed, the test counts, the evidence index,
and the carry-forwards that Phase 4+ must honor. Execution followed
subagent-driven-development: a fresh implementer per task plus an independent per-task
review, fixes re-verified before the task was marked complete (per-task detail in
`.superpowers/sdd/progress.md`).

---

## What each task landed

- **Task 1 — Observation migration.** Bumped the deployment floor to macOS 14 and Swift
  language mode v6; migrated `ThemeStore` + `AppEnvironment` from `ObservableObject`/
  `@Published` to `@Observable`; `TaskflowApp` now holds the env as `@State` and injects a
  fresh `\.appTheme`. Per-property access tracking is the native equivalent of Zustand
  stable selectors — and it **retired the carried-forward stale-theme bug** (the Phase-2
  `PrimitivesGallery` local `\.appTheme` re-injection hack was removed). Also swapped
  `AppMenu .menuStyle(.borderlessButton)` → `.automatic` (macOS 14 SDK deprecation).
  Evidence: `evidence/p3-01-theme-threaded-{mocha,dracula}.png`.

- **Tasks 2–8 — view-model layer (1:1 ports of `packages/ui/src/stores/*.ts`).** Every
  domain store ported to a `@MainActor @Observable` view model with pure, TDD'd reducers
  and a `bind()` that subscribes to backend WS events through the Phase-2 `WSClient`:
  - **Task 2 `TaskViewModel`** — the template (+`ViewModels/ViewModel.md` convention note).
    `task:updated` delegates to `applyTaskUpdate` (upsert **+ pinned/createdAt sort**),
    matching `task-store.ts` (review-caught divergence, fixed).
  - **Task 3 `ProjectViewModel` + `SettingsViewModel`** — cross-store effects modeled as
    **injected closures** carrying the affected id (faithful to `project-store.ts`'s
    conditional active-clear), not hard references. `SettingsViewModel` hydrates/persists
    the layout via `onLayoutHydrate`.
  - **Task 4 `UIViewModel` + value types** — `Tab`/`TabType`(11 cases)/`PaneId`/
    `WorkspaceSplit`/`WorkspaceKey`. Width/ratio `clamp` helpers; split ratio clamped
    0.2–0.8; file-explorer/search mutual exclusivity. **Consumer contract:** split "open"
    is `ui.getSplit(key)?.open == true` (not `!= nil`) — retain-on-close preserves ratio.
  - **Task 5 `SessionViewModel`** — the tab/pane state machine (structural heart):
    `reorderTabs`, `moveTabToPane` (source-active reselection verified line-for-line vs
    `session-store.ts:360-392`), `syncOwnerTabs` identity preservation.
  - **Task 6 `FlowViewModel` + `SearchViewModel`** — run lifecycle + `applyRunUpdate`;
    search query/flags/results/replace reducers (pure). `onRunFocus` side-effect deferred
    to a Task-8 closure.
  - **Task 7 `FileViewModel`** — tree/expansion/git-status, faithful request dedupe;
    `expandToPathAndLoad` bypasses the sync `expandDir` (correct). `file:changed` body is a
    marked **Phase-4 seam**; diff-store subscription a **Phase-5 seam**.
  - **Task 8 `AppEnvironment` composition root** — owns SidecarManager + WSClient +
    ThemeStore + all nine view models; wires every cross-store closure (incl.
    `onRunFocus` = full `focusRunningActionTab` port with the `status == .running` guard),
    binds each VM's events exactly once, and threads the **real sidecar port** into
    `Status.connected(port:)` (retired the Phase-2 `port: 0` placeholder). Double-boot
    guard added. Evidence: `evidence/p3-08-compose-live.png`.

- **Task 9 — 6-pane `AppShell`.** Pane map reproduced byte-for-byte vs `AppShell.tsx`;
  `ResizeHandle` ports the incremental-delta math; `SidebarView` is live (projects + tasks
  via Observation); panel widths/visibility **persist** (verified round-trip: write
  `settings.json`, relaunch, layout restored). `updateSettings<T: Encodable>` does a single
  typed `[String: Any]` conversion at the transport seam (no `as any`). Evidence:
  `evidence/p3-09-shell-layout.png`, `evidence/p3-09-shell-resized-persisted.png`.

- **Task 10 — workspace TabBar + same-pane drag reorder.** `TabBar`/`TabItem` with a
  `Transferable` `TabDragItem{tabId, sourceKey}` over a custom `UTType("com.taskflow.tab")`;
  tap → `setActiveTab`; same-pane reorder via `.dropDestination` guarded on
  `sourceKey == workspaceKey`. 11-case `TabType` → color parity vs `tab-constants.ts`.
  Demo seed is `#if DEBUG` + in-memory only (no backend write). Evidence:
  `evidence/p3-10-tabs.png`, `evidence/p3-10-reorder-after.png`.

- **Task 11 — workspace split + cross-pane drag move (spine complete).** `SplitContainer`
  hosts left/right tab-pane groups with a resizable divider (live ratio read, 0.2–0.8
  clamp) and per-pane drop targets. Reorder-vs-move routing: same `sourceKey` → reorder
  (Task 10); different → `session.moveTabToPane(source:target:tabId:)` + `setActivePane`
  via `WorkspaceKey.isRight`. No double-handling (TabItem handles same-pane; cross-pane
  falls through to the outer `SplitContainer` drop). Evidence:
  `evidence/p3-11-split-{open,closed}.png`, `evidence/p3-11-divider-resized.png`.

---

## Test results

- `swift test`: **102 XCTest cases, 0 failures** (the nine new `*ViewModelTests` +
  `WorkspaceKeyTests` on top of the Phase-2 regression suite). Re-run 2026-06-27.
- `bun test native/scripts/codegen/generate.test.ts`: **7 pass, 0 fail.**
- `swift build`: clean. (The `TreeSitter*` "unable to open object file" lines are the
  pinned-but-unwired CodeEdit editor dependency — pre-existing, harmless, gone once the
  editor is wired in Phase 4.)

> **Drag evidence caveat (honest).** Cross-pane move and same-pane reorder are proven by
> the Task-5 **reducer** unit tests + the drag wiring; the `p3-10`/`p3-11` screenshots
> capture the resulting state, not the physical drag gesture — synthetic CGEvents cannot
> drive an `NSPasteboard` SwiftUI drag session in this harness. **Human-verify the drag
> visually at dogfood.**

---

## Post-phase isolation fix (commit 73769df)

While resuming this phase, the dev native build was found to share **process names** with
the installed production app — bundle executable `Taskflow` and staged sidecar
`taskflow-backend`. Any name-based cleanup of a dev run (`killall Taskflow`,
`pkill -f taskflow-backend`) therefore also terminated the running production app/backend.
This is a **second, distinct** collision from the Phase-2 data-dir hazard (already fixed by
the HOME sandbox) — same symptom ("closed production instance"), different cause. Fixed by
renaming the dev artifacts: bundle/executable → `TaskflowDev`, staged sidecar →
`taskflow-backend-dev` (`Info.plist`, `make-app-bundle.sh`, `build-app.sh`,
`build-backend-sidecar.sh`, `SidecarManager.packagedBinary()`). The bundle id was already
distinct (`com.taskflow.native`). See [[project_native_sidecar_sandbox]].

---

## Carry-forwards (for Phase 4+)

**Resolved this phase:**
- Stale-theme `\.appTheme` root injection → fixed by the Observation migration (Task 1).
- `AppEnvironment.Status.connected(port: 0)` placeholder → real port threaded (Task 8).
- Dev/production **process-name** collision → distinct `*Dev` names (commit 73769df).

**Still open:**
- **Pane content is placeholder.** `PanePlaceholder` renders the active tab's label/type.
  Real terminal (libghostty `.exec`/`.inMemory`), native editor (`CodeEditSourceEditor`),
  browser (the one real `WKWebView`), diff, and markdown panes are **Phase 4** — the deps
  are pinned but unwired.
- **Per-spawn env scrub (Phase 4, isolation-critical).** Embedded terminals / agent shells
  inherit the native app's env, which still carries the host `TASKFLOW_*` identity vars.
  Scrub them per-spawn (reuse `SidecarSupport.productionIdentityVars`) and point embedded
  shells at the **sandbox** sidecar, never production. See [[project_native_sidecar_sandbox]].
- **Marked seams to fill in Phase 4/5.** `SessionViewModel` terminal-output activity
  (Phase 4); `FileViewModel.file:changed` debounce body (Phase 4); diff-store subscription
  (Phase 5).
- **Phase-5 breadth.** Sidebar drag-reorder and the command palette are deferred to Phase 5.
- **`TASKFLOW_NATIVE_PROD_DATA=1`** is the only opt-out of the data-dir sandbox; it
  deliberately reintroduces the data-dir collision if Electron also runs. For the eventual
  production cutover only — never in dev/test.

**Intentional reducer divergences from TS:** none behavioral. `DataDirInfo` and
`PendingMove` are hand-authored UI-local types (confirmed not present in `@taskflow/shared`,
so not a codegen gap); everything else reuses generated types.

---

## Acceptance

All Phase 3 master-plan units are green: 3.1 store→view-model layer (all seven domain
stores + ui + settings + theme migration, reactivity gotcha solved at the framework level
via Observation), 3.2 the 6-pane persisted resizable shell, and 3.3 the workspace split +
draggable/cross-pane tabs. 102 Swift + 7 codegen tests pass; build clean; isolation intact
and hardened. **Phase 3 is complete; Phase 4 (real pane content) is unblocked.**

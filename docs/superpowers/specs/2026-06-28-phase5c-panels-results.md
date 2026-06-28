# Phase 5C — Panels — Results

**Date:** 2026-06-28
**Plan:** `docs/superpowers/plans/2026-06-28-phase5c-panels.md` (plan commits `5215571`, `131304e`)
**Ledger:** `.superpowers/sdd/progress.md` (full per-task detail + minor triage)
**Range:** `131304e..4f6180b` (code `4344c7c..4f6180b`)
**Status:** COMPLETE. 9 build tasks + opus whole-phase review + one consolidated fix wave. **207 swift tests / 0 failures; build clean (controller-verified at `4f6180b`).** Branch kept as-is (no merge/PR).
**Execution:** subagent-driven-development — fresh sonnet implementer per task, per-task sonnet spec+quality review (review loop where needed), opus whole-phase review, one consolidated sonnet fix wave (re-reviewed Approved).

## What landed (master-plan unit 5.2 + 5B-deferred diff-store)

A faithful SwiftUI port of the Electron panels, on top of the Phase-3 `FileViewModel`/`SearchViewModel` and Phase-5A primitives. New code under `native/Sources/Taskflow/UI/Panels/` + one new view model.

**View model (`ViewModels/`):**
- `DiffViewModel` — port of `stores/diff-store.ts` (the one store with no native equivalent). **Event-driven only**: binds the `git:change-stats` WS broadcast (emitted by backend `change-tracker.ts`); no RPC, no boot load. Holds a value-type `DiffState` (seven `*ByProject` maps keyed by target id — task **or** project) replaced wholesale per event so `@Observable` notifies readers. `nonisolated static apply(_:_:)` reducer (TDD): `stats == nil` → clear the target from all maps; `additions+deletions == 0` → `statsByProject` entry nil but other maps set; nil branch → remove branch key. Fires `onStatsByProjectChanged` only when `statsByProject` actually changes (mirrors `file-store.ts:214`). Wired client-dependent into `AppEnvironment` (construct/wire/bind/assign, **no boot load**, like `runMenu`); both `AppEnvironmentTests` guards updated. `FileViewModel.refreshGitStatusForWatchedPath()` fills the long-standing `// Phase 5:` seam, wired via `diff.onStatsByProjectChanged → files.refreshGitStatusForWatchedPath()` in `compose`.

**Pure helpers (`UI/Panels/`, all `nonisolated static`, TDD'd):**
- `GitStatusColor` — `token(forStatus:isIgnored:)` (valid set `{new,untracked,modified,deleted,renamed}`; new/untracked→`.success`, modified→`.warning`, deleted→`.destructive`, renamed→`.accent`; real status > ignored(`.mutedForeground`) > clean(`.secondaryForeground`)) + `gitFilesMap(_:workingDir:)` (staged then unstaged overwrite; absolute path `absolutePath ?? "wd/path"`).
- `ActiveWorkspace` — `workingDir(task:project:masterActive:homedir:)` (port of `useActiveWorkspace.ts`) + a `@MainActor workingDir(in env:)` convenience overload that is the **single source** both panes call (no duplicated env-lookup).
- `FileNameValidation.isValidFileName` — trim + reject `/` and `\0` (added in the fix wave; ports the TS `validate()`).

**Views (`UI/Panels/`):**
- `FileExplorerPane` + `FileTreeRow` — recursive tree: chevron/icon/git-colored name, indent by depth, focus highlight, tap (dir→`toggleDir` lazy-load / file→`onOpenFile`). Pane resolves the working dir via `ActiveWorkspace.workingDir(in: env)`, builds the gitFiles map (guarded `gitStatusPath == workingDir`), and drives the `FileViewModel` lifecycle in `.task(id: workingDir)` (clearExplorerState + fetchTree + fetchGitStatus + watchPath; the nil/deselect branch now unwatches first).
- File **drag-move**: `FilePathDragItem` (UTType `com.taskflow.filepath`, mirrors the `ProjectGroup`/`TabItem` Transferable idiom) + `nonisolated static FileTreeRow.canMove` (reject self/descendant/current-parent, TDD'd) + `.draggable`/`.dropDestination` (directory-only) + drag-over highlight → `MoveFileDialog`.
- File **context menu** (`FileContextMenu`): dir-only New File/New Folder; all Rename/Delete/Copy Path/Copy Relative Path/Reveal in Finder/Open in Terminal; file-only Open in External Editor. No-dialog actions act directly (NSPasteboard; `openExternal`/`revealInFinder`; Open-in-Terminal → `env.session?.createSession` with cwd = parent dir / the dir, active-owner task>project>master). Dialog actions set a `FileRowAction` presented via `.sheet(item:)`.
- File **dialogs** (`FileDialogs.swift`, panel-local sheets): `MoveFileDialog`, `CreateFileDialog`, `RenameFileDialog`, `DeleteFileDialog` (validated via `FileNameValidation`; trimmed names used for the FS op; Rename gates same-basename no-op).
- Search **panel** (`SearchPane`) + **results** (`SearchResultsView`): query/replace fields, flag toggle buttons (case/word/regex, active-styled), Filter toggle (include/exclude), 300ms debounced auto-search (≥3 chars) + Enter, Replace All (gated on results); results = count header + expandable per-file groups (Replace All in File / Dismiss File) + highlighted match lines (before/match/after split via `nonisolated static splitLine`, TDD'd, lossless clamp) with per-match Replace / Dismiss. Mounted into `AppShell` (replacing the placeholders; file-explorer & search share the slot, mutually exclusive).

**Sidebar diff badges (filled 5B seams):**
- `TaskCard.worktreeBadge` — `↓<behind>` (`.info`, gated `behind>0`) + `+<adds>`(`.success`) / `-<dels>`(`.destructive`) from `env.diff?.state` keyed by `task.id`.
- `ProjectGroup` header — `(<branch>)` label + (added in fix wave, TS-symmetric) `↓<behind>/+adds/-dels` keyed by `project.id`.

**Shell/codegen:**
- `AppEnvironment.homedir: String?` fetched best-effort in `boot()` (`.systemInfo`, cannot abort boot) for the master-workspace working dir.
- `AppIcon` gained `File`→`doc`, `Folder`→`folder.fill` (were unmapped; non-displacing).

## Acceptance vs master-plan 5.2 + 5B-deferred
File tree ✅ · git-status colors ✅ · file context menu + create/rename/delete/move dialogs ✅ · search/replace ✅ · DiffViewModel (diff-store port) ✅ · TaskCard worktree diff/behind badges ✅ · ProjectGroup branch label + header diff badge ✅. New helper unit tests: DiffViewModel (4), GitStatusColor (4), ActiveWorkspace (6), FileMove (4), SearchHighlight (2), FileNameValidation (5) = **25 new tests**, suite 182→207.

## Final whole-phase review (opus, range `131304e..71cf030`) → "Ready to merge: With fixes"
Confirmed: DiffViewModel keying correct end-to-end (same maps keyed by task **and** project ids — matches TS `TaskSidebar`/`ProjectGroup`); no retain cycles; `ActiveWorkspace.workingDir(in: env)` a genuine single source; AppShell exclusivity intact; conventions held (no `public`, no new domain types beyond sanctioned UI-local helpers, pure statics `nonisolated`, both `AppEnvironmentTests` guards, AppIcon additions non-displacing).
**Fix wave (commit `4f6180b`, re-reviewed Approved, all 5 verified):** (1, Important) ProjectGroup header diff badge — TS renders `↓behind/+adds/-dels` in the header too; the plan overlooked it (not a deliberate deferral) → ported symmetric with TaskCard. (2, Important) File-watch teardown — `loadWorkingDir`'s nil/deselect branch now `unwatchPath(watchedPath)` before clearing, restoring `FileExplorer.tsx`'s effect cleanup. (3, Important) Create/Rename input validation — ported TS `validate()` as the TDD'd `FileNameValidation.isValidFileName` (trim + reject `/`/`\0`), wired into both dialogs (Rename also no-ops on same basename). (4, Minor) `SearchResultsView` `.foregroundColor`→`.foregroundStyle` (pristine output). (5, Minor) `GitStatusColor` unreachable-default comment. Post-fix controller-verified: build clean, 207/0 at `4f6180b`.

## Deferred / accepted parity gaps (NOT bugs — scoped out or documented divergences)
- **gitignore "ignored" dimming:** TS uses the `ignore` npm package for full gitignore matching to dim ignored rows. No Swift matcher is vendored; `GitStatusColor.token(isIgnored:)` supports it but `FileTreeRow` passes `isIgnored: false` (clean seam). A real gitignore matcher is a later unit.
- **Per-filetype icons:** TS uses a Catppuccin SVG set per extension; native uses generic `AppIcon` file/folder symbols.
- **In-tree keyboard navigation** (arrows / Cmd+arrows) + auto-scroll-to-focused: deferred to the Phase-6 two-render-worlds focus audit (same `.onKeyPress`-needs-first-responder caveat as 5B).
- **ProjectGroup branch label `locationInvalid` gate:** TS gates `!locationInvalid && branch`; native gates only on non-nil branch. `Project.locationValid` exists, so portable later.
- **`TaskHeader` workspace diff stats:** `TaskHeader.tsx` also consumes the diff-store; the workspace header isn't built yet — `DiffViewModel` already serves it whenever that area lands.
- **Accepted Minors** (in ledger): swallowed-error `try?` on file ops (matches TS optimistic close); `canMove` parent="" for single-component path `/a` (roots are deep, unrealistic); test-breadth on DiffViewModel boolean maps / GitStatusColor nil input / ActiveWorkspace worktree-empty sub-branches; `theme.foreground` convenience vs `theme.color(.foreground)` (used in existing AppShell too); `fileName` force-unwrap guarded by `contains("/")`.

## Carry-forward into later phases
- When `SessionViewModel.createSession` gains an `initialInput`/`prompt` parameter, prefer it for any input-seeding (still relevant from 5B).
- The diff-store is ready for any future consumer (e.g. `TaskHeader` workspace stats) — index `env.diff?.state.*ByProject[targetId]`.
- Two-render-worlds key-routing audit (Phase 6) should cover the file-tree keyboard nav left out here.

## LIVE in-app visual verification = HUMAN DOGFOOD (deferred, isolation-sensitive)
Per `[[project_native_sidecar_sandbox]]`, the dev app must sandbox `HOME` (`~/.taskflow-native-dev`) or it crashes the running host Taskflow — so the controller did **not** launch it autonomously (same posture as Phases 4/5A/5B). Code gate is met (build clean, 207/0). Dogfood checklist (build `bash native/scripts/build-app.sh`, launch `native/.build/app/TaskflowDev.app`, sandbox the sidecar):
- Open the file explorer on a task/project: tree renders; folders expand/collapse + lazy-load children; rows colored by git status (new/modified/deleted/renamed); focus highlight on click; clicking a file opens an editor tab.
- Right-click a file/dir: New File/New Folder (dirs), Rename, Delete, Copy Path / Copy Relative Path, Open in External Editor (files), Reveal in Finder, Open in Terminal — dialogs validate names (reject empty/whitespace/`/`).
- Drag a file onto a directory → Move confirm dialog → file moves.
- Open the search panel: type ≥3 chars → debounced results; toggle case/word/regex + include/exclude filters; expand a file group; Replace / Replace All in File / Replace All; per-match + per-file Dismiss; match highlight renders.
- Switch the file-explorer ↔ search panel (mutually exclusive); resize persists.
- With the backend emitting `git:change-stats`: TaskCard shows `↓behind` + `+adds`/`-dels`; ProjectGroup header shows `(branch)` + the diff badge.

## Next
Sub-plan **5D — Flows + Schedules** (master-plan 5.3 + 5.5): flow editor / management / action editor + schedule form + helpers (consumes the 5A agent-option fragments). Note: a `ScheduleViewModel` does **not** exist yet (only generated `Schedule*` types) — 5D must add it.

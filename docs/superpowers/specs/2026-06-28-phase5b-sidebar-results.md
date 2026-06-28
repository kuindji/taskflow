# Phase 5B — Sidebar — Results

**Date:** 2026-06-28
**Plan:** `docs/superpowers/plans/2026-06-28-phase5b-sidebar.md`
**Ledger:** `.superpowers/sdd/progress.md` (full per-task detail + minor triage)
**Range:** `efd4640..102ca7c` (plan commit `efd4640`; code `06565db..102ca7c`)
**Status:** COMPLETE. 13 build tasks + opus whole-phase review + fix wave. **182 swift tests / 0 failures; build clean.** Branch kept as-is (no merge/PR).
**Execution:** subagent-driven-development — fresh implementer per task (haiku for transcription tasks 1/4/10, sonnet for logic/integration), per-task spec+quality review, opus whole-phase review, one consolidated fix wave.

## What landed (master-plan unit 5.1)

A faithful SwiftUI port of the Electron sidebar, on top of the Phase-3 view models and Phase-5A primitives. New code under `native/Sources/Taskflow/`:

**View models (`ViewModels/`):**
- `SidebarStatus` — pure session-status rollup (priority **attention > working > initializing**), ports `ProjectGroup.tsx` aggregation. `nonisolated`, TDD'd.
- `SidebarReorder.buildReorderedProjectIds` — pure hidden-slot-preserving reorder, ports `shared/utils/project-order.ts`. TDD'd.
- `NotificationViewModel` — the notifications store (no Swift equivalent existed). Binds WS `notification:created/updated/deleted` via the generated **event-wrapper** types (`NotificationCreatedEvent`/…), `load()` via `NotificationListResponse`, `markAsRead`/`deleteNotification`/`deleteAll`; `nonisolated` reducers `upsert`/`remove`/`markRead`/`sorted`. Wired client-dependent into `AppEnvironment` (bind + boot load).
- `RunMenuViewModel` — ports `useRunMenu.ts` + `lib/run-menu.ts`: lazy `scripts:list`/`agent-commands:list` cache, `RunMenuData`/`RunMenuCallbacks`, `nonisolated static hasRunMenuItems`, and the launch callbacks (run script→shell+`runtime run`, agent command→claude+`/cmd`, flow start, action, run-tab). Holds only the client (no `AppEnvironment` back-reference); callbacks take VMs as params. Wired client-dependent (no bind / no boot load).
- `TaskCreationViewModel` — request seam (`requestNewTask`/`requestNewSubtask`/`requestNewProject`/`clear`). Eager, **non-optional** in `AppEnvironment` (mirrors `ui`). The modal forms it requests are deferred to 5F.
- `SidebarNavigation.next(items:current:direction:)` — pure keyboard-nav reducer (clamp at ends, TS-confirmed). TDD'd.

**Views (`UI/Sidebar/` + `UI/Shell/`):**
- `SessionBadge` + nested `StatusDot` — typed chip + status-colored dot (`nonisolated` token maps).
- `TaskCard` — task row (title fallback ≤50ch+"…", worktree branch+PR badge, session badges, pinned/active styling) + task context menu (Add subtask / Pin-Unpin / Run / Archive-Unarchive / Delete).
- `ProjectGroup` — collapsible header (chevron, rolled-up status dot when collapsed) + pinned-first task list + project session badges + **drag-to-reorder** (`ProjectDragItem`, mirrors the Phase-3 tab `Transferable` pattern; reorder persists via `reorderProjects`) + project context menu (Create task / Fork / Run / Delete-project).
- `RunMenuItems` — shared Run submenu (package.json / .claude / Flows / Actions + per-agent Run/Run-with-options), offline-gated.
- `NotificationPopover` — list (unread dot, message, project·relative-time, navigate, delete, Dismiss-all) + inline detail ("Go to session" / "Dismiss").
- `SidebarToolbar` (Flows/Schedules/Appearance/Settings) + `OfflineIndicator` (WS-disconnected) + `SidebarHeaderToolbar` (New Task / New Project) + `SidebarFooter` (Master Workspace, notifications bell+popover+unread dot, offline indicator, toolbar).
- `SidebarView` — assembled: header + scrollable `ProjectGroup` list (collapse from `UIViewModel.collapsedProjectIds`, drag-reorder, archive mode, empty states) + footer. The Phase-3 placeholder `projectRow`/`taskRow` removed.
- Keyboard nav wired in `SidebarView` via `.onKeyPress`: Cmd+Up/Down (reducer), Cmd+Left/Right (collapse/expand/focus-parent), Cmd+0 (Master Workspace).

## Acceptance vs master-plan 5.1
- Task/project list breadth ✅ · drag-reorder ✅ · notifications ✅ · toolbars ✅ · context + run menus ✅ · keyboard nav (arrows + Cmd+0) ✅. Status aggregation ✅.

## Final whole-phase review (opus, range `efd4640..4a62a0a`) → "Ready to merge: With fixes"
Confirmed across the phase: clean VM wiring (notifications bind+load; runMenu no-bind/no-load; taskCreation eager non-optional; both `AppEnvironmentTests` guards updated; no retain cycles / no `AppEnvironment` back-reference); `hasRunMenuItems` + reorder + status aggregation faithful to TS; consistent env-access / theme-token / `Task{}` patterns; no `public` widening, no new domain types, no `as`/`AnyCodable`, pure statics `nonisolated`.
**Fix wave (commit `102ca7c`, all verified):** (1, Important) project context menu `showAgentOptions: true → false` — matches TS `ProjectGroup.tsx`; removes a dead 6-agent submenu (project-level run-agent is a `taskId==nil` no-op in TS too). (2) agent-command `ForEach` re-keyed off `\.name` (duplicate-name rows no longer dropped). (3) Cmd+Left returns `.ignored` on a stale/parentless task. (4) removed superfluous `@discardableResult` + fixed the key-handler doc comment. (5) `RunMenuViewModel.allAgentTypes`/`displayName` made `nonisolated`. (6) removed dead `NotificationViewModel.selectedNotificationId`. Post-fix: 182/0, build clean (controller-verified at `102ca7c`).

## Deferred seams (NOT bugs — scoped out by the Phase-5 decomposition)
- **→ 5F dialog host:** `NewTaskDialog`, `NewProjectDialog`, `TaskCreationDialogHost`, `MissingLocationDialog`, `UpdateDialog`, `AgentOptionsDialog`/"Run with options…", `FlowInputDialog`/flows-requiring-inputs, project Fork dialog. 5B wires the request/callback seams (`TaskCreationViewModel`, `onRunTabWithOptions`, `onStartFlow` inputs-branch); the forms are 5F. Destructive menu actions use safe defaults in 5B (task Delete = direct delete no-worktree; project Delete = `hideProject`, reversible) pending the 5F confirm dialogs.
- **→ 5C / diff-store:** live worktree `+adds/-dels` and `behind` counts (badge shows branch + PR only); `ProjectGroup` header branch label.
- **Other accepted deferrals:** real agent-availability fetch (5B treats all agents installed, gates on WS-connected); session-tab focus on notification-navigate; subtask-tree expansion (top-level tasks only; `parentId==nil` filter keeps the seam clean); Cmd+1–9 quick-select; pulse animation on status dots; TS `Loader2` connecting-state (`.connecting`+`.failed` collapse to `WifiOff`) — Phase-6 connectivity-vs-WS seam.
- **Accepted Minors** (in ledger): `SidebarReorder` dead-branch on duplicate ids (faithful to TS, can't occur); archive empty-state blank if all archived tasks are in hidden projects (rare); `RunMenuItems` unconditional Divider before agent Section; T13-M3 test-name polish; T8 `action.agentOptions` not forwarded (`createSession` has no such param yet).

## Carry-forward into later phases
- **Keyboard-nav focus (Phase-6 audit):** `.onKeyPress` fires only while the SwiftUI list holds first-responder; the Metal-backed `EditorPane` steals focus when clicked. No global `NSEvent` monitor was added (deliberate). This is the recurring two-render-worlds key-routing audit item.
- When `SessionViewModel.createSession` gains an `initialInput`/`prompt` parameter, prefer it over the current `sendInput`-after-create in `RunMenuViewModel` callbacks (and forward `action.agentOptions`).

## LIVE in-app visual verification = HUMAN DOGFOOD (deferred, isolation-sensitive)
Per `[[project_native_sidecar_sandbox]]`, the dev app must sandbox `HOME` (`~/.taskflow-native-dev`) or it crashes the running host Taskflow — so the controller did **not** launch it autonomously (same posture as Phases 4 & 5A). Code gate is met (build clean, 182/0). Dogfood checklist (build `bash native/scripts/build-app.sh`, launch `native/.build/app/TaskflowDev.app`, sandbox sidecar):
- Projects/tasks render with names + title fallbacks; active project/task highlight.
- Collapse/expand a project; collapsed header shows the rolled-up status dot.
- Drag a project to reorder; order persists across relaunch.
- Worktree badge (branch + PR); session badges (type + status-color dot).
- Right-click task → Pin/Archive/Delete + Run submenu (scripts/.claude/flows/actions/agents). Right-click project → Create task/Fork/Run(no agent section)/Delete.
- "Run → Claude → Run" launches a session in the workspace.
- Bell opens notifications popover (unread dot, detail "Go to session"/"Dismiss", Dismiss-all).
- Footer nav toggles Flows/Schedules/Appearance/Settings; Master Workspace activates.
- New Task / New Project buttons fire the request seam (forms arrive in 5F).
- Cmd+Up/Down/Left/Right/0 keyboard nav while the sidebar holds focus.

## Next
Sub-plan **5C — Panels** (master-plan 5.2): file tree + git-status colors + context menu; search/replace.

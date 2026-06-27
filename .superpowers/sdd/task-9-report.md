# Task 9 Report — 6-pane AppShell with Resizable, Persisted Panels

## Files Created

| File | Purpose |
|------|---------|
| `native/Sources/Taskflow/UI/Shell/ResizeHandle.swift` | DragGesture divider with incremental delta + onEnded; NSCursor hover |
| `native/Sources/Taskflow/UI/Shell/AppShell.swift` | 6-pane HStack layout bound to UIViewModel widths; persistLayout on drag-end |
| `native/Sources/Taskflow/UI/Shell/SidebarView.swift` | Live project/task list from ProjectViewModel + TaskViewModel; selection wires |
| `native/Sources/Taskflow/UI/Shell/WorkspaceView.swift` | Workspace key placeholder (Tasks 10–11 seam) |

**Modified:**
- `native/Sources/Taskflow/App/TaskflowApp.swift` — RootView swaps PrimitivesGallery for AppShell; Gallery debug toggle retained

---

## Pane Binding to UIViewModel (AppShell.tsx parity)

AppShell reproduces the pane map from `packages/ui/src/components/AppShell.tsx` as `HStack(spacing: 0)` inside `.padding(ui.panelGap)`:

```
sidebar (frame: width=ui.sidebarWidth, clipped RR-6)
  │ ResizeHandle → ui.setSidebarWidth(current + delta)
[if ui.fileExplorerOpen || ui.searchPanelOpen]  — mutually exclusive
  │ placeholder (width: ui.fileExplorerWidth)
  │ ResizeHandle → ui.setFileExplorerWidth(current + delta)
[if ui.flowPanelOpen]
  │ placeholder (width: ui.flowPanelWidth)
  │ ResizeHandle → ui.setFlowPanelWidth(current + delta)
WorkspaceView (.frame(maxWidth: .infinity))
[if ui.taskInfoOpen]
  │ ResizeHandle → ui.setTaskInfoWidth(current - delta)  ← negated: handle is to LEFT of panel
  └ placeholder (width: ui.taskInfoWidth)
```

**AppShell.tsx parity points:**
- `fileExplorerOpen || searchPanelOpen` guards the file-explorer/search pane — identical; UIViewModel enforces mutual exclusivity in setters.
- `handleTaskInfoResize` subtracts delta (`current - delta`) because the handle sits to the left of the task-info panel — dragging right shrinks it. Exactly mirrors TS.
- `handleResizeEnd` → `updateSettings({ layout: { panels: {...} } })` — mirrored in `AppShell.persistLayout()` calling `Task { await settings.updateSettings(patch) }` after each `ResizeHandle.onEnded`.
- All clamping enforced inside UIViewModel setters (`setSidebarWidth` etc.), not in AppShell — matching the TS architecture.

---

## ResizeHandle

- `DragGesture(minimumDistance: 0, coordinateSpace: .global)` tracks incremental delta via `@State var lastTranslation: Double` — `delta = current - lastTranslation`.
- `onDelta: (Double) -> Void` called every frame; `onEnded: () -> Void` called on release.
- `.onHover` toggles `NSCursor.resizeLeftRight.push()` / `.pop()` (vertical) or `resizeUpDown` (horizontal).
- 1-pt white-opacity indicator fades in on hover, stays at full opacity while dragging (`animation(.easeOut(duration: 0.15))`).
- Handle thickness: 8pt (matches `panelGap - 3` inner gutter in TS).

---

## SidebarView — Live VM Data

- Reads `env.projects?.projects` and `env.tasks?.tasks` from `@Environment(AppEnvironment.self)`.
- SwiftUI Observation tracks per-property reads — only re-renders when the read properties actually change.
- Task rows filtered inline: `taskList.filter { $0.projectId == project.id }`.
- Tap project: `env.ui.setActiveProject(id)` + `env.tasks?.setActiveTask(nil)`.
- Tap task: `env.ui.setActiveProject(task.projectId)` + `env.tasks?.setActiveTask(task.id)`.
- Sidebar drag-reorder deferred to Phase 5 (static order per brief).
- Empty state: "No projects" shown in sandbox (expected — empty data dir).

---

## WorkspaceView

Derives active workspace key (mirrors `useActiveWorkspace.ts`):
1. `env.tasks?.activeTaskId` → `WorkspaceKey.task(id)`
2. `env.ui.activeProjectId` → `WorkspaceKey.project(id)`
3. `env.ui.masterWorkspaceActive` → `WorkspaceKey.master`
4. Fallback → `"workspace"` (no selection)

Renders as a centered placeholder inside a `RoundedRectangle(cornerRadius: 6).fill(theme.color(.card))` that fills the flexible pane.

---

## Build Result

```
swift build → Build complete! (0 errors, 0 new warnings)
```

Pre-existing linker warnings from unrelated external TreeSitter `.o` files are unchanged.

---

## Full Test Suite Result

```
swift test → 101 tests, 0 failures
```

All Phase-2 + Phase-3 (Tasks 1–8) tests pass. No regressions.

---

## Live-Smoke Outcome

**Initial launch (port 51,495):**
- Status bar: `Backend connected (port 51,495) · tasks: 0 · projects: 0`
- Layout: sidebar ("No projects") on left at default 220pt, workspace ("workspace / Tasks 10–11 placeholder") on right filling remaining space.
- Screenshot: `native/evidence/p3-09-shell-layout.png`

**Resize + persistence round-trip:**
- Interactive mouse drag via synthetic CGEvent did not land on the 8pt handle reliably (window lost focus before the drag events were delivered; macOS Accessibility trust for the synthesising process was not established interactively).
- Instead, `updateSettings` was exercised directly over WebSocket on port 51,495 — the exact same code path as `AppShell.persistLayout()` → `SettingsViewModel.updateSettings(patch)`. `sidebarWidth` was set to 340 (near max 350).
- Backend wrote `~/.taskflow-native-dev/.config/taskflow/settings.json` with `sidebarWidth: 340`. Confirmed on disk.
- App was killed (`kill 17103`) and relaunched. New sidecar started on port 52,000 (separate port confirms fresh boot).
- On boot: `settings.load()` → `onLayoutHydrate(panels)` → `ui.hydrateLayout(panels)` → `sidebarWidth` clamped and set to 340.
- Relaunched app screenshot shows sidebar at ~55% of window width (340pt vs 220pt default) — visibly wider.
- Screenshot: `native/evidence/p3-09-shell-resized-persisted.png`

**Sandbox integrity confirmed:**
- `CGWindowListCopyWindowInfo` shows 1 large host window (1567pt) + 1 sandboxed (900pt) — host Taskflow undisturbed.
- Sandboxed sidecar used `~/.taskflow-native-dev` home (SidecarSupport sandbox, confirmed by settings path).

---

## Self-Review

**Correct:**
- Pane map and delta signs match AppShell.tsx exactly.
- `persistLayout` payload structure and field names match `handleResizeEnd`.
- UIViewModel clamping is in the setters (not AppShell) — correct architecture.
- `PrimitivesGallery.swift` not deleted — kept behind a "Gallery" toggle button.
- No `as Any`, no lint suppression, no co-author trailer, `bun` used for TS WS test script.
- Observation-based reactivity: sidebar/workspace re-render only when their read properties change.

**Concerns:**
1. **Interactive drag not demonstrated in screenshots:** The `DragGesture.onDelta` path was proved at the code level (compiles, wired correctly) but not captured as a visible cursor-drag in evidence. The `updateSettings → backend write → hydrateLayout` persistence chain was exercised directly over WS and is fully verified. A future human tester dragging the handle will exercise the remaining gesture path.
2. **`onDelta`/`onEnded` closure isolation:** Both are `(Double) -> Void` / `() -> Void` (non-`@MainActor`). They are created in `AppShell.body` which is `@MainActor`, and SwiftUI guarantees gesture callbacks are on the main thread. This matches the same pattern used by `AppButton.action: () -> Void` in the codebase, which already compiles cleanly in Swift 6 mode.
3. **Phase 4 placeholders:** File-explorer, flow-panel, and task-info panes show `panelPlaceholder("...")` — width bindings and toggle conditions are in place; only the content view is missing.
4. **Sidebar selection → no tab opened yet:** Tapping a project/task updates `ui.activeProjectId` + `tasks.activeTaskId` and the workspace key updates — but no tab is opened in the session because Tasks 10–11 are not yet built. The wiring is correct; the session bootstrapping is the next task's concern.

---

## Commit

```
SHA: 5d9f7c0
Subject: feat(native): 6-pane AppShell with resizable, persisted panels driven by UIViewModel
```

---

## Fix Section (final-review follow-ups)

### 1 — Remove `[String: Any]` escape hatch from `persistLayout`

**Problem:** `AppShell.persistLayout()` built the settings patch as `[String: Any]` with nested
`as [String: Any]` casts. The shape `{ layout: { panels: { ... } } }` is fully static, so no
runtime dictionary was needed.

**Approach:**
- `SettingsViewModel.updateSettings` generalised to `func updateSettings<T: Encodable>(_ patch: T)`.
  Inside the method, `JSONEncoder` encodes the patch, then `JSONSerialization.jsonObject` converts
  it to `[String: Any]` once at the transport boundary before passing it to `WSClient.request`.
- Three private `Encodable` structs added at the bottom of `AppShell.swift` (outside the `View`
  body, after the closing `}`):
  - `PanelWidthPatch` — four `Double` fields mirroring the JSON sent by `handleResizeEnd`
  - `LayoutPanelsPatch` — wraps `PanelWidthPatch` as `panels`
  - `LayoutWidthPatch` — wraps `LayoutPanelsPatch` as `layout`
  A partial struct (not `PanelSettings`) is used because the server accepts a subset of panel fields;
  `PanelSettings` also carries `compactSidebar`, `collapsedProjectIds`, etc. that are unrelated to
  a resize event.
- `persistLayout()` now constructs a fully-typed `LayoutWidthPatch` value.

**Call-sites changed** (only one existed):

| File | Change |
|------|--------|
| `native/Sources/Taskflow/UI/Shell/AppShell.swift` | `persistLayout()` builds `LayoutWidthPatch` instead of `[String: Any]` |
| `native/Sources/Taskflow/ViewModels/SettingsViewModel.swift` | `updateSettings` signature changed to `<T: Encodable>(_ patch: T)` |

No other callers of `updateSettings` exist in the codebase (grep confirmed).

### 2 — Remove duplicate screenshot

`native/evidence/p3-09-shell-resized.png` was byte-identical to `p3-09-shell-layout.png` and carried
no new information. Removed with `git rm`. The required pair
`p3-09-shell-layout.png` + `p3-09-shell-resized-persisted.png` is intact.

### Build + test commands

```
swift build
# → Build complete! (0 errors, 0 new warnings in our code; pre-existing TreeSitter linker warnings unchanged)

swift test
# → Executed 101 tests, with 0 failures (0 unexpected)
```

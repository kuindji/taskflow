# Phase 5B — Sidebar (task/project list, drag-reorder, notifications, toolbars, context + run menus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `SidebarView` with a faithful port of the Electron sidebar — a collapsible project/task list with status/worktree/session badges, drag-to-reorder projects, a notifications popover, the top + bottom toolbars, and right-click context menus carrying the full Run submenu (scripts, `.claude` commands, flows, actions, run-agent) — driven by the existing Phase-3 view models.

**Architecture:** This is the **second** of six Phase-5 sub-plans (see "Where this fits"). It is presentation + thin orchestration on top of the existing `@MainActor @Observable` view models (`TaskViewModel`, `ProjectViewModel`, `UIViewModel`, `SessionViewModel`, `FlowViewModel`) and the 5A primitives (`AppIcon`, `AgentIcon`, `AppSelect`, `SettingRow`, `AppMenu`, `AppButton`). It adds exactly **two** new view models — `NotificationViewModel` (no Swift equivalent existed) and `RunMenuViewModel` (ports `useRunMenu`) — plus a small `TaskCreationViewModel` *request seam* so the toolbar/menu "create" actions are wired even though the modal creation **forms** (NewTaskDialog/NewProjectDialog/etc.) are deferred to the dialog-host plan (5F). Drag-reorder reuses the proven Phase-3 `Transferable` + `.draggable`/`.dropDestination` pattern from `TabItem`. Pure logic (status aggregation, reorder slot-preservation, title fallback, relative time, run-menu predicate, navigation reducer) is TDD'd; views are verified by `swift build` + a live screenshot.

**Tech Stack:** Swift 6 / SwiftUI / AppKit; existing `UI/Primitives` + `UI/Icons` kit; `@Environment(\.appTheme)`; `WSClient` RPC/events; generated domain types (`TaskItem`, `Project`, `SessionRef`, `Notification`, `AgentType`, `SessionStatus`). No new package dependencies.

## Where this fits (Phase 5 decomposition — context, not work for this plan)

Phase 5 (master plan `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md`, units 5.1–5.9) is split into six sub-plans, each producing working, testable software on its own:

- **5A (done)** — Foundations: primitives + icons (5.9) + per-agent option fragments (5.6).
- **5B (this plan)** — Sidebar (5.1): list breadth, drag-reorder, notifications, toolbars, context + run menus.
- **5C** — Panels (5.2): file tree + git-status colors + context menu; search/replace.
- **5D** — Flows + Schedules (5.3 + 5.5): modal management forms (consume 5A fragments).
- **5E** — Settings + Appearance (5.4 + 5.7): multi-tab settings + theme grid.
- **5F** — Command palette + shortcuts + **dialog host** (5.8) — and the deferred sidebar modals below.

**Explicitly deferred from 5B (do NOT build here; consumed/mounted by 5F's dialog host):**
- `NewTaskDialog`, `NewProjectDialog`, `TaskCreationDialogHost`, `MissingLocationDialog`, `UpdateDialog` (modal forms).
- `AgentOptionsDialog` / "Run with options…" and `FlowInputDialog` / flows-that-require-inputs (both modal). 5B renders the menu items and exposes the callback seams; the dialogs are 5F.
- Live git diff counts (`+adds/-dels`) and `behind` counts (require a diff/PR-poll store). The worktree badge in 5B renders **branch + PR number** straight from `TaskItem.worktree`; a `// Phase 5C/diff-store:` seam covers the live counts.

This plan must not implement any of 5C–5F.

## Global Constraints

- **Platform:** macOS 14; SwiftPM tools-version 6.0; `swiftLanguageMode(.v6)`. Do not lower these.
- **Dependencies are EXACT-pinned and already declared** in `native/Package.swift`. Do **not** change versions or add new package dependencies.
- **Swift typing:** no `as Any`/`as!`/`AnyCodable` escape hatches in view/VM code. Reuse generated types (`TaskItem`, `Project`, `Notification`, `SessionRef`, `AgentType`, `SessionStatus`); don't author new domain model types — new types are only allowed for view-local UI structs (drag payloads, run-menu rows) and the request-seam structs. Keep declarations `private`/`internal` unless a cross-file consumer in this plan needs them (don't widen access "just in case"; do NOT add `public`).
- **Pure static helpers on `View`/VM types need `nonisolated`** because Swift 6 infers `@MainActor` on members of `@MainActor` types and `View`. (The 5A lesson — first hit in `AppSelect.label`.) Every pure `static func` in this plan is `nonisolated`.
- **WS calls go through the existing client only:** `client.request<Res>(_:payload:)` for RPC, `client.send(_:payload:)` for fire-and-forget, `client.on(_) { }` for broadcasts. Use existing `MessageType` cases (all needed cases already exist — see each task). Do not invent message types or re-run codegen.
- **TypeScript tooling:** use `bun`, never `npm`/`yarn` (only if codegen must be re-run — it should not need to be).
- **Commits:** do NOT add `Co-Authored-By`. After each task's commit, log to Taskflow: `taskflow-cli log commit "<msg>" --hash <hash>` and `taskflow-cli log file "<relpath>"` for every created/modified file.
- **TDD:** pure logic is written test-first (`swift test --filter <Suite>`); SwiftUI views are verified by `swift build` + the final live screenshot.
- **Parity source of truth (read, port verbatim where noted):** `packages/ui/src/components/sidebar/*`, `packages/ui/src/components/shared/RunMenuItems.tsx`, `packages/ui/src/hooks/useRunMenu.ts`, `packages/ui/src/lib/run-menu.ts`, `packages/shared/src/utils/project-order.ts`, `packages/shared/src/types/agent.ts`.

---

## File Structure

**New view models (under `native/Sources/Taskflow/ViewModels/`):**
- `NotificationViewModel.swift` — notifications list + fetch + mark-read/delete/delete-all; binds WS `notification:created/updated/deleted`. (Ports `notification-store.ts`.)
- `RunMenuViewModel.swift` — ports `useRunMenu.ts` + `run-menu.ts`: lazy scripts/agent-commands fetch, run-menu data assembly, launch callbacks.
- `TaskCreationViewModel.swift` — request seam (`requestNewTask`/`requestNewSubtask`/`requestNewProject` set published request structs; the dialogs that consume them are 5F).

**New pure-helper files (under `native/Sources/Taskflow/ViewModels/`):**
- `SidebarStatus.swift` — pure session-status aggregation (project-level + task/project rollup). Ports ProjectGroup lines ~139–174.
- `SidebarReorder.swift` — pure `buildReorderedProjectIds`. Ports `packages/shared/src/utils/project-order.ts`.

**New sidebar views (under `native/Sources/Taskflow/UI/Sidebar/`):**
- `SessionBadge.swift` — session type + status dot. (`StatusDot` is a nested helper view here.)
- `TaskCard.swift` — one task row (title fallback, worktree badge, session badges, key badge, pinned/active styling) + its context menu.
- `ProjectGroup.swift` — collapsible project group (header + drag handle + task list + project session badges) + its context menu.
- `RunMenuItems.swift` — the Run submenu content (`@ViewBuilder` of `Menu`/`Button`s) shared by both context menus.
- `NotificationPopover.swift` — the notifications popover content.
- `SidebarToolbar.swift` — the bottom 4-icon row (Flows/Schedules/Appearance/Settings).
- `OfflineIndicator.swift` — the WS-disconnected indicator button.

**Modified files:**
- `native/Sources/Taskflow/UI/Shell/SidebarView.swift` — replace the placeholder with the full assembly (Task 12).
- `native/Sources/Taskflow/App/AppEnvironment.swift` — instantiate + bind `NotificationViewModel` and `RunMenuViewModel`/`TaskCreationViewModel`; wire cross-store closures (Tasks 2, 9, 12).

**New test files (under `native/Tests/TaskflowTests/`):** `SidebarStatusTests.swift`, `SidebarReorderTests.swift`, `NotificationViewModelTests.swift`, `SessionBadgeTests.swift`, `TaskCardTests.swift`, `RunMenuTests.swift`, `SidebarNavigationTests.swift`.

---

## Interfaces shared across tasks

Names introduced here that later tasks (and 5C–5F) rely on. Exact signatures:

- `SidebarStatus` (Task 1): `nonisolated static func aggregate(_ statuses: [SessionStatus?]) -> SessionStatus?`; `nonisolated static func project(sessionIds: [String], status: (String) -> SessionStatus?) -> SessionStatus?`; `nonisolated static func rollup(projectStatus: SessionStatus?, taskStatuses: [SessionStatus?]) -> SessionStatus?`.
- `SidebarReorder` (Task 1): `nonisolated static func buildReorderedProjectIds(fullIds: [String], visibleIdsInNewOrder: [String]) -> [String]`.
- `NotificationViewModel` (Task 2): `@MainActor @Observable final class`; `private(set) var notifications: [Notification]`; `var selectedNotificationId: String?`; `func bind()`, `func load() async`, `func markAsRead(id: String) async`, `func deleteNotification(id: String) async`, `func deleteAll() async`; pure: `nonisolated static func upsert(_:_:) -> [Notification]`, `nonisolated static func remove(_:id:) -> [Notification]`, `nonisolated static func markRead(_:id:) -> [Notification]`, `nonisolated static func sorted(_:) -> [Notification]`.
- `TaskCreationViewModel` (Task 5): `@MainActor @Observable final class`; `var newTaskRequest: NewTaskRequest?`; `var newProjectRequested: Bool`; `func requestNewTask(projectId: String?)`, `func requestNewSubtask(parentId: String, projectId: String)`, `func requestNewProject()`, `func clear()`. `struct NewTaskRequest: Equatable { let projectId: String?; let parentId: String? }`.
- `SessionBadge` (Task 4): `init(_ session: SessionRef)`; nested `StatusDot(status: SessionStatus?)`; pure `nonisolated static func colorToken(forType type: String) -> ThemeToken`, `nonisolated static func dotToken(for status: SessionStatus?) -> ThemeToken?`.
- `TaskCard` (Task 6): `init(task: TaskItem, projectPath: String, isActive: Bool, isSubtask: Bool = false, keyBadgeNumber: Int? = nil, onClick: @escaping () -> Void)`; pure `nonisolated static func displayTitle(_ task: TaskItem) -> String`.
- `ProjectGroup` (Task 7): `init(project: Project, tasks: [TaskItem], isActive: Bool, activeTaskId: String?, open: Bool, onOpenChange: @escaping (Bool) -> Void, onProjectClick: @escaping () -> Void, onTaskClick: @escaping (String) -> Void)`.
- `RunMenuViewModel` (Task 8): see Task 8 for the full surface; key: `func data(projectId:projectPath:taskId:) -> RunMenuData`, `func ensureLoaded(projectId:projectPath:) async`, the `RunMenuCallbacks` factory, pure `nonisolated static func hasRunMenuItems(_:) -> Bool`.
- `RunMenuItems` (Task 9): `init(data: RunMenuData, callbacks: RunMenuCallbacks)` — a `View` producing the submenu tree for use inside `.contextMenu`.
- `SidebarNavigation` (Task 13): pure `nonisolated static func next(items: [SidebarFocusedItem], current: SidebarFocusedItem?, direction: NavDirection) -> SidebarFocusedItem?`.

> **Theme tokens used below** (all confirmed present): `.sidebarBackground`, `.sidebarForeground`, `.sidebarPrimary`, `.sidebarAccent`, `.background`, `.foreground`, `.muted`, `.mutedForeground`, `.border`, `.accent`, `.primary`, `.success`, `.warning`, `.info`, `.destructive`, `.cursorAgent`. Read via `@Environment(\.appTheme) private var theme` then `theme.color(_:)`. If a token name differs at build time, use the closest existing token and note it (do not invent tokens).

> **Environment access pattern** (confirmed in `SidebarView.swift`): views read view models through the injected app environment (`env.projects`, `env.tasks`, `env.ui`, `env.session`/`env.sessions`, `env.flows`, plus the new `env.notifications`, `env.runMenu`, `env.taskCreation`). Match the EXACT accessor names already used in `SidebarView.swift` / `AppEnvironment.swift` (the report listed `env.projects?`, `env.tasks?`, `env.ui`, `env.session?`) — confirm each accessor's optionality against `AppEnvironment.swift` before use; do not assume.

---

## Task 1: Pure helpers — status aggregation + reorder slot-preservation

The two pieces of pure logic the list rendering and drag-reorder depend on. Both are TDD'd and have no UI.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/SidebarStatus.swift`
- Create: `native/Sources/Taskflow/ViewModels/SidebarReorder.swift`
- Test: `native/Tests/TaskflowTests/SidebarStatusTests.swift`
- Test: `native/Tests/TaskflowTests/SidebarReorderTests.swift`

**Interfaces:**
- Consumes: generated `SessionStatus` (`.working`/`.attention`/`.initializing`).
- Produces: `SidebarStatus.aggregate/project/rollup`, `SidebarReorder.buildReorderedProjectIds` (used by Tasks 6, 7).

**Reference:** aggregation priority is `attention > working > initializing` (ProjectGroup.tsx lines ~139–174); slot-preservation is `packages/shared/src/utils/project-order.ts` `buildReorderedProjectIds`.

- [ ] **Step 1: Write failing tests.** Create `SidebarStatusTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class SidebarStatusTests: XCTestCase {
    func testAggregatePriority() {
        XCTAssertEqual(SidebarStatus.aggregate([.working, .attention, .initializing]), .attention)
        XCTAssertEqual(SidebarStatus.aggregate([.working, .initializing]), .working)
        XCTAssertEqual(SidebarStatus.aggregate([.initializing]), .initializing)
        XCTAssertNil(SidebarStatus.aggregate([nil, nil]))
        XCTAssertNil(SidebarStatus.aggregate([]))
    }
    func testProjectLooksUpBySessionId() {
        let map: [String: SessionStatus] = ["s1": .working, "s2": .attention]
        XCTAssertEqual(SidebarStatus.project(sessionIds: ["s1", "s2"]) { map[$0] }, .attention)
        XCTAssertEqual(SidebarStatus.project(sessionIds: ["s1"]) { map[$0] }, .working)
        XCTAssertNil(SidebarStatus.project(sessionIds: ["x"]) { map[$0] })
    }
    func testRollupCombinesProjectAndTasks() {
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: .working, taskStatuses: [.attention]), .attention)
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: nil, taskStatuses: [.working, nil]), .working)
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: .initializing, taskStatuses: [nil]), .initializing)
        XCTAssertNil(SidebarStatus.rollup(projectStatus: nil, taskStatuses: [nil]))
    }
}
```

Create `SidebarReorderTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class SidebarReorderTests: XCTestCase {
    func testHiddenSlotsPreserved() {
        // full = [a,b,c,d]; b is hidden; visible reordered = [c,a,d]
        let out = SidebarReorder.buildReorderedProjectIds(
            fullIds: ["a", "b", "c", "d"], visibleIdsInNewOrder: ["c", "a", "d"])
        XCTAssertEqual(out, ["c", "b", "a", "d"]) // b keeps its absolute index 1
    }
    func testAllVisibleIsPlainReorder() {
        XCTAssertEqual(
            SidebarReorder.buildReorderedProjectIds(fullIds: ["a", "b", "c"], visibleIdsInNewOrder: ["c", "b", "a"]),
            ["c", "b", "a"])
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter SidebarStatusTests` and `swift test --filter SidebarReorderTests` → FAIL (undefined).

- [ ] **Step 3: Implement `SidebarStatus`.** Create `SidebarStatus.swift`:

```swift
import Foundation

/// Pure session-status aggregation for the sidebar. Priority: attention > working > initializing.
/// Ports the rollup in components/sidebar/ProjectGroup.tsx (lines ~139–174).
enum SidebarStatus {
    nonisolated static func aggregate(_ statuses: [SessionStatus?]) -> SessionStatus? {
        var hasWorking = false
        var hasInitializing = false
        for s in statuses {
            switch s {
            case .attention: return .attention
            case .working: hasWorking = true
            case .initializing: hasInitializing = true
            case nil: continue
            }
        }
        if hasWorking { return .working }
        if hasInitializing { return .initializing }
        return nil
    }

    /// Project-level status from its own session ids, resolving each via `status`.
    nonisolated static func project(sessionIds: [String], status: (String) -> SessionStatus?) -> SessionStatus? {
        aggregate(sessionIds.map(status))
    }

    /// Combined badge for a project header: its own sessions + each task's rolled-up status.
    nonisolated static func rollup(projectStatus: SessionStatus?, taskStatuses: [SessionStatus?]) -> SessionStatus? {
        aggregate([projectStatus] + taskStatuses)
    }
}
```

- [ ] **Step 4: Implement `SidebarReorder`.** Create `SidebarReorder.swift`:

```swift
import Foundation

/// Pure ordering helpers for sidebar drag-reorder.
/// Ports packages/shared/src/utils/project-order.ts `buildReorderedProjectIds`.
enum SidebarReorder {
    /// Build a full id ordering from a reorder of only the visible subset. Walks `fullIds`;
    /// positions holding a visible id are filled, in order, from `visibleIdsInNewOrder`,
    /// while every other id keeps its absolute position.
    nonisolated static func buildReorderedProjectIds(fullIds: [String], visibleIdsInNewOrder: [String]) -> [String] {
        let visibleSet = Set(visibleIdsInNewOrder)
        var queue = visibleIdsInNewOrder
        return fullIds.map { id in
            guard visibleSet.contains(id) else { return id }
            return queue.isEmpty ? id : queue.removeFirst()
        }
    }
}
```

- [ ] **Step 5: Run — verify pass + build.** Run: `cd native && swift test --filter SidebarStatusTests && swift test --filter SidebarReorderTests` → PASS; `swift build` → clean.

- [ ] **Step 6: Commit.** `feat(native): sidebar pure helpers (status aggregation + reorder slot-preservation)` (+ taskflow logs for both source + both test files).

---

## Task 2: `NotificationViewModel`

The notifications store the popover renders. No Swift equivalent existed (only the generated `Notification` type). 1:1 port of `packages/ui/src/stores/notification-store.ts`. Pure reducers TDD'd; the async/WS surface mirrors the other VMs.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/NotificationViewModel.swift`
- Test: `native/Tests/TaskflowTests/NotificationViewModelTests.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (instantiate + `bind()` + expose as `env.notifications`)

**Interfaces:**
- Consumes: `WSClient` (`request`/`send`/`on`), generated `Notification`, `MessageType` cases `.notificationList`, `.notificationCreated`, `.notificationUpdated`, `.notificationDeleted` (all confirmed present).
- Produces: `NotificationViewModel` (see Interfaces block). Used by Tasks 3, 11, 12.

**Reference:** `packages/ui/src/stores/notification-store.ts` — confirm the exact RPC payloads for mark-read / delete / delete-all (read it in Step 1). The backend may expose mark-read as `notification:update {id, read:true}` and delete as `notification:delete {id}` / delete-all — mirror whatever message types/payloads the store sends. If the store calls a message type NOT in `MessageType.swift`, prefer the closest existing case and note the gap in the results doc (do not add message types).

- [ ] **Step 1: Read** `packages/ui/src/stores/notification-store.ts` to confirm the exact fetch/mark-read/delete/delete-all message types + payload shapes and the `fetchNotifications` response shape (`{ notifications: Notification[] }`).

- [ ] **Step 2: Write failing reducer tests.** Create `NotificationViewModelTests.swift`:

```swift
import XCTest
@testable import Taskflow

@MainActor
final class NotificationViewModelTests: XCTestCase {
    private func note(_ id: String, read: Bool = false, at: String = "0") -> Notification {
        Notification(id: id, projectId: "p", sessionId: "s", taskId: nil,
                     message: "m", read: read, createdAt: at)
    }
    func testUpsertReplacesInPlaceElseAppends() {
        let start = [note("a", at: "1"), note("b", at: "2")]
        let replaced = NotificationViewModel.upsert(start, note("a", read: true, at: "1"))
        XCTAssertEqual(replaced.map(\.id), ["a", "b"])
        XCTAssertTrue(replaced.first { $0.id == "a" }?.read ?? false)
        let appended = NotificationViewModel.upsert(start, note("c", at: "3"))
        XCTAssertEqual(appended.map(\.id), ["a", "b", "c"])
    }
    func testRemove() {
        XCTAssertEqual(NotificationViewModel.remove([note("a"), note("b")], id: "a").map(\.id), ["b"])
    }
    func testMarkRead() {
        let out = NotificationViewModel.markRead([note("a")], id: "a")
        XCTAssertTrue(out.first?.read ?? false)
    }
    func testSortedNewestFirst() {
        let out = NotificationViewModel.sorted([note("a", at: "1"), note("b", at: "3"), note("c", at: "2")])
        XCTAssertEqual(out.map(\.id), ["b", "c", "a"]) // createdAt desc
    }
}
```

- [ ] **Step 3: Run — verify fail.** Run: `cd native && swift test --filter NotificationViewModelTests` → FAIL.

- [ ] **Step 4: Implement `NotificationViewModel`.** Create `NotificationViewModel.swift` (mirror the structure of `ProjectViewModel`/`TaskViewModel`; substitute the real message types/payloads confirmed in Step 1):

```swift
import Foundation

/// Notifications list backing the sidebar popover. Port of stores/notification-store.ts.
@MainActor @Observable final class NotificationViewModel {
    private(set) var notifications: [Notification] = []
    var selectedNotificationId: String?

    private let client: WSClient
    init(client: WSClient) { self.client = client }

    func bind() {
        client.on(.notificationCreated) { [weak self] (n: Notification) in
            Task { @MainActor [weak self] in self?.notifications = Self.upsert(self?.notifications ?? [], n) }
        }
        client.on(.notificationUpdated) { [weak self] (n: Notification) in
            Task { @MainActor [weak self] in self?.notifications = Self.upsert(self?.notifications ?? [], n) }
        }
        client.on(.notificationDeleted) { [weak self] (payload: IdPayload) in
            Task { @MainActor [weak self] in self?.notifications = Self.remove(self?.notifications ?? [], id: payload.id) }
        }
    }

    func load() async {
        struct Res: Decodable { let notifications: [Notification] }
        if let res: Res = try? await client.request(.notificationList, payload: [:]) {
            notifications = Self.sorted(res.notifications)
        }
    }

    func markAsRead(id: String) async {
        notifications = Self.markRead(notifications, id: id)
        // Use the exact message type/payload confirmed in Step 1 (e.g. .notificationUpdated).
        client.send(.notificationUpdated, payload: ["id": id, "read": true])
    }

    func deleteNotification(id: String) async {
        notifications = Self.remove(notifications, id: id)
        client.send(.notificationDeleted, payload: ["id": id])
    }

    func deleteAll() async {
        notifications = []
        client.send(.notificationDeleted, payload: [:]) // or the store's delete-all message from Step 1
    }

    // MARK: - Pure reducers
    nonisolated static func upsert(_ list: [Notification], _ n: Notification) -> [Notification] {
        if let i = list.firstIndex(where: { $0.id == n.id }) {
            var copy = list; copy[i] = n; return copy
        }
        return list + [n]
    }
    nonisolated static func remove(_ list: [Notification], id: String) -> [Notification] {
        list.filter { $0.id != id }
    }
    nonisolated static func markRead(_ list: [Notification], id: String) -> [Notification] {
        list.map { $0.id == id ? Notification(id: $0.id, projectId: $0.projectId, sessionId: $0.sessionId,
                                              taskId: $0.taskId, message: $0.message, read: true,
                                              createdAt: $0.createdAt) : $0 }
    }
    nonisolated static func sorted(_ list: [Notification]) -> [Notification] {
        list.sorted { $0.createdAt > $1.createdAt }
    }
}

/// Minimal decodable for `{ id }` delete broadcasts (reuse an existing one if present).
private struct IdPayload: Decodable { let id: String }
```

> If an `IdPayload`-equivalent already exists (grep `struct .*Decodable.*id`), reuse it instead of declaring a second. Confirm `Notification`'s memberwise initializer signature against `Generated/Models/NotificationTypes.swift` (fields: `id, projectId, sessionId, taskId?, message, read, createdAt`) — `markRead` reconstructs it.

- [ ] **Step 5: Wire into `AppEnvironment`.** In `AppEnvironment.swift`, add a `notifications: NotificationViewModel` (mirror how `projects`/`tasks` are declared + instantiated with the shared `client`), call `notifications.bind()` where the other VMs bind, and `await notifications.load()` where the others load (the `useSidebarData` initial-fetch equivalent). Expose it as `env.notifications`.

- [ ] **Step 6: Run — verify pass + build.** Run: `cd native && swift test --filter NotificationViewModelTests` → PASS; `swift build` → clean; `swift test` → all green.

- [ ] **Step 7: Commit.** `feat(native): NotificationViewModel (list + WS events + mark-read/delete)` (+ logs incl. AppEnvironment.swift).

---

## Task 3: `NotificationPopover`

The popover the bell button opens. Port of `components/sidebar/NotificationPopover.tsx`: header ("Notifications" + "Dismiss all"), a list (newest first) of rows (unread dot, message, project name + relative time, delete button), and a simple inline detail state (selected → show full message + "Go to session" / "Dismiss"). Relative-time formatting is TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/NotificationPopover.swift`
- Test: add a `RelativeTime` case set to `NotificationViewModelTests.swift` (or a new `RelativeTimeTests.swift`).

**Interfaces:**
- Consumes: `NotificationViewModel` (Task 2), `ProjectViewModel` (project name lookup), `AppIcon`, `@Environment(\.appTheme)`.
- Produces: `NotificationPopover(onNavigate: @escaping (Notification) -> Void)` + pure `nonisolated static func relativeTime(_ iso: String, now: Date) -> String`.

**Reference:** `NotificationPopover.tsx` — `formatRelativeTime()` (just now / Xm / Xh / Xd ago); icons `ChevronRight`, `X`; "Dismiss all" clears via `deleteAll()`; clicking a row marks read + navigates.

- [ ] **Step 1: Write the failing relative-time test.** Add to a test file:

```swift
func testRelativeTime() {
    let now = ISO8601DateFormatter().date(from: "2026-06-28T12:00:00Z")!
    func iso(_ s: String) -> String { s }
    XCTAssertEqual(NotificationPopover.relativeTime("2026-06-28T11:59:40Z", now: now), "just now")
    XCTAssertEqual(NotificationPopover.relativeTime("2026-06-28T11:30:00Z", now: now), "30m ago")
    XCTAssertEqual(NotificationPopover.relativeTime("2026-06-28T09:00:00Z", now: now), "3h ago")
    XCTAssertEqual(NotificationPopover.relativeTime("2026-06-26T12:00:00Z", now: now), "2d ago")
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter NotificationViewModelTests` (or the new suite) → FAIL.

- [ ] **Step 3: Implement `NotificationPopover`.** Create `NotificationPopover.swift`. Match the TS copy verbatim ("Notifications", "Dismiss all", "Go to session", "Dismiss"). Read `env.notifications`/`env.projects` via the app environment:

```swift
import SwiftUI

/// Notifications popover content. Port of components/sidebar/NotificationPopover.tsx.
struct NotificationPopover: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env   // match the real environment accessor
    let onNavigate: (Notification) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(.system(size: 13, weight: .semibold))
                Spacer()
                if !items.isEmpty {
                    Button("Dismiss all") { Task { await env.notifications?.deleteAll() } }
                        .buttonStyle(.plain)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.color(.mutedForeground))
                }
            }
            .padding(10)
            Divider()
            if items.isEmpty {
                Text("No notifications")
                    .font(.system(size: 12)).foregroundStyle(theme.color(.mutedForeground))
                    .frame(maxWidth: .infinity).padding(24)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(items, id: \.id) { n in row(n) }
                    }
                }
                .frame(maxHeight: 360)
            }
        }
        .frame(width: 320)
        .background(theme.color(.background))
    }

    private var items: [Notification] {
        NotificationViewModel.sorted(env.notifications?.notifications ?? [])
    }

    private func projectName(_ id: String) -> String {
        env.projects?.projects.first { $0.id == id }?.name ?? "Unknown"
    }

    @ViewBuilder private func row(_ n: Notification) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(n.read ? Color.clear : theme.color(.info))
                .frame(width: 6, height: 6).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(n.message).font(.system(size: 12)).foregroundStyle(theme.color(.foreground))
                    .lineLimit(2)
                Text("\(projectName(n.projectId)) · \(Self.relativeTime(n.createdAt, now: Date()))")
                    .font(.system(size: 10)).foregroundStyle(theme.color(.mutedForeground))
            }
            Spacer(minLength: 4)
            Button { Task { await env.notifications?.markAsRead(id: n.id) }; onNavigate(n) } label: {
                AppIcon("ChevronRight").font(.system(size: 10))
            }.buttonStyle(.plain)
            Button { Task { await env.notifications?.deleteNotification(id: n.id) } } label: {
                AppIcon("X").font(.system(size: 10)).foregroundStyle(theme.color(.mutedForeground))
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .contentShape(Rectangle())
        .background(n.read ? Color.clear : theme.color(.muted).opacity(0.4))
    }

    nonisolated static func relativeTime(_ iso: String, now: Date) -> String {
        guard let then = ISO8601DateFormatter().date(from: iso) else { return "" }
        let secs = Int(now.timeIntervalSince(then))
        if secs < 60 { return "just now" }
        let mins = secs / 60
        if mins < 60 { return "\(mins)m ago" }
        let hrs = mins / 60
        if hrs < 24 { return "\(hrs)h ago" }
        return "\(hrs / 24)d ago"
    }
}
```

> Use the EXACT environment accessor that the existing code uses (the report shows `env.projects?`, `env.notifications?` etc. via an injected environment). If the codebase injects the environment differently (e.g. `@Environment(AppEnvironment.self)` or a custom key), match it — grep `SidebarView.swift` for the pattern and copy it. Do not introduce a new injection mechanism.

- [ ] **Step 4: Run + build.** `cd native && swift test --filter NotificationViewModelTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): NotificationPopover (list + relative time + dismiss)` (+ logs).

---

## Task 4: `SessionBadge` + `StatusDot`

The inline session chip (type + status dot) used on task cards and project headers. Port of `components/sidebar/SessionBadge.tsx` + `components/ui/status-dot.tsx`. Color mapping is TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/SessionBadge.swift`
- Test: `native/Tests/TaskflowTests/SessionBadgeTests.swift`

**Interfaces:**
- Consumes: `SessionRef`, `SessionStatus`, `SessionViewModel.sessionStatus`, `@Environment(\.appTheme)`, `ThemeToken`.
- Produces: `SessionBadge(_ session: SessionRef)` + nested `StatusDot(status:)` + pure `colorToken(forType:)` / `dotToken(for:)`. Used by Tasks 6, 7.

**Reference (verbatim color rules):**
- `SessionBadge.tsx`: colorScheme = `claude` if type=="claude", `cursor` if "cursor", `shell` if "shell", else `codex`.
- `status-dot.tsx`: `working`→`bg-success`; `attention`→`bg-warning` (pulse); `initializing`→`bg-muted-foreground` (pulse); none → render nothing.

- [ ] **Step 1: Write failing tests.** Create `SessionBadgeTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class SessionBadgeTests: XCTestCase {
    func testColorTokenByType() {
        XCTAssertEqual(SessionBadge.colorToken(forType: "claude"), .primary)
        XCTAssertEqual(SessionBadge.colorToken(forType: "cursor"), .cursorAgent)
        XCTAssertEqual(SessionBadge.colorToken(forType: "shell"), .mutedForeground)
        XCTAssertEqual(SessionBadge.colorToken(forType: "codex"), .foreground)
        XCTAssertEqual(SessionBadge.colorToken(forType: "anything-else"), .foreground) // default branch
    }
    func testDotToken() {
        XCTAssertEqual(SessionBadge.dotToken(for: .working), .success)
        XCTAssertEqual(SessionBadge.dotToken(for: .attention), .warning)
        XCTAssertEqual(SessionBadge.dotToken(for: .initializing), .mutedForeground)
        XCTAssertNil(SessionBadge.dotToken(for: nil))
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter SessionBadgeTests` → FAIL.

- [ ] **Step 3: Implement `SessionBadge`.** Create `SessionBadge.swift`:

```swift
import SwiftUI

/// Inline session chip: type label + status dot. Port of components/sidebar/SessionBadge.tsx
/// + components/ui/status-dot.tsx.
struct SessionBadge: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env
    private let session: SessionRef
    init(_ session: SessionRef) { self.session = session }

    private var status: SessionStatus? { env.session?.sessionStatus[session.id] }

    var body: some View {
        HStack(spacing: 2) {
            StatusDot(status: status)
            Text(session.type).font(.system(size: 10))
        }
        .padding(.horizontal, 4).padding(.vertical, 1)
        .overlay(RoundedRectangle(cornerRadius: 4)
            .stroke(theme.color(Self.colorToken(forType: session.type)).opacity(0.5), lineWidth: 1))
        .foregroundStyle(theme.color(Self.colorToken(forType: session.type)))
    }

    /// Status dot: success/warning/muted for working/attention/initializing; nothing when nil.
    struct StatusDot: View {
        @Environment(\.appTheme) private var theme
        let status: SessionStatus?
        var body: some View {
            if let token = SessionBadge.dotToken(for: status) {
                Circle().fill(theme.color(token)).frame(width: 6, height: 6)
            }
        }
    }

    nonisolated static func colorToken(forType type: String) -> ThemeToken {
        switch type {
        case "claude": return .primary
        case "cursor": return .cursorAgent
        case "shell": return .mutedForeground
        default: return .foreground   // includes "codex"
        }
    }
    nonisolated static func dotToken(for status: SessionStatus?) -> ThemeToken? {
        switch status {
        case .working: return .success
        case .attention: return .warning
        case .initializing: return .mutedForeground
        case nil: return nil
        }
    }
}
```

> `.pulse` animation for attention/initializing is a nice-to-have; a static dot is acceptable for 5B (note it as a Phase-6 polish seam). If `ThemeToken` lacks `.primary`/`.cursorAgent`, substitute the closest agent tints used by `AgentIcon.tintToken` and keep the test pinned to whatever you choose.

- [ ] **Step 4: Run + build.** `cd native && swift test --filter SessionBadgeTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): SessionBadge + StatusDot (typed chip + status colors)` (+ logs).

---

## Task 5: `TaskCreationViewModel` (request seam)

A small view model so the toolbar's "New Task"/"New Project" buttons and the context menus' "Create task"/"Add subtask" items are wired in 5B even though the modal **forms** are 5F. It only records a *request*; 5F's dialog host observes it, presents the form, and clears it. TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/TaskCreationViewModel.swift`
- Test: `native/Tests/TaskflowTests/TaskCardTests.swift` (shared suite for sidebar VM logic; add the creation cases here, more added in Task 6)
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (expose `env.taskCreation`)

**Interfaces:**
- Produces: `TaskCreationViewModel` with `newTaskRequest: NewTaskRequest?`, `newProjectRequested: Bool`, `requestNewTask`/`requestNewSubtask`/`requestNewProject`/`clear`. `struct NewTaskRequest: Equatable { let projectId: String?; let parentId: String? }`. Used by Tasks 9, 11, 12 (and 5F).

- [ ] **Step 1: Write failing tests.** Create `TaskCardTests.swift` with the creation cases:

```swift
import XCTest
@testable import Taskflow

@MainActor
final class TaskCardTests: XCTestCase {
    func testRequestNewTaskSetsRequest() {
        let vm = TaskCreationViewModel()
        vm.requestNewTask(projectId: "p1")
        XCTAssertEqual(vm.newTaskRequest, TaskCreationViewModel.NewTaskRequest(projectId: "p1", parentId: nil))
    }
    func testRequestNewSubtask() {
        let vm = TaskCreationViewModel()
        vm.requestNewSubtask(parentId: "t1", projectId: "p1")
        XCTAssertEqual(vm.newTaskRequest, TaskCreationViewModel.NewTaskRequest(projectId: "p1", parentId: "t1"))
    }
    func testClear() {
        let vm = TaskCreationViewModel()
        vm.requestNewProject()
        XCTAssertTrue(vm.newProjectRequested)
        vm.clear()
        XCTAssertNil(vm.newTaskRequest)
        XCTAssertFalse(vm.newProjectRequested)
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter TaskCardTests` → FAIL.

- [ ] **Step 3: Implement `TaskCreationViewModel`.** Create `TaskCreationViewModel.swift`:

```swift
import Foundation

/// Request seam for task/project creation. The toolbar + context menus call these; the modal
/// creation FORMS (NewTaskDialog/NewProjectDialog) are mounted by the 5F dialog host, which
/// observes these requests and clears them. Ports the request half of stores/task-creation-store.ts.
@MainActor @Observable final class TaskCreationViewModel {
    struct NewTaskRequest: Equatable {
        let projectId: String?
        let parentId: String?
    }
    var newTaskRequest: NewTaskRequest?
    var newProjectRequested: Bool = false

    func requestNewTask(projectId: String?) { newTaskRequest = NewTaskRequest(projectId: projectId, parentId: nil) }
    func requestNewSubtask(parentId: String, projectId: String) {
        newTaskRequest = NewTaskRequest(projectId: projectId, parentId: parentId)
    }
    func requestNewProject() { newProjectRequested = true }
    func clear() { newTaskRequest = nil; newProjectRequested = false }
}
```

- [ ] **Step 4: Wire into `AppEnvironment`** as `env.taskCreation` (no `bind()`/`load()` needed — it has no WS surface).

- [ ] **Step 5: Run + build.** `cd native && swift test --filter TaskCardTests` → PASS; `swift build` → clean.

- [ ] **Step 6: Commit.** `feat(native): TaskCreationViewModel request seam (forms deferred to 5F)` (+ logs).

---

## Task 6: `TaskCard`

One task row. Port of `components/sidebar/TaskCard.tsx` (non-dialog parts). Title-fallback is TDD'd; the view renders title/description, an optional worktree badge (branch + PR from `TaskItem.worktree`), session badges, an optional key badge, and pinned/active styling. The context menu is added in Task 9 (kept separate so a reviewer can gate the menu independently).

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/TaskCard.swift`
- Test: add title-fallback cases to `TaskCardTests.swift`

**Interfaces:**
- Consumes: `TaskItem`, `SessionBadge` (Task 4), `AppIcon`, `AppBadge`, `@Environment(\.appTheme)`.
- Produces: `TaskCard(task:projectPath:isActive:isSubtask:keyBadgeNumber:onClick:)` + `nonisolated static func displayTitle(_:)`. Used by Task 7 (ProjectGroup) and Task 9 (menu).

**Reference:** `TaskCard.tsx` — title = `task.title` else truncated description (≤50 chars + "…"); worktree badge shows branch, `PR #<n>`; icons `GitBranch`, `Pin`. Read it in Step 1 for exact copy/layout.

- [ ] **Step 1: Read** `packages/ui/src/components/sidebar/TaskCard.tsx` for the exact title-fallback length (confirm 50), the worktree-badge layout/labels, and the pinned indicator.

- [ ] **Step 2: Write the failing title test.** Add to `TaskCardTests.swift`:

```swift
func testDisplayTitlePrefersTitle() {
    var t = Self.sample(); t = Self.with(t, title: "Real Title", description: "desc")
    XCTAssertEqual(TaskCard.displayTitle(t), "Real Title")
}
func testDisplayTitleFallsBackToTruncatedDescription() {
    let long = String(repeating: "x", count: 80)
    let t = Self.with(Self.sample(), title: "", description: long)
    let out = TaskCard.displayTitle(t)
    XCTAssertTrue(out.hasSuffix("…"))
    XCTAssertEqual(out.count, 51) // 50 chars + ellipsis
}
func testDisplayTitleShortDescriptionNoEllipsis() {
    let t = Self.with(Self.sample(), title: "", description: "short")
    XCTAssertEqual(TaskCard.displayTitle(t), "short")
}
```

Add the `sample()`/`with(...)` helpers to `TaskCardTests` (build a `TaskItem` with all required fields, mutating title/description):

```swift
static func sample() -> TaskItem {
    TaskItem(id: "t", projectId: "p", parentId: nil, title: "", description: "",
             notes: "", worktree: TaskWorktree(enabled: false, path: nil, branch: nil, pr: nil),
             sessions: [], createdAt: "0", status: "active", archivedAt: nil, pinned: false, initCommand: nil)
}
static func with(_ t: TaskItem, title: String, description: String) -> TaskItem {
    TaskItem(id: t.id, projectId: t.projectId, parentId: t.parentId, title: title, description: description,
             notes: t.notes, worktree: t.worktree, sessions: t.sessions, createdAt: t.createdAt,
             status: t.status, archivedAt: t.archivedAt, pinned: t.pinned, initCommand: t.initCommand)
}
```

- [ ] **Step 3: Run — verify fail.** Run: `cd native && swift test --filter TaskCardTests` → FAIL (displayTitle undefined).

- [ ] **Step 4: Implement `TaskCard`.** Create `TaskCard.swift`:

```swift
import SwiftUI

/// One task row in the sidebar. Port of components/sidebar/TaskCard.tsx (view parts;
/// context menu added in Task 9). Worktree diff/behind counts deferred (5C diff-store seam).
struct TaskCard: View {
    @Environment(\.appTheme) private var theme
    let task: TaskItem
    let projectPath: String
    let isActive: Bool
    var isSubtask: Bool = false
    var keyBadgeNumber: Int? = nil
    let onClick: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if task.pinned { AppIcon("Pin").font(.system(size: 9)).foregroundStyle(theme.color(.mutedForeground)) }
                    Text(Self.displayTitle(task))
                        .font(.system(size: isSubtask ? 11 : 12))
                        .foregroundStyle(theme.color(isActive ? .sidebarPrimary : .sidebarForeground))
                        .lineLimit(1)
                }
                if task.worktree.enabled, let branch = task.worktree.branch {
                    worktreeBadge(branch: branch, pr: task.worktree.pr)
                }
                if !task.sessions.isEmpty {
                    HStack(spacing: 4) { ForEach(task.sessions, id: \.id) { SessionBadge($0) } }
                }
            }
            Spacer(minLength: 4)
            if let k = keyBadgeNumber {
                Text("\(k)").font(.system(size: 9, weight: .semibold))
                    .padding(.horizontal, 4).background(theme.color(.muted)).clipShape(RoundedRectangle(cornerRadius: 3))
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .padding(.leading, isSubtask ? 16 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isActive ? theme.color(.sidebarAccent).opacity(0.15) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture(perform: onClick)
    }

    @ViewBuilder private func worktreeBadge(branch: String, pr: TaskWorktreePr?) -> some View {
        HStack(spacing: 3) {
            AppIcon("GitBranch").font(.system(size: 9))
            Text(branch).font(.system(size: 10)).lineLimit(1)
            if let pr { Text("PR #\(Int(pr.number))").font(.system(size: 10)) }
            // Phase 5C/diff-store seam: live +adds/-dels and `behind` counts go here.
        }
        .foregroundStyle(theme.color(.mutedForeground))
    }

    /// Title or, when empty, a ≤50-char truncation of the description (+ ellipsis if cut).
    nonisolated static func displayTitle(_ task: TaskItem) -> String {
        if !task.title.isEmpty { return task.title }
        let d = task.description
        return d.count > 50 ? String(d.prefix(50)) + "…" : d
    }
}
```

> Confirm `AppBadge`'s API if you prefer it for the key/worktree chips; otherwise the inline styling above is fine. Confirm `TaskWorktreePr.number` is `Double` (it is) → render as `Int(pr.number)`.

- [ ] **Step 5: Run + build.** `cd native && swift test --filter TaskCardTests` → PASS; `swift build` → clean.

- [ ] **Step 6: Commit.** `feat(native): TaskCard row (title fallback, worktree + session badges)` (+ logs).

---

## Task 7: `ProjectGroup` + drag-reorder

The collapsible project group: header (chevron, rolled-up status dot when collapsed, name, branch, key badge), its own session badges when open, and the task list (pinned tasks first, separator, then the rest). Drag-to-reorder projects reuses the Phase-3 `Transferable` pattern. No new pure logic beyond Tasks 1/4/6.

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift`

**Interfaces:**
- Consumes: `Project`, `TaskItem`, `TaskCard` (Task 6), `SessionBadge` (Task 4), `SidebarStatus` (Task 1), `AppIcon`, `ProjectViewModel.reorderProjects`, `UIViewModel.setProjectCollapsed`, `@Environment(\.appTheme)`.
- Produces: `ProjectGroup(project:tasks:isActive:activeTaskId:open:onOpenChange:onProjectClick:onTaskClick:)` + a `ProjectDragItem: Codable, Transferable` payload. Used by Task 12.

**Reference (drag pattern):** `native/Sources/Taskflow/UI/Workspace/TabItem.swift` — `UTType` exported, a `Codable, Transferable` struct with `CodableRepresentation(contentType:)`, then `.draggable(...)` + `.dropDestination(for:) { items, _ in ... }`. Mirror it.

- [ ] **Step 1: Define the drag payload + UTType.** At the top of `ProjectGroup.swift`:

```swift
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let taskflowProject = UTType(exportedAs: "com.taskflow.project")
}

struct ProjectDragItem: Codable, Transferable, Sendable {
    let projectId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .taskflowProject)
    }
}
```

> Confirm `com.taskflow.project` is declared in the app bundle's `Info.plist` `UTExportedTypeDeclarations` the same way `com.taskflow.tab` is. If `make-app-bundle.sh`/the Info.plist template lists exported UTIs, add `com.taskflow.project` there (mirror the tab entry). If tabs work without an explicit plist entry, no change is needed.

- [ ] **Step 2: Implement `ProjectGroup`.** In the same file:

```swift
struct ProjectGroup: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env
    let project: Project
    let tasks: [TaskItem]
    let isActive: Bool
    let activeTaskId: String?
    let open: Bool
    let onOpenChange: (Bool) -> Void
    let onProjectClick: () -> Void
    let onTaskClick: (String) -> Void

    private var pinned: [TaskItem] { tasks.filter { $0.pinned } }
    private var unpinned: [TaskItem] { tasks.filter { !$0.pinned } }

    private var rolledUpStatus: SessionStatus? {
        let statusFn: (String) -> SessionStatus? = { env.session?.sessionStatus[$0] }
        let projStatus = SidebarStatus.project(sessionIds: project.sessions.map(\.id), status: statusFn)
        let taskStatuses = tasks.map { t in
            SidebarStatus.project(sessionIds: t.sessions.map(\.id), status: statusFn)
        }
        return SidebarStatus.rollup(projectStatus: projStatus, taskStatuses: taskStatuses)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            header
            if open {
                if !project.sessions.isEmpty {
                    HStack(spacing: 4) { ForEach(project.sessions, id: \.id) { SessionBadge($0) } }
                        .padding(.leading, 18)
                }
                ForEach(pinned, id: \.id) { taskRow($0) }
                if !pinned.isEmpty && !unpinned.isEmpty {
                    Divider().padding(.leading, 18).padding(.vertical, 2)
                }
                ForEach(unpinned, id: \.id) { taskRow($0) }
            }
        }
    }

    @ViewBuilder private func taskRow(_ t: TaskItem) -> some View {
        TaskCard(task: t, projectPath: project.path, isActive: t.id == activeTaskId,
                 onClick: { onTaskClick(t.id) })
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button { onOpenChange(!open) } label: {
                AppIcon(open ? "ChevronDown" : "ChevronRight").font(.system(size: 9))
            }.buttonStyle(.plain)
            if !open, let token = SessionBadge.dotToken(for: rolledUpStatus) {
                Circle().fill(theme.color(token)).frame(width: 6, height: 6)
            }
            Text(project.name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.color(isActive ? .sidebarPrimary : .sidebarForeground))
                .lineLimit(1)
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .background(isActive ? theme.color(.sidebarAccent).opacity(0.25) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture(perform: onProjectClick)
        .draggable(ProjectDragItem(projectId: project.id))
        .dropDestination(for: ProjectDragItem.self) { items, _ in
            guard let dropped = items.first, dropped.projectId != project.id else { return false }
            reorder(movingId: dropped.projectId, overId: project.id)
            return true
        }
    }

    private func reorder(movingId: String, overId: String) {
        guard let projects = env.projects?.projects else { return }
        let visible = projects.filter { $0.hidden != true }.map(\.id)
        guard let from = visible.firstIndex(of: movingId),
              let to = visible.firstIndex(of: overId) else { return }
        var reordered = visible
        let m = reordered.remove(at: from)
        reordered.insert(m, at: to)
        let full = SidebarReorder.buildReorderedProjectIds(
            fullIds: projects.map(\.id), visibleIdsInNewOrder: reordered)
        Task { try? await env.projects?.reorderProjects(orderedIds: full) }
    }
}
```

> The collapse state lives in `UIViewModel.collapsedProjectIds`; Task 12 passes `open`/`onOpenChange` derived from it (`open = !collapsed.contains(project.id)`, `onOpenChange = { env.ui.setProjectCollapsed(project.id, !$0) }`). The `from/to` remove-then-insert matches `SessionViewModel.arrayMove` semantics already proven for tabs.

- [ ] **Step 3: Build.** Run: `cd native && swift build` → clean; `swift test` → still green.

- [ ] **Step 4: Commit.** `feat(native): ProjectGroup (collapsible header + task list + drag-reorder)` (+ logs).

---

## Task 8: `RunMenuViewModel` (ports `useRunMenu` + `run-menu.ts`)

The data + callbacks behind the Run submenu. Ports `hooks/useRunMenu.ts` + `lib/run-menu.ts`: lazily fetch `scripts:list` and `agent-commands:list`, read flows/actions from `FlowViewModel`, compute the menu data, and provide launch callbacks. The `hasRunMenuItems` predicate is TDD'd verbatim.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/RunMenuViewModel.swift`
- Test: `native/Tests/TaskflowTests/RunMenuTests.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (expose `env.runMenu`)

**Interfaces:**
- Consumes: `WSClient` (`.scriptsList`, `.agentCommandsList` — both confirmed present), `FlowViewModel` (`flows`, `actions`, `activeRuns`, `startFlow`), `SessionViewModel.createSession`/`sendInput`, `UIViewModel`/`TaskViewModel` for navigation, settings `defaultRuntime`, `AgentType`/`ALL_AGENT_TYPES`/`AGENT_DISPLAY_NAMES` (port the agent constants).
- Produces: `RunMenuData` (struct), `RunMenuCallbacks` (struct of closures), `RunMenuViewModel` with `func ensureLoaded(projectId:projectPath:) async`, `func data(projectId:projectPath:taskId:) -> RunMenuData`, `func callbacks(projectId:projectPath:taskId:) -> RunMenuCallbacks`, and `nonisolated static func hasRunMenuItems(_:) -> Bool`. Used by Tasks 9, 12.

**Reference (port verbatim):** `lib/run-menu.ts` (`hasRunMenuItems` predicate + the menu section structure), `hooks/useRunMenu.ts` (the callback bodies: run script via shell, agent command, flow start, action, run-tab agent). `packages/shared/src/types/agent.ts` for `ALL_AGENT_TYPES = [claude,codex,opencode,gemini,cursor,pi]` and `AGENT_DISPLAY_NAMES`.

- [ ] **Step 1: Read** `hooks/useRunMenu.ts` and `lib/run-menu.ts` end-to-end to confirm: the `scripts:list`/`agent-commands:list` request + response shapes; the `AgentCommand` / `ActionDefinition` field names (`cmd.name`, `cmd.source`; `action.id`, `action.name`, `action.sessionType`); and the exact launch behavior for each callback. Note: agent availability comes from `useAgentAvailability`; in Swift there is no availability VM yet — **5B treats every agent as available** and gates only on WS-connected (`online`), with a `// availability seam` comment (real availability = a later fetch). Confirm whether an availability `MessageType` exists; if so, fetch it, else use the all-available fallback.

- [ ] **Step 2: Define the data structs + write the failing predicate test.** Create `RunMenuTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class RunMenuTests: XCTestCase {
    private func data(scripts: [String: String] = [:],
                      agentCommands: [AgentCommand] = [],
                      flows: [FlowDefinition] = [],
                      actions: [ActionDefinition] = [],
                      activeFlowRun: Bool = false,
                      showAgentOptions: Bool = false) -> RunMenuData {
        RunMenuData(scripts: scripts, defaultRuntime: "bun", agentCommands: agentCommands,
                    flows: flows, standaloneActions: actions, hasActiveFlowRun: activeFlowRun,
                    showAgentOptions: showAgentOptions, online: true)
    }
    func testHasItems() {
        XCTAssertFalse(RunMenuViewModel.hasRunMenuItems(data()))
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(scripts: ["build": "tsc"])))
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(showAgentOptions: true)))
    }
    func testFlowsSuppressedWhileRunning() {
        let f = FlowDefinitionFixture.make() // build a minimal FlowDefinition in the test
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(flows: [f])))
        XCTAssertFalse(RunMenuViewModel.hasRunMenuItems(data(flows: [f], activeFlowRun: true)))
    }
}
```

> Build the `AgentCommand`/`FlowDefinition`/`ActionDefinition` fixtures from the generated types' real fields (grep `Generated/Models` for them). If `agentCommands`-gating depends on Claude availability in TS (`hasClaudeAgent`), 5B's all-available fallback means it's gated only on non-empty + online — keep the predicate faithful to the all-available simplification and note it.

- [ ] **Step 3: Run — verify fail.** Run: `cd native && swift test --filter RunMenuTests` → FAIL.

- [ ] **Step 4: Implement `RunMenuViewModel`.** Create `RunMenuViewModel.swift`. Hold fetched scripts/agent-commands keyed by project; assemble `RunMenuData`; provide callbacks that navigate then launch. Port `hasRunMenuItems` from `lib/run-menu.ts`:

```swift
import Foundation

struct RunMenuData {
    var scripts: [String: String]
    var defaultRuntime: String
    var agentCommands: [AgentCommand]
    var flows: [FlowDefinition]
    var standaloneActions: [ActionDefinition]
    var hasActiveFlowRun: Bool
    var showAgentOptions: Bool
    var online: Bool
}

struct RunMenuCallbacks {
    var onRunScript: (String) -> Void
    var onRunAgentCommand: (AgentCommand) -> Void
    var onStartFlow: (String) -> Void
    var onRunAction: (ActionDefinition) -> Void
    var onRunTab: (AgentType) -> Void
    var onRunTabWithOptions: (AgentType) -> Void
}

/// Ports hooks/useRunMenu.ts + lib/run-menu.ts. Agent availability is simplified to
/// "all installed", gated only on WS-connected (`online`) — availability seam.
@MainActor @Observable final class RunMenuViewModel {
    static let allAgentTypes: [AgentType] = [.claude, .codex, .opencode, .gemini, .cursor, .pi]
    static func displayName(_ a: AgentType) -> String {
        switch a {
        case .claude: return "Claude"; case .codex: return "Codex"; case .opencode: return "OpenCode"
        case .gemini: return "Gemini"; case .cursor: return "Cursor"; case .pi: return "Pi"
        }
    }

    private let client: WSClient
    private var scriptsByProject: [String: [String: String]] = [:]
    private var agentCommandsByProject: [String: [AgentCommand]] = [:]
    init(client: WSClient) { self.client = client }

    /// Lazy fetch of scripts + agent commands for a project (mirrors useRunMenu's enabled fetch).
    func ensureLoaded(projectId: String, projectPath: String) async {
        if scriptsByProject[projectId] == nil {
            struct Res: Decodable { let scripts: [String: String] }
            if let r: Res = try? await client.request(.scriptsList, payload: ["path": projectPath]) {
                scriptsByProject[projectId] = r.scripts
            }
        }
        if agentCommandsByProject[projectId] == nil {
            struct Res: Decodable { let commands: [AgentCommand] }
            if let r: Res = try? await client.request(.agentCommandsList, payload: ["path": projectPath]) {
                agentCommandsByProject[projectId] = r.commands
            }
        }
    }

    func data(projectId: String, projectPath: String, taskId: String?,
              flows: [FlowDefinition], actions: [ActionDefinition],
              hasActiveFlowRun: Bool, defaultRuntime: String, online: Bool,
              showAgentOptions: Bool) -> RunMenuData {
        RunMenuData(scripts: scriptsByProject[projectId] ?? [:], defaultRuntime: defaultRuntime,
                    agentCommands: agentCommandsByProject[projectId] ?? [], flows: flows,
                    standaloneActions: actions, hasActiveFlowRun: hasActiveFlowRun,
                    showAgentOptions: showAgentOptions, online: online)
    }

    /// Port of lib/run-menu.ts `hasRunMenuItems` (all-available simplification).
    nonisolated static func hasRunMenuItems(_ d: RunMenuData) -> Bool {
        !d.scripts.isEmpty
            || (!d.agentCommands.isEmpty)
            || (!d.flows.isEmpty && !d.hasActiveFlowRun)
            || !d.standaloneActions.isEmpty
            || d.showAgentOptions
    }
}
```

- [ ] **Step 5: Add the callbacks factory.** Still in `RunMenuViewModel`, add a `callbacks(...)` that closes over the other VMs (passed in so the VM stays decoupled, or reached via the environment from the call site in Task 9 — match the codebase's preference). The bodies (port `useRunMenu`):
  - `onRunScript(name)`: navigate (set active task/project, focus workspace), create a `.shell` session for the workspace, then `sendInput("\(defaultRuntime) run \(name)\r")`.
  - `onRunAgentCommand(cmd)`: navigate, create a `.claude` session labeled `cmd.name`, then `sendInput("/\(cmd.name)\r")`.
  - `onStartFlow(flowId)`: if the flow has required inputs → set a "flow input request" seam (5F); else `FlowViewModel.startFlow(...)`.
  - `onRunAction(action)`: if action is shell type → shell session + command; else create a session of `action.sessionType`.
  - `onRunTab(agent)`: navigate, create a session of that agent type with the task description as initial input (or none).
  - `onRunTabWithOptions(agent)`: set an "agent options request" seam (5F dialog) — no-op-with-comment in 5B.

> Confirm `SessionViewModel.createSession`'s exact parameters (`taskId:projectId:master:type:label:cwd:targetWorkspaceKey:`) and that `TabType` has `.shell` + the agent cases. The workspace key = `WorkspaceKey.task(taskId)` when a task is the owner, else `WorkspaceKey.project(projectId)`. If `createSession` gains an `initialInput` param later, prefer it over the `sendInput` follow-up; 5B uses `sendInput` after create.

- [ ] **Step 6: Wire into `AppEnvironment`** as `env.runMenu`.

- [ ] **Step 7: Run + build.** `cd native && swift test --filter RunMenuTests` → PASS; `swift build` → clean.

- [ ] **Step 8: Commit.** `feat(native): RunMenuViewModel (scripts/agent-commands/flows/actions + launch callbacks)` (+ logs).

---

## Task 9: Context menus + `RunMenuItems`

The right-click menus for tasks and projects, both carrying the Run submenu. `RunMenuItems` is a shared `@ViewBuilder` of `Menu`/`Button`s. Task and project menus are attached via SwiftUI `.contextMenu` on `TaskCard`/`ProjectGroup`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/RunMenuItems.swift`
- Modify: `native/Sources/Taskflow/UI/Sidebar/TaskCard.swift` (attach `.contextMenu`)
- Modify: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift` (attach `.contextMenu`)

**Interfaces:**
- Consumes: `RunMenuData`/`RunMenuCallbacks` (Task 8), `RunMenuViewModel.hasRunMenuItems`, `AppIcon`, `RunMenuViewModel.allAgentTypes`/`displayName`.
- Produces: `RunMenuItems(data:callbacks:)` (a `View`). Used by both context menus.

**Reference:** `components/shared/RunMenuItems.tsx` + `lib/run-menu.ts` section order: package.json scripts → `.claude` commands → Flows → Actions → (separator) "Run agent with task description" label + per-agent submenu (Run / Run with options…). Disable offline-gated sections when `!online`.

- [ ] **Step 1: Implement `RunMenuItems`.** Create `RunMenuItems.swift`:

```swift
import SwiftUI

/// Run submenu content shared by the task + project context menus.
/// Port of components/shared/RunMenuItems.tsx (section order from lib/run-menu.ts).
struct RunMenuItems: View {
    let data: RunMenuData
    let callbacks: RunMenuCallbacks

    var body: some View {
        if !data.scripts.isEmpty {
            Menu("package.json") {
                ForEach(data.scripts.keys.sorted(), id: \.self) { name in
                    Button("\(name) (\(data.defaultRuntime))") { callbacks.onRunScript(name) }
                }
            }
        }
        if !data.agentCommands.isEmpty {
            Menu(".claude") {
                ForEach(data.agentCommands, id: \.name) { cmd in
                    Button("\(cmd.name) (\(cmd.source))") { callbacks.onRunAgentCommand(cmd) }
                        .disabled(!data.online)
                }
            }.disabled(!data.online)
        }
        if !data.flows.isEmpty && !data.hasActiveFlowRun {
            Menu("Flows") {
                ForEach(data.flows, id: \.id) { flow in
                    Button(flow.name) { callbacks.onStartFlow(flow.id) }.disabled(!data.online)
                }
            }.disabled(!data.online)
        }
        if !data.standaloneActions.isEmpty {
            Menu("Actions") {
                ForEach(data.standaloneActions, id: \.id) { action in
                    Button("\(action.name) (\(action.sessionType))") { callbacks.onRunAction(action) }
                        .disabled(!data.online)
                }
            }.disabled(!data.online)
        }
        if data.showAgentOptions {
            Divider()
            Section("Run agent with task description") {
                ForEach(RunMenuViewModel.allAgentTypes, id: \.rawValue) { agent in
                    Menu(RunMenuViewModel.displayName(agent)) {
                        Button("Run") { callbacks.onRunTab(agent) }
                        Button("Run with options…") { callbacks.onRunTabWithOptions(agent) }
                    }.disabled(!data.online)
                }
            }
        }
    }
}
```

> SwiftUI `Menu`/`Section` inside `.contextMenu` render as native submenus. Confirm `AgentCommand` field names (`name`, `source`) and `ActionDefinition` (`id`, `name`, `sessionType`) against the generated types in Step 1 of Task 8.

- [ ] **Step 2: Attach the task context menu** in `TaskCard.swift`. Add `.contextMenu { taskMenu }` to the row's outermost view, reaching the env VMs:

```swift
@ViewBuilder private var taskMenu: some View {
    Button("Add subtask") { env.taskCreation?.requestNewSubtask(parentId: task.id, projectId: task.projectId) }
    Button(task.pinned ? "Unpin" : "Pin") {
        Task { try? await env.tasks?.updateTask(id: task.id, title: nil, description: nil,
                                                notes: nil, worktree: nil, pinned: !task.pinned) }
    }
    if let run = env.runMenu, let proj = env.projects?.projects.first(where: { $0.id == task.projectId }) {
        let d = run.data(projectId: task.projectId, projectPath: proj.path, taskId: task.id,
                         flows: env.flows?.flows ?? [], actions: env.flows?.actions ?? [],
                         hasActiveFlowRun: false, defaultRuntime: defaultRuntime,
                         online: online, showAgentOptions: !isArchived)
        if RunMenuViewModel.hasRunMenuItems(d) {
            Menu("Run") { RunMenuItems(data: d, callbacks: run.callbacks(/* … */)) }
        }
    }
    Divider()
    if isArchived {
        Button("Unarchive") { Task { try? await env.tasks?.unarchiveTask(id: task.id) } }
    } else {
        Button("Archive") { Task { try? await env.tasks?.archiveTask(id: task.id) } }
    }
    Button("Delete", role: .destructive) {
        // Delete-with-worktree confirmation dialog is 5F; 5B does a direct delete (no worktree removal).
        Task { try? await env.tasks?.deleteTask(id: task.id, deleteWorktree: nil) }
    }
}
```

Add `@Environment(\.appEnvironment) private var env` and small computed `isArchived` (`task.archivedAt != nil`), `online` (WS connected), `defaultRuntime` (from settings, fallback `"bun"`) to `TaskCard`. Call `await env.runMenu?.ensureLoaded(...)` in a `.task`/`onAppear` of the card (or lazily when the menu opens) so scripts/commands are populated. Match the existing optional-accessor pattern.

- [ ] **Step 3: Attach the project context menu** in `ProjectGroup.swift`:

```swift
@ViewBuilder private var projectMenu: some View {
    Button("Create task") { env.taskCreation?.requestNewTask(projectId: project.id) }
    Button("Fork project") { /* fork dialog is 5F; seam */ }
    if let run = env.runMenu {
        let d = run.data(projectId: project.id, projectPath: project.path, taskId: nil,
                         flows: env.flows?.flows ?? [], actions: env.flows?.actions ?? [],
                         hasActiveFlowRun: false, defaultRuntime: defaultRuntime,
                         online: online, showAgentOptions: true)
        if RunMenuViewModel.hasRunMenuItems(d) {
            Menu("Run") { RunMenuItems(data: d, callbacks: run.callbacks(/* … */)) }
        }
    }
    Divider()
    Button("Delete project", role: .destructive) {
        // Remove confirmation dialog is 5F; 5B calls hideProject (reversible) as the safe default.
        Task { try? await env.projects?.hideProject(id: project.id) }
    }
}
```

Attach `.contextMenu { projectMenu }` to the header. Add the same `env`/`online`/`defaultRuntime` helpers.

- [ ] **Step 4: Build + test.** Run: `cd native && swift build` → clean; `swift test` → all green. Verify the `callbacks(...)` factory signature you defined in Task 8 matches both call sites (fix the `/* … */` placeholders to the real argument list).

- [ ] **Step 5: Commit.** `feat(native): sidebar context menus (task + project) with Run submenu` (+ logs).

---

## Task 10: `SidebarToolbar` + `OfflineIndicator`

The bottom toolbar's 4 nav icons and the offline indicator. Ports `components/sidebar/SidebarToolbar.tsx` + `OfflineIndicator.tsx`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/SidebarToolbar.swift`
- Create: `native/Sources/Taskflow/UI/Sidebar/OfflineIndicator.swift`

**Interfaces:**
- Consumes: `UIViewModel` (`toggleFlowManagement`, `toggleScheduleManagement`, `toggleAppearance`, `openSettings`), `AppIcon`, WS-connected status.
- Produces: `SidebarToolbar()`, `OfflineIndicator()`. Used by Task 12.

**Reference:** `SidebarToolbar.tsx` — 4 icon buttons: Flows (`Workflow`), Schedules (`CalendarClock`), Appearance (`Palette`), Settings (`Settings2`). `OfflineIndicator.tsx` — shows `WifiOff` + tooltip only when offline; `Loader2` while checking. 5B gates on WS-connected (internet-connectivity distinction is a seam).

- [ ] **Step 1: Implement `SidebarToolbar`.** Create `SidebarToolbar.swift`:

```swift
import SwiftUI

/// Bottom sidebar nav. Port of components/sidebar/SidebarToolbar.tsx.
struct SidebarToolbar: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env

    var body: some View {
        HStack(spacing: 4) {
            iconButton("Workflow", help: "Flows") { env.ui.toggleFlowManagement() }
            iconButton("CalendarClock", help: "Schedules") { env.ui.toggleScheduleManagement() }
            iconButton("Palette", help: "Appearance") { env.ui.toggleAppearance() }
            iconButton("Settings2", help: "Settings") { env.ui.openSettings() }
        }
    }

    @ViewBuilder private func iconButton(_ icon: String, help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { AppIcon(icon).font(.system(size: 13)) }
            .buttonStyle(.plain)
            .foregroundStyle(theme.color(.sidebarForeground))
            .help(help)
    }
}
```

- [ ] **Step 2: Implement `OfflineIndicator`.** Create `OfflineIndicator.swift`:

```swift
import SwiftUI

/// Shows a WifiOff indicator when the backend WS is disconnected.
/// (Internet-connectivity distinction vs WS is a Phase-6 seam.)
struct OfflineIndicator: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env

    var body: some View {
        if !isConnected {
            AppIcon("WifiOff").font(.system(size: 13))
                .foregroundStyle(theme.color(.destructive))
                .help("No connection to backend")
        }
    }

    private var isConnected: Bool {
        // Match how AppEnvironment exposes connection status (Status.connected). Confirm the accessor.
        env.isConnected
    }
}
```

> Confirm the connection accessor on the environment (the report shows `AppEnvironment.status: Status` with `.connected(port:)`). Expose a convenience `var isConnected: Bool` on the environment if one doesn't exist, or read `status` directly. Don't fabricate an accessor name.

- [ ] **Step 3: Build.** Run: `cd native && swift build` → clean.

- [ ] **Step 4: Commit.** `feat(native): SidebarToolbar + OfflineIndicator` (+ logs).

---

## Task 11: Toolbar header (New Task / New Project) + Master Workspace + Notifications trigger

The top toolbar (New Task / New Project) and the bottom row's Master Workspace button + Notifications bell that opens the popover. These compose existing pieces; no new pure logic. (Kept separate from Task 12 so the toolbar can be reviewed before the full assembly.)

**Files:**
- Create: `native/Sources/Taskflow/UI/Sidebar/SidebarHeaderToolbar.swift` (top: New Task + New Project)
- Create: `native/Sources/Taskflow/UI/Sidebar/SidebarFooter.swift` (bottom: Master Workspace + Notifications bell + OfflineIndicator + SidebarToolbar)

**Interfaces:**
- Consumes: `TaskCreationViewModel` (Task 5), `UIViewModel` (`setMasterWorkspaceActive`, `setActiveProject(nil)`), `NotificationPopover` (Task 3), `SidebarToolbar`/`OfflineIndicator` (Task 10), `AppIcon`, `AppButton`.
- Produces: `SidebarHeaderToolbar()`, `SidebarFooter()`. Used by Task 12.

**Reference:** `TaskSidebar.tsx` — top toolbar shows "New Task" + "New Project" (icons `Plus`/`FolderPlus`); bottom has Master Workspace (`Monitor`), Notifications (`Bell`) popover, OfflineIndicator, SidebarToolbar.

- [ ] **Step 1: Implement `SidebarHeaderToolbar`.** Create the file:

```swift
import SwiftUI

/// Top sidebar toolbar: New Task + New Project. Port of TaskSidebar.tsx header.
struct SidebarHeaderToolbar: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env

    var body: some View {
        HStack(spacing: 6) {
            Button {
                env.taskCreation?.requestNewTask(projectId: env.ui.activeProjectId)
            } label: { Label("Task", systemImage: "plus") }
                .buttonStyle(.plain).font(.system(size: 12)).help("New task (Cmd+N)")
            Spacer()
            Button { env.taskCreation?.requestNewProject() } label: { AppIcon("FolderPlus") }
                .buttonStyle(.plain).help("New project")
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .foregroundStyle(theme.color(.sidebarForeground))
    }
}
```

- [ ] **Step 2: Implement `SidebarFooter`.** Create the file (the bell uses a `.popover`):

```swift
import SwiftUI

/// Bottom sidebar bar: Master Workspace, Notifications, OfflineIndicator, nav toolbar.
struct SidebarFooter: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appEnvironment) private var env
    @State private var notificationsOpen = false

    var body: some View {
        HStack(spacing: 8) {
            Button {
                env.ui.setActiveProject(nil)
                env.tasks?.setActiveTask(nil)
                env.ui.setMasterWorkspaceActive(true)
            } label: { AppIcon("Monitor") }
                .buttonStyle(.plain).help("Master Workspace")

            Button { notificationsOpen.toggle() } label: {
                AppIcon("Bell").overlay(alignment: .topTrailing) {
                    if unreadCount > 0 {
                        Circle().fill(theme.color(.info)).frame(width: 6, height: 6)
                    }
                }
            }
            .buttonStyle(.plain).help("Notifications")
            .popover(isPresented: $notificationsOpen, arrowEdge: .top) {
                NotificationPopover { note in
                    notificationsOpen = false
                    navigate(to: note)
                }
            }

            OfflineIndicator()
            Spacer()
            SidebarToolbar()
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .foregroundStyle(theme.color(.sidebarForeground))
    }

    private var unreadCount: Int { (env.notifications?.notifications ?? []).filter { !$0.read }.count }

    private func navigate(to note: Notification) {
        env.ui.setActiveProject(note.projectId)
        if let taskId = note.taskId { env.tasks?.setActiveTask(taskId) }
        env.ui.setFocusedPanel(.workspace)
        // Session-tab focus (note.sessionId) is a seam: requires session-tab activation wiring.
    }
}
```

- [ ] **Step 3: Build.** Run: `cd native && swift build` → clean.

- [ ] **Step 4: Commit.** `feat(native): sidebar header + footer toolbars (new task/project, master, notifications)` (+ logs).

---

## Task 12: Assemble `SidebarView`

Replace the placeholder `SidebarView` body with the full composition: header toolbar, scrollable project list (`ProjectGroup`s driven by collapse state + drag-reorder), footer. Ensure the initial data (projects/tasks/notifications/flows/actions) is loaded (the `useSidebarData` equivalent — likely already done in `AppEnvironment`; verify and fill any gap). Add archive-mode rendering + empty states.

**Files:**
- Modify: `native/Sources/Taskflow/UI/Shell/SidebarView.swift`

**Interfaces:**
- Consumes: everything from Tasks 2–11.

- [ ] **Step 1: Verify initial data load.** Confirm `AppEnvironment` (or the shell's `.task`) calls `projects.load()`, `tasks.load()`, `flows.load()`, `notifications.load()` on connect. If notifications/flows aren't loaded there, add `await env.notifications?.load()` / `await env.flows?.load()` to the same place the others load (the `useSidebarData` initial-fetch parity). Do not duplicate loads.

- [ ] **Step 2: Rewrite `SidebarView.body`.** Replace the placeholder list with:

```swift
var body: some View {
    VStack(spacing: 0) {
        SidebarHeaderToolbar()
        Divider()
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 4) {
                if visibleProjects.isEmpty {
                    Text("No projects yet")
                        .font(.system(size: 12)).foregroundStyle(theme.color(.mutedForeground))
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    ForEach(visibleProjects, id: \.id) { project in
                        ProjectGroup(
                            project: project,
                            tasks: tasks(for: project.id),
                            isActive: env.ui.activeProjectId == project.id,
                            activeTaskId: env.tasks?.activeTaskId,
                            open: !(env.ui.collapsedProjectIds.contains(project.id)),
                            onOpenChange: { env.ui.setProjectCollapsed(project.id, !$0) },
                            onProjectClick: { selectProject(project.id) },
                            onTaskClick: { selectTask($0, in: project.id) }
                        )
                    }
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
        }
        Divider()
        SidebarFooter()
    }
    .background(theme.color(.sidebarBackground))
}
```

Add the helpers (match existing names where present):

```swift
private var allProjects: [Project] { env.projects?.projects ?? [] }
private var visibleProjects: [Project] { allProjects.filter { $0.hidden != true } }
private func tasks(for projectId: String) -> [TaskItem] {
    let all = env.tasks?.tasks ?? []
    return all.filter { $0.projectId == projectId && $0.parentId == nil }
}
private func selectProject(_ id: String) {
    env.ui.setFocusedPanel(.workspace)
    env.ui.setMasterWorkspaceActive(false)
    env.ui.setActiveProject(id)
    env.tasks?.setActiveTask(nil)
}
private func selectTask(_ id: String, in projectId: String) {
    env.ui.setFocusedPanel(.workspace)
    env.ui.setMasterWorkspaceActive(false)
    env.ui.setActiveProject(projectId)
    env.tasks?.setActiveTask(id)
}
```

> Subtask nesting (rendering `parentId != nil` tasks indented under their parent, with expand state) is present in TS; 5B renders top-level tasks and their pinned/unpinned split via `ProjectGroup`. If subtask rendering is straightforward to add here (filter children of an expanded task into indented `TaskCard(isSubtask: true)`), include it; otherwise note subtask-tree expansion as a small follow-up seam. Keep archive mode: when `env.tasks?.showArchive == true`, render `archivedTasks` grouped the same way with the "No archived tasks" empty state.

- [ ] **Step 3: Build + full test.** Run: `cd native && swift build` → clean; `swift test` → all green (prior 153 + the 5B suites).

- [ ] **Step 4: Commit.** `feat(native): assemble SidebarView (list + toolbars + collapse + reorder)` (+ logs).

---

## Task 13: Sidebar keyboard navigation

Port `useSidebarNavigation.ts`: Cmd+Up/Down move focus through the flattened visible items (projects + their top-level tasks); Cmd+Left collapses/focuses parent; Cmd+Right expands; Cmd+0 → Master Workspace; Cmd+1–9 quick-select. The next-item reducer is TDD'd; key handling wires it to `UIViewModel.sidebarFocusedItem`.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/SidebarNavigation.swift`
- Test: `native/Tests/TaskflowTests/SidebarNavigationTests.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/SidebarView.swift` (attach key handling)

**Interfaces:**
- Consumes: `SidebarFocusedItem` (existing in `UIViewModel`).
- Produces: `SidebarNavigation.next(items:current:direction:)` + `enum NavDirection { case up, down }`.

**Reference:** `useSidebarNavigation.ts` — the flattened ordering is each visible project followed by its top-level tasks; Up/Down wrap or clamp per the TS (read it in Step 1).

- [ ] **Step 1: Read** `useSidebarNavigation.ts` to confirm clamp-vs-wrap at the ends and how the flattened list is built (project then its tasks, in display order; collapsed projects contribute only the project row).

- [ ] **Step 2: Write the failing reducer test.** Create `SidebarNavigationTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class SidebarNavigationTests: XCTestCase {
    private let items: [SidebarFocusedItem] = [
        .init(type: .project, id: "p1"),
        .init(type: .task, id: "t1"),
        .init(type: .project, id: "p2"),
    ]
    func testDownFromNil() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: nil, direction: .down), items[0])
    }
    func testDownAndUp() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[0], direction: .down), items[1])
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[1], direction: .up), items[0])
    }
    func testClampAtEnds() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[2], direction: .down), items[2])
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[0], direction: .up), items[0])
    }
}
```

(Adjust clamp vs wrap to match Step 1's reading; keep the test pinned to the real behavior.)

- [ ] **Step 3: Run — verify fail.** Run: `cd native && swift test --filter SidebarNavigationTests` → FAIL.

- [ ] **Step 4: Implement `SidebarNavigation`.** Create `SidebarNavigation.swift`:

```swift
import Foundation

enum NavDirection { case up, down }

/// Pure next-focus reducer for sidebar keyboard nav. Port of useSidebarNavigation.ts ordering.
enum SidebarNavigation {
    nonisolated static func next(items: [SidebarFocusedItem],
                                 current: SidebarFocusedItem?,
                                 direction: NavDirection) -> SidebarFocusedItem? {
        guard !items.isEmpty else { return nil }
        guard let current, let idx = items.firstIndex(of: current) else {
            return direction == .down ? items.first : items.last
        }
        switch direction {
        case .down: return items[min(idx + 1, items.count - 1)]
        case .up:   return items[max(idx - 1, 0)]
        }
    }
}
```

- [ ] **Step 5: Wire key handling** in `SidebarView` (or the shell): when `env.ui.focusedPanel == .sidebar`, handle Cmd+Up/Down via `SidebarNavigation.next(...)` over the flattened visible items → `env.ui.setSidebarFocusedItem(...)`; Cmd+Left/Right → `setProjectCollapsed`; Cmd+0 → Master Workspace; Cmd+1–9 → quick-select. Use the existing key-handling mechanism in the shell (grep for `.onKeyPress`/key routing already used for tabs); do not add a new global monitor. If the shell's key routing isn't easily reachable from `SidebarView`, implement Up/Down/Left/Right here and leave Cmd+digit quick-select as a noted seam.

- [ ] **Step 6: Run + build.** `cd native && swift test --filter SidebarNavigationTests` → PASS; `swift build` → clean; `swift test` → all green.

- [ ] **Step 7: Commit.** `feat(native): sidebar keyboard navigation (Cmd+arrows/digits)` (+ logs).

---

## Task 14: Visual verification + results doc (integration gate)

Prove the assembled sidebar renders and behaves against the live (sandboxed) backend, then write the results spec + acceptance note and update memory.

**Files:**
- Create: `docs/superpowers/specs/2026-06-28-phase5b-sidebar-results.md`
- Modify: `.superpowers/sdd/progress.md` (5B ledger entries)
- Evidence: `native/evidence/p5b-01-sidebar.png` (+ more as useful)

- [ ] **Step 1: Full build + test.** Run: `cd native && swift build` → clean; `swift test` → all green. Record the test count.

- [ ] **Step 2: Build the dev app + launch against the SANDBOX sidecar.** Per `[[project_native_sidecar_sandbox]]` the dev `SidecarManager` must sandbox `HOME` (`~/.taskflow-native-dev`) — NEVER the production data dir, or it crashes the running host Taskflow. Build via `bash native/scripts/build-app.sh`, launch `native/.build/app/TaskflowDev.app`.

- [ ] **Step 3: Dogfood checklist (screenshot each).** Confirm and capture:
  - Projects + tasks render with correct names/title-fallbacks; active project/task highlight.
  - Collapse/expand a project (chevron); collapsed header shows the rolled-up status dot.
  - Drag a project to reorder; order persists (reconnect/relaunch keeps it).
  - Worktree badge shows branch + PR; session badges show type + status dot color.
  - Right-click a task → context menu with Pin/Archive/Delete + Run submenu (scripts/.claude/flows/actions/agents). Right-click a project → Create task/Fork/Run/Delete.
  - "Run → Claude → Run" launches a session in the workspace.
  - Bell opens the notifications popover (unread dot, dismiss, dismiss-all).
  - Footer nav buttons toggle Flows/Schedules/Appearance/Settings panels; Master Workspace activates.
  - New Task / New Project buttons fire the request seam (observe `taskCreation` state changes; the actual forms are 5F — note this).
  Save `native/evidence/p5b-01-sidebar.png` (+ extras).

- [ ] **Step 4: Write the results spec.** Create `docs/superpowers/specs/2026-06-28-phase5b-sidebar-results.md`: what landed, test count, the deferred seams (creation dialogs/MissingLocation/Update → 5F; "Run with options"/flow-inputs → 5F; live diff/behind counts → 5C/diff-store; agent availability fallback; session-tab focus on notification navigate; subtask-tree expansion if deferred; connectivity-vs-WS distinction), and the live-dogfood evidence. Mirror the 5A results spec's structure.

- [ ] **Step 5: Update the SDD ledger + memory.** Append 5B entries to `.superpowers/sdd/progress.md`. Update `[[project_native_app_experiment_status]]` memory: 5B COMPLETE, next = 5C Panels; record the new HEAD + the deferred-to-5F sidebar modal list.

- [ ] **Step 6: Commit.** `Phase 5B complete — results doc + acceptance note` (+ logs + evidence file logged).

---

## Self-Review (completed by plan author)

**Spec coverage (master-plan unit 5.1 + the sidebar source):**
- **Task/project list breadth** → Tasks 6 (TaskCard), 7 (ProjectGroup), 12 (assembly) — title fallback, worktree/session badges, pinned/unpinned split, active highlight, collapse/expand, archive mode. ✅
- **Drag-reorder** → Task 7 (`ProjectDragItem` + `.draggable`/`.dropDestination` reusing the proven tab pattern; `SidebarReorder.buildReorderedProjectIds` preserves hidden slots; persists via `ProjectViewModel.reorderProjects`). ✅
- **Notifications** → Task 2 (`NotificationViewModel`, the missing store) + Task 3 (popover) + Task 11 (bell trigger + unread dot + navigate). ✅
- **Toolbars** → Task 10 (`SidebarToolbar` + `OfflineIndicator`) + Task 11 (header New Task/Project + footer Master Workspace + bell). ✅
- **Context menus + run menus** → Task 8 (`RunMenuViewModel` ports `useRunMenu`/`run-menu.ts`) + Task 9 (task + project `.contextMenu` + `RunMenuItems` section-faithful submenu). ✅
- **Keyboard navigation** → Task 13 (`SidebarNavigation` reducer + key wiring). ✅
- **Status aggregation** → Task 1 (`SidebarStatus`, ported priority attention>working>initializing). ✅
- Out of scope by design (5F dialog host): NewTask/NewProject/MissingLocation/Update/AgentOptions/FlowInput dialogs — wired via the `TaskCreationViewModel` request seam + menu callback seams. Out of scope (5C/diff-store): live diff/behind counts. Out of scope (later): real agent-availability fetch.

**Placeholder scan:** every code step shows complete Swift. The remaining explicit lookups ("read this TS file in Step 1") are bounded single-file reads to pin verbatim copy/field names (notification-store payloads, useRunMenu callback bodies, TaskCard title-length, useSidebarNavigation clamp/wrap) with fallback code already written — the 5A pattern, not deferred design. Two intentional seams carry `// …` markers with a one-line explanation (run-menu callbacks factory argument list resolved in Task 9 Step 4; subtask-tree/connectivity seams noted).

**Type consistency:** VM method names match the codebase map (`updateTask(id:title:description:notes:worktree:pinned:)`, `archiveTask(id:)`, `unarchiveTask(id:)`, `deleteTask(id:deleteWorktree:)`, `reorderProjects(orderedIds:)`, `hideProject(id:)`, `setProjectCollapsed(_:_:)`, `setActiveProject(_:)`, `setMasterWorkspaceActive(_:)`, `createSession(...)`, `sendInput(...)`); generated type fields match (`TaskItem.worktree`, `TaskWorktree.branch`/`.pr`, `TaskWorktreePr.number: Double`, `Notification` 7 fields, `SessionRef.type`/`.id`, `AgentType` 6 cases, `SessionStatus` 3 cases); shared helper/type names (`SidebarStatus`, `SidebarReorder`, `RunMenuData`/`RunMenuCallbacks`, `RunMenuItems`, `SessionBadge.colorToken`/`dotToken`, `SidebarNavigation.next`) are used identically across tasks. `env.*` accessor optionality is flagged for per-call confirmation against `AppEnvironment.swift` (the one place the map left ambiguous).
```
# Phase 3 — Structural Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Taskflow Electron state layer to native Swift `@Observable` view models and build the structural shell on top of it — a live 6-pane `AppShell` plus a workspace of draggable, splittable tab groups — all driven by real WebSocket data.

**Architecture:** Adopt Apple's **Observation framework** (`@Observable`, macOS 14+) for every domain view model. Observation gives per-property access tracking, which is the native equivalent of Zustand "stable selectors": a SwiftUI view re-renders only when a property it actually *read* changes — solving the project's Zustand reactivity gotcha at the framework level, and incidentally fixing the carried-forward stale-theme bug (nested-observable changes now propagate through `@Environment`). The view models are 1:1 ports of the `packages/ui/src/stores/*.ts` Zustand stores: each owns plain stored properties, exposes pure reducer logic (TDD'd), and `bind()`s to backend WS events through the Phase-2 `WSClient`. The shell reproduces the Electron pane map and the `tabsByWorkspace` / `splitByWorkspace` data model faithfully so Phase 6 parity is mechanical.

**Tech Stack:** Swift 6 (language mode v6), SwiftUI + Observation (`@Observable`/`@Bindable`), macOS 14+, the Phase-2 `WSClient`/`WSCodec` typed RPC, generated `MessageType` + model structs under `native/Sources/Taskflow/Generated/`, `swift test` (XCTest), `bun` for any codegen.

## Global Constraints

- **Package manager:** always `bun` (never `npm`/`yarn`) for any TS/codegen command.
- **No `as any` equivalent:** no `Any`-typed escape hatches in Swift where a real type exists; decode through the generated model structs. `AnyCodable` is allowed only where the generated wire type already uses it.
- **Reusable types, no premature export:** keep types where they're used; do not mark a type/member non-`private`/`internal`-wider than its actual use. Reuse existing generated types (`TaskItem`, `Project`, `MessageType`, …) — do not red`struct` a type codegen already emits.
- **No disabling lints / no `// swiftlint:disable`-style suppression.** Solve the underlying issue.
- **No co-author trailer** in commits.
- **Deployment floor after Task 1:** `.macOS(.v14)`, Swift language mode `.v6`. Every view model is `@MainActor @Observable`.
- **Isolation is sacred:** never regress the sidecar sandbox (`SidecarSupport.resolveSandboxHome` → `~/.taskflow-native-dev`, dev instanceId, host-identity env stripping). Run the app only via the sandboxed default mode. See [[project_native_sidecar_sandbox]].
- **Behavioral source of truth:** for every view-model task, the named `packages/ui/src/stores/<store>.ts` file is the spec. Port **every** action/reducer/event-subscription in that file, not only the ones shown here. The code shown per task is the *pattern + the tricky cases*; the implementer ports the full surface and tests it the same way.
- **Home base:** all new code lives under `native/`. Leave `experiments/native-spike/` and `experiments/native-slice/` untouched (Phase-0/1 evidence).
- **WS transport API (Phase 2, do not rebuild):**
  ```swift
  // native/Sources/Taskflow/Transport/WSClient.swift  (@MainActor)
  func requestRaw(_ type: MessageType, payload: [String: Any],
                  correlationId: String = UUID().uuidString,
                  timeoutNanoseconds: UInt64 = 30_000_000_000) async throws -> Data
  func request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res
  func send(_ type: MessageType, payload: [String: Any])
  @discardableResult
  func on<E: Decodable>(_ type: MessageType, _ handler: @escaping (E) -> Void) -> () -> Void
  ```

---

## File Structure

New tree under `native/Sources/Taskflow/` (additions; existing Phase-2 files modified only where noted):

```
App/
  AppEnvironment.swift        MODIFY → @Observable; owns + binds all view models; real port in Status
  TaskflowApp.swift           MODIFY → @State env, @Environment injection, thread theme, real RootView
Theme/
  ThemeStore.swift            MODIFY → @Observable (drop ObservableObject/@Published)
UI/Primitives/
  ThemeEnvironment.swift      (unchanged key); injected fresh from root after Task 1
  PrimitivesGallery.swift     MODIFY → drop the local \.appTheme re-injection hack
ViewModels/
  ViewModel.md                Convention note (the @Observable view-model pattern + why it solves the gotcha)
  WorkspaceKey.swift          NEW  workspace-key helpers (task:/project:/master/:right)
  Tab.swift                   NEW  Tab, TabType, PaneId, WorkspaceSplit value types
  TaskViewModel.swift         NEW  port of stores/task-store.ts
  ProjectViewModel.swift      NEW  port of stores/project-store.ts
  SettingsViewModel.swift     NEW  port of stores/settings-store.ts (layout hydrate/persist)
  UIViewModel.swift           NEW  port of stores/ui-store.ts (panels, widths, splits, focus)
  SessionViewModel.swift      NEW  port of stores/session-store.ts (tabs/active/reorder/move) + helpers
  FlowViewModel.swift         NEW  port of stores/flow-store.ts
  SearchViewModel.swift       NEW  port of stores/search-store.ts
  FileViewModel.swift         NEW  port of stores/file-store.ts
UI/Shell/
  AppShell.swift              NEW  6-pane layout driven by UIViewModel
  ResizeHandle.swift          NEW  draggable divider → width/ratio deltas (port of ResizeHandle.tsx)
  SidebarView.swift           NEW  live project/task list (real data)
  WorkspaceView.swift         NEW  hosts the SplitContainer for the active workspace
UI/Workspace/
  TabBar.swift                NEW  horizontal tabs for one pane (drag-reorder)
  TabItem.swift               NEW  one draggable tab (Transferable)
  SplitContainer.swift        NEW  left/right tab-pane groups + split resize + cross-pane drop
  PanePlaceholder.swift       NEW  temporary tab-content host (real panes are Phase 4)
Tests/TaskflowTests/
  TaskViewModelTests.swift, ProjectViewModelTests.swift, SettingsViewModelTests.swift,
  UIViewModelTests.swift, SessionViewModelTests.swift, FlowViewModelTests.swift,
  SearchViewModelTests.swift, FileViewModelTests.swift, WorkspaceKeyTests.swift
```

Pure reducer logic that is non-trivial (tab move/reorder, width/ratio clamps, event upserts) is implemented as testable `static` functions and TDD'd directly; SwiftUI/AppKit-integration tasks (shell, drag) are verified by build + launch + screenshot evidence under `native/evidence/`, matching the Phase-1/2 protocol.

---

## Task 1: Adopt Observation — bump platform, migrate Phase-2 observables, thread theme correctly

**Files:**
- Modify: `native/Package.swift:6` (`.macOS(.v13)` → `.macOS(.v14)`)
- Modify: `native/Sources/Taskflow/Theme/ThemeStore.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift`
- Modify: `native/Sources/Taskflow/App/TaskflowApp.swift`
- Modify: `native/Sources/Taskflow/UI/PrimitivesGallery.swift`

**Interfaces:**
- Produces:
  - `@MainActor @Observable final class ThemeStore` with `private(set) var current: AppTheme`, `let all: [AppTheme]`, `func select(id: String)` (signatures unchanged; only the observability mechanism changes).
  - `@MainActor @Observable final class AppEnvironment` with `private(set) var status: Status`, `let themeStore: ThemeStore`, `private(set) var client: WSClient?`, `func boot() async`, `func shutdown()`.
  - Root injects a *fresh* `\.appTheme` so primitives theme live without local re-injection.

- [ ] **Step 1: Bump deployment target.** In `native/Package.swift` change `platforms: [.macOS(.v13)]` to `platforms: [.macOS(.v14)]`. Leave both targets' `swiftSettings: [.swiftLanguageMode(.v6)]`.

- [ ] **Step 2: Migrate `ThemeStore` to `@Observable`.** Replace the class header and drop `@Published`:

```swift
import SwiftUI
import Observation

@MainActor
@Observable
final class ThemeStore {
    private(set) var current: AppTheme
    @ObservationIgnored let all: [AppTheme]

    init(defaultId: String = "catppuccin-mocha") {
        let files = ThemeStore.loadAllFiles()
        let themes = files.map(AppTheme.init).sorted { $0.id < $1.id }
        all = themes
        current = themes.first { $0.id == defaultId } ?? themes.first ?? .fallback
    }

    func select(id: String) {
        if let t = all.first(where: { $0.id == id }) { current = t }
    }

    nonisolated static func loadAllFiles() -> [ResolvedThemeFile] { /* unchanged */ }
    nonisolated static func loadFile(id: String) throws -> ResolvedThemeFile { /* unchanged */ }
}
```

(`all` is immutable post-init → `@ObservationIgnored` keeps it out of the tracking machinery. Keep the two `nonisolated static` loaders verbatim.)

- [ ] **Step 3: Migrate `AppEnvironment` to `@Observable`.** Replace `ObservableObject`/`@Published`:

```swift
import SwiftUI
import Observation

@MainActor
@Observable
final class AppEnvironment {
    enum Status: Equatable { case connecting, connected(port: Int), failed(String) }
    private(set) var status: Status = .connecting
    @ObservationIgnored let themeStore = ThemeStore()
    @ObservationIgnored private let sidecar: SidecarManager
    @ObservationIgnored private(set) var client: WSClient?

    init() {
        let repoRoot = ProcessInfo.processInfo.environment["TASKFLOW_REPO_ROOT"].map(URL.init(fileURLWithPath:))
        sidecar = SidecarManager(resourcesURL: Bundle.main.resourceURL, devRepoRoot: repoRoot)
    }
    // boot()/shutdown() unchanged for now (Task 8 rewires boot()).
}
```

(`themeStore` is itself `@Observable`; marking the *reference* `@ObservationIgnored` is correct — views observe `themeStore` directly, not through `env`'s tracking. This is exactly why the old stale-theme bug disappears.)

- [ ] **Step 4: Update `TaskflowApp` for Observation + correct theme threading.**

```swift
import SwiftUI

@main
struct TaskflowApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup("Taskflow") {
            RootView()
                .environment(env)
                .environment(\.appTheme, env.themeStore.current) // fresh: re-reads tracked `current`
                .frame(minWidth: 900, minHeight: 600)
                .task { await env.boot() }
                .onDisappear { env.shutdown() }
        }
        .windowStyle(.titleBar)
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    var body: some View {
        VStack(spacing: 0) {
            statusBar
            PrimitivesGallery(themeStore: env.themeStore)
        }
    }
    private var statusBar: some View { /* unchanged switch over env.status */ }
}
```

(Because the closure reads `env.themeStore.current` — a tracked property — the WindowGroup content re-evaluates when the theme changes and re-injects a fresh `\.appTheme`. No nested-ObservableObject staleness.)

- [ ] **Step 5: Drop the local re-injection hack in `PrimitivesGallery`.** Change `@ObservedObject var themeStore: ThemeStore` to `var themeStore: ThemeStore` (it is now `@Observable`; reading `themeStore.current`/`.all` auto-tracks). Remove the trailing `.environment(\.appTheme, theme)` line and the `let theme = themeStore.current` local if it was only used for that injection. The picker binding `Binding(get: { themeStore.current.id }, set: { themeStore.select(id: $0) })` stays.

- [ ] **Step 6: Build.**

Run: `cd native && swift build`
Expected: builds clean on the macOS 14 toolchain, no `ObservableObject`/`@Published`/`@StateObject`/`@EnvironmentObject` left in the four edited files.

- [ ] **Step 7: Run the existing test suite (regression).**

Run: `cd native && swift test`
Expected: the Phase-2 suite (25 swift tests) still passes. Observation migration is source-level only.

- [ ] **Step 8: Visual proof the stale-theme bug is fixed.** Build + launch the app bundle, switch the theme in the gallery picker, screenshot before/after.

Run: `cd native && ./scripts/build-app.sh && open .build/app/Taskflow.app` (use the project's existing build-app script; confirm the sandboxed sidecar comes up via the status bar). Switch theme Mocha → Dracula.
Expected: primitives recolor live **without** the gallery's old local re-injection. Save `native/evidence/p3-01-theme-threaded-{mocha,dracula}.png`.

- [ ] **Step 9: Commit.**

```bash
git add native/Package.swift native/Sources/Taskflow native/evidence/p3-01-*.png
git commit -m "feat(native): adopt Observation framework (macOS 14); thread theme via env, drop stale-injection hack"
```

---

## Task 2: View-model pattern + `TaskViewModel` (the template)

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/ViewModel.md`
- Create: `native/Sources/Taskflow/ViewModels/TaskViewModel.swift`
- Test: `native/Tests/TaskflowTests/TaskViewModelTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/task-store.ts` (state shape lines incl. `tasks`, `archivedTasks`, `showArchive`, `activeTaskId`, `loading`, `taskLogs`; actions `fetchTasks`/`createTask`/`applyTaskUpdate`/`updateTask`/`archiveTask`/`unarchiveTask`/`deleteTask`/`setActiveTask`/`fetchTaskLog`/`appendLogEntry`; module-level WS subs `task:updated`→`applyTaskUpdate`, `task:created`→dedup+append, `task:log-added`→`appendLogEntry`).

**Interfaces:**
- Consumes: `WSClient` (Global Constraints), `MessageType.taskList/.taskCreate/.taskUpdate/.taskArchive/.taskUnarchive/.taskDelete/.taskUpdated/.taskCreated/.taskLogAdded` (verify exact case names in `Generated/MessageType.swift`), `TaskItem`, `TaskLogEntry` (from `Generated/Models/TaskTypes.swift`).
- Produces:
  ```swift
  @MainActor @Observable final class TaskViewModel {
      private(set) var tasks: [TaskItem]
      private(set) var archivedTasks: [TaskItem]
      var showArchive: Bool
      private(set) var activeTaskId: String?
      private(set) var loading: Bool
      private(set) var taskLogs: [String: [TaskLogEntry]]
      init(client: WSClient)
      func load() async                         // task:list → tasks
      func bind()                               // subscribe task:updated/created/log-added
      func setActiveTask(_ id: String?)
      // create/update/archive/unarchive/delete: async RPC then local reducer
      // pure reducers (static, TDD'd):
      static func upsertUpdated(_ tasks: [TaskItem], _ updated: TaskItem) -> [TaskItem]
      static func insertCreated(_ tasks: [TaskItem], _ created: TaskItem) -> [TaskItem] // dedup by id
      static func appendLog(_ logs: [String: [TaskLogEntry]], taskId: String, entry: TaskLogEntry) -> [String: [TaskLogEntry]]
  }
  ```

- [ ] **Step 1: Write the convention note `ViewModel.md`.** Document the pattern every VM follows: `@MainActor @Observable final class`; plain stored props (no `@Published`); `init(client:)`; `func load() async` for the initial RPC; `func bind()` to register WS-event handlers via `client.on(_:)` (called once at composition by `AppEnvironment` — replaces TS module-level `subscribe` side-effects); pure non-trivial mutations as `static` reducers for testability. Add the one-paragraph rationale: **Observation tracks per-property reads, so a view that reads only `tasks` does not re-render when `loading` flips — the Zustand stable-selector discipline is automatic; do NOT collapse state into a single computed blob, keep granular stored properties.** Link the gotcha memory.

- [ ] **Step 2: Write failing reducer tests.**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class TaskViewModelTests: XCTestCase {
    private func task(_ id: String, _ title: String = "t", status: String = "active") -> TaskItem {
        TaskItem(id: id, projectId: "p", parentId: nil, title: title, description: "",
                 notes: "", worktree: TaskWorktree(enabled: false, path: nil, branch: nil, pr: nil),
                 sessions: [], createdAt: "0", status: status, archivedAt: nil, pinned: false, initCommand: nil)
    }

    func testUpsertUpdatedReplacesInPlace() {
        let start = [task("a", "old"), task("b")]
        let out = TaskViewModel.upsertUpdated(start, task("a", "new"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])           // order preserved
        XCTAssertEqual(out.first?.title, "new")             // replaced
    }

    func testUpsertUpdatedAppendsUnknown() {
        let out = TaskViewModel.upsertUpdated([task("a")], task("z"))
        XCTAssertEqual(out.map(\.id), ["a", "z"])
    }

    func testInsertCreatedDedupes() {
        let start = [task("a")]
        XCTAssertEqual(TaskViewModel.insertCreated(start, task("a")).map(\.id), ["a"]) // no dup
        XCTAssertEqual(TaskViewModel.insertCreated(start, task("b")).map(\.id), ["a", "b"])
    }

    func testAppendLogCreatesAndAppends() {
        let e1 = TaskLogEntry.sample(id: "1")   // construct via the generated initializer
        let one = TaskViewModel.appendLog([:], taskId: "t", entry: e1)
        XCTAssertEqual(one["t"]?.count, 1)
        let e2 = TaskLogEntry.sample(id: "2")
        let two = TaskViewModel.appendLog(one, taskId: "t", entry: e2)
        XCTAssertEqual(two["t"]?.map(\.id), ["1", "2"])
    }
}
```

(If `TaskLogEntry` has no convenience sample, build it inline with its real generated fields — check `Generated/Models/TaskTypes.swift`. Do not add a test-only initializer to production types; put any helper in the test file.)

- [ ] **Step 3: Run tests — verify they fail (types/methods undefined).**

Run: `cd native && swift test --filter TaskViewModelTests`
Expected: FAIL — `TaskViewModel` undefined.

- [ ] **Step 4: Implement `TaskViewModel`.** Port the full `task-store.ts` surface. Reducers:

```swift
static func upsertUpdated(_ tasks: [TaskItem], _ updated: TaskItem) -> [TaskItem] {
    if let i = tasks.firstIndex(where: { $0.id == updated.id }) {
        var copy = tasks; copy[i] = updated; return copy
    }
    return tasks + [updated]
}
static func insertCreated(_ tasks: [TaskItem], _ created: TaskItem) -> [TaskItem] {
    tasks.contains(where: { $0.id == created.id }) ? tasks : tasks + [created]
}
static func appendLog(_ logs: [String: [TaskLogEntry]], taskId: String, entry: TaskLogEntry) -> [String: [TaskLogEntry]] {
    var copy = logs; copy[taskId, default: []].append(entry); return copy
}
```

`load()` does `let resp: TaskListResponse = try await client.request(.taskList, payload: [:]); tasks = resp.tasks`. `bind()` registers `client.on(.taskUpdated) { (t: TaskItem) in self.tasks = Self.upsertUpdated(self.tasks, t) }` and the created/log-added handlers (decode payloads via their generated types). Mutating actions (`createTask` etc.) do the RPC then rely on the broadcast event for the local update where the TS store does (match TS exactly — don't double-apply).

- [ ] **Step 5: Run tests — verify pass.**

Run: `cd native && swift test --filter TaskViewModelTests`
Expected: PASS.

- [ ] **Step 6: Full build (no regressions).**

Run: `cd native && swift build`
Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels native/Tests/TaskflowTests/TaskViewModelTests.swift
git commit -m "feat(native): @Observable view-model pattern + TaskViewModel (TDD reducers)"
```

---

## Task 3: `ProjectViewModel` + `SettingsViewModel`

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/ProjectViewModel.swift`
- Create: `native/Sources/Taskflow/ViewModels/SettingsViewModel.swift`
- Test: `native/Tests/TaskflowTests/ProjectViewModelTests.swift`, `native/Tests/TaskflowTests/SettingsViewModelTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/project-store.ts` (state `projects`, `loading`; actions `fetchProjects`/`addProject`/`updateProject`/`hideProject`/`removeProject`/`forkProject`/`reorderProjects`; WS subs `project:created`/`project:removed`/`project:updated`/`project:reordered`; cross-dep: on active project change it calls `TaskViewModel.fetchTasks` — model this as an injected closure, NOT a hard reference) and `packages/ui/src/stores/settings-store.ts` (state `settings`, `dataDirInfo`; actions `fetchSettings`/`updateSettings`/`fetchDataDir`/`updateDataDir`; calls `UIViewModel.hydrateLayout` — also via injected closure, wired in Task 8).

**Interfaces:**
- Produces:
  ```swift
  @MainActor @Observable final class ProjectViewModel {
      private(set) var projects: [Project]
      private(set) var loading: Bool
      init(client: WSClient)
      func load() async
      func bind()
      static func applyReorder(_ projects: [Project], orderedIds: [String]) -> [Project]
      static func applyUpdated(_ projects: [Project], _ updated: Project) -> [Project]
      static func applyRemoved(_ projects: [Project], id: String) -> [Project]
      static func applyCreated(_ projects: [Project], _ created: Project) -> [Project] // dedup
  }
  @MainActor @Observable final class SettingsViewModel {
      private(set) var settings: AppSettings?      // generated type name; verify in SettingsTypes.swift
      private(set) var dataDirInfo: DataDirInfo?    // verify generated name
      var onLayoutHydrate: ((LayoutPanels) -> Void)?  // injected in Task 8
      init(client: WSClient)
      func load() async
      func updateSettings(_ patch: [String: Any]) async
  }
  ```

- [ ] **Step 1: Write failing `ProjectViewModelTests`** for the four reducers (mirror the Task-2 test style): `applyReorder` reorders by `orderedIds` and keeps any not-listed at the end in original order; `applyUpdated` replaces in place; `applyRemoved` drops by id; `applyCreated` dedups. Construct `Project` via its generated initializer (check `Generated/Models/ProjectTypes.swift`).

- [ ] **Step 2: Run — verify fail.** `cd native && swift test --filter ProjectViewModelTests` → FAIL (undefined).

- [ ] **Step 3: Implement `ProjectViewModel`** porting the full `project-store.ts`. The active-project→fetchTasks cross-dependency is an `var onActiveProjectChanged: ((String?) -> Void)?` closure (default nil), invoked where the TS store calls `useTaskStore.fetchTasks()`; wired in Task 8. Reducers as specified.

- [ ] **Step 4: Run — verify pass.** `swift test --filter ProjectViewModelTests` → PASS.

- [ ] **Step 5: Write failing `SettingsViewModelTests`.** Test the pure piece: decoding a sample settings JSON into `AppSettings` and that `load()`’s decode path is exercised via a tiny fixture (decode `AppSettings` from a literal JSON string built from the generated fields). Keep it to decode + a hydrate-callback firing test (set `onLayoutHydrate`, call the internal apply, assert the closure received the panels). Avoid hitting a live socket in unit tests.

- [ ] **Step 6: Run — verify fail.** `swift test --filter SettingsViewModelTests` → FAIL.

- [ ] **Step 7: Implement `SettingsViewModel`** porting `settings-store.ts`. `updateSettings` sends `MessageType.settingsUpdate` (verify case) with the patch; `load()` fetches + decodes + invokes `onLayoutHydrate?(settings.layout.panels)`.

- [ ] **Step 8: Run — verify pass + full build.** `swift test --filter SettingsViewModelTests` → PASS; then `swift build` → clean.

- [ ] **Step 9: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels/ProjectViewModel.swift native/Sources/Taskflow/ViewModels/SettingsViewModel.swift native/Tests/TaskflowTests/ProjectViewModelTests.swift native/Tests/TaskflowTests/SettingsViewModelTests.swift
git commit -m "feat(native): ProjectViewModel + SettingsViewModel (TDD reducers, injected cross-deps)"
```

---

## Task 4: `UIViewModel` — panels, widths, splits, focus

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/Tab.swift` (value types — defined here, consumed by Session/UI)
- Create: `native/Sources/Taskflow/ViewModels/WorkspaceKey.swift`
- Create: `native/Sources/Taskflow/ViewModels/UIViewModel.swift`
- Test: `native/Tests/TaskflowTests/UIViewModelTests.swift`, `native/Tests/TaskflowTests/WorkspaceKeyTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/ui-store.ts` — clamps `SIDEBAR 180–350`, `FILE_EXPLORER 150–500`, `FLOW_PANEL 150–400`, `TASK_INFO 150–500`; `splitByWorkspace[key] = { open, ratio(0.2–0.8), activePane }`; actions `toggleSplit`/`setSplitRatio`/`setActivePane`/`getSplit`, panel toggles, `setSidebarWidth`-style setters, `hydrateLayout`, `register/unregisterPanel`, `setProjectCollapsed`. `searchPanelOpen` and `fileExplorerOpen` are mutually exclusive.

**Interfaces:**
- Produces:
  ```swift
  // Tab.swift
  enum TabType: String, Codable, Sendable, CaseIterable {
      case claude, codex, opencode, gemini, cursor, pi, shell, editor, changes, browser, markdown
  }
  struct Tab: Identifiable, Equatable, Codable, Sendable {
      let id: String; var type: TabType; var label: String
      var sessionId: String?; var filePath: String?; var url: String?
      var autoTitle: Bool?; var trayExclude: Bool?
  }
  enum PaneId: String, Codable, Sendable { case left, right }
  struct WorkspaceSplit: Equatable, Codable, Sendable { var open: Bool; var ratio: Double; var activePane: PaneId }

  // WorkspaceKey.swift
  enum WorkspaceKey {
      static func task(_ id: String) -> String
      static func project(_ id: String) -> String
      static let master: String
      static func right(_ key: String) -> String
      static func isRight(_ key: String) -> Bool
      static func base(_ key: String) -> String       // strip ":right"
  }

  // UIViewModel.swift
  @MainActor @Observable final class UIViewModel {
      enum PanelId: String { case sidebar, fileexplorer, workspace, taskinfo }
      var fileExplorerOpen, searchPanelOpen, taskInfoOpen, flowPanelOpen: Bool
      private(set) var sidebarWidth, fileExplorerWidth, taskInfoWidth, flowPanelWidth: Double
      private(set) var splitByWorkspace: [String: WorkspaceSplit]
      var focusedPanel: PanelId
      func setSidebarWidth(_ w: Double)               // clamps
      func toggleSplit(_ key: String)
      func setSplitRatio(_ key: String, _ ratio: Double)   // clamps 0.2…0.8
      func setActivePane(_ key: String, _ pane: PaneId)
      func getSplit(_ key: String) -> WorkspaceSplit?
      func hydrateLayout(_ panels: LayoutPanels)
      static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double
  }
  ```

- [ ] **Step 1: Write failing `WorkspaceKeyTests`.**

```swift
func testRightAndBase() {
    let k = WorkspaceKey.task("abc")
    XCTAssertEqual(k, "task:abc")
    XCTAssertEqual(WorkspaceKey.right(k), "task:abc:right")
    XCTAssertTrue(WorkspaceKey.isRight("task:abc:right"))
    XCTAssertFalse(WorkspaceKey.isRight("task:abc"))
    XCTAssertEqual(WorkspaceKey.base("task:abc:right"), "task:abc")
    XCTAssertEqual(WorkspaceKey.base("task:abc"), "task:abc")
}
```

- [ ] **Step 2: Write failing `UIViewModelTests`.**

```swift
@MainActor
final class UIViewModelTests: XCTestCase {
    func testSidebarWidthClamps() {
        let vm = UIViewModel()
        vm.setSidebarWidth(10);   XCTAssertEqual(vm.sidebarWidth, 180)   // lo
        vm.setSidebarWidth(9999); XCTAssertEqual(vm.sidebarWidth, 350)   // hi
        vm.setSidebarWidth(220);  XCTAssertEqual(vm.sidebarWidth, 220)
    }
    func testToggleSplitOpensWithDefaults() {
        let vm = UIViewModel()
        vm.toggleSplit("task:a")
        let s = vm.getSplit("task:a")
        XCTAssertEqual(s, WorkspaceSplit(open: true, ratio: 0.5, activePane: .left))
        vm.toggleSplit("task:a")
        XCTAssertEqual(vm.getSplit("task:a")?.open, false)               // closes
    }
    func testSetSplitRatioClamps() {
        let vm = UIViewModel(); vm.toggleSplit("task:a")
        vm.setSplitRatio("task:a", 0.05); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.2)
        vm.setSplitRatio("task:a", 0.95); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.8)
        vm.setSplitRatio("task:a", 0.42); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.42)
    }
    func testFileExplorerAndSearchMutuallyExclusive() {
        let vm = UIViewModel()
        vm.fileExplorerOpen = true; vm.openSearchPanel()
        XCTAssertTrue(vm.searchPanelOpen); XCTAssertFalse(vm.fileExplorerOpen)
    }
}
```

- [ ] **Step 3: Run — verify fail.** `cd native && swift test --filter UIViewModelTests --filter WorkspaceKeyTests` (run each filter; both FAIL undefined).

- [ ] **Step 4: Implement `Tab.swift`, `WorkspaceKey.swift`, `UIViewModel`.** Port `ui-store.ts` fully. `clamp` static helper used by all width setters and `setSplitRatio`. Mutual exclusivity: opening one of file-explorer/search closes the other (match the TS toggles). `hydrateLayout` writes the persisted widths (clamped). Keep `LayoutPanels` aligned with the generated settings type (Task 3 reference).

- [ ] **Step 5: Run — verify pass.** Both filters PASS.

- [ ] **Step 6: Full build.** `cd native && swift build` → clean.

- [ ] **Step 7: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels/Tab.swift native/Sources/Taskflow/ViewModels/WorkspaceKey.swift native/Sources/Taskflow/ViewModels/UIViewModel.swift native/Tests/TaskflowTests/UIViewModelTests.swift native/Tests/TaskflowTests/WorkspaceKeyTests.swift
git commit -m "feat(native): UIViewModel (panels/widths/splits) + Tab value types + WorkspaceKey (TDD)"
```

---

## Task 5: `SessionViewModel` — the tab/split data model (structural heart)

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/SessionViewModel.swift`
- Test: `native/Tests/TaskflowTests/SessionViewModelTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/session-store.ts` (state `tabsByWorkspace`, `activeTabByWorkspace`, `sessionStatus`, `lastTerminalSize`; actions `addTab`/`closeTab`/`setActiveTab`/`renameTab`/`reorderTabs`(`arrayMove`)/`moveTabToPane`/`mergeSplitTabs`/`updateAutoTitle`/`getTabs`/`getActiveTab`/`syncWithTasks`/`syncWithProjects`/`setSessionStatus`) + helpers `session-store.ts:296-309` (reorder) and `:360-392` (moveTabToPane — note the active-tab reselection for BOTH source and target). `session-helpers.ts` (`createSessionTab`, `normalizeSessionLabel`), `session-sync.ts` (`syncOwnerTabs` reference-preservation). **Defer** the live terminal/WS-output status plumbing in `session-subscriptions.ts` to Phase 4 (terminal pane) — port the *tab/pane state machine* now; leave `setSessionStatus` as a plain setter and `bind()` registering only what's needed for tab lifecycle (e.g. `session:exited` cleanup), with a `// Phase 4:` note for terminal-output activity.

**Interfaces:**
- Consumes: `Tab`, `PaneId`, `WorkspaceKey` (Task 4); `WSClient`.
- Produces:
  ```swift
  @MainActor @Observable final class SessionViewModel {
      private(set) var tabsByWorkspace: [String: [Tab]]
      private(set) var activeTabByWorkspace: [String: String]
      private(set) var sessionStatus: [String: SessionStatus]   // enum ported from TS
      func tabs(_ key: String) -> [Tab]
      func activeTab(_ key: String) -> Tab?
      func addTab(_ key: String, _ tab: Tab, activate: Bool = true)
      func closeTab(_ key: String, _ tabId: String)
      func setActiveTab(_ key: String, _ tabId: String)
      func reorderTabs(_ key: String, activeId: String, overId: String)
      func moveTabToPane(source: String, target: String, tabId: String, insertIndex: Int? = nil)
      // pure reducers (static, TDD'd):
      static func arrayMove<T>(_ a: [T], _ from: Int, _ to: Int) -> [T]
      static func reorder(_ tabs: [Tab], activeId: String, overId: String) -> [Tab]
      struct MoveResult: Equatable { var source: [Tab]; var target: [Tab]; var sourceActive: String?; var targetActive: String }
      static func move(source: [Tab], target: [Tab], tabId: String, insertIndex: Int?,
                       sourceActive: String?) -> MoveResult?
  }
  ```

- [ ] **Step 1: Write failing reducer tests** — the highest-value tests in Phase 3.

```swift
@MainActor
final class SessionViewModelTests: XCTestCase {
    private func tab(_ id: String) -> Tab { Tab(id: id, type: .shell, label: id) }

    func testArrayMove() {
        XCTAssertEqual(SessionViewModel.arrayMove(["a","b","c"], 0, 2), ["b","c","a"])
        XCTAssertEqual(SessionViewModel.arrayMove(["a","b","c"], 2, 0), ["c","a","b"])
    }

    func testReorderByIds() {
        let out = SessionViewModel.reorder([tab("a"),tab("b"),tab("c")], activeId: "a", overId: "c")
        XCTAssertEqual(out.map(\.id), ["b","c","a"])
    }

    func testMoveCrossPaneAppendsAndActivates() {
        let r = SessionViewModel.move(source: [tab("a"),tab("b")], target: [tab("x")],
                                      tabId: "a", insertIndex: nil, sourceActive: "a")
        XCTAssertEqual(r?.source.map(\.id), ["b"])
        XCTAssertEqual(r?.target.map(\.id), ["x","a"])
        XCTAssertEqual(r?.targetActive, "a")          // moved tab active in target
        XCTAssertEqual(r?.sourceActive, "b")          // source reselects survivor
    }

    func testMoveCrossPaneAtIndex() {
        let r = SessionViewModel.move(source: [tab("a")], target: [tab("x"),tab("y")],
                                      tabId: "a", insertIndex: 1, sourceActive: "a")
        XCTAssertEqual(r?.target.map(\.id), ["x","a","y"])
        XCTAssertNil(r?.sourceActive)                 // source now empty
    }

    func testMoveUnknownTabIsNoOp() {
        XCTAssertNil(SessionViewModel.move(source: [tab("a")], target: [], tabId: "zzz",
                                           insertIndex: nil, sourceActive: "a"))
    }
}
```

(The source-active reselection rule must match `session-store.ts:360-392`: when the moved tab was the source's active tab, pick the neighbor the TS code picks — replicate its exact index logic. Read the TS before implementing.)

- [ ] **Step 2: Run — verify fail.** `cd native && swift test --filter SessionViewModelTests` → FAIL.

- [ ] **Step 3: Implement `SessionViewModel`.** Port the full tab/pane surface. `arrayMove`/`reorder`/`move` are pure statics; the instance methods apply them and write `tabsByWorkspace`/`activeTabByWorkspace` (mirror TS for the active-id updates). `SessionStatus` enum ported from the TS `SessionStatus` union. `syncWithTasks`/`syncWithProjects` port `syncOwnerTabs` (preserve object identity when unchanged — the Swift equivalent is "don't reassign the array if equal" to avoid needless view invalidation; with `Equatable` Tab, guard `if existing != next`). Leave terminal-output status for Phase 4 (commented seam).

- [ ] **Step 4: Run — verify pass.** `swift test --filter SessionViewModelTests` → PASS.

- [ ] **Step 5: Full build.** `cd native && swift build` → clean.

- [ ] **Step 6: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels/SessionViewModel.swift native/Tests/TaskflowTests/SessionViewModelTests.swift
git commit -m "feat(native): SessionViewModel tab/pane state machine — reorder + cross-pane move (TDD)"
```

---

## Task 6: `FlowViewModel` + `SearchViewModel`

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/FlowViewModel.swift`, `native/Sources/Taskflow/ViewModels/SearchViewModel.swift`
- Test: `native/Tests/TaskflowTests/FlowViewModelTests.swift`, `native/Tests/TaskflowTests/SearchViewModelTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/flow-store.ts` (state `flows`, `actions`, `loadingDefinitions`, `definitionLoadCount`, `activeRuns`; actions `fetchFlows`/`fetchActions`/`saveFlow`/`saveAction`/`deleteFlow`/`deleteAction`/`startFlow`/`stopFlow`/`pauseFlow`/`resumeFlow`/`skipAction`/`jumpToAction`/`fetchFlowRuns`/`applyRunUpdate`; WS sub `flow:run-updated`→`applyRunUpdate`; cross-deps to session/task/ui via injected closures — model the "focus tab on run update" side-effect as an `onRunFocus` closure, wired in Task 8). `packages/ui/src/stores/search-store.ts` (state query/replacement/flags/results/totalMatches/searchId/searching/expandedFiles/error; actions `setQuery`/toggles/`search`/`cancel`/`replaceMatch`/`replaceInFile`/`replaceAll`/`toggleFileExpanded`/`removeMatch`/`removeFile`/`clear`; no WS subs).

**Interfaces:**
- Produces:
  ```swift
  @MainActor @Observable final class FlowViewModel {
      private(set) var flows: [FlowDefinition]
      private(set) var actions: [ActionDefinition]
      private(set) var activeRuns: [String: FlowRun]
      var onRunFocus: ((FlowRun) -> Void)?
      static func applyRunUpdate(_ runs: [String: FlowRun], _ run: FlowRun) -> [String: FlowRun]
  }
  @MainActor @Observable final class SearchViewModel {
      var query, replacement, includePattern, excludePattern: String
      var caseSensitive, wholeWord, useRegex: Bool
      private(set) var results: [SearchFileResult]
      private(set) var totalMatches: Int
      private(set) var searching: Bool
      private(set) var expandedFiles: Set<String>
      static func removeMatch(_ results: [SearchFileResult], file: String, matchId: String) -> [SearchFileResult]
      static func toggleExpanded(_ set: Set<String>, _ file: String) -> Set<String>
  }
  ```
  (Use the generated `FlowDefinition`/`ActionDefinition`/`FlowRun` and `SearchFileResult` types from `Generated/Models/`.)

- [ ] **Step 1: Write failing `FlowViewModelTests`** for `applyRunUpdate` (insert new run by owner id; replace existing run for same owner; assert `onRunFocus` fires when set). Build `FlowRun` via its generated initializer.

- [ ] **Step 2: Run — verify fail.** `swift test --filter FlowViewModelTests` → FAIL.

- [ ] **Step 3: Implement `FlowViewModel`** porting `flow-store.ts` (the run-focus side-effect via `onRunFocus`).

- [ ] **Step 4: Run — verify pass.** PASS.

- [ ] **Step 5: Write failing `SearchViewModelTests`** for `toggleExpanded` (add/remove a path) and `removeMatch` (drops one match; drops the file entry when its last match is removed — match `search-store.ts` semantics).

- [ ] **Step 6: Run — verify fail.** `swift test --filter SearchViewModelTests` → FAIL.

- [ ] **Step 7: Implement `SearchViewModel`** porting `search-store.ts`. `search`/`cancel`/`replaceAll` issue RPCs (`MessageType.search*`, verify cases); the reducers above are pure.

- [ ] **Step 8: Run — verify pass + full build.** both filters PASS; `swift build` clean.

- [ ] **Step 9: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels/FlowViewModel.swift native/Sources/Taskflow/ViewModels/SearchViewModel.swift native/Tests/TaskflowTests/FlowViewModelTests.swift native/Tests/TaskflowTests/SearchViewModelTests.swift
git commit -m "feat(native): FlowViewModel + SearchViewModel (TDD reducers, injected run-focus)"
```

---

## Task 7: `FileViewModel`

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/FileViewModel.swift`
- Test: `native/Tests/TaskflowTests/FileViewModelTests.swift`

**Behavioral source of truth:** `packages/ui/src/stores/file-store.ts` (state `tree`/`treePath`/`gitignorePatterns`/`gitStatus`/`watchedPath`/`loading`/`loadingDirs`/`expandedDirs`/`focusedPath`/`contextMenuPath`/`dragOverPath`/`pendingMove`; actions `fetchTree`/`fetchDir`/`fetchGitStatus`/`watchPath`/`unwatchPath`/`clearExplorerState`/`readFile`/`writeFile`/`renameFile`/`deleteFile`/`createFile`/`createDirectory`/`expandToPathAndLoad`/`toggleDir`/`expandDir`/`collapseDir`/`setFocusedPath`/`setContextMenuPath`/`setDragOverPath`/`setPendingMove`/`clearPendingMove`; lazy WS sub `file:changed`→debounced refresh; request-dedupe via `treeRequestId`/`gitStatusRequestId`). `onOpenFile` is an injected closure (no UI ref). **Defer** the actual file-watch debounce wiring + diff-store subscription to Phase 4/5 — port the tree/expansion/git-status state + dedupe now; leave the debounce as a clearly-marked Phase-4 seam.

**Interfaces:**
- Produces:
  ```swift
  @MainActor @Observable final class FileViewModel {
      private(set) var tree: FileNode?
      private(set) var gitStatus: GitStatusResult?
      private(set) var expandedDirs: Set<String>
      var focusedPath: String?
      var onOpenFile: ((String) -> Void)?
      func toggleDir(_ path: String)
      func expandDir(_ path: String)
      func collapseDir(_ path: String)
      static func mergeDir(_ tree: FileNode?, dirPath: String, children: [FileNode]) -> FileNode?
  }
  ```
  (Use generated `FileNode`/`GitStatusResult` from `Generated/Models/FileTypes.swift`/`GitTypes.swift`.)

- [ ] **Step 1: Write failing `FileViewModelTests`** for `toggleDir`/`expandDir`/`collapseDir` (set membership) and `mergeDir` (replaces a directory node's children in an immutable tree by path; no-op for unknown path). Build a small `FileNode` tree literal via the generated initializer.

- [ ] **Step 2: Run — verify fail.** `swift test --filter FileViewModelTests` → FAIL.

- [ ] **Step 3: Implement `FileViewModel`** porting `file-store.ts` (request-dedupe via monotonically increasing `treeRequestId`/`gitStatusRequestId` ints — drop a response whose id is stale). `onOpenFile` closure for the editor open (wired in Phase 4). Debounced `file:changed` refresh left as a marked seam.

- [ ] **Step 4: Run — verify pass.** PASS.

- [ ] **Step 5: Full build.** `swift build` clean.

- [ ] **Step 6: Commit.**

```bash
git add native/Sources/Taskflow/ViewModels/FileViewModel.swift native/Tests/TaskflowTests/FileViewModelTests.swift
git commit -m "feat(native): FileViewModel — tree/expansion/git-status + request dedupe (TDD)"
```

---

## Task 8: `AppEnvironment` composition + event wiring + real sidecar port

**Files:**
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift`
- Modify: `native/Sources/Taskflow/Sidecar/SidecarManager.swift` (expose the resolved port)
- Test: `native/Tests/TaskflowTests/AppEnvironmentTests.swift` (composition/wiring smoke, no live socket)

**Interfaces:**
- Consumes: all view models (Tasks 2–7), `WSClient`, `SidecarManager`.
- Produces:
  ```swift
  @MainActor @Observable final class AppEnvironment {
      private(set) var status: Status
      @ObservationIgnored let themeStore: ThemeStore
      private(set) var tasks: TaskViewModel?      // created after client is up
      private(set) var projects: ProjectViewModel?
      private(set) var ui: UIViewModel
      private(set) var session: SessionViewModel?
      private(set) var flows: FlowViewModel?
      private(set) var search: SearchViewModel?
      private(set) var files: FileViewModel?
      private(set) var settings: SettingsViewModel?
      func boot() async
      func shutdown()
  }
  // SidecarManager: expose `private(set) var port: Int?` set during the port-file handshake.
  ```

- [ ] **Step 1: Expose the real port from `SidecarManager`.** Add `private(set) var port: Int?` set when the port-file handshake resolves; return it (or surface via `start()`’s result) so `boot()` can build `Status.connected(port:)` with the real value (retire the Phase-2 `port: 0` placeholder).

- [ ] **Step 2: Rewrite `boot()` to compose + bind.** After `client` is up: construct each view model with `client`, wire the injected cross-dep closures (`projects.onActiveProjectChanged = { [weak self] _ in Task { await self?.tasks?.load() } }`; `settings.onLayoutHydrate = { [weak self] panels in self?.ui.hydrateLayout(panels) }`; `flows.onRunFocus = { [weak self] run in self?.session?.focusRunTab(run) }` if applicable), call each `bind()` once, then `await` the parallel initial `load()`s, then `status = .connected(port: realPort)`. `ui` is constructed eagerly in `init` (no client needed); the rest after connect.

- [ ] **Step 3: Write `AppEnvironmentTests` (wiring smoke, no socket).** Assert that after constructing `AppEnvironment`, `ui` is non-nil and the client-dependent VMs are nil until `boot()` (or factor a `compose(client:)` method that the test can call with a `WSClient` pointed at an unconnected URL, then assert all VMs are non-nil and the cross-dep closures are set — without awaiting network). Keep it deterministic and offline.

- [ ] **Step 4: Run — verify pass.** `cd native && swift test --filter AppEnvironmentTests` → PASS.

- [ ] **Step 5: Full suite + build.** `cd native && swift test` (all VM + Phase-2 tests green); `swift build` clean.

- [ ] **Step 6: Integration smoke (live backend, sandboxed).** Update `RootView` temporarily to show counts (`tasks.count`, `projects.count`) in the status bar. Build the bundle, launch, confirm the status bar reads `Backend connected (port <real non-zero port>)` and non-`nil` counts; confirm via the host that **no** second backend hit the real data dir (sandbox intact). Screenshot `native/evidence/p3-08-compose-live.png`.

Run: `cd native && ./scripts/build-app.sh && open .build/app/Taskflow.app`
Expected: real port shown; VM counts populated from live WS; host Taskflow undisturbed.

- [ ] **Step 7: Commit.**

```bash
git add native/Sources/Taskflow/App/AppEnvironment.swift native/Sources/Taskflow/Sidecar/SidecarManager.swift native/Tests/TaskflowTests/AppEnvironmentTests.swift native/evidence/p3-08-*.png
git commit -m "feat(native): compose all view models in AppEnvironment; bind WS events; thread real sidecar port"
```

---

## Task 9: App shell — 6-pane layout, resizable panels, persistence

**Files:**
- Create: `native/Sources/Taskflow/UI/Shell/ResizeHandle.swift`
- Create: `native/Sources/Taskflow/UI/Shell/AppShell.swift`
- Create: `native/Sources/Taskflow/UI/Shell/SidebarView.swift`
- Create: `native/Sources/Taskflow/UI/Shell/WorkspaceView.swift`
- Modify: `native/Sources/Taskflow/App/TaskflowApp.swift` (RootView → AppShell)

**Behavioral source of truth:** `packages/ui/src/components/AppShell.tsx` (pane map: sidebar | file-explorer-or-search | flow-panel | workspace | task-info; widths + min/max; `handleResizeEnd`→`updateSettings`) and `ResizeHandle.tsx` (mouse-drag delta).

**Interfaces:**
- Consumes: `UIViewModel`, `SettingsViewModel`, `TaskViewModel`, `ProjectViewModel`, `SessionViewModel` via `@Environment(AppEnvironment.self)`.
- Produces: `AppShell` (the new RootView content), `ResizeHandle(orientation:onDelta:onEnded:)`, `SidebarView`, `WorkspaceView`.

- [ ] **Step 1: Implement `ResizeHandle`.** A thin draggable divider (`DragGesture`) emitting `onDelta(Double)` continuously and `onEnded()` at release; `orientation: .vertical | .horizontal`; resize cursor on hover.

- [ ] **Step 2: Implement `AppShell`.** An `HStack(spacing: 0)` reproducing the pane map, each pane width-bound to the `UIViewModel` (sidebar always; file-explorer/search mutually-exclusive + conditional; flow-panel conditional; workspace flexible `frame(maxWidth: .infinity)`; task-info conditional). Between panes place `ResizeHandle`s wired to the matching width setter (`onDelta` → `ui.setSidebarWidth(current+delta)` etc.) and `onEnded` → `settings.updateSettings(layout patch)` (mirror `handleResizeEnd`). Respect each pane's min/max via the VM clamps.

- [ ] **Step 3: Implement `SidebarView`.** A `List` of projects (from `ProjectViewModel`) and their tasks (from `TaskViewModel`), selection drives `session`/active workspace. Read VMs from environment; rely on Observation for live updates. (Drag-reorder of sidebar items is Phase 5 — static order here.)

- [ ] **Step 4: Implement `WorkspaceView`.** Hosts the `SplitContainer` (Task 11) for the active workspace key; for now (pre-Task-10/11) render a placeholder titled with the active workspace key so the shell is verifiable independently.

- [ ] **Step 5: Wire `RootView` → `AppShell`.** Replace the `PrimitivesGallery` body with `AppShell()` (keep the status bar). `PrimitivesGallery` stays in the tree as a dev affordance behind a debug menu or simply unreferenced — do not delete it.

- [ ] **Step 6: Build.** `cd native && swift build` → clean.

- [ ] **Step 7: Visual verification.** Launch the bundle; confirm: all panes lay out per the map; dragging each divider resizes within min/max; widths persist across a relaunch (resize, quit, relaunch, observe restored widths — proves the `updateSettings`/`hydrateLayout` round-trip). Screenshots `native/evidence/p3-09-shell-layout.png`, `p3-09-shell-resized-persisted.png`.

- [ ] **Step 8: Commit.**

```bash
git add native/Sources/Taskflow/UI/Shell native/Sources/Taskflow/App/TaskflowApp.swift native/evidence/p3-09-*.png
git commit -m "feat(native): 6-pane AppShell with resizable, persisted panels driven by UIViewModel"
```

---

## Task 10: Workspace tab bar + same-pane drag reorder

**Files:**
- Create: `native/Sources/Taskflow/UI/Workspace/TabItem.swift`
- Create: `native/Sources/Taskflow/UI/Workspace/TabBar.swift`
- Create: `native/Sources/Taskflow/UI/Workspace/PanePlaceholder.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/WorkspaceView.swift` (host a single TabBar + active content)

**Behavioral source of truth:** `packages/ui/src/components/workspace/TabBar.tsx` + `TabItem.tsx` (`useSortable` reorder; drag activation distance 5; `horizontalListSortingStrategy`; `onTabReorder`→`reorderTabs`).

**Interfaces:**
- Consumes: `SessionViewModel` (`tabs(_:)`, `activeTab(_:)`, `setActiveTab`, `reorderTabs`), `Tab`/`TabType`, `\.appTheme`.
- Produces:
  ```swift
  struct TabBar: View { let workspaceKey: String /* reads SessionViewModel from env */ }
  struct TabItem: View { let tab: Tab; let isActive: Bool; let onSelect: () -> Void; let onClose: () -> Void }
  // Tab drag payload (Transferable):
  struct TabDragItem: Codable, Transferable { let tabId: String; let sourceKey: String }
  ```

- [ ] **Step 1: Define `TabDragItem: Transferable`** (a `CodableRepresentation` with a custom UTType, e.g. `UTType(exportedAs: "com.taskflow.tab")`). It carries `tabId` + `sourceKey` so Task 11 can distinguish reorder vs cross-pane.

- [ ] **Step 2: Implement `TabItem`** — themed tab chip (color by `TabType` per `tab-constants.ts`’s variants), status dot when `sessionId != nil`, close `X`. `.draggable(TabDragItem(tabId: tab.id, sourceKey: ...))` for the drag source.

- [ ] **Step 3: Implement `TabBar`** — an `HStack` over `session.tabs(workspaceKey)`; tap → `setActiveTab`; same-pane reorder via `.dropDestination(for: TabDragItem.self)` on each `TabItem` (when `dropped.sourceKey == workspaceKey`, call `session.reorderTabs(workspaceKey, activeId: dropped.tabId, overId: tab.id)`). Use a 5pt drag activation feel consistent with the Electron sensor.

- [ ] **Step 4: Implement `PanePlaceholder`** — renders the active tab’s label/type as placeholder content (real terminal/editor/browser panes are Phase 4). Keeps Task 10/11 verifiable without Phase-4 deps.

- [ ] **Step 5: Host in `WorkspaceView`** — single pane: `VStack { TabBar(workspaceKey: activeKey); Divider(); PanePlaceholder(for: session.activeTab(activeKey)) }`. Seed a couple of demo tabs for the active workspace if none exist (dev-only) so the bar is non-empty to verify.

- [ ] **Step 6: Build.** `cd native && swift build` → clean.

- [ ] **Step 7: Visual verification.** Launch; confirm tabs render themed; clicking switches active content; dragging a tab reorders within the bar (state persists in `SessionViewModel`). Screenshots `native/evidence/p3-10-tabs.png`, `p3-10-reorder-after.png`.

- [ ] **Step 8: Commit.**

```bash
git add native/Sources/Taskflow/UI/Workspace native/Sources/Taskflow/UI/Shell/WorkspaceView.swift native/evidence/p3-10-*.png
git commit -m "feat(native): workspace TabBar + draggable tabs with same-pane reorder"
```

---

## Task 11: Workspace split + cross-pane drag move (structural heart, complete)

**Files:**
- Create: `native/Sources/Taskflow/UI/Workspace/SplitContainer.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/WorkspaceView.swift` (host SplitContainer)

**Behavioral source of truth:** `packages/ui/src/components/workspace/SplitContainer.tsx` (left = `flex 0 0 ratio%`, right auto-fills; vertical `ResizeHandle`→`setSplitRatio`; cross-pane drop → `moveTabToPane`; drop zones `pane-drop:<key>` + `pane-drop:<key>:right`).

**Interfaces:**
- Consumes: `UIViewModel` (`getSplit`/`toggleSplit`/`setSplitRatio`/`setActivePane`), `SessionViewModel` (`moveTabToPane`), Task-10 `TabBar`/`TabDragItem`/`PanePlaceholder`, `ResizeHandle`.
- Produces: `struct SplitContainer: View { let workspaceKey: String }`.

- [ ] **Step 1: Implement `SplitContainer` single/split layout.** When `ui.getSplit(workspaceKey)?.open != true`: render one pane (Task-10 TabBar+content for `workspaceKey`). When open: `HStack(spacing:0)` of left pane (`workspaceKey`, `frame(width: totalWidth * ratio)` via `GeometryReader`), a vertical `ResizeHandle` (`onDelta` → `ui.setSplitRatio(workspaceKey, ratio + delta/totalWidth)`), and right pane (`WorkspaceKey.right(workspaceKey)`, fills remainder). A toolbar button toggles the split.

- [ ] **Step 2: Add cross-pane drop targets.** Each pane (its TabBar *and* its body area) is a `.dropDestination(for: TabDragItem.self)`. On drop where `dropped.sourceKey != paneKey`: `session.moveTabToPane(source: dropped.sourceKey, target: paneKey, tabId: dropped.tabId)` then `ui.setActivePane(workspaceKey, paneKey == WorkspaceKey.right(workspaceKey) ? .right : .left)`. Reorder-vs-move routing: same `sourceKey` → reorder (Task 10); different → move (here).

- [ ] **Step 3: Host in `WorkspaceView`.** Replace the single TabBar with `SplitContainer(workspaceKey: activeKey)`.

- [ ] **Step 4: Build.** `cd native && swift build` → clean.

- [ ] **Step 5: Visual verification — the structural-heart proof.** Launch; open a split; drag a tab from the left pane onto the right pane → it moves (left loses it, right gains + activates it); reorder still works within each pane; drag the divider → panes resize within 0.2–0.8. Screenshots: `native/evidence/p3-11-split-open.png`, `p3-11-crosspane-before.png`, `p3-11-crosspane-after.png`, `p3-11-divider-resized.png`.

- [ ] **Step 6: Full suite (no regressions).** `cd native && swift test` → all green.

- [ ] **Step 7: Commit.**

```bash
git add native/Sources/Taskflow/UI/Workspace/SplitContainer.swift native/Sources/Taskflow/UI/Shell/WorkspaceView.swift native/evidence/p3-11-*.png
git commit -m "feat(native): workspace split + cross-pane tab drag (moveTabToPane) — structural spine complete"
```

---

## Task 12: Phase 3 results spec + ledger + memory

**Files:**
- Create: `docs/superpowers/specs/2026-06-27-phase3-structural-spine-results.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: memory `project_native_app_experiment_status` (+ `MEMORY.md` pointer if needed)

- [ ] **Step 1: Write the results spec.** What landed: Observation migration (macOS 14, stale-theme bug retired), the full view-model layer (task/project/ui/session/flow/search/file/settings + theme migration), the 6-pane shell with persisted resizable panels, and the workspace split + draggable/cross-pane tabs. Test counts (VM unit tests + Phase-2 regression). Evidence index (`native/evidence/p3-*.png`). Honest caveats carried into Phase 4: panes are placeholders (real terminal/editor/browser/diff/markdown = Phase 4); session terminal-output status + file-watch debounce are marked seams; sidebar drag-reorder + command palette = Phase 5; per-spawn env scrub for embedded terminals (Phase 4). Note any reducer behaviors that intentionally diverge from TS.

- [ ] **Step 2: Update the SDD ledger** with per-task outcomes + the minor-findings triage (same format as the Phase-2 ledger).

- [ ] **Step 3: Update the resume memory** (`project_native_app_experiment_status`): mark Phase 3 COMPLETE, HEAD commit, next = Phase 4 (panes), and refresh the carry-forward list (which Phase-3 carry-forwards are now resolved vs still open).

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-06-27-phase3-structural-spine-results.md .superpowers/sdd/progress.md
git commit -m "docs: Phase 3 structural-spine results + ledger"
```

---

## Self-Review

**Spec coverage (master-plan Phase 3):**
- 3.1 Store → view-model layer → Tasks 2–8 (all seven domain stores + ui + settings + theme migration; reactivity gotcha solved via Observation per-property tracking, documented in `ViewModel.md`; module-level event registration → per-VM `bind()` wired once in `AppEnvironment`; cross-store deps → injected closures). ✓
- 3.2 App shell (6-pane, persisted) → Task 9. ✓
- 3.3 Workspace split + tabs + drag → Tasks 10 (reorder) + 11 (split + cross-pane). ✓
- Carried-forward fixes: stale-theme injection → Task 1; real sidecar port → Task 8. ✓

**Placeholder scan:** No "TBD/handle edge cases" left; where full code isn't transcribed it's because the task is an explicit 1:1 port whose behavioral spec is a named `*.ts` file (stated in Global Constraints) — the implementer ports the full surface, with tricky reducers shown as real tests. Pane *content* placeholders (Task 10/11) are an intentional Phase-4 boundary, not a plan gap.

**Type consistency:** `Tab`/`TabType`/`PaneId`/`WorkspaceSplit` defined once (Task 4), consumed by Session (5) + Workspace UI (10/11). `WorkspaceKey.right/base/isRight` used consistently in Session reducers + SplitContainer. `moveTabToPane`/`reorderTabs`/`setSplitRatio`/`setActivePane` names match across VM, shell, and split-container tasks. Generated types (`TaskItem`, `Project`, `FlowRun`, `FileNode`, …) reused, never re-declared.

**Open verification dependency:** generated `MessageType` case names (`.settingsUpdate`, `.search*`, `.flowRunUpdated`, `.taskLogAdded`, etc.) and generated model initializers must be confirmed against `native/Sources/Taskflow/Generated/` at implementation time — each task says "verify exact case/name." No new shared types are introduced; if a needed wire type is missing from `Generated/`, that's a codegen gap to surface, not to hand-author.

# Phase 5C — Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Electron "panels" UI (master-plan unit 5.2) to native SwiftUI — the file explorer (tree + git-status colors + context menu + file dialogs) and the search/replace panel — and fill the Phase-5B-deferred diff-store work (worktree `+adds/-dels` + `behind` badges on `TaskCard`, branch label on `ProjectGroup`).

**Architecture:** Build on the already-complete Phase-3 view models (`FileViewModel`, `SearchViewModel`) and Phase-5A primitives (`AppIcon`, `AppTextField`, `AppButton`). Add one new view model — `DiffViewModel` (port of `diff-store.ts`, the only missing store) — wired client-dependent into `AppEnvironment` exactly like `NotificationViewModel`. Panel **views** mount into the existing `AppShell` placeholder slots. Pure logic (git-status→color, diff-stats reducer, working-dir resolution, gitFiles map) goes into `nonisolated static` helpers with TDD; views are verified by build + dogfood.

**Tech Stack:** Swift 6, SwiftUI, `@Observable`/`@MainActor` view models, `Transferable`/`UTType` drag-and-drop, XCTest. Backend reached over the existing `WSClient` (no new RPCs — all message types already generated).

## Global Constraints

Copied verbatim from the project conventions (`CLAUDE.md`) and the Phase-5A/5B execution lessons. **Every task implicitly includes this section.**

- **Build tool:** use `swift build` / `swift test` run from the `native/` directory. Use `bun` (never `npm`/`yarn`) for any TS/codegen command. **No codegen is needed** in this phase — all required generated types already exist.
- **No `as any` / no force casts of domain types**; pursue proper typing. No `AnyCodable`.
- **No new domain types.** Reuse generated structs (`FileNode`, `GitStatusResult`, `GitFileStatus`, `SearchFileResult`, `SearchMatch`, `ChangeStats`, `ChangeStatsEvent`, `SystemInfo`). Only *UI-local* helper structs (e.g. `DiffStats`, `DiffState`, drag-payload structs) may be hand-authored, mirroring the existing `PendingMove` precedent in `FileViewModel.swift`.
- **Don't export/widen visibility until necessary.** Everything `internal` or `private`; no `public`. If a symbol is never referenced outside its file, keep it `private`.
- **Pure static helpers must be `nonisolated`** — Swift 6 infers `@MainActor` on `View` and view-model members, so any pure function called from a test or a non-isolated context must be marked `nonisolated static`. (First hit historically: `AppSelect.label`.)
- **No disabling eslint/SwiftLint rules** — find the proper fix.
- **Env-injection convention** (re-confirmed in 5B): views use `@Environment(AppEnvironment.self) private var env` (NOT a key-path) and `@Environment(\.appTheme) private var theme`. On `AppEnvironment`: `env.ui` and `env.taskCreation` are **non-optional**; `env.tasks / projects / session / flows / search / files / settings / notifications / runMenu` (and the new `env.diff`) are **OPTIONAL**. `env.session` is singular.
- **When adding a client-dependent VM to `AppEnvironment`, update BOTH `AppEnvironmentTests` guards** — `testClientDependentVMsAreNilBeforeCompose` (must be nil pre-compose) and `testComposeSetsAllVMs` (non-nil post-compose).
- **Grep the generated-type fields + real VM method signatures before writing any call site** — several plan-draft signatures in prior phases drifted from reality; verify first.
- **Theme:** color via `theme.color(.token)`; tokens used here all exist: `.success .warning .destructive .accent .info .secondaryForeground .mutedForeground .muted .card .accentForeground .sidebarForeground .foreground`.
- **Commit style:** do NOT add `Co-Authored-By`. One commit per task, conventional-commit subject.
- **Faithful-port rule:** match the TS source 1:1 in behavior; cite the TS file in a doc comment on each new type/view, as existing native files do.

## File Structure

New files (all under `native/Sources/Taskflow/` unless noted):

| File | Responsibility |
|---|---|
| `ViewModels/DiffViewModel.swift` | Port of `stores/diff-store.ts`. `@MainActor @Observable`; binds `.gitChangeStats`; holds `DiffState`; `nonisolated static apply(_:_:)` reducer; UI-local `DiffStats`/`DiffState` structs. |
| `UI/Panels/GitStatusColor.swift` | `nonisolated static` pure helpers: `token(forStatus:isIgnored:)` (status→`ThemeToken`) and `gitFilesMap(_:workingDir:)` (`GitStatusResult`→`[absPath: status]`). |
| `UI/Panels/ActiveWorkspace.swift` | `nonisolated static workingDir(task:project:masterActive:homedir:)` — port of `useActiveWorkspace.ts` working-dir derivation. |
| `UI/Panels/FileExplorerPane.swift` | Panel root: resolves working dir, drives `FileViewModel` lifecycle (fetch/git/watch), builds gitFiles map, renders the tree. |
| `UI/Panels/FileTreeRow.swift` | One recursive tree row: chevron, icon, git-colored name, indent, focus, tap, context menu, drag/drop. |
| `UI/Panels/FileContextMenu.swift` | `@ViewBuilder` file/dir context-menu items + the create/rename/delete action plumbing. |
| `UI/Panels/FileDialogs.swift` | Panel-local `CreateFileDialog`, `RenameFileDialog`, `DeleteFileDialog`, `MoveFileDialog` (SwiftUI sheets/alerts). |
| `UI/Panels/SearchPane.swift` | Search/replace panel root: inputs, flag toggles, filter section, debounced search, result count. |
| `UI/Panels/SearchResultsView.swift` | Result list: expandable per-file groups, highlighted match lines, per-file/per-match replace + dismiss. |
| `Tests/TaskflowTests/DiffViewModelTests.swift` | TDD for the `apply` reducer. |
| `Tests/TaskflowTests/GitStatusColorTests.swift` | TDD for status→token + gitFilesMap. |
| `Tests/TaskflowTests/ActiveWorkspaceTests.swift` | TDD for working-dir resolution. |
| `Tests/TaskflowTests/SearchHighlightTests.swift` | TDD for the match-line split helper. |

Modified files:

| File | Change |
|---|---|
| `App/AppEnvironment.swift` | Add `diff: DiffViewModel?` (construct/bind/assign, no boot load) + `homedir: String?` (fetch in `boot()`) + wire `diffVM.onStatsByProjectChanged → files.refreshGitStatusForWatchedPath()`. |
| `ViewModels/FileViewModel.swift` | Add `refreshGitStatusForWatchedPath()` filling the `// Phase 5:` diff-store seam (lines 200–201). |
| `Tests/TaskflowTests/AppEnvironmentTests.swift` | Add `diff` to both nil-before / non-nil-after guards. |
| `UI/Shell/AppShell.swift` | Replace the `panelPlaceholder` for file-explorer/search with `FileExplorerPane` / `SearchPane`. |
| `UI/Sidebar/TaskCard.swift` | Fill the `// Phase 5C/diff-store seam` (line 119) — `↓behind` + `+adds`/`-dels` from `env.diff`. |
| `UI/Sidebar/ProjectGroup.swift` | Add the `(branch)` label from `env.diff?.state.branchByProject[project.id]`. |

---

## Task 1: DiffViewModel + diff-store integration

Ports `stores/diff-store.ts` — the one store with no native equivalent. It is **event-driven only** (binds the `git:change-stats` broadcast emitted by `backend/services/change-tracker.ts`); no RPC, no boot load. Also fills the `FileViewModel` diff-store seam.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/DiffViewModel.swift`
- Create: `native/Tests/TaskflowTests/DiffViewModelTests.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift`
- Modify: `native/Sources/Taskflow/ViewModels/FileViewModel.swift:200-201` (the `// Phase 5:` seam)
- Modify: `native/Tests/TaskflowTests/AppEnvironmentTests.swift`

**Interfaces:**
- Consumes: generated `ChangeStatsEvent { targetId: String; stats: ChangeStats? }` and `ChangeStats { additions/deletions/fileCount/ahead/behind: Double; branch: String?; hasChanges/diffDisabled/commitDisabled: Bool }`; `MessageType.gitChangeStats`; `WSClient.on(_:_:)`.
- Produces:
  - `struct DiffStats: Equatable, Sendable { let additions: Int; let deletions: Int }`
  - `struct DiffState: Equatable, Sendable` with maps `statsByProject: [String: DiffStats]`, `diffDisabledByProject: [String: Bool]`, `commitDisabledByProject: [String: Bool]`, `hasChangesByProject: [String: Bool]`, `branchByProject: [String: String]`, `aheadByProject: [String: Int]`, `behindByProject: [String: Int]`
  - `DiffViewModel` (`@MainActor @Observable`) with `private(set) var state: DiffState`, `var onStatsByProjectChanged: (() -> Void)?`, `func bind()`, `nonisolated static func apply(_ state: DiffState, _ event: ChangeStatsEvent) -> DiffState`
  - `FileViewModel.refreshGitStatusForWatchedPath()`
  - `AppEnvironment.diff: DiffViewModel?`

- [ ] **Step 1: Write the failing reducer test**

Create `native/Tests/TaskflowTests/DiffViewModelTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class DiffViewModelTests: XCTestCase {
    private func stats(add: Double, del: Double, branch: String?, ahead: Double, behind: Double,
                       hasChanges: Bool = true, diffDisabled: Bool = false,
                       commitDisabled: Bool = false) -> ChangeStats {
        ChangeStats(additions: add, deletions: del, fileCount: 1, branch: branch,
                    ahead: ahead, behind: behind, hasChanges: hasChanges,
                    diffDisabled: diffDisabled, commitDisabled: commitDisabled)
    }

    func testApplyPopulatesAllMaps() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 5, del: 2, branch: "main", ahead: 1, behind: 3)))
        XCTAssertEqual(s.statsByProject["t1"], DiffStats(additions: 5, deletions: 2))
        XCTAssertEqual(s.behindByProject["t1"], 3)
        XCTAssertEqual(s.aheadByProject["t1"], 1)
        XCTAssertEqual(s.branchByProject["t1"], "main")
        XCTAssertEqual(s.hasChangesByProject["t1"], true)
    }

    func testZeroAdditionsAndDeletionsClearsStatsButKeepsOtherMaps() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 0, del: 0, branch: "dev", ahead: 0, behind: 4)))
        XCTAssertNil(s.statsByProject["t1"])           // null diffStats, mirrors TS
        XCTAssertEqual(s.behindByProject["t1"], 4)     // other maps still set
        XCTAssertEqual(s.branchByProject["t1"], "dev")
    }

    func testNullStatsRemovesTargetFromAllMaps() {
        var seed = DiffState()
        seed = DiffViewModel.apply(seed, ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 5, del: 2, branch: "main", ahead: 1, behind: 3)))
        let cleared = DiffViewModel.apply(seed, ChangeStatsEvent(targetId: "t1", stats: nil))
        XCTAssertNil(cleared.statsByProject["t1"])
        XCTAssertNil(cleared.behindByProject["t1"])
        XCTAssertNil(cleared.branchByProject["t1"])
        XCTAssertNil(cleared.hasChangesByProject["t1"])
    }

    func testNullBranchRemovesBranchKey() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 1, del: 0, branch: nil, ahead: 0, behind: 0)))
        XCTAssertNil(s.branchByProject["t1"])
    }
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `native/`): `swift test --filter DiffViewModelTests`
Expected: FAIL — `DiffViewModel` / `DiffState` / `DiffStats` undefined.

- [ ] **Step 3: Implement `DiffViewModel.swift`**

Create `native/Sources/Taskflow/ViewModels/DiffViewModel.swift`:

```swift
import Foundation
import Observation

/// UI-local diff-stat pair mirroring `DiffStats` from `packages/ui/src/stores/diff-store.ts`.
/// UI-LOCAL (not in `@taskflow/shared`), hand-authored like `PendingMove`.
struct DiffStats: Equatable, Sendable {
    let additions: Int
    let deletions: Int
}

/// All per-target diff maps, replaced wholesale on each event so `@Observable` notifies readers.
/// Mirrors the seven `*ByProject` records in `diff-store.ts`. Keys are target ids (task OR project).
struct DiffState: Equatable, Sendable {
    var statsByProject: [String: DiffStats] = [:]
    var diffDisabledByProject: [String: Bool] = [:]
    var commitDisabledByProject: [String: Bool] = [:]
    var hasChangesByProject: [String: Bool] = [:]
    var branchByProject: [String: String] = [:]
    var aheadByProject: [String: Int] = [:]
    var behindByProject: [String: Int] = [:]
}

/// 1:1 port of `packages/ui/src/stores/diff-store.ts`.
/// Event-driven only: binds the `git:change-stats` broadcast (emitted by the backend
/// change-tracker). No RPC, no boot load. `onStatsByProjectChanged` mirrors the
/// `useDiffStore.subscribe` consumed by `file-store.ts:213` to refresh git status.
@MainActor
@Observable
final class DiffViewModel {
    private(set) var state = DiffState()

    /// Fired after an event changes `statsByProject` (wired in AppEnvironment to refresh
    /// the file explorer's git status). Mirrors the file-store.ts diff-store subscription.
    @ObservationIgnored var onStatsByProjectChanged: (() -> Void)?

    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    // MARK: - Bind

    func bind() {
        client.on(.gitChangeStats) { [weak self] (event: ChangeStatsEvent) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let prev = state.statsByProject
                state = Self.apply(state, event)
                if state.statsByProject != prev { onStatsByProjectChanged?() }
            }
        }
    }

    // MARK: - Pure reducer (TDD'd)

    /// Applies one `git:change-stats` event. `stats == nil` removes the target from every map
    /// (target untracked). Otherwise: `statsByProject` is nil when additions+deletions are both
    /// zero (matching TS), other maps always set; a nil branch removes the branch key.
    nonisolated static func apply(_ state: DiffState, _ event: ChangeStatsEvent) -> DiffState {
        var s = state
        let id = event.targetId
        guard let stats = event.stats else {
            s.statsByProject[id] = nil
            s.diffDisabledByProject[id] = nil
            s.commitDisabledByProject[id] = nil
            s.hasChangesByProject[id] = nil
            s.branchByProject[id] = nil
            s.aheadByProject[id] = nil
            s.behindByProject[id] = nil
            return s
        }
        let add = Int(stats.additions)
        let del = Int(stats.deletions)
        s.statsByProject[id] = (add == 0 && del == 0) ? nil : DiffStats(additions: add, deletions: del)
        s.diffDisabledByProject[id] = stats.diffDisabled
        s.commitDisabledByProject[id] = stats.commitDisabled
        s.hasChangesByProject[id] = stats.hasChanges
        s.branchByProject[id] = stats.branch        // nil branch → removes the key
        s.aheadByProject[id] = Int(stats.ahead)
        s.behindByProject[id] = Int(stats.behind)
        return s
    }
}
```

- [ ] **Step 4: Run the reducer test — expect PASS**

Run: `swift test --filter DiffViewModelTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Fill the `FileViewModel` diff-store seam**

In `native/Sources/Taskflow/ViewModels/FileViewModel.swift`, replace the seam comment at lines 200–201:

```swift
        // Phase 5: subscribe to diff-store stat changes to trigger fetchGitStatus.
        // See file-store.ts:209-220 (useDiffStore.subscribe).
```

with nothing here (the subscription is wired in `AppEnvironment`), and add this method right after `unwatchPath` (after line 214):

```swift
    /// Re-fetches git status for the currently-watched path. Wired in `AppEnvironment` to
    /// `DiffViewModel.onStatsByProjectChanged`, mirroring the `useDiffStore.subscribe` in
    /// `file-store.ts:209-220` that refreshes status when diff stats change.
    func refreshGitStatusForWatchedPath() {
        guard let wp = watchedPath else { return }
        Task { [weak self] in await self?.fetchGitStatus(path: wp) }
    }
```

Also update the `unwatchPath` seam comment at line 211 (`// Phase 5: diff-store unsubscribe.`) to `// diff-store unsubscribe is handled centrally in AppEnvironment (single shared DiffViewModel).`

- [ ] **Step 6: Wire `DiffViewModel` into `AppEnvironment`**

In `native/Sources/Taskflow/App/AppEnvironment.swift`:

Add the optional property after line 29 (`private(set) var runMenu: RunMenuViewModel?`):
```swift
    private(set) var diff: DiffViewModel?
```

In `compose(client:)`, construct it alongside the others (after line 53):
```swift
        let diffVM          = DiffViewModel(client: client)
```

Wire the file-status refresh (in the cross-store wiring block, e.g. after the `files.onOpenFile` closure at line 145):
```swift
        // diff.onStatsByProjectChanged — refresh the file explorer's git status when diff
        // stats change. Mirrors the useDiffStore.subscribe in file-store.ts:209-220.
        diffVM.onStatsByProjectChanged = { [weak self] in
            self?.files?.refreshGitStatusForWatchedPath()
        }
```

Bind it (in the bind block, after line 167 `notificationsVM.bind()`):
```swift
        diffVM.bind()
```

Assign it (after line 181 `self.runMenu = ...`):
```swift
        self.diff          = diffVM
```

Leave `boot()` loads unchanged — `DiffViewModel` has no boot load (event-driven), like `runMenu`.

- [ ] **Step 7: Update both `AppEnvironmentTests` guards**

In `native/Tests/TaskflowTests/AppEnvironmentTests.swift`, add a `diff` assertion to `testClientDependentVMsAreNilBeforeCompose` (must be `nil` before compose) and to `testComposeSetsAllVMs` (must be non-nil after compose), following the existing pattern for `notifications`/`runMenu`.

- [ ] **Step 8: Build + full test suite**

Run: `swift build && swift test`
Expected: build clean; all tests pass (35 prior test files + the 4 new `DiffViewModelTests`); `AppEnvironmentTests` still green with the new `diff` guards.

- [ ] **Step 9: Commit**

```bash
git add native/Sources/Taskflow/ViewModels/DiffViewModel.swift \
        native/Tests/TaskflowTests/DiffViewModelTests.swift \
        native/Sources/Taskflow/App/AppEnvironment.swift \
        native/Sources/Taskflow/ViewModels/FileViewModel.swift \
        native/Tests/TaskflowTests/AppEnvironmentTests.swift
git commit -m "feat(native): DiffViewModel (diff-store port) + file-status refresh seam"
```

---

## Task 2: Git-status color + gitFiles map helpers

Pure helpers for the file tree. Ports the CVA status→class table and the `gitFiles` `useMemo` from `FileTree.tsx` / `FileExplorer.tsx`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/GitStatusColor.swift`
- Create: `native/Tests/TaskflowTests/GitStatusColorTests.swift`

**Interfaces:**
- Consumes: `ThemeToken` (from `Theme/AppTheme.swift`); generated `GitStatusResult { stagedFiles: [GitFileStatus]; unstagedFiles: [GitFileStatus] }`, `GitFileStatus { path: String; absolutePath: String?; status: String; ... }`.
- Produces:
  - `enum GitStatusColor` with `nonisolated static func token(forStatus status: String?, isIgnored: Bool) -> ThemeToken`
  - `nonisolated static func gitFilesMap(_ status: GitStatusResult?, workingDir: String) -> [String: String]`

- [ ] **Step 1: Write the failing test**

Create `native/Tests/TaskflowTests/GitStatusColorTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class GitStatusColorTests: XCTestCase {
    func testStatusTokens() {
        XCTAssertEqual(GitStatusColor.token(forStatus: "new", isIgnored: false), .success)
        XCTAssertEqual(GitStatusColor.token(forStatus: "untracked", isIgnored: false), .success)
        XCTAssertEqual(GitStatusColor.token(forStatus: "modified", isIgnored: false), .warning)
        XCTAssertEqual(GitStatusColor.token(forStatus: "deleted", isIgnored: false), .destructive)
        XCTAssertEqual(GitStatusColor.token(forStatus: "renamed", isIgnored: false), .accent)
    }

    func testUnknownStatusIsClean() {
        XCTAssertEqual(GitStatusColor.token(forStatus: nil, isIgnored: false), .secondaryForeground)
        XCTAssertEqual(GitStatusColor.token(forStatus: "bogus", isIgnored: false), .secondaryForeground)
    }

    func testIgnoredAppliesOnlyWhenNoStatus() {
        XCTAssertEqual(GitStatusColor.token(forStatus: nil, isIgnored: true), .mutedForeground)
        // A real status wins over ignored (mirrors FileTree.tsx: rawStatus ? ... : isIgnored ? ...)
        XCTAssertEqual(GitStatusColor.token(forStatus: "modified", isIgnored: true), .warning)
    }

    func testGitFilesMapPrefersAbsolutePathAndUnstagedOverridesStaged() {
        let staged = GitFileStatus(path: "a.txt", absolutePath: nil, previousPath: nil,
                                   status: "new", staged: true)
        let unstaged = GitFileStatus(path: "a.txt", absolutePath: "/repo/a.txt", previousPath: nil,
                                     status: "modified", staged: false)
        let result = GitStatusResult(branch: "main", stagedFiles: [staged],
                                     unstagedFiles: [unstaged], ahead: 0, behind: 0)
        let map = GitStatusColor.gitFilesMap(result, workingDir: "/repo")
        // staged "a.txt" → "/repo/a.txt" (synthesized); unstaged overwrites with "modified"
        XCTAssertEqual(map["/repo/a.txt"], "modified")
    }
}
```

> Before running, confirm `GitFileStatus` and `GitStatusResult` initializer parameter order/names by reading `native/Sources/Taskflow/Generated/Models/GitTypes.swift` — match them exactly (memberwise init).

- [ ] **Step 2: Run it — expect FAIL**

Run: `swift test --filter GitStatusColorTests`
Expected: FAIL — `GitStatusColor` undefined.

- [ ] **Step 3: Implement `GitStatusColor.swift`**

Create `native/Sources/Taskflow/UI/Panels/GitStatusColor.swift`:

```swift
import Foundation

/// Pure git-status presentation helpers. Ports the CVA `gitStatusVariants` table from
/// `packages/ui/src/components/panels/FileTree.tsx:12-36` and the `gitFiles` useMemo from
/// `FileExplorer.tsx:51-66`.
enum GitStatusColor {
    /// Valid raw statuses (FileTree.tsx `VALID_GIT_STATUSES`). Anything else falls back to "clean".
    private static let valid: Set<String> = ["new", "untracked", "modified", "deleted", "renamed"]

    /// Maps a raw git status (or nil) + an ignored flag to a theme token.
    /// Mirrors FileTree.tsx: a real status wins; else ignored dims; else clean.
    /// Note: the "ignored" tint is rendered at 50% opacity by the row view (TS `text-muted-foreground/50`).
    nonisolated static func token(forStatus status: String?, isIgnored: Bool) -> ThemeToken {
        if let status, valid.contains(status) {
            switch status {
            case "new", "untracked": return .success
            case "modified":         return .warning
            case "deleted":          return .destructive
            case "renamed":          return .accent
            default:                 return .secondaryForeground
            }
        }
        if isIgnored { return .mutedForeground }
        return .secondaryForeground
    }

    /// Builds an absolute-path → raw-status map from a `GitStatusResult`. Staged files are added
    /// first, then unstaged overwrite (matching FileExplorer.tsx). Absolute path is taken from
    /// `absolutePath` when present, else synthesized as `workingDir/relativePath`.
    nonisolated static func gitFilesMap(_ status: GitStatusResult?, workingDir: String) -> [String: String] {
        guard let status else { return [:] }
        var map: [String: String] = [:]
        for f in status.stagedFiles {
            map[f.absolutePath ?? "\(workingDir)/\(f.path)"] = f.status
        }
        for f in status.unstagedFiles {
            map[f.absolutePath ?? "\(workingDir)/\(f.path)"] = f.status
        }
        return map
    }
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `swift test --filter GitStatusColorTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/GitStatusColor.swift \
        native/Tests/TaskflowTests/GitStatusColorTests.swift
git commit -m "feat(native): git-status color + gitFiles map helpers (TDD)"
```

---

## Task 3: ActiveWorkspace working-dir resolver + homedir fetch

The panels need a "working directory". Ports the working-dir derivation in `useActiveWorkspace.ts` and fetches the homedir once (for the master workspace).

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/ActiveWorkspace.swift`
- Create: `native/Tests/TaskflowTests/ActiveWorkspaceTests.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (add `homedir` + fetch in `boot()`)

**Interfaces:**
- Consumes: generated `TaskItem` (`.worktree.enabled: Bool`, `.worktree.path: String?`, `.projectId`), `Project` (`.path: String`), `SystemInfo { homedir: String }`, `MessageType.systemInfo`.
- Produces:
  - `enum ActiveWorkspace` with `nonisolated static func workingDir(task: TaskItem?, project: Project?, masterActive: Bool, homedir: String?) -> String?`
  - `AppEnvironment.homedir: String?`

- [ ] **Step 1: Write the failing test**

Create `native/Tests/TaskflowTests/ActiveWorkspaceTests.swift`. First read `native/Sources/Taskflow/Generated/Models/` for the exact `TaskItem`, `TaskWorktree`, and `Project` memberwise initializers and build minimal fixtures. Skeleton:

```swift
import XCTest
@testable import Taskflow

final class ActiveWorkspaceTests: XCTestCase {
    func testMasterReturnsHomedir() {
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: true, homedir: "/Users/me"),
            "/Users/me")
    }

    func testMasterWithNilHomedirReturnsNil() {
        XCTAssertNil(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: true, homedir: nil))
    }

    func testTaskWithWorktreeUsesWorktreePath() {
        let task = makeTask(worktreeEnabled: true, worktreePath: "/wt/branch")
        let project = makeProject(path: "/repo")
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: task, project: project, masterActive: false, homedir: nil),
            "/wt/branch")
    }

    func testTaskWithoutWorktreeUsesProjectPath() {
        let task = makeTask(worktreeEnabled: false, worktreePath: nil)
        let project = makeProject(path: "/repo")
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: task, project: project, masterActive: false, homedir: nil),
            "/repo")
    }

    func testProjectOnlyUsesProjectPath() {
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: nil, project: makeProject(path: "/repo"),
                                       masterActive: false, homedir: nil),
            "/repo")
    }

    func testNothingActiveReturnsNil() {
        XCTAssertNil(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: false, homedir: nil))
    }

    // Helpers — fill in to match the generated memberwise initializers.
    private func makeTask(worktreeEnabled: Bool, worktreePath: String?) -> TaskItem { /* ... */ }
    private func makeProject(path: String) -> Project { /* ... */ }
}
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `swift test --filter ActiveWorkspaceTests`
Expected: FAIL — `ActiveWorkspace` undefined (and/or fixture compile errors to resolve against the real initializers).

- [ ] **Step 3: Implement `ActiveWorkspace.swift`**

Create `native/Sources/Taskflow/UI/Panels/ActiveWorkspace.swift`:

```swift
import Foundation

/// Resolves the active workspace's working directory. Ports the `workingDir` branch of
/// `useActiveWorkspace.ts`: master → homedir; task → worktree path (if enabled & present)
/// else project path; project → project path; otherwise nil.
enum ActiveWorkspace {
    nonisolated static func workingDir(
        task: TaskItem?, project: Project?, masterActive: Bool, homedir: String?
    ) -> String? {
        if masterActive { return homedir }
        if let task, let project {
            if task.worktree.enabled, let wt = task.worktree.path, !wt.isEmpty { return wt }
            return project.path
        }
        if let project { return project.path }
        return nil
    }
}
```

> Verify `task.worktree.path` is `String?` and `project.path` is `String` against the generated models; adjust the `!wt.isEmpty` guard if `path` is non-optional.

- [ ] **Step 4: Run the test — expect PASS**

Run: `swift test --filter ActiveWorkspaceTests`
Expected: PASS.

- [ ] **Step 5: Add homedir fetch to `AppEnvironment`**

In `native/Sources/Taskflow/App/AppEnvironment.swift`, add the property near `status` (after line 8):
```swift
    private(set) var homedir: String?
```
In `boot()`, after `status = .connected(port: realPort)` (line 212), fetch it best-effort:
```swift
            if let info: SystemInfo = try? await client.request(.systemInfo, payload: [:]) {
                homedir = info.homedir
            }
```
(Best-effort: a failure leaves `homedir == nil`, so the master file explorer shows the empty state — acceptable parity.)

- [ ] **Step 6: Build + full test suite**

Run: `swift build && swift test`
Expected: clean; all green.

- [ ] **Step 7: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/ActiveWorkspace.swift \
        native/Tests/TaskflowTests/ActiveWorkspaceTests.swift \
        native/Sources/Taskflow/App/AppEnvironment.swift
git commit -m "feat(native): ActiveWorkspace working-dir resolver (TDD) + homedir fetch"
```

---

## Task 4: FileExplorerPane + FileTreeRow + AppShell wiring

The file tree itself: lifecycle (fetch/git/watch on working-dir change), recursive rows with git colors, expand/collapse/lazy-load, selection/open. Drag-move and the context menu come in Tasks 5–6. Ports `FileExplorer.tsx` + `FileTree.tsx`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/FileExplorerPane.swift`
- Create: `native/Sources/Taskflow/UI/Panels/FileTreeRow.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `env.files` (`FileViewModel`: `tree`, `gitStatus`, `gitStatusPath`, `expandedDirs`, `loadingDirs`, `focusedPath`, `loading`, `fetchTree`, `fetchGitStatus`, `watchPath`, `unwatchPath`, `clearExplorerState`, `toggleDir`, `setFocusedPath`, `onOpenFile`), `env.tasks?.activeTaskId`, `env.tasks?.tasks`, `env.projects?.projects`, `env.ui.masterWorkspaceActive`, `env.ui.activeProjectId`, `env.homedir`; `ActiveWorkspace.workingDir`, `GitStatusColor`; `AppIcon`; generated `FileNode { name; path; type; children: [FileNode]?; loaded: Bool? }`.
- Produces: `FileExplorerPane` and `FileTreeRow` views.

- [ ] **Step 1: Implement `FileTreeRow.swift`**

A recursive row. (No unit test — pure view; verified by build + Task-9 dogfood.)

```swift
import SwiftUI

/// One file/dir row in the explorer tree. Recursive — renders its children when expanded.
/// Port of `packages/ui/src/components/panels/FileTree.tsx` (view parts; context menu & drag
/// are layered on in Tasks 5–6).
struct FileTreeRow: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    let node: FileNode
    let depth: Int
    let gitFiles: [String: String]
    let rootPath: String

    private var files: FileViewModel? { env.files }
    private var isDir: Bool { node.type == "directory" }
    private var isExpanded: Bool { files?.expandedDirs.contains(node.path) ?? false }
    private var isFocused: Bool { files?.focusedPath == node.path }
    private var statusToken: ThemeToken {
        // isIgnored deferred — see FileExplorerPane (gitignore matcher is a Phase-5C+ seam).
        GitStatusColor.token(forStatus: gitFiles[node.path], isIgnored: false)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row
            if isDir && isExpanded {
                ForEach(node.children ?? [], id: \.path) { child in
                    FileTreeRow(node: child, depth: depth + 1, gitFiles: gitFiles, rootPath: rootPath)
                }
            }
        }
    }

    private var row: some View {
        HStack(spacing: 4) {
            if isDir {
                AppIcon(isExpanded ? "ChevronDown" : "ChevronRight").font(.system(size: 9))
                    .foregroundStyle(theme.color(.mutedForeground))
            } else {
                Spacer().frame(width: 11)  // align with chevron column
            }
            AppIcon(isDir ? (isExpanded ? "FolderOpen" : "Folder") : "File").font(.system(size: 11))
                .foregroundStyle(theme.color(.mutedForeground))
            Text(node.name)
                .font(.system(size: 12))
                .foregroundStyle(theme.color(statusToken))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .padding(.leading, CGFloat(depth) * 12 + 6)
        .padding(.trailing, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isFocused ? theme.color(.accent).opacity(0.20) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .contentShape(Rectangle())
        .onTapGesture {
            files?.setFocusedPath(node.path)
            if isDir { files?.toggleDir(node.path) } else { files?.onOpenFile?(node.path) }
        }
    }
}
```

> Confirm `AppIcon` accepts the lucide names `"ChevronDown"/"ChevronRight"/"FolderOpen"/"Folder"/"File"` by checking `AppIcon.symbol(forLucide:)`; if `"File"`/`"Folder"` aren't mapped, use the nearest mapped names (e.g. `"FileText"`, `"FolderOpen"`) and note it.

- [ ] **Step 2: Implement `FileExplorerPane.swift`**

```swift
import SwiftUI

/// File explorer panel root. Drives the `FileViewModel` lifecycle from the active working dir and
/// renders the tree. Port of `packages/ui/src/components/panels/FileExplorer.tsx`.
struct FileExplorerPane: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    private var files: FileViewModel? { env.files }

    private var workingDir: String? {
        let activeTaskId = env.tasks?.activeTaskId
        let task = activeTaskId.flatMap { id in env.tasks?.tasks.first { $0.id == id } }
        let project: Project? = {
            if let task { return env.projects?.projects.first { $0.id == task.projectId } }
            if let pid = env.ui.activeProjectId { return env.projects?.projects.first { $0.id == pid } }
            return nil
        }()
        return ActiveWorkspace.workingDir(
            task: task, project: project,
            masterActive: env.ui.masterWorkspaceActive, homedir: env.homedir)
    }

    /// Mirrors the FileExplorer.tsx `gitFiles` memo (only valid when gitStatusPath == workingDir).
    private var gitFiles: [String: String] {
        guard let wd = workingDir, files?.gitStatusPath == wd else { return [:] }
        return GitStatusColor.gitFilesMap(files?.gitStatus, workingDir: wd)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let wd = workingDir, let files {
                if let tree = files.tree {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(tree.children ?? [], id: \.path) { child in
                                FileTreeRow(node: child, depth: 0, gitFiles: gitFiles, rootPath: wd)
                            }
                        }
                        .padding(4)
                    }
                } else if files.loading {
                    centered("Loading…")
                } else {
                    centered("Empty")
                }
            } else {
                centered("Select a task or project")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.color(.card))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: workingDir) { await loadWorkingDir() }
    }

    private func centered(_ text: String) -> some View {
        Text(text).foregroundStyle(theme.foreground.opacity(0.35)).font(.caption)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Mirrors FileExplorer.tsx's effect: on workingDir change, clear + fetch tree + git + watch.
    private func loadWorkingDir() async {
        guard let files else { return }
        guard let wd = workingDir else { files.clearExplorerState(); return }
        files.clearExplorerState()
        await files.fetchTree(path: wd)
        await files.fetchGitStatus(path: wd)
        await files.watchPath(path: wd)
    }
}
```

> Verify `env.projects?.projects` and the `Project.id`/`.path` field names against `ProjectViewModel`/the generated `Project`. Verify `env.tasks?.tasks` and `TaskItem.id`/`.projectId`. The `.task(id:)` re-runs whenever `workingDir` changes — confirm `unwatchPath` of the previous path is handled inside `FileViewModel.watchPath` (it is: it unwatches `previousPath` before watching the new one).

- [ ] **Step 3: Wire into `AppShell`**

In `native/Sources/Taskflow/UI/Shell/AppShell.swift`, replace the file-explorer/search `panelPlaceholder` block (lines 35–46) so the file-explorer slot renders the real pane (search still placeholder until Task 8):

```swift
            // ── File explorer / search (mutually exclusive, conditional) ─
            if ui.fileExplorerOpen || ui.searchPanelOpen {
                Group {
                    if ui.fileExplorerOpen {
                        FileExplorerPane()
                    } else {
                        panelPlaceholder("Search", width: ui.fileExplorerWidth)
                    }
                }
                .frame(width: ui.fileExplorerWidth)

                ResizeHandle(orientation: .vertical) { delta in
                    env.ui.setFileExplorerWidth(env.ui.fileExplorerWidth + delta)
                } onEnded: {
                    persistLayout()
                }
            }
```

> Note: `FileExplorerPane` already fills its frame; the `.frame(width:)` on the `Group` sets the panel width. Keep `panelPlaceholder` (used by flow/task-info and the temporary search slot).

- [ ] **Step 4: Build + tests**

Run: `swift build && swift test`
Expected: clean; all green (no new unit tests this task — views).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/FileExplorerPane.swift \
        native/Sources/Taskflow/UI/Panels/FileTreeRow.swift \
        native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): file explorer pane + tree rows (git colors, expand/lazy/select)"
```

---

## Task 5: File drag-move + MoveFileDialog

Drag a file/dir onto a directory row → confirm → rename(move). Ports the drag/drop + `pendingMove` flow in `FileTree.tsx` + `MoveFileDialog.tsx`.

**Files:**
- Modify: `native/Sources/Taskflow/UI/Panels/FileTreeRow.swift`
- Create: `native/Sources/Taskflow/UI/Panels/FileDialogs.swift` (start with `MoveFileDialog`; Task 6 adds the rest)

**Interfaces:**
- Consumes: `FileViewModel.setPendingMove(_:)`, `.clearPendingMove()`, `.pendingMove`, `.dragOverPath`, `.setDragOverPath(_:)`, `.renameFile(oldPath:newPath:)`; `PendingMove { sourcePath; destinationDir }`.
- Produces: `struct FilePathDragItem: Codable, Transferable, Sendable` (UTType `com.taskflow.filepath`); `MoveFileDialog` view; move-validation helper `nonisolated static func canMove(source:dest:) -> Bool`.

- [ ] **Step 1: Add the drag payload + validation (with a quick test)**

Append to `native/Tests/TaskflowTests/GitStatusColorTests.swift` a sibling test file is overkill — instead add `native/Tests/TaskflowTests/FileMoveTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class FileMoveTests: XCTestCase {
    func testRejectsMoveOntoSelf() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a", dest: "/r/a"))
    }
    func testRejectsMoveIntoOwnSubtree() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a", dest: "/r/a/b"))
    }
    func testRejectsMoveIntoCurrentParent() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a/x.txt", dest: "/r/a"))
    }
    func testAllowsValidMove() {
        XCTAssertTrue(FileTreeRow.canMove(source: "/r/a/x.txt", dest: "/r/b"))
    }
}
```

- [ ] **Step 2: Run — expect FAIL**, then implement.

Run: `swift test --filter FileMoveTests` → FAIL (`canMove` undefined).

- [ ] **Step 3: Add the payload, validation, and drag/drop modifiers to `FileTreeRow`**

In `FileTreeRow.swift`, add at top (after `import SwiftUI`):

```swift
import UniformTypeIdentifiers

extension UTType {
    static let taskflowFilePath = UTType(exportedAs: "com.taskflow.filepath")
}

/// Drag payload for moving a file/dir within the explorer. Mirrors the TS custom MIME
/// `application/x-taskflow-path` (FileTree.tsx).
struct FilePathDragItem: Codable, Transferable, Sendable {
    let path: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .taskflowFilePath)
    }
}
```

Add the validation helper inside `FileTreeRow` (mirrors FileTree.tsx drop guards):

```swift
    /// Move is invalid if dest == source, dest is inside source's subtree, or dest is the
    /// source's current parent directory. Mirrors the FileTree.tsx onDrop validation.
    nonisolated static func canMove(source: String, dest: String) -> Bool {
        if source == dest { return false }
        if dest == source || dest.hasPrefix(source + "/") { return false }   // descendant
        let parent = source.contains("/") ? String(source[..<source.lastIndex(of: "/")!]) : ""
        if dest == parent { return false }
        return true
    }
```

Add to the `row` view's modifier chain (after `.onTapGesture`):

```swift
        .draggable(FilePathDragItem(path: node.path))
```

And, only for directory rows, a drop destination + drag-over highlight. Wrap the `row`'s background to also reflect `files?.dragOverPath == node.path`, and append:

```swift
        .dropDestination(for: FilePathDragItem.self) { items, _ in
            guard isDir, let dropped = items.first,
                  Self.canMove(source: dropped.path, dest: node.path) else { return false }
            files?.setPendingMove(PendingMove(sourcePath: dropped.path, destinationDir: node.path))
            return true
        } isTargeted: { hovering in
            files?.setDragOverPath(hovering && isDir ? node.path : nil)
        }
```

Update the row background to include drag-over:
```swift
        .background(
            (files?.dragOverPath == node.path) ? theme.color(.accent).opacity(0.30)
                : isFocused ? theme.color(.accent).opacity(0.20) : Color.clear
        )
```

- [ ] **Step 4: Implement `MoveFileDialog` in `FileDialogs.swift`**

Create `native/Sources/Taskflow/UI/Panels/FileDialogs.swift`:

```swift
import SwiftUI

/// Confirms a pending drag-move and performs it via `renameFile`. Port of MoveFileDialog.tsx.
/// Presented from `FileExplorerPane` bound to `FileViewModel.pendingMove`.
struct MoveFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let move: PendingMove

    private var files: FileViewModel? { env.files }
    private var fileName: String {
        move.sourcePath.contains("/")
            ? String(move.sourcePath[move.sourcePath.index(after: move.sourcePath.lastIndex(of: "/")!)...])
            : move.sourcePath
    }
    private var newPath: String { "\(move.destinationDir)/\(fileName)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Move file").font(.headline)
            Text("Move “\(fileName)” to “\(move.destinationDir)”?")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") { files?.clearPendingMove() }
                Button("Move") {
                    let old = move.sourcePath, new = newPath
                    Task { try? await files?.renameFile(oldPath: old, newPath: new) }
                    files?.clearPendingMove()
                }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(16).frame(width: 360)
    }
}
```

Present it from `FileExplorerPane.body` by adding a `.sheet` driven by `pendingMove`:

```swift
        .sheet(isPresented: Binding(
            get: { files?.pendingMove != nil },
            set: { if !$0 { files?.clearPendingMove() } }
        )) {
            if let move = files?.pendingMove { MoveFileDialog(move: move) }
        }
```

- [ ] **Step 5: Run move tests + build**

Run: `swift test --filter FileMoveTests && swift build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/FileTreeRow.swift \
        native/Sources/Taskflow/UI/Panels/FileDialogs.swift \
        native/Sources/Taskflow/UI/Panels/FileExplorerPane.swift \
        native/Tests/TaskflowTests/FileMoveTests.swift
git commit -m "feat(native): file explorer drag-move + MoveFileDialog (TDD validation)"
```

---

## Task 6: File context menu + create/rename/delete dialogs

Right-click menu on rows + the remaining file dialogs. Ports `FileContextMenu.tsx`, `CreateFileDialog.tsx`, `RenameFileDialog.tsx`, `DeleteFileDialog.tsx`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/FileContextMenu.swift`
- Modify: `native/Sources/Taskflow/UI/Panels/FileDialogs.swift` (add Create/Rename/Delete)
- Modify: `native/Sources/Taskflow/UI/Panels/FileTreeRow.swift` (attach `.contextMenu` + present dialogs)

**Interfaces:**
- Consumes: `FileViewModel.createFile/createDirectory/renameFile/deleteFile/openExternal/revealInFinder`; `env.session?.createSession(...)` (signature: `taskId:projectId:master:type:label:cwd:targetWorkspaceKey:`); `env.tasks?.activeTaskId`, `env.ui.activeProjectId`, `env.ui.masterWorkspaceActive`; `NSPasteboard` for copy-path; `TabType.shell`.
- Produces: a `FileRowAction` enum (which dialog to present) + `FileContextMenu` view-builder + `CreateFileDialog`/`RenameFileDialog`/`DeleteFileDialog`.

- [ ] **Step 1: Add a row-action enum + dialog state to `FileTreeRow`**

In `FileTreeRow.swift`, add a local presentation enum and `@State`:

```swift
enum FileRowAction: Identifiable {
    case createFile(parentDir: String)
    case createFolder(parentDir: String)
    case rename(path: String)
    case delete(path: String, isDir: Bool)
    var id: String {
        switch self {
        case .createFile(let p): return "cf:\(p)"
        case .createFolder(let p): return "cd:\(p)"
        case .rename(let p): return "rn:\(p)"
        case .delete(let p, _): return "del:\(p)"
        }
    }
}
```

Add `@State private var action: FileRowAction?` to `FileTreeRow` and a `.sheet(item: $action)` that switches to the right dialog (Create/Rename/Delete).

- [ ] **Step 2: Implement `FileContextMenu.swift`**

```swift
import SwiftUI
import AppKit

/// Context-menu items for a file/dir row. Port of `panels/FileContextMenu.tsx`.
/// Dialog-requiring items set the bound `action`; the rest act directly.
struct FileContextMenu: View {
    @Environment(AppEnvironment.self) private var env
    let node: FileNode
    let rootPath: String
    @Binding var action: FileRowAction?

    private var files: FileViewModel? { env.files }
    private var isDir: Bool { node.type == "directory" }

    var body: some View {
        Group {
            if isDir {
                Button("New File") { action = .createFile(parentDir: node.path) }
                Button("New Folder") { action = .createFolder(parentDir: node.path) }
                Divider()
            }
            Button("Rename") { action = .rename(path: node.path) }
            Button("Delete", role: .destructive) { action = .delete(path: node.path, isDir: isDir) }
            Divider()
            Button("Copy Path") { copy(node.path) }
            Button("Copy Relative Path") { copy(relativePath) }
            if !isDir {
                Button("Open in External Editor") {
                    Task { try? await files?.openExternal(path: node.path) }
                }
            }
            Button("Reveal in Finder") { Task { try? await files?.revealInFinder(path: node.path) } }
            Button("Open in Terminal") { openInTerminal() }
        }
    }

    private var relativePath: String {
        let prefix = rootPath + "/"
        return node.path.hasPrefix(prefix) ? String(node.path.dropFirst(prefix.count)) : node.path
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    /// Opens a shell session whose cwd is the target dir (the file's parent, or the dir itself).
    /// Mirrors FileContextMenu.tsx "Open in Terminal" → createSession(..., "shell", ..., targetDir).
    private func openInTerminal() {
        let targetDir = isDir ? node.path
            : (node.path.contains("/") ? String(node.path[..<node.path.lastIndex(of: "/")!]) : rootPath)
        let taskId = env.tasks?.activeTaskId
        let projectId = taskId == nil ? env.ui.activeProjectId : nil
        let master = taskId == nil && projectId == nil && env.ui.masterWorkspaceActive
        guard taskId != nil || projectId != nil || master else { return }
        Task {
            try? await env.session?.createSession(
                taskId: taskId, projectId: projectId, master: master,
                type: .shell, label: nil, cwd: targetDir, targetWorkspaceKey: nil)
        }
    }
}
```

> Verify `TabType` has a `.shell` case and `createSession`'s parameter labels match exactly (read `SessionViewModel.swift:135-142`). If `TabType` uses a different spelling, adjust.

- [ ] **Step 3: Add Create/Rename/Delete dialogs to `FileDialogs.swift`**

Append three SwiftUI dialogs:

```swift
/// Create a new file or folder under `parentDir`. Port of CreateFileDialog.tsx.
struct CreateFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let parentDir: String
    let isFolder: Bool
    let onClose: () -> Void
    @State private var name = ""

    private var files: FileViewModel? { env.files }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(isFolder ? "New Folder" : "New File").font(.headline)
            AppTextField(placeholder: isFolder ? "folder name" : "file name", text: $name)
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Create") {
                    let path = "\(parentDir)/\(name)"
                    let folder = isFolder
                    Task {
                        if folder { try? await files?.createDirectory(path: path) }
                        else { try? await files?.createFile(path: path) }
                    }
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.isEmpty)
            }
        }.padding(16).frame(width: 360)
    }
}

/// Rename a file/dir. Port of RenameFileDialog.tsx.
struct RenameFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let path: String
    let onClose: () -> Void
    @State private var newName: String

    init(path: String, onClose: @escaping () -> Void) {
        self.path = path
        self.onClose = onClose
        let base = path.contains("/")
            ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
        _newName = State(initialValue: base)
    }

    private var files: FileViewModel? { env.files }
    private var parent: String {
        path.contains("/") ? String(path[..<path.lastIndex(of: "/")!]) : ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Rename").font(.headline)
            AppTextField(placeholder: "new name", text: $newName)
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Rename") {
                    let old = path
                    let new = parent.isEmpty ? newName : "\(parent)/\(newName)"
                    Task { try? await files?.renameFile(oldPath: old, newPath: new) }
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(newName.isEmpty)
            }
        }.padding(16).frame(width: 360)
    }
}

/// Confirm + delete a file/dir. Port of DeleteFileDialog.tsx.
struct DeleteFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let path: String
    let isDir: Bool
    let onClose: () -> Void

    private var files: FileViewModel? { env.files }
    private var name: String {
        path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Delete \(isDir ? "folder" : "file")").font(.headline)
            Text("Delete “\(name)”? This cannot be undone.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Delete", role: .destructive) {
                    let p = path
                    Task { try? await files?.deleteFile(path: p) }
                    onClose()
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(16).frame(width: 360)
    }
}
```

> Confirm the `AppTextField` initializer label (`placeholder:text:`) against `UI/Primitives/`; adjust if different.

- [ ] **Step 4: Attach the menu + dialog presentation in `FileTreeRow`**

Add to the `row` modifier chain:
```swift
        .contextMenu { FileContextMenu(node: node, rootPath: rootPath, action: $action) }
```
And present:
```swift
        .sheet(item: $action) { act in
            switch act {
            case .createFile(let p):   CreateFileDialog(parentDir: p, isFolder: false) { action = nil }
            case .createFolder(let p): CreateFileDialog(parentDir: p, isFolder: true)  { action = nil }
            case .rename(let p):       RenameFileDialog(path: p) { action = nil }
            case .delete(let p, let d):DeleteFileDialog(path: p, isDir: d) { action = nil }
            }
        }
```

- [ ] **Step 5: Build + tests**

Run: `swift build && swift test`
Expected: clean; all green.

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/FileContextMenu.swift \
        native/Sources/Taskflow/UI/Panels/FileDialogs.swift \
        native/Sources/Taskflow/UI/Panels/FileTreeRow.swift
git commit -m "feat(native): file explorer context menu + create/rename/delete dialogs"
```

---

## Task 7: SearchResultsView (file groups + highlighted matches)

The results list. Ports `SearchResults.tsx` (groups, match lines, highlight, replace/dismiss).

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/SearchResultsView.swift`
- Create: `native/Tests/TaskflowTests/SearchHighlightTests.swift`

**Interfaces:**
- Consumes: `env.search` (`SearchViewModel`: `results`, `totalMatches`, `expandedFiles`, `toggleFileExpanded`, `replaceInFile`, `replaceMatch`, `removeFile`, `removeMatch`); generated `SearchFileResult { path; matches: [SearchMatch] }`, `SearchMatch { line/column/matchLength: Double; lineContent: String }`; `AppIcon`. The root working dir is passed in.
- Produces: `SearchResultsView`; `nonisolated static func splitLine(_:column:matchLength:) -> (before: String, match: String, after: String)`.

- [ ] **Step 1: Write the highlight-split test**

Create `native/Tests/TaskflowTests/SearchHighlightTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class SearchHighlightTests: XCTestCase {
    func testSplitsLineAroundMatch() {
        // 1-based column, like the backend. "let x = 1", match "x" at column 5, length 1.
        let parts = SearchResultsView.splitLine("let x = 1", column: 5, matchLength: 1)
        XCTAssertEqual(parts.before, "let ")
        XCTAssertEqual(parts.match, "x")
        XCTAssertEqual(parts.after, " = 1")
    }

    func testClampsOutOfRangeColumn() {
        let parts = SearchResultsView.splitLine("abc", column: 99, matchLength: 5)
        XCTAssertEqual(parts.before + parts.match + parts.after, "abc")  // no crash, lossless
    }
}
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `swift test --filter SearchHighlightTests` → FAIL.

- [ ] **Step 3: Implement `SearchResultsView.swift`**

```swift
import SwiftUI

/// Search results — expandable per-file groups with highlighted match lines. Port of
/// `packages/ui/src/components/panels/SearchResults.tsx`.
struct SearchResultsView: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    let rootPath: String

    private var search: SearchViewModel? { env.search }

    var body: some View {
        if let search {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(search.totalMatches) result(s) in \(search.results.count) file(s)")
                    .font(.system(size: 11)).foregroundStyle(theme.color(.mutedForeground))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(search.results, id: \.path) { file in
                            fileGroup(file)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func fileGroup(_ file: SearchFileResult) -> some View {
        let expanded = search?.expandedFiles.contains(file.path) ?? false
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                AppIcon(expanded ? "ChevronDown" : "ChevronRight").font(.system(size: 9))
                Text(fileName(file.path)).font(.system(size: 12)).lineLimit(1)
                Text("\(file.matches.count)").font(.system(size: 9))
                    .padding(.horizontal, 4)
                    .background(theme.color(.muted)).clipShape(RoundedRectangle(cornerRadius: 3))
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 8).padding(.vertical, 3)
            .contentShape(Rectangle())
            .onTapGesture { search?.toggleFileExpanded(path: file.path) }
            .contextMenu {
                Button("Replace All in File") {
                    Task { await search?.replaceInFile(rootPath: rootPath, filePath: file.path) }
                }
                Button("Dismiss File") { search?.removeFile(filePath: file.path) }
            }
            if expanded {
                ForEach(file.matches, id: \.self) { match in
                    matchLine(file: file, match: match)
                }
            }
        }
    }

    @ViewBuilder private func matchLine(file: SearchFileResult, match: SearchMatch) -> some View {
        let parts = Self.splitLine(match.lineContent, column: Int(match.column),
                                   matchLength: Int(match.matchLength))
        HStack(alignment: .top, spacing: 6) {
            Text("\(Int(match.line))").font(.system(size: 10, design: .monospaced))
                .foregroundStyle(theme.color(.mutedForeground)).frame(width: 32, alignment: .trailing)
            (Text(parts.before)
                + Text(parts.match).foregroundColor(theme.color(.accentForeground))
                    .bold()
                + Text(parts.after))
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(1)
            Spacer(minLength: 4)
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 1)
        .contextMenu {
            Button("Replace") {
                Task { await search?.replaceMatch(rootPath: rootPath, filePath: file.path, match: match) }
            }
            Button("Dismiss") { search?.removeMatch(filePath: file.path, match: match) }
        }
    }

    private func fileName(_ path: String) -> String {
        path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
    }

    /// Splits a line into (before, match, after) around a 1-based column + match length.
    /// Mirrors the `HighlightedLine` slice math in SearchResults.tsx. Clamps to bounds so an
    /// out-of-range column never crashes and is lossless.
    nonisolated static func splitLine(_ line: String, column: Int, matchLength: Int)
        -> (before: String, match: String, after: String) {
        let chars = Array(line)
        let start = max(0, min(column - 1, chars.count))
        let end = max(start, min(start + matchLength, chars.count))
        return (String(chars[0..<start]), String(chars[start..<end]), String(chars[end...]))
    }
}
```

> `ForEach(file.matches, id: \.self)` requires `SearchMatch: Hashable`. If it is only `Equatable`, switch to `id: \.line` composed with column, e.g. wrap in an indexed `ForEach(Array(file.matches.enumerated()), id: \.offset)`. Verify against `Generated/Models/SearchTypes.swift`.

- [ ] **Step 4: Run — expect PASS + build.**

Run: `swift test --filter SearchHighlightTests && swift build`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/SearchResultsView.swift \
        native/Tests/TaskflowTests/SearchHighlightTests.swift
git commit -m "feat(native): search results view (file groups + highlighted matches, TDD split)"
```

---

## Task 8: SearchPane + AppShell wiring

The search/replace panel chrome: query/replace inputs, flag toggles, filter section, debounced search, Replace-All. Ports `SearchPanel.tsx`. Mounts into `AppShell`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panels/SearchPane.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `env.search` (`SearchViewModel`: `query`/`replacement`/`caseSensitive`/`wholeWord`/`useRegex`/`includePattern`/`excludePattern` (settable vars), `setQuery`, `setReplacement`, `setIncludePattern`, `setExcludePattern`, `toggleCaseSensitive`, `toggleWholeWord`, `toggleUseRegex`, `search(rootPath:)`, `replaceAll(rootPath:filePath:)`, `results`, `searching`); the working dir (reuse `ActiveWorkspace` the same way `FileExplorerPane` does); `AppTextField`, `AppButton`, `AppIcon`; `SearchResultsView`.
- Produces: `SearchPane` view.

- [ ] **Step 1: Implement `SearchPane.swift`**

```swift
import SwiftUI

/// Search/replace panel. Port of `packages/ui/src/components/panels/SearchPanel.tsx`.
/// Debounces 300ms and only searches for queries ≥ 3 chars (matching the TS panel).
struct SearchPane: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    @State private var showFilters = false
    @State private var debounce: Task<Void, Never>?

    private var search: SearchViewModel? { env.search }

    // Same working-dir derivation as FileExplorerPane.
    private var workingDir: String? {
        let activeTaskId = env.tasks?.activeTaskId
        let task = activeTaskId.flatMap { id in env.tasks?.tasks.first { $0.id == id } }
        let project: Project? = {
            if let task { return env.projects?.projects.first { $0.id == task.projectId } }
            if let pid = env.ui.activeProjectId { return env.projects?.projects.first { $0.id == pid } }
            return nil
        }()
        return ActiveWorkspace.workingDir(
            task: task, project: project,
            masterActive: env.ui.masterWorkspaceActive, homedir: env.homedir)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let search {
                @Bindable var s = search
                HStack(spacing: 4) {
                    AppTextField(placeholder: "Search", text: $s.query)
                        .onChange(of: search.query) { _, _ in scheduleSearch() }
                        .onSubmit { runSearch() }
                    flag("CaseSensitive", on: search.caseSensitive) { search.toggleCaseSensitive(); scheduleSearch() }
                    flag("WholeWord", on: search.wholeWord) { search.toggleWholeWord(); scheduleSearch() }
                    flag("Regex", on: search.useRegex) { search.toggleUseRegex(); scheduleSearch() }
                }
                HStack(spacing: 4) {
                    AppTextField(placeholder: "Replace", text: $s.replacement)
                    AppButton("Replace All", kind: .secondary) {
                        if let wd = workingDir { Task { await search.replaceAll(rootPath: wd, filePath: nil) } }
                    }
                    .disabled(search.results.isEmpty)
                    Button { showFilters.toggle() } label: { AppIcon("Filter") }.buttonStyle(.plain)
                }
                if showFilters {
                    AppTextField(placeholder: "files to include (e.g. *.ts)", text: $s.includePattern)
                        .onChange(of: search.includePattern) { _, _ in scheduleSearch() }
                    AppTextField(placeholder: "files to exclude", text: $s.excludePattern)
                        .onChange(of: search.excludePattern) { _, _ in scheduleSearch() }
                }
                if let wd = workingDir {
                    SearchResultsView(rootPath: wd)
                } else {
                    Text("Select a task or project")
                        .foregroundStyle(theme.foreground.opacity(0.35)).font(.caption)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.color(.card))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func flag(_ icon: String, on: Bool, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { AppIcon(icon) }
            .buttonStyle(.plain)
            .padding(3)
            .background(on ? theme.color(.accent).opacity(0.25) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    /// Debounced auto-search (300ms, ≥3 chars), mirroring SearchPanel.tsx.
    private func scheduleSearch() {
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(300))
            if Task.isCancelled { return }
            runSearch()
        }
    }

    private func runSearch() {
        guard let wd = workingDir, let search, search.query.count >= 3 else { return }
        Task { await search.search(rootPath: wd) }
    }
}
```

> Verify: `AppTextField` supports a `Binding<String>` (`$s.query`). `SearchViewModel`'s `query`/`replacement`/`includePattern`/`excludePattern` are plain `var` (settable) so `@Bindable` binding works — confirm in `SearchViewModel.swift` (they are). Confirm `AppButton`'s init label (`AppButton(_:kind:action:)`) and that the lucide names `"CaseSensitive"`/`"WholeWord"`/`"Regex"`/`"Filter"` resolve in `AppIcon.symbol(forLucide:)`; if not mapped, pick the closest mapped icons (e.g. `"Filter"` exists per the 5A icon map) and note substitutions.

- [ ] **Step 2: Wire into `AppShell`**

In `AppShell.swift`, replace the temporary search placeholder added in Task 4 so the search slot renders `SearchPane`:

```swift
                Group {
                    if ui.fileExplorerOpen {
                        FileExplorerPane()
                    } else {
                        SearchPane()
                    }
                }
                .frame(width: ui.fileExplorerWidth)
```

- [ ] **Step 3: Build + tests**

Run: `swift build && swift test`
Expected: clean; all green.

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Taskflow/UI/Panels/SearchPane.swift \
        native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): search/replace panel (debounced, flags, filters) wired into shell"
```

---

## Task 9: TaskCard diff badges + ProjectGroup branch label

Fill the Phase-5B-deferred diff-store seams using the new `DiffViewModel`. Ports the worktree-badge `behind`/`diffStats` rendering in `TaskCard.tsx` and the `(branch)` label in `ProjectGroup.tsx`.

**Files:**
- Modify: `native/Sources/Taskflow/UI/Sidebar/TaskCard.swift:111-122` (the `worktreeBadge` seam at line 119)
- Modify: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift` (header, near line 101)

**Interfaces:**
- Consumes: `env.diff?.state.behindByProject[task.id]`, `env.diff?.state.statsByProject[task.id]`, `env.diff?.state.branchByProject[project.id]`; `DiffStats`.

- [ ] **Step 1: Add diff badges to `TaskCard.worktreeBadge`**

Replace the seam comment at `TaskCard.swift:119` (`// Phase 5C/diff-store seam: ...`) with the `behind` + `+adds/-dels` spans, mirroring `TaskCard.tsx:318-326`. The badge keys off `task.id` (the diff-store target id for a task worktree):

```swift
    @ViewBuilder private func worktreeBadge(branch: String, pr: TaskWorktreePr?) -> some View {
        let behind = env.diff?.state.behindByProject[task.id] ?? 0
        let stats = env.diff?.state.statsByProject[task.id]
        HStack(spacing: 3) {
            AppIcon("GitBranch").font(.system(size: 9))
            Text(branch).font(.system(size: 10)).lineLimit(1)
            if let pr {
                Text("#\(Int(pr.number))").font(.system(size: 10))
            }
            if behind > 0 {
                Text("↓\(behind)").font(.system(size: 10)).foregroundStyle(theme.color(.info))
            }
            if let stats {
                Text("+\(stats.additions)").font(.system(size: 10)).foregroundStyle(theme.color(.success))
                Text("-\(stats.deletions)").font(.system(size: 10)).foregroundStyle(theme.color(.destructive))
            }
        }
        .foregroundStyle(theme.color(.mutedForeground))
    }
```

- [ ] **Step 2: Add the branch label to `ProjectGroup` header**

In `ProjectGroup.swift`, after the `Text(project.name)` in the header (around line 101–105), add the `(branch)` label mirroring `ProjectGroup.tsx:296-298` (only when not location-invalid; ProjectGroup already has the project — gate only on a non-nil branch here, since location validity isn't modelled in this view):

```swift
            if let branch = env.diff?.state.branchByProject[project.id] {
                Text("(\(branch))")
                    .font(.system(size: 10))
                    .foregroundStyle(theme.color(.mutedForeground))
                    .lineLimit(1)
            }
```

> Read the surrounding header HStack to place this immediately after the name `Text` and before `Spacer(minLength: 4)`. Confirm `theme` is in scope in that view (it is: `@Environment(\.appTheme)` at line 27).

- [ ] **Step 3: Build + tests**

Run: `swift build && swift test`
Expected: clean; all green.

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Taskflow/UI/Sidebar/TaskCard.swift \
        native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift
git commit -m "feat(native): worktree diff/behind badges + project branch label (diff-store)"
```

---

## Self-Review

**1. Spec coverage (master-plan 5.2 + 5B-deferred diff-store):**
- File tree (OutlineGroup-style recursion) → Task 4 ✅
- Git-status colors → Tasks 2 (helper) + 4 (applied) ✅
- File context menu → Task 6 ✅ (+ create/rename/delete/move dialogs Tasks 5–6)
- Search/replace → Tasks 7 (results) + 8 (panel) ✅
- Diff-store port (`DiffViewModel`) → Task 1 ✅
- Worktree `+adds/-dels` + `behind` on TaskCard → Task 9 ✅
- ProjectGroup branch label → Task 9 ✅
- FileViewModel diff-store seam (`// Phase 5:`) → Task 1 ✅

**2. Placeholder scan:** No `TBD`/`add validation`/"similar to Task N" — every step has concrete code or a concrete command. Verification reminders ("confirm X against the generated model") are deliberate drift-guards per the 5B lesson, not placeholders.

**3. Type consistency:** `DiffViewModel.apply` / `DiffState` / `DiffStats` consistent across Tasks 1 & 9. `ActiveWorkspace.workingDir` signature identical in Tasks 3, 4, 8. `FileTreeRow.canMove` / `FilePathDragItem` / `FileRowAction` consistent across Tasks 5–6. `SearchResultsView.splitLine` consistent across Task 7. Working-dir derivation duplicated verbatim in `FileExplorerPane` and `SearchPane` (acceptable: 6 lines, no shared-state coupling; could be hoisted to `ActiveWorkspace` later — noted, not required).

## Scope decisions (explicit)

- **File-operation dialogs (Create/Rename/Delete/Move) are IN 5C**, presented as panel-local SwiftUI sheets/alerts. They are panel-scoped (triggered only from the file tree), unlike the **app-global** dialog host + sidebar task/project modals that Phase **5F** owns. Deferring them would leave the file context menu hollow, unlike 5B's clean request-seam deferrals.

## Deferred / accepted parity gaps (NOT bugs — document in results)

- **gitignore "ignored" dimming:** the TS uses the `ignore` npm package for full gitignore matching to dim ignored rows. No Swift matcher is vendored. `GitStatusColor.token(isIgnored:)` supports it, but `FileTreeRow` passes `isIgnored: false` (clean seam). A real gitignore matcher is a Phase-5C+/later unit.
- **Catppuccin per-filetype icons:** TS uses an SVG icon set per extension; native uses generic `AppIcon` file/folder symbols (parity-acceptable; richer glyphs are a later polish).
- **Keyboard navigation inside the tree** (arrows / Cmd+arrows) and **auto-scroll-to-focused**: the sidebar got keyboard nav in 5B; the file tree's is deferred to the Phase-6 two-render-worlds focus audit (same `.onKeyPress`-needs-first-responder caveat).
- **`TaskHeader` workspace diff stats** (`TaskHeader.tsx` also consumes the diff-store): the workspace header isn't built yet; `DiffViewModel` already serves it whenever that area lands.
- **LIVE in-app visual verification = HUMAN DOGFOOD** (isolation-sensitive per `project_native_sidecar_sandbox`): the controller must NOT autonomously launch the dev app. Code gate = build clean + tests green. Dogfood checklist to record in the results spec: file tree renders + git colors; expand/collapse + lazy-load; click file opens an editor tab; context menu create/rename/delete/move; copy path / reveal / open-external / open-in-terminal; search panel debounced search + flags + filters + replace-all + per-file/per-match replace/dismiss; worktree `↓behind`/`+adds`/`-dels` badges + project `(branch)` label appear when the backend emits `git:change-stats`.

## Execution notes for the implementer (5B lessons)

- Hand each implementer the **env-injection convention** (Global Constraints) — the example code uses `@Environment(AppEnvironment.self)` and treats `env.files/search/diff/tasks/projects/session` as **optional**.
- **Grep before every call site**: `FileViewModel`/`SearchViewModel`/`SessionViewModel.createSession` signatures and the generated `FileNode`/`SearchMatch`/`GitFileStatus`/`ChangeStats`/`TaskItem`/`Project` initializers — confirm field names, optionality, and `Double`-vs-`Int` before writing fixtures and call sites.
- Pure helpers (`apply`, `token`, `gitFilesMap`, `workingDir`, `canMove`, `splitLine`) are **`nonisolated static`** so tests call them off the main actor.
- Run `swift build && swift test` from `native/` after each task; expected baseline before this phase: build clean, 182 tests / 0 failures (5B). Each TDD task adds tests; none should regress.

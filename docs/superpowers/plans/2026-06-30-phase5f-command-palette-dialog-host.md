# Phase 5F — Command Palette + Shortcuts Dialog + Global Dialog Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Electron command palette (Cmd+Shift+P), the keyboard-shortcuts sheet (Cmd+/), the global app-level dialog host, and the 5B/5D-deferred sidebar/workspace modals (New Task, New Project, Missing Location, Fork Project, Flow Input, and the "Run with options" Agent-Options dialog) to native SwiftUI — completing master-plan unit 5.8 plus the carry-forward modals — and wire the global menu-bar keyboard shortcuts that open them.

**Architecture:** A new `GlobalDialogHost` view is mounted once in `AppShell` and owns every app-level singleton sheet (command palette, shortcuts, New Task, New Project, Missing Location, Fork, Flow Input, Run-with-options). It observes the existing `UIViewModel` boolean flags (`commandPaletteOpen`, `shortcutsDialogOpen`, already present but previously unmounted), the existing `TaskCreationViewModel` request seam (`newTaskRequest`/`newProjectRequested`, which currently has no consumer), and two new transient request fields added to `RunMenuViewModel` (`flowInputRequest`, `runOptionsRequest`) that fill the two `// 5F:` seams already stubbed inside `RunMenuViewModel.callbacks(...)`. A SwiftUI `.commands {}` block on the `WindowGroup` provides the global keyboard shortcuts (Cmd+Shift+P / Cmd+/ / Cmd+, / Cmd+N), each toggling a `UIViewModel` flag or setting a `TaskCreationViewModel` request, with a guard that suppresses the palette toggle when another modal is already presented. Pure logic (the fuzzy matcher, the palette row builder, the fork-folder slugifier) is TDD'd; views are verified by `swift build` + human dogfood.

**Tech Stack:** Swift 6, SwiftUI, `@Observable`/`@MainActor` view models, XCTest. `NSOpenPanel` for folder/file pickers (precedent: `UI/Settings/GeneralSection.swift`). Backend reached over the existing `WSClient` — all needed `MessageType` cases already generated (`taskCreate`, `sessionCreate`, `projectAdd`, `projectUpdate`, `projectRemove`, `projectFork`, `flowStart`, `scriptsList`, `agentCommandsList`).

## Global Constraints

Copied verbatim from the project conventions (`CLAUDE.md`) and the Phase-5A–5E execution lessons. **Every task implicitly includes this section.**

- **Build tool:** run `swift build` / `swift test` from the `native/` directory. Use `bun` (never `npm`/`yarn`) for any TS/codegen command. **No codegen is needed** in this phase — all required generated types already exist.
- **No `as any` / no force casts of domain types**; pursue proper typing. **No `AnyCodable`** in new code except where you must read/write a generated field already typed `AnyCodable` (e.g. the `type` discriminator inside `*LaunchOptions`). The 5A/5D agent-options fragments and `AgentOptionsFormModel.options(for:)` already produce a valid `AgentLaunchOptions`; do not hand-build `AnyCodable`.
- **No new domain types.** Reuse generated structs/enums (`TaskItem`, `Project`, `FlowDefinition`, `FlowInputDefinition`, `AgentLaunchOptions`, `ActionDefinition`, `AgentCommand`, `AgentType`, `SessionType`, `TabType`, `ProjectForkResponse`, `FlowStartPayload`). Only **UI-local** helper types may be hand-authored: the palette models (`PaletteEntry`/`PaletteRow`/`PaletteGroup`/`FuzzyResult`), the shortcuts content model (`ShortcutGroup`/`ShortcutRow`), and the two small `Equatable` request structs added to `RunMenuViewModel` (`FlowInputRequest`/`RunOptionsRequest`). Mirror the existing precedent (`TaskCreationViewModel.NewTaskRequest`).
- **Don't export/widen visibility until necessary.** Everything `internal` or `private`; no `public`. If a symbol is never referenced outside its file, keep it `private`.
- **Pure static helpers must be `nonisolated`** — Swift 6 infers `@MainActor` on `View` and view-model members, so any pure function called from a test or non-isolated context must be `nonisolated static`. (Historical first hit: `AppSelect.label`; precedent throughout `RunMenuViewModel`, `SidebarReorder`, `ActiveWorkspace`.)
- **No disabling SwiftLint/eslint rules** — find the proper fix.
- **Env-injection convention** (re-confirmed 5B–5E): views use `@Environment(AppEnvironment.self) private var env` (NOT a key-path) and `@Environment(\.appTheme) private var theme`. On `AppEnvironment`: `env.ui` and `env.taskCreation` are **non-optional**; `env.tasks / projects / session / flows / search / files / settings / notifications / runMenu / diff / schedules / models / settingsCatalog / themeCatalog` are **OPTIONAL**. `env.session` is singular. `env.themeStore` is a non-optional `@ObservationIgnored let`. `env.homedir` exists (best-effort, fetched in boot).
- **This phase adds NO new `AppEnvironment` view models.** `flowInputRequest`/`runOptionsRequest` are added to the existing `RunMenuViewModel` (already in `AppEnvironment` since 5B), so the `AppEnvironmentTests` guards (`testClientDependentVMsAreNilBeforeCompose` / `testComposeSetsAllVMs`) do **not** change. Do not add VMs.
- **Grep the generated-type fields + real VM/primitive signatures before writing any call site.** Verified-good signatures for this phase:
  - `AppSelect(_ selection: Binding<Value>, options: [(value: Value, label: String)])` — `Value: Hashable` (tag type == selection type == Value).
  - `AppTextField(text: Binding<String>, placeholder: String = "Type here...")`.
  - `AppButton(title: String, kind: AppButton.Kind = .primary, action: @escaping () -> Void)`; `Kind { primary, secondary, destructive }`.
  - `AppToggle(title: String, isOn: Binding<Bool>)`.
  - `SettingRow(label: String, hint: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing)`.
  - `AppIcon("Name")` (Lucide-style name → SF Symbol).
  - `AppMenu(title: String, @ViewBuilder content: () -> Content)`.
  - `AppSegmentedTabs(selection: Binding<Int>, titles: [String])`.
  - `WSClient.request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res`.
  - `TaskViewModel.createTask(projectId:title:description:worktree:parentId:initCommand:) async throws -> TaskItem` (title/worktree/parentId/initCommand optional).
  - `ProjectViewModel.addProject(path:) async throws -> Project`; `updateProject(id:name:path:hidden:defaultInitCommand:prompt:linkedProjects:) async throws -> Project`; `removeProject(id:) async throws`; `forkProject(projectId:branch:folderName:) async throws -> ProjectForkResponse` (`@discardableResult`).
  - `FlowViewModel.startFlow(_ params: FlowStartPayload) async throws -> FlowRun`; `FlowStartPayload(taskId:projectId:master:flowId:inputValues:)`.
  - `RunMenuViewModel.callbacks(projectId:taskId:session:flows:tasks:ui:defaultRuntime:) -> RunMenuCallbacks`; `RunMenuViewModel.data(projectId:flows:standaloneActions:hasActiveFlowRun:defaultRuntime:online:showAgentOptions:) -> RunMenuData`; `RunMenuViewModel.allAgentTypes`/`displayName(_:)`; `RunMenuViewModel.ensureLoaded(projectId:projectPath:) async`.
  - `RunMenuCallbacks { onRunScript:(String)->Void, onRunAgentCommand:(AgentCommand)->Void, onStartFlow:(String)->Void, onRunAction:(ActionDefinition)->Void, onRunTab:(AgentType)->Void, onRunTabWithOptions:(AgentType)->Void }`.
  - `AgentOptionsFormModel(seed: AgentLaunchOptions?, settings: AppSettings?)`; `.options(for: AgentType) -> AgentLaunchOptions?`; `.reset(to: AppSettings?)`. `AgentOptionsFormView(model: @Bindable AgentOptionsFormModel, agent: AgentType, onReset: (() -> Void)?)`.
  - `ActiveWorkspace.workingDir(in: env) -> String?` and the pure overload `workingDir(task:project:masterActive:homedir:)`.
  - `UIViewModel` flags/methods: `commandPaletteOpen`+`setCommandPaletteOpen(_:)`/`toggleCommandPalette()`; `shortcutsDialogOpen`+`openShortcutsDialog()`/`setShortcutsDialogOpen(_:)`/`toggleShortcutsDialog()`; `settingsOpen`+`openSettings()`/`toggleSettings()`; `appearanceOpen`+`setAppearanceOpen(_:)`/`toggleAppearance()`; `setActiveProject(_:)`; `setFocusedPanel(_:)`; `activeProjectId`; `masterWorkspaceActive`. `PanelId { sidebar, fileexplorer, workspace, taskinfo }`.
  - `TaskCreationViewModel`: `newTaskRequest: NewTaskRequest?` (`NewTaskRequest { projectId: String?, parentId: String? }`), `newProjectRequested: Bool`, `requestNewTask(projectId:)`, `requestNewSubtask(parentId:projectId:)`, `requestNewProject()`, `clear()`.
  - **Re-grep anything not in this list before using it.**
- **`crypto.randomUUID()` → `UUID().uuidString`.** `Date.now()` → `ISO8601DateFormatter().string(from: Date())` (grep `ISO8601` first; not expected this phase).
- **Commit style:** do NOT add `Co-Authored-By`. One commit per task, conventional-commit subject (`feat(native): 5F …` / `refactor(native): 5F …` / `test(native): 5F …`). After each commit, run `taskflow-cli log commit "<subject>" --hash <hash>` and `taskflow-cli log file "<path>"` for each new/edited file (paths relative to repo root).
- **SDD reports are scratch:** if a `docs(sdd)` report file gets committed accidentally, drop it with `git reset` to keep source-only history.
- **Faithful-port rule:** match the TS source 1:1 in behavior; cite the TS file in a doc comment on each new type/view, as existing native files do.

## Scope Decisions (READ FIRST)

These boundaries are deliberate and mirror how prior sub-plans split scope. Product-owner confirmed at plan time (2026-06-30).

- **IN 5F:**
  - **Command palette** (`UIViewModel.commandPaletteOpen`): Cmd+Shift+P fuzzy overlay; two groups — **Actions** (`RunMenuData.standaloneActions`) and **package.json** (`RunMenuData.scripts`) — exactly as the TS palette consumes them (it ignores agent commands / flows). Active-task→its-project, else active-project, else "Select a task or project" empty state. Dispatch via the existing `RunMenuCallbacks.onRunAction`/`onRunScript`. Disabled agent-actions when offline.
  - **Keyboard shortcuts dialog** (`UIViewModel.shortcutsDialogOpen`): Cmd+/ static reference sheet, content modeled as a `[ShortcutGroup]` array (the TS dialog is hard-coded JSX; we transcribe its five groups faithfully — see Task 4 for the verbatim content).
  - **Global dialog host** (`GlobalDialogHost`): a single container view mounted in `AppShell` that owns all app-level singleton sheets and observes `UIViewModel` flags + `TaskCreationViewModel` requests + `RunMenuViewModel` requests.
  - **New Task / New Project dialogs** + the **TaskCreationDialogHost** consumer of the existing `TaskCreationViewModel` request seam (including the no-projects → open-project-first → then-open-task coordination, and deferring the agent-session / flow start until the worktree path materializes).
  - **Missing Location dialog** (per-project; Change Location via `NSOpenPanel` → `project:update`, Remove via `project:remove` with a native `.alert` confirm) + the `ProjectGroup` `locationValid == false` trigger.
  - **Fork Project dialog** (branch + auto-slugified folder → `project:fork`) + the `ProjectGroup`/`TaskHeader` context-menu triggers.
  - **Flow Input dialog** (text/filepath inputs → `flow:start` with `inputValues`), filling the `RunMenuViewModel.onStartFlow` `// 5F: flow-input dialog seam`.
  - **Agent-Options "Run with options" dialog** (embeds the 5D `AgentOptionsFormView`; on Run, launches a session **with** `agentOptions`), filling the `RunMenuViewModel.onRunTabWithOptions` `// 5F: AgentOptionsDialog seam`. Requires adding an optional `agentOptions:` parameter to `SessionViewModel.createSession` (Task 12).
  - **Settings/Appearance close chrome + open triggers**: add an in-content close (`AppIcon("X")`) button to the existing `SettingsDialog`/`AppearanceDialog` (5E noted they have none) and wire the menu-bar items that flip their flags.
  - **Menu-bar `.commands {}`** global shortcuts (Cmd+Shift+P, Cmd+/, Cmd+,, Cmd+N) with the palette-toggle "don't fire while another modal is open" guard.
- **DEFERRED — Update dialog (product-owner decision 2026-06-30):** the Electron Update dialog is pure IPC — `window.taskflow.onUpdateStatus(...)` + `quitAndInstallUpdate()` — with **no native macOS auto-updater backend** in this app yet (no Sparkle/`SUUpdater` integration; the sidecar exposes no update channel). Porting the dialog UI would have nothing to drive it. Deferred to the **native-feel-payoff follow-on** (auto-update is explicitly out of the master-plan cutover scope). Document as the headline 5F deferral in the results spec.
- **DEFERRED — imperative confirm/alert dialog host (`dialog-store.ts` / `DialogHost.tsx`):** the TS promise-based `confirm()/alert()` queue is **not** ported. The native app's established idiom for confirmations is the SwiftUI `.alert(...)` modifier (precedent: `ScheduleManagementDialog` delete-confirm, `FileDialogs`). 5F's two confirm needs (Missing-Location "Remove Project?" and Fork success notice) use native `.alert` directly. A centralized continuation-based host is non-idiomatic in SwiftUI and YAGNI for current call sites; revisit only if a future phase needs app-wide programmatic confirms.
- **DEFERRED — AgentOperationsHelpDialog:** `UIViewModel.agentOperationsHelpOpen` exists but stays unmounted (it is outside the stated 5F ownership list and its static content is not part of unit 5.8). Note it in the results spec as a remaining singleton-dialog parity gap for Phase 6.
- **Agent ordering:** `RunMenuViewModel.allAgentTypes` = `[.claude, .codex, .opencode, .gemini, .cursor, .pi]` and `displayName(_:)` are the single source for agent labels/order in the New Task "Start with" select and the Run-with-options dialog title.

## File Structure

New files (all under `native/Sources/Taskflow/` unless noted):

| File | Responsibility |
|---|---|
| `UI/CommandPalette/FuzzyMatch.swift` | Pure `nonisolated` fuzzy matcher. Port of `lib/fuzzy-match.ts`: greedy subsequence, `+1`/`+4` (consecutive)/`+3` (word-start) scoring, final `score*100 - text.count`. Returns `FuzzyResult { score: Int, indices: [Int] }?`. |
| `UI/CommandPalette/PaletteModels.swift` | UI-local `PaletteEntry`/`PaletteRow`/`PaletteGroup` types + `nonisolated static PaletteBuilder.buildGroups(...)` (filter/sort/highlight). Port of the `groups` memo in `CommandPaletteDialog.tsx`. |
| `UI/CommandPalette/CommandPaletteDialog.swift` | The Cmd+Shift+P overlay view: search field, grouped highlighted rows, keyboard nav (wrap), empty state, dispatch via `RunMenuCallbacks`. |
| `UI/Dialogs/KeyboardShortcutsDialog.swift` | Static `[ShortcutGroup]` reference sheet + `Kbd`/`ShortcutRowView`/`ShortcutGroupView` presentational helpers. Port of `KeyboardShortcutsDialog.tsx`. |
| `UI/Dialogs/GlobalDialogHost.swift` | Container view mounted in `AppShell`; attaches every app-level singleton sheet and observes `UIViewModel`/`TaskCreationViewModel`/`RunMenuViewModel`. |
| `UI/Dialogs/NewProjectDialog.swift` | "Add Project" form: directory field + `NSOpenPanel` browse + inline error. Port of `NewProjectDialog.tsx`. |
| `UI/Dialogs/NewTaskDialog.swift` | "New Task"/"New Subtask" form (project, description, title, worktree, init command, start-with agent/flow, embedded agent options). Port of `NewTaskDialog.tsx`. |
| `UI/Dialogs/MissingLocationDialog.swift` | "Project Location Not Found": Change Location (`NSOpenPanel`→`project:update`) + Remove (`.alert` confirm→`project:remove`). Port of `MissingLocationDialog.tsx`. |
| `UI/Dialogs/ForkProjectDialog.swift` | "Fork Project": branch + auto-slugified folder + computed target path + `project:fork`. Port of `ForkProjectDialog.tsx`. Includes `nonisolated static ForkProjectDialog.slugify(_:)`. |
| `UI/Dialogs/FlowInputDialog.swift` | "Flow Input: {name}": per-input text/filepath fields, all-filled gate, `flow:start` with `inputValues`. Port of `FlowInputDialog.tsx`. |
| `UI/Dialogs/AgentOptionsDialog.swift` | "Run {Agent} with options": embeds `AgentOptionsFormView`, Run launches a session with `agentOptions`. Port of `AgentOptionsDialog.tsx`/`AgentOptionsPanel.tsx`. |

Modified files:

| File | Change |
|---|---|
| `ViewModels/RunMenuViewModel.swift` | Add `FlowInputRequest`/`RunOptionsRequest` structs + `var flowInputRequest`/`var runOptionsRequest`; set them inside the two `// 5F:` seams in `callbacks(...)`; add `confirmFlowInput(...)` and `confirmRunOptions(...)` methods. |
| `ViewModels/SessionViewModel.swift` | Add optional `agentOptions: AgentLaunchOptions? = nil` parameter to `createSession(...)`, encoded into the `session:create` payload. |
| `UI/Shell/AppShell.swift` | Mount `GlobalDialogHost()` once (single insertion point for all 5F sheets). |
| `App/TaskflowApp.swift` | Add `.commands {}` to the `WindowGroup` (Cmd+Shift+P / Cmd+/ / Cmd+, / Cmd+N) with the palette guard. |
| `UI/Settings/SettingsDialog.swift`, `UI/Appearance/AppearanceDialog.swift` | Add the in-content `AppIcon("X")` close button (header chrome). |
| `UI/Sidebar/ProjectGroup.swift` | Add Missing-Location trigger (`locationValid == false`) + Fork context-menu item. |
| `UI/Workspace/TaskHeader.swift` (if a project context exists there) | Add Fork context-menu item (mirror `ProjectGroup`). Grep first; skip if no such menu exists yet. |

---

### Task 1: FuzzyMatch (pure helper, TDD)

**Files:**
- Create: `native/Sources/Taskflow/UI/CommandPalette/FuzzyMatch.swift`
- Test: `native/Tests/TaskflowTests/FuzzyMatchTests.swift`

**Interfaces:**
- Produces: `struct FuzzyResult: Equatable { let score: Int; let indices: [Int] }`; `enum FuzzyMatch { nonisolated static func match(_ query: String, _ text: String) -> FuzzyResult? }`.

Port of `packages/ui/src/lib/fuzzy-match.ts`. Case-insensitive greedy subsequence: walk `text`'s lowercased characters; for each query char (lowercased, in order) find the next occurrence. If any query char can't be found in order → `nil`. Scoring per matched index: base `+1`; `+4` if this matched index is exactly `previousMatchedIndex + 1` (consecutive run); `+3` if the matched index is `0` or the preceding character is not in `[a-z0-9]` (word start). Final score = `score * 100 - text.count`. `indices` are positions in the **original** string (not lowercased).

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import Taskflow

final class FuzzyMatchTests: XCTestCase {
    func testEmptyQueryMatchesWithZeroScoreOffset() {
        // Empty query is a subsequence of everything: no matched chars, score 0*100 - length.
        let r = FuzzyMatch.match("", "build")
        XCTAssertEqual(r, FuzzyResult(score: -5, indices: []))
    }

    func testNonSubsequenceReturnsNil() {
        XCTAssertNil(FuzzyMatch.match("zzz", "build"))
        XCTAssertNil(FuzzyMatch.match("bx", "build"))   // 'x' not present after 'b'
    }

    func testCaseInsensitiveSubsequence() {
        XCTAssertNotNil(FuzzyMatch.match("BLD", "build"))
    }

    func testConsecutiveBonusBeatsScattered() {
        // "bu" consecutive at word start in "build" should outscore "bd" scattered in "bound".
        let consecutive = FuzzyMatch.match("bu", "build")!
        let scattered = FuzzyMatch.match("bd", "build")!
        XCTAssertGreaterThan(consecutive.score, scattered.score)
    }

    func testWordStartBonus() {
        // 'r' at the start of the word "run" (after a non-alnum boundary) earns the +3 word-start bonus.
        let atStart = FuzzyMatch.match("r", "run")!
        let midWord = FuzzyMatch.match("r", "abr")!
        XCTAssertGreaterThan(atStart.score, midWord.score)
    }

    func testShorterCandidateWinsTie() {
        // Same matched chars/bonuses, shorter text wins via the - length term.
        let shortText = FuzzyMatch.match("ab", "ab")!
        let longText = FuzzyMatch.match("ab", "abcdef")!
        XCTAssertGreaterThan(shortText.score, longText.score)
    }

    func testIndicesPointIntoOriginalString() {
        let r = FuzzyMatch.match("bd", "Build")!
        XCTAssertEqual(r.indices, [0, 4])   // 'B' at 0, 'd' at 4
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd native && swift test --filter FuzzyMatchTests`
Expected: FAIL — `cannot find 'FuzzyMatch' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
import Foundation

/// Result of a fuzzy match: the relevance `score` (higher = better) and the matched character
/// `indices` into the ORIGINAL (non-lowercased) candidate string, used to bold matched chars.
/// Ports the return type of `packages/ui/src/lib/fuzzy-match.ts`.
struct FuzzyResult: Equatable {
    let score: Int
    let indices: [Int]
}

/// Case-insensitive greedy subsequence fuzzy matcher.
/// 1:1 port of `fuzzyMatch` in `packages/ui/src/lib/fuzzy-match.ts`.
enum FuzzyMatch {
    /// Returns `nil` when `query` is not a subsequence of `text`. Empty `query` always matches
    /// (score `-text.count`, no indices). Scoring: +1 base per matched char, +4 when the match is
    /// consecutive with the previous match, +3 when the match is at a word start; final score is
    /// `rawScore * 100 - text.count` so shorter candidates win ties.
    nonisolated static func match(_ query: String, _ text: String) -> FuzzyResult? {
        let textChars = Array(text)
        let lowerText = Array(text.lowercased())
        let lowerQuery = Array(query.lowercased())

        var indices: [Int] = []
        var rawScore = 0
        var searchFrom = 0

        for qChar in lowerQuery {
            var found = -1
            var i = searchFrom
            while i < lowerText.count {
                if lowerText[i] == qChar { found = i; break }
                i += 1
            }
            if found == -1 { return nil }

            var charScore = 1
            if let last = indices.last, found == last + 1 { charScore += 4 }      // consecutive run
            if found == 0 || !isWordChar(lowerText[found - 1]) { charScore += 3 }  // word start
            rawScore += charScore
            indices.append(found)
            searchFrom = found + 1
        }

        _ = textChars   // indices index into the original string; lengths match lowerText.
        return FuzzyResult(score: rawScore * 100 - text.count, indices: indices)
    }

    /// `[a-z0-9]` test on an already-lowercased character (matches the TS `WORD_CHAR` regex).
    private nonisolated static func isWordChar(_ c: Character) -> Bool {
        c.isLetter || c.isNumber
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter FuzzyMatchTests`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/CommandPalette/FuzzyMatch.swift native/Tests/TaskflowTests/FuzzyMatchTests.swift
git commit -m "test(native): 5F FuzzyMatch (port fuzzy-match.ts, TDD)"
```
Then: `taskflow-cli log commit "5F FuzzyMatch" --hash <hash>` and `taskflow-cli log file ...` for both files.

---

### Task 2: Palette models + builder (pure, TDD)

**Files:**
- Create: `native/Sources/Taskflow/UI/CommandPalette/PaletteModels.swift`
- Test: `native/Tests/TaskflowTests/PaletteBuilderTests.swift`

**Interfaces:**
- Consumes: `FuzzyMatch.match`, `FuzzyResult` (Task 1); generated `ActionDefinition`.
- Produces:
  - `enum PaletteEntry: Equatable { case action(ActionDefinition); case script(String) }`
  - `struct PaletteRow: Identifiable, Equatable { let id: String; let entry: PaletteEntry; let label: String; let detail: String; let disabled: Bool; let indices: [Int] }`
  - `struct PaletteGroup: Identifiable, Equatable { let id: String; let title: String; let rows: [PaletteRow] }`
  - `enum PaletteBuilder { nonisolated static func buildGroups(actions: [ActionDefinition], scripts: [String: String], online: Bool, defaultRuntime: String, query: String) -> [PaletteGroup] }`

Port of the `groups` memo in `CommandPaletteDialog.tsx` (lines 83-118). Two groups: **"Actions"** (one row per `actions`, `id = "action:\(action.id)"`, `label = action.name`, `detail = online ? action.sessionType.rawValue : "offline"`, `disabled = !online`, icon Zap handled in the view) and **"package.json"** (one row per script key sorted ascending, `id = "script:\(name)"`, `label = name`, `detail = defaultRuntime`, `disabled = false`). Empty query → all rows pass with `indices: []` in natural order (actions in input order, scripts sorted). Non-empty query → match each row's `label`, drop non-matches, sort survivors by `FuzzyResult.score` descending (stable), set `indices`. Drop empty groups.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import Taskflow

final class PaletteBuilderTests: XCTestCase {
    private func action(_ id: String, _ name: String, _ type: SessionType = .claude) -> ActionDefinition {
        ActionDefinition(id: id, projectId: nil, name: name, prompt: "", sessionType: type,
                         agentOptions: nil, standalone: true, createdAt: "", updatedAt: "")
    }

    func testEmptyQueryShowsAllInNaturalOrder() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review"), action("a2", "Plan")],
            scripts: ["test": "vitest", "build": "tsc"],
            online: true, defaultRuntime: "bun", query: "")
        XCTAssertEqual(g.map(\.title), ["Actions", "package.json"])
        XCTAssertEqual(g[0].rows.map(\.label), ["Review", "Plan"])      // action input order
        XCTAssertEqual(g[1].rows.map(\.label), ["build", "test"])        // scripts sorted asc
        XCTAssertEqual(g[1].rows[0].detail, "bun")
    }

    func testOfflineDisablesActionsAndSetsDetail() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review")], scripts: [:],
            online: false, defaultRuntime: "bun", query: "")
        XCTAssertTrue(g[0].rows[0].disabled)
        XCTAssertEqual(g[0].rows[0].detail, "offline")
    }

    func testQueryFiltersAndSortsByScore() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review"), action("a2", "Refactor"), action("a3", "Plan")],
            scripts: [:], online: true, defaultRuntime: "bun", query: "re")
        let labels = g[0].rows.map(\.label)
        XCTAssertEqual(Set(labels), ["Review", "Refactor"])   // "Plan" dropped
        XCTAssertFalse(g[0].rows[0].indices.isEmpty)          // highlight indices set
    }

    func testEmptyGroupsAreDropped() {
        let g = PaletteBuilder.buildGroups(
            actions: [], scripts: ["build": "tsc"],
            online: true, defaultRuntime: "bun", query: "build")
        XCTAssertEqual(g.map(\.title), ["package.json"])      // no Actions group
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd native && swift test --filter PaletteBuilderTests`
Expected: FAIL — `cannot find 'PaletteBuilder' in scope` (verify the `ActionDefinition` memberwise init field names against `Generated/Models/FlowTypes.swift` first; adjust the test helper if codegen names differ).

- [ ] **Step 3: Implement**

```swift
import Foundation

/// A runnable palette entry. Ports the `PaletteEntry` union in `CommandPaletteDialog.tsx`.
enum PaletteEntry: Equatable {
    case action(ActionDefinition)
    case script(String)
}

/// One rendered palette row. `indices` are matched-char positions for bold highlighting.
struct PaletteRow: Identifiable, Equatable {
    let id: String
    let entry: PaletteEntry
    let label: String
    let detail: String
    let disabled: Bool
    let indices: [Int]
}

/// A titled group of rows ("Actions" | "package.json").
struct PaletteGroup: Identifiable, Equatable {
    let id: String
    let title: String
    let rows: [PaletteRow]
}

/// Builds the palette's two groups with fuzzy filter + score sort.
/// Ports the `groups` memo in `packages/ui/src/components/CommandPaletteDialog.tsx`.
enum PaletteBuilder {
    nonisolated static func buildGroups(
        actions: [ActionDefinition],
        scripts: [String: String],
        online: Bool,
        defaultRuntime: String,
        query: String
    ) -> [PaletteGroup] {
        let actionRows: [PaletteRow] = actions.map { a in
            PaletteRow(
                id: "action:\(a.id)", entry: .action(a), label: a.name,
                detail: online ? a.sessionType.rawValue : "offline",
                disabled: !online, indices: [])
        }
        let scriptRows: [PaletteRow] = scripts.keys.sorted().map { name in
            PaletteRow(
                id: "script:\(name)", entry: .script(name), label: name,
                detail: defaultRuntime, disabled: false, indices: [])
        }

        func filtered(_ rows: [PaletteRow]) -> [PaletteRow] {
            guard !query.isEmpty else { return rows }
            let scored: [(row: PaletteRow, score: Int)] = rows.compactMap { row in
                guard let r = FuzzyMatch.match(query, row.label) else { return nil }
                let hl = PaletteRow(id: row.id, entry: row.entry, label: row.label,
                                    detail: row.detail, disabled: row.disabled, indices: r.indices)
                return (hl, r.score)
            }
            return scored
                .enumerated()
                .sorted { a, b in a.element.score != b.element.score ? a.element.score > b.element.score : a.offset < b.offset }
                .map { $0.element.row }
        }

        var groups: [PaletteGroup] = []
        let a = filtered(actionRows)
        if !a.isEmpty { groups.append(PaletteGroup(id: "actions", title: "Actions", rows: a)) }
        let s = filtered(scriptRows)
        if !s.isEmpty { groups.append(PaletteGroup(id: "scripts", title: "package.json", rows: s)) }
        return groups
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd native && swift test --filter PaletteBuilderTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/CommandPalette/PaletteModels.swift native/Tests/TaskflowTests/PaletteBuilderTests.swift
git commit -m "test(native): 5F palette models + PaletteBuilder (TDD)"
```
Then log commit + files.

---

### Task 3: CommandPaletteDialog view + GlobalDialogHost + AppShell mount

**Files:**
- Create: `native/Sources/Taskflow/UI/CommandPalette/CommandPaletteDialog.swift`
- Create: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `PaletteBuilder.buildGroups` (Task 2); `RunMenuViewModel` (`ensureLoaded`, `data`, `callbacks`); `ActiveWorkspace.workingDir(in:)`; `UIViewModel.commandPaletteOpen`/`setCommandPaletteOpen`.
- Produces: `struct GlobalDialogHost: View` (the single mount point later tasks extend); `struct CommandPaletteDialog: View`.

`GlobalDialogHost` is an `EmptyView`-bodied host that carries `.sheet` modifiers. Mount it once in `AppShell` next to the existing `.sheet`s. This task adds only the command-palette sheet; later tasks append more sheets to this same file.

The palette resolves its context the way `ProjectGroup`/`TaskCard` build run-menu data: active task → its project; else active project; else empty state. On appear, call `env.runMenu?.ensureLoaded(projectId:projectPath:)`. Build `RunMenuData` via `env.runMenu?.data(...)` (only `standaloneActions` + `scripts` are consumed, but pass real `flows`/`online`/`defaultRuntime`). Build callbacks via `env.runMenu?.callbacks(...)`. Render groups from `PaletteBuilder.buildGroups`. Keyboard: a focused `TextField` with `.onKeyPress` for ArrowUp/ArrowDown (wrap) and Return (run active row); Esc dismisses via the sheet binding. Mouse hover sets selection; click runs. Footer hint "↑↓ navigate · ↵ run · esc close".

- [ ] **Step 1: Create `GlobalDialogHost` with the palette sheet**

```swift
import SwiftUI

/// Single mount point for all app-level singleton dialogs (command palette, shortcuts, task/project
/// creation, missing-location, fork, flow-input, run-with-options). Mounted once in `AppShell`.
/// Mirrors the centralized dialog mounting in `packages/ui/src/App.tsx`.
struct GlobalDialogHost: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        // Zero-size anchor that only carries sheet modifiers.
        Color.clear.frame(width: 0, height: 0)
            .sheet(isPresented: Binding(
                get: { env.ui.commandPaletteOpen },
                set: { if !$0 { env.ui.setCommandPaletteOpen(false) } }
            )) { CommandPaletteDialog() }
    }
}
```

- [ ] **Step 2: Implement `CommandPaletteDialog`**

Port `packages/ui/src/components/CommandPaletteDialog.tsx`. Resolve the active owner; compute groups; render. Key structure (fill the body following the conventions; this is the shape — match it):

```swift
import SwiftUI

/// Cmd+Shift+P fuzzy command palette. Two groups: standalone Actions + package.json scripts.
/// Ports `packages/ui/src/components/CommandPaletteDialog.tsx` (consumes only `standaloneActions`
/// and `scripts` from the run-menu data, like the TS palette).
struct CommandPaletteDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var query: String = ""
    @State private var selectedIndex: Int = 0
    @FocusState private var searchFocused: Bool

    // Resolved active owner (task → its project, else active project, else nil).
    private var owner: (taskId: String?, projectId: String?, projectPath: String?)? {
        let activeTaskId = env.tasks?.activeTaskId
        if let tid = activeTaskId, let task = env.tasks?.tasks.first(where: { $0.id == tid }),
           let project = env.projects?.projects.first(where: { $0.id == task.projectId }) {
            let path = ActiveWorkspace.workingDir(task: task, project: project,
                                                  masterActive: false, homedir: env.homedir)
            return (tid, project.id, path)
        }
        if let pid = env.ui.activeProjectId,
           let project = env.projects?.projects.first(where: { $0.id == pid }) {
            return (nil, project.id, project.path)
        }
        return nil
    }

    private var groups: [PaletteGroup] {
        guard let owner, let runMenu = env.runMenu, let pid = owner.projectId else { return [] }
        let data = runMenu.data(
            projectId: pid,
            flows: env.flows?.flows ?? [],
            standaloneActions: env.flows?.standaloneActions(forProject: pid) ?? [],
            hasActiveFlowRun: false,
            defaultRuntime: env.settings?.settings?.general.defaultRuntime ?? "bun",
            online: env.connectionStatus == .connected,
            showAgentOptions: false)
        return PaletteBuilder.buildGroups(
            actions: data.standaloneActions, scripts: data.scripts,
            online: data.online, defaultRuntime: data.defaultRuntime, query: query)
    }

    private var flatRows: [PaletteRow] { groups.flatMap(\.rows) }

    var body: some View {
        VStack(spacing: 0) {
            // search field (borderless), grouped results, footer hint — see TS layout.
            // ... build per conventions, using theme tokens.
        }
        .frame(width: 560, height: 420)
        .background(theme.background)
        .onAppear {
            query = ""; selectedIndex = 0; searchFocused = true
            if let owner, let pid = owner.projectId, let path = owner.projectPath {
                Task { await env.runMenu?.ensureLoaded(projectId: pid, projectPath: path) }
            }
        }
    }

    private func run(_ row: PaletteRow) {
        guard !row.disabled, let owner, let pid = owner.projectId, let runMenu = env.runMenu else { return }
        let cb = runMenu.callbacks(
            projectId: pid, taskId: owner.taskId,
            session: env.session, flows: env.flows, tasks: env.tasks, ui: env.ui,
            defaultRuntime: env.settings?.settings?.general.defaultRuntime ?? "bun")
        switch row.entry {
        case .action(let a): cb.onRunAction(a)
        case .script(let name): cb.onRunScript(name)
        }
        env.ui.setCommandPaletteOpen(false)
    }
}
```

> **Implementer notes:** grep these before wiring — (a) `env.flows?.standaloneActions(forProject:)` may instead be a stored `standaloneActions` array filtered by `filterByProject`; check `FlowViewModel` for the actual accessor and adjust. (b) The online flag: grep `AppEnvironment` for the connection-status accessor (`connectionStatus`/`status`/`isConnected`) and use the real one. (c) Keyboard nav: use `.onKeyPress(.upArrow)`/`.onKeyPress(.downArrow)`/`.onKeyPress(.return)` on the focused field, wrapping `selectedIndex` modulo `flatRows.count`; clamp `activeIndex = min(selectedIndex, flatRows.count - 1)`. (d) The empty state ("Select a task or project to run actions") renders when `owner == nil`. (e) Bold matched chars using `PaletteRow.indices` (build an `AttributedString` or an `HStack` of per-character `Text`).

- [ ] **Step 3: Mount `GlobalDialogHost` in `AppShell`**

In `native/Sources/Taskflow/UI/Shell/AppShell.swift`, attach the host to the root view (next to the existing `.sheet` modifiers added in 5E). Example — add as an overlay/background so it does not affect layout:

```swift
.background(GlobalDialogHost())
```

- [ ] **Step 4: Build**

Run: `cd native && swift build`
Expected: `Build complete!` (only the pre-existing tree-sitter linker warnings).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/CommandPalette/CommandPaletteDialog.swift native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): 5F CommandPaletteDialog + GlobalDialogHost mount"
```
Then log commit + files.

---

### Task 4: KeyboardShortcutsDialog (static reference sheet)

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/KeyboardShortcutsDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift`

**Interfaces:**
- Produces: `struct KeyboardShortcutsDialog: View`. UI-local content types `private struct ShortcutRow { let keys: [String]; let description: String }`, `private struct ShortcutGroup { let title: String; let rows: [ShortcutRow] }`.

Port `packages/ui/src/components/KeyboardShortcutsDialog.tsx`. Model the five hard-coded JSX groups as a `[ShortcutGroup]` literal. Render with header chrome (title "Keyboard Shortcuts" + `AppIcon("X")` close → `env.ui.setShortcutsDialogOpen(false)`), grouped rows (description left, key caps right), `Kbd`-style key caps (muted rounded background). Mount as a `.sheet` on `shortcutsDialogOpen` in `GlobalDialogHost`.

The verbatim content (symbols: ⌘ ⇧ ⌥ ↵; arrows literal):

```swift
private let shortcutGroups: [ShortcutGroup] = [
    ShortcutGroup(title: "Panel Navigation", rows: [
        ShortcutRow(keys: ["⌘", "⇧", "←", "→"], description: "Cycle focus between panels"),
        ShortcutRow(keys: ["⌘", "⇧", "(hold)"], description: "Hold to reveal focused panel"),
    ]),
    ShortcutGroup(title: "Workspace (when focused)", rows: [
        ShortcutRow(keys: ["⌘", "1–9"], description: "Switch to tab by number"),
    ]),
    ShortcutGroup(title: "Sidebar (when focused)", rows: [
        ShortcutRow(keys: ["⌘", "1–9"], description: "Jump to project or task by number"),
        ShortcutRow(keys: ["⌘", "0"], description: "Switch to master workspace"),
        ShortcutRow(keys: ["⌘", "↑", "↓"], description: "Navigate through items"),
        ShortcutRow(keys: ["⌘", "←"], description: "Collapse project or go to parent"),
        ShortcutRow(keys: ["⌘", "→"], description: "Expand project"),
    ]),
    ShortcutGroup(title: "File Explorer (when focused)", rows: [
        ShortcutRow(keys: ["⌘", "↑", "↓"], description: "Navigate through files and folders"),
        ShortcutRow(keys: ["⌘", "→"], description: "Expand folder or enter first child"),
        ShortcutRow(keys: ["⌘", "←"], description: "Collapse folder or go to parent"),
        ShortcutRow(keys: ["⌘", "↵"], description: "Open file or toggle folder"),
        ShortcutRow(keys: ["⌘", "Home"], description: "Jump to first item"),
        ShortcutRow(keys: ["⌘", "End"], description: "Jump to last item"),
    ]),
    ShortcutGroup(title: "General", rows: [
        ShortcutRow(keys: ["⌘", "⇧", "P"], description: "Open command palette"),
        ShortcutRow(keys: ["⌘", ","], description: "Open settings"),
        ShortcutRow(keys: ["⌘", "T"], description: "New terminal in current task or project"),
        ShortcutRow(keys: ["⌘", "J"], description: "New agent in current task or project"),
        ShortcutRow(keys: ["⌘", "N"], description: "New task"),
        ShortcutRow(keys: ["⌘", "W"], description: "Close active tab"),
        ShortcutRow(keys: ["⌘", "E"], description: "Toggle file explorer"),
        ShortcutRow(keys: ["⌘", "I"], description: "Toggle task info"),
        ShortcutRow(keys: ["⌥", "Z"], description: "Toggle editor word wrap"),
        ShortcutRow(keys: ["⌘", "⇧", "S"], description: "Toggle split workspace"),
        ShortcutRow(keys: ["⌘", "⇧", "C"], description: "Toggle compact sidebar"),
        ShortcutRow(keys: ["⌘", "(hold)"], description: "Hold to show number badges"),
        ShortcutRow(keys: ["⌘", "/"], description: "Toggle this dialog"),
    ]),
]
```

- [ ] **Step 1: Implement the dialog** (content above + chrome following the `FlowManagementDialog` header pattern; `.frame(width: 520, height: 560)`, `.background(theme.background)`, scrollable group list).
- [ ] **Step 2: Mount in `GlobalDialogHost`** — add:

```swift
.sheet(isPresented: Binding(
    get: { env.ui.shortcutsDialogOpen },
    set: { if !$0 { env.ui.setShortcutsDialogOpen(false) } }
)) { KeyboardShortcutsDialog() }
```

- [ ] **Step 3: Build** — `cd native && swift build` → `Build complete!`.
- [ ] **Step 4: Commit** `feat(native): 5F KeyboardShortcutsDialog` + log.

---

### Task 5: NewProjectDialog

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/NewProjectDialog.swift`

**Interfaces:**
- Produces: `struct NewProjectDialog: View { let isPresented: Binding<Bool>; let error: String?; let onSubmit: (String) -> Void }`.

Port `packages/ui/src/components/sidebar/NewProjectDialog.tsx`. Title "Add Project". A directory `AppTextField` (placeholder `/path/to/project`) **plus** a "Browse…" `AppButton` that opens `NSOpenPanel` (`canChooseDirectories = true`, `canChooseFiles = false`) and writes the chosen path into the field (precedent: `GeneralSection.swift`'s data-folder picker). Inline `error` text in `theme.destructive` when non-nil. `canSubmit = !path.trimmed.isEmpty`. Submit on the confirm button and on Cmd+Return (`.keyboardShortcut(.return, modifiers: .command)`). This view is **presentation-only** — the host (Task 7) owns the open flag and `onSubmit`.

- [ ] **Step 1:** Implement the form view (props above; local `@State private var path`).
- [ ] **Step 2:** Build — `swift build` → `Build complete!`. (Not yet mounted; the host wires it in Task 7.)
- [ ] **Step 3:** Commit `feat(native): 5F NewProjectDialog` + log.

---

### Task 6: NewTaskDialog

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/NewTaskDialog.swift`

**Interfaces:**
- Consumes: `AgentOptionsFormModel`/`AgentOptionsFormView` (5D); `RunMenuViewModel.allAgentTypes`/`displayName`; generated `Project`, `FlowDefinition`, `AgentLaunchOptions`, `AgentType`.
- Produces: `struct NewTaskDialog: View` with:

```swift
struct NewTaskSubmit: Equatable {
    let projectId: String
    let title: String?
    let description: String
    let worktree: Bool
    let parentId: String?
    let startWith: AgentType?
    let agentOptions: AgentLaunchOptions?
    let startWithFlowId: String?
    let initCommand: String?
}
// init(isPresented: Binding<Bool>, projects: [Project], flows: [FlowDefinition],
//      defaultProjectId: String?, parentId: String?, onSubmit: (NewTaskSubmit) -> Void)
```

Port `packages/ui/src/components/sidebar/NewTaskDialog.tsx`. Fields:
- **Project** `AppSelect<String>` of `projects` (hidden when `parentId != nil` — subtask mode).
- **Description** multi-line text (use the existing multi-line text input primitive; grep for a `TextEditor`-based primitive, else a bordered `TextEditor`). Autofocus.
- **Title** `AppTextField`, optional (placeholder "auto-generated from description").
- **Use git worktree** `AppToggle` (hidden in subtask mode; subtasks force `worktree = false`).
- **Init command** `AppTextField`, shown only when `worktree` is on; placeholder = the selected project's `defaultInitCommand ?? "bun install"`.
- **Start immediately with** `AppSelect<String>`: `"none"` + `RunMenuViewModel.allAgentTypes` (via `displayName`) + `"flow"` when `!flows.isEmpty`. (5F treats all agents available — no per-agent install gating, matching the 5B availability seam.)
- **Flow** `AppSelect<String>` of `flows`, shown only when `startWith == "flow"`.
- **Agent Options**: when a concrete agent is selected, show an `AgentOptionsFormView(model:agent:onReset:)` inside a disclosure; seed an `AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)`; on submit read `model.options(for: agent)`.

Validation (port lines 139-142): `hasFlowSelection = startWith != "flow" || !startWithFlowId.isEmpty`; `canSubmit = (parentId != nil || !projectId.isEmpty) && !description.trimmed.isEmpty && hasFlowSelection`. Submit on confirm + Cmd+Return. `initCommand` is sent only when `worktree` is true. Presentation-only; the host owns `onSubmit`.

- [ ] **Step 1:** Implement the form (the agent-options disclosure is the trickiest part — re-grep `AgentOptionsFormView`/`AgentOptionsFormModel` signatures).
- [ ] **Step 2:** Build → `Build complete!`.
- [ ] **Step 3:** Commit `feat(native): 5F NewTaskDialog` + log.

---

### Task 7: TaskCreationDialogHost (consumer of the request seam + deferred start)

**Files:**
- Modify: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift`

**Interfaces:**
- Consumes: `NewTaskDialog`/`NewProjectDialog` (Tasks 5/6); `TaskCreationViewModel` (`newTaskRequest`/`newProjectRequested`/`clear()`); `TaskViewModel.createTask`; `ProjectViewModel.addProject`; `SessionViewModel.createSession`; `FlowViewModel.startFlow`.

Port `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`. Add to `GlobalDialogHost`:
- A New Project sheet bound to `env.taskCreation.newProjectRequested`. On submit → `env.projects?.addProject(path:)`; on success, if there was a queued task intent, open the task dialog (the "no projects → create project first → then task" coordination). On error, surface the message back into the dialog via local `@State`.
- A New Task sheet bound to `env.taskCreation.newTaskRequest != nil`. Compute `defaultProjectId` = request.projectId ?? active task's project ?? `env.ui.activeProjectId` ?? `projects.first?.id`. On submit → `env.tasks?.createTask(...)`, set active project/task, then start the agent session or flow.
  - **Deferred start until worktree ready** (port the `pendingSessionRef`/`pendingFlowRef` + `useEffect` at lines 53-84): when `worktree == true` and not a subtask, the worktree path is not ready at create time. Store the pending start intent (`@State private var pendingStart: PendingStart?` where `PendingStart` carries the new task id + startWith/agentOptions or flowId + inputValues), and fire it from an `.onChange(of: env.tasks?.tasks)` (or a `.task(id:)`) that watches for the task's `worktree.path` to become non-empty, then calls `createSession`/`startFlow` and clears `pendingStart`. When no worktree (or subtask), start immediately.
- Always call `env.taskCreation.clear()` when either sheet dismisses.

> **Implementer notes:** `createSession` now accepts `agentOptions:` after Task 12 — if implementing Task 7 before Task 12, pass agent options only after Task 12 lands (the SDD order runs 7 before 12; in that case wire the start without `agentOptions` and add the argument in Task 12's step that updates this call site). To avoid the back-edit, **Task 12 is sequenced before this task is considered complete** — see ordering note at the end. Simplest: implement the New Project + New Task mounting and the create/start wiring here, and add the `agentOptions:` argument to the `createSession` call in this file as part of Task 12.

- [ ] **Step 1:** Add the two sheets + submit handlers + deferred-start logic to `GlobalDialogHost`.
- [ ] **Step 2:** Build → `Build complete!`.
- [ ] **Step 3:** Manual reasoning check: trace no-projects path (requestNewTask with zero projects should open project dialog first). Adjust `TaskCreationViewModel` usage if the request must carry an "open task after" intent — if the existing seam can't express it, add a `@State private var openTaskAfterProject` in the host (do NOT widen the VM unless necessary).
- [ ] **Step 4:** Commit `feat(native): 5F TaskCreationDialogHost (new task/project + deferred start)` + log.

---

### Task 8: MissingLocationDialog + ProjectGroup trigger

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/MissingLocationDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift`

**Interfaces:**
- Consumes: `ProjectViewModel.updateProject(id:path:)`, `ProjectViewModel.removeProject(id:)`; generated `Project`.
- Produces: `struct MissingLocationDialog: View { let isPresented: Binding<Bool>; let project: Project }`.

Port `packages/ui/src/components/sidebar/MissingLocationDialog.tsx`. Title "Project Location Not Found", body naming `project.name` + a monospace `project.path`. Footer: **Change Location** (`NSOpenPanel` directory → `env.projects?.updateProject(id: project.id, path: chosen)` then dismiss) and **Remove Project** (`kind: .destructive`) which presents a native `.alert("Remove Project?", isPresented:)` confirm → on confirm `env.projects?.removeProject(id: project.id)` then dismiss. In `ProjectGroup`, add `@State private var missingDialogOpen = false`; when `project.locationValid == false`, clicking the project header opens this dialog instead of selecting (port `ProjectGroup.tsx` lines 182-190); mount the dialog as a `.sheet` local to the group.

- [ ] **Step 1:** Implement the dialog (Change/Remove + `.alert` confirm).
- [ ] **Step 2:** Wire the `ProjectGroup` trigger + local `.sheet`.
- [ ] **Step 3:** Build → `Build complete!`.
- [ ] **Step 4:** Commit `feat(native): 5F MissingLocationDialog + ProjectGroup trigger` + log.

---

### Task 9: ForkProjectDialog + slugify (TDD) + triggers

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/ForkProjectDialog.swift`
- Test: `native/Tests/TaskflowTests/ForkSlugifyTests.swift`
- Modify: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift` (and `UI/Workspace/TaskHeader.swift` if it has a project context menu — grep first).

**Interfaces:**
- Consumes: `ProjectViewModel.forkProject(projectId:branch:folderName:) -> ProjectForkResponse`; generated `Project`, `ProjectForkResponse`.
- Produces: `struct ForkProjectDialog: View { let isPresented: Binding<Bool>; let project: Project }`; `nonisolated static func ForkProjectDialog.slugify(_:) -> String`; `nonisolated static func ForkProjectDialog.parentDir(_:) -> String`.

Port `packages/ui/src/components/workspace/ForkProjectDialog.tsx`. `slugify`: lowercase, replace `/` and whitespace with `-`, strip characters not in `[a-z0-9-.]`. The folder field auto-derives from the branch via `slugify` until the user types a custom value (track with `@State private var customFolder: Bool`). Show computed target path = `parentDir(project.path) + "/" + folder`. `canSubmit = !branch.trimmed.isEmpty && !folder.trimmed.isEmpty && !loading`. On submit → `try await env.projects?.forkProject(projectId: project.id, branch: branch.trimmed, folderName: folder.trimmed)`; on success dismiss + native `.alert` success notice ("Forked to <targetPath>"); on error inline `@State private var error`.

- [ ] **Step 1: Failing slugify tests**

```swift
import XCTest
@testable import Taskflow

final class ForkSlugifyTests: XCTestCase {
    func testLowercasesAndDashesSlashesAndSpaces() {
        XCTAssertEqual(ForkProjectDialog.slugify("Feature/My Branch"), "feature-my-branch")
    }
    func testStripsDisallowedChars() {
        XCTAssertEqual(ForkProjectDialog.slugify("fix#123!"), "fix123")
    }
    func testKeepsDotsAndDigits() {
        XCTAssertEqual(ForkProjectDialog.slugify("v1.2.3"), "v1.2.3")
    }
    func testParentDir() {
        XCTAssertEqual(ForkProjectDialog.parentDir("/Users/me/projects/app"), "/Users/me/projects")
    }
}
```

- [ ] **Step 2:** Run `cd native && swift test --filter ForkSlugifyTests` → FAIL.
- [ ] **Step 3:** Implement `slugify`/`parentDir` (`nonisolated static`) + the dialog view.
- [ ] **Step 4:** Run the filter → PASS (4 tests).
- [ ] **Step 5:** Wire the Fork context-menu item in `ProjectGroup` (and `TaskHeader` if applicable) with a local `@State private var forkOpen` + `.sheet`.
- [ ] **Step 6:** Build → `Build complete!`.
- [ ] **Step 7:** Commit `feat(native): 5F ForkProjectDialog + slugify (TDD) + triggers` + log.

---

### Task 10: RunMenuViewModel flow-input + run-options request state (TDD)

**Files:**
- Modify: `native/Sources/Taskflow/ViewModels/RunMenuViewModel.swift`
- Test: `native/Tests/TaskflowTests/RunMenuRequestTests.swift`

**Interfaces:**
- Produces (on `RunMenuViewModel`):
  - `struct FlowInputRequest: Equatable { let flowId: String; let flowName: String; let inputs: [FlowInputDefinition]; let taskId: String?; let projectId: String? }`
  - `struct RunOptionsRequest: Equatable { let agent: AgentType; let title: String; let taskId: String?; let projectId: String? }`
  - `var flowInputRequest: FlowInputRequest?` and `var runOptionsRequest: RunOptionsRequest?` (observable).
  - Fill the two seams inside `callbacks(...)`: `onStartFlow` sets `flowInputRequest` when the flow has non-empty `inputs` (replacing the early `return`); `onRunTabWithOptions` sets `runOptionsRequest` (replacing the no-op).
  - `func confirmFlowInput(_ values: [String: String], flows: FlowViewModel?, tasks: TaskViewModel?, ui: UIViewModel)` — navigates + `startFlow(FlowStartPayload(... inputValues: values))`, clears `flowInputRequest`.
  - `func confirmRunOptions(_ options: AgentLaunchOptions, session: SessionViewModel?, tasks: TaskViewModel?, ui: UIViewModel)` — mirrors `onRunTab` (guard taskId, navigate, `createSession(... agentOptions: options)`, send task description), clears `runOptionsRequest`. **(Uses the `agentOptions:` param added in Task 12 — sequence Task 12 before completing this.)**

Because the closures need to mutate `self`, capture the VM in `callbacks(...)` (`@MainActor` class; reference `self` directly or `[weak self]`).

- [ ] **Step 1: Failing test** — assert the seams set the request fields:

```swift
import XCTest
@testable import Taskflow

@MainActor
final class RunMenuRequestTests: XCTestCase {
    func testOnStartFlowWithInputsSetsRequest() async {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let flows = FlowViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        // Seed one flow with a required input. (Grep FlowViewModel for the right seeding hook;
        // if there is no setter, assert on confirmFlowInput / request struct equality instead.)
        let ui = UIViewModel()
        let cb = vm.callbacks(projectId: "p1", taskId: "t1", session: nil, flows: flows,
                              tasks: nil, ui: ui, defaultRuntime: "bun")
        cb.onStartFlow("flow-with-inputs")
        // Expect flowInputRequest set when the flow has inputs; nil-safe if the flow lookup misses.
        // Adjust the assertion to your seeding capability.
        _ = cb
    }

    func testOnRunTabWithOptionsSetsRequest() {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(projectId: "p1", taskId: "t1", session: nil, flows: nil,
                              tasks: nil, ui: ui, defaultRuntime: "bun")
        cb.onRunTabWithOptions(.claude)
        XCTAssertEqual(vm.runOptionsRequest?.agent, .claude)
        XCTAssertEqual(vm.runOptionsRequest?.taskId, "t1")
    }
}
```

> If `FlowViewModel` has no public seeding hook for the flow-input test, keep only the `onRunTabWithOptions` assertion (which needs no flow data) and verify the flow-input branch via `swift build` + the dialog wiring in Task 11. Do not widen `FlowViewModel` just to test.

- [ ] **Step 2:** Run `swift test --filter RunMenuRequestTests` → FAIL.
- [ ] **Step 3:** Implement the structs, fields, seam-fills, and `confirm*` methods.
- [ ] **Step 4:** Run the filter → PASS.
- [ ] **Step 5:** Commit `feat(native): 5F RunMenu flow-input + run-options request state` + log.

---

### Task 11: FlowInputDialog + wire the onStartFlow seam

**Files:**
- Create: `native/Sources/Taskflow/UI/Dialogs/FlowInputDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift`

**Interfaces:**
- Consumes: `RunMenuViewModel.flowInputRequest` + `confirmFlowInput(...)` (Task 10); generated `FlowInputDefinition`.
- Produces: `struct FlowInputDialog: View { let isPresented: Binding<Bool>; let request: RunMenuViewModel.FlowInputRequest; let onSubmit: ([String: String]) -> Void; let onCancel: () -> Void }`.

Port `packages/ui/src/components/flows/FlowInputDialog.tsx`. Title "Flow Input: {flowName}". For each `FlowInputDefinition`: a `Label` + `AppTextField`; when `input.type == "filepath"`, add a Browse button (`NSOpenPanel`, `canChooseFiles = true`). State is `[String: String]` seeded empty. `allFilled = request.inputs.allSatisfy { !(values[$0.id] ?? "").trimmed.isEmpty }` gates **Start Flow**. Mount in `GlobalDialogHost` bound to `env.runMenu?.flowInputRequest != nil`; `onSubmit` → `env.runMenu?.confirmFlowInput(values, flows: env.flows, tasks: env.tasks, ui: env.ui)`; `onCancel`/dismiss → clear `env.runMenu?.flowInputRequest = nil`.

- [ ] **Step 1:** Implement the dialog.
- [ ] **Step 2:** Mount in `GlobalDialogHost` (binding derived from `flowInputRequest`).
- [ ] **Step 3:** Build → `Build complete!`.
- [ ] **Step 4:** Commit `feat(native): 5F FlowInputDialog + onStartFlow wiring` + log.

---

### Task 12: AgentOptionsDialog ("Run with options") + createSession agentOptions

**Files:**
- Modify: `native/Sources/Taskflow/ViewModels/SessionViewModel.swift`
- Create: `native/Sources/Taskflow/UI/Dialogs/AgentOptionsDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift`
- Modify: `native/Sources/Taskflow/UI/Dialogs/GlobalDialogHost.swift` task-creation call site (add `agentOptions:` to its `createSession` call); `ViewModels/RunMenuViewModel.swift` `confirmRunOptions` call site.

**Interfaces:**
- Consumes: `AgentOptionsFormModel`/`AgentOptionsFormView`; `RunMenuViewModel.runOptionsRequest` + `confirmRunOptions(...)`; generated `AgentLaunchOptions`.
- Produces: `SessionViewModel.createSession(..., agentOptions: AgentLaunchOptions? = nil)`; `struct AgentOptionsDialog: View`.

**Step A — add `agentOptions` to `createSession`.** In `SessionViewModel.createSession(...)`, add a trailing `agentOptions: AgentLaunchOptions? = nil` parameter (keep all existing params/defaults so current callers are unaffected). Encode it into the payload using the established JSON-object pattern (precedent: `ProjectViewModel.updateProject` linkedProjects):

```swift
if let agentOptions,
   let data = try? JSONEncoder().encode(agentOptions),
   let obj = try? JSONSerialization.jsonObject(with: data) {
    payload["agentOptions"] = obj
}
```

**Step B — dialog.** Port `AgentOptionsDialog.tsx` + `AgentOptionsPanel.tsx`. Title "Run \(RunMenuViewModel.displayName(agent)) with options". Embed `AgentOptionsFormView(model: model, agent: agent, onReset: { model.reset(to: env.settings?.settings) })` where `model = AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)`. A **Run** button reads `model.options(for: agent)` and calls the confirm path. Mount in `GlobalDialogHost` bound to `env.runMenu?.runOptionsRequest != nil`; Run → `env.runMenu?.confirmRunOptions(model.options(for: agent) ?? <default>, session: env.session, tasks: env.tasks, ui: env.ui)`; dismiss → `env.runMenu?.runOptionsRequest = nil`.

**Step C — fill the deferred call sites.** Now that `agentOptions:` exists: in `confirmRunOptions` (Task 10) pass `agentOptions: options` to `createSession`; in the TaskCreationDialogHost start path (Task 7) pass the collected `agentOptions` to `createSession`.

- [ ] **Step 1:** Add the `agentOptions` parameter + payload encoding to `createSession`.
- [ ] **Step 2:** Implement `AgentOptionsDialog`; mount in `GlobalDialogHost`.
- [ ] **Step 3:** Update `confirmRunOptions` + the Task-7 start call site to pass `agentOptions:`.
- [ ] **Step 4:** Build → `Build complete!`; run the full suite `cd native && swift test` → 0 failures (confirms no caller broke).
- [ ] **Step 5:** Commit `feat(native): 5F AgentOptionsDialog + createSession agentOptions` + log.

---

### Task 13: Settings/Appearance close chrome

**Files:**
- Modify: `native/Sources/Taskflow/UI/Settings/SettingsDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Appearance/AppearanceDialog.swift`

5E noted both dialogs lack an in-content close affordance. Add a header row (matching the `FlowManagementDialog` pattern: `HStack { Text(title, size 15, weight: .semibold); Spacer(); Button { … } label: { AppIcon("X") }.buttonStyle(.plain) }` + `Divider()`), where the button calls `env.ui.toggleSettings()` / `env.ui.toggleAppearance()` respectively. Keep the existing sidebar nav + content layout below the new header.

- [ ] **Step 1:** Add the header/close to `SettingsDialog`.
- [ ] **Step 2:** Add the header/close to `AppearanceDialog`.
- [ ] **Step 3:** Build → `Build complete!`.
- [ ] **Step 4:** Commit `feat(native): 5F Settings/Appearance close chrome` + log.

---

### Task 14: Menu-bar global shortcuts (`.commands {}`)

**Files:**
- Modify: `native/Sources/Taskflow/App/TaskflowApp.swift`

**Interfaces:**
- Consumes: the `AppEnvironment` instance held by `TaskflowApp` (so commands can read flags + call toggles/requests).

Add a `.commands {}` modifier to the `WindowGroup`. There is no menu bar today (verified). Provide:
- **CommandGroup(after: .newItem)** → "New Task" `Button { env.taskCreation.requestNewTask(projectId: env.ui.activeProjectId) }.keyboardShortcut("n", modifiers: .command)`.
- **CommandMenu("View")** (or `CommandGroup`) →
  - "Command Palette" `.keyboardShortcut("p", modifiers: [.command, .shift])` → palette toggle **with guard**: only toggle when no other modal is open unless the palette is the open one (port `usePanelNavigation` guard): `if anyModalOpen(except: .palette) { return }; env.ui.toggleCommandPalette()`.
  - "Keyboard Shortcuts" `.keyboardShortcut("/", modifiers: .command)` → `env.ui.toggleShortcutsDialog()`.
  - "Settings…" `.keyboardShortcut(",", modifiers: .command)` → `env.ui.openSettings()`.
  - "Appearance…" → `env.ui.toggleAppearance()` (no default macOS shortcut; menu item only).

Add a small `nonisolated`-free `@MainActor` helper in `TaskflowApp` (or a `UIViewModel` computed) `anyModalOpen` = `settingsOpen || appearanceOpen || flowManagementOpen || scheduleManagementOpen || shortcutsDialogOpen || (taskCreation.newTaskRequest != nil) || taskCreation.newProjectRequested || (runMenu?.flowInputRequest != nil) || (runMenu?.runOptionsRequest != nil)`. For the palette guard, exclude `commandPaletteOpen` from the check (so the shortcut still closes the palette). This replaces the TS `isDialogOpen()` DOM query with explicit state.

> **Implementer notes:** the `.commands` closure runs in the `App` (`@MainActor`) scope; capture `env` (a stored `@State private var env` on `TaskflowApp`). Grep `TaskflowApp.swift` to confirm how `env` is stored and pass it through. Menu `Button`s that need `env` can reference it directly since `.commands` is inside `body`.

- [ ] **Step 1:** Add the `anyModalOpen` helper (prefer a `UIViewModel` method that also takes the `runMenu` requests, or a private func in `TaskflowApp`).
- [ ] **Step 2:** Add the `.commands {}` block.
- [ ] **Step 3:** Build → `Build complete!`.
- [ ] **Step 4:** Commit `feat(native): 5F menu-bar global shortcuts + palette guard` + log.

---

### Task 15: Results spec + ledger + memory

**Files:**
- Create: `docs/superpowers/specs/2026-06-30-phase5f-command-palette-dialog-host-results.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `/Users/kuindji/.claude/projects/-Users-kuindji-Projects-taskflow/memory/project_native_app_experiment_status.md` + `MEMORY.md` pointer (via the memory mechanism).

Write the results spec mirroring the 5E results doc: what landed (per master-plan 5.8 + the carry-forward modals), the commit range, the test count + build-clean confirmation, the **deferrals** (Update dialog → native-feel-payoff follow-on; imperative confirm/alert host → not ported, native `.alert` idiom; AgentOperationsHelp → Phase-6 parity gap), the **human-dogfood checklist** (launch `TaskflowDev.app`, exercise Cmd+Shift+P palette filter/run, Cmd+/ shortcuts, Cmd+N new task + worktree-deferred agent start, new project, missing-location relocate/remove, fork, flow-input start, run-with-options launch, settings/appearance close button + Cmd+, ), and the Phase-5-complete → Phase-6 handoff (including the still-open theme-import/`deriveTheme` unblock carried from 5E).

- [ ] **Step 1:** Write the results spec.
- [ ] **Step 2:** Append the 5F entry to the SDD ledger.
- [ ] **Step 3:** Update the native-app-experiment memory (mark Phase 5 COMPLETE; resume point → Phase 6).
- [ ] **Step 4:** Commit `docs(native): Phase 5F results spec + ledger` (do NOT commit SDD task reports) + log.

---

## Execution Ordering Note

Tasks 1–6 are independent and can run in any order. **Task 12 (the `createSession` `agentOptions` parameter) should be implemented before the run-options/flow-start launch paths are considered done** — Tasks 7, 10, and 12 share the `createSession` call site. Recommended order: 1, 2, 3, 4, 5, 6, **12 (Step A only — add the param)**, 7, 8, 9, 10, 11, **12 (Steps B–C)**, 13, 14, 15. If the SDD harness prefers strict numeric order, implement Task 7's and Task 10's `createSession` calls without `agentOptions` first, then add the argument as Task 12 Step C (both call sites are explicitly listed there).

## Self-Review

- **Spec coverage:** master-plan 5.8 (command palette ✓ T1-3, shortcuts dialog ✓ T4, dialog host ✓ T3/T7 + per-dialog) + carry-forward modals: New Task ✓ T6/T7, New Project ✓ T5/T7, Missing Location ✓ T8, Fork ✓ T9, Flow Input ✓ T10/T11, Run-with-options ✓ T10/T12; Settings/Appearance triggers+chrome ✓ T13/T14; global shortcuts ✓ T14. Update dialog + imperative host + AgentOps-help explicitly deferred with rationale. No gaps.
- **Placeholder scan:** view-body tasks (3, 6, 7) intentionally give structure + exact signatures + TS source citation rather than full line-by-line code, because they are faithful 1:1 ports of named TS files and the implementer has the verified signatures in Global Constraints; the drift-prone pure logic (fuzzy match, palette builder, slugify) and the VM seams are given in full with TDD. This matches the 5A–5E execution model.
- **Type consistency:** `FlowInputRequest`/`RunOptionsRequest`/`NewTaskSubmit`/`PaletteRow`/`FuzzyResult` names are used identically across producing and consuming tasks; `createSession(..., agentOptions:)` is the single new signature, consumed in T7/T10/T12.

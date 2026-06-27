# Phase 5A — Breadth Foundations (Primitives, Icons, Agent Option Fragments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three cross-cutting things every Phase-5 feature screen depends on — two missing UI primitives (a themed dropdown `AppSelect` and a `SettingRow`), a lucide→SF-Symbol icon layer, and the six reusable per-agent option fragments — so the later breadth plans (sidebar, panels, flows, schedules, settings, appearance, command palette) can be built without re-deriving them.

**Architecture:** This is the first of **six Phase-5 sub-plans** (Phase 5 is ~12.6k LOC across 9 independent master-plan units — too large for one plan; see "Where this fits" below). It ships only shared, presentational building blocks: no RPC calls, no view-model changes. The option fragments are 1:1 ports of `packages/ui/src/components/shared/*Options.tsx` — pure SwiftUI views bound to typed values mirroring the React props, with serialization to backend payloads left to the consuming plans (5D/5E). Everything is verified by `swift build` + targeted `swift test` for the pure pieces + a `PrimitivesGallery` screenshot for the views.

**Tech Stack:** Swift 6 / SwiftUI / AppKit; the existing `UI/Primitives` kit + `@Environment(\.appTheme)` theme; generated `AgentTypes` enums; SF Symbols for icons. No new package dependencies.

## Where this fits (Phase 5 decomposition — context, not work for this plan)

Phase 5 (master plan `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md`, units 5.1–5.9) is split into six sub-plans, each producing working, testable software on its own:

- **5A (this plan)** — Foundations: missing primitives + icons (5.9) + shared per-agent option fragments (5.6). Unblocks all others.
- **5B** — Sidebar (5.1): task/project list breadth, drag-reorder, notifications, toolbar, context/run menus.
- **5C** — Panels (5.2): file tree + git-status colors + context menu; search/replace.
- **5D** — Flows + Schedules (5.3 + 5.5): modal management forms (consume 5A fragments).
- **5E** — Settings + Appearance (5.4 + 5.7): multi-tab settings (consume 5A fragments + fetched model selects) + theme grid.
- **5F** — Command palette + shortcuts + dialog host (5.8).

This plan must not implement any of 5B–5F.

## Global Constraints

- **Platform:** macOS 14; SwiftPM tools-version 6.0; both targets `swiftLanguageMode(.v6)`. Do not lower these.
- **Dependencies are EXACT-pinned and already declared** in `native/Package.swift`. Do **not** change versions or add new package dependencies.
- **No backend/WS work in this plan.** Fragments are presentational; fetched model lists (Cursor/OpenCode/Pi) and serialization to `*LaunchOptions` are deferred to 5D/5E. A model field whose source list requires an RPC (Cursor/OpenCode/Pi) uses a plain text field here.
- **Swift typing:** no `as Any`/`as!`/`AnyCodable` escape hatches in view code — bind selects to the generated typed enums (`ClaudeEffortLevel`, `ClaudePermissionMode`, `CodexSandboxMode`, `CodexApprovalPolicy`, `PiThinkingLevel`) and to `String?`/`Bool` where the domain is a free string or flag. Reuse generated types; don't author new model types. Keep declarations `private`/`internal` unless a cross-file consumer in this plan needs them (don't widen access "just in case").
- **TypeScript tooling:** use `bun`, never `npm`/`yarn` (only relevant if codegen must be re-run).
- **Commits:** do NOT add `Co-Authored-By`. Log every commit hash and every edited file to Taskflow (`taskflow-cli log commit "<msg>" --hash <hash>`; `taskflow-cli log file "<relpath>"`).
- **TDD:** pure logic (icon mapping, select label lookup, agent monogram/tint maps, label selection) is written test-first. SwiftUI views are verified by `swift build` + a `PrimitivesGallery` screenshot.

---

## File Structure

**New files (all under `native/Sources/Taskflow/`):**

- `UI/Primitives/AppSelect.swift` — generic themed dropdown (`Picker`/`.menu`) over a `Hashable` value; the single select control reused by every form in 5D/5E.
- `UI/Primitives/SettingRow.swift` — label + optional hint + trailing control row; the layout unit used by all option fragments and settings sections.
- `UI/Icons/AppIcon.swift` — `AppIcon` view + static `symbol(forLucide:)` lucide→SF-Symbol map (master-plan 5.9).
- `UI/Icons/AgentIcon.swift` — `AgentIcon` view rendering a themed monogram per `AgentType` (placeholder for pixel-faithful brand glyphs; documented seam).
- `UI/AgentOptions/AgentOptionsMode.swift` — `enum AgentOptionsMode { case defaults, session }` shared by all fragments.
- `UI/AgentOptions/ClaudeOptionsView.swift`
- `UI/AgentOptions/CodexOptionsView.swift`
- `UI/AgentOptions/GeminiOptionsView.swift`
- `UI/AgentOptions/CursorOptionsView.swift`
- `UI/AgentOptions/OpenCodeOptionsView.swift`
- `UI/AgentOptions/PiOptionsView.swift`
- `UI/AgentOptions/AgentOptionsView.swift` — wrapper switching on `AgentType` to the right fragment, owning the per-agent state for the gallery showcase.

**Modified files:**

- `UI/Primitives/PrimitivesGallery.swift` — add a section showcasing `AppSelect`, `SettingRow`, `AppIcon`, `AgentIcon`, and `AgentOptionsView` (used as the screenshot harness in the final task).

**New test files (under `native/Tests/TaskflowTests/`):** `AppSelectTests.swift`, `AppIconTests.swift`, `AgentIconTests.swift`, `AgentOptionsLabelTests.swift`.

---

## Interfaces shared across tasks

Names introduced here that later tasks (and 5B–5F) rely on. Exact signatures:

- `AppSelect<Value: Hashable>` (Task 1): `init(_ selection: Binding<Value>, options: [(value: Value, label: String)])`; pure `static func label(for value: Value, in options: [Option]) -> String?` where `struct Option { let value: Value; let label: String }`.
- `SettingRow<Trailing: View>` (Task 2): `init(label: String, hint: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing)`.
- `AppIcon` (Task 3): `init(_ lucide: String)`; pure `static func symbol(forLucide name: String) -> String`.
- `AgentIcon` (Task 4): `init(_ agent: AgentType, size: CGFloat = 16)`; pure `static func initial(for: AgentType) -> String`, `static func tintToken(for: AgentType) -> ThemeToken`.
- `AgentOptionsMode` (Task 5): `enum AgentOptionsMode { case defaults, session }`.
- `ClaudeOptionsView` (Task 5): `init(model: Binding<String?>, effort: Binding<ClaudeEffortLevel?>, skipPermissions: Binding<Bool>, permissionMode: Binding<ClaudePermissionMode>, mode: AgentOptionsMode = .session)`.
- `CodexOptionsView` (Task 6): `init(model: Binding<String>, fullAuto: Binding<Bool>, sandbox: Binding<CodexSandboxMode>, approvalPolicy: Binding<CodexApprovalPolicy>, mode: AgentOptionsMode = .session)`.
- `GeminiOptionsView` (Task 7): `init(model: Binding<String>, approvalMode: Binding<String>, sandbox: Binding<Bool>, mode: AgentOptionsMode = .session)`.
- `CursorOptionsView` (Task 7): `init(model: Binding<String>, yolo: Binding<Bool>, mode: AgentOptionsMode = .session)`.
- `OpenCodeOptionsView` (Task 8): `init(model: Binding<String>, variant: Binding<String>, autoApprove: Binding<Bool>, mode: AgentOptionsMode = .session)`.
- `PiOptionsView` (Task 8): `init(model: Binding<String>, thinking: Binding<PiThinkingLevel>, tools: Binding<String>, mode: AgentOptionsMode = .session)`.
- `AgentOptionsView` (Task 9): `init(agent: AgentType, mode: AgentOptionsMode = .session)`.

> **Theme tokens used below** (all confirmed present on `AppTheme`/`ThemeToken` from Phase 2/4): `.foreground`, `.mutedForeground`, `.muted`, `.background`, `.border`, `.primary`, `.accent`, `.info`, `.success`, `.warning`, and the agent-specific `.cursorAgent`. Read via `@Environment(\.appTheme) private var theme` then `theme.color(_:)`.

---

## Task 1: `AppSelect` themed dropdown primitive

The single dropdown control every form in 5D/5E will use. Generic over a `Hashable` value so fragments bind to typed enums (e.g. `ClaudeEffortLevel?`) rather than raw strings. Pure label-lookup is TDD'd; the view is a thin themed `Picker`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Primitives/AppSelect.swift`
- Test: `native/Tests/TaskflowTests/AppSelectTests.swift`

**Interfaces:**
- Consumes: `@Environment(\.appTheme)` (`AppTheme`), SwiftUI `Picker`.
- Produces: `AppSelect<Value: Hashable>` with `init(_:options:)`, nested `struct Option`, and `static func label(for:in:)`. Used by Tasks 5–8 and plans 5D/5E.

- [ ] **Step 1: Write the failing label-lookup test.** Create `AppSelectTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class AppSelectTests: XCTestCase {
    func testReturnsLabelForPresentValue() {
        let opts = [AppSelect<String>.Option(value: "a", label: "Alpha"),
                    AppSelect<String>.Option(value: "b", label: "Bravo")]
        XCTAssertEqual(AppSelect<String>.label(for: "b", in: opts), "Bravo")
    }
    func testReturnsNilForAbsentValue() {
        let opts = [AppSelect<String>.Option(value: "a", label: "Alpha")]
        XCTAssertNil(AppSelect<String>.label(for: "z", in: opts))
    }
    func testWorksForOptionalEnumValue() {
        typealias Opt = AppSelect<ClaudeEffortLevel?>.Option
        let opts = [Opt(value: nil, label: "Default"), Opt(value: .high, label: "High")]
        XCTAssertEqual(AppSelect<ClaudeEffortLevel?>.label(for: nil, in: opts), "Default")
        XCTAssertEqual(AppSelect<ClaudeEffortLevel?>.label(for: .high, in: opts), "High")
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter AppSelectTests` → FAIL (`AppSelect` undefined).

- [ ] **Step 3: Implement `AppSelect`.** Create `AppSelect.swift`:

```swift
import SwiftUI

/// Themed dropdown over a Hashable value (typed enums or strings), so option fragments
/// bind to `ClaudeEffortLevel?` etc. rather than stringly-typed values. The single select
/// control reused across every Phase-5 form.
struct AppSelect<Value: Hashable>: View {
    struct Option: Identifiable {
        let value: Value
        let label: String
        var id: Value { value }
    }

    @Environment(\.appTheme) private var theme
    private let selection: Binding<Value>
    private let options: [Option]

    init(_ selection: Binding<Value>, options: [(value: Value, label: String)]) {
        self.selection = selection
        self.options = options.map { Option(value: $0.value, label: $0.label) }
    }

    /// Pure: the label for the currently-selected value, or nil if not in `options`.
    static func label(for value: Value, in options: [Option]) -> String? {
        options.first { $0.value == value }?.label
    }

    var body: some View {
        Picker("", selection: selection) {
            ForEach(options) { opt in
                Text(opt.label).tag(opt.value)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .font(.system(size: 13))
        .tint(theme.color(.foreground))
        .frame(minWidth: 140, alignment: .trailing)
    }
}
```

> Note: `tag(opt.value)` must carry the exact static type of `selection`. For `AppSelect<ClaudeEffortLevel?>` the tag is `ClaudeEffortLevel?` — `ForEach(options)` over `Option` (whose `value` is already `Value`) keeps the type, so no manual `Optional(...)` wrapping is needed. If the compiler ever complains about tag-type inference at a call site, pass options with explicitly-typed values there (Task 5+ show this).

- [ ] **Step 4: Run — verify pass.** Run: `cd native && swift test --filter AppSelectTests` → PASS.

- [ ] **Step 5: Build.** Run: `cd native && swift build` → clean.

- [ ] **Step 6: Commit.**

```bash
cd /Users/kuindji/Projects/taskflow/.worktrees/build-native-app-experiment
git add native/Sources/Taskflow/UI/Primitives/AppSelect.swift native/Tests/TaskflowTests/AppSelectTests.swift
git commit -m "feat(native): AppSelect themed dropdown primitive (generic over Hashable value)"
```
Then `taskflow-cli log commit "<msg>" --hash <hash>` and `taskflow-cli log file <each path>`.

---

## Task 2: `SettingRow` primitive

The label + hint + trailing-control row used by every option fragment (and every settings/schedule/flow form in 5D/5E). Port of `packages/ui/src/components/settings/sections/SettingRow.tsx` (label on the left, hint subtitle, control on the right).

**Files:**
- Create: `native/Sources/Taskflow/UI/Primitives/SettingRow.swift`

**Interfaces:**
- Consumes: `@Environment(\.appTheme)`.
- Produces: `SettingRow<Trailing: View>` with `init(label:hint:trailing:)`. Used by Tasks 5–9 and plans 5D/5E.

- [ ] **Step 1: Implement `SettingRow`** (pure layout view — no test, verified by build + gallery). Create `SettingRow.swift`:

```swift
import SwiftUI

/// One labeled settings row: title + optional hint on the left, a trailing control on the right.
/// Port of components/settings/sections/SettingRow.tsx. The layout unit for all Phase-5 forms.
struct SettingRow<Trailing: View>: View {
    @Environment(\.appTheme) private var theme
    private let label: String
    private let hint: String?
    private let trailing: () -> Trailing

    init(label: String, hint: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.label = label
        self.hint = hint
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.color(.foreground))
                if let hint {
                    Text(hint)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.color(.mutedForeground))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing().frame(alignment: .trailing)
        }
        .padding(.vertical, 6)
    }
}
```

- [ ] **Step 2: Build.** Run: `cd native && swift build` → clean.

- [ ] **Step 3: Commit.** `feat(native): SettingRow primitive (label + hint + trailing control)` (+ taskflow logs).

---

## Task 3: `AppIcon` — lucide → SF Symbol map

The icon layer for all breadth screens (master-plan 5.9: lucide → SF Symbols, ~95% direct map). A pure `symbol(forLucide:)` table (TDD'd against a representative subset) plus a thin `Image(systemName:)` view. Source set = the ~50 distinct lucide names inventoried across Phase-5 areas.

**Files:**
- Create: `native/Sources/Taskflow/UI/Icons/AppIcon.swift`
- Test: `native/Tests/TaskflowTests/AppIconTests.swift`

**Interfaces:**
- Consumes: SwiftUI `Image`.
- Produces: `AppIcon` view (`init(_ lucide: String)`) + `static func symbol(forLucide:) -> String`. Used by plans 5B–5F.

- [ ] **Step 1: Write failing mapping tests.** Create `AppIconTests.swift` (pins a representative slice of the table + the fallback):

```swift
import XCTest
@testable import Taskflow

final class AppIconTests: XCTestCase {
    func testCommonMappings() {
        XCTAssertEqual(AppIcon.symbol(forLucide: "Plus"), "plus")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Trash2"), "trash")
        XCTAssertEqual(AppIcon.symbol(forLucide: "ChevronRight"), "chevron.right")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Bell"), "bell")
        XCTAssertEqual(AppIcon.symbol(forLucide: "GitBranch"), "arrow.triangle.branch")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Settings2"), "gearshape")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Workflow"), "flowchart")
    }
    func testIconSuffixAliasesAreEquivalent() {
        // lucide sometimes imports `X` and `XIcon`; both map to the same symbol.
        XCTAssertEqual(AppIcon.symbol(forLucide: "X"), AppIcon.symbol(forLucide: "XIcon"))
        XCTAssertEqual(AppIcon.symbol(forLucide: "Check"), AppIcon.symbol(forLucide: "CheckIcon"))
    }
    func testUnknownNameFallsBackToVisiblePlaceholder() {
        XCTAssertEqual(AppIcon.symbol(forLucide: "TotallyMadeUp"), "questionmark.square.dashed")
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter AppIconTests` → FAIL.

- [ ] **Step 3: Implement `AppIcon`.** Create `AppIcon.swift`. Normalize a trailing `Icon` suffix first (so `XIcon`→`X`), then map. Cover the full inventoried set; unmapped → a *visible* placeholder (never a blank), so gaps are obvious in the UI:

```swift
import SwiftUI

/// Renders a lucide-react icon name as the nearest SF Symbol. Master-plan 5.9.
/// Unmapped names render a visible placeholder so coverage gaps are obvious.
struct AppIcon: View {
    private let lucide: String
    init(_ lucide: String) { self.lucide = lucide }

    var body: some View { Image(systemName: Self.symbol(forLucide: lucide)) }

    static func symbol(forLucide name: String) -> String {
        // lucide occasionally imports `<Name>Icon`; treat as `<Name>`.
        let key = name.hasSuffix("Icon") && name != "Icon" ? String(name.dropLast(4)) : name
        switch key {
        case "Plus": return "plus"
        case "Minus": return "minus"
        case "X": return "xmark"
        case "Check": return "checkmark"
        case "ChevronDown": return "chevron.down"
        case "ChevronRight": return "chevron.right"
        case "ChevronUp": return "chevron.up"
        case "ChevronLeft": return "chevron.left"
        case "ArrowLeft": return "arrow.left"
        case "ArrowDownToLine": return "arrow.down.to.line"
        case "Bell": return "bell"
        case "Archive": return "archivebox"
        case "ArchiveRestore": return "arrow.up.bin"
        case "Trash2": return "trash"
        case "Pin": return "pin"
        case "Play": return "play.fill"
        case "Copy": return "doc.on.doc"
        case "ExternalLink": return "arrow.up.right.square"
        case "FileCode": return "doc.text"
        case "FilePlus": return "doc.badge.plus"
        case "FolderOpen": return "folder"
        case "FolderPlus": return "folder.badge.plus"
        case "Filter": return "line.3.horizontal.decrease.circle"
        case "GitBranch": return "arrow.triangle.branch"
        case "GitFork": return "arrow.triangle.branch"
        case "Globe": return "globe"
        case "Info": return "info.circle"
        case "CircleHelp": return "questionmark.circle"
        case "Circle": return "circle"
        case "Loader2": return "arrow.triangle.2.circlepath"
        case "Maximize2": return "arrow.up.left.and.arrow.down.right"
        case "Monitor": return "display"
        case "MoreHorizontal": return "ellipsis"
        case "Palette": return "paintpalette"
        case "Regex": return "asterisk"
        case "Replace": return "arrow.left.arrow.right"
        case "ReplaceAll": return "arrow.left.arrow.right.square"
        case "RotateCcw": return "arrow.counterclockwise"
        case "RotateCw": return "arrow.clockwise"
        case "Undo2": return "arrow.uturn.backward"
        case "Settings2": return "gearshape"
        case "SquareTerminal": return "terminal"
        case "Terminal": return "terminal"
        case "CalendarClock": return "calendar.badge.clock"
        case "CaseSensitive": return "textformat"
        case "WholeWord": return "textformat.abc"
        case "AlertTriangle": return "exclamationmark.triangle"
        case "WifiOff": return "wifi.slash"
        case "Workflow": return "flowchart"
        case "Zap": return "bolt"
        default: return "questionmark.square.dashed"
        }
    }
}
```

> If a given SF Symbol name is unavailable on the macOS 14 SDK (a build/runtime check shows an empty glyph), substitute the closest available symbol and keep the test pinned to whatever you choose — the test exists to lock the contract, not a specific Apple name. Coverage gaps surfaced by `default` get filled as 5B–5F consume real names.

- [ ] **Step 4: Run — verify pass + build.** Run: `cd native && swift test --filter AppIconTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): AppIcon lucide→SF-Symbol map` (+ logs).

---

## Task 4: `AgentIcon` — themed per-agent monogram

The six agent brand marks (Claude/Codex/OpenCode/Gemini/Cursor/Pi) used in the sidebar, run menus, settings tabs, and tab chips. Pixel-faithful brand glyphs need vector assets (binary, out of scope here); this ships a **themed monogram** (initial in a tinted rounded square) as the Phase-5 stand-in, with a documented seam to swap in real assets later. Pure initial/tint maps are TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/UI/Icons/AgentIcon.swift`
- Test: `native/Tests/TaskflowTests/AgentIconTests.swift`

**Interfaces:**
- Consumes: `AgentType` (generated), `@Environment(\.appTheme)`, `ThemeToken`.
- Produces: `AgentIcon(_ agent: AgentType, size: CGFloat = 16)` + `static func initial(for:) -> String`, `static func tintToken(for:) -> ThemeToken`. Used by plans 5B/5D/5E/5F.

- [ ] **Step 1: Write failing map tests.** Create `AgentIconTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class AgentIconTests: XCTestCase {
    func testInitials() {
        XCTAssertEqual(AgentIcon.initial(for: .claude), "C")
        XCTAssertEqual(AgentIcon.initial(for: .codex), "X")   // distinguish from Claude/Cursor
        XCTAssertEqual(AgentIcon.initial(for: .opencode), "O")
        XCTAssertEqual(AgentIcon.initial(for: .gemini), "G")
        XCTAssertEqual(AgentIcon.initial(for: .cursor), "▶")  // distinguish from Codex/Claude
        XCTAssertEqual(AgentIcon.initial(for: .pi), "π")
    }
    func testCursorUsesItsDedicatedThemeToken() {
        XCTAssertEqual(AgentIcon.tintToken(for: .cursor), .cursorAgent)
    }
    func testEveryAgentHasATint() {
        for a in [AgentType.claude, .codex, .opencode, .gemini, .cursor, .pi] {
            _ = AgentIcon.tintToken(for: a)   // total function: no default-trap
        }
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter AgentIconTests` → FAIL.

- [ ] **Step 3: Implement `AgentIcon`.** Create `AgentIcon.swift`. The two static maps are total `switch`es over `AgentType` (no `default`, so adding an agent forces a compile error here):

```swift
import SwiftUI

/// Themed monogram for an agent type. Placeholder for pixel-faithful brand glyphs
/// (components/icons/*Icon.tsx) — swap the body for bundled vector assets when available.
struct AgentIcon: View {
    @Environment(\.appTheme) private var theme
    private let agent: AgentType
    private let size: CGFloat

    init(_ agent: AgentType, size: CGFloat = 16) {
        self.agent = agent
        self.size = size
    }

    /// Single-glyph monogram, chosen so the six agents are visually distinct.
    static func initial(for agent: AgentType) -> String {
        switch agent {
        case .claude: return "C"
        case .codex: return "X"
        case .opencode: return "O"
        case .gemini: return "G"
        case .cursor: return "▶"
        case .pi: return "π"
        }
    }

    static func tintToken(for agent: AgentType) -> ThemeToken {
        switch agent {
        case .claude: return .primary
        case .codex: return .foreground
        case .opencode: return .info
        case .gemini: return .accent
        case .cursor: return .cursorAgent
        case .pi: return .success
        }
    }

    var body: some View {
        Text(Self.initial(for: agent))
            .font(.system(size: size * 0.6, weight: .semibold))
            .foregroundStyle(theme.color(.background))
            .frame(width: size, height: size)
            .background(theme.color(Self.tintToken(for: agent)))
            .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
    }
}
```

> Seam: when real brand assets land, replace `body` with `Image("agent-\(agent.rawValue)", bundle: .module)` and keep `initial`/`tintToken` as the fallback. Note this in the results writeup.

- [ ] **Step 4: Run — verify pass + build.** Run: `cd native && swift test --filter AgentIconTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): AgentIcon themed monogram (placeholder for brand glyphs)` (+ logs).

---

## Task 5: `AgentOptionsMode` + `ClaudeOptionsView`

The shared mode enum and the first option fragment. 1:1 port of `components/shared/ClaudeOptions.tsx` (model, effort, skip-permissions, permission-mode; `mode` switches the labels/hints). Binds to typed values. A pure label-selection helper is TDD'd; the view is verified by build/gallery.

**Files:**
- Create: `native/Sources/Taskflow/UI/AgentOptions/AgentOptionsMode.swift`
- Create: `native/Sources/Taskflow/UI/AgentOptions/ClaudeOptionsView.swift`
- Test: `native/Tests/TaskflowTests/AgentOptionsLabelTests.swift`

**Interfaces:**
- Consumes: `AppSelect` (Task 1), `SettingRow` (Task 2), `AppToggle` (existing), `ClaudeEffortLevel`/`ClaudePermissionMode` (generated).
- Produces: `AgentOptionsMode`, `ClaudeOptionsView(model:effort:skipPermissions:permissionMode:mode:)`. Used by Task 9 and plans 5D/5E.

**Reference:** `packages/ui/src/components/shared/ClaudeOptions.tsx` — the `LABELS.defaults` vs `LABELS.session` table (lines 25–47) and the four `SettingRow`s (model 5 options; effort default+5; skip-permissions switch; permission-mode 6 options). Port labels/options verbatim.

- [ ] **Step 1: Write the failing label test.** The fragments expose their label table via a pure helper so the defaults/session copy is testable. Create `AgentOptionsLabelTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class AgentOptionsLabelTests: XCTestCase {
    func testClaudeDefaultsVsSessionModelLabel() {
        XCTAssertEqual(ClaudeOptionsView.modelLabel(.defaults), "Default Model")
        XCTAssertEqual(ClaudeOptionsView.modelLabel(.session), "Model")
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter AgentOptionsLabelTests` → FAIL.

- [ ] **Step 3: Implement `AgentOptionsMode`.** Create `AgentOptionsMode.swift`:

```swift
/// Whether an option fragment is editing app-wide defaults or a single session's overrides.
/// Mirrors the `mode?: "defaults" | "session"` prop on components/shared/*Options.tsx.
enum AgentOptionsMode {
    case defaults
    case session
}
```

- [ ] **Step 4: Implement `ClaudeOptionsView`.** Create `ClaudeOptionsView.swift`. Expose `modelLabel(_:)` (the helper the test pins) and render the four rows:

```swift
import SwiftUI

/// Port of components/shared/ClaudeOptions.tsx. Presentational: binds to typed values;
/// the consumer (5D/5E) owns serialization to ClaudeLaunchOptions.
struct ClaudeOptionsView: View {
    @Binding var model: String?               // nil = "Default" sentinel
    @Binding var effort: ClaudeEffortLevel?   // nil = "Default"
    @Binding var skipPermissions: Bool
    @Binding var permissionMode: ClaudePermissionMode
    var mode: AgentOptionsMode = .session

    static func modelLabel(_ mode: AgentOptionsMode) -> String {
        mode == .defaults ? "Default Model" : "Model"
    }
    private static func effortLabel(_ mode: AgentOptionsMode) -> String {
        mode == .defaults ? "Default Effort" : "Effort"
    }

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: Self.modelLabel(mode),
                       hint: mode == .defaults ? "Pre-selected model when running Claude sessions"
                                               : "Model for Claude session") {
                AppSelect($model, options: [
                    (nil, "Default"), ("fable", "Fable"), ("opus", "Opus"),
                    ("sonnet", "Sonnet"), ("haiku", "Haiku"),
                ])
            }
            SettingRow(label: Self.effortLabel(mode),
                       hint: mode == .defaults ? "Pre-selected effort level when running Claude sessions"
                                               : "Effort level for Claude session") {
                AppSelect($effort, options: [
                    (Optional<ClaudeEffortLevel>.none, "Default"),
                    (.low, "Low"), (.medium, "Medium"), (.high, "High"),
                    (.xhigh, "Extra High"), (.max, "Max"),
                ])
            }
            SettingRow(label: "Skip Permissions",
                       hint: "Bypass all permission checks (--dangerously-skip-permissions)") {
                AppToggle(title: skipPermissions ? "Enabled" : "Disabled", isOn: $skipPermissions)
            }
            SettingRow(label: "Permission Mode",
                       hint: mode == .defaults ? "Default permission mode for Claude sessions"
                                               : "Permission mode for this session") {
                AppSelect($permissionMode, options: [
                    (.default, "Default"), (.auto, "Auto"), (.acceptEdits, "Accept Edits"),
                    (.bypassPermissions, "Bypass Permissions"), (.dontAsk, "Don't Ask"), (.plan, "Plan"),
                ])
            }
        }
    }
}
```

> The `(Optional<ClaudeEffortLevel>.none, "Default")` spelling pins the option array's element type to `(ClaudeEffortLevel?, String)` so the remaining `.low`/`.medium`/… promote to optional. Use the same pattern for any other optional-enum select.

- [ ] **Step 5: Run — verify pass + build.** Run: `cd native && swift test --filter AgentOptionsLabelTests` → PASS; `swift build` → clean.

- [ ] **Step 6: Commit.** `feat(native): AgentOptionsMode + ClaudeOptionsView fragment` (+ logs).

---

## Task 6: `CodexOptionsView`

1:1 port of `components/shared/CodexOptions.tsx` (model text input, full-auto toggle, sandbox select, approval-policy select — sandbox & approval **disabled when full-auto is on**).

**Files:**
- Create: `native/Sources/Taskflow/UI/AgentOptions/CodexOptionsView.swift`

**Interfaces:**
- Consumes: `AppSelect`, `SettingRow`, `AppToggle`, `AppTextField` (existing), `CodexSandboxMode`/`CodexApprovalPolicy` (generated).
- Produces: `CodexOptionsView(model:fullAuto:sandbox:approvalPolicy:mode:)`. Used by Task 9 and 5D/5E.

**Reference:** `components/shared/CodexOptions.tsx` — model is a free-text `Input` (placeholder `"e.g. o3, o4-mini"`); sandbox 3 options (`read-only`/`workspace-write`/`danger-full-access`); approval 4 options; both selects `disabled={fullAuto}`.

- [ ] **Step 1: Implement `CodexOptionsView`** (verified by build + gallery — no new pure logic beyond the shared label pattern). Create `CodexOptionsView.swift`:

```swift
import SwiftUI

/// Port of components/shared/CodexOptions.tsx. Sandbox + approval are disabled while Full Auto is on.
struct CodexOptionsView: View {
    @Binding var model: String
    @Binding var fullAuto: Bool
    @Binding var sandbox: CodexSandboxMode
    @Binding var approvalPolicy: CodexApprovalPolicy
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: mode == .defaults ? "Pre-selected model when running Codex sessions"
                                               : "Model for Codex session") {
                AppTextField(text: $model, placeholder: "e.g. o3, o4-mini")
                    .frame(width: 180)
            }
            SettingRow(label: "Full Auto",
                       hint: "Convenience mode: workspace-write sandbox + on-request approval") {
                AppToggle(title: fullAuto ? "Enabled" : "Disabled", isOn: $fullAuto)
            }
            SettingRow(label: "Sandbox",
                       hint: mode == .defaults ? "Default sandbox policy for model-generated shell commands"
                                               : "Sandbox policy for model-generated shell commands") {
                AppSelect($sandbox, options: [
                    (.readOnly, "Read only"), (.workspaceWrite, "Workspace write"),
                    (.dangerFullAccess, "Full access (dangerous)"),
                ])
                .disabled(fullAuto)
            }
            SettingRow(label: "Approval Policy",
                       hint: mode == .defaults ? "Default approval policy for commands"
                                               : "When to ask for approval of commands") {
                AppSelect($approvalPolicy, options: [
                    (.always, "Always"), (.unlessAllowListed, "Unless allow-listed"),
                    (.onRequest, "On request"), (.never, "Never"),
                ])
                .disabled(fullAuto)
            }
        }
    }
}
```

> If `AppTextField`'s initializer differs from `init(text:placeholder:)`, conform to the real signature in `UI/Primitives/AppTextField.swift` (it is the proven primitive).

- [ ] **Step 2: Build.** Run: `cd native && swift build` → clean; `swift test` → still green.

- [ ] **Step 3: Commit.** `feat(native): CodexOptionsView fragment` (+ logs).

---

## Task 7: `GeminiOptionsView` + `CursorOptionsView`

Two small fragments. Gemini: model text, approval-mode select, sandbox toggle. Cursor: model text, yolo toggle. Ports of `components/shared/GeminiOptions.tsx` and `CursorOptions.tsx`.

**Files:**
- Create: `native/Sources/Taskflow/UI/AgentOptions/GeminiOptionsView.swift`
- Create: `native/Sources/Taskflow/UI/AgentOptions/CursorOptionsView.swift`

**Interfaces:**
- Consumes: `AppSelect`, `SettingRow`, `AppToggle`, `AppTextField`.
- Produces: `GeminiOptionsView(model:approvalMode:sandbox:mode:)`, `CursorOptionsView(model:yolo:mode:)`. Used by Task 9 and 5D/5E.

**Reference:** `GeminiOptions.tsx` (generated `GeminiLaunchOptions`: `approvalMode: String?`, `sandbox: Bool?`, `model: String?`); `CursorOptions.tsx` (generated `CursorLaunchOptions`: `yolo: Bool?`, `model: String?`). `approvalMode` is a free string in the generated type — read the TS for the exact option values; if it renders a fixed select there, mirror those `AppSelect` options, otherwise use a text field.

- [ ] **Step 1: Read the two TS sources** to confirm Gemini's approval-mode control (fixed select vs free input) and Cursor's exact labels. Files: `packages/ui/src/components/shared/GeminiOptions.tsx`, `CursorOptions.tsx`.

- [ ] **Step 2: Implement `GeminiOptionsView`.** Create `GeminiOptionsView.swift` (model text + approval-mode + sandbox toggle). If the TS uses a fixed approval-mode select, use `AppSelect($approvalMode, options: [...])` with those values; otherwise:

```swift
import SwiftUI

/// Port of components/shared/GeminiOptions.tsx.
struct GeminiOptionsView: View {
    @Binding var model: String
    @Binding var approvalMode: String
    @Binding var sandbox: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: "Model for Gemini session") {
                AppTextField(text: $model, placeholder: "e.g. gemini-2.5-pro").frame(width: 180)
            }
            SettingRow(label: "Approval Mode", hint: "Default approval mode for Gemini") {
                AppSelect($approvalMode, options: [
                    ("default", "Default"), ("auto_edit", "Auto edit"), ("yolo", "YOLO"),
                ])
            }
            SettingRow(label: "Sandbox", hint: "Run Gemini in a sandbox") {
                AppToggle(title: sandbox ? "Enabled" : "Disabled", isOn: $sandbox)
            }
        }
    }
}
```

(Replace the approval-mode option list with the exact values found in Step 1.)

- [ ] **Step 3: Implement `CursorOptionsView`.** Create `CursorOptionsView.swift`:

```swift
import SwiftUI

/// Port of components/shared/CursorOptions.tsx.
struct CursorOptionsView: View {
    @Binding var model: String
    @Binding var yolo: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: "Model for Cursor session") {
                AppTextField(text: $model, placeholder: "e.g. gpt-5, sonnet-4.5").frame(width: 180)
            }
            SettingRow(label: "YOLO Mode", hint: "Auto-approve all actions (--yolo)") {
                AppToggle(title: yolo ? "Enabled" : "Disabled", isOn: $yolo)
            }
        }
    }
}
```

- [ ] **Step 4: Build.** Run: `cd native && swift build` → clean; `swift test` → green.

- [ ] **Step 5: Commit.** `feat(native): GeminiOptionsView + CursorOptionsView fragments` (+ logs).

---

## Task 8: `OpenCodeOptionsView` + `PiOptionsView`

OpenCode: model text, variant text, auto-approve toggle. Pi: model text, thinking select (6 levels), tools text. Ports of `OpenCodeOptions.tsx` and `PiOptions.tsx`. (The fetched model dropdowns — `OpenCodeModelSelect`/`PiModelSelect` — are deferred to 5E; here model/variant are text fields.)

**Files:**
- Create: `native/Sources/Taskflow/UI/AgentOptions/OpenCodeOptionsView.swift`
- Create: `native/Sources/Taskflow/UI/AgentOptions/PiOptionsView.swift`

**Interfaces:**
- Consumes: `AppSelect`, `SettingRow`, `AppToggle`, `AppTextField`, `PiThinkingLevel` (generated).
- Produces: `OpenCodeOptionsView(model:variant:autoApprove:mode:)`, `PiOptionsView(model:thinking:tools:mode:)`. Used by Task 9 and 5D/5E.

**Reference:** `OpenCodeOptions.tsx` (generated `OpenCodeLaunchOptions`: `model`, `variant`, `autoApprove`); `PiOptions.tsx` — thinking options `["off","minimal","low","medium","high","xhigh"]` capitalized (`off`→"Off"), tools placeholder `"read,bash,edit,write,grep,find,ls"`.

- [ ] **Step 1: Read** `packages/ui/src/components/shared/OpenCodeOptions.tsx` to confirm OpenCode's exact labels/hints and whether `variant` renders as a select or text field.

- [ ] **Step 2: Implement `OpenCodeOptionsView`.** Create `OpenCodeOptionsView.swift`:

```swift
import SwiftUI

/// Port of components/shared/OpenCodeOptions.tsx (fetched model dropdown deferred to 5E).
struct OpenCodeOptionsView: View {
    @Binding var model: String
    @Binding var variant: String
    @Binding var autoApprove: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: "Model for OpenCode session") {
                AppTextField(text: $model, placeholder: "provider/model").frame(width: 180)
            }
            SettingRow(label: "Variant", hint: "Model variant") {
                AppTextField(text: $variant, placeholder: "optional").frame(width: 180)
            }
            SettingRow(label: "Auto Approve", hint: "Auto-approve tool calls") {
                AppToggle(title: autoApprove ? "Enabled" : "Disabled", isOn: $autoApprove)
            }
        }
    }
}
```

(Adjust labels/hints and the variant control to match Step 1.)

- [ ] **Step 3: Implement `PiOptionsView`.** Create `PiOptionsView.swift`. Thinking is a typed `AppSelect` over `PiThinkingLevel`:

```swift
import SwiftUI

/// Port of components/shared/PiOptions.tsx (fetched PiModelSelect deferred to 5E).
struct PiOptionsView: View {
    @Binding var model: String
    @Binding var thinking: PiThinkingLevel
    @Binding var tools: String
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: mode == .defaults ? "Pre-selected model when running Pi sessions"
                                               : "Model for Pi session (--model)") {
                AppTextField(text: $model, placeholder: "provider/model").frame(width: 180)
            }
            SettingRow(label: mode == .defaults ? "Default Thinking" : "Thinking",
                       hint: mode == .defaults ? "Default reasoning level for supported models"
                                               : "Reasoning level (--thinking)") {
                AppSelect($thinking, options: [
                    (.off, "Off"), (.minimal, "Minimal"), (.low, "Low"),
                    (.medium, "Medium"), (.high, "High"), (.xhigh, "Xhigh"),
                ])
            }
            SettingRow(label: mode == .defaults ? "Default Tools" : "Tools",
                       hint: mode == .defaults ? "Comma-separated list of built-in tools to enable"
                                               : "Comma-separated list of built-in tools (--tools)") {
                AppTextField(text: $tools, placeholder: "read,bash,edit,write,grep,find,ls")
            }
        }
    }
}
```

- [ ] **Step 4: Build.** Run: `cd native && swift build` → clean; `swift test` → green.

- [ ] **Step 5: Commit.** `feat(native): OpenCodeOptionsView + PiOptionsView fragments` (+ logs).

---

## Task 9: `AgentOptionsView` wrapper + gallery showcase (integration gate)

A wrapper that switches on `AgentType` and renders the matching fragment, owning per-agent state for the showcase. Wiring it into `PrimitivesGallery` gives the screenshot harness that proves all of 5A renders themed and interactive.

**Files:**
- Create: `native/Sources/Taskflow/UI/AgentOptions/AgentOptionsView.swift`
- Modify: `native/Sources/Taskflow/UI/Primitives/PrimitivesGallery.swift`

**Interfaces:**
- Consumes: all six fragments + `AppSelect`/`SettingRow`/`AppIcon`/`AgentIcon`; generated `AgentType`, `ClaudeEffortLevel`, `ClaudePermissionMode`, `CodexSandboxMode`, `CodexApprovalPolicy`, `PiThinkingLevel`.
- Produces: `AgentOptionsView(agent:mode:)`. Used by plans 5D/5E (the run-menu/settings option panels) and the gallery.

- [ ] **Step 1: Implement `AgentOptionsView`.** Create `AgentOptionsView.swift`. It holds the editable state for one agent and routes to the fragment (the consumer plans 5D/5E will later lift this state into their form models — here it is self-contained so the gallery is interactive):

```swift
import SwiftUI

/// Switches on the agent type to the matching option fragment. Self-contained editable
/// state for the gallery; 5D/5E lift the bindings into their form models.
struct AgentOptionsView: View {
    let agent: AgentType
    var mode: AgentOptionsMode = .session

    // Claude
    @State private var claudeModel: String? = nil
    @State private var claudeEffort: ClaudeEffortLevel? = nil
    @State private var claudeSkip = false
    @State private var claudePermission: ClaudePermissionMode = .default
    // Codex
    @State private var codexModel = ""
    @State private var codexFullAuto = false
    @State private var codexSandbox: CodexSandboxMode = .workspaceWrite
    @State private var codexApproval: CodexApprovalPolicy = .onRequest
    // Gemini
    @State private var geminiModel = ""
    @State private var geminiApproval = "default"
    @State private var geminiSandbox = false
    // Cursor
    @State private var cursorModel = ""
    @State private var cursorYolo = false
    // OpenCode
    @State private var ocModel = ""
    @State private var ocVariant = ""
    @State private var ocAutoApprove = false
    // Pi
    @State private var piModel = ""
    @State private var piThinking: PiThinkingLevel = .off
    @State private var piTools = ""

    var body: some View {
        switch agent {
        case .claude:
            ClaudeOptionsView(model: $claudeModel, effort: $claudeEffort,
                              skipPermissions: $claudeSkip, permissionMode: $claudePermission, mode: mode)
        case .codex:
            CodexOptionsView(model: $codexModel, fullAuto: $codexFullAuto,
                             sandbox: $codexSandbox, approvalPolicy: $codexApproval, mode: mode)
        case .gemini:
            GeminiOptionsView(model: $geminiModel, approvalMode: $geminiApproval,
                              sandbox: $geminiSandbox, mode: mode)
        case .cursor:
            CursorOptionsView(model: $cursorModel, yolo: $cursorYolo, mode: mode)
        case .opencode:
            OpenCodeOptionsView(model: $ocModel, variant: $ocVariant,
                                autoApprove: $ocAutoApprove, mode: mode)
        case .pi:
            PiOptionsView(model: $piModel, thinking: $piThinking, tools: $piTools, mode: mode)
        }
    }
}
```

- [ ] **Step 2: Add a 5A showcase to `PrimitivesGallery`.** Open `UI/Primitives/PrimitivesGallery.swift`, find the existing sections, and add a new section that renders: a row of `AgentIcon(_:)` for all six agents; a row of a few `AppIcon("Plus")`/`AppIcon("Trash2")`/`AppIcon("GitBranch")`; an `AppSelect` demo; and an agent picker driving `AgentOptionsView(agent:)`. Use the existing gallery's section style (match the surrounding code — same headers/spacing). Example block to insert inside the gallery's scroll content:

```swift
// MARK: Phase 5A foundations
Text("Agent option fragments").font(.headline)
HStack(spacing: 8) {
    ForEach([AgentType.claude, .codex, .opencode, .gemini, .cursor, .pi], id: \.rawValue) { a in
        AgentIcon(a, size: 20)
    }
}
HStack(spacing: 12) {
    AppIcon("Plus"); AppIcon("Trash2"); AppIcon("GitBranch"); AppIcon("Bell"); AppIcon("Workflow")
}
AgentOptionsView(agent: galleryAgent)   // add `@State private var galleryAgent: AgentType = .claude`
                                        // + an AppSelect($galleryAgent, options:[...]) above it
```

Add the `@State private var galleryAgent: AgentType = .claude` to `PrimitivesGallery` and an `AppSelect($galleryAgent, options: [(.claude,"Claude"),(.codex,"Codex"),(.opencode,"OpenCode"),(.gemini,"Gemini"),(.cursor,"Cursor"),(.pi,"Pi")])` so switching the picker swaps the fragment live. (`AgentType` is `Hashable` via `String` raw value.)

- [ ] **Step 3: Build + full test.** Run: `cd native && swift build` → clean; `swift test` → all green (143 prior + 5A pure tests).

- [ ] **Step 4: Visual verification.** Build the dev app bundle and launch it against the **sandbox** sidecar (per `[[project_native_sidecar_sandbox]]` — never the production data dir): `bash native/scripts/build-app.sh` then the dev-bundle step that produces `native/.build/app/TaskflowDev.app`; launch, open the `PrimitivesGallery` route, and screenshot the 5A section showing themed agent icons, lucide icons, and the live agent-options fragment (switch the agent picker through 2–3 agents). Save `native/evidence/p5a-01-foundations.png`. Confirm: dropdowns open and theme-tint correctly; toggles flip; Codex sandbox/approval disable when Full Auto is on; agent monograms are distinct.

- [ ] **Step 5: Commit.** `feat(native): AgentOptionsView wrapper + PrimitivesGallery 5A showcase` (+ logs + evidence file logged).

---

## Self-Review (completed by plan author)

**Spec coverage (master-plan units this plan owns):**
- **5.9 Icons** → Task 3 (`AppIcon` lucide→SF map, full inventoried set) + Task 4 (`AgentIcon`). Brand-glyph fidelity explicitly deferred with a documented seam. ✅
- **5.6 Shared per-agent option fragments** → Tasks 5–9 (all six agents + the `AgentOptionsView` wrapper), reusable across settings/run-menus/schedules per the master plan. ✅
- **Missing primitives the breadth needs** (`AppSelect`, `SettingRow`) → Tasks 1–2. These aren't a named master-plan unit but are hard prerequisites for 5.3/5.4/5.5/5.7; confirmed absent from `UI/Primitives`. ✅
- Out of scope by design (other sub-plans): fetched model dropdowns (5E), serialization to `*LaunchOptions` (5D/5E), `RunMenuItems` (5B/5F).

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N" — every view/test step shows complete code. Two controlled lookups ("read the TS to confirm exact option values" in Tasks 7–8) are explicit one-file reads with the fallback code already written, not deferred design.

**Type consistency:** fragment initializer signatures in the Interfaces block match the `init`s in Tasks 5–9; binding types match the generated enums in `AgentTypes.swift` (`ClaudeEffortLevel`, `ClaudePermissionMode`, `CodexSandboxMode`, `CodexApprovalPolicy`, `PiThinkingLevel`); `AppSelect`/`SettingRow`/`AppIcon`/`AgentIcon` names are used identically across tasks and the gallery.

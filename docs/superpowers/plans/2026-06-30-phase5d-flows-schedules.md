# Phase 5D — Flows + Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Electron "flows" and "schedules" management UI (master-plan units 5.3 + 5.5) to native SwiftUI — the Flow management dialog (flow editor + reusable action editor + inline action editor + action list) and the Schedule management dialog (schedule form + helpers) — plus the one missing store, `ScheduleViewModel`, and a reusable agent-options form-model that lifts the Phase-5A option fragments into editable bindings.

**Architecture:** Build on the already-complete `FlowViewModel` (full flow/action CRUD already exists at the data layer) and Phase-5A primitives (`AppSelect`, `AppTextField`, `AppButton`, `AppToggle`, `SettingRow`) and the six `*OptionsView` fragments. Add one new view model — `ScheduleViewModel` (port of `schedule-store.ts`), wired client-dependent into `AppEnvironment` exactly like `TaskViewModel`. Add pure, TDD-covered helpers: `ScheduleHelpers` (next-run preview, timeout normalization, dirty-key serialization), `AgentOptionsNormalize` (canonical option encoding shared by all dirty-checks), and `FlowActionEntryCodec` (decode/encode the `FlowDefinition.actions: [AnyCodable]` reference-vs-inline union into a typed UI enum). Add a reusable `AgentOptionsFormModel` (`@Observable`) + `AgentOptionsFormView` that the action editor, inline action editor, and schedule form all embed. The two management dialogs mount as `.sheet`s driven by the **already-existing** `UIViewModel.flowManagementOpen` / `scheduleManagementOpen` flags (already toggled by the Phase-5B `SidebarToolbar` buttons). Pure logic is TDD'd; views are verified by `swift build` + human dogfood.

**Tech Stack:** Swift 6, SwiftUI, `@Observable`/`@MainActor` view models, XCTest. Backend reached over the existing `WSClient` (no new RPCs — all flow/schedule `MessageType` cases already generated).

## Global Constraints

Copied verbatim from the project conventions (`CLAUDE.md`) and the Phase-5A/5B/5C execution lessons. **Every task implicitly includes this section.**

- **Build tool:** run `swift build` / `swift test` from the `native/` directory. Use `bun` (never `npm`/`yarn`) for any TS/codegen command. **No codegen is needed** in this phase — all required generated types already exist (`FlowTypes.swift`, `ScheduleTypes.swift`, `AgentTypes.swift`, `WsTypes.swift`).
- **No `as any` / no force casts of domain types**; pursue proper typing. **No `AnyCodable`** in new code except where you must read/write a generated field that is already typed `AnyCodable?` (`Schedule.agentType`, `FlowDefinition.actions`) — decode/encode those through dedicated helpers, never sprinkle `AnyCodable` through views.
- **No new domain types.** Reuse generated structs/enums (`Schedule`, `ScheduleCreatePayload`, `ScheduleUpdatePayload`, `ScheduleListResponse`, `FlowDefinition`, `ActionDefinition`, `ActionInline`, `FlowInputDefinition`, `FlowActionReferenceEntry`, `FlowActionInlineEntry`, `SessionType`, `AgentType`, `AgentLaunchOptions` + the six `*LaunchOptions` + `ClaudePermissionMode`/`ClaudeEffortLevel`/`CodexSandboxMode`/`CodexApprovalPolicy`/`PiThinkingLevel`). Only **UI-local** helper types may be hand-authored: `FlowActionEntryKind` (typed reference/inline union), and form-model field bags. Mirror the existing `FlowRun.swift` precedent (a hand-written struct living beside the VM).
- **Don't export/widen visibility until necessary.** Everything `internal` or `private`; no `public`. If a symbol is never referenced outside its file, keep it `private`.
- **Pure static helpers must be `nonisolated`** — Swift 6 infers `@MainActor` on `View` and view-model members, so any pure function called from a test or non-isolated context must be `nonisolated static`. (Historical first hit: `AppSelect.label`.)
- **No disabling SwiftLint/eslint rules** — find the proper fix.
- **Env-injection convention** (re-confirmed 5B/5C): views use `@Environment(AppEnvironment.self) private var env` (NOT a key-path) and `@Environment(\.appTheme) private var theme`. On `AppEnvironment`: `env.ui` and `env.taskCreation` are **non-optional**; `env.tasks / projects / session / flows / search / files / settings / notifications / runMenu / diff` (and the new `env.schedules`) are **OPTIONAL**. `env.session` is singular.
- **When adding a client-dependent VM to `AppEnvironment`, update BOTH `AppEnvironmentTests` guards** — `testClientDependentVMsAreNilBeforeCompose` (nil pre-compose) and `testComposeSetsAllVMs` (non-nil post-compose). If the VM gets a cross-store closure, also update `testCrossDepClosuresAreWired`.
- **Grep the generated-type fields + real VM/primitive signatures before writing any call site.** Verified-good signatures for this phase: `AppSelect(_ selection: Binding<Value>, options: [(value: Value, label: String)])`; `AppTextField(text: Binding<String>, placeholder: String = …)`; `AppButton(title: String, kind: AppButton.Kind = .primary, action: () -> Void)` with `Kind { primary, secondary, destructive }`; `AppToggle(title: String, isOn: Binding<Bool>)`; `WSClient.request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res`, `WSClient.requestRaw(_:payload:…) async throws -> Data`, `WSClient.on<E: Decodable>(_ type:_ handler:) -> () -> Void`. The six fragment signatures are listed in Task 4. **Re-grep anything not in this list before using it.**
- **Theme:** color via `theme.color(.token)` or the named accessors used by existing files (`theme.foreground`, `theme.background`, `theme.border`, `theme.muted`, `theme.accent`, `theme.destructive`, `theme.primary`). Reuse tokens that already resolve.
- **`crypto.randomUUID()` → `UUID().uuidString`.** `Date.now()` for timestamps → `ISO8601DateFormatter().string(from: Date())` (match the format other VMs emit; grep `ISO8601` in the codebase first).
- **Commit style:** do NOT add `Co-Authored-By`. One commit per task, conventional-commit subject. After each commit, run `taskflow-cli log commit "<subject>" --hash <hash>` and `taskflow-cli log file "<path>"` for each new/edited file (paths relative to repo root).
- **SDD reports are scratch:** if a `docs(sdd)` report file gets committed accidentally, drop it with `git reset` to keep source-only history.
- **Faithful-port rule:** match the TS source 1:1 in behavior; cite the TS file in a doc comment on each new type/view, as existing native files do.

## Scope Decisions (READ FIRST)

These boundaries are deliberate and mirror how 5C split "file dialogs live in 5C, NOT 5F":

- **IN 5D:** Flow management dialog + Flow editor + Action editor + Inline action editor + Flow action list; Schedule management dialog + Schedule form; `ScheduleViewModel`; `ScheduleHelpers`; `AgentOptionsNormalize`; `FlowActionEntryCodec`; `AgentOptionsFormModel`/`AgentOptionsFormView`. Both management dialogs are **mounted as sheets in 5D** (driven by the existing `UIViewModel` flags + `SidebarToolbar` triggers).
- **DEFERRED to 5F (do NOT build here):** `FlowInputDialog` (flow-input collection before a run) — the `RunMenuViewModel.onStartFlow` input branch stays a 5F seam; the "Run with options…" `AgentOptionsDialog` seam (`onRunTabWithOptions`). Document, don't touch.
- **DEFERRED to a later flows-runtime unit (do NOT build here):** `FlowPanel` (live run viewer). The `AppShell` `flowPanelOpen` slot stays `panelPlaceholder`. `FlowViewModel.activeRuns` + all run controls already exist; the viewer view + artifact-save (`window.taskflow.saveArtifact`) + session-tab-focus integration are out of scope for 5D and will pair with the workspace/session breadth. Note this in the results spec.
- **DEFERRED (5A/5E carry-forward):** fetched model dropdowns (`cursor:models`/`opencode:models`/`pi:models` RPC). The `*OptionsView` fragments already take a free-text `model` field; 5D uses them as-is. Do not add model-fetching here.
- **`pi` in flow/action editors:** the TS Session-Type `Select` in `ActionEditor`/`InlineActionEditor` offers `claude/codex/opencode/gemini/cursor/shell` (NO `pi`), even though `SessionType.pi` exists. Reproduce exactly: omit `pi` from those two Selects. The **Schedule** form's Type select offers `__default__` + all six `AGENT_DISPLAY_NAMES` (incl. `pi`) + `shell` — reproduce that exactly too.

## File Structure

New files (all under `native/Sources/Taskflow/` unless noted):

| File | Responsibility |
|---|---|
| `UI/Flows/AgentOptionsNormalize.swift` | `nonisolated static` canonical encoder: `(SessionType/AgentType, AgentLaunchOptions?) -> AgentLaunchOptions?` returning `nil` for shell/empty/type-mismatch and zeroing falsy booleans. Shared dirty-check key for every editor/form. Port of `lib/normalize-agent-options.ts`. |
| `UI/Flows/FlowActionEntryCodec.swift` | UI-local `enum FlowActionEntryKind { case reference(FlowActionReferenceEntry); case inline(FlowActionInlineEntry) }` + `nonisolated static decode([AnyCodable]) -> [FlowActionEntryKind]` and `encode([FlowActionEntryKind]) -> [AnyCodable]`. Bridges `FlowDefinition.actions: [AnyCodable]`. |
| `UI/Schedules/ScheduleHelpers.swift` | `nonisolated static`: `computeNextRunPreview(expression:expressionType:now:) -> String?`, `normalizeTimeout(_ raw: String) -> Double`, `formatRelativeTime(_:now:) -> String`, `scheduleStatus(_:) -> ScheduleRowStatus`, `dirtyKey(...) -> String`. Port of `schedule-helpers.ts` + `ScheduleManagementDialog` helpers. |
| `ViewModels/ScheduleViewModel.swift` | Port of `schedule-store.ts`. `@MainActor @Observable`; `private(set) var schedules: [Schedule]`, `loading: Bool`; `load(projectId:)`, `create/update/delete/trigger`; `bind()` on `.scheduleUpdated`; `nonisolated static` upsert/remove reducers. |
| `UI/Flows/AgentOptionsFormModel.swift` | `@MainActor @Observable` field-bag holding every per-agent editable value; `init(seed: AgentLaunchOptions?, settings: AppSettings?)`; `func options(for: AgentType) -> AgentLaunchOptions?`; `func reset(to: AppSettings?)`. Lifts the 5A fragment `@State` into a real model. |
| `UI/Flows/AgentOptionsFormView.swift` | `View` taking `model: AgentOptionsFormModel`, `agent: AgentType`; switches to the matching `*OptionsView` fragment binding into the model; "Reset to defaults" button. |
| `UI/Flows/ActionEditor.swift` | Create/edit a reusable `ActionDefinition` form. |
| `UI/Flows/InlineActionEditor.swift` | Inline sub-form editing an `ActionInline` inside a flow row. |
| `UI/Flows/FlowActionList.swift` | Ordered action list with up/down reorder, remove, "From Library"/"Inline Action" add; embeds `InlineActionEditor`. |
| `UI/Flows/FlowEditor.swift` | Create/edit a `FlowDefinition`: name/description/project/inputs + `FlowActionList`. |
| `UI/Flows/FlowManagementDialog.swift` | Master/detail modal: tabs (Actions/Flows) + project filter + list + `FlowEditor`/`ActionEditor` detail. |
| `UI/Schedules/ScheduleForm.swift` | Create/edit a single `Schedule`. Embeds `AgentOptionsFormView`. |
| `UI/Schedules/ScheduleManagementDialog.swift` | Master/detail modal: schedule list (status/toggle/run/delete) + `ScheduleForm`. |
| `Tests/TaskflowTests/AgentOptionsNormalizeTests.swift` | TDD. |
| `Tests/TaskflowTests/FlowActionEntryCodecTests.swift` | TDD. |
| `Tests/TaskflowTests/ScheduleHelpersTests.swift` | TDD. |
| `Tests/TaskflowTests/ScheduleViewModelTests.swift` | TDD reducers. |
| `Tests/TaskflowTests/AgentOptionsFormModelTests.swift` | TDD `options(for:)`. |

Modified files:

| File | Change |
|---|---|
| `App/AppEnvironment.swift` | Add `schedules: ScheduleViewModel?` (construct + `bind()` in `compose`; assign). No boot-load (schedules are project-scoped — lazy `load(projectId:)` from the dialog). |
| `Tests/TaskflowTests/AppEnvironmentTests.swift` | Add `schedules` to both nil-before / non-nil-after guards. |
| `UI/Shell/AppShell.swift` | Attach two `.sheet`s: `flowManagementOpen → FlowManagementDialog`, `scheduleManagementOpen → ScheduleManagementDialog`. (Leave the `flowPanelOpen` placeholder untouched — deferred.) |

---

## Task 1: AgentOptionsNormalize (shared dirty-check encoder)

Port of `packages/ui/src/lib/normalize-agent-options.ts`. Every editor/form uses this to build the canonical key for dirty-tracking and (where the TS does) to normalize options before save. Pure + TDD.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/AgentOptionsNormalize.swift`
- Create: `native/Tests/TaskflowTests/AgentOptionsNormalizeTests.swift`

**Interfaces:**
- Consumes: generated `AgentType`, `SessionType`, `AgentLaunchOptions` (enum: `.claude(ClaudeLaunchOptions)` … `.pi(PiLaunchOptions)`), and each `*LaunchOptions` struct (fields per the agent-types map).
- Produces: `enum AgentOptionsNormalize { nonisolated static func normalized(type: SessionType, options: AgentLaunchOptions?) -> AgentLaunchOptions? }`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

final class AgentOptionsNormalizeTests: XCTestCase {
    func testShellReturnsNil() {
        XCTAssertNil(AgentOptionsNormalize.normalized(type: .shell, options: .claude(ClaudeLaunchOptions(type: "claude", dangerouslySkipPermissions: true, permissionMode: nil, model: nil, effort: nil))))
    }
    func testTypeMismatchReturnsNil() {
        // options say codex but the selected type is claude → nil
        XCTAssertNil(AgentOptionsNormalize.normalized(type: .claude, options: .codex(CodexLaunchOptions(type: "codex", model: "o3", sandbox: nil, approvalPolicy: nil, fullAuto: nil))))
    }
    func testNilOptionsReturnsNil() {
        XCTAssertNil(AgentOptionsNormalize.normalized(type: .claude, options: nil))
    }
    func testClaudeFalsyBooleanZeroed() {
        let out = AgentOptionsNormalize.normalized(type: .claude, options: .claude(ClaudeLaunchOptions(type: "claude", dangerouslySkipPermissions: false, permissionMode: .default, model: "", effort: nil)))
        guard case let .claude(o)? = out else { return XCTFail("expected claude") }
        XCTAssertNil(o.dangerouslySkipPermissions)   // false → nil
    }
    func testCodexFullAutoPreservedWhenTrue() {
        let out = AgentOptionsNormalize.normalized(type: .codex, options: .codex(CodexLaunchOptions(type: "codex", model: "o3", sandbox: .workspaceWrite, approvalPolicy: nil, fullAuto: true)))
        guard case let .codex(o)? = out else { return XCTFail("expected codex") }
        XCTAssertEqual(o.fullAuto, true)
        XCTAssertEqual(o.model, "o3")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter AgentOptionsNormalizeTests`
Expected: FAIL — `AgentOptionsNormalize` not found.

- [ ] **Step 3: Write minimal implementation**

Mirror `normalize-agent-options.ts`: return `nil` when `type` is `.shell`, when `options` is `nil`, or when the option case's tag differs from `type`. Otherwise rebuild the matching `*LaunchOptions` keeping per-type fields and mapping falsy booleans to `nil` (`flag == true ? true : nil`). First grep `AgentTypes.swift` for the exact `*LaunchOptions` field names + the `type` field's stored representation (it is `AnyCodable` — reuse the literal the generated initializer expects, e.g. `"claude"`).

```swift
// Port of packages/ui/src/lib/normalize-agent-options.ts
enum AgentOptionsNormalize {
    nonisolated static func normalized(type: SessionType, options: AgentLaunchOptions?) -> AgentLaunchOptions? {
        guard type != .shell, let options else { return nil }
        switch (type, options) {
        case (.claude, .claude(let o)):
            return .claude(ClaudeLaunchOptions(
                type: "claude",
                dangerouslySkipPermissions: o.dangerouslySkipPermissions == true ? true : nil,
                permissionMode: o.permissionMode,
                model: (o.model?.isEmpty == false) ? o.model : nil,
                effort: o.effort))
        case (.codex, .codex(let o)):
            return .codex(CodexLaunchOptions(
                type: "codex", model: (o.model?.isEmpty == false) ? o.model : nil,
                sandbox: o.sandbox, approvalPolicy: o.approvalPolicy,
                fullAuto: o.fullAuto == true ? true : nil))
        case (.opencode, .opencode(let o)):
            return .opencode(OpenCodeLaunchOptions(
                type: "opencode", model: (o.model?.isEmpty == false) ? o.model : nil,
                variant: (o.variant?.isEmpty == false) ? o.variant : nil,
                autoApprove: o.autoApprove == true ? true : nil))
        case (.gemini, .gemini(let o)):
            return .gemini(GeminiLaunchOptions(
                type: "gemini", approvalMode: o.approvalMode,
                sandbox: o.sandbox == true ? true : nil,
                model: (o.model?.isEmpty == false) ? o.model : nil))
        case (.cursor, .cursor(let o)):
            return .cursor(CursorLaunchOptions(
                type: "cursor", yolo: o.yolo == true ? true : nil,
                model: (o.model?.isEmpty == false) ? o.model : nil))
        case (.pi, .pi(let o)):
            return .pi(PiLaunchOptions(
                type: "pi", model: (o.model?.isEmpty == false) ? o.model : nil,
                thinking: o.thinking, tools: (o.tools?.isEmpty == false) ? o.tools : nil))
        default:
            return nil   // type mismatch
        }
    }
}
```

> NOTE: verify each `*LaunchOptions` initializer's parameter list + the `type` field representation against `AgentTypes.swift` before compiling; adjust labels/`type:` literal to match exactly. If `permissionMode`/`sandbox`/etc. enums differ in spelling, use the generated case names.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter AgentOptionsNormalizeTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/AgentOptionsNormalize.swift native/Tests/TaskflowTests/AgentOptionsNormalizeTests.swift
git commit -m "feat(native): 5D agent-options normalize helper (dirty-check encoder)"
```
Then: `taskflow-cli log commit "5D T1 AgentOptionsNormalize" --hash <hash>` and `taskflow-cli log file "native/Sources/Taskflow/UI/Flows/AgentOptionsNormalize.swift"`.

---

## Task 2: FlowActionEntryCodec (typed reference/inline union)

`FlowDefinition.actions` is generated as `[AnyCodable]` (the reference-vs-inline union is not flattened). Editing a flow's action list requires a typed view of each entry. Pure + TDD.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/FlowActionEntryCodec.swift`
- Create: `native/Tests/TaskflowTests/FlowActionEntryCodecTests.swift`

**Interfaces:**
- Consumes: generated `FlowActionReferenceEntry { id; label?; actionId }`, `FlowActionInlineEntry { id; label?; inline: ActionInline }`, `AnyCodable`.
- Produces:
  - `enum FlowActionEntryKind: Identifiable, Equatable { case reference(FlowActionReferenceEntry); case inline(FlowActionInlineEntry); var id: String }`
  - `enum FlowActionEntryCodec { nonisolated static func decode(_ raw: [AnyCodable]) -> [FlowActionEntryKind]; nonisolated static func encode(_ entries: [FlowActionEntryKind]) -> [AnyCodable] }`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

final class FlowActionEntryCodecTests: XCTestCase {
    func testRoundTripReference() throws {
        let ref = FlowActionReferenceEntry(id: "e1", label: "Lint", actionId: "a1")
        let raw = FlowActionEntryCodec.encode([.reference(ref)])
        let back = FlowActionEntryCodec.decode(raw)
        XCTAssertEqual(back, [.reference(ref)])
    }
    func testRoundTripInline() throws {
        let inline = FlowActionInlineEntry(id: "e2", label: nil,
            inline: ActionInline(name: "Build", prompt: "make", sessionType: .shell, agentOptions: nil))
        let raw = FlowActionEntryCodec.encode([.inline(inline)])
        XCTAssertEqual(FlowActionEntryCodec.decode(raw), [.inline(inline)])
    }
    func testDiscriminatesByPresenceOfActionIdVsInline() throws {
        // A raw entry carrying `actionId` decodes as .reference; one carrying `inline` decodes as .inline
        let entries = [
            FlowActionEntryKind.reference(.init(id: "e1", label: nil, actionId: "a1")),
            FlowActionEntryKind.inline(.init(id: "e2", label: "x",
                inline: ActionInline(name: "n", prompt: "p", sessionType: .claude, agentOptions: nil))),
        ]
        XCTAssertEqual(FlowActionEntryCodec.decode(FlowActionEntryCodec.encode(entries)), entries)
    }
    func testIdAccessor() {
        XCTAssertEqual(FlowActionEntryKind.reference(.init(id: "e9", label: nil, actionId: "a")).id, "e9")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter FlowActionEntryCodecTests`
Expected: FAIL — types not found.

- [ ] **Step 3: Write minimal implementation**

Decode by re-encoding each `AnyCodable` element to `Data` (via `JSONEncoder`) and attempting `FlowActionInlineEntry` first when an `inline` key is present, else `FlowActionReferenceEntry`. Grep `AnyCodable.swift` for how to obtain a dictionary / encode an element — reuse the existing pattern (`AnyCodable` is `Codable`; `JSONEncoder().encode(element)` yields the entry JSON). Discriminate on the JSON object keys: `"inline"` present → inline; `"actionId"` present → reference.

```swift
// Typed view over FlowDefinition.actions ([AnyCodable]); union per packages/shared/src/types/flow.ts
enum FlowActionEntryKind: Identifiable, Equatable {
    case reference(FlowActionReferenceEntry)
    case inline(FlowActionInlineEntry)
    var id: String {
        switch self {
        case .reference(let r): return r.id
        case .inline(let i): return i.id
        }
    }
}

enum FlowActionEntryCodec {
    nonisolated static func decode(_ raw: [AnyCodable]) -> [FlowActionEntryKind] {
        let enc = JSONEncoder(); let dec = JSONDecoder()
        return raw.compactMap { element in
            guard let data = try? enc.encode(element),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { return nil }
            if obj["inline"] != nil, let i = try? dec.decode(FlowActionInlineEntry.self, from: data) {
                return .inline(i)
            }
            if let r = try? dec.decode(FlowActionReferenceEntry.self, from: data) {
                return .reference(r)
            }
            return nil
        }
    }
    nonisolated static func encode(_ entries: [FlowActionEntryKind]) -> [AnyCodable] {
        let enc = JSONEncoder(); let dec = JSONDecoder()
        return entries.compactMap { entry in
            let data: Data?
            switch entry {
            case .reference(let r): data = try? enc.encode(r)
            case .inline(let i):    data = try? enc.encode(i)
            }
            guard let data, let any = try? dec.decode(AnyCodable.self, from: data) else { return nil }
            return any
        }
    }
}
```

> Verify `AnyCodable` is `Codable` and round-trips through `JSONEncoder`/`JSONDecoder` in this codebase; if it exposes a `.value`/dictionary accessor, prefer that for the key check. Confirm `FlowActionReferenceEntry`/`FlowActionInlineEntry` are `Equatable` (generated structs usually are — if not, the test's `XCTAssertEqual` needs them; add conformance only if the generator output lacks it, otherwise compare field-by-field in the test).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter FlowActionEntryCodecTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/FlowActionEntryCodec.swift native/Tests/TaskflowTests/FlowActionEntryCodecTests.swift
git commit -m "feat(native): 5D FlowActionEntry codec (typed reference/inline union)"
```
Then log the commit + files via `taskflow-cli`.

---

## Task 3: ScheduleHelpers (pure helpers, TDD)

Port of `schedule-helpers.ts` + the `ScheduleManagementDialog` row helpers (`formatRelativeTime`, `getScheduleStatus`). Pure + TDD. Note: cron preview is `nil` in the TS (needs backend); reproduce that.

**Files:**
- Create: `native/Sources/Taskflow/UI/Schedules/ScheduleHelpers.swift`
- Create: `native/Tests/TaskflowTests/ScheduleHelpersTests.swift`

**Interfaces:**
- Produces:
  - `enum ScheduleRowStatus { case running, error, idle }`
  - `enum ScheduleHelpers`:
    - `nonisolated static func normalizeTimeout(_ raw: String) -> Double` — parse Int; return it if finite & > 0 else `30`.
    - `nonisolated static func computeNextRunPreview(expression: String, expressionType: String, now: Date) -> String?` — `rate(N unit)` → formatted future date; `cron` → `nil`; bad input → `nil`.
    - `nonisolated static func formatRelativeTime(_ iso: String?, now: Date) -> String` — `"Never"` / `"Just now"` / `Ns/Nm/Nh/Nd ago`.
    - `nonisolated static func scheduleStatus(runningSessionId: String?, lastError: String?) -> ScheduleRowStatus`
    - `nonisolated static func dirtyKey(includeProjectId: Bool, projectId: String, name: String, actionId: String, prompt: String, expression: String, expressionType: String, agentType: String, agentOptions: AgentLaunchOptions?, timeout: String, useAction: Bool) -> String` — canonical string for hasChanges (port of `serializeScheduleState`).

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

final class ScheduleHelpersTests: XCTestCase {
    func testNormalizeTimeoutFallback() {
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout(""), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("0"), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("-5"), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("45"), 45)
    }
    func testCronPreviewIsNil() {
        XCTAssertNil(ScheduleHelpers.computeNextRunPreview(expression: "0 */6 * * *", expressionType: "cron", now: Date(timeIntervalSince1970: 0)))
    }
    func testRatePreviewNonNil() {
        XCTAssertNotNil(ScheduleHelpers.computeNextRunPreview(expression: "rate(30 minutes)", expressionType: "rate", now: Date(timeIntervalSince1970: 0)))
    }
    func testRatePreviewBadFormatNil() {
        XCTAssertNil(ScheduleHelpers.computeNextRunPreview(expression: "every 5 mins", expressionType: "rate", now: Date()))
    }
    func testRelativeTimeNever() {
        XCTAssertEqual(ScheduleHelpers.formatRelativeTime(nil, now: Date()), "Never")
    }
    func testRelativeTimeHoursAgo() {
        let now = Date(timeIntervalSince1970: 100_000)
        let twoHoursAgo = ISO8601DateFormatter().string(from: now.addingTimeInterval(-7200))
        XCTAssertEqual(ScheduleHelpers.formatRelativeTime(twoHoursAgo, now: now), "2h ago")
    }
    func testStatus() {
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: "s", lastError: nil), .running)
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: nil, lastError: "boom"), .error)
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: nil, lastError: nil), .idle)
    }
    func testDirtyKeyStableForSameInput() {
        let a = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: false)
        let b = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: false)
        XCTAssertEqual(a, b)
    }
    func testDirtyKeyUseActionDropsPromptAndAgent() {
        let withPrompt = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "a1", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: true)
        let noPrompt = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "a1", prompt: "DIFFERENT", expression: "rate(5 minutes)", expressionType: "rate", agentType: "gemini", agentOptions: nil, timeout: "30", useAction: true)
        XCTAssertEqual(withPrompt, noPrompt)  // prompt + agentType ignored when useAction
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter ScheduleHelpersTests`
Expected: FAIL — not found.

- [ ] **Step 3: Write minimal implementation**

```swift
// Port of packages/ui/src/components/schedules/schedule-helpers.ts
// + ScheduleManagementDialog row helpers (formatRelativeTime, getScheduleStatus)
enum ScheduleRowStatus { case running, error, idle }

enum ScheduleHelpers {
    nonisolated static func normalizeTimeout(_ raw: String) -> Double {
        if let v = Int(raw.trimmingCharacters(in: .whitespaces)), v > 0 { return Double(v) }
        return 30
    }

    nonisolated static func computeNextRunPreview(expression: String, expressionType: String, now: Date) -> String? {
        guard expressionType == "rate" else { return nil }   // cron preview needs backend
        // ^rate\((\d+)\s+(minutes?|hours?|days?)\)$  case-insensitive
        let pattern = #"^rate\((\d+)\s+(minutes?|hours?|days?)\)$"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let s = expression.trimmingCharacters(in: .whitespaces)
        let range = NSRange(s.startIndex..., in: s)
        guard let m = re.firstMatch(in: s, range: range),
              let vR = Range(m.range(at: 1), in: s), let uR = Range(m.range(at: 2), in: s),
              let value = Int(s[vR]) else { return nil }
        var unit = String(s[uR]).lowercased()
        if unit.hasSuffix("s") { unit.removeLast() }
        let seconds: Double
        switch unit { case "minute": seconds = 60; case "hour": seconds = 3600; case "day": seconds = 86400; default: return nil }
        let date = now.addingTimeInterval(Double(value) * seconds)
        let fmt = DateFormatter(); fmt.dateStyle = .medium; fmt.timeStyle = .short
        return fmt.string(from: date)
    }

    nonisolated static func formatRelativeTime(_ iso: String?, now: Date) -> String {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return "Never" }
        let diff = now.timeIntervalSince(date)
        if diff < 0 { return "Just now" }
        if diff < 60 { return "\(Int(diff))s ago" }
        if diff < 3600 { return "\(Int(diff / 60))m ago" }
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        return "\(Int(diff / 86400))d ago"
    }

    nonisolated static func scheduleStatus(runningSessionId: String?, lastError: String?) -> ScheduleRowStatus {
        if runningSessionId != nil { return .running }
        if lastError != nil { return .error }
        return .idle
    }

    nonisolated static func dirtyKey(includeProjectId: Bool, projectId: String, name: String, actionId: String,
                                     prompt: String, expression: String, expressionType: String, agentType: String,
                                     agentOptions: AgentLaunchOptions?, timeout: String, useAction: Bool) -> String {
        // Port of serializeScheduleState — JSON-ordered canonical key for hasChanges.
        var parts: [String] = []
        parts.append("projectId=\(includeProjectId ? projectId : "")")
        parts.append("name=\(name)")
        parts.append("actionId=\(actionId)")
        parts.append("prompt=\(useAction ? "" : prompt)")
        parts.append("expression=\(expression)")
        parts.append("expressionType=\(expressionType)")
        parts.append("agentType=\(useAction ? "" : agentType)")
        let sessionType = SessionType(rawValue: agentType) ?? .shell
        let normalized = useAction ? nil : AgentOptionsNormalize.normalized(type: sessionType, options: agentOptions)
        if let normalized, let data = try? JSONEncoder().encode(normalized), let str = String(data: data, encoding: .utf8) {
            parts.append("agentOptions=\(str)")
        } else {
            parts.append("agentOptions=")
        }
        parts.append("timeout=\(normalizeTimeout(timeout))")
        return parts.joined(separator: "&")
    }
}
```

> The exact human-readable date format from `toLocaleString()` cannot be byte-matched; a `.medium`/`.short` `DateFormatter` is an acceptable faithful equivalent (preview is display-only). The test only asserts nil/non-nil, so format choice is free. `dirtyKey` need not match the TS JSON byte-for-byte — it only needs to be **stable** and to **drop** prompt/agentType/agentOptions when `useAction` (the two behaviors the tests pin).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter ScheduleHelpersTests`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Schedules/ScheduleHelpers.swift native/Tests/TaskflowTests/ScheduleHelpersTests.swift
git commit -m "feat(native): 5D schedule helpers (next-run preview, timeout, relative time, dirty key)"
```
Then log via `taskflow-cli`.

---

## Task 4: AgentOptionsFormModel + AgentOptionsFormView (reusable embeddable form)

Lifts the Phase-5A fragment `@State` into a real model so the action editor, inline editor, and schedule form share one agent-options sub-form (the 5A "5D/5E lift the bindings into form models" carry-forward). Model is TDD'd on `options(for:)`; the view is build+dogfood verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/AgentOptionsFormModel.swift`
- Create: `native/Sources/Taskflow/UI/Flows/AgentOptionsFormView.swift`
- Create: `native/Tests/TaskflowTests/AgentOptionsFormModelTests.swift`

**Interfaces:**
- Consumes (the six 5A fragment signatures — VERIFIED, re-grep `UI/AgentOptions/` if unsure):
  - `ClaudeOptionsView(model: Binding<String?>, effort: Binding<ClaudeEffortLevel?>, skipPermissions: Binding<Bool>, permissionMode: Binding<ClaudePermissionMode>, mode: AgentOptionsMode = .session)`
  - `CodexOptionsView(model: Binding<String>, fullAuto: Binding<Bool>, sandbox: Binding<CodexSandboxMode>, approvalPolicy: Binding<CodexApprovalPolicy>, mode:)`
  - `GeminiOptionsView(model: Binding<String>, approvalMode: Binding<String>, sandbox: Binding<Bool>, mode:)`
  - `CursorOptionsView(model: Binding<String>, yolo: Binding<Bool>, mode:)`
  - `OpenCodeOptionsView(model: Binding<String>, variant: Binding<String>, autoApprove: Binding<Bool>, mode:)`
  - `PiOptionsView(model: Binding<String>, thinking: Binding<PiThinkingLevel>, tools: Binding<String>, mode:)`
  - `enum AgentOptionsMode { case defaults; case session }`; `AgentOptionsNormalize` (Task 1).
- Produces:
  - `@MainActor @Observable final class AgentOptionsFormModel` holding every field below; `init(seed: AgentLaunchOptions?, settings: AppSettings?)`; `func options(for agent: AgentType) -> AgentLaunchOptions?` (returns `AgentOptionsNormalize.normalized(type: SessionType(agent), options: assembled)`); `func reset(to settings: AppSettings?)`.
  - `struct AgentOptionsFormView: View { let model: AgentOptionsFormModel; let agent: AgentType; var onReset: (() -> Void)? }`

  Model fields (defaults shown; these mirror the 5A fragment defaults — grep each `*OptionsView` for its default before finalizing):
  ```
  var claudeModel: String? = nil
  var claudeEffort: ClaudeEffortLevel? = nil
  var claudeSkipPermissions: Bool = false
  var claudePermissionMode: ClaudePermissionMode = .default
  var codexModel: String = ""
  var codexFullAuto: Bool = false
  var codexSandbox: CodexSandboxMode = .workspaceWrite      // confirm default vs TS
  var codexApprovalPolicy: CodexApprovalPolicy = .onRequest // confirm default vs TS
  var geminiModel: String = ""
  var geminiApprovalMode: String = "default"
  var geminiSandbox: Bool = false
  var cursorModel: String = ""
  var cursorYolo: Bool = false
  var openCodeModel: String = ""
  var openCodeVariant: String = ""
  var openCodeAutoApprove: Bool = false
  var piModel: String = ""
  var piThinking: PiThinkingLevel = .off
  var piTools: String = ""
  ```

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class AgentOptionsFormModelTests: XCTestCase {
    func testSeedFromClaudeOptions() {
        let model = AgentOptionsFormModel(seed: .claude(ClaudeLaunchOptions(type: "claude", dangerouslySkipPermissions: true, permissionMode: .acceptEdits, model: "opus", effort: .high)), settings: nil)
        XCTAssertEqual(model.claudeModel, "opus")
        XCTAssertEqual(model.claudeEffort, .high)
        XCTAssertTrue(model.claudeSkipPermissions)
        XCTAssertEqual(model.claudePermissionMode, .acceptEdits)
    }
    func testOptionsForClaudeRoundTrips() {
        let model = AgentOptionsFormModel(seed: nil, settings: nil)
        model.claudeModel = "opus"; model.claudeSkipPermissions = true
        guard case let .claude(o)? = model.options(for: .claude) else { return XCTFail() }
        XCTAssertEqual(o.model, "opus"); XCTAssertEqual(o.dangerouslySkipPermissions, true)
    }
    func testOptionsForEmptyClaudeNormalizesFalsyToNil() {
        let model = AgentOptionsFormModel(seed: nil, settings: nil)
        // all defaults → normalized claude has nil skip-permissions, nil model
        guard case let .claude(o)? = model.options(for: .claude) else { return XCTFail() }
        XCTAssertNil(o.dangerouslySkipPermissions)
        XCTAssertNil(o.model)
    }
    func testSeedMismatchIgnored() {
        // seed is codex but we read claude → claude stays default
        let model = AgentOptionsFormModel(seed: .codex(CodexLaunchOptions(type: "codex", model: "o3", sandbox: nil, approvalPolicy: nil, fullAuto: true)), settings: nil)
        XCTAssertEqual(model.codexModel, "o3")
        XCTAssertTrue(model.codexFullAuto)
        XCTAssertNil(model.claudeModel)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter AgentOptionsFormModelTests`
Expected: FAIL — model not found.

- [ ] **Step 3: Write minimal implementation**

Model: `init(seed:settings:)` seeds the matching agent's fields from `seed` (switch on the seed case), leaving others at default; optionally seed defaults from `settings` per-agent (best-effort — grep `ClaudeSettings`/`CodexSettings`/etc. in `SettingsTypes.swift`; if a field isn't trivially available, fall back to the literal defaults above and note it). `options(for:)` assembles the raw `*LaunchOptions` from the fields for `agent`, wraps in `AgentLaunchOptions`, and returns `AgentOptionsNormalize.normalized(type:options:)`. `reset(to:)` re-seeds from settings/defaults.

```swift
// Reusable agent-options sub-form model. Lifts the Phase-5A *OptionsView @State into a model.
// Mirrors packages/ui/src/components/workspace/AgentOptionsPanel.tsx build/emit behavior.
@MainActor @Observable
final class AgentOptionsFormModel {
    // …fields from the Interfaces block…

    init(seed: AgentLaunchOptions?, settings: AppSettings?) {
        // best-effort defaults from settings (optional); then overlay seed for its own agent
        switch seed {
        case .claude(let o)?:
            claudeModel = o.model; claudeEffort = o.effort
            claudeSkipPermissions = o.dangerouslySkipPermissions ?? false
            claudePermissionMode = o.permissionMode ?? .default
        case .codex(let o)?:
            codexModel = o.model ?? ""; codexFullAuto = o.fullAuto ?? false
            if let s = o.sandbox { codexSandbox = s }
            if let p = o.approvalPolicy { codexApprovalPolicy = p }
        case .opencode(let o)?:
            openCodeModel = o.model ?? ""; openCodeVariant = o.variant ?? ""
            openCodeAutoApprove = o.autoApprove ?? false
        case .gemini(let o)?:
            geminiModel = o.model ?? ""; geminiApprovalMode = o.approvalMode ?? "default"
            geminiSandbox = o.sandbox ?? false
        case .cursor(let o)?:
            cursorModel = o.model ?? ""; cursorYolo = o.yolo ?? false
        case .pi(let o)?:
            piModel = o.model ?? ""; piThinking = o.thinking ?? .off; piTools = o.tools ?? ""
        case nil:
            break
        }
    }

    func options(for agent: AgentType) -> AgentLaunchOptions? {
        let raw: AgentLaunchOptions
        switch agent {
        case .claude:
            raw = .claude(ClaudeLaunchOptions(type: "claude", dangerouslySkipPermissions: claudeSkipPermissions,
                permissionMode: claudePermissionMode, model: claudeModel, effort: claudeEffort))
        case .codex:
            raw = .codex(CodexLaunchOptions(type: "codex", model: codexModel, sandbox: codexSandbox,
                approvalPolicy: codexApprovalPolicy, fullAuto: codexFullAuto))
        case .opencode:
            raw = .opencode(OpenCodeLaunchOptions(type: "opencode", model: openCodeModel,
                variant: openCodeVariant, autoApprove: openCodeAutoApprove))
        case .gemini:
            raw = .gemini(GeminiLaunchOptions(type: "gemini", approvalMode: geminiApprovalMode,
                sandbox: geminiSandbox, model: geminiModel))
        case .cursor:
            raw = .cursor(CursorLaunchOptions(type: "cursor", yolo: cursorYolo, model: cursorModel))
        case .pi:
            raw = .pi(PiLaunchOptions(type: "pi", model: piModel, thinking: piThinking, tools: piTools))
        }
        return AgentOptionsNormalize.normalized(type: SessionType(rawValue: agent.rawValue) ?? .shell, options: raw)
    }

    func reset(to settings: AppSettings?) {
        // re-init this instance's fields to defaults (+ settings seeding) — reuse init logic
    }
}
```

View: switch on `agent`, render the matching fragment with `Binding`s into `model` (e.g. `ClaudeOptionsView(model: Bindable(model).claudeModel, effort: Bindable(model).claudeEffort, skipPermissions: Bindable(model).claudeSkipPermissions, permissionMode: Bindable(model).claudePermissionMode)`), and an `AppButton("Reset to defaults", kind: .secondary)` calling `onReset`. Use `@Bindable var model` to derive bindings.

```swift
struct AgentOptionsFormView: View {
    @Bindable var model: AgentOptionsFormModel
    let agent: AgentType
    var onReset: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch agent {
            case .claude:
                ClaudeOptionsView(model: $model.claudeModel, effort: $model.claudeEffort,
                    skipPermissions: $model.claudeSkipPermissions, permissionMode: $model.claudePermissionMode)
            case .codex:
                CodexOptionsView(model: $model.codexModel, fullAuto: $model.codexFullAuto,
                    sandbox: $model.codexSandbox, approvalPolicy: $model.codexApprovalPolicy)
            case .opencode:
                OpenCodeOptionsView(model: $model.openCodeModel, variant: $model.openCodeVariant,
                    autoApprove: $model.openCodeAutoApprove)
            case .gemini:
                GeminiOptionsView(model: $model.geminiModel, approvalMode: $model.geminiApprovalMode,
                    sandbox: $model.geminiSandbox)
            case .cursor:
                CursorOptionsView(model: $model.cursorModel, yolo: $model.cursorYolo)
            case .pi:
                PiOptionsView(model: $model.piModel, thinking: $model.piThinking, tools: $model.piTools)
            }
            if let onReset {
                AppButton(title: "Reset to defaults", kind: .secondary, action: onReset)
            }
        }
    }
}
```

> Verify the exact `*LaunchOptions` initializer signatures (param order/labels, and whether `model` is `String` vs `String?`) and each fragment's `Binding` types against the real files before compiling. `AgentType.rawValue` should equal the `SessionType` raw for the same agent — confirm both enums share the string (`"claude"` etc.).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter AgentOptionsFormModelTests`
Expected: PASS (4 tests). Then `swift build` to confirm the view compiles.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/AgentOptionsFormModel.swift native/Sources/Taskflow/UI/Flows/AgentOptionsFormView.swift native/Tests/TaskflowTests/AgentOptionsFormModelTests.swift
git commit -m "feat(native): 5D reusable agent-options form model + view"
```
Then log via `taskflow-cli`.

---

## Task 5: ScheduleViewModel + AppEnvironment wiring

Port of `schedule-store.ts`. CRUD over WS + live `.scheduleUpdated`. Mirrors `TaskViewModel`. Reducers TDD'd. Wire into `AppEnvironment` (no boot-load — project-scoped, lazy `load(projectId:)`).

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/ScheduleViewModel.swift`
- Create: `native/Tests/TaskflowTests/ScheduleViewModelTests.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift`
- Modify: `native/Tests/TaskflowTests/AppEnvironmentTests.swift`

**Interfaces:**
- Consumes: `Schedule`, `ScheduleCreatePayload`, `ScheduleUpdatePayload`, `ScheduleListResponse`, `WSClient`, `MessageType.{scheduleList,scheduleCreate,scheduleUpdate,scheduleDelete,scheduleTrigger,scheduleUpdated}`.
- Produces:
  - `@MainActor @Observable final class ScheduleViewModel` — `private(set) var schedules: [Schedule] = []`, `private(set) var loading = false`, `init(client: WSClient)`, `func bind()`, `func load(projectId: String?) async`, `@discardableResult func create(_:) async throws -> Schedule`, `@discardableResult func update(_:) async throws -> Schedule`, `func delete(id:) async throws`, `func trigger(id:) async throws`, `nonisolated static func upsert(_ list: [Schedule], _ s: Schedule) -> [Schedule]`, `nonisolated static func remove(_ list: [Schedule], id: String) -> [Schedule]`.
  - `AppEnvironment.schedules: ScheduleViewModel?`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

final class ScheduleViewModelTests: XCTestCase {
    private func mk(_ id: String, name: String = "n") -> Schedule {
        Schedule(id: id, projectId: "p", name: name, prompt: "x", actionId: nil, agentType: nil,
                 agentOptions: nil, expression: "rate(5 minutes)", expressionType: "rate", timeout: 30,
                 enabled: true, lastRunAt: nil, lastError: nil, nextRunAt: nil, runningSessionId: nil,
                 createdAt: "t", updatedAt: "t")
    }
    func testUpsertAppendsNew() {
        let out = ScheduleViewModel.upsert([mk("a")], mk("b"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }
    func testUpsertReplacesExisting() {
        let out = ScheduleViewModel.upsert([mk("a", name: "old")], mk("a", name: "new"))
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].name, "new")
    }
    func testRemove() {
        XCTAssertEqual(ScheduleViewModel.remove([mk("a"), mk("b")], id: "a").map(\.id), ["b"])
    }
}
```

> Confirm the `Schedule` memberwise initializer param order against `ScheduleTypes.swift` and fix the `mk` helper to match exactly (the generator may order fields differently or require `agentType: AnyCodable?`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter ScheduleViewModelTests`
Expected: FAIL — `ScheduleViewModel` not found.

- [ ] **Step 3: Write minimal implementation**

Follow `TaskViewModel` exactly: `bind()` subscribes `client.on(.scheduleUpdated) { (s: Schedule) in Task { @MainActor in self.schedules = Self.upsert(self.schedules, s) } }`. `load` sets `loading`, `request(.scheduleList, payload: projectId.map { ["projectId": $0] } ?? [:]) -> ScheduleListResponse`, assigns, clears loading in a `defer`. `create`/`update` build `[String: Any]` payloads (encode nested `agentOptions`/`agentType` via `JSONEncoder` → `JSONSerialization` as `TaskViewModel.updateTask` does), `request(... ) -> Schedule`, then `schedules = Self.upsert(...)`. `delete` → `requestRaw(.scheduleDelete, ["id": id])` then `Self.remove`. `trigger` → `requestRaw(.scheduleTrigger, ["id": id])` (no state change).

```swift
// Port of packages/ui/src/stores/schedule-store.ts
@MainActor @Observable
final class ScheduleViewModel {
    private(set) var schedules: [Schedule] = []
    private(set) var loading = false
    @ObservationIgnored private let client: WSClient

    init(client: WSClient) { self.client = client }

    func bind() {
        client.on(.scheduleUpdated) { [weak self] (s: Schedule) in
            Task { @MainActor in guard let self else { return }; self.schedules = Self.upsert(self.schedules, s) }
        }
    }

    func load(projectId: String?) async {
        loading = true
        defer { loading = false }
        do {
            let payload: [String: Any] = projectId.map { ["projectId": $0] } ?? [:]
            let res: ScheduleListResponse = try await client.request(.scheduleList, payload: payload)
            schedules = res.schedules
        } catch { /* keep prior list */ }
    }

    @discardableResult
    func create(_ payload: ScheduleCreatePayload) async throws -> Schedule {
        let dict = try Self.encodePayload(payload)
        let created: Schedule = try await client.request(.scheduleCreate, payload: dict)
        schedules = Self.upsert(schedules, created)
        return created
    }

    @discardableResult
    func update(_ payload: ScheduleUpdatePayload) async throws -> Schedule {
        let dict = try Self.encodePayload(payload)
        let updated: Schedule = try await client.request(.scheduleUpdate, payload: dict)
        schedules = Self.upsert(schedules, updated)
        return updated
    }

    func delete(id: String) async throws {
        _ = try await client.requestRaw(.scheduleDelete, payload: ["id": id])
        schedules = Self.remove(schedules, id: id)
    }

    func trigger(id: String) async throws {
        _ = try await client.requestRaw(.scheduleTrigger, payload: ["id": id])
    }

    nonisolated static func upsert(_ list: [Schedule], _ s: Schedule) -> [Schedule] {
        if let i = list.firstIndex(where: { $0.id == s.id }) { var c = list; c[i] = s; return c }
        return list + [s]
    }
    nonisolated static func remove(_ list: [Schedule], id: String) -> [Schedule] {
        list.filter { $0.id != id }
    }

    nonisolated private static func encodePayload<T: Encodable>(_ payload: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
```

> `encodePayload` (encode the whole `Codable` payload struct → dictionary) is simpler than `TaskViewModel`'s field-by-field building and is safe here because the payload structs already encode optionals correctly (absent when nil). Confirm `JSONEncoder` omits nil optionals (Swift's default does). If the backend distinguishes "absent" from "null" for `ScheduleUpdatePayload.actionId` (nullable-to-clear), verify the encoder emits the key only when set; if `actionId` must be sent as explicit `null`, handle that one field specially (grep the backend handler for `schedule:update` to confirm clear-semantics).

Wire `AppEnvironment` (`compose`): `let schedulesVM = ScheduleViewModel(client: client); schedulesVM.bind(); … self.schedules = schedulesVM`. Add `private(set) var schedules: ScheduleViewModel?`. Do NOT add to the `boot()` parallel-load group (project-scoped). Update both `AppEnvironmentTests` guards (`XCTAssertNil(env.schedules)` pre-compose; `XCTAssertNotNil(env.schedules)` post-compose).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter ScheduleViewModelTests` then `swift test --filter AppEnvironmentTests`
Expected: PASS. Then `swift build`.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/ViewModels/ScheduleViewModel.swift native/Tests/TaskflowTests/ScheduleViewModelTests.swift native/Sources/Taskflow/App/AppEnvironment.swift native/Tests/TaskflowTests/AppEnvironmentTests.swift
git commit -m "feat(native): 5D ScheduleViewModel (schedule-store port) + AppEnvironment wiring"
```
Then log via `taskflow-cli`.

---

## Task 6: ActionEditor view

Port of `ActionEditor.tsx`. Create/edit a reusable `ActionDefinition`. Embeds `AgentOptionsFormView`. Build + dogfood verified (no unit test).

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/ActionEditor.swift`

**Interfaces:**
- Consumes: `ActionDefinition`, `SessionType`, `AgentType`, `AgentOptionsFormModel`/`AgentOptionsFormView` (Task 4), `AgentOptionsNormalize` (Task 1), `AppSelect`/`AppTextField`/`AppButton`/`AppToggle`, `env.projects?.projects` (for the project select), `env.settings?.settings` (defaults seed).
- Produces: `struct ActionEditor: View` with `let action: ActionDefinition?`, `var defaultProjectId: String?`, `let onSave: (ActionDefinition) -> Void`, `let onCancel: () -> Void`, `var onDelete: (() -> Void)?`, `var deleteDisabled: Bool = false`, `var deleteDisabledReason: String?`.

- [ ] **Step 1: Build the view**

State (init from `action` or defaults): `name: String`, `prompt: String`, `projectId: String?` (`action?.projectId ?? defaultProjectId`), `sessionType: SessionType = action?.sessionType ?? .claude`, `standalone: Bool = action?.standalone ?? false`, `confirmDelete = false`, and an `AgentOptionsFormModel` (seeded from `action?.agentOptions`, settings). Track an `initialKey` snapshot string for dirty-checking (use the same canonical approach: name + prompt + projectId + sessionType + standalone + `AgentOptionsNormalize.normalized(...)` JSON).

Fields (top→bottom), faithfully per `ActionEditor.tsx`:
- **Name** — `AppTextField(text: $name, placeholder: "Action name")`.
- **Project** — `AppSelect($projectId-as-sentinel, options:)` with a `"__global__"` sentinel mapping to `nil`, then each `env.projects?.projects` `(id, name)`. (Use a `String` binding bridging `nil ↔ "__global__"`.)
- **Session Type** — `AppSelect($sessionType, options:)` over `[.claude, .codex, .opencode, .gemini, .cursor, .shell]` (NO `.pi` — scope decision) with display labels. On change: clear agent options when shell/type-mismatch (re-seed `AgentOptionsFormModel` to defaults).
- **Standalone** — `AppToggle(title: "Standalone (available in Run menu)", isOn: $standalone)`.
- **Prompt / Command** — multiline editor. Reuse the project's multiline approach: a `TextEditor` styled like `AppTextField` (grep the codebase — 5C added editor-style multiline; if a styled multiline primitive exists, use it; else a `TextEditor` with the same border/padding treatment). Label is `"Command"` when `sessionType == .shell`, else `"Prompt"`.
- **Agent options** — `AgentOptionsFormView(model: optionsModel, agent: agentType, onReset: { optionsModel.reset(to: env.settings?.settings) })` shown only when `sessionType != .shell` (map `SessionType → AgentType`; `.shell` has none).

Footer: `AppButton("Cancel", kind: .secondary, onCancel)`, `AppButton(action?.id == nil ? "Create Action" : "Save Action", action: save)` disabled unless `isValid && hasChanges`. If `onDelete` provided: a destructive delete affordance with a confirm step; disabled with `deleteDisabledReason` tooltip when `deleteDisabled`.

Validation: `isValid = !name.trimmed.isEmpty && !prompt.trimmed.isEmpty`. `hasChanges = currentKey != initialKey`.

Save (`save()`): build `ActionDefinition(id: action?.id ?? UUID().uuidString, projectId: projectId, name: name.trimmed, prompt: prompt /* NOT trimmed, per TS */, sessionType: sessionType, agentOptions: sessionType == .shell ? nil : optionsModel.options(for: agentType), standalone: standalone ? true : nil, createdAt: action?.createdAt ?? nowISO, updatedAt: nowISO)`, then `onSave(...)`.

Add a doc comment citing `packages/ui/src/components/flows/ActionEditor.tsx`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/ActionEditor.swift
git commit -m "feat(native): 5D ActionEditor (reusable action create/edit form)"
```
Then log via `taskflow-cli`.

---

## Task 7: InlineActionEditor view

Port of `InlineActionEditor.tsx`. Inline sub-form for an `ActionInline` inside a flow row. Parent-controlled. Build verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/InlineActionEditor.swift`

**Interfaces:**
- Consumes: `ActionInline`, `SessionType`, `AgentType`, `AgentOptionsFormView`/`AgentOptionsFormModel`, primitives.
- Produces: `struct InlineActionEditor: View` with `let entryId: String`, `let inline: ActionInline`, `let onUpdate: (String, ActionInline) -> Void` (whole-inline update keeps it simple vs the TS partial), `var settings: AppSettings?`.

> Design note: the TS uses a `Partial` update callback; in Swift, pass the full updated `ActionInline` back (`onUpdate(entryId, newInline)`) — the parent (`FlowEditor` via `FlowActionList`) replaces the entry. This avoids a partial-update type and is equivalent.

- [ ] **Step 1: Build the view**

Local state seeded from `inline`: `name`, `prompt`, `sessionType`, and an `AgentOptionsFormModel` (seed `inline.agentOptions`). On any field change, call `onUpdate(entryId, ActionInline(name:, prompt:, sessionType:, agentOptions: sessionType == .shell ? nil : optionsModel.options(for: agentType)))`. Fields: Name `AppTextField`; Session Type `AppSelect` over `[.claude,.codex,.opencode,.gemini,.cursor,.shell]` (no `.pi`); Prompt/Command multiline (label switches on shell); `AgentOptionsFormView` when `sessionType != .shell` with `onReset` re-seeding to defaults. Cite `InlineActionEditor.tsx`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/InlineActionEditor.swift
git commit -m "feat(native): 5D InlineActionEditor (inline flow action sub-form)"
```
Then log via `taskflow-cli`.

---

## Task 8: FlowActionList view

Port of `FlowActionList.tsx`. Ordered action list with up/down reorder (NOT drag), remove, and the two add affordances; embeds `InlineActionEditor`. Build verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/FlowActionList.swift`

**Interfaces:**
- Consumes: `FlowActionEntryKind` (Task 2), `ActionDefinition`, `InlineActionEditor` (Task 7), `AppButton`, `AppMenu` (for "From Library"), `AppBadge`.
- Produces: `struct FlowActionList: View` with `@Binding var entries: [FlowActionEntryKind]`, `let globalActions: [ActionDefinition]`, `let libraryActions: [ActionDefinition]`, `var settings: AppSettings?`. (Reorder/remove/add mutate `entries` directly via the binding; inline edits replace the entry in `entries`.)

- [ ] **Step 1: Build the view**

Helpers (local, mirror TS): `getActionName(_ entry:) -> String` = `entry.label` ?? inline name ?? referenced-action name (`globalActions.first{ $0.id == ref.actionId }?.name`) ?? `"Unknown action"`; `getActionType(_ entry:) -> String` = inline.sessionType.rawValue ?? referenced action.sessionType.rawValue ?? `"?"`.

Top controls row:
- **"From Library"** menu (only when `!libraryActions.isEmpty`) — `AppMenu` listing each `libraryActions` item; selecting appends `.reference(FlowActionReferenceEntry(id: UUID().uuidString, label: nil, actionId: action.id))`.
- **"Inline Action"** button — appends `.inline(FlowActionInlineEntry(id: UUID().uuidString, label: nil, inline: ActionInline(name: "", prompt: "", sessionType: .claude, agentOptions: nil)))`.

Per-row (`ForEach(entries) { entry in }`, index via `entries.firstIndex`):
- ChevronUp button (`disabled` at index 0) → swap with previous; ChevronDown (`disabled` at last) → swap with next.
- `"\(index + 1)."` label, `getActionName(entry)`, an `AppBadge(getActionType(entry))`, and an X remove button → `entries.remove(at: index)`.
- If `case .inline(let i) = entry`: render `InlineActionEditor(entryId: i.id, inline: i.inline, onUpdate: { id, newInline in replace entry id with .inline(FlowActionInlineEntry(id: id, label: i.label, inline: newInline)) }, settings: settings)`.

Empty state: `Text("No actions added yet")` when `entries.isEmpty`.

Cite `FlowActionList.tsx`. Reorder is button-based (no DnD) — match TS exactly.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/FlowActionList.swift
git commit -m "feat(native): 5D FlowActionList (reorder/add/remove + inline editors)"
```
Then log via `taskflow-cli`.

---

## Task 9: FlowEditor view

Port of `FlowEditor.tsx`. Create/edit a `FlowDefinition`: name/description/project/inputs + `FlowActionList`. Build verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/FlowEditor.swift`

**Interfaces:**
- Consumes: `FlowDefinition`, `FlowInputDefinition`, `FlowActionEntryKind` + `FlowActionEntryCodec` (Task 2), `FlowActionList` (Task 8), `AgentOptionsNormalize`, primitives, `env.projects?.projects`, `env.settings?.settings`.
- Produces: `struct FlowEditor: View` with `let flow: FlowDefinition?`, `let globalActions: [ActionDefinition]`, `var defaultProjectId: String?`, `let onSave: (FlowDefinition) -> Void`, `let onCancel: () -> Void`, `var onDelete: (() -> Void)?`.

- [ ] **Step 1: Build the view**

State: `name`, `description` (from `flow`), `projectId: String?`, `entries: [FlowActionEntryKind]` (= `FlowActionEntryCodec.decode(flow?.actions ?? [])`), `inputs: [FlowInputDefinition]` (= `flow?.inputs ?? []`), `confirmDelete`. `libraryActions` = `globalActions` filtered to global-or-current-project (`projectId == nil` → only actions with `nil` projectId; else nil-or-matching). Dirty-key snapshot covers name/description/projectId/entries(encoded)/inputs.

Fields:
- **Name** `AppTextField`; **Description** `AppTextField` (or multiline).
- **Project** `AppSelect` with `"__global__"` sentinel ↔ `nil`, then projects.
- **Inputs** section: "Add Input" button appends `FlowInputDefinition(id: "", label: "", type: "text")`; each row = id `AppTextField` + type `AppSelect` over `[("text","Text"),("filepath","File path")]` + label `AppTextField` + X remove.
- **Actions**: `FlowActionList(entries: $entries, globalActions: globalActions, libraryActions: libraryActions, settings: env.settings?.settings)`.

Footer: Cancel; Save (`"Create Flow"`/`"Save Flow"`) disabled unless `isValid && hasChanges`; Delete (+confirm) when `onDelete`.

Validation (`isValid`, port exactly):
- `!name.trimmed.isEmpty`
- `!entries.isEmpty`
- every inline entry: `!inline.name.trimmed.isEmpty && !inline.prompt.trimmed.isEmpty && (inline.sessionType == .shell || inline.agentOptions matches sessionType)` — reuse `AgentOptionsNormalize.normalized(type:options:) != nil || sessionType == .shell` as the match check.
- every input: `!id.isEmpty`, `id` matches `^[a-zA-Z0-9_-]+$`, `!label.isEmpty`.
- input ids unique (`Set(ids).count == inputs.count`).

Save: build `FlowDefinition(id: flow?.id ?? UUID().uuidString, projectId: projectId, name: name.trimmed, description: description.trimmed, actions: FlowActionEntryCodec.encode(entries-with-trimmed-inline-name/prompt and shell-nulled-options), inputs: inputs.isEmpty ? nil : inputs, createdAt: flow?.createdAt ?? nowISO, updatedAt: nowISO)`, then `onSave`. Cite `FlowEditor.tsx`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/FlowEditor.swift
git commit -m "feat(native): 5D FlowEditor (flow create/edit form + inputs + action list)"
```
Then log via `taskflow-cli`.

---

## Task 10: FlowManagementDialog + mount sheet

Port of `FlowManagementDialog.tsx`. Master/detail modal: Actions/Flows tabs + project filter + list + `FlowEditor`/`ActionEditor`. Mount as a `.sheet` in `AppShell` driven by `ui.flowManagementOpen`. Build + dogfood verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Flows/FlowManagementDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `FlowEditor` (Task 9), `ActionEditor` (Task 6), `env.flows` (`flows`, `actions`, `fetchFlows()`, `fetchActions()`, `saveFlow`, `saveAction`, `deleteFlow`, `deleteAction`), `env.projects?.projects`, `env.ui` (`flowManagementOpen`, `toggleFlowManagement`, `activeProjectId`), `AppSegmentedTabs`.
- Produces: `struct FlowManagementDialog: View` (no external params — reads `env`).

- [ ] **Step 1: Build the dialog**

State: `tab: ManagementTab = .actions` (`enum { actions, flows }`), `selectedId: String?`, `creating = false`, `projectFilter: String` (init `env.ui.activeProjectId ?? "all"`). On appear (`.task`): `await env.flows?.fetchFlows(); await env.flows?.fetchActions()`.

Layout: `HStack` master/detail.
- **Left:** segmented `Actions`/`Flows` tab (clears selection on switch); project filter `AppSelect` over `[("all","All"),("global","Global")] + projects`; `+` create button (`creating = true; selectedId = nil`); the filtered list (`filteredActions`/`filteredFlows` by `projectFilter`). Each row selectable.
- **Right:** when `tab == .flows && (creating || selectedFlow != nil)` → `FlowEditor(flow: selectedFlow, globalActions: env.flows?.actions ?? [], defaultProjectId: defaultProjectId, onSave: { saveFlow }, onCancel: { clear }, onDelete: selectedFlow.map { f in { deleteFlow f } })`. When `tab == .actions && (creating || selectedAction != nil)` → `ActionEditor(...)` with `deleteDisabled`/`deleteDisabledReason` computed from a `referencingFlowsByActionId` map (a flow references an action if any decoded `.reference` entry's `actionId` matches; block delete with reason `"Used by N flow(s)"`). Else an empty-state placeholder.

`filterByProject(items, projectFilter)`: `"all"` → all; `"global"` → items with `nil` projectId; else `projectId == filter`. `defaultProjectId` = `projectFilter` when it's a real id else `nil`.

Save handlers: `onSave` calls `try await env.flows?.saveFlow(flow)` / `saveAction(action)` then `selectedId = saved.id; creating = false`. Delete clears selection.

Header with title "Flows & Actions" and a close affordance calling `env.ui.toggleFlowManagement()`. Cite `FlowManagementDialog.tsx`.

Mount in `AppShell`: attach `.sheet(isPresented: Binding(get: { ui.flowManagementOpen }, set: { if !$0 { env.ui.toggleFlowManagement() } })) { FlowManagementDialog() }` on the shell root (next to existing modifiers). Confirm where other sheets attach; match that placement.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build && swift test`
Expected: builds clean; full suite green.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Flows/FlowManagementDialog.swift native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): 5D FlowManagementDialog (master/detail) mounted in shell"
```
Then log via `taskflow-cli`.

---

## Task 11: ScheduleForm view

Port of `ScheduleForm.tsx`. Create/edit a single `Schedule`. Embeds `AgentOptionsFormView`; uses `ScheduleHelpers`. Build verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Schedules/ScheduleForm.swift`

**Interfaces:**
- Consumes: `Schedule`, `ScheduleCreatePayload`, `ScheduleUpdatePayload`, `ActionDefinition`, `ScheduleHelpers` (Task 3), `AgentOptionsNormalize`, `AgentOptionsFormView`/`AgentOptionsFormModel`, primitives, `env.projects?.projects`, `env.flows?.actions`, `env.settings?.settings`.
- Produces: `struct ScheduleForm: View` with `let schedule: Schedule?`, `let projects: [Project]`, `let actions: [ActionDefinition]`, `var defaultProjectId: String?`, `let onSave: (ScheduleSavePayload) -> Void`, `let onCancel: () -> Void`, `var onDelete: (() -> Void)?`.
  - `enum ScheduleSavePayload { case create(ScheduleCreatePayload); case update(ScheduleUpdatePayload) }` (UI-local; lets the dialog dispatch to `create`/`update`).

- [ ] **Step 1: Build the view**

State (init per `ScheduleForm.tsx`): `projectId = schedule?.projectId ?? defaultProjectId ?? ""`, `actionId = schedule?.actionId ?? ""`, `name`, `prompt`, `expressionType: String = schedule?.expressionType ?? "rate"`, `expression: String = schedule?.expression ?? "rate(30 minutes)"`, `agentType: String = (schedule?.agentType-as-string) ?? ""` (read the `AnyCodable?` as a `String?` — grep `AnyCodable` for the string accessor), `timeout: String = String(Int(schedule?.timeout ?? 30))`, `confirmDelete = false`, an `AgentOptionsFormModel` (seed `schedule?.agentOptions`). `isEditing = schedule != nil`.

Derived: `availableActions = actions.filter { byProject(projectId) }.filter { $0.standalone == true }`; `selectedAction = actions.first { $0.id == actionId }`; `useAction = selectedAction != nil`; `nextRunPreview = ScheduleHelpers.computeNextRunPreview(expression:expressionType:now: Date())`; dirty via `ScheduleHelpers.dirtyKey(...)` (initial snapshot vs current). If current `actionId` not in `availableActions`, reset it to `""` (`.onChange(of: projectId)`).

Fields (faithful to TS, with the visibility gates):
- **Project** `AppSelect` — create-only (`!isEditing`); required.
- **Action** `AppSelect` (only when `!availableActions.isEmpty`) — sentinel `"__none__"`="None (custom prompt)" + each standalone action; `"__none__"` → `actionId = ""`.
- **Action summary** card — when `useAction` (name + sessionType + clamped prompt).
- **Type** `AppSelect` (only when `!useAction`) — `"__default__"`="Default" + `[claude,codex,opencode,gemini,cursor,pi]` via display names + `"shell"`="Shell". `"__default__"` → `agentType = ""`. On change clear options unless type matches.
- **Name** `AppTextField` (only when `!useAction`) — optional, placeholder "Auto-generated from prompt".
- **Prompt / Command** multiline (only when `!useAction`) — label "Command" when `agentType == "shell"` else "Prompt".
- **Schedule** row: expressionType `AppSelect` `[("rate","rate"),("cron","cron")]` + expression `AppTextField` (placeholder `rate(30 minutes)`/`0 */6 * * *`). Below: `Text("Next run: \(nextRunPreview)")` when non-nil.
- **Agent options** `AgentOptionsFormView` — when `!useAction && !agentType.isEmpty && agentType != "shell"` (map the string to `AgentType`); `onReset` re-seeds.
- **Timeout (minutes)** `AppTextField` (numeric) — bound to `timeout`.

Error banner: when `schedule?.lastError != nil`, a destructive-tinted banner above the body.

Validation (`canSave`, port exactly): `(useAction || !prompt.trimmed.isEmpty) && !expression.trimmed.isEmpty && (isEditing || !projectId.isEmpty)`. Save disabled unless `canSave && !saving && hasChanges`.

Save: `effectiveTimeout = ScheduleHelpers.normalizeTimeout(timeout)`. Map `agentType` string → `AgentType?` (empty/`"shell"`/`"__default__"` → none); compute `opts = useAction ? nil : (agentTypeEnum.flatMap { optionsModel.options(for: $0) })`. **Editing** → `.update(ScheduleUpdatePayload(id: schedule!.id, name: name.orNil, prompt: useAction ? nil : prompt, actionId: actionId.isEmpty ? <null> : actionId, agentType: useAction ? <null> : agentTypeAnyCodable, agentOptions: opts, expression: expression, expressionType: expressionType, timeout: effectiveTimeout, enabled: nil))`. **Creating** → `.create(ScheduleCreatePayload(projectId: projectId, name: name.orNil, prompt: useAction ? nil : prompt, actionId: actionId.orNil, agentType: useAction ? nil : agentTypeAnyCodable, agentOptions: opts, expression: expression, expressionType: expressionType, timeout: effectiveTimeout, enabled: nil))`. Note the create(undefined)/update(null) asymmetry for clearing — confirm how the generated payload encodes "set to null" vs "absent"; for `ScheduleUpdatePayload.actionId`/`agentType`, the TS sends `null` to clear. If the Swift `?` optional encodes as "absent" when `nil`, and the backend treats absent as "leave unchanged", you must verify the backend's `schedule:update` clear-semantics (grep `backend` for the handler) and, if needed, represent the loaded value vs cleared value explicitly. Document whatever you confirm in the results spec.

> `agentTypeAnyCodable`: wrap the agent-type string into the generated `AnyCodable` the payload expects (grep `AnyCodable` init from `String`). Cite `ScheduleForm.tsx`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Schedules/ScheduleForm.swift
git commit -m "feat(native): 5D ScheduleForm (create/edit schedule, action/agent/cron-rate)"
```
Then log via `taskflow-cli`.

---

## Task 12: ScheduleManagementDialog + mount sheet

Port of `ScheduleManagementDialog.tsx`. Master/detail modal: schedule list (status dot, toggle, run-now, delete) + `ScheduleForm`. Mount as a `.sheet` in `AppShell` driven by `ui.scheduleManagementOpen`. Build + dogfood verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Schedules/ScheduleManagementDialog.swift`
- Modify: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `ScheduleForm` + `ScheduleSavePayload` (Task 11), `ScheduleHelpers` (Task 3, `formatRelativeTime`/`scheduleStatus`), `env.schedules` (Task 5: `schedules`, `load(projectId:)`, `create`, `update`, `delete`, `trigger`), `env.projects?.projects`, `env.flows?.actions` (+ `fetchActions`), `env.ui` (`scheduleManagementOpen`, `toggleScheduleManagement`, `activeProjectId`), `AppToggle`, `AppMenu`, `AppBadge`.
- Produces: `struct ScheduleManagementDialog: View`.

- [ ] **Step 1: Build the dialog**

State: `selectedId: String?`, `creating = false`, `projectFilter: String` (init `activeProjectId ?? "all"`), `pendingDeleteId: String?`. On appear (`.task`): `await env.schedules?.load(projectId: nil); await env.flows?.fetchActions()`. (Load all; filter client-side by `projectFilter` — the TS fetches all then filters.)

Derived: `projectMap`, `actionMap`; `filteredSchedules` (`projectFilter == "all"` ? all : by projectId); `defaultProjectId = projectFilter != "all" ? projectFilter : nil`; `selectedSchedule = filteredSchedules.first { $0.id == selectedId }`.

Layout `HStack`:
- **Left:** project filter `AppSelect` (`all` + projects); `+` create; list. Each row: status dot colored by `ScheduleHelpers.scheduleStatus(runningSessionId:lastError:)` (`running`→blue, `error`→red, `idle`→green); `schedule.name.isEmpty ? String(schedule.prompt.prefix(40)) : schedule.name`; subtitle `"\(schedule.expression) · \(ScheduleHelpers.formatRelativeTime(schedule.lastRunAt, now: Date()))"`; optional action badge (from `actionMap`); optional project badge (only when filter == "all"); an `AppToggle` bound to enabled (→ `update(ScheduleUpdatePayload(id:…, enabled: !enabled, …minimal))`); an actions `AppMenu` with "Run now" (→ `trigger(id:)`) and "Delete" (→ `pendingDeleteId = id`).
- **Right:** `ScheduleForm` when `creating || selectedSchedule != nil`, passing `projects`, `actions`, `defaultProjectId`, `onSave` (dispatch `ScheduleSavePayload` → `env.schedules?.create/update`, then select the result id; `creating = false`), `onCancel` (clear), `onDelete` (→ `pendingDeleteId`). Else empty-state placeholder.

A confirm-delete affordance gated on `pendingDeleteId` → `env.schedules?.delete(id:)` then clear selection.

`handleToggleEnabled`: `update(ScheduleUpdatePayload(id: s.id, name: nil, prompt: nil, actionId: nil, agentType: nil, agentOptions: nil, expression: nil, expressionType: nil, timeout: nil, enabled: !s.enabled))` — only the enabled flag changes; all other optionals nil/absent (verify the backend treats absent as unchanged for `schedule:update`; this is the common case the TS relies on).

Header "Schedules" + close calling `toggleScheduleManagement()`. Cite `ScheduleManagementDialog.tsx`.

Mount in `AppShell`: `.sheet(isPresented: Binding(get: { ui.scheduleManagementOpen }, set: { if !$0 { env.ui.toggleScheduleManagement() } })) { ScheduleManagementDialog() }`.

- [ ] **Step 2: Verify build + full suite**

Run: `cd native && swift build && swift test`
Expected: builds clean; ALL tests green (report the count).

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Schedules/ScheduleManagementDialog.swift native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): 5D ScheduleManagementDialog (master/detail) mounted in shell"
```
Then log via `taskflow-cli`.

---

## Task 13: Whole-phase review fixes + results spec + ledger + memory

After Tasks 1–12, run the opus whole-phase review (per subagent-driven-development), apply one consolidated fix wave, then write the results spec and update the ledger + memory. Docs-only commits.

**Files:**
- Create: `docs/superpowers/specs/2026-06-30-phase5d-flows-schedules-results.md`
- Modify: `.superpowers/sdd/progress.md`
- (Memory updated out-of-band via the Write tool, not committed.)

- [ ] **Step 1: Whole-phase review**

Dispatch an opus reviewer over the full 5D range (`git diff <base>..HEAD`). Triage findings (FIX-NOW vs DEFER). Apply FIX-NOW in one fix-wave commit; re-review. Re-run `swift build && swift test` (controller-verified, report counts).

- [ ] **Step 2: Write the results spec**

Document: what landed (per file), the scope decisions honored (FlowInputDialog→5F, FlowPanel deferred, no model-fetch), the create/undefined vs update/null clear-semantics finding, test counts, and the **human-dogfood checklist** (launch `native/.build/app/TaskflowDev.app`; open Flows dialog from the sidebar toolbar; create an inline-action flow + a library-reference flow; edit/reorder/delete; open Schedules dialog; create a rate schedule + an action-backed schedule; toggle enabled; run-now; delete; confirm live `.scheduleUpdated` updates and agent-options round-trip). Note any deferred minors.

- [ ] **Step 3: Update ledger + commit docs**

Append the 5D section to `.superpowers/sdd/progress.md`. Commit:

```bash
git add docs/superpowers/specs/2026-06-30-phase5d-flows-schedules-results.md .superpowers/sdd/progress.md
git commit -m "docs(native): Phase 5D (Flows+Schedules) results spec + ledger"
```
Then `taskflow-cli log info "PHASE 5D COMPLETE …"` summarizing. Update the `project_native_app_experiment_status` memory: 5D done, next = 5E (Settings+Appearance).

---

## Self-Review (completed during planning)

- **Spec coverage:** 5.3 Flows → Tasks 6–10 (action editor, inline editor, action list, flow editor, management dialog); 5.5 Schedules → Tasks 3, 5, 11, 12 (helpers, VM, form, management dialog). Missing store `ScheduleViewModel` → Task 5. 5A "lift bindings into form model" carry-forward → Task 4. `FlowDefinition.actions` `[AnyCodable]` bridge → Task 2. Shared dirty-check → Task 1. Mounting (existing `UIViewModel` flags + `SidebarToolbar` triggers) → Tasks 10, 12. DEFERRED (documented, not built): FlowInputDialog (5F), FlowPanel live-run viewer (later), AgentOptionsDialog "Run with options" (5F), fetched model dropdowns (5E).
- **Type consistency:** `FlowActionEntryKind`/`FlowActionEntryCodec` (T2) consumed by T8/T9; `AgentOptionsNormalize` (T1) consumed by T3/T4/T6/T9/T11; `AgentOptionsFormModel`/`View` (T4) consumed by T6/T7/T11; `ScheduleViewModel` (T5) consumed by T12; `ScheduleHelpers` (T3) consumed by T11/T12; `ScheduleSavePayload` defined in T11 consumed by T12. Names checked across tasks.
- **Verification caveat baked into every call-site task:** "grep the generated initializer / fragment signature before compiling" — because prior-phase plan drafts drifted from real signatures (the `*LaunchOptions` initializers, `AnyCodable` string accessor, `Schedule` member order, and the schedule-update clear-semantics are the known risk points here).

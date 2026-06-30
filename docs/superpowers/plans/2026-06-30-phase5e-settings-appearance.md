# Phase 5E — Settings + Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Electron "Settings" and "Appearance" UI (master-plan units 5.4 + 5.7) to native SwiftUI — a 9-tab Settings dialog (General, Defaults, the six per-agent default tabs, Remote Agent) and a 2-tab Appearance dialog (Themes grid + Fonts) — plus the deferred fetched-model dropdowns (`cursor:`/`opencode:`/`pi:models`), wired into the existing `SettingsViewModel`/`ThemeStore` and the Phase-5A agent-option fragments.

**Architecture:** Both dialogs persist every control immediately via `SettingsViewModel.updateSettings(_:)` (a `settings:update` RPC that returns the full merged `AppSettings`) — there is **no Save/Cancel/dirty-tracking** (faithful to the TS). Each control is a computed `Binding` that reads from `env.settings?.settings` and writes a small typed `Encodable` partial patch. Two new lazily-loaded view models supply dialog data: `ModelListViewModel` (cursor/opencode/pi model lists — also consumed by the retrofitted 5A Cursor/OpenCode/Pi fragments) and `SettingsCatalogViewModel` (shells, runtimes, system editors, agent availability, remote-agent status + start/stop). Theme selection persists into `AppSettings.appearance.theme`; a small `ThemeCatalogViewModel` fetches `theme:list` for the grid, and activation drives the existing `ThemeStore.select(id:)` (live restyle) **for bundled themes only** — imported/custom theme live-apply is deferred (see Scope Decisions). The six per-agent default tabs reuse the Phase-5A `*OptionsView` fragments in `.defaults` mode. Pure logic (patch encoders, VM reducers, model-cache) is TDD'd; views are verified by `swift build` + human dogfood.

**Tech Stack:** Swift 6, SwiftUI, `@Observable`/`@MainActor` view models, XCTest. `NSOpenPanel` (data-folder picker), `NSFontManager.shared.availableFontFamilies` (font enumeration). Backend reached over the existing `WSClient` — all needed `MessageType` cases already generated (`settingsGet/Update/GetDataDir/UpdateDataDir`, `shellsList`, `runtimesList`, `systemInfo`, `agentsList`, `cursorModels`, `opencodeModels`, `piModels`, `themeList`, `remoteAgentStart/Stop/Status/StatusChanged`).

## Global Constraints

Copied verbatim from the project conventions (`CLAUDE.md`) and the Phase-5A/5B/5C/5D execution lessons. **Every task implicitly includes this section.**

- **Build tool:** run `swift build` / `swift test` from the `native/` directory. Use `bun` (never `npm`/`yarn`) for any TS/codegen command. **No codegen is needed** in this phase — all required generated types already exist (`SettingsTypes.swift`, `SystemTypes.swift`, `WsTypes.swift`, `AgentTypes.swift`, `ThemeTypes.swift`, `MessageType.swift`).
- **No `as any` / no force casts of domain types**; pursue proper typing. **No `AnyCodable`** in new code except where you must read a generated field that is already typed `AnyCodable` (`ClaudeSettings.defaultEffort`, `ClaudeSettings.permissionMode`) — decode those via the established pattern `if case .string(let raw) = field.value { … }` (precedent: `UI/Flows/AgentOptionsFormModel.swift:164`) and write them back as plain `String` in the patch (the backend accepts the string form).
- **No new domain types.** Reuse generated structs/enums (`AppSettings` + its sub-structs `GeneralSettings`/`EditorSettings`/`TerminalSettings`/`ClaudeSettings`/`CodexSettings`/`OpenCodeSettings`/`GeminiSettings`/`CursorSettings`/`PiSettings`/`AppearanceSettings`/`RemoteAgentSettings`, `EditorInfo`, `SystemInfo`, `ShellInfo`/`ShellListResponse`, `RuntimeInfo`/`RuntimeListResponse`, `AgentAvailability`/`AgentListResponse`, `CursorModel`/`CursorModelsResponse`, `OpenCodeModelInfo`/`OpenCodeModelsResponse`, `PiModelInfo`/`PiModelsResponse`, `ThemeRecord`/`ThemeSource`/`ThemeColors`/`AnsiColors`/`ThemeOrigin`/`ThemeListResponse`, `RemoteAgentStatusPayload`, the agent enums `ClaudePermissionMode`/`ClaudeEffortLevel`/`CodexSandboxMode`/`CodexApprovalPolicy`/`PiThinkingLevel`/`AgentType`/`SessionType`). Only **UI-local** helper types may be hand-authored: the `Encodable` settings-patch structs (`SettingsPatch` + group patches + `FontResetPatch`) and per-VM state bags. Mirror the existing precedent (`AppShell`'s private `LayoutWidthPatch: Encodable`).
- **Don't export/widen visibility until necessary.** Everything `internal` or `private`; no `public`. If a symbol is never referenced outside its file, keep it `private`.
- **Pure static helpers must be `nonisolated`** — Swift 6 infers `@MainActor` on `View` and view-model members, so any pure function called from a test or non-isolated context must be `nonisolated static`. (Historical first hit: `AppSelect.label`.)
- **No disabling SwiftLint/eslint rules** — find the proper fix.
- **Env-injection convention** (re-confirmed 5B/5C/5D): views use `@Environment(AppEnvironment.self) private var env` (NOT a key-path) and `@Environment(\.appTheme) private var theme`. On `AppEnvironment`: `env.ui` and `env.taskCreation` are **non-optional**; `env.tasks / projects / session / flows / search / files / settings / notifications / runMenu / diff / schedules` (and the two new `env.models` / `env.settingsCatalog` / `env.themeCatalog`) are **OPTIONAL**. `env.session` is singular. `env.themeStore` is a non-optional `@ObservationIgnored let`.
- **When adding a client-dependent VM to `AppEnvironment`, update BOTH `AppEnvironmentTests` guards** — `testClientDependentVMsAreNilBeforeCompose` (nil pre-compose) and `testComposeSetsAllVMs` (non-nil post-compose). If the VM gets a WS subscription, call its `bind()` in `compose`; if it gets a cross-store closure, also update `testCrossDepClosuresAreWired`.
- **Grep the generated-type fields + real VM/primitive signatures before writing any call site.** Verified-good signatures for this phase:
  - `AppSelect(_ selection: Binding<Value>, options: [(value: Value, label: String)])` — `Value: Hashable`. (tag type == selection type == Value).
  - `AppTextField(text: Binding<String>, placeholder: String = "Type here...")`.
  - `AppButton(title: String, kind: AppButton.Kind = .primary, action: @escaping () -> Void)`; `Kind { primary, secondary, destructive }`.
  - `AppToggle(title: String, isOn: Binding<Bool>)`.
  - `SettingRow(label: String, hint: String? = nil, @ViewBuilder trailing: () -> Trailing)`.
  - `AppSegmentedTabs(selection: Binding<Int>, titles: [String])` (use for sub-tab strips if useful; the dialog sidebar nav is a custom `VStack` of buttons — see Task 7).
  - `WSClient.request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res`; `WSClient.on<E: Decodable>(_ type: MessageType, _ handler: @escaping (E) -> Void) -> () -> Void`.
  - `SettingsViewModel.updateSettings<T: Encodable>(_ patch: T) async`; `SettingsViewModel.load() async`; `SettingsViewModel.fetchDataDir() async`; `SettingsViewModel.updateDataDir(path: String, mode: DataDirMode? = nil) async throws -> DataDirInfo`; `SettingsViewModel.settings: AppSettings?` and `.dataDirInfo: DataDirInfo?` (both `private(set)`); local types `DataDirInfo { dataDir, baseDir, isDefault, conflict? }`, `enum DataDirMode { overwrite, adopt }`.
  - The six Phase-5A fragment signatures are listed in Task 10/11. **Re-grep anything not in this list before using it.**
- **Theme:** color via `theme.color(.token)` or the named accessors used by existing files (`theme.foreground`, `theme.background`, `theme.border`, `theme.muted`, `theme.accent`, `theme.primary`, `theme.destructive`). For ThemeCard preview/swatches use the **`ThemeRecord.source.colors`** values (`ThemeColors.background/foreground/ansi.green/...`) parsed through the existing `Color(hex:)` initializer. Reuse tokens that already resolve.
- **Persisted-settings binding pattern (THE core pattern of this phase):** every control is `Binding(get: { read from env.settings?.settings }, set: { Task { await env.settings?.updateSettings(SettingsPatch(group: GroupPatch(field: $0))) } })`. The `updateSettings` call returns the merged `AppSettings` and the VM stores it, re-rendering the dialog. Patches omit-nil (synthesized `Encodable` uses `encodeIfPresent`), so a patch carrying one field updates only that field. The one **explicit-null** case is the Fonts "Reset to defaults" (Task 15) — handled by the dedicated `FontResetPatch` with a custom `encode(to:)` calling `encodeNil(forKey:)` (Task 1). **Do NOT override `encode(to:)` on any generated type** (5D lesson — it corrupts other callers); `FontResetPatch` is a UI-local type, so its custom encoder is scoped.
- **`crypto.randomUUID()` → `UUID().uuidString`.** `Date.now()` → `ISO8601DateFormatter().string(from: Date())` (grep `ISO8601` first; no timestamps are expected in this phase).
- **Commit style:** do NOT add `Co-Authored-By`. One commit per task, conventional-commit subject (`feat(native): 5E …` / `refactor(native): 5E …`). After each commit, run `taskflow-cli log commit "<subject>" --hash <hash>` and `taskflow-cli log file "<path>"` for each new/edited file (paths relative to repo root).
- **SDD reports are scratch:** if a `docs(sdd)` report file gets committed accidentally, drop it with `git reset` to keep source-only history.
- **Faithful-port rule:** match the TS source 1:1 in behavior; cite the TS file in a doc comment on each new type/view, as existing native files do.

## Scope Decisions (READ FIRST)

These boundaries are deliberate (product-owner confirmed 2026-06-30) and mirror how prior sub-plans split scope:

- **IN 5E:**
  - **Settings dialog** (`UIViewModel.settingsOpen`): sidebar nav + content router; tabs **General** (Data Folder display + Change via `NSOpenPanel` + conflict `AlertDialog` + reset; Ask-before-exit toggle), **Defaults** (internal/external editor, default agent, toolbar agents, default shell, default runtime), **Claude / Codex / OpenCode / Gemini / Cursor / Pi** (the 5A fragments in `.defaults` mode, settings-bound), **Remote Agent** (conditional on Claude availability; auto-start / app-name / headless + start/stop status).
  - **Appearance dialog** (`UIViewModel.appearanceOpen`): sidebar nav with **Themes** (grid of bundled-theme cards, live activate + persist) and **Fonts** (Workspace/Terminal/Editor family + size + reset). Both dialogs mounted as `.sheet`s in `AppShell` driven by the existing `UIViewModel` flags.
  - **Fetched-model dropdowns** (`cursor:`/`opencode:`/`pi:models`): `ModelListViewModel` + three select views, **retrofitted into the 5A `CursorOptionsView`/`OpenCodeOptionsView`/`PiOptionsView` fragments** (binding-signature-preserving, so the 5D ActionEditor/ScheduleForm consumers are untouched). Degrade to the existing `AppTextField` on fetch failure/empty.
  - `SettingsCatalogViewModel`, `ThemeCatalogViewModel`, both wired into `AppEnvironment`.
- **DEFERRED — theme import (product-owner decision 2026-06-30):** the Appearance **"Import theme"** sub-tab (`theme:import-scan` / `theme:import` / `theme:import-file`), custom-theme **delete** (`theme:delete`), and **live-apply of imported/custom themes**. Reason: the generated `CssVariables` struct is **empty** (codegen could not emit the TS string-keyed CSS-var map), so the wire `ResolvedTheme.css` carries nothing the native `AppTheme` can consume — imported themes have no live-applicable css map. Bundled themes are unaffected (they live-apply from `Resources/themes/*.json`). Full import requires porting the TS `deriveTheme(ThemeColors) → CssVariables` derivation into native and routing it through the live-theming path — which is an explicit **Phase-6 unified-theming audit** concern. The Appearance dialog's nav shows **Themes + Fonts only** (no Import item). Document this as the headline 5E deferral in the results spec, with the deriveTheme/codegen follow-up.
- **DEFERRED — agent model `mode: .session` upgrade:** the retrofitted fetched-select is wired for the settings `.defaults` use; the `.session` callers (flow/schedule editors) keep working via the same binding (the select falls back to text when no models load). No behavior change required there.
- **`pi`/agent ordering:** Settings agent tabs order = `claude, codex, opencode, gemini, cursor, pi` (TS `navItems`). Default Agent select offers `ALL_AGENT_TYPES` via `AGENT_DISPLAY_NAMES`. Remote tab is appended **only if** Claude is available (`SettingsCatalogViewModel.isAvailable(.claude)`).

## File Structure

New files (all under `native/Sources/Taskflow/` unless noted):

| File | Responsibility |
|---|---|
| `UI/Settings/SettingsPatches.swift` | UI-local `Encodable` partials: `SettingsPatch` + `GeneralPatch`/`EditorPatch`/`TerminalPatch`/`ClaudePatch`/`CodexPatch`/`OpenCodePatch`/`GeminiPatch`/`CursorPatch`/`PiPatch`/`RemoteAgentPatch`/`AppearancePatch` (all-optional, omit-nil) + `FontResetPatch` (custom `encode(to:)` emitting explicit nulls for the six font fields). Port of `SettingsUpdatePayload` usage in `settings-store.ts`. |
| `ViewModels/ModelListViewModel.swift` | `@MainActor @Observable`. Lazy fetch + in-memory cache of cursor/opencode/pi models; per-agent `loading`/`failed` flags. `func cursorModels() async`, `opencodeModels()`, `piModels()`; `private(set)` arrays + flags; `nonisolated static` apply reducers. Port of the three `*ModelSelect.tsx` fetch logic. |
| `ViewModels/SettingsCatalogViewModel.swift` | `@MainActor @Observable`. Lazy fetch of `shells:list`, `runtimes:list`, `system:info` (editors), `agents:list`; remote-agent `running` state with `start()`/`stop()`/`refreshRemoteStatus()` + `bind()` on `.remoteAgentStatusChanged`. `func loadCatalog() async` (parallel fetch on dialog open). |
| `ViewModels/ThemeCatalogViewModel.swift` | `@MainActor @Observable`. `func load() async` → `theme:list` into `private(set) var themes: [ThemeRecord]` (filtered to `.bundled` for activation); `activeThemeId` derived from `env.settings`; `func activate(_ id:)` → `themeStore.select(id:)` + persist `AppearancePatch(theme:)`. |
| `UI/Settings/SettingsModelSelect.swift` | Three views `CursorModelSelect`/`OpenCodeModelSelect`/`PiModelSelect` (one file). Each: lazy-fetch via `env.models` on first appear, render `AppSelect` of fetched models, fall back to `AppTextField` on `failed`/empty. Port of `*ModelSelect.tsx`. |
| `UI/Settings/FontFamilySelect.swift` | `NSFontManager.shared.availableFontFamilies` → searchable `AppSelect`/menu; fallback `AppTextField` if enumeration empty. Port of `FontFamilySelect.tsx` (`queryLocalFonts` → AppKit). |
| `UI/Settings/SettingsDialog.swift` | The Settings modal shell: 148pt sidebar nav (9 items, Remote conditional) + content router + chrome (title, close). Mounted `.sheet` on `settingsOpen`. Triggers `env.settings?.fetchDataDir()` + `env.settingsCatalog?.loadCatalog()` on open. |
| `UI/Settings/GeneralSection.swift` | Data Folder (display + Change `NSOpenPanel` + conflict `AlertDialog` + reset) + Ask-before-exit. |
| `UI/Settings/DefaultsSection.swift` | Internal/External editor, Default Agent, Toolbar Agents, Default Shell, Default Runtime. |
| `UI/Settings/AgentDefaultsSection.swift` | `AgentDefaultsSection(agent: AgentType)` — switch to the matching 5A fragment in `.defaults` mode with settings-bound bindings + group patches (covers all six agents). |
| `UI/Settings/RemoteSection.swift` | Auto-start / App Name / Headless + remote start/stop status. |
| `UI/Appearance/AppearanceDialog.swift` | The Appearance modal shell: sidebar nav (Themes, Fonts) + content router + chrome. Mounted `.sheet` on `appearanceOpen`. Triggers `env.themeCatalog?.load()` on open. |
| `UI/Appearance/ThemeGrid.swift` | `LazyVGrid` (3 cols) of `ThemeCard`; reads `env.themeCatalog`. |
| `UI/Appearance/ThemeCard.swift` | One theme card: preview pane + 6 ansi swatches + name + active border; tap → `themeCatalog.activate(id)`. |
| `UI/Appearance/FontsTab.swift` | Three font sections (Workspace=`general`, Terminal, Editor) each `FontFamilySelect` + size `AppTextField` (8–32, int-validated); "Reset to defaults" → `FontResetPatch`. |
| `Tests/TaskflowTests/SettingsPatchesTests.swift` | TDD: omit-nil for normal patches; explicit-null JSON for `FontResetPatch`. |
| `Tests/TaskflowTests/ModelListViewModelTests.swift` | TDD: apply reducers + failed/loading transitions. |
| `Tests/TaskflowTests/SettingsCatalogViewModelTests.swift` | TDD: `isAvailable`, remote-status apply reducer. |
| `Tests/TaskflowTests/ThemeCatalogViewModelTests.swift` | TDD: bundled filter + active-id resolution reducer. |

Modified files:

| File | Change |
|---|---|
| `App/AppEnvironment.swift` | Add `models: ModelListViewModel?`, `settingsCatalog: SettingsCatalogViewModel?`, `themeCatalog: ThemeCatalogViewModel?` (construct + assign in `compose`; `bind()` the catalog's remote-status subscription; **no boot-load** — all three lazy on dialog open). After `settings.load()` in `boot()`, apply the persisted theme: `themeStore.select(id: settings.settings.appearance.theme)`. |
| `Tests/TaskflowTests/AppEnvironmentTests.swift` | Add `models`, `settingsCatalog`, `themeCatalog` to both nil-before / non-nil-after guards. |
| `UI/AgentOptions/CursorOptionsView.swift` | Swap the model `AppTextField` for `CursorModelSelect` (binding-preserving). |
| `UI/AgentOptions/OpenCodeOptionsView.swift` | Swap the model `AppTextField` for `OpenCodeModelSelect`. |
| `UI/AgentOptions/PiOptionsView.swift` | Swap the model `AppTextField` for `PiModelSelect`. |
| `UI/Shell/AppShell.swift` | Attach two `.sheet`s: `settingsOpen → SettingsDialog`, `appearanceOpen → AppearanceDialog`. |

---

## Task 1: SettingsPatches (typed Encodable partials + FontResetPatch)

Pure encoding types — the persistence vocabulary for every control. TDD'd on JSON output: normal patches **omit** nil fields (synthesized `encodeIfPresent`); `FontResetPatch` emits **explicit null** for the six font fields (the only clear-semantics case in 5E — mirrors the 5D schedule-clear finding, scoped to a UI-local type, NOT a generated-type `encode(to:)` override).

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/SettingsPatches.swift`
- Create: `native/Tests/TaskflowTests/SettingsPatchesTests.swift`

**Interfaces:**
- Consumes: generated enums `AgentType`, `CodexSandboxMode`, `CodexApprovalPolicy`, `PiThinkingLevel` (all `RawRepresentable`, encode as their string raw).
- Produces: `struct SettingsPatch: Encodable` with all-optional group members; group patch structs; `struct FontResetPatch: Encodable` (custom encoder).

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

final class SettingsPatchesTests: XCTestCase {
    private func json<T: Encodable>(_ v: T) throws -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return String(data: try enc.encode(v), encoding: .utf8)!
    }

    func testSingleFieldPatchOmitsNilSiblings() throws {
        let patch = SettingsPatch(general: GeneralPatch(confirmBeforeExit: true))
        XCTAssertEqual(try json(patch), #"{"general":{"confirmBeforeExit":true}}"#)
    }

    func testEnumFieldEncodesRawString() throws {
        let patch = SettingsPatch(codex: CodexPatch(sandbox: .workspaceWrite))
        XCTAssertEqual(try json(patch), #"{"codex":{"sandbox":"workspace-write"}}"#)
    }

    func testAppearanceThemePatch() throws {
        let patch = SettingsPatch(appearance: AppearancePatch(theme: "dracula"))
        XCTAssertEqual(try json(patch), #"{"appearance":{"theme":"dracula"}}"#)
    }

    func testFontResetEmitsExplicitNulls() throws {
        // reset must send null (not omit) so the backend re-expands to defaults
        let s = try json(FontResetPatch())
        XCTAssertTrue(s.contains(#""fontFamily":null"#))
        XCTAssertTrue(s.contains(#""fontSize":null"#))
        // covers general + terminal + editor
        XCTAssertTrue(s.contains(#""general":"#))
        XCTAssertTrue(s.contains(#""terminal":"#))
        XCTAssertTrue(s.contains(#""editor":"#))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter SettingsPatchesTests`
Expected: FAIL — types not found.

- [ ] **Step 3: Write minimal implementation**

```swift
// UI-local Encodable partials mirroring packages/shared SettingsUpdatePayload usage
// in packages/ui/src/stores/settings-store.ts. Synthesized Encodable omits nil
// (encodeIfPresent) so a patch carrying one field updates only that field.

struct GeneralPatch: Encodable {
    var fontFamily: String?
    var fontSize: Double?
    var defaultAgent: AgentType?
    var defaultRuntime: String?
    var favoriteAgents: [AgentType]?
    var confirmBeforeExit: Bool?
}
struct EditorPatch: Encodable {
    var fontFamily: String?
    var fontSize: Double?
    var wordWrap: Bool?
    var internalEditor: String?
    var externalEditor: String?
}
struct TerminalPatch: Encodable {
    var fontFamily: String?
    var fontSize: Double?
    var defaultShell: String?
}
struct ClaudePatch: Encodable {
    var defaultModel: String?
    var defaultEffort: String?       // written as the string form ("default"/"high"/…)
    var dangerouslySkipPermissions: Bool?
    var permissionMode: String?
}
struct CodexPatch: Encodable {
    var defaultModel: String?
    var sandbox: CodexSandboxMode?
    var approvalPolicy: CodexApprovalPolicy?
    var fullAuto: Bool?
}
struct OpenCodePatch: Encodable {
    var defaultModel: String?
    var defaultVariant: String?
    var autoApprove: Bool?
}
struct GeminiPatch: Encodable {
    var defaultModel: String?
    var approvalMode: String?
    var sandbox: Bool?
}
struct CursorPatch: Encodable {
    var defaultModel: String?
    var yolo: Bool?
}
struct PiPatch: Encodable {
    var defaultModel: String?
    var thinking: PiThinkingLevel?
    var tools: String?
}
struct RemoteAgentPatch: Encodable {
    var autoStart: Bool?
    var appName: String?
    var headless: Bool?
}
struct AppearancePatch: Encodable {
    var theme: String?
}

struct SettingsPatch: Encodable {
    var general: GeneralPatch?
    var editor: EditorPatch?
    var terminal: TerminalPatch?
    var claude: ClaudePatch?
    var codex: CodexPatch?
    var opencode: OpenCodePatch?
    var gemini: GeminiPatch?
    var cursor: CursorPatch?
    var pi: PiPatch?
    var remoteAgent: RemoteAgentPatch?
    var appearance: AppearancePatch?
}

// Fonts "Reset to defaults" sends explicit nulls; the backend re-expands nulls to
// DEFAULTS (packages/backend/src/services/settings-store.ts applyNullable).
// Scoped custom encoder — do NOT override encode(to:) on a generated type.
struct FontResetPatch: Encodable {
    private struct FontNulls: Encodable {
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: K.self)
            try c.encodeNil(forKey: .fontFamily)
            try c.encodeNil(forKey: .fontSize)
        }
        enum K: String, CodingKey { case fontFamily, fontSize }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(FontNulls(), forKey: .general)
        try c.encode(FontNulls(), forKey: .terminal)
        try c.encode(FontNulls(), forKey: .editor)
    }
    enum K: String, CodingKey { case general, terminal, editor }
}
```

> Verify `CodexSandboxMode.workspaceWrite.rawValue == "workspace-write"` (it does — `case workspaceWrite = "workspace-write"`). `SettingsPatch` and all group patches use memberwise inits (structs), so `GeneralPatch(confirmBeforeExit: true)` works only if every other field has a default — give each stored property a `= nil` default OR rely on Swift's memberwise init requiring all args. **Add `= nil` defaults to every field** so call sites can pass just one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter SettingsPatchesTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/SettingsPatches.swift native/Tests/TaskflowTests/SettingsPatchesTests.swift
git commit -m "feat(native): 5E settings patch encoders + font-reset explicit-null"
```
Then log via `taskflow-cli`.

---

## Task 2: ModelListViewModel (lazy fetch + cache for cursor/opencode/pi)

Port of the lazy-fetch logic shared by `CursorModelSelect.tsx`/`OpenCodeModelSelect.tsx`/`PiModelSelect.tsx`: fetch once on first open, cache in memory, set a `failed` flag on error (drives the text-input fallback). Reducers TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/ModelListViewModel.swift`
- Create: `native/Tests/TaskflowTests/ModelListViewModelTests.swift`
- Modify: `App/AppEnvironment.swift`, `Tests/TaskflowTests/AppEnvironmentTests.swift`

**Interfaces:**
- Consumes: `WSClient`; generated `CursorModel`/`CursorModelsResponse`, `OpenCodeModelInfo`/`OpenCodeModelsResponse`, `PiModelInfo`/`PiModelsResponse`; `MessageType.cursorModels`/`.opencodeModels`/`.piModels`.
- Produces:
  - `@MainActor @Observable final class ModelListViewModel`
  - `private(set) var cursor: [CursorModel]`, `opencode: [OpenCodeModelInfo]`, `pi: [PiModelInfo]`
  - `private(set) var cursorFailed/opencodeFailed/piFailed: Bool`, `…Loaded: Bool`, `…Loading: Bool`
  - `func ensureCursor() async`, `ensureOpenCode() async`, `ensurePi() async` (idempotent: no-op if already loaded/loading)
  - `nonisolated static func applyCursor(_ response: CursorModelsResponse) -> [CursorModel]` (etc. — trivial passthrough, but TDD'd to lock the field path)

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class ModelListViewModelTests: XCTestCase {
    func testApplyCursorMapsModels() {
        let out = ModelListViewModel.applyCursor(CursorModelsResponse(models: [CursorModel(id: "gpt-5", label: "GPT-5")]))
        XCTAssertEqual(out.first?.id, "gpt-5")
        XCTAssertEqual(out.first?.label, "GPT-5")
    }
    func testApplyPiMapsModels() {
        let out = ModelListViewModel.applyPi(PiModelsResponse(models: [
            PiModelInfo(provider: "anthropic", id: "opus", contextWindow: "200k", maxOutput: "64k", supportsThinking: true, supportsImages: false)
        ]))
        XCTAssertEqual(out.first.map { "\($0.provider)/\($0.id)" }, "anthropic/opus")
    }
    func testInitialStateNotLoaded() {
        let vm = ModelListViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        XCTAssertFalse(vm.cursorLoaded)
        XCTAssertFalse(vm.cursorFailed)
        XCTAssertTrue(vm.cursor.isEmpty)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter ModelListViewModelTests`
Expected: FAIL — type not found.

- [ ] **Step 3: Write minimal implementation**

```swift
// Lazy fetch + in-memory cache of agent model lists. Port of the per-popover fetch in
// packages/ui/src/components/settings/{Cursor,OpenCode,Pi}ModelSelect.tsx — fetch once,
// cache, set `failed` on error to drive the text-input fallback. No server-side caching.
@MainActor @Observable
final class ModelListViewModel {
    private(set) var cursor: [CursorModel] = []
    private(set) var opencode: [OpenCodeModelInfo] = []
    private(set) var pi: [PiModelInfo] = []
    private(set) var cursorLoaded = false, opencodeLoaded = false, piLoaded = false
    private(set) var cursorLoading = false, opencodeLoading = false, piLoading = false
    private(set) var cursorFailed = false, opencodeFailed = false, piFailed = false

    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    nonisolated static func applyCursor(_ r: CursorModelsResponse) -> [CursorModel] { r.models }
    nonisolated static func applyOpenCode(_ r: OpenCodeModelsResponse) -> [OpenCodeModelInfo] { r.models }
    nonisolated static func applyPi(_ r: PiModelsResponse) -> [PiModelInfo] { r.models }

    func ensureCursor() async {
        guard !cursorLoaded, !cursorLoading else { return }
        cursorLoading = true
        defer { cursorLoading = false; cursorLoaded = true }
        do {
            let r: CursorModelsResponse = try await client.request(.cursorModels, payload: [:])
            cursor = Self.applyCursor(r); cursorFailed = cursor.isEmpty
        } catch { cursorFailed = true }
    }
    // ensureOpenCode / ensurePi: same shape with .opencodeModels / .piModels
}
```

> The TS treats an empty model list the same as a failure (renders the text fallback). Set `…Failed = models.isEmpty` on success, `true` on throw. `ensure*` is idempotent so views can call it on every `.task`/appear.

AppEnvironment wiring (`compose`): `let modelsVM = ModelListViewModel(client: client)` → `self.models = modelsVM`. No `bind()`, no boot-load. Add `private(set) var models: ModelListViewModel?` to the env. Update both `AppEnvironmentTests` guards (`XCTAssertNil(env.models)` before; `XCTAssertNotNil(env.models)` after).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter ModelListViewModelTests` then `swift test --filter AppEnvironmentTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/ViewModels/ModelListViewModel.swift native/Tests/TaskflowTests/ModelListViewModelTests.swift native/Sources/Taskflow/App/AppEnvironment.swift native/Tests/TaskflowTests/AppEnvironmentTests.swift
git commit -m "feat(native): 5E ModelListViewModel + AppEnvironment wiring"
```
Then log via `taskflow-cli`.

---

## Task 3: SettingsModelSelect views (Cursor/OpenCode/Pi fetched dropdowns)

Three views that drive the `ModelListViewModel` and render a fetched `AppSelect`, degrading to `AppTextField` when the list failed/empty. Build + dogfood verified.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/SettingsModelSelect.swift`

**Interfaces:**
- Consumes: `env.models` (`ModelListViewModel`), `AppSelect`, `AppTextField`.
- Produces:
  - `struct CursorModelSelect: View { @Binding var value: String }` — synthetic top "Default" option; empty/`"default"` ⇄ "Default"; selecting writes `"default"` when cleared.
  - `struct OpenCodeModelSelect: View { @Binding var value: String }` — shows `id`; allows custom value via the text fallback.
  - `struct PiModelSelect: View { @Binding var value: String }` — option key `"\(provider)/\(id)"`.

- [ ] **Step 1: Build the views (no unit test — view layer)**

```swift
// Fetched model dropdowns. Port of packages/ui/src/components/settings/*ModelSelect.tsx.
// Lazy-fetch on appear via env.models; AppSelect when models load, AppTextField fallback.
struct CursorModelSelect: View {
    @Binding var value: String
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if let models = env.models, models.cursorLoaded, !models.cursorFailed {
                AppSelect(
                    Binding(get: { value.isEmpty ? "default" : value },
                            set: { value = ($0 == "default") ? "default" : $0 }),
                    options: [(value: "default", label: "Default")]
                        + models.cursor.map { (value: $0.id, label: $0.label) }
                )
            } else {
                AppTextField(text: $value, placeholder: "default")
            }
        }
        .task { await env.models?.ensureCursor() }
    }
}
// OpenCodeModelSelect: options = models.opencode.map { (value: $0.id, label: $0.id) },
//   fallback placeholder "e.g. anthropic/claude-sonnet-4-20250514", ensureOpenCode().
// PiModelSelect: options = models.pi.map { (value: "\($0.provider)/\($0.id)", label: "\($0.provider)/\($0.id)") },
//   fallback placeholder "e.g. anthropic/claude-sonnet-4.5", ensurePi().
```

> The TS supports typing a custom value (Enter) in the OpenCode/Pi selects; `AppSelect` is a fixed menu, so the **text fallback is the custom-value path**. That's acceptable for 5E (the fallback shows whenever models didn't load); note it in the results spec as a minor parity gap (no inline custom-value entry while a populated menu is shown).

- [ ] **Step 2: Verify it compiles**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/SettingsModelSelect.swift
git commit -m "feat(native): 5E fetched model select views (cursor/opencode/pi)"
```
Then log via `taskflow-cli`.

---

## Task 4: Retrofit 5A Cursor/OpenCode/Pi fragments to use the fetched selects

Swap the model `AppTextField` inside the three fragments for the matching `*ModelSelect`, **preserving each fragment's `Binding<String>` signature** so the 5D ActionEditor/InlineActionEditor/ScheduleForm consumers compile unchanged.

**Files:**
- Modify: `UI/AgentOptions/CursorOptionsView.swift`, `UI/AgentOptions/OpenCodeOptionsView.swift`, `UI/AgentOptions/PiOptionsView.swift`

**Interfaces:**
- Consumes: `CursorModelSelect`/`OpenCodeModelSelect`/`PiModelSelect` (Task 3).
- Produces: unchanged public signatures (`model: Binding<String>`, etc.).

- [ ] **Step 1: Locate the model SettingRow in each fragment**

In `CursorOptionsView.swift`, find the `SettingRow(label: …) { AppTextField(text: $model, …) }` for the model field. Replace its trailing with `CursorModelSelect(value: $model)`. Keep the `mode`-aware label. Same for OpenCode (`OpenCodeModelSelect(value: $model)`) and Pi (`PiModelSelect(value: $model)`).

- [ ] **Step 2: Verify build + existing tests unaffected**

Run: `cd native && swift build && swift test --filter AgentOptionsFormModelTests`
Expected: builds; the form-model tests still pass (bindings unchanged).

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/AgentOptions/CursorOptionsView.swift native/Sources/Taskflow/UI/AgentOptions/OpenCodeOptionsView.swift native/Sources/Taskflow/UI/AgentOptions/PiOptionsView.swift
git commit -m "refactor(native): 5E retrofit fetched model selects into 5A fragments"
```
Then log via `taskflow-cli`.

---

## Task 5: SettingsCatalogViewModel (shells/runtimes/editors/agents + remote status)

Supplies the Defaults + Remote tabs. Lazy parallel fetch on dialog open; remote-agent status is live (`bind()` on `.remoteAgentStatusChanged`) with `start()`/`stop()`. Reducers TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/SettingsCatalogViewModel.swift`
- Create: `native/Tests/TaskflowTests/SettingsCatalogViewModelTests.swift`
- Modify: `App/AppEnvironment.swift`, `Tests/TaskflowTests/AppEnvironmentTests.swift`

**Interfaces:**
- Consumes: `WSClient`; `ShellListResponse`/`ShellInfo`, `RuntimeListResponse`/`RuntimeInfo`, `SystemInfo`/`EditorInfo`, `AgentListResponse`/`AgentAvailability`, `RemoteAgentStatusPayload`; `MessageType.shellsList`/`.runtimesList`/`.systemInfo`/`.agentsList`/`.remoteAgentStart`/`.remoteAgentStop`/`.remoteAgentStatus`/`.remoteAgentStatusChanged`.
- Produces:
  - `@MainActor @Observable final class SettingsCatalogViewModel`
  - `private(set) var shells: [ShellInfo]`, `systemShellPath: String?`, `runtimes: [RuntimeInfo]`, `editors: [EditorInfo]`, `agents: [AgentAvailability]`, `remoteRunning: Bool`
  - `func loadCatalog() async` (parallel fetch, each best-effort); `func refreshRemoteStatus() async`; `func startRemote() async`; `func stopRemote() async`; `func bind()`
  - `nonisolated static func isAvailable(_ agent: AgentType, in agents: [AgentAvailability]) -> Bool`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class SettingsCatalogViewModelTests: XCTestCase {
    func testIsAvailableTrueWhenPresentAndAvailable() {
        let agents = [AgentAvailability(type: .claude, available: true, path: "/x", version: "1")]
        XCTAssertTrue(SettingsCatalogViewModel.isAvailable(.claude, in: agents))
        XCTAssertFalse(SettingsCatalogViewModel.isAvailable(.codex, in: agents))
    }
    func testIsAvailableFalseWhenMarkedUnavailable() {
        let agents = [AgentAvailability(type: .claude, available: false, path: "", version: "")]
        XCTAssertFalse(SettingsCatalogViewModel.isAvailable(.claude, in: agents))
    }
    func testInitialRemoteNotRunning() {
        let vm = SettingsCatalogViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        XCTAssertFalse(vm.remoteRunning)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native && swift test --filter SettingsCatalogViewModelTests`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```swift
// Data sources for the Settings Defaults + Remote tabs. Port of SettingsModal's on-open
// fetches (shells:list, runtimes:list, system:info) + useRemoteAgentStatus().
@MainActor @Observable
final class SettingsCatalogViewModel {
    private(set) var shells: [ShellInfo] = []
    private(set) var systemShellPath: String?
    private(set) var runtimes: [RuntimeInfo] = []
    private(set) var editors: [EditorInfo] = []
    private(set) var agents: [AgentAvailability] = []
    private(set) var remoteRunning = false

    @ObservationIgnored private let client: WSClient
    @ObservationIgnored private var unsubscribe: (() -> Void)?
    init(client: WSClient) { self.client = client }

    nonisolated static func isAvailable(_ agent: AgentType, in agents: [AgentAvailability]) -> Bool {
        agents.first { $0.type == agent }?.available ?? false
    }
    func isAvailable(_ agent: AgentType) -> Bool { Self.isAvailable(agent, in: agents) }

    func loadCatalog() async {
        async let shellsR: ShellListResponse? = try? client.request(.shellsList, payload: [:])
        async let runtimesR: RuntimeListResponse? = try? client.request(.runtimesList, payload: [:])
        async let systemR: SystemInfo? = try? client.request(.systemInfo, payload: [:])
        async let agentsR: AgentListResponse? = try? client.request(.agentsList, payload: [:])
        if let r = await shellsR { shells = r.shells; systemShellPath = r.systemShellPath }
        if let r = await runtimesR { runtimes = r.runtimes }
        if let r = await systemR { editors = r.editors }
        if let r = await agentsR { agents = r.agents }
        await refreshRemoteStatus()
    }
    func refreshRemoteStatus() async {
        if let r: RemoteAgentStatusPayload = try? await client.request(.remoteAgentStatus, payload: [:]) {
            remoteRunning = r.running
        }
    }
    func startRemote() async { _ = try? await client.requestRaw(.remoteAgentStart, payload: [:]); await refreshRemoteStatus() }
    func stopRemote() async { _ = try? await client.requestRaw(.remoteAgentStop, payload: [:]); await refreshRemoteStatus() }

    func bind() {
        unsubscribe = client.on(.remoteAgentStatusChanged) { [weak self] (p: RemoteAgentStatusPayload) in
            Task { @MainActor in self?.remoteRunning = p.running }
        }
    }
}
```

> Grep `WSClient` for `requestRaw` (used by start/stop where no decoded response is needed) — if the only method is the generic `request`, decode into an empty/ignored `EmptyResponse` or reuse `RemoteAgentStatusPayload`. Confirm `.on` returns an unsubscribe closure (5B/5C precedent). AppEnvironment wiring: construct, `bind()`, assign to `self.settingsCatalog`; no boot-load. Update both `AppEnvironmentTests` guards.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native && swift test --filter SettingsCatalogViewModelTests` then `swift test --filter AppEnvironmentTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/ViewModels/SettingsCatalogViewModel.swift native/Tests/TaskflowTests/SettingsCatalogViewModelTests.swift native/Sources/Taskflow/App/AppEnvironment.swift native/Tests/TaskflowTests/AppEnvironmentTests.swift
git commit -m "feat(native): 5E SettingsCatalogViewModel (shells/runtimes/editors/agents/remote)"
```
Then log via `taskflow-cli`.

---

## Task 6: FontFamilySelect (NSFontManager-backed)

Port of `FontFamilySelect.tsx` (`window.queryLocalFonts()` → `NSFontManager.shared.availableFontFamilies`). A select over installed font families; text fallback if enumeration is empty.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/FontFamilySelect.swift`

**Interfaces:**
- Produces: `struct FontFamilySelect: View { @Binding var value: String }` — `nonisolated static func families() -> [String]` (sorted, deduped via `NSFontManager.shared.availableFontFamilies`).

- [ ] **Step 1: Build the view**

```swift
import AppKit
// Port of packages/ui/src/components/settings/FontFamilySelect.tsx.
// queryLocalFonts() -> NSFontManager.shared.availableFontFamilies.
struct FontFamilySelect: View {
    @Binding var value: String
    @State private var families: [String] = []

    var body: some View {
        Group {
            if families.isEmpty {
                AppTextField(text: $value, placeholder: "Font family")
            } else {
                AppSelect($value, options: families.map { (value: $0, label: $0) })
            }
        }
        .task { families = Self.families() }
    }
    nonisolated static func families() -> [String] {
        Array(Set(NSFontManager.shared.availableFontFamilies)).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}
```

> The TS value can be a CSS font stack (e.g. `'"JetBrains Mono", monospace'`) that won't equal any family name — so the bound `value` may not be in `families`. `AppSelect` tags must include the current value even if it's not a known family; if `AppSelect` drops unknown selections, prepend the current `value` as its own option when not already present. Verify `AppSelect`'s behavior with an out-of-list selection before finalizing; if it can't represent one, keep the text fallback whenever `!families.contains(value)`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/FontFamilySelect.swift
git commit -m "feat(native): 5E FontFamilySelect (NSFontManager)"
```
Then log via `taskflow-cli`.

---

## Task 7: SettingsDialog shell + mount sheet

The Settings modal: a 148pt left sidebar nav (9 items, Remote conditional) + right content router + chrome. Empty section bodies for now (filled Tasks 8–12). Mounted as a `.sheet` on `settingsOpen`; on open it kicks the data-dir + catalog fetches.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/SettingsDialog.swift`
- Modify: `UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `env.settings`, `env.settingsCatalog`, `AppButton`, `AppIcon`.
- Produces: `struct SettingsDialog: View`; a `private enum SettingsSection: String, CaseIterable { case general, defaults, claude, codex, opencode, gemini, cursor, pi, remoteAgent }` with `title`.

- [ ] **Step 1: Build the shell**

```swift
// Port of packages/ui/src/components/settings/SettingsModal.tsx (chrome + nav).
struct SettingsDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme
    @State private var section: SettingsSection = .general

    private var sections: [SettingsSection] {
        var items = SettingsSection.allCases.filter { $0 != .remoteAgent }
        if env.settingsCatalog?.isAvailable(.claude) == true { items.append(.remoteAgent) }
        return items
    }

    var body: some View {
        HStack(spacing: 0) {
            // sidebar
            VStack(alignment: .leading, spacing: 2) {
                ForEach(sections, id: \.self) { s in
                    Button { section = s } label: {
                        Text(s.title)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(section == s ? theme.muted : .clear)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .frame(width: 148)
            .padding(8)
            Divider()
            // content
            ScrollView {
                content.padding(16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(width: 640, height: 460)
        .background(theme.background)
        .task {
            await env.settings?.fetchDataDir()
            await env.settingsCatalog?.loadCatalog()
        }
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .general: GeneralSection()
        case .defaults: DefaultsSection()
        case .claude: AgentDefaultsSection(agent: .claude)
        case .codex: AgentDefaultsSection(agent: .codex)
        case .opencode: AgentDefaultsSection(agent: .opencode)
        case .gemini: AgentDefaultsSection(agent: .gemini)
        case .cursor: AgentDefaultsSection(agent: .cursor)
        case .pi: AgentDefaultsSection(agent: .pi)
        case .remoteAgent: RemoteSection()
        }
    }
}

private enum SettingsSection: String, CaseIterable {
    case general, defaults, claude, codex, opencode, gemini, cursor, pi, remoteAgent
    var title: String {
        switch self {
        case .general: "General"; case .defaults: "Defaults"; case .claude: "Claude"
        case .codex: "Codex"; case .opencode: "OpenCode"; case .gemini: "Gemini"
        case .cursor: "Cursor"; case .pi: "Pi"; case .remoteAgent: "Remote Agent"
        }
    }
}
```

For Tasks 8–12 to compile incrementally, add **temporary empty stubs** for `GeneralSection`/`DefaultsSection`/`AgentDefaultsSection`/`RemoteSection` in this task (each `struct X: View { var body: some View { EmptyView() } }`), to be replaced by their real files in later tasks. (Mark them `// STUB — replaced in Task N`.)

- [ ] **Step 2: Mount the sheet in AppShell**

In `AppShell.swift`, beside the existing flow/schedule sheets:

```swift
.sheet(isPresented: Binding(
    get: { ui.settingsOpen },
    set: { env.ui.settingsOpen = $0 }
)) {
    SettingsDialog()
}
```

- [ ] **Step 3: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/SettingsDialog.swift native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): 5E SettingsDialog shell + nav + sheet mount"
```
Then log via `taskflow-cli`.

---

## Task 8: GeneralSection (Data Folder + Ask-before-exit)

Replaces the Task-7 `GeneralSection` stub. Data Folder display + **Change** (`NSOpenPanel` directory picker) + conflict `AlertDialog` (Overwrite/Use Existing) + **Reset** (to `baseDir`, shown only when not default); Ask-before-exit toggle.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/GeneralSection.swift` (delete the Task-7 stub)

**Interfaces:**
- Consumes: `env.settings` (`dataDirInfo`, `fetchDataDir`, `updateDataDir(path:mode:)`, `settings.general.confirmBeforeExit`, `updateSettings`), `SettingRow`, `AppButton`, `AppToggle`.

- [ ] **Step 1: Build the view**

Key behaviors (port of `GeneralSection.tsx` + `SettingsModal`'s conflict handling):
- Data folder path display: `env.settings?.dataDirInfo?.dataDir ?? "Loading..."` (monospace, truncated).
- **Change** `AppButton` → `NSOpenPanel` (`canChooseDirectories = true`, `canChooseFiles = false`); on pick, `do { let info = try await settings.updateDataDir(path: url.path); if info.conflict == true { conflictPath = url.path } } catch { migrationError = … }`. While awaiting, button label "Moving…".
- Conflict: when `conflictPath != nil`, show `.alert` "Existing Data Found" with **Overwrite** (`.destructive` → `updateDataDir(path: conflictPath!, mode: .overwrite)`), **Use Existing** (`updateDataDir(path:mode:.adopt)`), **Cancel**.
- **Reset** `AppButton` shown when `dataDirInfo != nil && dataDirInfo!.isDefault == false` → `updateDataDir(path: dataDirInfo!.baseDir)`.
- `migrationError` shown in `theme.destructive`; clears after 5s (use a `Task` sleep or `.task(id:)`).
- Ask-before-exit: `AppToggle(title: "Ask before exit", isOn: Binding(get: { settings.general.confirmBeforeExit }, set: { v in Task { await settings.updateSettings(SettingsPatch(general: GeneralPatch(confirmBeforeExit: v))) } }))` inside a `SettingRow` with the hint text.

```swift
import AppKit
struct GeneralSection: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme
    @State private var migrating = false
    @State private var conflictPath: String?
    @State private var migrationError: String?

    private func pickDirectory() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        return panel.runModal() == .OK ? panel.url : nil
    }
    // … body with SettingRows, Change/Reset AppButtons, .alert(conflict), AppToggle …
}
```

> Verify `updateDataDir` throws vs returns `.conflict` in the response — per the VM map it `@discardableResult`-returns `DataDirInfo` and the conflict is the `.conflict` field (it does NOT throw on conflict). Drive the alert off `info.conflict == true`. `NSOpenPanel.runModal()` is synchronous/main-actor — call it directly (not in a Task), then `await` the `updateDataDir`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/GeneralSection.swift native/Sources/Taskflow/UI/Settings/SettingsDialog.swift
git commit -m "feat(native): 5E GeneralSection (data folder + ask-before-exit)"
```
Then log via `taskflow-cli`.

---

## Task 9: DefaultsSection (editors / agent / toolbar agents / shell / runtime)

Replaces the Task-7 `DefaultsSection` stub. Six `SettingRow`s bound to settings via patches, options sourced from `env.settingsCatalog`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/DefaultsSection.swift` (delete stub)

**Interfaces:**
- Consumes: `env.settings`, `env.settingsCatalog` (`editors`, `shells`, `systemShellPath`, `runtimes`, `agents`), `SettingRow`, `AppSelect`, `AppToggle`, `AgentIcon`.

- [ ] **Step 1: Build the view** (port of `DefaultsSection.tsx`)

Rows (each a `SettingRow` with the exact hint strings from the TS map):
- **Internal Editor** → `AppSelect` over `[("monaco","Monaco")] + editors.filter { $0.type == "internal" }.map { ($0.id, $0.name) }`, bound to `settings.editor.internalEditor` via `EditorPatch(internalEditor:)`.
- **External Editor** → `[("system","System Default")] + editors.filter { $0.type == "external" }.map { ($0.id,$0.name) }`, bound to `settings.editor.externalEditor`.
- **Default Agent** → `AppSelect` over `AgentType.allCases.map { ($0, AGENT_DISPLAY_NAMES[$0]) }`, bound to `settings.general.defaultAgent` via `GeneralPatch(defaultAgent:)`. (Grep for the existing `AGENT_DISPLAY_NAMES` equivalent — likely `AgentIcon`/an agent-display map; if none exists, build a `nonisolated static` display-name map inline.) Append `" (not installed)"` to a label when `!catalog.isAvailable(agent)`.
- **Toolbar Agents** → for each available agent, an `AppToggle` (id `toolbar-agent-<agent>`) reflecting membership in `settings.general.favoriteAgents`; toggling writes the updated array via `GeneralPatch(favoriteAgents:)` (add/remove; default to all agents when the array is nil, matching TS `favoriteAgents ?? ALL_AGENT_TYPES`).
- **Default Shell** → `AppSelect` over `[("system", systemSummary)] + shells.map { ($0.path, $0.name) }`, bound to `settings.terminal.defaultShell` via `TerminalPatch(defaultShell:)`. (TS adds a disabled `"__missing__"` sentinel when the configured shell is absent — reproduce only if trivial; otherwise just show the value.)
- **Default Runtime** → `AppSelect` over `runtimes.map { ($0.name, "\($0.name) (\($0.version))") }`, bound to `settings.general.defaultRuntime` via `GeneralPatch(defaultRuntime:)`.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/DefaultsSection.swift native/Sources/Taskflow/UI/Settings/SettingsDialog.swift
git commit -m "feat(native): 5E DefaultsSection (editors/agent/shell/runtime)"
```
Then log via `taskflow-cli`.

---

## Task 10: AgentDefaultsSection (the six per-agent default tabs)

Replaces the Task-7 `AgentDefaultsSection` stub. One view, `AgentDefaultsSection(agent:)`, that renders the matching 5A fragment in `.defaults` mode with settings-bound bindings + group patches. Covers all six agents.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/AgentDefaultsSection.swift` (delete stub)

**Interfaces:**
- Consumes (5A fragment signatures — VERIFIED, re-grep `UI/AgentOptions/` if unsure; all also take `var mode: AgentOptionsMode = .session`, pass `mode: .defaults`):
  - `ClaudeOptionsView(model: Binding<String?>, effort: Binding<ClaudeEffortLevel?>, skipPermissions: Binding<Bool>, permissionMode: Binding<ClaudePermissionMode>, mode:)`
  - `CodexOptionsView(model: Binding<String>, fullAuto: Binding<Bool>, sandbox: Binding<CodexSandboxMode>, approvalPolicy: Binding<CodexApprovalPolicy>, mode:)`
  - `GeminiOptionsView(model: Binding<String>, approvalMode: Binding<String>, sandbox: Binding<Bool>, mode:)`
  - `CursorOptionsView(model: Binding<String>, yolo: Binding<Bool>, mode:)`
  - `OpenCodeOptionsView(model: Binding<String>, variant: Binding<String>, autoApprove: Binding<Bool>, mode:)`
  - `PiOptionsView(model: Binding<String>, thinking: Binding<PiThinkingLevel>, tools: Binding<String>, mode:)`
- Consumes: `env.settings` (read `settings.<agent>`, write group patches). AnyCodable decode for Claude `defaultEffort`/`permissionMode` via `if case .string(let raw) = field.value`.

- [ ] **Step 1: Build the view**

Each agent's body builds computed `Binding`s into `env.settings`. Pattern (Claude shown — the only AnyCodable case):

```swift
struct AgentDefaultsSection: View {
    @Environment(AppEnvironment.self) private var env
    let agent: AgentType

    var body: some View {
        if let vm = env.settings, let s = vm.settings {
            switch agent {
            case .claude:
                ClaudeOptionsView(
                    model: Binding(
                        get: { s.claude.defaultModel == "default" ? nil : s.claude.defaultModel },
                        set: { persist(ClaudePatch(defaultModel: $0 ?? "default")) }),
                    effort: Binding(
                        get: { decodeEffort(s.claude.defaultEffort) },
                        set: { persist(ClaudePatch(defaultEffort: $0?.rawValue ?? "default")) }),
                    skipPermissions: Binding(
                        get: { s.claude.dangerouslySkipPermissions },
                        set: { persist(ClaudePatch(dangerouslySkipPermissions: $0)) }),
                    permissionMode: Binding(
                        get: { decodePermission(s.claude.permissionMode) },
                        set: { persist(ClaudePatch(permissionMode: $0.rawValue)) }),
                    mode: .defaults)
            case .codex:
                CodexOptionsView(
                    model: bind(s.codex.defaultModel) { persist(CodexPatch(defaultModel: $0)) },
                    fullAuto: bind(s.codex.fullAuto) { persist(CodexPatch(fullAuto: $0)) },
                    sandbox: bind(s.codex.sandbox) { persist(CodexPatch(sandbox: $0)) },
                    approvalPolicy: bind(s.codex.approvalPolicy) { persist(CodexPatch(approvalPolicy: $0)) },
                    mode: .defaults)
            // … opencode / gemini / cursor / pi analogously with their patches …
            }
        }
    }

    private func persist(_ claude: ClaudePatch) { Task { await env.settings?.updateSettings(SettingsPatch(claude: claude)) } }
    private func persist(_ codex: CodexPatch) { Task { await env.settings?.updateSettings(SettingsPatch(codex: codex)) } }
    // … one overload per group …
    private func bind<V>(_ value: V, set: @escaping (V) -> Void) -> Binding<V> { Binding(get: { value }, set: set) }

    // Claude AnyCodable decode (precedent: AgentOptionsFormModel.swift:164)
    private func decodeEffort(_ c: AnyCodable) -> ClaudeEffortLevel? {
        if case .string(let raw) = c.value { return ClaudeEffortLevel(rawValue: raw) }  // "default"/invalid -> nil
        return nil
    }
    private func decodePermission(_ c: AnyCodable) -> ClaudePermissionMode {
        if case .string(let raw) = c.value, let m = ClaudePermissionMode(rawValue: raw) { return m }
        return .default
    }
}
```

> Cursor's model uses the coercion `defaultModel || "default"` (TS) — write `CursorPatch(defaultModel: $0.isEmpty ? "default" : $0)`. OpenCode variant uses `"" ⇄ "none"` in the Select; reproduce with a `Binding` mapping `""` ⇄ a `"none"` sentinel for the variant `AppSelect` (the 5A fragment renders variant via its own control — confirm whether the fragment already handles the `none` mapping; if so, pass the raw `""`). Re-grep each `*LaunchOptions`/settings field type and each fragment `Binding` type before compiling.

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/AgentDefaultsSection.swift native/Sources/Taskflow/UI/Settings/SettingsDialog.swift
git commit -m "feat(native): 5E AgentDefaultsSection (six agent default tabs)"
```
Then log via `taskflow-cli`.

---

## Task 11: RemoteSection (conditional Remote Agent tab)

Replaces the Task-7 `RemoteSection` stub. Auto-start / App Name / Headless bound to `settings.remoteAgent` via `RemoteAgentPatch`; Status row with green dot + Start/Stop driving `env.settingsCatalog`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Settings/RemoteSection.swift` (delete stub)

**Interfaces:**
- Consumes: `env.settings` (`settings.remoteAgent`), `env.settingsCatalog` (`remoteRunning`, `startRemote`, `stopRemote`), `SettingRow`, `AppToggle`, `AppTextField`, `AppButton`.

- [ ] **Step 1: Build the view** (port of `RemoteSection.tsx`)

- **Auto Start** `AppToggle` ↔ `RemoteAgentPatch(autoStart:)`.
- **App Name** `AppTextField` (placeholder "Auto-generated") ↔ `RemoteAgentPatch(appName:)`.
- **Headless** `AppToggle` ↔ `RemoteAgentPatch(headless:)`.
- **Status** `SettingRow` with a green `Circle` when `catalog.remoteRunning`, and a Start/Stop `AppButton` (`catalog.remoteRunning ? stopRemote : startRemote`).

- [ ] **Step 2: Verify build**

Run: `cd native && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Settings/RemoteSection.swift native/Sources/Taskflow/UI/Settings/SettingsDialog.swift
git commit -m "feat(native): 5E RemoteSection (remote agent tab)"
```
Then log via `taskflow-cli`.

---

## Task 12: ThemeCatalogViewModel + boot-apply persisted theme

The theme list for the Appearance grid + activation that drives the live `ThemeStore` and persists `appearance.theme`. Reducers TDD'd.

**Files:**
- Create: `native/Sources/Taskflow/ViewModels/ThemeCatalogViewModel.swift`
- Create: `native/Tests/TaskflowTests/ThemeCatalogViewModelTests.swift`
- Modify: `App/AppEnvironment.swift` (construct/assign + boot-apply persisted theme), `Tests/TaskflowTests/AppEnvironmentTests.swift`

**Interfaces:**
- Consumes: `WSClient`, `ThemeStore` (`select(id:)`, `all`), `SettingsViewModel` (read `settings.appearance.theme`, write `AppearancePatch`); `ThemeListResponse`/`ThemeRecord`/`ThemeOrigin`; `MessageType.themeList`.
- Produces:
  - `@MainActor @Observable final class ThemeCatalogViewModel`
  - `private(set) var themes: [ThemeRecord]` (bundled only — see filter); `func load() async`; `func activate(_ id: String, themeStore: ThemeStore, settings: SettingsViewModel?)` (or capture refs at init).
  - `nonisolated static func bundled(_ records: [ThemeRecord]) -> [ThemeRecord]` (filter `origin == .bundled`); `nonisolated static func resolveActiveId(settingsTheme: String?, available: [ThemeRecord], fallback: String) -> String`.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class ThemeCatalogViewModelTests: XCTestCase {
    private func rec(_ id: String, _ origin: ThemeOrigin) -> ThemeRecord {
        ThemeRecord(id: id, source: ThemeSource(version: 1, name: id, author: nil, origin: origin,
            colors: ThemeColors(foreground: "#fff", background: "#000", cursor: "#fff", cursorText: "#000",
                selection: "#333", selectionText: "#fff",
                ansi: AnsiColors(black: "#000", red: "#f00", green: "#0f0", yellow: "#ff0", blue: "#00f",
                    magenta: "#f0f", cyan: "#0ff", white: "#fff", brightBlack: "#111", brightRed: "#f00",
                    brightGreen: "#0f0", brightYellow: "#ff0", brightBlue: "#00f", brightMagenta: "#f0f",
                    brightCyan: "#0ff", brightWhite: "#fff")), overrides: nil))
    }
    func testBundledFilter() {
        let out = ThemeCatalogViewModel.bundled([rec("a", .bundled), rec("b", .imported), rec("c", .bundled)])
        XCTAssertEqual(out.map(\.id), ["a", "c"])
    }
    func testResolveActiveIdPrefersSettings() {
        let recs = [rec("dracula", .bundled), rec("nordic", .bundled)]
        XCTAssertEqual(ThemeCatalogViewModel.resolveActiveId(settingsTheme: "nordic", available: recs, fallback: "catppuccin-mocha"), "nordic")
    }
    func testResolveActiveIdFallsBackWhenMissing() {
        let recs = [rec("dracula", .bundled)]
        XCTAssertEqual(ThemeCatalogViewModel.resolveActiveId(settingsTheme: "ghost", available: recs, fallback: "catppuccin-mocha"), "catppuccin-mocha")
    }
}
```

- [ ] **Step 2: Run test to verify it fails** — `cd native && swift test --filter ThemeCatalogViewModelTests` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```swift
// Theme list for the Appearance grid. Port of theme-store.ts (bundled subset for 5E).
// Activation drives the live ThemeStore + persists appearance.theme (imported themes deferred).
@MainActor @Observable
final class ThemeCatalogViewModel {
    private(set) var themes: [ThemeRecord] = []
    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    nonisolated static func bundled(_ records: [ThemeRecord]) -> [ThemeRecord] {
        records.filter { $0.source.origin == .bundled }
    }
    nonisolated static func resolveActiveId(settingsTheme: String?, available: [ThemeRecord], fallback: String) -> String {
        if let t = settingsTheme, available.contains(where: { $0.id == t }) { return t }
        return fallback
    }

    func load() async {
        if let r: ThemeListResponse = try? await client.request(.themeList, payload: [:]) {
            themes = Self.bundled(r.themes)
        }
    }
    func activate(_ id: String, themeStore: ThemeStore, settings: SettingsViewModel?) async {
        themeStore.select(id: id)                                   // live restyle (bundled JSON)
        await settings?.updateSettings(SettingsPatch(appearance: AppearancePatch(theme: id)))
    }
}
```

> AppEnvironment: construct `ThemeCatalogViewModel(client:)`, assign `self.themeCatalog`, no boot-load. **Also** in `boot()` after `settings.load()`, apply the persisted theme: `if let t = settings?.settings?.appearance.theme { themeStore.select(id: t) }`. Update both `AppEnvironmentTests` guards for `themeCatalog`.

- [ ] **Step 4: Run tests to verify they pass** — `swift test --filter ThemeCatalogViewModelTests` then `--filter AppEnvironmentTests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Taskflow/ViewModels/ThemeCatalogViewModel.swift native/Tests/TaskflowTests/ThemeCatalogViewModelTests.swift native/Sources/Taskflow/App/AppEnvironment.swift native/Tests/TaskflowTests/AppEnvironmentTests.swift
git commit -m "feat(native): 5E ThemeCatalogViewModel + boot-apply persisted theme"
```
Then log via `taskflow-cli`.

---

## Task 13: AppearanceDialog shell + mount sheet

The Appearance modal: sidebar nav (Themes, Fonts — **no Import**, deferred) + content router + chrome. Mounted `.sheet` on `appearanceOpen`; loads the theme catalog on open.

**Files:**
- Create: `native/Sources/Taskflow/UI/Appearance/AppearanceDialog.swift`
- Modify: `UI/Shell/AppShell.swift`

**Interfaces:**
- Consumes: `env.themeCatalog`. Produces `struct AppearanceDialog: View`; `private enum AppearanceSection { case themes, fonts }`.

- [ ] **Step 1: Build the shell** (same chrome/nav pattern as `SettingsDialog`, two items: "Themes", "Fonts"). On `.task`: `await env.themeCatalog?.load()`. Content router → `ThemeGrid()` / `FontsTab()`. Add temporary stubs for `ThemeGrid`/`FontsTab` (replaced in Tasks 14/15). Frame ~`width: 720, height: 460`.

- [ ] **Step 2: Mount the sheet in AppShell**

```swift
.sheet(isPresented: Binding(
    get: { ui.appearanceOpen },
    set: { env.ui.setAppearanceOpen($0) }
)) {
    AppearanceDialog()
}
```

- [ ] **Step 3: Verify build** — `cd native && swift build` → clean.

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Taskflow/UI/Appearance/AppearanceDialog.swift native/Sources/Taskflow/UI/Shell/AppShell.swift
git commit -m "feat(native): 5E AppearanceDialog shell + sheet mount"
```
Then log via `taskflow-cli`.

---

## Task 14: ThemeGrid + ThemeCard

Replaces the Task-13 `ThemeGrid` stub. `LazyVGrid` (3 cols) of `ThemeCard`s built from `env.themeCatalog.themes`; preview + 6 ansi swatches from `ThemeRecord.source.colors`; active border; tap activates.

**Files:**
- Create: `native/Sources/Taskflow/UI/Appearance/ThemeGrid.swift`, `native/Sources/Taskflow/UI/Appearance/ThemeCard.swift`

**Interfaces:**
- Consumes: `env.themeCatalog`, `env.themeStore`, `env.settings`; `ThemeRecord`/`ThemeColors`/`AnsiColors`; `Color(hex:)`.

- [ ] **Step 1: Build ThemeCard** (port of `ThemeCard.tsx`)

```swift
struct ThemeCard: View {
    let record: ThemeRecord
    let isActive: Bool
    let onTap: () -> Void
    @Environment(\.appTheme) private var theme

    private var c: ThemeColors { record.source.colors }
    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                // preview pane
                HStack(spacing: 4) {
                    Text("~/project $").foregroundStyle(Color(hex: c.foreground))
                    Text("git status").foregroundStyle(Color(hex: c.ansi.green))
                }
                .font(.system(size: 11, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 64)
                .padding(8)
                .background(Color(hex: c.background))
                // swatch row: red, green, yellow, blue, magenta, cyan
                HStack(spacing: 0) {
                    ForEach([c.ansi.red, c.ansi.green, c.ansi.yellow, c.ansi.blue, c.ansi.magenta, c.ansi.cyan], id: \.self) { hex in
                        Rectangle().fill(Color(hex: hex)).frame(height: 12)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 2))
                Text(record.source.name).font(.system(size: 12, weight: .medium))
            }
            .padding(8)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isActive ? theme.accent : theme.border, lineWidth: isActive ? 2 : 1))
            .background(isActive ? theme.accent.opacity(0.1) : .clear)
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 2: Build ThemeGrid**

```swift
struct ThemeGrid: View {
    @Environment(AppEnvironment.self) private var env
    private var activeId: String { env.settings?.settings?.appearance.theme ?? env.themeStore.current.id }
    var body: some View {
        if let catalog = env.themeCatalog {
            if catalog.themes.isEmpty {
                Text("No themes installed.").foregroundStyle(env.theme.muted) // use @Environment(\.appTheme)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                    ForEach(catalog.themes, id: \.id) { rec in
                        ThemeCard(record: rec, isActive: rec.id == activeId) {
                            Task { await catalog.activate(rec.id, themeStore: env.themeStore, settings: env.settings) }
                        }
                    }
                }
            }
        }
    }
}
```

> `Color(hex:)` exists (`extension Color { init(hex: String) }`) and parses `#RRGGBB`/`rgba()`. Use `@Environment(\.appTheme) private var theme` for the empty-state color (not `env.theme`). Re-grep `ThemeStore.current.id` accessor.

- [ ] **Step 3: Verify build** — `cd native && swift build` → clean.

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Taskflow/UI/Appearance/ThemeGrid.swift native/Sources/Taskflow/UI/Appearance/ThemeCard.swift native/Sources/Taskflow/UI/Appearance/AppearanceDialog.swift
git commit -m "feat(native): 5E ThemeGrid + ThemeCard (bundled theme picker)"
```
Then log via `taskflow-cli`.

---

## Task 15: FontsTab

Replaces the Task-13 `FontsTab` stub. Three sections (Workspace=`general`, Terminal, Editor), each `FontFamilySelect` + size `AppTextField` (8–32, int-validated); "Reset to defaults" sends `FontResetPatch`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Appearance/FontsTab.swift`

**Interfaces:**
- Consumes: `env.settings`, `FontFamilySelect`, `SettingRow`, `AppTextField`, `AppButton`; `GeneralPatch`/`TerminalPatch`/`EditorPatch`/`FontResetPatch`.

- [ ] **Step 1: Build the view** (port of `FontsTab.tsx`)

Three `section(header:familyValue:onFamily:sizeValue:onSize:)` blocks:
- **Workspace** → `settings.general.fontFamily`/`fontSize`, patches `GeneralPatch(fontFamily:)` / `GeneralPatch(fontSize:)`.
- **Terminal** → `settings.terminal.*`, `TerminalPatch`.
- **Editor** → `settings.editor.*`, `EditorPatch`.

Size field: `AppTextField` over a `String` mirror of the `Double`; on commit parse `Int`, persist only if `8...32` contains it (`!isNaN && > 0` per TS, clamped to the 8–32 `min/max`). "Reset to defaults" `AppButton(kind: .secondary)` → `await env.settings?.updateSettings(FontResetPatch())`.

```swift
struct FontsTab: View {
    @Environment(AppEnvironment.self) private var env
    var body: some View {
        if let vm = env.settings, let s = vm.settings {
            VStack(alignment: .leading, spacing: 16) {
                fontSection("Workspace",
                    family: Binding(get: { s.general.fontFamily }, set: { v in persist(GeneralPatch(fontFamily: v)) }),
                    size: s.general.fontSize, onSize: { persist(GeneralPatch(fontSize: $0)) })
                fontSection("Terminal",
                    family: Binding(get: { s.terminal.fontFamily }, set: { v in persist(TerminalPatch(fontFamily: v)) }),
                    size: s.terminal.fontSize, onSize: { persist(TerminalPatch(fontSize: $0)) })
                fontSection("Editor",
                    family: Binding(get: { s.editor.fontFamily }, set: { v in persist(EditorPatch(fontFamily: v)) }),
                    size: s.editor.fontSize, onSize: { persist(EditorPatch(fontSize: $0)) })
                AppButton(title: "Reset to defaults", kind: .secondary) {
                    Task { await env.settings?.updateSettings(FontResetPatch()) }
                }
            }
        }
    }
    private func persist(_ g: GeneralPatch) { Task { await env.settings?.updateSettings(SettingsPatch(general: g)) } }
    private func persist(_ t: TerminalPatch) { Task { await env.settings?.updateSettings(SettingsPatch(terminal: t)) } }
    private func persist(_ e: EditorPatch) { Task { await env.settings?.updateSettings(SettingsPatch(editor: e)) } }
    // fontSection(_:family:size:onSize:) -> some View with FontFamilySelect + a clamped size field
}
```

- [ ] **Step 2: Verify build** — `cd native && swift build` → clean.

- [ ] **Step 3: Commit**

```bash
git add native/Sources/Taskflow/UI/Appearance/FontsTab.swift native/Sources/Taskflow/UI/Appearance/AppearanceDialog.swift
git commit -m "feat(native): 5E FontsTab (family/size + reset-to-defaults)"
```
Then log via `taskflow-cli`.

---

## Task 16: Whole-phase review fixes + results spec + ledger + memory

Final consolidation: run the full suite + build, opus whole-phase review, one consolidated fix wave, write the results spec, update the SDD ledger and the resume-point memory.

**Files:**
- Create: `docs/superpowers/specs/2026-06-30-phase5e-settings-appearance-results.md`
- Modify: `.superpowers/sdd/progress.md` (per-task detail + minor triage)
- Modify: the resume-point memory `project_native_app_experiment_status` (mark 5E COMPLETE; next = 5F)

- [ ] **Step 1: Full verification**

Run: `cd native && swift build && swift test`
Expected: build clean; all tests pass (≈232 from 5D + the new SettingsPatches/ModelList/SettingsCatalog/ThemeCatalog suites). Record the exact count.

- [ ] **Step 2: Opus whole-phase review** — dispatch a review subagent over the 5E commit range (correctness, faithful-port, env-injection, no-`as`/`public`/`AnyCodable`-misuse, persisted-binding pattern, the FontResetPatch explicit-null, deferred-import boundary honored). Apply Critical/Important fixes in one wave; re-verify.

- [ ] **Step 3: Write the results spec** — what landed (Settings 9 tabs, Appearance Themes+Fonts, model selects, two VMs + ThemeCatalog, retrofitted fragments); the **deferred-import** decision + the empty-`CssVariables` codegen finding + the deriveTheme follow-up; minor parity gaps (no inline custom-value in populated model menus; shell `__missing__` sentinel simplification if taken); the **human-dogfood checklist** (launch `native/.build/app/TaskflowDev.app`; open Settings via the seam — note both flags are toggled by `UIViewModel.toggleSettings()`/`toggleAppearance()` but **no UI trigger is mounted yet** → that's a 5F concern; for dogfood, temporarily trigger the flags or wire a debug menu; confirm: every tab renders + persists, theme grid live-restyles + survives relaunch, fonts apply + reset, model dropdowns populate when the agent CLI is present and fall back when absent, data-folder change shows the conflict dialog).

> **Note the trigger gap:** `settingsOpen`/`appearanceOpen` are toggled today only via methods with no mounted caller (the menu/command-palette triggers are 5F/native-menu work). The sheets are mounted (this phase), so 5F's command palette + native menu items just flip the flags. Call this out so 5F owns the triggers.

- [ ] **Step 4: Update ledger + memory, commit docs**

```bash
git add docs/superpowers/specs/2026-06-30-phase5e-settings-appearance-results.md .superpowers/sdd/progress.md
git commit -m "docs(native): Phase 5E (Settings+Appearance) results spec + ledger"
```
Update the `project_native_app_experiment_status` memory (5E COMPLETE; HEAD; next = 5F command-palette+dialogs incl. the settings/appearance triggers + 5B/5D-deferred modals). Log final state via `taskflow-cli`.

---

## Self-Review (completed during planning)

**1. Spec coverage** (against both exploration maps + master-plan 5.4/5.7):
- Settings tabs General/Defaults/Claude/Codex/OpenCode/Gemini/Cursor/Pi/Remote → Tasks 7–11. ✓
- Appearance Themes + Fonts → Tasks 13–15. Import → **explicitly deferred** (Scope Decisions; product-owner confirmed). ✓
- Fetched model dropdowns (cursor/opencode/pi) → Tasks 2–4. ✓
- Immediate-persist-no-dirty model → the persisted-binding pattern (Global Constraints) + `SettingsPatch` (Task 1). ✓
- Fonts reset explicit-null → `FontResetPatch` (Task 1, TDD'd). ✓
- Theme persists into `appearance.theme` + live restyle (bundled) → Task 12/14. ✓
- Data folder change + conflict → Task 8. ✓
- Both dialogs mounted as sheets → Tasks 7/13. ✓

**2. Placeholder scan:** view tasks intentionally give structural code + exact bindings/signatures + faithful-port citations (views are build+dogfood verified, not unit-tested — same balance as the 5C/5D plans); all *testable logic* tasks (1, 2, 5, 12) carry complete TDD code. No "TBD"/"add validation"/"similar to Task N" left as the actual deliverable.

**3. Type consistency:** patch struct names (`SettingsPatch`/`GeneralPatch`/…/`FontResetPatch`/`AppearancePatch`) are used identically across Tasks 1/8/9/10/11/12/15. VM names (`ModelListViewModel`/`SettingsCatalogViewModel`/`ThemeCatalogViewModel`) and their `env` accessors (`env.models`/`env.settingsCatalog`/`env.themeCatalog`) match across construction (Tasks 2/5/12) and consumption (Tasks 3/9/11/14). Fragment signatures in Task 10 match the verified 5A signatures (and Task 4's retrofit preserves them).

**Open verification flags for implementers (re-grep before compiling):** `WSClient.requestRaw` existence/shape (Task 5 start/stop); whether `AppSelect` can hold an out-of-list selection (Tasks 6/9 — font stacks, shell sentinels); the OpenCode `variant` `""⇄"none"` mapping location (fragment vs section, Task 10); `ThemeStore.current.id` + `Color(hex:)` exact names (Task 14); `AGENT_DISPLAY_NAMES` native equivalent (Task 9).

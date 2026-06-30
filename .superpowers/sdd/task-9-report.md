# Task 9 Report: DefaultsSection

## Build Result
`swift build` — Build complete! (4.42s), zero errors, zero new warnings from project code.

## Files Changed
- **Created**: `native/Sources/Taskflow/UI/Settings/DefaultsSection.swift` (217 lines)
- **Modified**: `native/Sources/Taskflow/UI/Settings/SettingsDialog.swift` (removed only the DefaultsSection stub line)

## Stub Removal Confirmation
Removed exactly one line from SettingsDialog.swift:
```swift
struct DefaultsSection: View { var body: some View { EmptyView() } }        // STUB — replaced in Task 9
```
`AgentDefaultsSection` (Task 10) and `RemoteSection` (Task 11) stubs are intact.

## Implementation Summary
Port of `packages/ui/src/components/settings/sections/DefaultsSection.tsx`.

Six rows implemented:
1. **Internal Editor** — `AppSelect<String>` over `[("monaco","Monaco")] + internal editors`, binds `settings.editor.internalEditor` via `EditorPatch(internalEditor:)`.
2. **External Editor** — `AppSelect<String>` over `[("system","System Default")] + external editors`, binds `settings.editor.externalEditor` via `EditorPatch(externalEditor:)`.
3. **Default Agent** — `AppSelect<AgentType>` over `RunMenuViewModel.allAgentTypes`, appends " (not installed)" when `!catalog.isAvailable(agent)`, binds `settings.general.defaultAgent` via `GeneralPatch(defaultAgent:)`.
4. **Toolbar Agents** — Custom `VStack` (header label + hint text + `ForEach` of `AppToggle`s), one per available agent. Checks `settings.general.favoriteAgents.contains(agent)`. Toggle `set` adds/removes agent from array copy, persists via `GeneralPatch(favoriteAgents:)`.
5. **Default Shell** — `AppSelect<String>` over `[("system","System Default (path)")] + shells`, binds `settings.terminal.defaultShell` via `TerminalPatch(defaultShell:)`.
6. **Default Runtime** — `AppSelect<String>` over `runtimes.map { "\($0.name) (\($0.version))" }`, binds `settings.general.defaultRuntime` via `GeneralPatch(defaultRuntime:)`.

Guard: `env.settings?.settings` — renders `Text("Loading…")` when nil. Also guards `env.settingsCatalog`.

Reused: `RunMenuViewModel.allAgentTypes` and `RunMenuViewModel.displayName(_:)` (both `nonisolated static`).
Persist helpers: three private overloads `persist(editor:settingsVM:)`, `persist(general:settingsVM:)`, `persist(terminal:settingsVM:)`.

## Commit
`72d0df2` — feat(native): 5E DefaultsSection (editors/agent/shell/runtime)

## Self-Review Findings
- **`favoriteAgents` nil handling**: `GeneralSettings.favoriteAgents` is non-optional in the Swift codegen (`[AgentType]`), so the TS `?? ALL_AGENT_TYPES` nil-coalescing isn't needed. The binding uses `.contains(agent)` directly.
- **`__missing__`/`__none__` sentinels**: Skipped per the task note ("reproduce only if trivial; otherwise just render the value"). Shell/runtime selects render the stored value without a disabled sentinel when the configured value is absent from the catalog list.
- **System shell label**: Shows `"System Default (/path/to/shell)"` when `catalog.systemShellPath` is non-nil, else `"System Default"`. Faithful to `getTerminalShellSummary`.
- **Toolbar Agents layout**: Uses a `VStack` with inline label+hint (not `SettingRow`) to match the TS multi-toggle container layout rather than a single trailing-control row.
- No `public`, no `as any`, no force casts, no disabled lint rules.

## Concerns
None.

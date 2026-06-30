# Phase 5E — Settings + Appearance — Results

**Status:** COMPLETE (2026-06-30). **Range:** `577e4d6..8913255` (16 commits — 15 build tasks `8d85070..10740f2` + one polish wave `8913255`). **Suite:** 246 swift tests / 0 failures; `swift build` clean (controller-verified at `8913255`). Branch `task/build-native-app-experiment` kept as-is (no merge/PR).

Plan: `docs/superpowers/plans/2026-06-30-phase5e-settings-appearance.md`. Ledger: `.superpowers/sdd/progress.md`. Executed via subagent-driven-development (15 build tasks — haiku/sonnet implementers + per-task spec+quality reviews; ⚠️/fix loops resolved on T9/T10) + opus whole-phase review ("Ready to merge — Yes", no Critical/Important) + one behavior-preserving polish wave.

## What landed

Delivered master-plan **5.4 Settings** + **5.7 Appearance** (bundled themes) + the deferred fetched-model dropdowns. All `internal`/`private` (no `public`), Swift 6, no `as`/force casts, no new domain types beyond UI-local patch structs, pure statics `nonisolated`.

### Persistence vocabulary (Task 1)
- **`UI/Settings/SettingsPatches.swift`** — UI-local `Encodable` partials: `SettingsPatch` + 11 group patches (all fields optional with `= nil` defaults; synthesized `Encodable` omit-nil, so a one-field patch serializes to only that key) + **`FontResetPatch`** whose **scoped custom `encode(to:)` emits EXPLICIT nulls** for `general/terminal/editor` × `fontFamily/fontSize` (the Fonts reset → backend re-expands nulls to defaults). This is the one clear-semantics case in 5E — solved exactly as the 5D schedule-clear lesson prescribes: a scoped UI-local type, NOT an `encode(to:)` override on a generated type. TDD'd (omit-nil vs explicit-null JSON).

### View models (Tasks 2, 5, 12)
- **`ModelListViewModel`** — lazy fetch + in-memory cache of cursor/opencode/pi model lists; per-agent `Loading`/`Loaded`/`Failed` (empty list treated as failed → text-input fallback); `ensure*()` idempotent; `nonisolated static apply*` passthrough reducers. Wired client-dependent into `AppEnvironment` (no `bind()`, no boot-load).
- **`SettingsCatalogViewModel`** — shells/runtimes/system-editors/agent-availability + remote-agent status; `loadCatalog()` parallel best-effort (`async let … = try?`); `start/stopRemote()` via `requestRaw`; `bind()` on `.remoteAgentStatusChanged` (`[weak self]` + `@MainActor` hop); `nonisolated static isAvailable(_:in:)`. Wired with `bind()`.
- **`ThemeCatalogViewModel`** — `theme:list` → `bundled`-filtered `[ThemeRecord]`; `activate(id:themeStore:settings:)` = live `ThemeStore.select(id:)` THEN persist `AppearancePatch(theme:)`; `nonisolated static bundled`/`resolveActiveId` reducers. Wired (no boot-load). **Boot now applies the persisted theme** after the settings-load completes (`themeStore.select(id: settings.appearance.theme)`), so a saved theme survives relaunch.
- All three added to `AppEnvironment.compose` with **both `AppEnvironmentTests` guards** updated (nil-before / non-nil-after).

### Settings dialog (Tasks 7–11) — 9 tabs
`UI/Settings/SettingsDialog.swift` — 148pt sidebar nav (9 items via `SettingsSection`, Remote appended only when `settingsCatalog.isAvailable(.claude)`) + content router + chrome (640×460); `.task` fires `fetchDataDir` + `loadCatalog`; mounted `.sheet` on `UIViewModel.settingsOpen` in `AppShell`.
- **GeneralSection** — Data Folder display + **Change** (`NSOpenPanel` dirs-only, main-actor sync `runModal`) → `updateDataDir`; conflict driven by `info.conflict == true` → `.alert` (Overwrite `.destructive` / Use Existing `.adopt` / Cancel); Reset shown only when `!isDefault`; `migrationError` (5s auto-clear) on a real throw; **Ask before exit** toggle.
- **DefaultsSection** — Internal/External Editor, Default Agent (reuses `RunMenuViewModel.allAgentTypes`/`displayName`, " (not installed)" suffix), Toolbar Agents (per-available `AppToggle` add/remove on `favoriteAgents`), Default Shell, Default Runtime.
- **AgentDefaultsSection(agent:)** — the six Phase-5A `*OptionsView` fragments in `.defaults` mode, settings-bound via computed `Binding`s + six typed `persist` overloads (compile-enforced no cross-wiring). **Claude AnyCodable decode**: `defaultEffort`/`permissionMode` via `if case .string(let raw) = c.value` ("default"/invalid → `nil`/`.default`); writes back raw string. Cursor empty→"default" coercion; OpenCode variant bound raw (the fragment's `AppSelect` uses `("", "None")`).
- **RemoteSection** — Auto Start / App Name / Headless → `RemoteAgentPatch`; Status row (green dot when `remoteRunning` + Start/Stop). Tab availability gated by the dialog.

### Appearance dialog (Tasks 13–15) — Themes + Fonts
`UI/Appearance/AppearanceDialog.swift` — 2-item nav (Themes, Fonts — **no Import**, deferred), `.task` loads the theme catalog, mounted `.sheet` on `UIViewModel.appearanceOpen`.
- **ThemeGrid + ThemeCard** — `LazyVGrid` (3 cols) of cards from `themeCatalog.themes`; each card = preview pane (`~/project $` + `git status` over the theme bg/fg/ansi.green) + 6 ansi swatches + name + active border; tap → `themeCatalog.activate(...)` (live restyle + persist). `activeId` via the tested `resolveActiveId` (polish wave — validates membership + falls back on unknown id).
- **FontsTab** — Workspace/Terminal/Editor sections, each `FontFamilySelect` (`NSFontManager.availableFontFamilies`; text fallback preserving CSS-font-stack values) + size field (computed `Binding<String>`, parses Int, persists only when `8...32`); **Reset to defaults** → `FontResetPatch()`.

### Model-fetch retrofit (Tasks 3–4, 6)
- **`SettingsModelSelect.swift`** — `CursorModelSelect`/`OpenCodeModelSelect`/`PiModelSelect`: lazy-fetch via `env.models`, `AppSelect` when loaded, `AppTextField` fallback on failed/empty.
- **`FontFamilySelect.swift`** — `NSFontManager`-backed; text fallback when families empty OR the bound value (a CSS font stack) isn't a known family — preserves the value editable.
- The three 5A fragments (`Cursor/OpenCode/PiOptionsView`) were retrofitted to embed the matching select, **signature-preserving** — the 5D ActionEditor/InlineActionEditor/ScheduleForm consumers are untouched.

## Key findings / decisions

- **THEME IMPORT DEFERRED (product-owner decision 2026-06-30).** The generated `CssVariables` struct is **empty** (codegen could not emit the TS string-keyed CSS-var map), so the wire `ResolvedTheme.css` carries nothing the native `AppTheme` can consume — imported/custom themes have **no live-applicable css map**. Bundled themes are unaffected (they apply from `Resources/themes/*.json`). The deferred surface: the Appearance "Import theme" sub-tab (`theme:import-scan`/`theme:import`/`theme:import-file`), custom-theme `theme:delete`, and imported-theme live-apply. **Follow-up to unblock import:** port the TS `deriveTheme(ThemeColors) → CssVariables` (the 45-var derivation) into native and route it through the live-theming path — pairs naturally with the **Phase-6 unified-theming audit**.
- **OPEN TRIGGERS NOT WIRED (5F owns them).** `UIViewModel.settingsOpen`/`appearanceOpen` are toggled only by `toggleSettings()`/`toggleAppearance()`/`setAppearanceOpen(_:)`, which have **no mounted caller yet** (the menu-bar items + command-palette entries are 5F / native-menu work). The **sheets ARE mounted this phase** — so 5F's triggers just flip the flags. **5F should also add a dialog close/title affordance**: today both dialogs render sidebar + content with no in-content close button, so a flipped flag yields a dialog you can only dismiss by clicking outside the sheet. (The whole-phase review flagged this; it's bounded because the dialogs are currently unreachable.)
- **`favoriteAgents` parity confirmed:** generated `GeneralSettings.favoriteAgents` is non-optional, and the backend `DEFAULTS` seeds it with `[...ALL_AGENT_TYPES]`, so the native toolbar toggles read ON-by-default exactly like the TS `favoriteAgents ?? ALL_AGENT_TYPES`.
- **Minor parity gap (documented):** the OpenCode/Pi model selects have no inline custom-value entry while a populated menu is shown — the text fallback is the custom-value path (appears whenever the agent CLI didn't return models). Cursor/shell `__missing__`/`__none__` disabled sentinels were simplified away (brief-allowed).

## Known debt (keep-as-debt — none block merge; whole-phase review triaged all as low-impact)

- `SettingsCatalogViewModel` toolbar-agent toggle: rapid double-toggle can capture a stale `AppSettings` before `await updateSettings` resolves (SwiftUI async-persist limitation; merged round-trip self-corrects).
- `GeneralSection` concurrent `scheduleClearError` timers can early-wipe a newer `migrationError` (low probability; clean fix = hold+cancel the prior `Task`).
- `FontsTab` size field's computed `get` re-reads persisted size mid-edit (minor typing friction; matches TS min/max intent).
- Cosmetic: T5 semicolon-packed line in `loadCatalog`; T6 sync `availableFontFamilies` in `.task` (ms-fast).

## Live verification

**LIVE in-app visual verification = HUMAN DOGFOOD** (deferred, isolation-sensitive). Because the open triggers aren't wired yet, dogfooding requires temporarily flipping `settingsOpen`/`appearanceOpen` (a debug menu or a temporary default) to present the sheets. Checklist: every Settings tab renders + persists on change; the theme grid live-restyles on tap and the choice survives relaunch (boot-apply); fonts apply + reset-to-defaults restores; the model dropdowns populate when the agent CLI is present and fall back to text when absent; the data-folder Change flow shows the conflict dialog.

## Next

Sub-plan **5F** — command palette + shortcuts dialog + dialog host (master-plan 5.8). 5F OWNS: the Settings/Appearance **open triggers** (menu/palette) + a dialog **close/title affordance**; and the 5B/5D-deferred sidebar modals (NewTask/NewProject/MissingLocation/Update/AgentOptions/**FlowInput**/project Fork + the "Run with options" AgentOptionsDialog). After 5F, Phase 5 (breadth) is complete → Phase 6 (parity hardening + cutover), which also owns the **theme-import / deriveTheme** unblock and the unified-theming audit.

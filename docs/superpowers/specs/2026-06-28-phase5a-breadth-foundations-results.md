# Phase 5A (Breadth Foundations) — Results & Acceptance Note

**Date:** 2026-06-28
**Plan:** `docs/superpowers/plans/2026-06-28-phase5a-breadth-foundations.md`
**Master plan:** `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md` (Phase 5 units 5.6 + 5.9, plus prerequisite primitives)
**Commit range:** `30875b3` (plan-doc / base) · `17e0b0c..e8287b7` (Tasks 1–9) · `d3b546d` (final-review fix)
**Status:** ✅ **Phase 5A complete (code gate).** Live in-app visual verification is a documented **human-dogfood** item.

Execution followed subagent-driven-development: a fresh implementer per task (sonnet for logic/generics, haiku for pure-view transcription), an independent per-task spec+quality review, fixes re-verified, then a final whole-phase review (opus) whose single Minor finding was fixed. Per-task detail + minor triage: `.superpowers/sdd/progress.md`.

---

## Where this fits

Phase 5 (the ~60% breadth) is split into **six sub-plans** because it spans ~12.6k LOC across 9 independent master-plan units. **5A is the foundation** — the shared primitives, icons, and agent option fragments every later screen consumes. Remaining: 5B Sidebar, 5C Panels, 5D Flows+Schedules, 5E Settings+Appearance, 5F Command-palette+dialogs.

## What each task landed

- **Task 1 — `AppSelect<Value: Hashable>`** (`UI/Primitives/AppSelect.swift`). Themed `Picker(.menu)` generic over a Hashable value so fragments bind typed enums (incl. optionals like `ClaudeEffortLevel?`). Pure `nonisolated static label(for:in:)` (TDD'd, incl. optional-enum case). The optional Picker round-trip is correct (tag type == selection type == `Value`) — no blank-picker trap.
- **Task 2 — `SettingRow<Trailing: View>`** (`UI/Primitives/SettingRow.swift`). Label (13/medium `.foreground`) + optional hint (11 `.mutedForeground`) + trailing control. Pure layout; the row unit for all 5D/5E forms.
- **Task 3 — `AppIcon`** (`UI/Icons/AppIcon.swift`). `nonisolated static symbol(forLucide:)` — full 50-case lucide→SF-Symbol table, `Icon`-suffix normalization (bare `"Icon"` untouched), visible `questionmark.square.dashed` fallback for gaps. All 42 SF names resolve on macOS 14 (no substitutions). TDD'd.
- **Task 4 — `AgentIcon`** (`UI/Icons/AgentIcon.swift`). Themed monogram per `AgentType`; `nonisolated` total `switch`es `initial(for:)`/`tintToken(for:)` (no `default` → adding an agent forces a compile error); Cursor → `.cursorAgent`. Placeholder for brand glyphs with a documented `Image(bundle:.module)` swap seam. TDD'd.
- **Task 5 — `AgentOptionsMode` + `ClaudeOptionsView`.** `enum AgentOptionsMode {defaults, session}` + the first fragment (model/effort/skip-permissions/permission-mode), bound to typed enums; `nonisolated static modelLabel(_:)` TDD'd. Optional-promotion pinned via `(Optional<ClaudeEffortLevel>.none, "Default")`.
- **Task 6 — `CodexOptionsView`.** Model text + full-auto toggle + sandbox/approval selects, both selects `.disabled(fullAuto)`. Verbatim TS labels/options.
- **Task 7 — `GeminiOptionsView` + `CursorOptionsView`.** Implementer read the TS sources and corrected the plan's template: Gemini approval-mode is a fixed 4-option select including **`plan`** (omitted from the template); Cursor yolo label is **`Yolo`**; Cursor model is a text field (dynamic `CursorModelSelect` deferred to 5E).
- **Task 8 — `OpenCodeOptionsView` + `PiOptionsView`.** Implementer found OpenCode `variant` is a **Select** (None/High/Max/Minimal, `""`=None sentinel), implemented as `AppSelect<String>`; Pi thinking is a typed `AppSelect<PiThinkingLevel>` (6 levels). Fetched model dropdowns deferred to 5E.
- **Task 9 — `AgentOptionsView` wrapper + `PrimitivesGallery` showcase (integration gate).** Total `switch AgentType` → the six fragments with self-contained `@State` (sensible enum defaults); gallery shows the AgentIcon row, AppIcon row, an agent picker, and the live fragment. **Step 4 (launch + screenshot) descoped to human dogfood** — isolation-sensitive, consistent with Phases 1/3/4; no evidence PNG.
- **Final-review fix (`d3b546d`).** The opus whole-phase review found one Minor: the Claude skip-permissions hint wasn't mode-switched (the `.defaults` copy must read "…by default…" per the TS). Fixed — now switches on `mode` like the sibling rows.

## Test results

- `swift test`: **153 XCTest cases, 0 failures** (Phase-4's 143 + 5A's 10 new pure tests: `AppSelectTests` ×3, `AppIconTests` ×3, `AgentIconTests` ×3, `AgentOptionsLabelTests` ×1). Controller-verified at HEAD `e8287b7` and again after the fix.
- `swift build`: clean. (Pre-existing harmless `TreeSitter*` linker warnings only.)

## Acceptance vs master-plan units

- **5.9 Icons** → Tasks 3 (`AppIcon`, full lucide set) + 4 (`AgentIcon`). Brand-glyph fidelity deferred with a documented seam. ✅
- **5.6 Shared per-agent option fragments** → Tasks 5–9 (all six agents + `AgentOptionsView`), reusable across settings/run-menus/schedules. ✅
- **Prerequisite primitives** (`AppSelect`, `SettingRow`) → Tasks 1–2 (confirmed absent from `UI/Primitives` before this phase). ✅

## Verification — honest status

- **Code gate (met):** `swift build` clean, **153 tests / 0 failures**, 9 per-task spec+quality reviews (all Approved; ⚠️ full-suite gap on Task 5 resolved by controller; fixes re-verified), 1 opus whole-phase review (single Minor fixed).
- **Live in-app visual verification = human dogfood (NOT done autonomously).** Consistent with prior phases (isolation-sensitive launch). **Dogfood checklist:** launch `native/.build/app/TaskflowDev.app` against the sandbox sidecar, open the `PrimitivesGallery` route, and confirm: themed agent monograms are distinct; lucide icons render (no `questionmark` placeholders for the common set); `AppSelect` dropdowns open and theme-tint; toggles flip; **Codex sandbox/approval disable when Full Auto is on**; switching the agent picker swaps the fragment live.

### Deferred / carried into later sub-plans
- Fetched model dropdowns (`CursorModelSelect`/`OpenCodeModelSelect`/`PiModelSelect`, which need `cursor:models`/`opencode:models`/`pi:models` RPC) → **5E**.
- Serialization of fragment state to `*LaunchOptions` payloads + a per-agent form-model that lifts `AgentOptionsView`'s demo `@State` → **5D/5E**.
- Pixel-faithful agent brand glyphs (vector assets) — `AgentIcon` ships a themed monogram now.

### Accepted Minor debt (none block acceptance)
- T1: `AppSelect` `nonisolated` doc-comment frames it as "so tests can call it" rather than "accesses no actor state" (cosmetic).
- T9: `PrimitivesGallery` AppIcon row uses semicolon-separated views on one line (verbatim from plan; compiles).

Branch `task/build-native-app-experiment` kept as-is (no merge/PR), consistent with Phases 0–4. Phase 5 continues with sub-plan 5B (Sidebar).

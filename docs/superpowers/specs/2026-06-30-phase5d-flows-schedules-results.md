# Phase 5D — Flows + Schedules: Results

**Status:** COMPLETE. Plan `docs/superpowers/plans/2026-06-30-phase5d-flows-schedules.md` (plan commit `5cf00ad`). Executed via subagent-driven-development: 12 build tasks (sonnet implementers + sonnet per-task reviews, with fix loops on Tasks 6/8/9/11) + an opus whole-phase review ("Ready to merge", no Critical/Important) + one optional polish fix wave. **Code range `5cf00ad..a5f50ac`** (code commits `5d0e928..a5f50ac`). **Controller-verified at HEAD: `swift build` clean, 232 swift tests / 0 failures.** Branch kept as-is (no merge/PR).

Master-plan units delivered: **5.3 Flows** (flow editor, management, action editor, inline editor, action list) + **5.5 Schedules** (schedule form + management + helpers + the missing `ScheduleViewModel` store).

## What landed (all `internal`/`private`, Swift 6, no `public`/`as any`/force-casts, no new domain types beyond the UI-local helpers noted; pure statics `nonisolated`; each view cites its TS source)

**Pure helpers (TDD):**
- **`UI/Flows/AgentOptionsNormalize.swift`** — port of `lib/normalize-agent-options.ts`. `nonisolated static normalized(type:options:) -> AgentLaunchOptions?`: nil for shell/nil/type-mismatch; falsy booleans → nil; empty model/variant/tools → nil; preserves per-type fields. The shared dirty-check encoder for every editor/form. 5 tests.
- **`UI/Flows/FlowActionEntryCodec.swift`** — UI-local `enum FlowActionEntryKind { reference, inline }` (Identifiable+Equatable) + `decode([AnyCodable])`/`encode(...)` bridging the generated `FlowDefinition.actions: [AnyCodable]` union. Discriminates on the `inline` key first (else reference), via `AnyCodable.value` `.object` pattern-match; `compactMap` drops malformed. 4 tests.
- **`UI/Schedules/ScheduleHelpers.swift`** + `enum ScheduleRowStatus` — port of `schedule-helpers.ts` + the management-dialog row helpers. `normalizeTimeout` (>0 else 30), `computeNextRunPreview` (`rate(N unit)` → date; cron/bad → nil), `formatRelativeTime` (Never/Just now/Ns/Nm/Nh/Nd), `scheduleStatus`, `dirtyKey` (stable canonical key; drops prompt/agentType/agentOptions when `useAction`). 9 tests.

**Store + reusable form (TDD on logic):**
- **`ViewModels/ScheduleViewModel.swift`** — the one missing store (port of `schedule-store.ts`). `@MainActor @Observable`: `schedules`/`loading`; `bind()` on `.scheduleUpdated` (`[weak self]` + `@MainActor` hop); `load(projectId:)`; `create`/`delete`/`trigger`; `nonisolated static` upsert/remove reducers (3 tests). Two update entry points: **`update(_:)`** (omit-nil — partial-safe, used by the enable/disable toggle) and **`update(formPayload:)`** (forces explicit JSON `null` for `actionId`/`agentType`/`agentOptions` when absent — used by the form so clearing works against the backend's key-presence semantics). Wired client-dependent into `AppEnvironment` (construct/`bind()`/assign in `compose`; NOT in the boot parallel-load group — schedules are project-scoped, lazy `load`); both `AppEnvironmentTests` guards updated.
- **`UI/Flows/AgentOptionsFormModel.swift` + `AgentOptionsFormView.swift`** — the reusable agent-options sub-form that lifts the Phase-5A `*OptionsView` fragment `@State` into a real model (the 5A "lift bindings into form models" carry-forward). `AgentOptionsFormModel(seed:settings:)` seeds only the seed's own agent fields (+ best-effort settings defaults); `options(for: agent)` assembles raw options then routes through `AgentOptionsNormalize.normalized`; `reset(to:)` via a shared `resetToLiteralDefaults()`. The view `@Bindable`-binds each fragment by `agent`. Consumed by ActionEditor, InlineActionEditor, ScheduleForm. 4 tests.

**Flow views (build + dogfood):**
- **`UI/Flows/ActionEditor.swift`** — reusable `ActionDefinition` create/edit form. Name/Project(`__global__` sentinel↔nil)/SessionType(claude,codex,opencode,gemini,cursor,shell — **no pi**)/Standalone/Prompt|Command multiline/AgentOptionsFormView. Dirty-check via `nonisolated static snapshotKey` routed through `options(for:)` for BOTH initial and current (the recurring 5D bug class — fixed). Save: id-fallback, name trimmed, prompt untrimmed, shell-nulled options, `standalone?true:nil`, createdAt preserved.
- **`UI/Flows/InlineActionEditor.swift`** — parent-controlled inline `ActionInline` sub-form; local `@State` seeded once, `emitUpdate()` on every change (agent-options change observed via an `optionsSnapshot` computed property that `@Observable` tracks). No pi.
- **`UI/Flows/FlowActionList.swift`** — ordered entries with button-based up/down reorder (no drag), remove, "From Library"/"Inline Action" add; embeds InlineActionEditor; `getActionName`/`getActionType` fallbacks per TS.
- **`UI/Flows/FlowEditor.swift`** — `FlowDefinition` create/edit: name/description/project/inputs + FlowActionList. Symmetric dirty-check via `snapshotKey` over decode→normalize→encode. Validation ports TS exactly (name; ≥1 action; per-inline name/prompt + type-match; per-input id non-empty + `^[a-zA-Z0-9_-]+$` + label non-empty(trimmed); unique ids). Save encodes entries via FlowActionEntryCodec, inputs nil-if-empty.
- **`UI/Flows/FlowManagementDialog.swift`** — master/detail: AppSegmentedTabs Actions/Flows + project filter + list + FlowEditor/ActionEditor detail. `referencingFlowsByActionId` (via FlowActionEntryCodec.decode; inline entries excluded) blocks action delete with "Used by N flow(s)". Mounted as a `.sheet` in `AppShell` on the existing `UIViewModel.flowManagementOpen` flag (already toggled by the 5B SidebarToolbar button).

**Schedule views (build + dogfood):**
- **`UI/Schedules/ScheduleForm.swift`** + UI-local `enum ScheduleSavePayload { create, update }` — port of `ScheduleForm.tsx`. All field visibility gates faithful (Project create-only; Action `__none__` sentinel; Type `__default__`+six(incl. **pi**)+shell, only when `!useAction`; Name/Prompt when `!useAction`; rate/cron + next-run preview; AgentOptionsFormView when `!useAction && agentType != ""/shell`; timeout; lastError banner). `canSave` ports TS; dirty-check symmetric via `ScheduleHelpers.dirtyKey`. Reads `Schedule.agentType` (AnyCodable) via `.value` `.string` match; writes back via `AnyCodable(.string(...))`.
- **`UI/Schedules/ScheduleManagementDialog.swift`** — master/detail: project filter + list (status dot, name/prompt fallback, expression·relative-time, action/project badges, enable toggle, Run-now/Delete menu) + ScheduleForm. **Update routing (verified):** toggle → `update(_:)`; form `.update` → `update(formPayload:)`; `.create` → `create`. Mounted as a `.sheet` in `AppShell` on the existing `scheduleManagementOpen` flag.

## Key finding — schedule:update clear-semantics

The backend `schedule:update` handler uses **key-presence**: a key ABSENT from the payload = "leave unchanged"; a key present as JSON `null` = "clear". Swift's `JSONEncoder` omits nil optionals (absent, not null), so default encoding cannot clear `actionId`/`agentType`/`agentOptions`. Solution (after rejecting a module-wide `encode(to:)` override that would have corrupted the partial-update toggle): a dedicated **`ScheduleViewModel.update(formPayload:)`** that post-processes the encoded dict to set `NSNull()` for exactly those three keys when absent. The plain `update(_:)` is unchanged and is used for partial updates (the enable/disable toggle), so absent fields are left unchanged there.

## Scope decisions honored (deferred, NOT built — documented in the plan)

- **FlowInputDialog → 5F.** Flow-input collection before a run stays a 5F seam (the `RunMenuViewModel.onStartFlow` input branch is untouched).
- **FlowPanel (live run viewer) → later flows-runtime unit.** The `AppShell` `flowPanelOpen` slot remains `panelPlaceholder`. `FlowViewModel.activeRuns` + all run controls already exist; the viewer + artifact-save + session-tab-focus integration were out of 5D scope.
- **"Run with options…" AgentOptionsDialog → 5F** (`onRunTabWithOptions` seam untouched).
- **Fetched model dropdowns → 5E** (`cursor:models`/`opencode:models`/`pi:models` RPC). The fragments use free-text `model` fields as-is.

## Deferred minors (acceptable debt — opus review triaged all as keep-as-debt)

Test-coverage gaps (no dedicated round-trip-stability test for FlowActionEntryCodec; some normalize/helper branches exercised by analysis not unit tests); per-call regex/ISO8601 formatter allocation in ScheduleHelpers (negligible at dialog scale); `gemini.sandbox false→nil` vs TS keeping false (symmetric in dirty-key, omitted-default at save → equivalent); index-keyed `inputRow` ForEach (TS-parity; possible focus flicker on mid-array removal); two chained `.sheet`s on AppShell (flags mutually exclusive). Full list in `.superpowers/sdd/progress.md`.

## Verification

- **Code gate met:** `swift build` clean; **232 swift tests / 0 failures** (controller-verified at `a5f50ac`). +25 new tests this phase (207 → 232).
- **LIVE in-app visual = HUMAN DOGFOOD** (isolation-sensitive — not run autonomously). Checklist: launch `native/.build/app/TaskflowDev.app`; from the sidebar toolbar open **Flows** → create an inline-action flow + a library-reference flow; edit/reorder (up/down)/delete; add a flow input; confirm action delete is blocked when referenced. Open **Schedules** → create a `rate(...)` schedule + an action-backed schedule; confirm next-run preview; toggle enabled (confirm it does NOT clear the action/agent — the routing fix); Run-now; edit an existing schedule and CLEAR its action/agent (confirm it actually clears, via `update(formPayload:)`); delete. Confirm live `.scheduleUpdated` updates and agent-options round-trip across both dialogs.

## Next

Sub-plan **5E Settings + Appearance** (master-plan 5.4 + 5.7): multi-tab settings modal + model selects + agent options (reuse the 5A fragments / the 5D `AgentOptionsFormModel`) + appearance theme grid/fonts/import + the deferred fetched-model dropdowns. Then **5F** command-palette + shortcuts + dialog-host (incl. the 5B/5D-deferred sidebar modals: NewTask/NewProject/MissingLocation/Update/AgentOptions/**FlowInput**/project Fork).

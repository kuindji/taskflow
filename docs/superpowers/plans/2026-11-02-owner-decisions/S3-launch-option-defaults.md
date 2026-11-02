# S3 — "Default" means the Settings value (A16 R3-2)

Decision (owner's words): "Default means what was set in Settings →
Claude/Codex/etc. There is default model, default effort/reasoning, bypass
permissions, all that stuff. These settings should be chosen by default when
other value is not provided."

The backend already behaves this way: an omitted launch field is filled from
the machine's per-agent Settings. The bug is the labels: e.g. Codex
"Model default (high)" while Settings says `xhigh` launches `xhigh`.

Work:
- Find every launch-option control that offers a "default" choice: UI
  `packages/ui/src/components/shared/CodexOptions.tsx:195` ("Model default"),
  `ClaudeOptions.tsx:64,78` ("Default"), `schedules/ScheduleForm.tsx:326`
  (`__default__`), `workspace/AgentOptionsPanel.tsx`, the other agents'
  option components, and the TUI equivalents (grep `default` in
  `packages/tui/src` option/launch code).
- Label each as the Settings value it will use for that machine, e.g.
  `Default (xhigh, from Settings)`; when Settings has no value for that field
  either, say what then happens (the CLI's own default) without inventing a
  number. Read the value from the same per-backend settings the backend uses
  (`useSettingsStore` `byBackend[backendId]`); the dialog's machine, not the
  local one.
- Do not change what is sent: "Default" stays an omitted field. No new
  sentinel.
- Review round 1 found the shared `AgentOptionsPanel` does not do that
  today: it prefills every field from Settings
  (`AgentOptionsPanel.tsx:96-175`) and its `build*Options` emit those
  concrete values (`:255` on). Saved actions, flow steps and schedules
  (`ActionEditor`, `InlineActionEditor`, `BuiltinActionEditor`,
  `ScheduleForm`, `NewTaskDialog` all use the panel) therefore store the
  Settings value of the day as an explicit override, and a later Settings
  change does not reach them. Track per field whether the value is inherited
  or chosen. Inherited fields show the Settings value in the label and are
  omitted from the payload. Stored values load as chosen; absent ones as
  inherited.
- Codex's supported-effort list and effort fallback resolve an empty model
  to the CLI's `isDefault` model (`CodexOptions.tsx:112-140`). Once model
  can be inherited, resolve it to the Settings model first, then the CLI
  default.
- `CodexOptions` (and any other shared options component) also renders the
  Settings page itself in `mode="defaults"` (`CodexSection.tsx:40`). There,
  "default" means the CLI's own default; keep that label and give
  session-mode controls the "from Settings" label.
- Check the backend really fills every omitted field from Settings for every
  agent and every launch path (Run with options, saved actions, flow steps,
  schedules, `taskflow-cli agent run`). Any path that does not is a bug in
  scope here: make it use Settings.

Tests: label tests for one UI options component and the TUI equivalent with
a Settings value set and unset; both label modes of `CodexOptions`;
saving an action with an inherited field, then changing Settings, launches
the new value; Codex effort list follows the Settings model; backend test
for any launch path fixed.

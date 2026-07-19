# Add Kimi Code Agent Support

**Date:** 2026-07-19
**Branch:** `main`
**Task:** Add Kimi Code (`kimi`, Moonshot AI) as a supported CLI coding agent in taskflow, alongside Claude, Codex, OpenCode, Gemini, Cursor, and Pi. Additionally, close the integration gaps Pi left open (New Task dialog, flow action editors, tray activity tracking) for both Pi and Kimi.

## Background

Kimi Code is Moonshot AI's terminal coding agent. The binary is `kimi` (installed under `~/.kimi-code/bin`, a Node SEA executable, currently v0.27.0). Models are configured as provider-scoped aliases (e.g. `kimi-code/k3`) and enumerable via `kimi provider list --json`, which emits clean JSON on stdout.

Relevant CLI surface (verified against v0.27.0 `--help` and the official docs):

| Flag | Effect |
| --- | --- |
| `-m, --model <alias>` | Model alias for this launch |
| `--auto` | Auto permission mode (approvals handled automatically) |
| `-y, --yolo` | Auto-approve all tool calls |
| `--plan` | Start in Plan mode |
| `-p, --prompt <p>` | Non-interactive single prompt (no TUI) |
| `-S` / `-c` | Resume / continue sessions |
| `--skills-dir <dir>` | **Replaces** auto-discovered skill directories |

Two capabilities every other integrated agent has are **absent** in kimi:

1. **No system-prompt injection channel.** No `--append-system-prompt` (Claude/Pi), no per-launch config override like Codex's `-c skills.config=...`, no env-var file pointer like Gemini's `GEMINI_SYSTEM_MD`, no env-based config like OpenCode's `OPENCODE_CONFIG_CONTENT`. Kimi's only instruction inputs are AGENTS.md files (global or project tree) and skill directories — both are persistent, user-owned locations, not per-session channels.
2. **No interactive initial prompt.** `-p` is non-interactive-only and is rejected in combination with `--auto`/`--yolo`/`--plan`. Nothing analogous to Gemini's `--prompt-interactive`.

Both are solved with **PTY input injection** (see Architecture).

## Non-goals

- **`--plan` mode.** Not exposed in launch options (user decision). Users can switch modes inside the TUI.
- **Session resume** (`-S`, `--continue`). Taskflow always starts fresh sessions; same as every other agent.
- **Thinking/effort control.** Kimi has no CLI flag for it (only `KIMI_MODEL_THINKING_EFFORT` env for custom providers); out of scope.
- **Writing AGENTS.md or skill files into the user's project or kimi home.** `AGENTS.md` / `.kimi-code/AGENTS.md` are not taskflow-namespaced (unlike `.cursor/rules/taskflow.mdc`), so writing them risks clobbering user files. `--skills-dir` replaces the user's own skill discovery. `config.toml` mutation is invasive. All rejected.
- **`taskflow-cli agent run` kimi-specific flags.** The generic `--model` flag already flows through; permission mode via CLI can come later if needed (Pi has the same scope).
- **Persistent model-list caching.** `kimi provider list --json` runs a local process; fetch on dropdown mount like Pi/OpenCode.
- **Per-model capability gating in the UI.**

## User-facing changes

1. Kimi appears everywhere agents are offered — run menus, agent dropdown, settings favorites, New Task dialog, flow action editors — with a "K" glyph icon and the label "Kimi". Availability follows each surface's existing behavior: availability-gated menus omit undetected agents, while the New Task dialog and Defaults section show them disabled with a "(not installed)" note.
2. Session options panel for Kimi exposes two controls:
   - **Model** — dropdown populated asynchronously from `kimi provider list --json`. Rows show the model `displayName` (e.g. "K3") with the alias id (`kimi-code/k3`) and context size (e.g. "256K") as muted secondary text. Stores the alias into `KimiLaunchOptions.model` → passed as `--model`.
   - **Permission mode** — select with `manual` (default; no flag, approve in TUI), `auto` (`--auto`), `yolo` (`--yolo`). The CLI rejects `--auto` + `--yolo` together; a single select makes that unrepresentable.
3. A Kimi tab in the settings modal with the same two controls as app-level defaults, inherited by new sessions via `settingsToAgentOptions()`.
4. Pi becomes selectable in the New Task dialog and flow action editors (it previously wasn't), and Pi/Kimi sessions participate in tray activity tracking.

## Architecture

### Types and constants (packages/shared)

```ts
// types/agent.ts
type KimiPermissionMode = "manual" | "auto" | "yolo";

interface KimiLaunchOptions {
    type: Extract<AgentType, "kimi">;
    /** Model alias key from `kimi provider list --json`, e.g. "kimi-code/k3" — passed to `--model`. */
    model?: string;
    permissionMode?: KimiPermissionMode;
}

interface KimiModelInfo {
    /** Alias key, e.g. "kimi-code/k3". */
    id: string;
    /** e.g. "K3". */
    displayName: string;
    /** Display-only string derived from maxContextSize, e.g. "256K". */
    contextWindow: string;
}
```

- `AgentType` union, `ALL_AGENT_TYPES`, `AGENT_DISPLAY_NAMES` (`kimi: "Kimi"`), `AgentLaunchOptions` union.
- `types/settings.ts`: `KimiSettings { defaultModel: string; permissionMode: KimiPermissionMode }`, wired into `AppSettings` and `SettingsUpdatePayload`.
- `constants.ts`: `MSG.KIMI_MODELS: "kimi:models"`.
- `types/ws.ts`: `KimiModelsResponse`, `SessionCreatePayload` union; `types/flow.ts` / `types/task.ts` session-type unions.

### Launch spec (packages/backend/services/internal-agent-skill.ts)

`buildAgentLaunchSpec` gains a `kimi` branch **and a new optional return field** `initialInput?: string`:

```ts
if (type === "kimi") {
    const optionArgs: string[] = [];
    if (agentOptions?.type === "kimi") {
        if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        if (agentOptions.permissionMode === "auto") optionArgs.push("--auto");
        else if (agentOptions.permissionMode === "yolo") optionArgs.push("--yolo");
    }
    return {
        command: "kimi",
        args: optionArgs,
        env: { KIMI_CODE_NO_AUTO_UPDATE: "1" },
        initialInput: prompt ? `${systemPrompt}\n\n---\n\n${prompt}` : undefined,
    };
}
```

- The composite Taskflow system prompt (base block + inlined SKILL.md with absolute-path doc references + scope block + project/flow context) cannot be delivered out-of-band, so it is prepended to the first user message. Kimi's `Read` tool opens the referenced split command docs on demand, same as Claude/Pi.
- Sessions created **without a prompt** get no injection at all — a plain interactive kimi session (user decision). This means promptless interactive Kimi sessions are not taskflow-aware; tasks, flows, actions, and schedules always carry prompts and are unaffected.
- `KIMI_CODE_NO_AUTO_UPDATE=1` prevents the update preflight from blocking or repainting the TUI around injection time.

### PTY prompt injection (packages/backend/services/pty-manager.ts)

`SpawnOptions` gains `initialInput?: string`. When set, `PtyManager.spawn` watches the output stream and writes the input once the TUI is ready:

- **Readiness heuristic:** after the first output chunk, wait for a quiet window (no output for ~500 ms), then inject; hard cap ~10 s after spawn, inject anyway.
- **Write format:** bracketed paste (`\x1b[200~` + text + `\x1b[201~`) so multiline prompts don't submit line-by-line, followed by `\r` (after a ~50 ms tick) to submit.
- Injection is one-shot and cancelled if the session exits first.

Precedent: `worktree-setup.ts` already writes commands into session PTYs via `ptyManager.write`. The heuristic lives in `pty-manager` so `session-lifecycle` just forwards `spec.initialInput`. The exact timings are tuned during implementation against the real kimi TUI (including verifying paste + submit behavior manually).

### Runtime detection and model listing (packages/backend/services/runtime-detector.ts)

- `KNOWN_AGENTS` += `"kimi"`; version probe `kimi --version` (prints `0.27.0` to stdout).
- `parseKimiModelsOutput(json: string): KimiModelInfo[]` — parses `kimi provider list --json`; for each entry of the `models` map: `id` = key, `displayName` (falls back to the model field or key), `contextWindow` = `maxContextSize` formatted as `${Math.round(n / 1024)}K`. Malformed JSON → `[]`.
- `fetchKimiModels()` runs `kimi provider list --json` through the existing CLI runner (stdout/stderr fallback already built in).
- `index.ts`: import + register `MSG.KIMI_MODELS`; scheduled-session type union.

### Session lifecycle and settings (packages/backend)

- `session-lifecycle.ts`: `CreateSessionOpts` union; `settingsToAgentOptions` `case "kimi"` (maps `defaultModel`/`permissionMode`); explicit-vs-default merge case; `getDefaultSessionLabel` → "Kimi"; forward `spec.initialInput` into the PTY spawn.
- `isAutonomousAgent`: kimi counts as autonomous when `permissionMode` is `auto` or `yolo` (parallel to cursor's `yolo` / codex's bypass), so `PROMPT_AUTONOMOUS` is appended for unattended runs.
- `settings-store.ts`: `DEFAULTS.kimi = { defaultModel: "", permissionMode: "manual" }`; create/load-merge/applyNullable blocks.

### UI (packages/ui)

- **`KimiIcon.tsx`** — from `~/Downloads/k-only-{dark,light}.svg` (already K-only marks, viewBox `0 0 24 25`): one component, K-body path `fill="currentColor"` (the two files differ only by white/black body), blue `#1783FF` accent square kept. Registered in `tab-constants.ts` `AGENT_META` + `tabVariants`.
- **`KimiModelSelect.tsx`** — async dropdown over `MSG.KIMI_MODELS` (pattern: `PiModelSelect`).
- **`KimiSection.tsx`** + `SettingsModal` wiring (section key, label, update handlers).
- **`AgentOptionsPanel.tsx`** — `KimiOptions` sub-component (model + permission mode), settings selector, reset-to-defaults branch, `buildKimiOptions`.
- Small `case "kimi"` additions: `normalize-agent-options.ts` (keep only valid fields, validate `permissionMode` against the const list), `session-helpers.ts` (union, label, predicate), `TabContent.tsx`, `Workspace.tsx`, `TaskCreationDialogHost.tsx`.

### Gap closure (Pi + Kimi together)

- **`NewTaskDialog.tsx`** — add `piAvailable`/`kimiAvailable` flags, guards, and `SelectItem`s to the "start immediately with" dropdown.
- **`ActionEditor.tsx`** — `buildActionAgentOptions` cases for `pi` and `kimi`; Session-Type `SelectItem`s for both. Same for **`InlineActionEditor.tsx`**.
- **`tray-state-tracker.ts`** — include `pi` and `kimi` in the `supportsActivity` chain.

## Error handling

- `kimi` missing from `PATH` → standard availability flow hides it from menus (no special handling).
- `kimi provider list --json` failing or emitting malformed JSON → `parseKimiModelsOutput` returns `[]`; the model dropdown shows its existing empty/error state; sessions still launch (model flag simply omitted → kimi uses its own `default_model`).
- TUI never producing output → the 10 s cap injects anyway; if the process already exited, injection is skipped.

## Testing

- `parseKimiModelsOutput` unit tests: real captured JSON, empty object, malformed JSON, missing `displayName`/`maxContextSize`.
- `buildAgentLaunchSpec` kimi cases: flag mapping (manual/auto/yolo, model), `initialInput` composition with/without prompt, `KIMI_CODE_NO_AUTO_UPDATE` env.
- PTY injection: test the readiness/quiet-window logic with real short-lived PTY processes in the existing `pty-manager` test suite (inject-after-quiet, no-injection-without-input, cancel-on-close); manual end-to-end check against the real kimi TUI (multiline paste, submit, `--auto` mode).
- Update any exhaustive-switch/type assertions that the union extension breaks.

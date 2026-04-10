# Add Pi Agent Support

**Date:** 2026-04-10
**Branch:** `task/add-pi-agent-support`
**Task:** Add Pi (`@mariozechner/pi-coding-agent`) as a supported CLI coding agent in taskflow, alongside Claude, Codex, OpenCode, Gemini, and Cursor.

## Background

Pi is a minimal terminal coding harness by Mario Zechner. The binary is `pi`, installed via `npm install -g @mariozechner/pi-coding-agent`. It supports 15+ model providers and hundreds of models through a single `--model` flag accepting `provider/id` tokens.

The goal is to plug Pi into taskflow's existing agent abstraction so that users can spawn Pi inside task sessions the same way they spawn Claude or Codex today — picking a model and thinking level, optionally restricting tools, and having taskflow inject its own system prompt and CLI skill.

## Non-goals

- Pi's non-interactive modes (`-p` print, `--mode json`, RPC). Taskflow runs agents as interactive TUI programs inside a PTY; Pi is integrated in its default interactive mode only.
- Exposing every Pi CLI flag. The options panel surfaces the three that matter for per-session control (`--model`, `--thinking`, `--tools`) plus taskflow's system-prompt injection. Everything else (`--extension`, `--skill`, `--theme`, `--continue`, `--resume`, `--system-prompt`, `--offline`, etc.) is out of scope — Pi's own settings file and in-session slash commands cover those cases.
- Permission modes / approval policies / sandboxing. Pi's design philosophy deliberately omits permission popups; there is no analogue to Claude's `permissionMode` or Codex's `approvalPolicy`. The closest affordance is restricting `--tools`, which we expose as a free-form text field.
- Per-model feature gating in the UI (e.g. disabling the thinking dropdown when the selected model reports `supportsThinking === false`). Pi silently ignores `--thinking` on unsupporting models, so the extra wiring is not worth the complexity for a first cut.
- Persistent caching of the model list. The fetch runs a local process and is cheap; mirror OpenCode's policy of fetching on dropdown mount and holding the result in component-local state.

## User-facing changes

1. Pi appears in the agent picker when a user creates a session, with a π-glyph icon and the label "Pi". Only visible when `pi` is detected on `PATH`.
2. The session options panel for Pi exposes three controls:
   - **Model** — a dropdown populated asynchronously from `pi --list-models`. Each row shows `${provider}/${id}` with `{contextWindow} ctx` and `thinking` / `images` capability badges as muted secondary text. Selecting a row stores `${provider}/${id}` into `PiLaunchOptions.model`.
   - **Thinking** — a dropdown with the values `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. `off` is the default and omits the flag at spawn time.
   - **Tools** — a free-form text field pre-filled with `read,bash,edit,write,grep,find,ls` (the full set of Pi built-in tools). If the user clears it, the `--tools` flag is omitted and Pi uses its own 4-tool default (`read,bash,edit,write`). If the user edits the value, that verbatim string is passed to `--tools`.
3. A Pi tab appears in the settings modal, with the same three controls bound to app-level defaults. New sessions inherit these defaults via `settingsToAgentOptions()`.

## Architecture

Taskflow's agent abstraction is a discriminated-union plus a central `buildAgentLaunchSpec(type, prompt, skillPath, agentOptions, …)` function in `packages/backend/src/services/internal-agent-skill.ts`. Each agent owns a branch that assembles `{ command, args, env? }`, which the PTY layer spawns.

Adding Pi means adding a new variant to the union (`PiLaunchOptions`) and a new branch to `buildAgentLaunchSpec`. Supporting files (detection, session lifecycle, UI components, settings) follow the exact same per-agent recipe already used for Gemini, Cursor, and OpenCode.

### System prompt and skill handling

`buildSystemPrompt(...)` returns a composite string: a base block ("You are running inside Taskflow..."), the **full inlined contents of `SKILL.md`** with `@taskflow-cli-*.md` references rewritten to absolute paths, and a scope block (task / project / flow). The skill content is already embedded inside the system prompt — `skillPath` is only used by agents that natively load skill files (Codex, OpenCode).

Pi has a native `--skill` flag, but using it alongside `--append-system-prompt` would duplicate the skill content. Instead, Pi follows the **Claude-style** pattern:

- Pass `--append-system-prompt <systemPrompt>` with the full composite prompt (including the inlined skill).
- No `--skill` flag.
- Pi's default `read` tool lets the agent open the absolute-path-referenced split command files (`taskflow-cli-task-commands.md`, etc.) on demand.

This mirrors Claude's integration one-to-one and avoids the Codex-style duplication.

### Pi launch argument assembly

```ts
if (type === "pi") {
    const optionArgs: string[] = [];
    if (agentOptions?.type === "pi") {
        if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        if (agentOptions.thinking && agentOptions.thinking !== "off")
            optionArgs.push("--thinking", agentOptions.thinking);
        if (agentOptions.tools?.trim())
            optionArgs.push("--tools", agentOptions.tools.trim());
    }
    return {
        command: "pi",
        args: [
            ...optionArgs,
            "--append-system-prompt", systemPrompt,
            ...(prompt ? [prompt] : []),
        ],
    };
}
```

Notes:
- `thinking === "off"` is omitted — Pi's default is off anyway, and skipping matches how the Claude branch treats `permissionMode === "default"`.
- An empty or whitespace-only `tools` field is omitted rather than passed as an empty string.
- The initial prompt (if any) is appended as a trailing positional argument; Pi accepts messages in that position directly (`pi [options] [messages...]`), no `--` separator needed.
- No Pi-specific environment variables are set. Global `PATH` enrichment is already handled.

### Model list fetch

Mirrors OpenCode's pipeline end-to-end.

**Backend** (`runtime-detector.ts`):

```ts
export async function fetchPiModels(): Promise<PiModelInfo[]> {
    const output = await runCliCommand("pi", ["--list-models"]);
    if (!output) return [];
    const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    return lines.slice(1).map((line) => {
        const cols = line.split(/\s{2,}/);
        const [provider, id, contextWindow, maxOutput, thinking, images] = cols;
        return {
            provider,
            id,
            contextWindow,
            maxOutput,
            supportsThinking: thinking === "yes",
            supportsImages: images === "yes",
        };
    }).filter((m) => m.provider && m.id);
}
```

The header row is "provider  model  context  max-out  thinking  images" — columns separated by ≥2 spaces. The parser splits on `\s{2,}`, skips the header, filters out rows missing provider or id, and converts `yes`/`no` columns to booleans. `contextWindow` and `maxOutput` are kept as display strings (e.g. `"272K"`) because the UI renders them verbatim and parsing to token counts is lossy and unnecessary.

**Shared** (`constants.ts`, `types/ws.ts`):

```ts
// constants.ts
PI_MODELS: "pi:models",

// types/ws.ts
export interface PiModelsResponse {
    models: PiModelInfo[];
}
```

**Backend IPC** (`index.ts`): register a `WS_MESSAGES.PI_MODELS` handler next to the OpenCode one, returning `{ models: await fetchPiModels() }`.

**UI** (`components/settings/PiModelSelect.tsx`): lazy-fetches on mount, shows a loading state, renders the dropdown. Component-local state holds the result for its lifetime. No persistent cache.

## Data types

### `packages/shared/src/types/agent.ts`

```ts
type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";

const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi"];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    // existing entries…
    pi: "Pi",
};

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PiLaunchOptions {
    type: Extract<AgentType, "pi">;
    model?: string;                // assembled as "${provider}/${id}"
    thinking?: PiThinkingLevel;
    tools?: string;                // comma-separated; empty/undefined → flag omitted
}

interface PiModelInfo {
    provider: string;
    id: string;
    contextWindow: string;         // display string, e.g. "272K"
    maxOutput: string;             // display string, e.g. "128K"
    supportsThinking: boolean;
    supportsImages: boolean;
}

type AgentLaunchOptions =
    | ClaudeLaunchOptions
    | CodexLaunchOptions
    | OpenCodeLaunchOptions
    | GeminiLaunchOptions
    | CursorLaunchOptions
    | PiLaunchOptions;
```

Exports updated accordingly.

### `packages/shared/src/types/settings.ts`

```ts
interface PiSettings {
    model?: string;
    thinking?: PiThinkingLevel;
    tools?: string;
}

interface AppSettings {
    // …
    pi?: NullablePartial<PiSettings>;
}

interface SettingsUpdatePayload {
    // …
    pi?: NullablePartial<PiSettings>;
}
```

## File-level change list

| Kind | File | Change |
|---|---|---|
| shared | `types/agent.ts` | add `"pi"` to `AgentType` / `ALL_AGENT_TYPES` / `AGENT_DISPLAY_NAMES`; add `PiThinkingLevel`, `PiLaunchOptions`, `PiModelInfo`; extend `AgentLaunchOptions` union; update exports |
| shared | `types/ws.ts` | add `PiModelsResponse` |
| shared | `types/settings.ts` | add `PiSettings`, `AppSettings.pi`, `SettingsUpdatePayload.pi` |
| shared | `constants.ts` | add `PI_MODELS: "pi:models"` |
| backend | `services/runtime-detector.ts` | add `"pi"` to `KNOWN_AGENTS`; add `fetchPiModels` |
| backend | `services/internal-agent-skill.ts` | extend `buildAgentLaunchSpec` type param; add `"pi"` branch |
| backend | `services/session-lifecycle.ts` | add `"pi"` to `CreateSessionOpts` union, `settingsToAgentOptions`, `getDefaultSessionLabel` |
| backend | `index.ts` | import `fetchPiModels`; register `PI_MODELS` handler |
| backend tests | `tests/services/runtime-detector.test.ts` | fixture-based test for `fetchPiModels` parser |
| ui (new) | `components/icons/PiIcon.tsx` | π-glyph SVG icon |
| ui (new) | `components/settings/PiModelSelect.tsx` | async model dropdown |
| ui (new) | `components/shared/PiOptions.tsx` | per-session options panel (model / thinking / tools) |
| ui (new) | `components/settings/sections/PiSection.tsx` | settings-level defaults tab |
| ui | `components/settings/SettingsModal.tsx` | add `"pi"` to `SectionKey`; import and register Pi tab |
| ui | `components/workspace/AgentOptionsPanel.tsx` | render `<PiOptions />` for `type === "pi"` |
| ui | `lib/normalize-agent-options.ts` | add `"pi"` case: narrow unknown payload, validate `thinking` against enum, coerce `model` / `tools` to strings |
| ui | `components/workspace/tab-constants.ts` | import `PiIcon`; add `pi: { icon: PiIcon, colorClass: "text-primary" }` entry to the agent-meta record |

Total: 4 new shared entries, 5 backend edits, 1 backend test, 4 new UI files, 4 UI edits — **~18 touch points**, all small and pattern-matching existing agents.

## Testing strategy

- **Unit:** `fetchPiModels` parser test using a captured fixture of real `pi --list-models` output. This is the only piece with non-trivial logic.
- **Manual end-to-end:** spawn a Pi session from the UI in a test task worktree with a selected model and verify:
  1. The correct command line is sent to the PTY (inspect taskflow logs).
  2. Pi launches, the taskflow system prompt is visible, and `taskflow-cli task` works from inside the Pi session.
  3. Changing the thinking level and tools fields between sessions takes effect.
  4. The model dropdown populates and the selected `provider/id` is propagated.
- **No new UI unit tests.** The existing suite doesn't have per-agent UI tests for Gemini, Cursor, or OpenCode; adding them only for Pi would introduce an inconsistent precedent.

## Open questions

None. All clarifying questions (mode, flag scope, model dropdown shape, system-prompt vs. skill channel) have been resolved during brainstorming.

# "Don't Ask Questions" Autonomous Agent Mode

## Problem

When agents are launched with `fullAccess` enabled, they still ask clarifying questions via text output. The `fullAccess` flag only suppresses tool permission prompts, not the LLM's tendency to ask before acting. Users need a way to make agents fully autonomous — no permission prompts and no clarifying questions.

## Solution

Add a `dontAskQuestions` boolean to all agent launch options and settings. When enabled, it:

1. Forces `fullAccess` behavior (applies the agent's full-access CLI flag)
2. Appends an autonomous-mode instruction to the system prompt

## Autonomous Prompt

Defined as a constant `PROMPT_AUTONOMOUS` in `internal-agent-skill.ts` alongside the other `PROMPT_*` constants:

> "Do not ask clarifying questions. Do not ask for confirmation. Make reasonable assumptions and proceed autonomously. If something is ambiguous, choose the most likely interpretation and act on it."

This prompt is agent-agnostic — the same text is used for all agent types.

## System Prompt Delivery

Agents receive system prompts through different mechanisms:

| Agent | Delivery mechanism |
|-|-|
| **Claude** | `--append-system-prompt` flag in `buildAgentLaunchSpec` |
| **Codex** | `developer_instructions` config in `buildAgentLaunchSpec` |
| **OpenCode** | `config.instructions` file array in `buildAgentLaunchSpec` |
| **Gemini** | File written by `ensureGeminiSystemFile()` in `session-lifecycle.ts`, passed via `GEMINI_SYSTEM_MD` env var |
| **Cursor** | File written by `ensureCursorRulesFile()` in `session-lifecycle.ts` |

Since Gemini and Cursor receive their system prompt via `additionalPrompt`/`systemPrompt` parameter in `session-lifecycle.ts` (before `buildAgentLaunchSpec` is called), the autonomous prompt must be appended at the `session-lifecycle.ts` level, not inside `buildAgentLaunchSpec`.

**Strategy:** In `session-lifecycle.ts`, when `agentOptions.dontAskQuestions` is true, append `PROMPT_AUTONOMOUS` to the `systemPrompt` variable before it is passed to `ensureGeminiSystemFile()`, `ensureCursorRulesFile()`, and `buildAgentLaunchSpec()`. This ensures all agents receive it through their native channels.

## Changes

### Types — `packages/shared/src/types/agent.ts`

Add `dontAskQuestions?: boolean` to each launch options interface:

- `ClaudeLaunchOptions`
- `CodexLaunchOptions`
- `OpenCodeLaunchOptions`
- `GeminiLaunchOptions`
- `CursorLaunchOptions`

### Settings Types — `packages/shared/src/types/settings.ts`

Add `dontAskQuestions: boolean` to each agent settings interface:

- `ClaudeSettings`
- `CodexSettings`
- `OpenCodeSettings`
- `GeminiSettings`
- `CursorSettings`

### Settings Store — `packages/backend/src/services/settings-store.ts`

Add `dontAskQuestions: false` to each agent's defaults in `DEFAULTS`.

### Launch Spec — `packages/backend/src/services/internal-agent-skill.ts`

- Define `PROMPT_AUTONOMOUS` constant alongside other `PROMPT_*` constants
- Export `PROMPT_AUTONOMOUS` so `session-lifecycle.ts` can import it
- In `buildAgentLaunchSpec`, when `agentOptions.dontAskQuestions` is true, apply the same CLI flags as `fullAccess` (e.g., `--dangerously-skip-permissions` for Claude, `--full-auto` for Codex, `--yolo` for Gemini/Cursor, permission JSON for OpenCode)

### Session Lifecycle — `packages/backend/src/services/session-lifecycle.ts`

When `agentOptions.dontAskQuestions` is true, append `PROMPT_AUTONOMOUS` to the `systemPrompt` variable before passing it to:
- `ensureCursorRulesFile(cwd, systemPrompt)`
- `ensureGeminiSystemFile(config.agentSkillsDir, !task, systemPrompt)`
- `buildAgentLaunchSpec(..., systemPrompt, ...)`

This ensures all agents receive the autonomous prompt through their native delivery mechanism.

### UI — `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`

- Add a "Don't ask questions" `Switch` below the existing "Full access" switch
- When "Don't ask questions" is toggled on: force `fullAccess` on and disable the `fullAccess` switch
- When "Don't ask questions" is toggled off: re-enable the `fullAccess` switch, restoring it to its previous/default value
- Emit `dontAskQuestions` in the options object via `emitChange` and `handleRun`

### UI — Settings Modal

- Add the same "Don't ask questions" toggle in each agent's settings section
- Same forcing behavior: enabling it forces and disables the `fullAccess` toggle

### Tests — `packages/backend/tests/services/internal-agent-skill.test.ts`

- Test that `dontAskQuestions: true` applies full-access flags for each agent type
- Test that the autonomous prompt is appended to the system prompt
- Test that `dontAskQuestions: true` without explicit `fullAccess` still produces full-access flags

## Behavior Summary

| `dontAskQuestions` | `fullAccess` | Result |
|-|-|-|
| `false` | `false` | Default restricted mode |
| `false` | `true` | Full access, agent may still ask questions |
| `true` | `false` | Treated as full access + autonomous prompt |
| `true` | `true` | Full access + autonomous prompt |

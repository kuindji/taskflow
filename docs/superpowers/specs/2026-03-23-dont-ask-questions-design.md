# "Don't Ask Questions" Autonomous Agent Mode

## Problem

When agents are launched with `fullAccess` enabled, they still ask clarifying questions via text output. The `fullAccess` flag only suppresses tool permission prompts, not the LLM's tendency to ask before acting. Users need a way to make agents fully autonomous — no permission prompts and no clarifying questions.

## Solution

Add a `dontAskQuestions` boolean to all agent launch options and settings. When enabled, it:

1. Forces `fullAccess` behavior (applies the agent's full-access CLI flag)
2. Appends an autonomous-mode instruction to the system prompt

## Autonomous Prompt

Appended to the system prompt when `dontAskQuestions` is true:

> "Do not ask clarifying questions. Do not ask for confirmation. Make reasonable assumptions and proceed autonomously. If something is ambiguous, choose the most likely interpretation and act on it."

This prompt is agent-agnostic — the same text is used for all agent types.

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

In `buildAgentLaunchSpec`, when `agentOptions.dontAskQuestions` is true:

- Apply the same CLI flags as `fullAccess` (e.g., `--dangerously-skip-permissions` for Claude, `--full-auto` for Codex, `--yolo` for Gemini/Cursor, permission JSON for OpenCode)
- Append the autonomous prompt constant to the system prompt

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

# OpenCode Agent Support — Design Spec

## Overview

Add OpenCode (https://opencode.ai, repo: sst/opencode) as a third agent alongside Claude and Codex. OpenCode is an AI coding agent CLI that supports 75+ model providers via a `provider/model` format, config-based permissions, and an `instructions` config for system prompt injection.

## Architecture

The integration follows the exact same patterns used by Claude and Codex agents. Every location that currently branches on `"claude" | "codex"` gets a `"opencode"` branch.

### Shared Types (`packages/shared/src/types/`)

**`agent.ts`**
- Extend `AgentType` to `"claude" | "codex" | "opencode"`
- Add `OpenCodeLaunchOptions`:
  ```ts
  interface OpenCodeLaunchOptions {
      type: Extract<AgentType, "opencode">;
      fullAccess?: boolean;
      model?: string; // free-text "provider/model" format
  }
  ```
- Extend `AgentLaunchOptions` union to include `OpenCodeLaunchOptions`
- Export new types

**`task.ts`** — Add `"opencode"` to `SessionRef.type` literal union.

**`ws.ts`** — Add `"opencode"` to `SessionCreatePayload.type` literal union.

**`settings.ts`**
- Add `OpenCodeSettings`:
  ```ts
  interface OpenCodeSettings {
      defaultModel: string; // "provider/model" or empty for opencode's default
      fullAccess: boolean;
  }
  ```
- Add `opencode: OpenCodeSettings` to `AppSettings`
- Add `opencode?: Partial<OpenCodeSettings>` to `SettingsUpdatePayload`

### Backend (`packages/backend/src/`)

**`services/runtime-detector.ts`**
- Add `"opencode"` to `KNOWN_AGENTS` array.
- Binary lookup uses `Bun.which("opencode", ...)`.
- Version detection: `opencode --version`.

**`services/internal-agent-skill.ts`**
- Extend `buildAgentLaunchSpec` to accept `"opencode"`.
- OpenCode launch spec:
  - Command: `opencode`
  - System prompt injection: via `OPENCODE_CONFIG_CONTENT` env var containing JSON with `"instructions": ["<skillPath>"]`
  - Full access: Include `"permission": {"edit": "allow", "bash": "allow", "write": "allow"}` in the config content
  - Model: `--model <provider/model>` flag
  - Prompt: positional arg (same as claude/codex)
  - The config content JSON combines instructions + permissions into a single `OPENCODE_CONFIG_CONTENT` value

**`handlers/session.ts`**
- Add `"opencode"` to `getDefaultSessionLabel()` → returns `"OpenCode"`.
- Merge `spec.env` into PTY spawn environment: `env: { ...taskflowEnv, ...spec.env }` at the `ptyManager.spawn()` call.

**`services/settings-store.ts`**
- Add `opencode` defaults: `{ defaultModel: "", fullAccess: false }`
- Extend merge logic in `get()` / `update()`.

### Environment Variable for Config Injection

OpenCode's `OPENCODE_CONFIG_CONTENT` env var accepts inline JSON config. The launch spec will construct this dynamically:

```json
{
  "instructions": ["/path/to/SKILL.md"],
  "permission": { "edit": "allow", "bash": "allow", "write": "allow" }
}
```

The `permission` block is only included when `fullAccess` is enabled. The `instructions` array always points to the Taskflow skill file.

This env var will be passed via the PTY spawn's environment, alongside existing `TASKFLOW_*` env vars. The `buildAgentLaunchSpec` function will return an `env` record for OpenCode (new addition to the return type).

### UI (`packages/ui/src/`)

**`components/icons/OpenCodeIcon.tsx`** — New file. SVG icon for OpenCode branding. Simple React component wrapping an inline SVG, matching the pattern of `ClaudeIcon.tsx` / `CodexIcon.tsx`.

**`components/workspace/AgentOptionsPanel.tsx`**
- Extend `agentType` prop to include `"opencode"`.
- OpenCode options:
  - Free-text input for model (`provider/model` format) with placeholder showing example like `anthropic/claude-sonnet-4-20250514`.
  - Toggle for full access (same as Claude/Codex).
- Reads defaults from `useSettingsStore` `opencode` section.

**`components/workspace/TabBar.tsx`**
- Add `opencode` tab color variant: `"text-info"` (blue).
- Add OpenCode icon button in the tab bar (same Popover pattern as Claude/Codex).
- Add OpenCode entry in the Run dropdown menu.
- Extend `onNewTab` / `onRunTab` type unions.

**`components/workspace/Workspace.tsx`**
- Add `"opencode"` to `handleNewTab` parameter type (`"claude" | "codex" | "opencode" | "browser" | "shell"`).
- Add `"opencode"` to `handleRunTab` parameter type (`"claude" | "codex" | "opencode"`).

**`components/sidebar/NewTaskDialog.tsx`**
- Add `"opencode"` option to "Start immediately with" select.
- Extend `startWith` type to include `"opencode"`.
- Disabled state from `isAgentAvailable`.

**`components/sidebar/TaskCreationDialogHost.tsx`**
- Extend `PendingSession.type` to include `"opencode"`.
- Extend `handleCreateTask` `startWith` parameter type to include `"opencode"`.

**`stores/session-store.ts`**
- Add `"opencode"` to `Tab.type` union.
- Add `"opencode"` to `createSession` parameter type.
- Add `"opencode"` to `getDefaultSessionLabel()`.
- Add `"opencode"` to `usesTerminalActivityStatus` check.

**`components/settings/SettingsModal.tsx`**
- Add `"opencode"` section to sidebar navigation and content area.
- Section type extends to include `"opencode"`.
- OpenCode settings panel:
  - Default model: free-text input with placeholder.
  - Full access toggle.
- Add "OpenCode" to the default agent select dropdown.
- Widen `handleDefaultAgent` guard clause to accept `"opencode"` (currently only allows `"claude" | "codex"`).

## Key Differences from Claude/Codex

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| Model format | Simple name (`opus`, `sonnet`, `haiku`) | N/A (no model selection) | Free-text `provider/model` string |
| Full access flag | `--dangerously-skip-permissions` | `--full-auto` | `OPENCODE_CONFIG_CONTENT` with permission JSON |
| System prompt | `--append-system-prompt` | TOML `-c developer_instructions=...` + `-c skills.config=[...]` | `OPENCODE_CONFIG_CONTENT` with `instructions` array |
| Tab color | Warning (amber) | Success (green) | Info (blue) |
| Spawn env | Standard | Standard | Standard + `OPENCODE_CONFIG_CONTENT` |

## Return Type Change for `buildAgentLaunchSpec`

Currently returns `{ command: string; args: string[] }`. OpenCode needs to inject `OPENCODE_CONFIG_CONTENT` as an environment variable. The return type extends to:

```ts
{ command: string; args: string[]; env?: Record<string, string> }
```

The session handler merges this `env` into the PTY spawn environment. Claude and Codex branches return no `env` (backward compatible).

## Files to Create

1. `packages/ui/src/components/icons/OpenCodeIcon.tsx`

## Files to Modify

### Shared
1. `packages/shared/src/types/agent.ts`
2. `packages/shared/src/types/task.ts`
3. `packages/shared/src/types/ws.ts`
4. `packages/shared/src/types/settings.ts`

### Backend
5. `packages/backend/src/services/runtime-detector.ts`
6. `packages/backend/src/services/internal-agent-skill.ts`
7. `packages/backend/src/handlers/session.ts`
8. `packages/backend/src/services/settings-store.ts`

### UI
9. `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`
10. `packages/ui/src/components/workspace/TabBar.tsx`
11. `packages/ui/src/components/workspace/Workspace.tsx`
12. `packages/ui/src/components/sidebar/NewTaskDialog.tsx`
13. `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`
14. `packages/ui/src/stores/session-store.ts`
15. `packages/ui/src/components/settings/SettingsModal.tsx`

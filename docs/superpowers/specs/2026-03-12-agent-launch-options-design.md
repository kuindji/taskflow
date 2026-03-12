# Agent Launch Options

## Overview

Add configurable launch options for Claude and Codex agents. Each agent type has its own set of options (full access, worktree, model selection) exposed through the UI at all session-creation points.

## Agent Options

### Claude
- **Full access** (`--dangerously-skip-permissions`) — bypasses all permission checks
- **Worktree** (`--worktree`) — creates a git worktree for isolation
- **Model** (`--model <alias>`) — choices: Default (no flag), Opus, Sonnet, Haiku

### Codex
- **Full access** (`--full-auto`) — auto-approves all actions
- No model selection (intentionally excluded — Codex uses its configured default)

## Shared Types

New file `packages/shared/src/types/agent.ts`:

```ts
export interface ClaudeLaunchOptions {
    type: "claude";
    fullAccess?: boolean;
    worktree?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

export interface CodexLaunchOptions {
    type: "codex";
    fullAccess?: boolean;
}

export type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions;
```

The discriminant `type` field enables TypeScript to narrow the union automatically — no unsafe casts needed anywhere in the codebase.

`SessionCreatePayload` in `ws.ts` gains an optional field:

```ts
interface SessionCreatePayload {
    // ... existing fields ...
    agentOptions?: AgentLaunchOptions;
}
```

## Backend — Flag Mapping

`buildAgentLaunchSpec()` in `internal-agent-skill.ts` gains an `agentOptions` parameter:

```ts
function buildAgentLaunchSpec(
    type: "claude" | "codex",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
): { command: string; args: string[] }
```

Inside the function, the discriminant `agentOptions.type` enables safe narrowing:

```ts
if (agentOptions?.type === "claude") {
    // TypeScript knows this is ClaudeLaunchOptions
    if (agentOptions.fullAccess) args.push("--dangerously-skip-permissions");
    if (agentOptions.worktree) args.push("--worktree");
    if (agentOptions.model) args.push("--model", agentOptions.model);
} else if (agentOptions?.type === "codex") {
    // TypeScript knows this is CodexLaunchOptions
    if (agentOptions.fullAccess) args.push("--full-auto");
}
```

Mapping:
- Claude `fullAccess: true` → `--dangerously-skip-permissions`
- Claude `worktree: true` → `--worktree`
- Claude `model: "opus"` → `--model opus` (same for sonnet/haiku)
- Codex `fullAccess: true` → `--full-auto`

Note: When Claude `fullAccess` is enabled, the existing `--allowedTools` flag is still included — it remains valid alongside `--dangerously-skip-permissions` (allowed tools are additive, not restrictive in this context).

The session handler in `session.ts` simply forwards `agentOptions` from the payload — no casting or narrowing needed since `buildAgentLaunchSpec` handles it internally via the discriminant.

## UI Components

### AgentOptionsPanel

New component at `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`.

Renders controls based on agent type:
- **Claude:** "Full access" checkbox, "Worktree" checkbox, Model dropdown (Default / Opus / Sonnet / Haiku), Run button
- **Codex:** "Full access" checkbox, Run button

Props:
```ts
interface AgentOptionsPanelProps {
    agentType: "claude" | "codex";
    onRun: (options: AgentLaunchOptions) => void;
}
```

The component constructs the options object with the correct `type` discriminant based on `agentType`, so callers can narrow safely via `options.type`.

### Integration Points

**1. New Task Dialog (`NewTaskDialog.tsx` + `NewTaskControl.tsx`)**

The existing "Start immediately with" `Select` dropdown stays as-is for choosing the agent type. When an agent is selected (not "none"), an `AgentOptionsPanel` appears inline below the dropdown showing the agent-specific options. The "Create Task" button remains a single button — it uses whatever options are currently set in the panel.

The `onSubmit` data shape gains an optional `agentOptions` field:
```ts
onSubmit: (data: {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
    startWith?: "claude" | "codex";
    agentOptions?: AgentLaunchOptions;
}) => void;
```

`NewTaskControl.handleCreateTask` parameter type is updated to match the new `onSubmit` shape and forwards `agentOptions` to `createSession()`:

```ts
const handleCreateTask = useCallback(
    async (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
        startWith?: "claude" | "codex";
        agentOptions?: AgentLaunchOptions;
    }) => {
        const task = await createTask(data);
        // ...
        if (data.startWith) {
            await createSession(
                { taskId: task.id },
                data.startWith,
                undefined,
                data.description,
                undefined,
                data.agentOptions,
            );
        }
    },
    [createSession, createTask, setActiveProject, setActiveTask],
);
```

**2. Toolbar Claude/Codex buttons (`TabBar.tsx` + `Workspace.tsx`) — Shift+click**

Normal click = launch with defaults (current behavior). Shift+click opens a popover anchored to the button with `AgentOptionsPanel`.

The `onNewTab` callback in `TabBar` gains an optional `agentOptions` parameter:
```ts
onNewTab: (type: "claude" | "codex" | "browser" | "shell", shellPath?: string, agentOptions?: AgentLaunchOptions) => void;
```

`Workspace.handleNewTab` forwards `agentOptions` to `createSession()`.

**3. Toolbar Run button (`TabBar.tsx` + `Workspace.tsx`) — Hover submenu**

The existing Run dropdown lists Claude/Codex. Click on the agent name = launch with defaults. Hovering the agent name reveals a submenu flyout containing `AgentOptionsPanel` + Run button.

The `onRunTab` callback gains an optional `agentOptions` parameter:
```ts
onRunTab: (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => void;
```

`Workspace.handleRunTab` forwards `agentOptions` to `createSession()`.

### Session Store

`createSession()` gains an optional `agentOptions` parameter passed through in the WebSocket message:

```ts
createSession(
    owner: { taskId?: string; projectId?: string },
    type: "claude" | "codex" | "shell",
    label?: string,
    prompt?: string,
    shell?: string,
    agentOptions?: AgentLaunchOptions,
): Promise<string>
```

## Files to Modify

1. `packages/shared/src/types/agent.ts` — new file: `ClaudeLaunchOptions`, `CodexLaunchOptions`, `AgentLaunchOptions`
2. `packages/shared/src/types/ws.ts` — add `agentOptions` to `SessionCreatePayload`
3. `packages/backend/src/services/internal-agent-skill.ts` — update `buildAgentLaunchSpec()` with overloaded signatures and flag mapping
4. `packages/backend/src/handlers/session.ts` — forward `agentOptions` from payload to `buildAgentLaunchSpec()`
5. `packages/ui/src/stores/session-store.ts` — add `agentOptions` param to `createSession()`
6. `packages/ui/src/components/workspace/AgentOptionsPanel.tsx` — new component
7. `packages/ui/src/components/workspace/TabBar.tsx` — Shift+click popover on Claude/Codex buttons, hover submenu on Run dropdown
8. `packages/ui/src/components/workspace/Workspace.tsx` — update `handleNewTab` and `handleRunTab` to accept and forward `agentOptions`
9. `packages/ui/src/components/sidebar/NewTaskDialog.tsx` — inline `AgentOptionsPanel` when agent is selected, extend `onSubmit` data
10. `packages/ui/src/components/sidebar/NewTaskControl.tsx` — forward `agentOptions` from dialog data to `createSession()`

# Agent Availability Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect whether Claude and Codex CLIs are installed at startup and disable unavailable agents across all UI surfaces.

**Architecture:** Add `detectAgents()` alongside existing `detectRuntimes()`, expose results via a new `MSG.AGENTS_LIST` WebSocket message, and consume in the UI to disable agent selection in NewTaskDialog, TabBar, Run menu, and Settings.

**Tech Stack:** Bun (backend), React/Zustand (UI), @taskflow/shared (types/constants)

---

## Chunk 1: Shared Types and Constants

### Task 1: Add AgentAvailability type and AGENTS_LIST message

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/ws.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add AgentAvailability type to agent.ts**

Add after the existing `AgentLaunchOptions` type:

```typescript
interface AgentAvailability {
    type: AgentType;
    available: boolean;
    path: string;
    version: string;
}

// Add AgentAvailability to the export statement
export type { AgentType, ClaudeLaunchOptions, CodexLaunchOptions, AgentLaunchOptions, AgentAvailability };
```

- [ ] **Step 2: Add AgentListResponse to ws.ts**

Add after `RuntimeListResponse` (around line 184):

```typescript
// Agent detection
export interface AgentListResponse {
    agents: AgentAvailability[];
}
```

Also add `AgentAvailability` to the imports from `"./agent"`:

```typescript
import type { AgentLaunchOptions, AgentAvailability } from "./agent";
```

- [ ] **Step 3: Add AGENTS_LIST constant to constants.ts**

Add `AGENTS_LIST: "agents:list"` in the Sessions section (after line 31, near `RUNTIMES_LIST`):

```typescript
AGENTS_LIST: "agents:list",
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/ws.ts packages/shared/src/constants.ts
git commit -m "feat: add AgentAvailability type and AGENTS_LIST message constant"
```

## Chunk 2: Backend Detection and Registration

### Task 2: Add detectAgents() function

**Files:**
- Modify: `packages/backend/src/services/runtime-detector.ts`
- Modify: `packages/backend/tests/services/runtime-detector.test.ts`

- [ ] **Step 1: Write tests for detectAgents**

Add to `packages/backend/tests/services/runtime-detector.test.ts`:

```typescript
import { detectRuntimes, detectAgents } from "../../src/services/runtime-detector";

describe("detectAgents", () => {
    it("returns an entry for each known agent type", async () => {
        const agents = await detectAgents();
        const types = agents.map((a) => a.type);
        expect(types).toContain("claude");
        expect(types).toContain("codex");
    });

    it("returns correct shape for each agent", async () => {
        const agents = await detectAgents();
        for (const agent of agents) {
            expect(typeof agent.type).toBe("string");
            expect(typeof agent.available).toBe("boolean");
            expect(typeof agent.path).toBe("string");
            expect(typeof agent.version).toBe("string");
            if (agent.available) {
                expect(agent.path).toBeTruthy();
            } else {
                expect(agent.path).toBe("");
            }
        }
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: FAIL — `detectAgents` is not exported

- [ ] **Step 3: Implement detectAgents in runtime-detector.ts**

Add to `packages/backend/src/services/runtime-detector.ts`:

```typescript
import type { RuntimeInfo, AgentAvailability, AgentType } from "@taskflow/shared";

const KNOWN_AGENTS: AgentType[] = ["claude", "codex"];

export async function detectAgents(): Promise<AgentAvailability[]> {
    const agents: AgentAvailability[] = [];

    for (const type of KNOWN_AGENTS) {
        const path = Bun.which(type);
        if (!path) {
            agents.push({ type, available: false, path: "", version: "" });
            continue;
        }
        const version = await getRuntimeVersion(path);
        agents.push({
            type,
            available: true,
            path,
            version: version === "unknown" ? "" : version,
        });
    }

    return agents;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/runtime-detector.ts packages/backend/tests/services/runtime-detector.test.ts
git commit -m "feat: add detectAgents() for CLI availability detection"
```

### Task 3: Register AGENTS_LIST handler and add backend validation

**Files:**
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/handlers/session.ts`
- Modify: `packages/backend/tests/handlers/session.test.ts`

- [ ] **Step 1: Register AGENTS_LIST in index.ts**

In `packages/backend/src/index.ts`, import `detectAgents` alongside `detectRuntimes` (line 12):

```typescript
import { detectRuntimes, detectAgents } from "./services/runtime-detector";
```

After the `detectRuntimes` call (line 115), add agent detection and registration:

```typescript
const agents = await detectAgents();
router.register(MSG.AGENTS_LIST, async () => ({ agents }));
console.log(
    `Detected agents: ${agents.filter((a) => a.available).map((a) => a.type + " " + a.version).join(", ") || "none"}`,
);
```

- [ ] **Step 2: Write test for session creation rejecting unavailable agent**

Add to `packages/backend/tests/handlers/session.test.ts`. In the existing test setup, the session handler needs to receive `agents`. First check how `registerSessionHandlers` is called in tests and update accordingly.

Add a test:

```typescript
it("rejects session creation when agent is not available", async () => {
    // Create a session with an agent type that's marked unavailable
    const result = await router.handle(MSG.SESSION_CREATE, {
        taskId: task.id,
        type: "codex",  // likely unavailable in test environments
        prompt: "test",
    });
    // If codex is not installed, should get an error
    // This test is environment-dependent, so we just verify the shape
    expect(result).toBeDefined();
    if ("error" in (result as Record<string, unknown>)) {
        expect((result as { error: string }).error).toContain("not installed");
    } else {
        expect((result as { sessionId: string }).sessionId).toBeTruthy();
    }
});
```

- [ ] **Step 3: Add backend validation in session.ts**

Modify `packages/backend/src/handlers/session.ts`:

Update `SessionHandlerDeps` to include `agents`:

```typescript
import type { AgentAvailability } from "@taskflow/shared";

interface SessionHandlerDeps {
    router: Router;
    ptyManager: PtyManager;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    getPort: () => number;
    agents: AgentAvailability[];
}
```

In the `SESSION_CREATE` handler, after the shell validation (line 111) and before spawning, add agent validation inside the `else` branch (when `type !== "shell"`):

```typescript
} else {
    const agentInfo = agents.find((a) => a.type === type);
    if (agentInfo && !agentInfo.available) {
        throw new Error(`${type} is not installed`);
    }
    const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
    // ... rest of existing code
```

- [ ] **Step 4: Update registerSessionHandlers call in index.ts**

In `packages/backend/src/index.ts`, pass `agents` to `registerSessionHandlers` (around line 76):

```typescript
registerSessionHandlers({
    router,
    ptyManager,
    taskStore: store,
    broadcast: server.broadcast,
    getPort: () => serverPort,
    agents,
});
```

Note: The `agents` variable is set after `registerSessionHandlers` is called in the current code. Move the `detectAgents()` call before `registerSessionHandlers`, or restructure so the agents are available. The simplest approach: move detection before handler registration. Move the `const agents = await detectAgents();` call to before `registerSessionHandlers`.

- [ ] **Step 5: Update session test setup to pass agents**

In `packages/backend/tests/handlers/session.test.ts`, update the `registerSessionHandlers` call in `beforeEach` to include `agents`:

```typescript
registerSessionHandlers({
    router,
    ptyManager: ptyManager as unknown as PtyManager,
    taskStore: store,
    broadcast: () => {},
    getPort: () => 9999,
    agents: [],  // empty = no restrictions (all allowed)
});
```

This ensures existing tests continue to pass (empty agents array means no agent is explicitly marked unavailable, so the `find` returns undefined and the check is skipped).

- [ ] **Step 6: Run session tests**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts`
Expected: PASS

- [ ] **Step 7: Run all backend tests to verify no regressions**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/index.ts packages/backend/src/handlers/session.ts packages/backend/tests/handlers/session.test.ts
git commit -m "feat: register AGENTS_LIST handler and validate agent availability on session create"
```

## Chunk 3: Frontend — Fetch and Store Agent Availability

### Task 4: Create useAgentAvailability hook

**Files:**
- Create: `packages/ui/src/hooks/useAgentAvailability.ts`

- [ ] **Step 1: Create the hook**

Create `packages/ui/src/hooks/useAgentAvailability.ts`:

```typescript
import { useState, useEffect } from "react";
import { MSG } from "@taskflow/shared";
import type { AgentAvailability, AgentListResponse, AgentType } from "@taskflow/shared";
import { sendRequest } from "./useWebSocket";

const emptyAgents: AgentAvailability[] = [];

let cachedAgents: AgentAvailability[] | null = null;
let fetchPromise: Promise<AgentAvailability[]> | null = null;

function fetchAgents(): Promise<AgentAvailability[]> {
    if (cachedAgents) return Promise.resolve(cachedAgents);
    if (fetchPromise) return fetchPromise;
    fetchPromise = sendRequest<AgentListResponse>(MSG.AGENTS_LIST, {})
        .then((res) => {
            cachedAgents = res.agents;
            fetchPromise = null;
            return cachedAgents;
        })
        .catch(() => {
            fetchPromise = null;
            return emptyAgents;
        });
    return fetchPromise;
}

export function useAgentAvailability(): AgentAvailability[] {
    const [agents, setAgents] = useState<AgentAvailability[]>(cachedAgents ?? emptyAgents);

    useEffect(() => {
        void fetchAgents().then(setAgents);
    }, []);

    return agents;
}

export function isAgentAvailable(agents: AgentAvailability[], type: AgentType): boolean {
    const agent = agents.find((a) => a.type === type);
    return agent?.available ?? true; // default to true if not found (graceful degradation)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/useAgentAvailability.ts
git commit -m "feat: add useAgentAvailability hook for fetching agent CLI status"
```

## Chunk 4: Frontend — Disable Unavailable Agents in UI

### Task 5: Disable agents in NewTaskDialog

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- [ ] **Step 1: Import and use the hook**

Add imports:

```typescript
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
```

Inside `NewTaskDialog`, use the hook:

```typescript
const agents = useAgentAvailability();
const claudeAvailable = isAgentAvailable(agents, "claude");
const codexAvailable = isAgentAvailable(agents, "codex");
```

- [ ] **Step 2: Disable unavailable agent options**

Update the "Start with" `SelectItem` entries (lines 196-198):

```typescript
<SelectItem value="none">Don't start</SelectItem>
<SelectItem value="claude" disabled={!claudeAvailable}>
    Claude Code{!claudeAvailable ? " (not installed)" : ""}
</SelectItem>
<SelectItem value="codex" disabled={!codexAvailable}>
    Codex{!codexAvailable ? " (not installed)" : ""}
</SelectItem>
```

- [ ] **Step 3: Reset startWith if selected agent becomes unavailable**

In `handleStartWithChange`, add a guard:

```typescript
const handleStartWithChange = useCallback((value: string) => {
    if (value === "claude" && !claudeAvailable) return;
    if (value === "codex" && !codexAvailable) return;
    setStartWith(value);
    if (value === "none") setAgentOptions(undefined);
}, [claudeAvailable, codexAvailable]);
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx
git commit -m "feat: disable unavailable agents in NewTaskDialog"
```

### Task 6: Disable agents in TabBar

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`

- [ ] **Step 1: Add agent availability to TabBar**

Import and use the hook in `TabBar`:

```typescript
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
```

Inside `TabBar` component:

```typescript
const agents = useAgentAvailability();
const claudeAvailable = isAgentAvailable(agents, "claude");
const codexAvailable = isAgentAvailable(agents, "codex");
```

- [ ] **Step 2: Disable Claude/Codex buttons in the quick-launch area**

Update the Claude button (around line 281):

```typescript
<Button
    variant="ghost"
    size="icon-xs"
    className="text-warning"
    disabled={!claudeAvailable}
    onClick={(e) => {
        if (!claudeAvailable) return;
        if (e.shiftKey) {
            setClaudePopoverOpen(true);
        } else {
            onNewTab("claude");
        }
    }}
    aria-label="New Claude session"
    tooltip={claudeAvailable ? "New Claude session (Shift+click for options)" : "Claude CLI not installed"}
    tooltipSide="bottom"
>
```

Update the Codex button (around line 310) similarly:

```typescript
<Button
    variant="ghost"
    size="icon-xs"
    className="text-success"
    disabled={!codexAvailable}
    onClick={(e) => {
        if (!codexAvailable) return;
        if (e.shiftKey) {
            setCodexPopoverOpen(true);
        } else {
            onNewTab("codex");
        }
    }}
    aria-label="New Codex session"
    tooltip={codexAvailable ? "New Codex session (Shift+click for options)" : "Codex CLI not installed"}
    tooltipSide="bottom"
>
```

- [ ] **Step 3: Disable agent items in the Run dropdown**

Update the Run menu items (around lines 241-272). Disable the agent menu items:

```typescript
<DropdownMenuItem
    disabled={!claudeAvailable}
    onClick={() => claudeAvailable && onRunTab("claude")}
>
    <ClaudeIcon className="mr-2 h-4 w-4" />
    Claude Code{!claudeAvailable ? " (not installed)" : ""}
</DropdownMenuItem>
<DropdownMenuSub>
    <DropdownMenuSubTrigger disabled={!claudeAvailable}>
        <ClaudeIcon className="mr-2 h-4 w-4" />
        Claude Code with options
    </DropdownMenuSubTrigger>
    {claudeAvailable && (
        <DropdownMenuSubContent className="p-0">
            <AgentOptionsPanel
                agentType="claude"
                onRun={(options) => onRunTab("claude", options)}
            />
        </DropdownMenuSubContent>
    )}
</DropdownMenuSub>
<DropdownMenuItem
    disabled={!codexAvailable}
    onClick={() => codexAvailable && onRunTab("codex")}
>
    <CodexIcon className="mr-2 h-4 w-4" />
    Codex{!codexAvailable ? " (not installed)" : ""}
</DropdownMenuItem>
<DropdownMenuSub>
    <DropdownMenuSubTrigger disabled={!codexAvailable}>
        <CodexIcon className="mr-2 h-4 w-4" />
        Codex with options
    </DropdownMenuSubTrigger>
    {codexAvailable && (
        <DropdownMenuSubContent className="p-0">
            <AgentOptionsPanel
                agentType="codex"
                onRun={(options) => onRunTab("codex", options)}
            />
        </DropdownMenuSubContent>
    )}
</DropdownMenuSub>
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: disable unavailable agents in TabBar buttons and Run menu"
```

### Task 7: Disable unavailable agent in Settings defaultAgent select

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Import and use agent availability**

```typescript
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
```

Inside the component:

```typescript
const agents = useAgentAvailability();
const claudeAvailable = isAgentAvailable(agents, "claude");
const codexAvailable = isAgentAvailable(agents, "codex");
```

- [ ] **Step 2: Disable unavailable agents in the default agent dropdown**

Update the `SelectItem` entries (around lines 500-501):

```typescript
<SelectItem value="claude" disabled={!claudeAvailable}>
    Claude{!claudeAvailable ? " (not installed)" : ""}
</SelectItem>
<SelectItem value="codex" disabled={!codexAvailable}>
    Codex{!codexAvailable ? " (not installed)" : ""}
</SelectItem>
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: disable unavailable agents in Settings default agent dropdown"
```

### Task 8: Final verification

- [ ] **Step 1: Run backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run type checking across packages**

Run: `cd packages/shared && bun run build` (or `bunx tsc --noEmit`)
Run: `cd packages/backend && bunx tsc --noEmit`
Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run linting**

Run: `bun run lint` (or equivalent from root)
Expected: No lint errors related to changes

- [ ] **Step 4: Manual smoke test**

Start the app and verify:
- If Claude/Codex is installed: all buttons/options are enabled and work normally
- If one is not installed: its buttons/select items are disabled with "(not installed)" text
- Settings default agent dropdown disables missing agents
- Backend rejects session creation for unavailable agents with a clear error

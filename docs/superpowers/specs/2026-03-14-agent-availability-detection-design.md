# Agent Availability Detection

## Problem

When Claude or Codex CLI is not installed, Taskflow allows users to create sessions that immediately fail with a raw shell error (`command not found`). There is no upfront detection, no UI indication of availability, and no backend validation.

## Solution

Detect agent CLI availability at startup and propagate that information to the UI, which disables unavailable agents in all selection points. The backend also validates before spawning as a safety net.

## Design

### Shared Types

New type in `packages/shared/src/types/agent.ts`:

```typescript
interface AgentAvailability {
    type: AgentType;        // "claude" | "codex"
    available: boolean;
    path: string;           // empty string if not found
    version: string;        // empty string if not found
}
```

New WebSocket message constant in `packages/shared/src/constants.ts`:

```typescript
AGENTS_LIST = "agents:list"
```

### Backend

**Detection** — new function `detectAgents()` in `packages/backend/src/services/runtime-detector.ts`:
- Iterates over `["claude", "codex"]`
- Uses `Bun.which()` to find each binary
- For found agents, spawns `<path> --version` and parses output
- Returns `AgentAvailability[]`
- Called once at startup in `index.ts`, result stored in module scope

**WebSocket handler** — registered at startup in `index.ts`:
- `MSG.AGENTS_LIST` handler returns `{ agents: AgentAvailability[] }`
- Same pattern as existing `MSG.RUNTIMES_LIST`

**Session creation validation** — in `packages/backend/src/handlers/session.ts`:
- Before calling `ptyManager.spawn()`, check `Bun.which(command)` for agent session types
- If not found, return `{ error: "<agent> is not installed" }` instead of spawning

### Frontend

**Fetching availability** — in the appropriate store or component:
- Send `MSG.AGENTS_LIST` request at startup
- Store the result for use across components

**NewTaskDialog** (`packages/ui/src/components/sidebar/NewTaskDialog.tsx`):
- Claude/Codex `SelectItem` entries get `disabled={true}` when `available === false`
- Disabled items show a tooltip: `"Claude CLI not found"` / `"Codex CLI not found"`

**Workspace session creation** (new tab / agent launch buttons):
- Same disable pattern for unavailable agents

**Settings — defaultAgent dropdown**:
- Disable unavailable agents in the selection
- If current `defaultAgent` is unavailable, show a warning indicator but don't auto-change the value

### Scope

**Included:**
- One-time detection at startup
- UI disabling with tooltips
- Backend validation as safety net

**Excluded:**
- Periodic re-detection or manual refresh
- Custom binary path configuration
- Auto-install prompts

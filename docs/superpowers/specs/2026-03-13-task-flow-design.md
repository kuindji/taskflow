# Task Flow Feature Design

## Overview

Task Flow is the core orchestration feature of Taskflow. It allows users to define reusable multi-step workflows (planning, review, coding, linting, etc.) that execute as sequences of agent sessions. Flows run automatically — each step spawns an agent session, and when the agent signals completion, the next step launches. Users retain manual control to pause, skip, rewind, or jump to any step.

## Core Concepts

### Step Definition
A reusable building block stored in a global library. Contains:
- **Name** — e.g., "Plan Review"
- **Prompt** — instructions for the agent
- **Session type** — `claude`, `codex`, or `shell`
- **Agent options** — model, flags, etc.

Steps are intentionally simple. The intelligence lives in the agent, not the orchestration layer. The agent uses `taskflow-cli` to discover task context, read artifacts from prior steps, and save its own artifacts.

### Flow Definition
An ordered sequence of steps, also stored globally. Each entry in a flow references either a global step (by ID) or defines an inline step. Flows are reusable across tasks.

### Flow Run
The execution instance tying a flow to a task. Identified by `taskId + flowId` (unique pair — the same flow cannot run twice on the same task simultaneously). Owns:
- Current step index and per-step status
- Artifacts produced by agents during execution
- Execution history (started, completed timestamps)

Re-running a step overwrites its artifacts within the same flow run.

### Artifacts
Produced by agents via `taskflow-cli artifact save <type> --path <path>` or `--text <text>`. Scoped to the flow run (task+flow). Each artifact has a type string (e.g., "plan", "review", "code") and either a file path reference or small text content. Steps consume artifacts by type — a "review" step can retrieve a "plan" artifact regardless of which step produced it.

## Architecture

### Approach: Backend-Driven Orchestrator

The backend owns all flow execution logic via a `FlowRunner` service. The UI is a pure view/control layer.

**Why:** The backend already manages sessions and PTYs. `taskflow-cli` talks directly to the backend API. Having a single source of truth avoids split-brain problems and keeps flows progressing even if the UI disconnects momentarily.

## Data Model

### Step Definition
```typescript
interface StepDefinition {
  id: string
  name: string
  prompt: string
  sessionType: "claude" | "codex" | "shell"
  agentOptions?: AgentLaunchOptions
  createdAt: string
  updatedAt: string
}
```

### Flow Definition
```typescript
interface FlowDefinition {
  id: string
  name: string
  description: string
  steps: FlowStepEntry[]
  createdAt: string
  updatedAt: string
}

interface FlowStepEntry {
  id: string              // Unique within the flow
  stepId?: string         // Reference to global StepDefinition
  inline?: StepInline     // OR an inline step definition
  label?: string          // Optional override of step name
}

interface StepInline {
  name: string
  prompt: string
  sessionType: "claude" | "codex" | "shell"
  agentOptions?: AgentLaunchOptions
}
```

### Flow Run
```typescript
interface FlowRun {
  taskId: string
  flowId: string
  status: "running" | "paused" | "completed" | "failed"
  currentStepIndex: number
  steps: FlowStepState[]
  artifacts: FlowArtifact[]
  startedAt: string
  completedAt?: string
}

interface FlowStepState {
  stepEntryId: string
  status: "pending" | "running" | "completed" | "skipped" | "failed"
  sessionId?: string
  startedAt?: string
  completedAt?: string
}

interface FlowArtifact {
  type: string
  path?: string
  text?: string
  stepEntryId: string
  createdAt: string
}
```

### Storage Layout
```
~/.config/taskflow/
├── flows/
│   ├── definitions.json    # Array of FlowDefinition
│   └── steps.json          # Array of StepDefinition
├── flow-runs/
│   └── {taskId}--{flowId}.json
```

## Backend Services

### FlowStore
Persistence layer for definitions and runs. Uses the same `withMutation()` serialization pattern as `TaskStore`.

- `getSteps()`, `saveStep(step)`, `deleteStep(id)`
- `getFlows()`, `saveFlow(flow)`, `deleteFlow(id)`
- `getFlowRun(taskId, flowId)`, `saveFlowRun(run)`, `deleteFlowRun(taskId, flowId)`

### FlowRunner
Orchestration engine. Core operations:

**Starting a flow:**
1. Creates `FlowRun` record
2. Resolves first step definition (global or inline)
3. Builds session prompt: step prompt + preamble with task description + `taskflow-cli` usage instructions
4. Spawns session via existing session creation path
5. Injects `TASKFLOW_FLOW_ID` into the session's env
6. Broadcasts `flow:run-updated`
7. UI shows flow panel, new session appears as a tab

**When agent calls `taskflow-cli step complete`:**
1. Backend identifies task+flow from env vars
2. Marks current step `completed`
3. If more steps → advances index, launches next step (new tab)
4. If last step → marks flow `completed`
5. Broadcasts state update

**Manual controls:**
- **Pause** — flow status → `paused`. When current step's session exits, flow does not advance. Resume re-launches current step.
- **Skip** — marks current step `skipped`, advances to next
- **Jump to step** — sets index to target. Backward jump re-runs the step. Forward jump marks intermediate steps `skipped`.
- **Stop** — kills current session, marks flow `failed`

**Edge cases:**
- Session exits without `step complete` → flow pauses, step marked `failed`. User can retry or skip.
- Task archived while flow running → existing session cleanup runs, flow marked `failed`.
- Multiple flows on same task → only one `running` at a time.

## WebSocket Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `flow:definitions-list` | req/res | List all flow definitions |
| `flow:steps-list` | req/res | List all step definitions |
| `flow:definition-save` | req/res | Create/update flow |
| `flow:step-save` | req/res | Create/update step |
| `flow:definition-delete` | req/res | Delete flow |
| `flow:step-delete` | req/res | Delete step |
| `flow:start` | req/res | Start flow on task |
| `flow:stop` | req/res | Stop active flow |
| `flow:pause` | req/res | Pause flow |
| `flow:resume` | req/res | Resume flow |
| `flow:skip-step` | req/res | Skip current step |
| `flow:jump-to-step` | req/res | Jump to specific step |
| `flow:run-get` | req/res | Get flow run state |
| `flow:run-updated` | broadcast | Flow state changed |

## taskflow-cli Extensions

New commands using `TASKFLOW_TASK_ID`, `TASKFLOW_FLOW_ID`, and `TASKFLOW_SESSION_ID` from env:

```bash
taskflow-cli step complete                          # Signal step done
taskflow-cli artifact save <type> --path <path>     # Save file artifact
taskflow-cli artifact save <type> --text <text>     # Save text artifact
taskflow-cli artifact list                          # List flow artifacts
taskflow-cli artifact get <type>                    # Get artifact by type
```

Backend HTTP endpoints:
- `POST /api/flow/step-complete`
- `POST /api/flow/artifact`
- `GET /api/flow/artifacts`
- `GET /api/flow/artifact/:type`

Agents discover context through the CLI — no magic injection into prompts. The step prompt includes instructions like "use `taskflow-cli artifact list` to see prior artifacts" and "run `taskflow-cli step complete` when done."

## UI Components

### Flow Execution Panel
- Position: left column, between task sidebar and file explorer
- Hidden by default, appears when a flow is active on the current task
- Shows: flow name, step list with statuses (completed/running/pending/failed/skipped), skip button on active step, stop/pause controls at top
- Artifacts section at bottom showing type + path/text for each artifact
- Clicking a completed step could navigate to its session tab (if still open)

### Flow Management Dialog
- Accessible from a top-level "Flows" button (next to Settings)
- Two tabs: Flows and Steps (global library)
- Left panel: list of items with + button
- Right panel: editor for selected item
- Flow editor: name, description, ordered step list with drag-to-reorder, add step (pick from global library or create inline)
- Step editor: name, prompt (textarea), session type, agent options
- Help text section with `taskflow-cli` usage tips

### Task Header Changes
- New dropdown button (first position): "Flow" with a chevron
- Dropdown lists available flows, clicking one starts the flow on the task
- "Manage Flows..." link at bottom opens the management dialog

### Task Creation Dialog Changes
- Existing agent selection becomes one option
- New option to select a flow instead of a single agent session

## Integration Points

**Additive changes only — existing features stay untouched:**

| Package | New | Modified |
|---------|-----|----------|
| `shared` | Flow types file, new MSG constants | `constants.ts` |
| `backend` | `FlowStore`, `FlowRunner`, `handlers/flow.ts`, HTTP routes, CLI commands | Session exit handler (notify FlowRunner) |
| `ui` | `flow-store.ts`, `FlowPanel`, `FlowManagementDialog` | `TaskHeader`, `NewTaskDialog`, `AppShell` |

Flow-spawned sessions are indistinguishable from manually-spawned sessions. The flow layer sits above the existing session machinery — `PtyManager`, `GitService`, terminal panes, and all other existing systems require no changes.

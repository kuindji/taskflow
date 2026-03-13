# Chunk 1: Shared Types & Constants

### Task 1: Flow Type Definitions

**Files:**
- Create: `packages/shared/src/types/flow.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create flow type definitions**

Create `packages/shared/src/types/flow.ts`:

```typescript
import type { AgentLaunchOptions } from "./agent";

interface StepDefinition {
  id: string;
  name: string;
  prompt: string;
  sessionType: "claude" | "codex" | "shell";
  agentOptions?: AgentLaunchOptions;
  createdAt: string;
  updatedAt: string;
}

interface StepInline {
  name: string;
  prompt: string;
  sessionType: "claude" | "codex" | "shell";
  agentOptions?: AgentLaunchOptions;
}

// Exactly one of stepId or inline must be defined
interface FlowStepEntry {
  id: string;
  stepId?: string;
  inline?: StepInline;
  label?: string;
}

interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  steps: FlowStepEntry[];
  createdAt: string;
  updatedAt: string;
}

type FlowRunStatus = "running" | "paused" | "completed" | "failed";
type FlowStepStatus = "pending" | "running" | "completed" | "skipped" | "failed";

interface FlowStepState {
  stepEntryId: string;
  status: FlowStepStatus;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
}

// When multiple artifacts share the same type, the latest one wins
interface FlowArtifact {
  type: string;
  path?: string;
  text?: string;
  stepEntryId: string;
  createdAt: string;
}

interface FlowRun {
  taskId: string;
  flowId: string;
  status: FlowRunStatus;
  currentStepIndex: number;
  steps: FlowStepState[];
  artifacts: FlowArtifact[];
  startedAt: string;
  completedAt?: string;
}
```

Export only the interfaces that will be consumed by other packages. Check actual usage as implementation progresses — start with all exported since both backend and UI need them.

Also add handler payload types for WebSocket messages (used in Chunk 4 handlers to avoid `as` casts):

```typescript
// --- Handler payload types ---
// Used by flow WebSocket handlers for type-safe payload access.

interface FlowDefinitionDeletePayload {
  id: string;
}

interface FlowStepDeletePayload {
  id: string;
}

interface FlowStartPayload {
  taskId: string;
  flowId: string;
}

interface FlowTaskFlowPayload {
  taskId: string;
  flowId: string;
}

interface FlowJumpToStepPayload {
  taskId: string;
  flowId: string;
  stepIndex: number;
}

interface FlowTaskPayload {
  taskId: string;
}
```

- [ ] **Step 2: Export from shared index**

In `packages/shared/src/index.ts`, add alongside the existing `export *` lines:

```typescript
export * from "./types/flow";
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/flow.ts packages/shared/src/index.ts
git commit -m "feat: add shared type definitions for Task Flow feature"
```

### Task 2: Flow Message Constants

**Files:**
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add flow message constants**

Add to the `MSG` object in `packages/shared/src/constants.ts`, following the existing pattern (`FEATURE_ACTION: "feature:action"` as const):

```typescript
// Flow definitions
FLOW_DEFINITIONS_LIST: "flow:definitions-list",
FLOW_STEPS_LIST: "flow:steps-list",
FLOW_DEFINITION_SAVE: "flow:definition-save",
FLOW_STEP_SAVE: "flow:step-save",
FLOW_DEFINITION_DELETE: "flow:definition-delete",
FLOW_STEP_DELETE: "flow:step-delete",

// Flow execution
FLOW_START: "flow:start",
FLOW_STOP: "flow:stop",
FLOW_PAUSE: "flow:pause",
FLOW_RESUME: "flow:resume",
FLOW_SKIP_STEP: "flow:skip-step",
FLOW_JUMP_TO_STEP: "flow:jump-to-step",
FLOW_RUN_GET: "flow:run-get",
FLOW_RUNS_LIST: "flow:runs-list",
FLOW_RUN_UPDATED: "flow:run-updated",
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat: add WebSocket message constants for Task Flow"
```

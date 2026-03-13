# Chunk 3: Flow Runner & Session Integration

### Task 5: FlowRunner Service

**Files:**
- Create: `packages/backend/src/services/flow-runner.ts`

- [ ] **Step 1: Write FlowRunner tests**

Create `packages/backend/src/services/__tests__/flow-runner.test.ts`. This tests the orchestration logic using mocked dependencies:

```typescript
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { FlowRunner } from "../flow-runner";
import type { FlowStore } from "../flow-store";
import type { FlowDefinition, FlowRun, StepDefinition } from "@taskflow/shared";

// Mock dependencies
function createMockFlowStore(): FlowStore {
  const runs = new Map<string, FlowRun>();
  const flows: FlowDefinition[] = [];
  const steps: StepDefinition[] = [];
  return {
    getFlows: mock(async () => flows),
    getSteps: mock(async () => steps),
    getFlowRun: mock(async (taskId: string, flowId: string) => runs.get(`${taskId}--${flowId}`) ?? null),
    saveFlowRun: mock(async (run: FlowRun) => { runs.set(`${run.taskId}--${run.flowId}`, run); }),
    deleteFlowRun: mock(async (taskId: string, flowId: string) => { runs.delete(`${taskId}--${flowId}`); }),
    getFlowRunsForTask: mock(async (taskId: string) => {
      const result: FlowRun[] = [];
      for (const [key, run] of runs) {
        if (key.startsWith(`${taskId}--`)) result.push(run);
      }
      return result;
    }),
    saveFlow: mock(async (flow: FlowDefinition) => { flows.push(flow); }),
    saveStep: mock(async (step: StepDefinition) => { steps.push(step); }),
    deleteFlow: mock(async () => {}),
    deleteStep: mock(async () => {}),
    init: mock(async () => {}),
  } as unknown as FlowStore;
}

let flowStore: FlowStore;
let spawnedSessions: Array<{ sessionId: string; taskId: string; prompt: string }>;
let broadcasts: Array<{ type: string; payload: unknown }>;
let closedSessions: string[];
let runner: FlowRunner;

const testFlow: FlowDefinition = {
  id: "flow-1",
  name: "Test Flow",
  description: "test",
  steps: [
    { id: "entry-1", inline: { name: "Plan", prompt: "Write a plan", sessionType: "claude" } },
    { id: "entry-2", inline: { name: "Review", prompt: "Review the plan", sessionType: "claude" } },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  flowStore = createMockFlowStore();
  spawnedSessions = [];
  broadcasts = [];
  closedSessions = [];

  runner = new FlowRunner({
    flowStore,
    spawnSession: async (opts) => {
      const sessionId = `session-${spawnedSessions.length + 1}`;
      spawnedSessions.push({ sessionId, taskId: opts.taskId, prompt: opts.prompt });
      return sessionId;
    },
    closeSession: (sessionId) => {
      closedSessions.push(sessionId);
    },
    broadcast: (msg) => { broadcasts.push(msg); },
    getTaskDescription: async () => "Build a feature",
  });
});

describe("startFlow", () => {
  test("creates flow run and spawns first step session", async () => {
    await runner.startFlow("task-1", testFlow);
    expect(flowStore.saveFlowRun).toHaveBeenCalled();
    expect(spawnedSessions).toHaveLength(1);
    expect(spawnedSessions[0].taskId).toBe("task-1");
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  test("rejects if a flow is already running on the task", async () => {
    await runner.startFlow("task-1", testFlow);
    await expect(runner.startFlow("task-1", testFlow)).rejects.toThrow();
  });
});

describe("handleStepComplete", () => {
  test("advances to next step", async () => {
    await runner.startFlow("task-1", testFlow);
    const sessionId = spawnedSessions[0].sessionId;
    await runner.handleStepComplete("task-1", "flow-1", sessionId);
    expect(spawnedSessions).toHaveLength(2);
  });

  test("completes flow after last step", async () => {
    await runner.startFlow("task-1", testFlow);
    // Complete step 1
    await runner.handleStepComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
    // Complete step 2 (last)
    await runner.handleStepComplete("task-1", "flow-1", spawnedSessions[1].sessionId);
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.status).toBe("completed");
  });
});

describe("skipStep", () => {
  test("marks current step skipped and advances", async () => {
    await runner.startFlow("task-1", testFlow);
    await runner.skipStep("task-1", "flow-1");
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.steps[0].status).toBe("skipped");
    expect(run!.currentStepIndex).toBe(1);
    expect(spawnedSessions).toHaveLength(2);
    expect(closedSessions).toEqual(["session-1"]);
  });
});

describe("pauseFlow", () => {
  test("sets flow status to paused", async () => {
    await runner.startFlow("task-1", testFlow);
    await runner.pauseFlow("task-1", "flow-1");
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.status).toBe("paused");
  });
});

describe("stopFlow", () => {
  test("closes the current session and marks the flow failed", async () => {
    await runner.startFlow("task-1", testFlow);
    await runner.stopFlow("task-1", "flow-1");
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.status).toBe("failed");
    expect(closedSessions).toEqual(["session-1"]);
  });
});

describe("handleSessionExit", () => {
  test("marks step failed when session exits without step complete", async () => {
    await runner.startFlow("task-1", testFlow);
    const sessionId = spawnedSessions[0].sessionId;
    await runner.handleSessionExit(sessionId, 1);
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.steps[0].status).toBe("failed");
    expect(run!.status).toBe("paused");
  });

  test("shell step auto-completes on exit code 0", async () => {
    const shellFlow: FlowDefinition = {
      ...testFlow,
      steps: [
        { id: "entry-1", inline: { name: "Lint", prompt: "bun run lint", sessionType: "shell" } },
        { id: "entry-2", inline: { name: "Review", prompt: "Review", sessionType: "claude" } },
      ],
    };
    await runner.startFlow("task-1", shellFlow);
    const sessionId = spawnedSessions[0].sessionId;
    await runner.handleSessionExit(sessionId, 0);
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.steps[0].status).toBe("completed");
    expect(spawnedSessions).toHaveLength(2); // Advanced to next
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && bun test src/services/__tests__/flow-runner.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement FlowRunner**

Create `packages/backend/src/services/flow-runner.ts`:

```typescript
import type {
  AgentLaunchOptions,
  FlowDefinition,
  FlowRun,
  FlowStepEntry,
  FlowStepState,
  FlowArtifact,
  StepDefinition,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { FlowStore } from "./flow-store";

interface SpawnSessionOpts {
  taskId: string;
  sessionType: "claude" | "codex" | "shell";
  prompt: string;
  label: string;
  agentOptions?: AgentLaunchOptions;
  flowId: string;
  stepEntryId: string;
}

interface FlowRunnerDeps {
  flowStore: FlowStore;
  spawnSession: (opts: SpawnSessionOpts) => Promise<string>;
  closeSession: (sessionId: string) => void;
  broadcast: (msg: { type: string; payload: unknown }) => void;
  getTaskDescription: (taskId: string) => Promise<string>;
}

class FlowRunner {
  private deps: FlowRunnerDeps;
  // Maps sessionId → { taskId, flowId } for exit handling
  private sessionFlowMap = new Map<string, { taskId: string; flowId: string }>();

  constructor(deps: FlowRunnerDeps) {
    this.deps = deps;
  }

  async startFlow(taskId: string, flow: FlowDefinition): Promise<FlowRun> {
    // Check no running flow on this task
    const existingRuns = await this.deps.flowStore.getFlowRunsForTask(taskId);
    const activeRun = existingRuns.find((r) => r.status === "running" || r.status === "paused");
    if (activeRun) {
      throw new Error(`Task already has an active flow: ${activeRun.flowId}`);
    }

    // Check if this flow was previously run — overwrite
    const existingRun = await this.deps.flowStore.getFlowRun(taskId, flow.id);
    if (existingRun) {
      await this.deps.flowStore.deleteFlowRun(taskId, flow.id);
    }

    const run: FlowRun = {
      taskId,
      flowId: flow.id,
      status: "running",
      currentStepIndex: 0,
      steps: flow.steps.map((s) => ({
        stepEntryId: s.id,
        status: "pending",
      })),
      artifacts: [],
      startedAt: new Date().toISOString(),
    };

    run.steps[0].status = "running";
    run.steps[0].startedAt = new Date().toISOString();
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);

    await this.launchStep(taskId, flow, run, 0);
    return run;
  }

  async handleStepComplete(taskId: string, flowId: string, sessionId: string): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run || run.status !== "running") return;

    const currentStep = run.steps[run.currentStepIndex];
    if (!currentStep || currentStep.sessionId !== sessionId) return;

    currentStep.status = "completed";
    currentStep.completedAt = new Date().toISOString();
    this.sessionFlowMap.delete(sessionId);

    await this.advanceOrComplete(run);
  }

  async skipStep(taskId: string, flowId: string): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run || run.status !== "running") return;

    const currentStep = run.steps[run.currentStepIndex];
    if (currentStep) {
      if (currentStep.sessionId) {
        this.deps.closeSession(currentStep.sessionId);
        this.sessionFlowMap.delete(currentStep.sessionId);
      }
      currentStep.status = "skipped";
      currentStep.completedAt = new Date().toISOString();
    }

    await this.advanceOrComplete(run);
  }

  async jumpToStep(taskId: string, flowId: string, targetIndex: number): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run) return;

    if (targetIndex < 0 || targetIndex >= run.steps.length) {
      throw new Error(`Invalid step index: ${targetIndex}`);
    }

    const currentStep = run.steps[run.currentStepIndex];
    if (currentStep?.sessionId) {
      this.deps.closeSession(currentStep.sessionId);
      this.sessionFlowMap.delete(currentStep.sessionId);
    }

    // Mark intermediate steps
    if (targetIndex > run.currentStepIndex) {
      // Forward jump — skip intermediate steps, including the current running step.
      for (let i = run.currentStepIndex; i < targetIndex; i++) {
        if (run.steps[i].status === "running" || run.steps[i].status === "pending") {
          run.steps[i].status = "skipped";
          run.steps[i].completedAt = new Date().toISOString();
        }
      }
    }

    // Set target step to running
    run.currentStepIndex = targetIndex;
    run.steps[targetIndex].status = "running";
    run.steps[targetIndex].startedAt = new Date().toISOString();
    run.steps[targetIndex].completedAt = undefined;
    run.steps[targetIndex].sessionId = undefined;
    run.artifacts = run.artifacts.filter(
      (artifact) => artifact.stepEntryId !== run.steps[targetIndex].stepEntryId,
    );
    run.status = "running";

    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);

    const flow = await this.resolveFlowDefinition(flowId);
    if (flow) {
      await this.launchStep(taskId, flow, run, targetIndex);
    }
  }

  async pauseFlow(taskId: string, flowId: string): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run || run.status !== "running") return;

    run.status = "paused";
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);
  }

  async resumeFlow(taskId: string, flowId: string): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run || run.status !== "paused") return;

    run.status = "running";
    run.steps[run.currentStepIndex].status = "running";
    run.steps[run.currentStepIndex].startedAt = new Date().toISOString();
    run.steps[run.currentStepIndex].completedAt = undefined;
    run.steps[run.currentStepIndex].sessionId = undefined;
    run.artifacts = run.artifacts.filter(
      (artifact) => artifact.stepEntryId !== run.steps[run.currentStepIndex].stepEntryId,
    );
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);

    const flow = await this.resolveFlowDefinition(flowId);
    if (flow) {
      await this.launchStep(run.taskId, flow, run, run.currentStepIndex);
    }
  }

  async stopFlow(taskId: string, flowId: string): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run) return;

    const currentStep = run.steps[run.currentStepIndex];
    if (currentStep?.sessionId) {
      this.deps.closeSession(currentStep.sessionId);
      this.sessionFlowMap.delete(currentStep.sessionId);
    }
    if (currentStep?.status === "running") {
      currentStep.status = "failed";
      currentStep.completedAt = new Date().toISOString();
    }

    run.status = "failed";
    run.completedAt = new Date().toISOString();
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);
  }

  async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
    const mapping = this.sessionFlowMap.get(sessionId);
    if (!mapping) return;

    const { taskId, flowId } = mapping;
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run) return;

    const currentStep = run.steps[run.currentStepIndex];
    if (!currentStep || currentStep.sessionId !== sessionId) return;

    // Already completed via step complete signal — ignore
    if (currentStep.status === "completed" || currentStep.status === "skipped") {
      this.sessionFlowMap.delete(sessionId);
      return;
    }

    // Resolve step to check session type
    const flow = await this.resolveFlowDefinition(flowId);
    const stepEntry = flow?.steps[run.currentStepIndex];
    const sessionType = await this.getSessionType(stepEntry);

    if (sessionType === "shell" && exitCode === 0) {
      // Shell steps auto-complete on clean exit
      currentStep.status = "completed";
      currentStep.completedAt = new Date().toISOString();
      this.sessionFlowMap.delete(sessionId);
      await this.advanceOrComplete(run);
    } else if (run.status === "paused") {
      // Flow was paused — don't mark as failed, just clean up
      this.sessionFlowMap.delete(sessionId);
    } else {
      // Agent exited without signaling complete — fail the step
      currentStep.status = "failed";
      currentStep.completedAt = new Date().toISOString();
      run.status = "paused";
      this.sessionFlowMap.delete(sessionId);
      await this.deps.flowStore.saveFlowRun(run);
      this.broadcastUpdate(run);
    }
  }

  async saveArtifact(
    taskId: string,
    flowId: string,
    stepEntryId: string,
    artifact: Omit<FlowArtifact, "stepEntryId" | "createdAt">
  ): Promise<void> {
    const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
    if (!run) throw new Error("No flow run found");

    // Re-saving the same artifact type for the same step replaces the older value.
    run.artifacts = run.artifacts.filter(
      (existing) => !(existing.stepEntryId === stepEntryId && existing.type === artifact.type),
    );

    run.artifacts.push({
      ...artifact,
      stepEntryId,
      createdAt: new Date().toISOString(),
    });
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);
  }

  getArtifacts(run: FlowRun, type?: string): FlowArtifact[] {
    const artifacts = type
      ? run.artifacts.filter((a) => a.type === type)
      : run.artifacts;
    // Sort by createdAt descending (latest first)
    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- Private helpers ---

  private async advanceOrComplete(run: FlowRun): Promise<void> {
    const nextIndex = run.currentStepIndex + 1;
    if (nextIndex >= run.steps.length) {
      // Flow complete
      run.status = "completed";
      run.completedAt = new Date().toISOString();
      await this.deps.flowStore.saveFlowRun(run);
      this.broadcastUpdate(run);
      return;
    }

    run.currentStepIndex = nextIndex;
    run.steps[nextIndex].status = "running";
    run.steps[nextIndex].startedAt = new Date().toISOString();
    await this.deps.flowStore.saveFlowRun(run);
    this.broadcastUpdate(run);

    const flow = await this.resolveFlowDefinition(run.flowId);
    if (flow) {
      await this.launchStep(run.taskId, flow, run, nextIndex);
    }
  }

  private async launchStep(
    taskId: string,
    flow: FlowDefinition,
    run: FlowRun,
    stepIndex: number
  ): Promise<void> {
    const stepEntry = flow.steps[stepIndex];
    if (!stepEntry) return;

    const resolved = await this.resolveStep(stepEntry);
    const taskDescription = await this.deps.getTaskDescription(taskId);
    const prompt = this.buildStepPrompt(resolved.prompt, taskDescription, resolved.sessionType);

    const sessionId = await this.deps.spawnSession({
      taskId,
      sessionType: resolved.sessionType,
      prompt,
      label: stepEntry.label ?? resolved.name,
      agentOptions: resolved.agentOptions,
      flowId: flow.id,
      stepEntryId: stepEntry.id,
    });

    this.sessionFlowMap.set(sessionId, { taskId, flowId: flow.id });
    run.steps[stepIndex].sessionId = sessionId;
    await this.deps.flowStore.saveFlowRun(run);
  }

  private async resolveStep(entry: FlowStepEntry): Promise<{
    name: string;
    prompt: string;
    sessionType: "claude" | "codex" | "shell";
    agentOptions?: AgentLaunchOptions;
  }> {
    if (entry.inline) {
      return entry.inline;
    }
    if (entry.stepId) {
      const steps = await this.deps.flowStore.getSteps();
      const step = steps.find((s) => s.id === entry.stepId);
      if (!step) throw new Error(`Step definition not found: ${entry.stepId}`);
      return step;
    }
    throw new Error(`FlowStepEntry has neither stepId nor inline: ${entry.id}`);
  }

  private async getSessionType(stepEntry?: FlowStepEntry): Promise<string | undefined> {
    if (!stepEntry) return undefined;
    if (stepEntry.inline) return stepEntry.inline.sessionType;
    if (stepEntry.stepId) {
      const steps = await this.deps.flowStore.getSteps();
      const step = steps.find((s) => s.id === stepEntry.stepId);
      return step?.sessionType;
    }
    return undefined;
  }

  private async resolveFlowDefinition(flowId: string): Promise<FlowDefinition | null> {
    const flows = await this.deps.flowStore.getFlows();
    return flows.find((f) => f.id === flowId) ?? null;
  }

  private buildStepPrompt(stepPrompt: string, taskDescription: string, sessionType: string): string {
    if (sessionType === "shell") {
      return stepPrompt;
    }
    return [
      `## Task Description\n\n${taskDescription}`,
      `## Step Instructions\n\n${stepPrompt}`,
      `## Taskflow CLI`,
      `Use \`taskflow-cli task\` to read task info and logs.`,
      `Use \`taskflow-cli artifact list\` to see available artifacts from prior steps.`,
      `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
      `When you have completed this step, run \`taskflow-cli step complete\`.`,
    ].join("\n\n");
  }

  private broadcastUpdate(run: FlowRun): void {
    this.deps.broadcast({
      type: MSG.FLOW_RUN_UPDATED,
      payload: run,
    });
  }
}

export { FlowRunner };
export type { SpawnSessionOpts, FlowRunnerDeps };
```

Add one small extension while implementing this service:

- `failFlow(taskId, flowId, reason)` should encapsulate the "mark current step failed, close any live session, set run status to failed, set completedAt, broadcast update" path.
- Reuse that helper from task archive/delete cleanup and from any future fatal orchestration errors instead of duplicating partial failure logic in handlers.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && bun test src/services/__tests__/flow-runner.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "feat: add FlowRunner orchestration service with step progression"
```

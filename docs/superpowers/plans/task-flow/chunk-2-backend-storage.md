# Chunk 2: Backend Storage Layer

### Task 3: Config & Directory Setup

**Files:**
- Modify: `packages/backend/src/config.ts`

- [ ] **Step 1: Add flow directories to config**

Add to the `config` object in `packages/backend/src/config.ts` (after `settingsFile`):

```typescript
flowsDir: join(CONFIG_DIR, "flows"),
flowRunsDir: join(CONFIG_DIR, "flow-runs"),
```

- [ ] **Step 2: Add to ensureDirectories**

Add to the `ensureDirectories()` function:

```typescript
await mkdir(config.flowsDir, { recursive: true });
await mkdir(config.flowRunsDir, { recursive: true });
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "feat: add flow storage directories to config"
```

### Task 4: FlowStore Service

**Files:**
- Create: `packages/backend/src/services/flow-store.ts`

- [ ] **Step 1: Write FlowStore tests**

Create `packages/backend/src/services/__tests__/flow-store.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FlowStore } from "../flow-store";

let tempDir: string;
let store: FlowStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "flow-store-test-"));
  store = new FlowStore(
    join(tempDir, "flows"),
    join(tempDir, "flow-runs")
  );
  await store.init();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("step definitions", () => {
  test("saveStep and getSteps round-trips", async () => {
    const step = {
      id: "step-1",
      name: "Planning",
      prompt: "Write a plan",
      sessionType: "claude" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveStep(step);
    const steps = await store.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("Planning");
  });

  test("saveStep updates existing step", async () => {
    const step = {
      id: "step-1",
      name: "Planning",
      prompt: "Write a plan",
      sessionType: "claude" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveStep(step);
    await store.saveStep({ ...step, name: "Planning v2" });
    const steps = await store.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("Planning v2");
  });

  test("deleteStep removes an unreferenced step", async () => {
    const step = {
      id: "step-1",
      name: "Planning",
      prompt: "Write a plan",
      sessionType: "claude" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveStep(step);
    await store.deleteStep("step-1");
    const steps = await store.getSteps();
    expect(steps).toHaveLength(0);
  });

  test("getFlowsReferencingStep returns flows that use a step", async () => {
    const step = {
      id: "step-1",
      name: "Planning",
      prompt: "Write a plan",
      sessionType: "claude" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const flow = {
      id: "flow-1",
      name: "Feature Dev",
      description: "test",
      steps: [{ id: "entry-1", stepId: "step-1" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveStep(step);
    await store.saveFlow(flow);

    const referencing = await store.getFlowsReferencingStep("step-1");
    expect(referencing.map((entry) => entry.id)).toEqual(["flow-1"]);
  });
});

describe("flow definitions", () => {
  test("saveFlow and getFlows round-trips", async () => {
    const flow = {
      id: "flow-1",
      name: "Feature Dev",
      description: "Full feature lifecycle",
      steps: [
        { id: "entry-1", inline: { name: "Plan", prompt: "Plan it", sessionType: "claude" as const } },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveFlow(flow);
    const flows = await store.getFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].name).toBe("Feature Dev");
  });

  test("deleteFlow removes flow", async () => {
    const flow = {
      id: "flow-1",
      name: "Feature Dev",
      description: "test",
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveFlow(flow);
    await store.deleteFlow("flow-1");
    const flows = await store.getFlows();
    expect(flows).toHaveLength(0);
  });
});

describe("flow runs", () => {
  test("saveFlowRun and getFlowRun round-trips", async () => {
    const run = {
      taskId: "task-1",
      flowId: "flow-1",
      status: "running" as const,
      currentStepIndex: 0,
      steps: [{ stepEntryId: "entry-1", status: "running" as const }],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    await store.saveFlowRun(run);
    const result = await store.getFlowRun("task-1", "flow-1");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("running");
  });

  test("getFlowRunsForTask returns all runs for a task", async () => {
    const run1 = {
      taskId: "task-1",
      flowId: "flow-1",
      status: "completed" as const,
      currentStepIndex: 0,
      steps: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    const run2 = {
      taskId: "task-1",
      flowId: "flow-2",
      status: "running" as const,
      currentStepIndex: 0,
      steps: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    await store.saveFlowRun(run1);
    await store.saveFlowRun(run2);
    const runs = await store.getFlowRunsForTask("task-1");
    expect(runs).toHaveLength(2);
  });

  test("deleteFlowRun removes run", async () => {
    const run = {
      taskId: "task-1",
      flowId: "flow-1",
      status: "running" as const,
      currentStepIndex: 0,
      steps: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    await store.saveFlowRun(run);
    await store.deleteFlowRun("task-1", "flow-1");
    const result = await store.getFlowRun("task-1", "flow-1");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && bun test src/services/__tests__/flow-store.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement FlowStore**

Create `packages/backend/src/services/flow-store.ts`:

```typescript
import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type {
  StepDefinition,
  FlowDefinition,
  FlowRun,
} from "@taskflow/shared";

const FLOW_RUN_SEPARATOR = "--";

class FlowStore {
  private flowMutations = new Map<string, Promise<void>>();

  constructor(
    private flowsDir: string,
    private flowRunsDir: string
  ) {}

  async init(): Promise<void> {
    await mkdir(this.flowsDir, { recursive: true });
    await mkdir(this.flowRunsDir, { recursive: true });
  }

  // --- Step Definitions ---

  private get stepsFile(): string {
    return join(this.flowsDir, "steps.json");
  }

  async getSteps(): Promise<StepDefinition[]> {
    try {
      const data = await readFile(this.stepsFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveStep(step: StepDefinition): Promise<void> {
    await this.withMutation("steps", async () => {
      const steps = await this.getSteps();
      const index = steps.findIndex((s) => s.id === step.id);
      if (index >= 0) {
        steps[index] = step;
      } else {
        steps.push(step);
      }
      await writeFile(this.stepsFile, JSON.stringify(steps, null, 2));
    });
  }

  async deleteStep(id: string): Promise<void> {
    await this.withMutation("steps", async () => {
      const steps = await this.getSteps();
      const filtered = steps.filter((s) => s.id !== id);
      await writeFile(this.stepsFile, JSON.stringify(filtered, null, 2));
    });
  }

  // --- Flow Definitions ---

  private get definitionsFile(): string {
    return join(this.flowsDir, "definitions.json");
  }

  async getFlows(): Promise<FlowDefinition[]> {
    try {
      const data = await readFile(this.definitionsFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async getFlowsReferencingStep(stepId: string): Promise<FlowDefinition[]> {
    const flows = await this.getFlows();
    return flows.filter((flow) => flow.steps.some((entry) => entry.stepId === stepId));
  }

  async saveFlow(flow: FlowDefinition): Promise<void> {
    await this.withMutation("definitions", async () => {
      const flows = await this.getFlows();
      const index = flows.findIndex((f) => f.id === flow.id);
      if (index >= 0) {
        flows[index] = flow;
      } else {
        flows.push(flow);
      }
      await writeFile(this.definitionsFile, JSON.stringify(flows, null, 2));
    });
  }

  async deleteFlow(id: string): Promise<void> {
    await this.withMutation("definitions", async () => {
      const flows = await this.getFlows();
      const filtered = flows.filter((f) => f.id !== id);
      await writeFile(this.definitionsFile, JSON.stringify(filtered, null, 2));
    });
  }

  // --- Flow Runs ---

  private flowRunPath(taskId: string, flowId: string): string {
    return join(this.flowRunsDir, `${taskId}${FLOW_RUN_SEPARATOR}${flowId}.json`);
  }

  async getFlowRun(taskId: string, flowId: string): Promise<FlowRun | null> {
    try {
      const data = await readFile(this.flowRunPath(taskId, flowId), "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async saveFlowRun(run: FlowRun): Promise<void> {
    const key = `${run.taskId}${FLOW_RUN_SEPARATOR}${run.flowId}`;
    await this.withMutation(key, async () => {
      await writeFile(this.flowRunPath(run.taskId, run.flowId), JSON.stringify(run, null, 2));
    });
  }

  async deleteFlowRun(taskId: string, flowId: string): Promise<void> {
    const key = `${taskId}${FLOW_RUN_SEPARATOR}${flowId}`;
    await this.withMutation(key, async () => {
      try {
        await unlink(this.flowRunPath(taskId, flowId));
      } catch {
        // File doesn't exist, that's fine
      }
    });
  }

  async getFlowRunsForTask(taskId: string): Promise<FlowRun[]> {
    const runs: FlowRun[] = [];
    try {
      const files = await readdir(this.flowRunsDir);
      const prefix = `${taskId}${FLOW_RUN_SEPARATOR}`;
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith(".json")) {
          const data = await readFile(join(this.flowRunsDir, file), "utf-8");
          runs.push(JSON.parse(data));
        }
      }
    } catch {
      // Directory empty or doesn't exist
    }
    return runs;
  }

  // --- Mutation serialization ---
  // Identical to TaskStore.withTaskMutation — serializes concurrent writes
  // to the same key by chaining promises through a gate.

  private async withMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.flowMutations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.flowMutations.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await mutation();
    } finally {
      release();
      if (this.flowMutations.get(key) === queued) {
        this.flowMutations.delete(key);
      }
    }
  }
}

export { FlowStore };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && bun test src/services/__tests__/flow-store.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-store.ts packages/backend/src/services/__tests__/flow-store.test.ts
git commit -m "feat: add FlowStore service with persistence for definitions and runs"
```

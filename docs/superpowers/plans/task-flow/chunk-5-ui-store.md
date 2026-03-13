# Chunk 5: UI Store

### Task 10: Flow Zustand Store

**Files:**
- Create: `packages/ui/src/stores/flow-store.ts`

- [ ] **Step 1: Create flow store**

Create `packages/ui/src/stores/flow-store.ts` following the pattern in `task-store.ts`:

```typescript
import { create } from "zustand";
import { MSG } from "@taskflow/shared";
import type {
  FlowDefinition,
  FlowRun,
  StepDefinition,
} from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface FlowStore {
  // Definitions
  flows: FlowDefinition[];
  steps: StepDefinition[];
  loadingDefinitions: boolean;

  // Only running/paused runs live here so the UI panel reflects "active flow" only
  activeRuns: Record<string, FlowRun>;

  // Actions — definitions
  fetchFlows: () => Promise<void>;
  fetchSteps: () => Promise<void>;
  saveFlow: (flow: FlowDefinition) => Promise<void>;
  saveStep: (step: StepDefinition) => Promise<void>;
  deleteFlow: (id: string) => Promise<void>;
  deleteStep: (id: string) => Promise<void>;

  // Actions — execution
  startFlow: (taskId: string, flowId: string) => Promise<FlowRun>;
  stopFlow: (taskId: string, flowId: string) => Promise<void>;
  pauseFlow: (taskId: string, flowId: string) => Promise<void>;
  resumeFlow: (taskId: string, flowId: string) => Promise<void>;
  skipStep: (taskId: string, flowId: string) => Promise<void>;
  jumpToStep: (taskId: string, flowId: string, stepIndex: number) => Promise<void>;
  fetchFlowRuns: (taskId: string) => Promise<void>;

  // Internal
  applyRunUpdate: (run: FlowRun) => void;
}

const useFlowStore = create<FlowStore>((set) => ({
  flows: [],
  steps: [],
  loadingDefinitions: false,
  activeRuns: {},

  async fetchFlows() {
    set({ loadingDefinitions: true });
    const { flows } = await sendRequest<{ flows: FlowDefinition[] }>(MSG.FLOW_DEFINITIONS_LIST);
    set({ flows, loadingDefinitions: false });
  },

  async fetchSteps() {
    const { steps } = await sendRequest<{ steps: StepDefinition[] }>(MSG.FLOW_STEPS_LIST);
    set({ steps });
  },

  async saveFlow(flow) {
    await sendRequest(MSG.FLOW_DEFINITION_SAVE, flow);
    set((s) => {
      const index = s.flows.findIndex((f) => f.id === flow.id);
      const flows = index >= 0
        ? s.flows.map((f) => (f.id === flow.id ? flow : f))
        : [...s.flows, flow];
      return { flows };
    });
  },

  async saveStep(step) {
    await sendRequest(MSG.FLOW_STEP_SAVE, step);
    set((s) => {
      const index = s.steps.findIndex((st) => st.id === step.id);
      const steps = index >= 0
        ? s.steps.map((st) => (st.id === step.id ? step : st))
        : [...s.steps, step];
      return { steps };
    });
  },

  async deleteFlow(id) {
    await sendRequest(MSG.FLOW_DEFINITION_DELETE, { id });
    set((s) => ({ flows: s.flows.filter((f) => f.id !== id) }));
  },

  async deleteStep(id) {
    await sendRequest(MSG.FLOW_STEP_DELETE, { id });
    set((s) => ({ steps: s.steps.filter((st) => st.id !== id) }));
  },

  async startFlow(taskId, flowId) {
    const run = await sendRequest<FlowRun>(MSG.FLOW_START, { taskId, flowId });
    set((s) => ({ activeRuns: { ...s.activeRuns, [taskId]: run } }));
    return run;
  },

  async stopFlow(taskId, flowId) {
    await sendRequest(MSG.FLOW_STOP, { taskId, flowId });
  },

  async pauseFlow(taskId, flowId) {
    await sendRequest(MSG.FLOW_PAUSE, { taskId, flowId });
  },

  async resumeFlow(taskId, flowId) {
    await sendRequest(MSG.FLOW_RESUME, { taskId, flowId });
  },

  async skipStep(taskId, flowId) {
    await sendRequest(MSG.FLOW_SKIP_STEP, { taskId, flowId });
  },

  async jumpToStep(taskId, flowId, stepIndex) {
    await sendRequest(MSG.FLOW_JUMP_TO_STEP, { taskId, flowId, stepIndex });
  },

  async fetchFlowRuns(taskId) {
    const { runs } = await sendRequest<{ runs: FlowRun[] }>(MSG.FLOW_RUNS_LIST, { taskId });
    const activeRun = runs.find((r) => r.status === "running" || r.status === "paused");
    set((s) => {
      if (activeRun) {
        return { activeRuns: { ...s.activeRuns, [taskId]: activeRun } };
      }
      const { [taskId]: _removed, ...remaining } = s.activeRuns;
      return { activeRuns: remaining };
    });
  },

  applyRunUpdate(run) {
    set((s) => {
      if (run.status === "running" || run.status === "paused") {
        return { activeRuns: { ...s.activeRuns, [run.taskId]: run } };
      }
      const { [run.taskId]: _removed, ...remaining } = s.activeRuns;
      return { activeRuns: remaining };
    });
  },
}));

// Module-level event listener for flow run updates
const _unsubFlowRunUpdated = onEvent(MSG.FLOW_RUN_UPDATED, (payload) => {
  if (payload && typeof payload === "object" && "taskId" in payload) {
    useFlowStore.getState().applyRunUpdate(payload as FlowRun);
  }
});

export { useFlowStore };
```

Notes for implementation:

- `flow:run-updated` is only for flow state. Session tabs for flow-spawned steps should arrive through the existing task synchronization path after the backend broadcasts `MSG.TASK_UPDATED`.
- Do not add any special-case tab creation logic to `flow-store`; keeping session-tab state owned by `session-store` avoids split-brain UI state.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/flow-store.ts
git commit -m "feat: add Zustand flow store for definitions and execution state"
```

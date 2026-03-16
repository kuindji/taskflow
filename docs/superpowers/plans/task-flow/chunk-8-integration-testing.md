# Chunk 8: End-to-End Integration & Testing

### Task 14: Backend Integration Test

**Files:**
- Create: `packages/backend/src/__tests__/flow-integration.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow lifecycle: create flow definition → start flow on task → step complete → verify advancement → flow completion.

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FlowStore } from "../services/flow-store";
import { FlowRunner } from "../services/flow-runner";

// Test the full lifecycle without network layer
// Uses real FlowStore (file-based) with mock session spawning

describe("flow lifecycle integration", () => {
  let tempDir: string;
  let flowStore: FlowStore;
  let runner: FlowRunner;
  let spawnedSessions: string[];
  let broadcasts: unknown[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "flow-int-test-"));
    flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
    await flowStore.init();
    spawnedSessions = [];
    broadcasts = [];

    runner = new FlowRunner({
      flowStore,
      spawnSession: async (opts) => {
        const id = `session-${spawnedSessions.length + 1}`;
        spawnedSessions.push(id);
        return id;
      },
      closeSession: () => {},
      broadcast: (msg) => broadcasts.push(msg),
      getTaskDescription: async () => "Test task",
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("full flow runs to completion", async () => {
    const flow = {
      id: "flow-1",
      name: "Test",
      description: "test",
      steps: [
        { id: "e1", inline: { name: "Step 1", prompt: "Do first", sessionType: "claude" as const } },
        { id: "e2", inline: { name: "Step 2", prompt: "Do second", sessionType: "claude" as const } },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await flowStore.saveFlow(flow);

    // Start
    await runner.startFlow("task-1", flow);
    expect(spawnedSessions).toHaveLength(1);

    // Complete step 1
    await runner.handleStepComplete("task-1", "flow-1", "session-1");
    expect(spawnedSessions).toHaveLength(2);

    // Complete step 2
    await runner.handleStepComplete("task-1", "flow-1", "session-2");

    const run = await flowStore.getFlowRun("task-1", "flow-1");
    expect(run!.status).toBe("completed");
    expect(run!.steps.every((s) => s.status === "completed")).toBe(true);
  });

  test("artifacts persist across steps", async () => {
    const flow = {
      id: "flow-1",
      name: "Test",
      description: "test",
      steps: [
        { id: "e1", inline: { name: "Plan", prompt: "Plan", sessionType: "claude" as const } },
        { id: "e2", inline: { name: "Review", prompt: "Review", sessionType: "claude" as const } },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await flowStore.saveFlow(flow);
    await runner.startFlow("task-1", flow);

    // Save artifact in step 1
    await runner.saveArtifact("task-1", "flow-1", "e1", {
      type: "plan",
      path: "docs/plan.md",
    });

    // Complete step 1
    await runner.handleStepComplete("task-1", "flow-1", "session-1");

    // Verify artifact is still accessible
    const run = await flowStore.getFlowRun("task-1", "flow-1");
    const artifacts = runner.getArtifacts(run!, "plan");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].path).toBe("docs/plan.md");
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd packages/backend && bun test src/__tests__/flow-integration.test.ts
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/__tests__/flow-integration.test.ts
git commit -m "test: add flow lifecycle integration tests"
```

### Task 15: Run All Tests

- [ ] **Step 1: Run full backend test suite**

```bash
cd packages/backend && bun test
```

Expected: All tests PASS. Fix any regressions.

- [ ] **Step 2: Run TypeScript type checking**

```bash
cd packages/shared && bunx tsc --noEmit
cd packages/backend && bunx tsc --noEmit
cd packages/ui && bunx tsc --noEmit
```

Expected: No type errors. Fix any issues.

- [ ] **Step 3: Run linter if configured**

```bash
bun run lint 2>/dev/null || true
```

Fix any lint issues.

- [ ] **Step 4: Final commit if any fixes**

Stage only the specific files that were changed to fix issues, then commit. Do not use `git add -A` — add files explicitly:

```bash
git add <specific-files-that-were-fixed> && git commit -m "fix: address type errors and test regressions"
```

### Task 16: Manual Smoke Test

- [ ] **Step 1: Start the dev environment**

```bash
# Terminal 1: backend
cd packages/backend && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT TASKFLOW_DEV_PORT=9234 bun run dev

# Terminal 2: UI
cd packages/ui && VITE_BACKEND_PORT=9234 bun run dev
```

- [ ] **Step 2: Verify flow management**

1. Open the app in browser
2. Click the "Flows" button next to Settings
3. Create a step: name "Echo Test", type "shell", prompt "echo hello"
4. Create a flow: name "Test Flow", add the step
5. Verify it saves and appears in the list
6. Attempt to delete the step while it is still referenced by the flow
7. Verify delete is disabled in the UI and the reason is shown

- [ ] **Step 3: Verify flow execution**

1. Create a task
2. Click the Flow dropdown in the task header
3. Select the test flow
4. Verify: flow panel appears, step shows "running", a new terminal tab opens
5. When the shell exits, verify the step shows "completed" and the flow completes

- [ ] **Step 4: Verify manual controls**

1. Create a 2-step flow (both shell steps with `sleep 30 && echo done`)
2. Start the flow on a task
3. Test pause, resume, skip, and stop buttons

# Chunk 4: Backend Handlers, API Routes & CLI

### Task 6: Flow WebSocket Handlers

**Files:**
- Create: `packages/backend/src/handlers/flow.ts`

- [ ] **Step 1: Implement flow handlers**

Create `packages/backend/src/handlers/flow.ts` following the pattern in `handlers/task.ts`:

```typescript
import { MSG } from "@taskflow/shared";
import type { FlowDefinition, FlowRun, StepDefinition } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";

interface FlowHandlerDeps {
  router: Router;
  flowStore: FlowStore;
  flowRunner: FlowRunner;
}

function registerFlowHandlers(deps: FlowHandlerDeps): void {
  const { router, flowStore, flowRunner } = deps;

  // --- Definitions ---

  router.register(MSG.FLOW_DEFINITIONS_LIST, async () => {
    return { flows: await flowStore.getFlows() };
  });

  router.register(MSG.FLOW_STEPS_LIST, async () => {
    return { steps: await flowStore.getSteps() };
  });

  router.register(MSG.FLOW_DEFINITION_SAVE, async (payload) => {
    const flow = payload as FlowDefinition;
    await flowStore.saveFlow(flow);
    return flow;
  });

  router.register(MSG.FLOW_STEP_SAVE, async (payload) => {
    const step = payload as StepDefinition;
    await flowStore.saveStep(step);
    return step;
  });

  router.register(MSG.FLOW_DEFINITION_DELETE, async (payload) => {
    const { id } = payload as { id: string };
    await flowStore.deleteFlow(id);
    return { success: true };
  });

  router.register(MSG.FLOW_STEP_DELETE, async (payload) => {
    const { id } = payload as { id: string };
    const referencingFlows = await flowStore.getFlowsReferencingStep(id);
    if (referencingFlows.length > 0) {
      throw new Error(
        `Cannot delete step "${id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
      );
    }
    await flowStore.deleteStep(id);
    return { success: true };
  });

  // --- Execution ---

  router.register(MSG.FLOW_START, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    const flows = await flowStore.getFlows();
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) throw new Error(`Flow not found: ${flowId}`);
    return await flowRunner.startFlow(taskId, flow);
  });

  router.register(MSG.FLOW_STOP, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    await flowRunner.stopFlow(taskId, flowId);
    return { success: true };
  });

  router.register(MSG.FLOW_PAUSE, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    await flowRunner.pauseFlow(taskId, flowId);
    return { success: true };
  });

  router.register(MSG.FLOW_RESUME, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    await flowRunner.resumeFlow(taskId, flowId);
    return { success: true };
  });

  router.register(MSG.FLOW_SKIP_STEP, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    await flowRunner.skipStep(taskId, flowId);
    return { success: true };
  });

  router.register(MSG.FLOW_JUMP_TO_STEP, async (payload) => {
    const { taskId, flowId, stepIndex } = payload as { taskId: string; flowId: string; stepIndex: number };
    await flowRunner.jumpToStep(taskId, flowId, stepIndex);
    return { success: true };
  });

  router.register(MSG.FLOW_RUN_GET, async (payload) => {
    const { taskId, flowId } = payload as { taskId: string; flowId: string };
    return await flowStore.getFlowRun(taskId, flowId);
  });

  router.register(MSG.FLOW_RUNS_LIST, async (payload) => {
    const { taskId } = payload as { taskId: string };
    return { runs: await flowStore.getFlowRunsForTask(taskId) };
  });
}

export { registerFlowHandlers };
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/handlers/flow.ts
git commit -m "feat: add WebSocket handlers for flow definitions and execution"
```

### Task 7: Flow API Routes (for taskflow-cli)

**Files:**
- Modify: `packages/backend/src/api/routes.ts`

- [ ] **Step 1: Add flow API routes**

Add the following routes to `packages/backend/src/api/routes.ts`. These are called by `taskflow-cli` from within agent sessions. The routes need access to `flowRunner` and `flowStore`, so they should be passed as dependencies (follow the existing `registerApiRoutes` pattern — check the function signature and add `flowRunner`/`flowStore` to the deps).

Add these route registrations inside `registerApiRoutes`:

```typescript
// --- Flow step completion ---
apiRouter.register("POST", "/api/flow/step-complete", async (req) => {
  const body = await req.json() as {
    taskId: string;
    flowId: string;
    sessionId: string;
  };
  await flowRunner.handleStepComplete(body.taskId, body.flowId, body.sessionId);
  return jsonResponse({ success: true });
});

// --- Flow artifacts ---
apiRouter.register("POST", "/api/flow/artifact", async (req) => {
  const body = await req.json() as {
    taskId: string;
    flowId: string;
    stepEntryId: string;
    type: string;
    path?: string;
    text?: string;
  };
  await flowRunner.saveArtifact(body.taskId, body.flowId, body.stepEntryId, {
    type: body.type,
    path: body.path,
    text: body.text,
  });
  return jsonResponse({ success: true });
});

apiRouter.register("GET", "/api/flow/artifact/:taskId/:flowId", async (_req, params) => {
  const run = await flowStore.getFlowRun(params.taskId, params.flowId);
  if (!run) return errorResponse("Flow run not found", 404);
  return jsonResponse({ artifacts: flowRunner.getArtifacts(run) });
});

apiRouter.register("GET", "/api/flow/artifact/:taskId/:flowId/:type", async (_req, params) => {
  const run = await flowStore.getFlowRun(params.taskId, params.flowId);
  if (!run) return errorResponse("Flow run not found", 404);
  const artifacts = flowRunner.getArtifacts(run, params.type);
  if (artifacts.length === 0) return errorResponse("Artifact not found", 404);
  return jsonResponse(artifacts[0]); // Latest wins
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/api/routes.ts
git commit -m "feat: add HTTP API routes for flow step-complete and artifacts"
```

### Task 8: taskflow-cli Extensions

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts`

- [ ] **Step 1: Add CLI case branches**

In `packages/backend/src/services/internal-agent-skill.ts`, add new case branches to the shell script's case statement. The script already has `task`, `log`, and `browser` commands. Add after the existing cases:

```bash
step)
  if [ "$1" = "complete" ]; then
    curl -s -X POST "$TASKFLOW_API_URL/api/flow/step-complete" \
      -H "Content-Type: application/json" \
      -d "{\"taskId\":\"$TASKFLOW_TASK_ID\",\"flowId\":\"$TASKFLOW_FLOW_ID\",\"sessionId\":\"$TASKFLOW_SESSION_ID\"}"
  else
    echo "Usage: taskflow-cli step complete"
    exit 1
  fi
  ;;
artifact)
  case "$1" in
    save)
      TYPE="$2"
      if [ -z "$TYPE" ]; then
        echo "Usage: taskflow-cli artifact save <type> --path <path> | --text <text>"
        exit 1
      fi
      shift 2
      ARTIFACT_PATH=""
      ARTIFACT_TEXT=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --path) ARTIFACT_PATH="$2"; shift 2 ;;
          --text) ARTIFACT_TEXT="$2"; shift 2 ;;
          *) shift ;;
        esac
      done
      JSON=$(TYPE="$TYPE" ARTIFACT_PATH="$ARTIFACT_PATH" python3 -c '
import json, os, sys
payload = {
  "taskId": os.environ["TASKFLOW_TASK_ID"],
  "flowId": os.environ["TASKFLOW_FLOW_ID"],
  "stepEntryId": os.environ["TASKFLOW_STEP_ENTRY_ID"],
  "type": os.environ["TYPE"],
}
path = os.environ.get("ARTIFACT_PATH")
text = sys.stdin.read()
if path:
  payload["path"] = path
if text:
  payload["text"] = text
print(json.dumps(payload))
' <<EOF
$ARTIFACT_TEXT
EOF
)
      curl -s -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
        -H "Content-Type: application/json" \
        -d "$JSON"
      ;;
    list)
      curl -s "$TASKFLOW_API_URL/api/flow/artifact/$TASKFLOW_TASK_ID/$TASKFLOW_FLOW_ID"
      ;;
    get)
      TYPE="$2"
      if [ -z "$TYPE" ]; then
        echo "Usage: taskflow-cli artifact get <type>"
        exit 1
      fi
      curl -s "$TASKFLOW_API_URL/api/flow/artifact/$TASKFLOW_TASK_ID/$TASKFLOW_FLOW_ID/$TYPE"
      ;;
    *)
      echo "Usage: taskflow-cli artifact <save|list|get>"
      exit 1
      ;;
  esac
  ;;
```

- [ ] **Step 2: Update SKILL.md / system prompt for flow-aware sessions**

In the same file, update `INTERNAL_AGENT_SYSTEM_PROMPT` (or the SKILL.md content) to include flow commands documentation. Add after existing command docs:

```markdown
## Flow Commands (available when running as a flow step)

- `taskflow-cli step complete` — Signal that this step is done. The next step will start automatically.
- `taskflow-cli artifact save <type> --path <path>` — Save a file artifact (e.g., `taskflow-cli artifact save plan --path docs/plan.md`)
- `taskflow-cli artifact save <type> --text <text>` — Save a text artifact
- `taskflow-cli artifact list` — List all artifacts from the current flow run
- `taskflow-cli artifact get <type>` — Get the latest artifact of a given type
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts
git commit -m "feat: add step and artifact commands to taskflow-cli"
```

### Task 9: Wire Up Backend Initialization

**Files:**
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/handlers/session.ts`
- Modify: `packages/backend/src/handlers/task.ts`
- [ ] **Step 1: Initialize FlowStore and FlowRunner in index.ts**

In `packages/backend/src/index.ts`, after existing store/service creation:

```typescript
import { FlowStore } from "./services/flow-store";
import { FlowRunner } from "./services/flow-runner";
import { registerFlowHandlers } from "./handlers/flow";
import { removeSessionFromOwner } from "./handlers/session";
```

Create instances after `ensureDirectories()`:

```typescript
const flowStore = new FlowStore(config.flowsDir, config.flowRunsDir);
await flowStore.init();
```

First extract the existing nested `removeSessionFromOwner` helper in `packages/backend/src/handlers/session.ts` into a top-level exported function so both `registerSessionHandlers` and `index.ts` can reuse it.

Move `settingsStore` creation and shell detection earlier in `index.ts` so shell-step launches can reuse the same configured-shell resolution path as normal terminal tabs. `FlowRunner` should receive a small `getDefaultShellPath()` callback rather than reaching into global state.

Create `FlowRunner` after `ptyManager` and `taskStore` are created:

```typescript
const flowRunner = new FlowRunner({
  flowStore,
  spawnSession: async (opts) => {
    const sessionId = crypto.randomUUID();
    const task = await taskStore.getTask(opts.taskId);
    if (!task) throw new Error(`Task not found: ${opts.taskId}`);

    const project = await taskStore.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    const cwd = task.worktree.enabled && task.worktree.path
      ? task.worktree.path
      : project.path;

    let command: string;
    const args: string[] = [];
    if (opts.sessionType === "shell") {
      // Shell steps should follow the same shell-resolution path as normal terminal tabs.
      // Reuse the shell detector/settings logic instead of hardcoding process.env.SHELL.
      const shellPath = await getDefaultShellPath();
      command = shellPath;
      args.push("-lc", opts.prompt);
    } else {
      const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
      const spec = buildAgentLaunchSpec(opts.sessionType, opts.prompt, skillPath, opts.agentOptions);
      command = spec.command;
      args.push(...spec.args);
    }

    const taskflowEnv = {
      TASKFLOW_API_URL: `http://localhost:${getPort()}`,
      TASKFLOW_SESSION_ID: sessionId,
      TASKFLOW_TASK_ID: task.id,
      TASKFLOW_PROJECT_ID: project.id,
      TASKFLOW_FLOW_ID: opts.flowId,
      TASKFLOW_STEP_ENTRY_ID: opts.stepEntryId,
    };

    ptyManager.spawn({
      id: sessionId,
      command,
      args,
      cwd,
      env: taskflowEnv,
      onData: (data, sequence) => {
        void taskStore.appendSessionOutput(task.id, sessionId, sequence, data);
        broadcast({ type: MSG.TERMINAL_OUTPUT, payload: { sessionId, data, sequence } });
      },
      onExit: (exitCode) => {
        broadcast({ type: MSG.SESSION_EXITED, payload: { sessionId, exitCode } });
        void flowRunner.handleSessionExit(sessionId, exitCode);
        void removeSessionFromOwner(taskStore, sessionId, { taskId: task.id, projectId: project.id });
      },
    });

    // Register session with the task
    const sessionRef = {
      id: sessionId,
      type: opts.sessionType,
      label: opts.label,
      createdAt: new Date().toISOString(),
    };
    await taskStore.updateTask(task.id, (t) => ({
      sessions: [...t.sessions, sessionRef],
    }));

    if (opts.sessionType !== "shell") {
      broadcast({ type: MSG.SESSION_STATUS, payload: { sessionId, status: "working" } });
    }

    return sessionId;
  },
  closeSession: (sessionId) => {
    ptyManager.close(sessionId);
  },
  broadcast: (msg) => broadcast(msg),
  getTaskDescription: async (taskId) => {
    const task = await taskStore.getTask(taskId);
    return task?.description ?? "";
  },
});
```

After creating `FlowRunner`, add startup recovery for flow runs stuck in "running" state from a previous process crash:

```typescript
// Recover any flow runs stuck in "running" state from a previous process
const allTasks = await taskStore.listTasks();
for (const task of allTasks) {
  const runs = await flowStore.getFlowRunsForTask(task.id);
  for (const run of runs) {
    if (run.status === "running") {
      run.status = "paused";
      const currentStep = run.steps[run.currentStepIndex];
      if (currentStep?.status === "running") {
        currentStep.status = "failed";
        currentStep.completedAt = new Date().toISOString();
      }
      await flowStore.saveFlowRun(run);
    }
  }
}
```

Register handlers:

```typescript
registerFlowHandlers({ router, flowStore, flowRunner });
```

Also update task lifecycle cleanup so flow runs are marked terminal instead of left paused:

- In `packages/backend/src/handlers/task.ts`, inject `flowStore` and `flowRunner` alongside the existing deps.
- Before archiving or deleting a task, look up flow runs for that task.
- For each `running` or `paused` run, call a new `flowRunner.failFlow(taskId, flowId, reason)` helper that:
  - closes the current session if one exists,
  - marks the current running step `failed` if needed,
  - marks the run `failed`,
  - sets `completedAt`,
  - broadcasts the update.
- This keeps task archive/delete aligned with the spec requirement that active flows fail when the task is removed.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/index.ts packages/backend/src/handlers/session.ts packages/backend/src/handlers/task.ts
git commit -m "feat: wire FlowStore and FlowRunner into backend initialization"
```

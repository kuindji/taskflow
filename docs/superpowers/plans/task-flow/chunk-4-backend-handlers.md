# Chunk 4: Backend Handlers, API Routes & CLI

### Task 6: Flow WebSocket Handlers

**Files:**
- Create: `packages/backend/src/handlers/flow.ts`

- [ ] **Step 1: Implement flow handlers**

Create `packages/backend/src/handlers/flow.ts` following the pattern in `handlers/task.ts`:

```typescript
import { MSG } from "@taskflow/shared";
import type {
  FlowDefinition,
  FlowRun,
  StepDefinition,
  FlowDefinitionDeletePayload,
  FlowStepDeletePayload,
  FlowStartPayload,
  FlowTaskFlowPayload,
  FlowJumpToStepPayload,
  FlowTaskPayload,
} from "@taskflow/shared";
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

  // Note: Router.Handler is `(payload: unknown) => Promise<unknown>`.
  // Use a local typed helper to narrow payload types without `as any`:
  function typed<T>(handler: (payload: T) => Promise<unknown>): (payload: unknown) => Promise<unknown> {
    return handler as (payload: unknown) => Promise<unknown>;
  }

  router.register(MSG.FLOW_DEFINITION_SAVE, typed<FlowDefinition>(async (payload) => {
    await flowStore.saveFlow(payload);
    return payload;
  }));

  router.register(MSG.FLOW_STEP_SAVE, typed<StepDefinition>(async (payload) => {
    await flowStore.saveStep(payload);
    return payload;
  }));

  router.register(MSG.FLOW_DEFINITION_DELETE, typed<FlowDefinitionDeletePayload>(async (payload) => {
    await flowStore.deleteFlow(payload.id);
    return { success: true };
  }));

  router.register(MSG.FLOW_STEP_DELETE, typed<FlowStepDeletePayload>(async (payload) => {
    const referencingFlows = await flowStore.getFlowsReferencingStep(payload.id);
    if (referencingFlows.length > 0) {
      throw new Error(
        `Cannot delete step "${payload.id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
      );
    }
    await flowStore.deleteStep(payload.id);
    return { success: true };
  }));

  // --- Execution ---

  router.register(MSG.FLOW_START, typed<FlowStartPayload>(async (payload) => {
    const flows = await flowStore.getFlows();
    const flow = flows.find((f) => f.id === payload.flowId);
    if (!flow) throw new Error(`Flow not found: ${payload.flowId}`);
    return await flowRunner.startFlow(payload.taskId, flow);
  }));

  router.register(MSG.FLOW_STOP, typed<FlowTaskFlowPayload>(async (payload) => {
    await flowRunner.stopFlow(payload.taskId, payload.flowId);
    return { success: true };
  }));

  router.register(MSG.FLOW_PAUSE, typed<FlowTaskFlowPayload>(async (payload) => {
    await flowRunner.pauseFlow(payload.taskId, payload.flowId);
    return { success: true };
  }));

  router.register(MSG.FLOW_RESUME, typed<FlowTaskFlowPayload>(async (payload) => {
    await flowRunner.resumeFlow(payload.taskId, payload.flowId);
    return { success: true };
  }));

  router.register(MSG.FLOW_SKIP_STEP, typed<FlowTaskFlowPayload>(async (payload) => {
    await flowRunner.skipStep(payload.taskId, payload.flowId);
    return { success: true };
  }));

  router.register(MSG.FLOW_JUMP_TO_STEP, typed<FlowJumpToStepPayload>(async (payload) => {
    await flowRunner.jumpToStep(payload.taskId, payload.flowId, payload.stepIndex);
    return { success: true };
  }));

  router.register(MSG.FLOW_RUN_GET, typed<FlowTaskFlowPayload>(async (payload) => {
    return await flowStore.getFlowRun(payload.taskId, payload.flowId);
  }));

  router.register(MSG.FLOW_RUNS_LIST, typed<FlowTaskPayload>(async (payload) => {
    return { runs: await flowStore.getFlowRunsForTask(payload.taskId) };
  }));
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
      if [ -n "$ARTIFACT_PATH" ] && [ -n "$ARTIFACT_TEXT" ]; then
        echo "Use either --path or --text, not both" >&2
        exit 1
      fi
      if [ -z "$ARTIFACT_PATH" ] && [ -z "$ARTIFACT_TEXT" ]; then
        echo "Either --path or --text is required" >&2
        exit 1
      fi
      if [ -n "$ARTIFACT_PATH" ]; then
        curl -s -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
          -H "Content-Type: application/json" \
          -d "{\"taskId\":\"$TASKFLOW_TASK_ID\",\"flowId\":\"$TASKFLOW_FLOW_ID\",\"stepEntryId\":\"$TASKFLOW_STEP_ENTRY_ID\",\"type\":\"$TYPE\",\"path\":\"$ARTIFACT_PATH\"}"
      else
        curl -s -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
          -H "Content-Type: application/json" \
          -d "{\"taskId\":\"$TASKFLOW_TASK_ID\",\"flowId\":\"$TASKFLOW_FLOW_ID\",\"stepEntryId\":\"$TASKFLOW_STEP_ENTRY_ID\",\"type\":\"$TYPE\",\"text\":\"$ARTIFACT_TEXT\"}"
      fi
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

Implementation note:

- Keep `taskflow-cli` dependency-free. Do not introduce `python3`, `node`, or other runtime requirements just for JSON encoding in `artifact save`; this internal CLI currently relies only on POSIX shell and `curl`.

### Task 9: Wire Up Backend Initialization

**Files:**
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/handlers/session.ts`
- Modify: `packages/backend/src/handlers/task.ts`
- [ ] **Step 1: Extract shared backend session lifecycle helper and initialize FlowStore/FlowRunner**

In `packages/backend/src/index.ts`, after existing store/service creation:

```typescript
import { FlowStore } from "./services/flow-store";
import { FlowRunner } from "./services/flow-runner";
import { registerFlowHandlers } from "./handlers/flow";
```

Create instances after `ensureDirectories()`:

```typescript
const flowStore = new FlowStore(config.flowsDir, config.flowRunsDir);
await flowStore.init();
```

Before wiring `FlowRunner`, extract the backend session lifecycle into a reusable helper module. This avoids duplicating the `SESSION_CREATE` handler logic and keeps flow-spawned sessions behaviorally identical to manually-spawned sessions.

**File:** Create `packages/backend/src/services/session-lifecycle.ts`

```typescript
import { randomUUID } from "crypto";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { PtyManager } from "./pty-manager";
import type { TaskStore } from "./task-store";
import type { SettingsStore } from "./settings-store";

interface SessionOwner {
  taskId?: string;
  projectId?: string;
}

interface CreateSessionOpts {
  owner: SessionOwner;
  type: "claude" | "codex" | "shell";
  label: string;
  prompt: string;
  agentOptions?: AgentLaunchOptions;
  flow?: {
    flowId: string;
    stepEntryId: string;
  };
  cols?: number;
  rows?: number;
}

interface SessionLifecycleDeps {
  ptyManager: PtyManager;
  taskStore: TaskStore;
  settingsStore: SettingsStore;
  broadcast: (msg: { type: string; payload: unknown }) => void;
  getPort: () => number;
  onSessionExited?: (sessionId: string, exitCode: number) => void;
}

function createSessionLifecycle(deps: SessionLifecycleDeps) {
  const { ptyManager, taskStore, settingsStore, broadcast, getPort } = deps;

  /**
   * Create a managed session: spawn PTY, persist session ref on owner,
   * broadcast owner update, wire exit cleanup.
   * Returns the sessionId.
   */
  async function createSession(opts: CreateSessionOpts): Promise<string> {
    const sessionId = randomUUID();
    // 1. Resolve cwd from owner (task worktree path or project path)
    // 2. Build agent launch spec (command, args, env) using buildAgentLaunchSpec()
    // 3. Inject TASKFLOW_* env vars: API_URL, SESSION_ID, TASK_ID, PROJECT_ID
    //    For flow sessions, also inject TASKFLOW_FLOW_ID and TASKFLOW_STEP_ENTRY_ID
    // 4. Spawn PTY via ptyManager.spawn()
    // 5. Persist session ref on owner:
    //    - Task-owned: taskStore.updateTask(taskId, add session to sessions[])
    //    - Project-owned: taskStore.updateProject(projectId, add session)
    // 6. Broadcast MSG.TASK_UPDATED (or MSG.PROJECT_UPDATED) with full updated entity
    // 7. Wire onExit callback:
    //    - Remove session ref from owner
    //    - Broadcast owner update again
    //    - Call deps.onSessionExited?.(sessionId, exitCode)
    return sessionId;
  }

  /**
   * Remove a session ref from its owner and broadcast the update.
   */
  async function removeSessionFromOwner(
    sessionId: string,
    owner: SessionOwner,
  ): Promise<void> {
    // Remove from task.sessions[] or project.sessions[]
    // Broadcast MSG.TASK_UPDATED or MSG.PROJECT_UPDATED
  }

  return { createSession, removeSessionFromOwner };
}

export { createSessionLifecycle };
export type { CreateSessionOpts, SessionOwner, SessionLifecycleDeps };
```

**Extraction steps (from `packages/backend/src/handlers/session.ts`):**

1. The `MSG.SESSION_CREATE` handler (the block that resolves cwd, calls `buildAgentLaunchSpec`, injects `taskflowEnv`, calls `ptyManager.spawn`, persists the session ref, and sets up `onExit`) should be refactored to call `createSession()` from this helper.
2. Keep `registerSessionHandlers` as the entry point — it wraps `createSession` with WebSocket request/response framing.
3. The `onExit` callback in the current handler that removes the session ref and broadcasts the updated task/project should move into the helper's exit cleanup.
4. After extraction, the `SESSION_CREATE` handler becomes a thin wrapper:

```typescript
router.register(MSG.SESSION_CREATE, async (payload) => {
  const { owner, type, label, prompt, agentOptions, cols, rows } = payload as SessionCreatePayload;
  const sessionId = await sessionLifecycle.createSession({ owner, type, label, prompt, agentOptions, cols, rows });
  return { sessionId };
});
```

**Testing the extraction:**
- Run the existing backend test suite after extraction to verify no regressions.
- Manually verify that creating a session via the UI still produces terminal tabs and that session exit still removes tabs.

Move `settingsStore` creation and shell detection earlier in `index.ts` so shell-step launches can reuse the same configured-shell resolution path as normal terminal tabs. `FlowRunner` should receive a small `getDefaultShellPath()` callback rather than reaching into global state.

Create `FlowRunner` after `ptyManager` and `taskStore` are created:

```typescript
const flowRunner = new FlowRunner({
  flowStore,
  spawnSession: async (opts) => {
    return createManagedSession({
      owner: { taskId: opts.taskId },
      type: opts.sessionType,
      label: opts.label,
      prompt: opts.prompt,
      agentOptions: opts.agentOptions,
      flow: {
        flowId: opts.flowId,
        stepEntryId: opts.stepEntryId,
      },
      shellPath: opts.sessionType === "shell" ? await getDefaultShellPath() : undefined,
      onSessionExited: (sessionId, exitCode) => {
        void flowRunner.handleSessionExit(sessionId, exitCode);
      },
    });
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

Important UI sync requirement:

- The shared session helper must broadcast `MSG.TASK_UPDATED` after adding a task-owned session ref and after removing it on exit/close.
- That broadcast is what makes backend-spawned flow sessions appear as tabs through the existing UI `task-store` -> `TaskSidebar` -> `session-store.syncWithTasks` pipeline.
- Do not rely on `flow:run-updated` alone for tab creation/removal; it only carries flow state, not task session membership.

After creating `FlowRunner`, add startup recovery for flow runs stuck in "running" state from a previous process crash:

```typescript
// Recover any flow runs stuck in "running" state from a previous process.
// The in-memory sessionFlowMap is lost on restart, so we must also clear
// stale sessionId references from step states — otherwise handleSessionExit
// would silently ignore exits from sessions that survived the restart.
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
        currentStep.sessionId = undefined; // Clear stale session reference
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
git add packages/backend/src/services/session-lifecycle.ts packages/backend/src/index.ts packages/backend/src/handlers/session.ts packages/backend/src/handlers/task.ts
git commit -m "feat: extract session lifecycle helper and wire FlowStore/FlowRunner"
```

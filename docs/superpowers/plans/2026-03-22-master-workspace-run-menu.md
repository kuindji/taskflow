# Master Workspace Run Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Run menu to the master workspace showing user-level `.claude` commands, global flows, and global standalone actions.

**Architecture:** Extend `FlowOwner` discriminated union with `{ master: true }` variant. Propagate through backend flow handler, flow runner, and index.ts wiring. On the UI side, remove master-scope guards that skip data fetching and wire the filtered data into the existing TabBar Run menu.

**Tech Stack:** TypeScript, Bun, React, Zustand

**Spec:** `docs/superpowers/specs/2026-03-22-master-workspace-run-menu-design.md`

---

### Task 1: Extend FlowOwner and Related Shared Types

**Files:**
- Modify: `packages/shared/src/types/flow.ts:79` (FlowOwner)
- Modify: `packages/shared/src/types/flow.ts:92-96` (getFlowRunOwnerId)
- Modify: `packages/shared/src/types/flow.ts:109-114` (FlowStartPayload)

- [ ] **Step 1: Update FlowOwner type**

In `packages/shared/src/types/flow.ts` line 79, replace:
```typescript
type FlowOwner = { taskId: string; projectId?: never } | { projectId: string; taskId?: never };
```
with:
```typescript
type FlowOwner =
    | { taskId: string; projectId?: never; master?: never }
    | { projectId: string; taskId?: never; master?: never }
    | { master: true; taskId?: never; projectId?: never };
```

- [ ] **Step 2: Update getFlowRunOwnerId**

In `packages/shared/src/types/flow.ts` lines 92-96, replace:
```typescript
function getFlowRunOwnerId(run: FlowRun): string {
    const id = run.taskId ?? run.projectId;
    if (!id) throw new Error("FlowRun must have either taskId or projectId");
    return id;
}
```
with:
```typescript
function getFlowRunOwnerId(run: FlowRun): string {
    if (run.taskId) return run.taskId;
    if (run.projectId) return run.projectId;
    if (run.master) return "__master__";
    throw new Error("FlowRun must have taskId, projectId, or master");
}
```

- [ ] **Step 3: Update FlowStartPayload**

In `packages/shared/src/types/flow.ts` lines 109-114, add `master` field:
```typescript
interface FlowStartPayload {
    taskId?: string;
    projectId?: string;
    master?: true;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/shared && bun run typecheck`
Expected: Pass (FlowRun inherits the new variant via `FlowOwner & { ... }` automatically).

Note: downstream packages will have type errors until Tasks 2-4 are done — that's expected.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/flow.ts
git commit -m "feat: extend FlowOwner type with master variant"
```

---

### Task 2: Update Backend Flow Handler

**Files:**
- Modify: `packages/backend/src/handlers/flow.ts:110-117`

- [ ] **Step 1: Update FLOW_START handler**

In `packages/backend/src/handlers/flow.ts` lines 110-117, replace:
```typescript
            if (payload.taskId) {
                return await flowRunner.startFlow({ taskId: payload.taskId }, flow, inputValues);
            }
            if (!payload.projectId) {
                throw new Error("Flow start requires either taskId or projectId");
            }
            const owner: FlowOwner = { projectId: payload.projectId };
            return await flowRunner.startFlow(owner, flow, inputValues);
```
with:
```typescript
            if (payload.taskId) {
                return await flowRunner.startFlow({ taskId: payload.taskId }, flow, inputValues);
            }
            if (payload.master) {
                return await flowRunner.startFlow({ master: true }, flow, inputValues);
            }
            if (!payload.projectId) {
                throw new Error("Flow start requires taskId, projectId, or master");
            }
            const owner: FlowOwner = { projectId: payload.projectId };
            return await flowRunner.startFlow(owner, flow, inputValues);
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/handlers/flow.ts
git commit -m "feat: accept master owner in FLOW_START handler"
```

---

### Task 3: Update FlowRunner Service

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts:87` (startFlow ownerId)
- Modify: `packages/backend/src/services/flow-runner.ts:348-352` (ownerFromRun)
- Modify: `packages/backend/src/services/flow-runner.ts:410` (launchAction ownerId)

- [ ] **Step 1: Add private getOwnerId helper**

Add a private method to FlowRunner (near `ownerFromRun` around line 348):

```typescript
    private getOwnerId(owner: FlowOwner): string {
        if (owner.taskId) return owner.taskId;
        if (owner.projectId) return owner.projectId;
        if (owner.master) return "__master__";
        throw new Error("FlowOwner must have taskId, projectId, or master");
    }
```

- [ ] **Step 2: Update startFlow ownerId computation**

In `packages/backend/src/services/flow-runner.ts` line 87, replace:
```typescript
        const ownerId = owner.taskId ?? owner.projectId;
```
with:
```typescript
        const ownerId = this.getOwnerId(owner);
```

- [ ] **Step 3: Update ownerFromRun**

In `packages/backend/src/services/flow-runner.ts` lines 348-352, replace:
```typescript
    private ownerFromRun(run: FlowRun): FlowOwner {
        if (run.taskId) return { taskId: run.taskId };
        if (run.projectId) return { projectId: run.projectId };
        throw new Error("FlowRun must have either taskId or projectId");
    }
```
with:
```typescript
    private ownerFromRun(run: FlowRun): FlowOwner {
        if (run.taskId) return { taskId: run.taskId };
        if (run.projectId) return { projectId: run.projectId };
        if (run.master) return { master: true };
        throw new Error("FlowRun must have taskId, projectId, or master");
    }
```

- [ ] **Step 4: Update launchAction ownerId computation**

In `packages/backend/src/services/flow-runner.ts` line 410, replace:
```typescript
        const ownerId = owner.taskId ?? owner.projectId;
```
with:
```typescript
        const ownerId = this.getOwnerId(owner);
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts
git commit -m "feat: handle master owner in FlowRunner"
```

---

### Task 4: Update FlowRunner Wiring in index.ts

**Files:**
- Modify: `packages/backend/src/index.ts:148-150` (spawnSession callback)
- Modify: `packages/backend/src/index.ts:173-183` (getOwnerDescription callback)

- [ ] **Step 1: Update spawnSession callback**

In `packages/backend/src/index.ts` lines 148-150, replace:
```typescript
                const owner = opts.owner.taskId
                    ? { taskId: opts.owner.taskId }
                    : { projectId: opts.owner.projectId };
```
with:
```typescript
                const owner = opts.owner.taskId
                    ? { taskId: opts.owner.taskId }
                    : opts.owner.master
                      ? { master: true as const }
                      : { projectId: opts.owner.projectId };
```

- [ ] **Step 2: Update getOwnerDescription callback**

In `packages/backend/src/index.ts` lines 173-183, replace:
```typescript
            getOwnerDescription: async (owner) => {
                if (owner.taskId) {
                    const task = await store.getTask(owner.taskId);
                    return task?.description ?? "";
                }
                // If not task-scoped, must be project-scoped (FlowOwner is a discriminated union)
                const projectId = owner.projectId;
                if (!projectId) return "";
                const project = await store.getProject(projectId);
                return project?.name ?? "";
            },
```
with:
```typescript
            getOwnerDescription: async (owner) => {
                if (owner.taskId) {
                    const task = await store.getTask(owner.taskId);
                    return task?.description ?? "";
                }
                if (owner.master) return "Master workspace";
                const projectId = owner.projectId;
                if (!projectId) return "";
                const project = await store.getProject(projectId);
                return project?.name ?? "";
            },
```

- [ ] **Step 3: Typecheck backend**

Run: `cd packages/backend && bun run typecheck`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: wire master owner through FlowRunner callbacks"
```

---

### Task 5: Fix Agent Commands Deduplication

**Files:**
- Modify: `packages/backend/src/handlers/agent-commands.ts:36-49`

- [ ] **Step 1: Add deduplication when projectDir equals userDir**

In `packages/backend/src/handlers/agent-commands.ts`, replace the handler body (lines 37-48):
```typescript
    router.register(MSG.AGENT_COMMANDS_LIST, async (payload) => {
        const { path } = payload as AgentCommandsListPayload;
        const projectDir = join(path, ".claude", "commands");
        const userDir = join(homedir(), ".claude", "commands");

        const [projectCommands, userCommands] = await Promise.all([
            scanCommands(projectDir, "project"),
            scanCommands(userDir, "user"),
        ]);

        return { commands: [...projectCommands, ...userCommands] };
    });
```
with:
```typescript
    router.register(MSG.AGENT_COMMANDS_LIST, async (payload) => {
        const { path } = payload as AgentCommandsListPayload;
        const projectDir = join(path, ".claude", "commands");
        const userDir = join(homedir(), ".claude", "commands");

        // When projectDir and userDir are the same (e.g. master workspace where
        // path is $HOME), skip the project scan to avoid duplicate entries.
        if (projectDir === userDir) {
            const userCommands = await scanCommands(userDir, "user");
            return { commands: userCommands };
        }

        const [projectCommands, userCommands] = await Promise.all([
            scanCommands(projectDir, "project"),
            scanCommands(userDir, "user"),
        ]);

        return { commands: [...projectCommands, ...userCommands] };
    });
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/handlers/agent-commands.ts
git commit -m "fix: deduplicate agent commands when project dir equals user dir"
```

---

### Task 6: Update FlowStartParams in UI Flow Store

**Files:**
- Modify: `packages/ui/src/stores/flow-store.ts:22-27` (FlowStartParams)

- [ ] **Step 1: Add master field to FlowStartParams**

In `packages/ui/src/stores/flow-store.ts` lines 22-27, replace:
```typescript
interface FlowStartParams {
    taskId?: string;
    projectId?: string;
    flowId: string;
    inputValues?: Record<string, string>;
}
```
with:
```typescript
interface FlowStartParams {
    taskId?: string;
    projectId?: string;
    master?: true;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/flow-store.ts
git commit -m "feat: add master field to FlowStartParams"
```

---

### Task 7: Wire Master Workspace Run Menu in Workspace.tsx

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:101` (ownerId)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:204-223` (agent commands fetch)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:508-551` (master render block)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:594-610` (handleRunAction — move before master block)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:612-632` (handleStartFlow — move before master block)

**Important:** `handleRunAction` (line 594) and `handleStartFlow` (line 612) are currently defined *after* the master scope early-return block (line 508). Since the master block does `if (workspace.scope === "master") { return (...) }`, these handlers are unreachable in master scope. They must be moved above the master block (after `handleRunAgentCommand` at line 506) so they're in scope when the master block references them.

- [ ] **Step 1: Move handleRunAction and handleStartFlow above master block**

Cut `handleRunAction` (lines 594-610) and `handleStartFlow` (lines 612-632) from their current positions and paste them immediately after `handleRunAgentCommand` (after line 506), before the `if (workspace.scope === "master")` check. No code changes to the functions themselves — just relocate them.

- [ ] **Step 2: Update ownerId computation**

In `packages/ui/src/components/workspace/Workspace.tsx` line 101, replace (line numbers below are from original file — adjust after Step 1 moves code):
```typescript
    const ownerId = taskId ?? workspace.project?.id;
```
with:
```typescript
    const ownerId =
        taskId ?? workspace.project?.id ?? (workspace.scope === "master" ? "__master__" : undefined);
```

- [ ] **Step 3: Update agent commands fetch to include master scope**

In `packages/ui/src/components/workspace/Workspace.tsx` lines 204-207, replace:
```typescript
        if (!workspace.workingDir || workspace.scope === "master") {
            setAgentCommands(emptyAgentCommands);
            return;
        }
```
with:
```typescript
        if (!workspace.workingDir) {
            setAgentCommands(emptyAgentCommands);
            return;
        }
```

This removes the master-scope guard. When `scope === "master"`, `workspace.workingDir` is `$HOME`, so the request goes to the backend which now deduplicates correctly (Task 5).

- [ ] **Step 4: Update handleStartFlow**

In `packages/ui/src/components/workspace/Workspace.tsx` lines 612-617, replace:
```typescript
        const owner = taskId
            ? { taskId, flowId }
            : workspace.project
              ? { projectId: workspace.project.id, flowId }
              : null;
        if (!owner) return;
```
with:
```typescript
        const owner = taskId
            ? { taskId, flowId }
            : workspace.project
              ? { projectId: workspace.project.id, flowId }
              : workspace.scope === "master"
                ? { master: true as const, flowId }
                : null;
        if (!owner) return;
```

- [ ] **Step 5: Update master scope render block**

In `packages/ui/src/components/workspace/Workspace.tsx`, in the master scope block (lines 508-551), update the TabBar props. Replace these specific prop lines:

```typescript
                    onRunAction={() => {}}
```
with:
```typescript
                    onRunAction={handleRunAction}
```

Replace:
```typescript
                    onStartFlow={() => {}}
```
with:
```typescript
                    onStartFlow={handleStartFlow}
```

Replace:
```typescript
                    scripts={{}}
                    defaultRuntime={defaultRuntime}
                    flows={[]}
                    standaloneActions={[]}
                    agentCommands={[]}
                    activeFlowRun={null}
                    showRunButton={false}
```
with:
```typescript
                    scripts={{}}
                    defaultRuntime={defaultRuntime}
                    flows={flowRunsReady ? flowDefinitions : []}
                    standaloneActions={standaloneActions}
                    agentCommands={agentCommands}
                    activeFlowRun={activeFlowRun ?? null}
                    showRunButton={
                        agentCommands.length > 0 ||
                        standaloneActions.length > 0 ||
                        (flowRunsReady && flowDefinitions.length > 0)
                    }
```

- [ ] **Step 6: Typecheck UI**

Run: `cd packages/ui && bun run typecheck`
Expected: Pass

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: wire Run menu data into master workspace"
```

---

### Task 8: Update FlowRunner Tests

**Files:**
- Modify: `packages/backend/src/services/__tests__/flow-runner.test.ts`

- [ ] **Step 1: Add master owner test for startFlow**

Add a new test in the `startFlow` describe block:
```typescript
    test("starts flow with master owner", async () => {
        const masterOwner: FlowOwner = { master: true };
        await runner.startFlow(masterOwner, testFlow);
        expect(flowStore.saveFlowRun).toHaveBeenCalled();
        expect(spawnedSessions.length).toBe(1);
        expect(spawnedSessions[0].owner).toEqual({ master: true });
    });
```

- [ ] **Step 2: Add master owner test for getFlowRunOwnerId**

Add a test for the shared helper:
```typescript
describe("getFlowRunOwnerId", () => {
    test("returns __master__ for master owner", () => {
        const run = {
            master: true,
            flowId: "flow-1",
            status: "running" as const,
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        expect(getFlowRunOwnerId(run as FlowRun)).toBe("__master__");
    });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/backend && bun test src/services/__tests__/flow-runner.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "test: add master owner tests for FlowRunner"
```

---

### Task 9: Lint and Full Typecheck

- [ ] **Step 1: Run full typecheck across all packages**

Run: `bun run typecheck` (from project root)
Expected: Pass

- [ ] **Step 2: Run lint**

Run: `bun run lint` (from project root)
Expected: Pass (or only pre-existing warnings)

- [ ] **Step 3: Run all tests**

Run: `bun test` (from project root)
Expected: All pass

- [ ] **Step 4: Fix any issues found, commit if needed**

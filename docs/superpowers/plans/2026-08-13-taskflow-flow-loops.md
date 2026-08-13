# Flow Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a flow be marked as a loop so it restarts from its first action when the last one finishes, keeping inputs and artifacts, with agents controlling it through exactly two commands.

**Architecture:** A `loop` flag on `FlowDefinition` is snapshotted onto the `FlowRun` at start. The runner's `advanceOrComplete` gains one branch that resets action state and relaunches action 0 instead of completing. A new `completeFlow` ends the run immediately from any step. Because a looped run lives indefinitely, two latent problems become load-bearing and are fixed here: agent sessions are closed when a looped step completes, and every public mutating method on the runner is serialized under the existing owner lock.

**Tech Stack:** TypeScript, Bun (test runner and build), React + Zustand (UI), POSIX shell (the CLI that actually ships on macOS/Linux).

**Spec:** `docs/superpowers/specs/2026-08-13-taskflow-flow-loops-design.md`

## Global Constraints

- Use `bun`, never `npm` or `yarn`, for installing dependencies and running anything.
- No `as any`. Pursue proper types. The existing test mocks end with `as unknown as FlowStore` — that is the established pattern and is fine to follow.
- Keep types reusable and in `packages/shared/src/types/` where they are shared. Check existing types before adding new ones.
- Do not export anything that is not consumed elsewhere.
- Do not disable eslint rules; fix the underlying issue.
- Do not add `Co-Authored-By` trailers to commits.
- There are **two** CLI implementations: `packages/backend/src/services/taskflow-cli.sh` (the one that runs on macOS/Linux) and `packages/backend/src/services/taskflow-cli-bin.ts`. Any CLI change must land in both.
- Run backend tests with `bun test packages/backend/src/services/__tests__/<file>` from the repo root.

### Refinement to the spec

The spec says `completeFlow` closes the calling session "for a looped flow". During planning this was tightened: **`completeFlow` always closes the calling session**, looped or not, because the run is ending — which is what `stopFlow` and `failFlow` already do. The looped-only rule still applies to `handleActionComplete`, where the run continues. Task 7 implements it this way.

---

### Task 1: Types and `loop` validation

**Files:**
- Modify: `packages/shared/src/types/flow.ts:47-56` (FlowDefinition), `:86-95` (FlowRun)
- Modify: `packages/backend/src/services/flow-store.ts:12-45` (`assertValidFlowDefinition`)
- Test: `packages/backend/src/services/__tests__/flow-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FlowDefinition.loop?: boolean`, `FlowRun.loop?: boolean`, `FlowRun.iteration?: number`. Every later task depends on these three fields.

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/src/services/__tests__/flow-store.test.ts`. Match the file's existing describe/test style and its way of constructing a store — read the top of the file first and reuse its setup helper rather than inventing one.

```ts
describe("assertValidFlowDefinition — loop", () => {
    test("accepts a definition with loop true", async () => {
        await expect(
            store.saveFlow({
                id: "loop-flow",
                name: "Loop",
                description: "",
                loop: true,
                actions: [
                    { id: "entry-1", inline: { name: "A", prompt: "p", sessionType: "claude" } },
                ],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }),
        ).resolves.toBeUndefined();
    });

    test("rejects a non-boolean loop", async () => {
        const flow = {
            id: "bad-loop-flow",
            name: "Bad",
            description: "",
            loop: "false",
            actions: [{ id: "entry-1", inline: { name: "A", prompt: "p", sessionType: "claude" } }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        } as unknown as FlowDefinition;

        await expect(store.saveFlow(flow)).rejects.toThrow(
            'Flow "bad-loop-flow" has a non-boolean loop value',
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/src/services/__tests__/flow-store.test.ts`
Expected: FAIL — the first test fails to typecheck or the second does not throw, because `loop` is not yet a field and is not validated.

- [ ] **Step 3: Add the type fields**

In `packages/shared/src/types/flow.ts`, add `loop` to `FlowDefinition`:

```ts
interface FlowDefinition {
    id: string;
    projectId?: string;
    name: string;
    description: string;
    actions: FlowActionEntry[];
    inputs?: FlowInputDefinition[];
    // When true, the run restarts from the first action after the last completes
    loop?: boolean;
    createdAt: string;
    updatedAt: string;
}
```

And add `loop` plus `iteration` to `FlowRun`:

```ts
type FlowRun = FlowOwner & {
    flowId: string;
    status: FlowRunStatus;
    currentActionIndex: number;
    actions: FlowActionState[];
    artifacts: FlowArtifact[];
    inputValues?: Record<string, string>;
    // Snapshot of the definition's loop flag, taken at start. The runner reads
    // this, never the live definition, so editing a flow mid-run cannot change
    // the behaviour of a run already in flight.
    loop?: boolean;
    // 1-based; undefined means iteration 1
    iteration?: number;
    startedAt: string;
    completedAt?: string;
};
```

No change to the `export type { ... }` block — both interfaces are already exported.

- [ ] **Step 4: Add the validation**

In `packages/backend/src/services/flow-store.ts`, inside `assertValidFlowDefinition`, after the `flow.actions.length === 0` check:

```ts
    if (flow.loop !== undefined && typeof flow.loop !== "boolean") {
        throw new Error(`Flow "${flow.id}" has a non-boolean loop value`);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-store.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/flow.ts packages/backend/src/services/flow-store.ts packages/backend/src/services/__tests__/flow-store.test.ts
git commit -m "feat(flows): add loop flag to flow definitions and runs"
```

---

### Task 2: Extract `endRun` (pure refactor)

Extract the shared ending logic so stop, fail, and the upcoming `completeFlow` cannot drift. **This task must not change any behaviour.** The tests you write first are characterisation tests: they pass before and after.

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts:362-378` (`failFlow`)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `private async endRun(run: FlowRun, opts: EndRunOptions): Promise<void>` where `EndRunOptions` is `{ status: "completed" | "failed"; runningStepOutcome: FlowActionStatus; skipPending: boolean }`. Tasks 5 and 7 call it.

- [ ] **Step 1: Write the characterisation tests**

Add to `packages/backend/src/services/__tests__/flow-runner.test.ts`. The harness (`flowStore`, `runner`, `taskOwner`, `testFlow`, `spawnedSessions`, `closedSessions`) is already set up in `beforeEach` at the top of that file — reuse it, do not redefine it.

```ts
describe("stopFlow — non-looped behaviour is preserved", () => {
    test("closes the session, fails the running action, leaves pending actions pending", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("failed");
        expect(run?.completedAt).toBeDefined();
        expect(run?.actions[0].status).toBe("failed");
        expect(run?.actions[0].sessionId).toBeUndefined();
        expect(run?.actions[1].status).toBe("pending");
        expect(closedSessions).toEqual(["session-1"]);
    });

    test("does not re-mark an action that is not running", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.skipAction("task-1", "flow-1");
        // action 0 is now "skipped", action 1 is running
        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.actions[1].status).toBe("failed");
    });
});
```

- [ ] **Step 2: Run tests to verify they pass on current code**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS. These describe existing behaviour. If either fails, stop and re-read `failFlow` — your understanding of current behaviour is wrong and the refactor would break something.

- [ ] **Step 3: Extract the helper**

In `packages/backend/src/services/flow-runner.ts`, add the options interface near the other local interfaces at the top of the file (below `SessionFlowMapping`):

```ts
interface EndRunOptions {
    status: "completed" | "failed";
    // Applied only to a step whose status is currently "running"
    runningStepOutcome: FlowActionStatus;
    // When true, every still-pending step is marked skipped
    skipPending: boolean;
}
```

Add `FlowActionStatus` to the existing `import type { ... } from "@taskflow/shared"` list at the top of the file.

Replace the body of `failFlow` and add `endRun` beside it:

```ts
    private async failFlow(run: FlowRun): Promise<void> {
        await this.endRun(run, {
            status: "failed",
            runningStepOutcome: "failed",
            skipPending: false,
        });
    }

    private async endRun(run: FlowRun, opts: EndRunOptions): Promise<void> {
        const currentAction = run.actions[run.currentActionIndex];
        if (currentAction?.sessionId) {
            // Drop the mapping before closing: handleSessionExit returns early
            // on a missing mapping, which makes the async exit inert.
            this.sessionFlowMap.delete(currentAction.sessionId);
            this.deps.closeSession(currentAction.sessionId);
            currentAction.sessionId = undefined;
        }
        if (currentAction?.status === "running") {
            currentAction.status = opts.runningStepOutcome;
            currentAction.completedAt = new Date().toISOString();
        }
        if (opts.skipPending) {
            const skippedAt = new Date().toISOString();
            for (const action of run.actions) {
                if (action.status === "pending") {
                    action.status = "skipped";
                    action.completedAt = skippedAt;
                }
            }
        }

        run.status = opts.status;
        run.completedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }
```

Note the one intentional ordering change inside the session-closing block: the map entry is deleted *before* `closeSession`, where the old code closed first. Both are safe because the PTY exit is asynchronous (`pty-manager.ts:291` kills and returns; `cleanup` at line 199 fires later), but delete-first is the ordering the rest of this plan relies on.

- [ ] **Step 4: Run tests to verify they still pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — the whole file, unchanged behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "refactor(flows): extract endRun helper from failFlow"
```

---

### Task 3: Serialize the runner's public mutators under the owner lock

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts` — `handleActionComplete` (131), `skipAction` (145), `jumpToAction` (163), `pauseFlow` (213), `resumeFlow` (229), `stopFlow` (249), `handleSessionExit` (255), `saveArtifact` (292), `failFlowByIds` (340)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: `withOwnerLock` (already exists at line 50).
- Produces: no new signatures. Every listed method keeps its exact signature and return type.

**Critical:** `withOwnerLock` is **not** re-entrant — a nested call awaits a gate its own caller holds and deadlocks forever. Take the lock at public entry points only. `failFlow`, `endRun`, `advanceOrComplete`, `launchAction`, `launchActionWithRecovery`, `launchPersistedActionWithRecovery`, and `markActionLaunchFailed` must stay unlocked. `startFlow` already locks — do not add a second lock to it.

- [ ] **Step 1: Write the failing test**

```ts
describe("owner lock", () => {
    test("concurrent action completions advance the run only once", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;

        await Promise.all([
            runner.handleActionComplete("task-1", "flow-1", sessionId),
            runner.handleActionComplete("task-1", "flow-1", sessionId),
        ]);

        // One session for action 0, one for action 1. A duplicate advance
        // would spawn a third.
        expect(spawnedSessions).toHaveLength(2);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.currentActionIndex).toBe(1);
    });

    test("a session exit racing a completion does not overwrite the advanced run", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;

        await Promise.all([
            runner.handleActionComplete("task-1", "flow-1", sessionId),
            runner.handleSessionExit(sessionId, 0),
        ]);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[0].status).toBe("completed");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL. The mock store's `getFlowRun` returns a `structuredClone`, so both callers mutate independent copies and the second save clobbers the first — exactly the production race.

- [ ] **Step 3: Wrap the methods**

For each of `handleActionComplete`, `skipAction`, `jumpToAction`, `pauseFlow`, `resumeFlow`, `stopFlow`, `saveArtifact`, and `failFlowByIds`, keep the existing body verbatim and wrap it. `handleActionComplete` becomes:

```ts
    async handleActionComplete(ownerId: string, flowId: string, sessionId: string): Promise<void> {
        return this.withOwnerLock(ownerId, async () => {
            const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
            if (!run || run.status !== "running") return;

            const currentAction = run.actions[run.currentActionIndex];
            if (!currentAction || currentAction.sessionId !== sessionId) return;

            currentAction.status = "completed";
            currentAction.completedAt = new Date().toISOString();
            this.sessionFlowMap.delete(sessionId);

            await this.advanceOrComplete(run);
        });
    }
```

Apply the same shape to the others — they all already receive `ownerId` as their first parameter, so the lock key is at hand.

`handleSessionExit` is the exception: it receives a `sessionId`, not an `ownerId`, so the mapping lookup must happen *outside* the lock to supply the key:

```ts
    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const mapping = this.sessionFlowMap.get(sessionId);
        if (!mapping) return;

        const { ownerId, flowId, sessionType } = mapping;
        return this.withOwnerLock(ownerId, async () => {
            const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
            if (!run) return;

            const currentAction = run.actions[run.currentActionIndex];
            if (!currentAction || currentAction.sessionId !== sessionId) return;

            // Already completed via action complete signal — ignore
            if (currentAction.status === "completed" || currentAction.status === "skipped") {
                this.sessionFlowMap.delete(sessionId);
                return;
            }

            if (sessionType === "shell" && exitCode === 0) {
                // Shell actions auto-complete on clean exit
                currentAction.status = "completed";
                currentAction.completedAt = new Date().toISOString();
                this.sessionFlowMap.delete(sessionId);
                await this.advanceOrComplete(run);
            } else if (run.status === "paused") {
                // Flow was paused — don't mark as failed, just clean up
                this.sessionFlowMap.delete(sessionId);
            } else {
                // Agent exited without signaling complete — fail the action, pause the flow
                currentAction.status = "failed";
                currentAction.completedAt = new Date().toISOString();
                run.status = "paused";
                this.sessionFlowMap.delete(sessionId);
                await this.deps.flowStore.saveFlowRun(run);
                this.broadcastUpdate(run);
            }
        });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — the new tests and every pre-existing test in the file. A hang instead of a failure means you locked a private helper; remove that lock.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "fix(flows): serialize runner mutations under the owner lock"
```

---

### Task 4: Snapshot `loop` onto the run, and wrap around

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts` — `startFlow` (107-119), `advanceOrComplete` (380-398), `getArtifacts` (335-338)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: Task 1's `FlowRun.loop` / `FlowRun.iteration`.
- Produces: `private async startNextIteration(run: FlowRun): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add a looped fixture next to the existing `testFlow` constant at the top of the file:

```ts
const loopFlow: FlowDefinition = {
    id: "loop-flow",
    name: "Loop Flow",
    description: "test",
    loop: true,
    actions: [
        { id: "entry-1", inline: { name: "Plan", prompt: "Write a plan", sessionType: "claude" } },
        { id: "entry-2", inline: { name: "Review", prompt: "Review it", sessionType: "claude" } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};
```

Seed it alongside `testFlow` in `beforeEach`, right after the existing `await flowStore.saveFlow(testFlow);`:

```ts
    await flowStore.saveFlow(loopFlow);
```

Then the tests:

```ts
describe("looping", () => {
    test("wraps to iteration 2 instead of completing", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
        expect(run?.actions[0].status).toBe("running");
        expect(run?.actions[1].status).toBe("pending");
        expect(run?.actions[1].completedAt).toBeUndefined();
        expect(spawnedSessions).toHaveLength(3);
    });

    test("carries inputs and artifacts across the wrap", async () => {
        const inputFlow: FlowDefinition = {
            ...loopFlow,
            id: "loop-input-flow",
            inputs: [{ id: "topic", label: "Topic", type: "text" }],
        };
        await flowStore.saveFlow(inputFlow);
        await runner.startFlow(taskOwner, inputFlow, { topic: "caching" });

        await runner.saveArtifact(
            "task-1",
            "loop-input-flow",
            "entry-1",
            spawnedSessions[0].sessionId,
            { type: "plan", text: "iteration one plan" },
        );
        await runner.handleActionComplete(
            "task-1",
            "loop-input-flow",
            spawnedSessions[0].sessionId,
        );
        await runner.handleActionComplete(
            "task-1",
            "loop-input-flow",
            spawnedSessions[1].sessionId,
        );

        const run = await flowStore.getFlowRun("task-1", "loop-input-flow");
        expect(run?.inputValues).toEqual({ topic: "caching" });
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].text).toBe("iteration one plan");
    });

    test("an artifact re-saved in iteration 2 replaces the iteration 1 value", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "first",
        });
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        // Now in iteration 2, action 0, on a fresh session
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[2].sessionId, {
            type: "plan",
            text: "second",
        });

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].text).toBe("second");
    });

    test("editing loop off on the definition does not change a run already in flight", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await flowStore.saveFlow({ ...loopFlow, loop: false });

        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
    });

    test("a launch failure on the first action of a new iteration pauses the run", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        spawnError = new Error("spawn failed");

        await expect(
            runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId),
        ).rejects.toThrow("spawn failed");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("paused");
        expect(run?.iteration).toBe(2);
        expect(run?.actions[0].status).toBe("failed");
    });

    test("a step failing mid-loop pauses the run instead of wrapping, and Resume retries it", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        // Agent on the last step exits without signalling completion.
        await runner.handleSessionExit(spawnedSessions[1].sessionId, 1);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("paused");
        expect(run?.iteration).toBe(1);
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[1].status).toBe("failed");

        await runner.resumeFlow("task-1", "loop-flow");

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(1);
        expect(run?.currentActionIndex).toBe(1);
        expect(spawnedSessions).toHaveLength(3);
    });

    test("a non-looped flow still completes after its last action", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("completed");
        expect(run?.iteration).toBeUndefined();
    });
});

describe("getArtifacts", () => {
    test("does not reorder the run's artifact array", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        if (!run) throw new Error("expected a run");
        run.artifacts = [
            { type: "a", text: "older", actionEntryId: "entry-1", createdAt: "2020-01-01T00:00:00.000Z" },
            { type: "b", text: "newer", actionEntryId: "entry-1", createdAt: "2030-01-01T00:00:00.000Z" },
        ];

        runner.getArtifacts(run);

        expect(run.artifacts.map((a) => a.type)).toEqual(["a", "b"]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL — looped runs complete instead of wrapping, and `getArtifacts` reorders in place.

- [ ] **Step 3: Snapshot `loop` in `startFlow`**

In `startFlow`, extend the `run` object literal (currently lines 107-119):

```ts
            const run: FlowRun = {
                ...owner,
                flowId: flow.id,
                status: "running",
                currentActionIndex: 0,
                actions: flow.actions.map((s) => ({
                    actionEntryId: s.id,
                    status: "pending",
                })),
                artifacts: [],
                inputValues: flow.inputs && flow.inputs.length > 0 ? inputValues : undefined,
                loop: flow.loop ? true : undefined,
                iteration: flow.loop ? 1 : undefined,
                startedAt: new Date().toISOString(),
            };
```

- [ ] **Step 4: Add the wrap branch and `startNextIteration`**

Change the head of `advanceOrComplete`:

```ts
    private async advanceOrComplete(run: FlowRun): Promise<void> {
        const nextIndex = run.currentActionIndex + 1;
        if (nextIndex >= run.actions.length) {
            if (run.loop) {
                await this.startNextIteration(run);
                return;
            }
            run.status = "completed";
            run.completedAt = new Date().toISOString();
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);
            return;
        }
        // ...rest of the method unchanged
```

Add the new private method beside it:

```ts
    private async startNextIteration(run: FlowRun): Promise<void> {
        for (const action of run.actions) {
            this.resetActionState(action);
        }
        // Artifacts and inputValues are deliberately preserved across the wrap.
        run.iteration = (run.iteration ?? 1) + 1;
        run.currentActionIndex = 0;
        run.actions[0].status = "running";
        run.actions[0].startedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        const owner = this.ownerFromRun(run);
        await this.launchPersistedActionWithRecovery(owner, run.flowId, run, 0);
    }
```

- [ ] **Step 5: Fix the in-place sort in `getArtifacts`**

```ts
    getArtifacts(run: FlowRun, type?: string): FlowArtifact[] {
        const artifacts = type ? run.artifacts.filter((a) => a.type === type) : [...run.artifacts];
        return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
```

(`filter` already returns a new array; only the untyped branch needed the copy.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — whole file.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "feat(flows): wrap looped runs to a new iteration instead of completing"
```

---

### Task 5: Stop completes a looped run

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts:249-253` (`stopFlow`)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: `endRun` (Task 2), `run.loop` (Task 4).
- Produces: no new signatures.

- [ ] **Step 1: Write the failing test**

```ts
describe("stopFlow — looped runs", () => {
    test("ends a looped run as completed with the in-flight step skipped", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.stopFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
        expect(run?.completedAt).toBeDefined();
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.actions[1].status).toBe("skipped");
        expect(closedSessions).toEqual(["session-1"]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL with `status` being `"failed"`, not `"completed"`.

- [ ] **Step 3: Branch on `run.loop`**

```ts
    async stopFlow(ownerId: string, flowId: string): Promise<void> {
        return this.withOwnerLock(ownerId, async () => {
            const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
            if (!run) return;
            if (run.loop) {
                // Stopping a loop is its normal ending, not an error
                await this.endRun(run, {
                    status: "completed",
                    runningStepOutcome: "skipped",
                    skipPending: true,
                });
                return;
            }
            await this.failFlow(run);
        });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — including the Task 2 characterisation tests, which pin that non-looped stop is untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "feat(flows): stopping a looped run completes it rather than failing it"
```

---

### Task 6: Close the session when a looped step completes

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts` — `handleActionComplete`
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: `run.loop` (Task 4), the owner lock (Task 3).
- Produces: no new signatures.

**Why:** `closeSession` is called on skip, jump, pause, and fail but never on normal completion — the runner expects agent sessions to outlive their step. Over an unbounded loop that is one live PTY per step per lap, forever.

- [ ] **Step 1: Write the failing tests**

```ts
describe("session cleanup on completion", () => {
    test("a looped flow closes the completed step's session", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleActionComplete("task-1", "loop-flow", sessionId);

        expect(closedSessions).toEqual([sessionId]);
        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.actions[0].sessionId).toBeUndefined();
    });

    test("a non-looped flow leaves the completed step's session open", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);

        expect(closedSessions).toEqual([]);
    });

    test("a late exit from a closed session does not disturb the wrapped run", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        const firstSessionId = spawnedSessions[0].sessionId;
        await runner.handleActionComplete("task-1", "loop-flow", firstSessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);
        // Iteration 2 is now running action 0 on a different session.

        await runner.handleSessionExit(firstSessionId, 1);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        expect(run?.actions[0].status).toBe("running");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL — the first test sees `closedSessions` empty.

- [ ] **Step 3: Close on completion for looped runs**

Inside the locked body of `handleActionComplete`, replace the completion block:

```ts
            currentAction.status = "completed";
            currentAction.completedAt = new Date().toISOString();
            this.sessionFlowMap.delete(sessionId);

            if (run.loop) {
                // A looped run never ends on its own, so a session left open per
                // step per iteration would accumulate without bound. The mapping
                // is already deleted above, which makes the async exit inert.
                currentAction.sessionId = undefined;
                this.deps.closeSession(sessionId);
            }

            await this.advanceOrComplete(run);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — whole file.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "fix(flows): close a looped step's session when it completes"
```

---

### Task 7: `completeFlow` and its route

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts` (new public method)
- Modify: `packages/backend/src/api/routes/flow-routes.ts:64` (register a route after `/api/flow/action-complete`)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`, `packages/backend/src/services/__tests__/flow-integration.test.ts`

**Interfaces:**
- Consumes: `endRun` (Task 2), the owner lock (Task 3).
- Produces: `async completeFlow(ownerId: string, flowId: string, sessionId: string): Promise<void>` on `FlowRunner`, and `POST /api/flow/complete` accepting `{ taskId?: string; projectId?: string; flowId: string; sessionId: string }`.

- [ ] **Step 1: Write the failing runner tests**

```ts
describe("completeFlow", () => {
    test("ends the run immediately and skips the remaining steps", async () => {
        const threeStep: FlowDefinition = {
            ...loopFlow,
            id: "three-step-flow",
            actions: [
                { id: "entry-1", inline: { name: "A", prompt: "a", sessionType: "claude" } },
                { id: "entry-2", inline: { name: "B", prompt: "b", sessionType: "claude" } },
                { id: "entry-3", inline: { name: "C", prompt: "c", sessionType: "claude" } },
            ],
        };
        await flowStore.saveFlow(threeStep);
        await runner.startFlow(taskOwner, threeStep);
        await runner.handleActionComplete(
            "task-1",
            "three-step-flow",
            spawnedSessions[0].sessionId,
        );
        // Now on step 2 of 3.
        await runner.completeFlow("task-1", "three-step-flow", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "three-step-flow");
        expect(run?.status).toBe("completed");
        expect(run?.actions[1].status).toBe("completed");
        expect(run?.actions[2].status).toBe("skipped");
        expect(spawnedSessions).toHaveLength(2);
    });

    test("closes the calling session", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.completeFlow("task-1", "loop-flow", sessionId);

        expect(closedSessions).toContain(sessionId);
    });

    test("a session that does not own the current step cannot end the run", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.completeFlow("task-1", "loop-flow", "some-other-session");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
    });

    test("a later exit from the closed session does not alter the completed run", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.completeFlow("task-1", "loop-flow", sessionId);
        await runner.handleSessionExit(sessionId, 0);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL — `runner.completeFlow is not a function`.

- [ ] **Step 3: Implement `completeFlow`**

Add it directly after `handleActionComplete` in `flow-runner.ts`:

```ts
    async completeFlow(ownerId: string, flowId: string, sessionId: string): Promise<void> {
        return this.withOwnerLock(ownerId, async () => {
            const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
            if (!run || run.status !== "running") return;

            // Only the session running the current step may end the flow, so a
            // stale session cannot kill a live run.
            const currentAction = run.actions[run.currentActionIndex];
            if (!currentAction || currentAction.sessionId !== sessionId) return;

            await this.endRun(run, {
                status: "completed",
                runningStepOutcome: "completed",
                skipPending: true,
            });
        });
    }
```

`endRun` handles dropping the mapping, closing the session, marking the running step, skipping the pending steps, and broadcasting.

- [ ] **Step 4: Run runner tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — whole file.

- [ ] **Step 5: Write the failing route test**

Note the two different harnesses in this repo — use the right one:
- `packages/backend/src/services/__tests__/flow-integration.test.ts` wires a **real `FlowStore` against a temp dir** and calls `FlowRunner` methods directly. It does **not** issue HTTP requests.
- `packages/backend/tests/api/routes.test.ts` builds an `ApiRouter` via `registerApiRoutes` and exercises real HTTP routes.

Put the HTTP test in `packages/backend/tests/api/routes.test.ts`, following that file's existing harness (`ApiRouter`, `registerApiRoutes`, `sharedTestDeps`, the fake PTY manager) rather than inventing a new one:

```ts
it("rejects POST /api/flow/complete with no owner", async () => {
    const response = await router.handle(
        new Request("http://localhost/api/flow/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flowId: "flow-1", sessionId: "session-1" }),
        }),
    );
    expect(response?.status).toBe(400);
});

it("rejects POST /api/flow/complete with an invalid JSON body", async () => {
    const response = await router.handle(
        new Request("http://localhost/api/flow/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "not json",
        }),
    );
    expect(response?.status).toBe(400);
});
```

Read how neighbouring tests in that file construct the router and dispatch a request, and match it exactly — the `router.handle(...)` call above is indicative, not verbatim.

Also add a lifecycle test to `flow-integration.test.ts`, which exercises the runner against a real store — this is where the loop's persistence behaviour is worth checking end to end:

```ts
    it("runs a looped flow through two iterations and ends on completeFlow", async () => {
        const loopFlow: FlowDefinition = {
            ...testFlow,
            id: "loop-flow",
            loop: true,
        };
        await flowStore.saveFlow(loopFlow);
        await runner.startFlow(taskOwner, loopFlow);

        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.iteration).toBe(2);
        expect(run?.status).toBe("running");

        await runner.completeFlow("task-1", "loop-flow", spawnedSessions[2].sessionId);

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
    });
```

- [ ] **Step 6: Run route tests to verify they fail**

Run: `bun test packages/backend/tests/api/routes.test.ts packages/backend/src/services/__tests__/flow-integration.test.ts`
Expected: FAIL — 404 on the route (it does not exist yet), and `runner.completeFlow is not a function` before Step 3 is done.

- [ ] **Step 7: Register the route**

In `packages/backend/src/api/routes/flow-routes.ts`, immediately after the `/api/flow/action-complete` registration (which ends at line 64):

```ts
    apiRouter.register("POST", "/api/flow/complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, sessionId } = body;
        const ownerId =
            typeof taskId === "string"
                ? taskId
                : typeof projectId === "string"
                  ? projectId
                  : undefined;
        if (!ownerId || typeof flowId !== "string" || typeof sessionId !== "string") {
            return errorResponse(
                "Fields flowId, sessionId, and one of taskId/projectId are required strings",
                400,
            );
        }

        try {
            await flowRunner.completeFlow(ownerId, flowId, sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[api] POST /api/flow/complete failed:", err);
            return errorResponse(message, 500);
        }
    });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test packages/backend`
Expected: PASS across the backend suite.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/api/routes/flow-routes.ts packages/backend/src/services/__tests__/ packages/backend/tests/api/routes.test.ts
git commit -m "feat(flows): add completeFlow and POST /api/flow/complete"
```

---

### Task 8: CLI — `flow complete` and `--loop` on create/update

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh:548` (the `flow)` case), and its `flow create` / `flow update` handlers at :691 and :736
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts:605` (`handleFlow`), and its `create` / `update` cases at :743 and :782
- Modify: `packages/backend/src/services/taskflow-cli-flow-context-commands.md`
- Modify: `packages/backend/src/services/taskflow-cli-flow-commands.md`
- Test: `packages/backend/tests/services/taskflow-cli.test.ts`

**Interfaces:**
- Consumes: `POST /api/flow/complete` (Task 7).
- Produces: `taskflow-cli flow complete`; `--loop` / `--no-loop` flags on `flow create` and `flow update`.

Both CLI implementations must change. The shell script is what actually runs on macOS and Linux.

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/services/taskflow-cli.test.ts`, following the file's existing pattern for invoking the CLI against a stub server (read the top of the file first):

```ts
test("flow complete posts to /api/flow/complete", async () => {
    const result = await runCli(["flow", "complete"], {
        TASKFLOW_TASK_ID: "task-1",
        TASKFLOW_FLOW_ID: "flow-1",
        TASKFLOW_SESSION_ID: "session-1",
    });

    expect(result.exitCode).toBe(0);
    expect(lastRequest.path).toBe("/api/flow/complete");
    expect(lastRequest.body).toEqual({
        taskId: "task-1",
        flowId: "flow-1",
        sessionId: "session-1",
    });
});

test("flow complete fails when not inside a flow action", async () => {
    const result = await runCli(["flow", "complete"], {
        TASKFLOW_TASK_ID: "task-1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("TASKFLOW_FLOW_ID is not set");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/services/taskflow-cli.test.ts`
Expected: FAIL — the subcommand is unknown.

- [ ] **Step 3: Add `complete` to the shell CLI**

In `packages/backend/src/services/taskflow-cli.sh`, inside the `flow)` case (line 548), add a `complete)` branch before `input)`. It mirrors the existing `action complete` branch at line 292:

```sh
      complete)
        if [ -z "$TASKFLOW_FLOW_ID" ]; then
          echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
          exit 1
        fi
        if [ -n "$TASKFLOW_TASK_ID" ]; then
          owner_field=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
        else
          owner_field=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
        fi
        payload=$(printf '{%s,"flowId":%s,"sessionId":%s}' \
          "$owner_field" \
          "$(json_string "$TASKFLOW_FLOW_ID")" \
          "$(json_string "$TASKFLOW_SESSION_ID")")
        curl -sf -X POST "$TASKFLOW_API_URL/api/flow/complete" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
```

- [ ] **Step 4: Add `complete` to the TypeScript CLI**

In `packages/backend/src/services/taskflow-cli-bin.ts`, inside `handleFlow`'s switch (line 608), add before `case "input"`, mirroring the action-complete case at line 432:

```ts
        case "complete": {
            requireFlowId();
            const of = ownerField();
            process.stdout.write(
                await api("POST", "/api/flow/complete", {
                    ...of,
                    flowId,
                    sessionId,
                }),
            );
            break;
        }
```

- [ ] **Step 5: Add `--loop` / `--no-loop` to create and update**

In the shell CLI's `flow create` (line 691) and `flow update` (line 736) flag-parsing loops, add:

```sh
            --loop) flow_loop="true"; shift ;;
            --no-loop) flow_loop="false"; shift ;;
```

Initialise `flow_loop=""` before each loop, and include `"loop":$flow_loop` in the JSON payload only when `flow_loop` is non-empty — an empty value must omit the key entirely so `update` does not clear the flag when the caller did not mention it.

In `taskflow-cli-bin.ts`, both cases use the existing `parseFlags(args, spec)` helper (line 131), whose spec maps a flag name to `"string"` or `"boolean"`. Extend both specs:

```ts
            const { flags } = parseFlags(subArgs, {
                name: "string",
                description: "string",
                loop: "boolean",
                "no-loop": "boolean",
            });
```

(For `update` the call is `parseFlags(subArgs.slice(1), { ... })` — keep that difference.)

Then derive a tri-state value and apply it. In `create`, add to the `body` object literal after `actions`:

```ts
            const loopFlag =
                flags.loop === true ? true : flags["no-loop"] === true ? false : undefined;
            // ...
            if (loopFlag !== undefined) body.loop = loopFlag;
```

In `update`, add to the `overlay` object beside the existing `if (flags.name !== undefined)` lines:

```ts
            if (loopFlag !== undefined) overlay.loop = loopFlag;
```

`undefined` must leave the key off entirely, so `flow update --name x` does not silently clear an existing `loop: true`. Note `overlay` is also what the `Object.keys(overlay).length === 0` "No update fields provided" check inspects, so `--loop` alone correctly counts as an update.

- [ ] **Step 6: Update the CLI docs**

In `packages/backend/src/services/taskflow-cli-flow-context-commands.md`, add after the `action complete` line:

```markdown
`taskflow-cli flow complete` End the whole flow now (in a looped flow, stops the loop).
```

And add a note at the end of that file:

```markdown
Note: in a looped flow, `action complete` finishes the current step and the flow moves on; after the last step it starts again from the first. `flow complete` ends the entire run immediately. Reuse the same artifact `<type>` names on every iteration rather than inventing new ones per lap.
```

In `packages/backend/src/services/taskflow-cli-flow-commands.md`, document `--loop` / `--no-loop` on the `flow create` and `flow update` entries.

These files are bundled as text imports and rewritten to `~/.config/taskflow/agent-skills/` on startup (`internal-agent-skill.ts:107`), so editing the repo copies is sufficient — no separate sync step.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test packages/backend/tests/services/taskflow-cli.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.sh packages/backend/src/services/taskflow-cli-bin.ts packages/backend/src/services/taskflow-cli-flow-context-commands.md packages/backend/src/services/taskflow-cli-flow-commands.md packages/backend/tests/services/taskflow-cli.test.ts
git commit -m "feat(cli): add flow complete and --loop flags"
```

---

### Task 9: Tell the agent it is in a loop

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts` — `buildActionPrompt` (528-546) and its call site in `launchAction` (417-423)
- Test: `packages/backend/src/services/__tests__/flow-runner.test.ts`

**Interfaces:**
- Consumes: `run.loop`, `run.iteration` (Task 4).
- Produces: no exported signatures; `buildActionPrompt` is private.

- [ ] **Step 1: Write the failing test**

The test harness's `spawnSession` stub records only `sessionId`, `owner`, and `prompt`. Extend it to capture `systemPrompt` too — change the `spawnedSessions` declaration and the stub at the top of the file:

```ts
let spawnedSessions: Array<{
    sessionId: string;
    owner: FlowOwner;
    prompt: string;
    systemPrompt?: string;
}>;
```

```ts
        spawnSession: async (opts) => {
            if (spawnError) {
                throw spawnError;
            }
            const sessionId = `session-${spawnedSessions.length + 1}`;
            spawnedSessions.push({
                sessionId,
                owner: opts.owner,
                prompt: opts.prompt,
                systemPrompt: opts.systemPrompt,
            });
            return sessionId;
        },
```

Then:

```ts
describe("looped action prompt", () => {
    test("tells the agent the flow loops, which iteration it is, and how to end it", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        const systemPrompt = spawnedSessions[0].systemPrompt ?? "";

        expect(systemPrompt).toContain("taskflow-cli flow complete");
        expect(systemPrompt).toContain("iteration 1");
    });

    test("reports the new iteration number after a wrap", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        expect(spawnedSessions[2].systemPrompt ?? "").toContain("iteration 2");
    });

    test("a non-looped flow's prompt does not mention flow complete", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(spawnedSessions[0].systemPrompt ?? "").not.toContain("flow complete");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL — the system prompt has no loop text.

- [ ] **Step 3: Thread the loop context into the prompt**

Change `buildActionPrompt`'s signature and body:

```ts
    private buildActionPrompt(
        actionPrompt: string,
        ownerDescription: string,
        sessionType: SessionType,
        isProjectScope: boolean,
        loopIteration?: number,
    ): { prompt: string; systemPrompt?: string } {
        const descriptionHeader = isProjectScope ? "Project Description" : "Task Description";
        const sections = [
            `## ${descriptionHeader}\n\n${ownerDescription}`,
            `## Taskflow CLI`,
            `Use \`taskflow-cli task\` to read task info and logs.`,
            `Use \`taskflow-cli artifact list\` to see available artifacts from prior actions.`,
            `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
            `Use \`taskflow-cli flow input\` to list all flow input values.`,
            `Use \`taskflow-cli flow input <id>\` to get a specific input value.`,
            `When you have completed this action, run \`taskflow-cli action complete\`.`,
        ];

        if (loopIteration !== undefined) {
            sections.push(
                [
                    `## Loop`,
                    `This flow is a loop. After its last action completes it restarts from the first action with the same inputs, and artifacts carry over between iterations. You are in iteration ${loopIteration}.`,
                    `Run \`taskflow-cli action complete\` to finish this action and move to the next one.`,
                    `Run \`taskflow-cli flow complete\` to end the whole loop immediately.`,
                    `Reuse the same artifact \`<type>\` names on every iteration instead of inventing per-iteration names.`,
                ].join("\n\n"),
            );
        }

        return { prompt: actionPrompt, systemPrompt: sections.join("\n\n") };
    }
```

And at the call site in `launchAction`:

```ts
        const { prompt, systemPrompt } = this.buildActionPrompt(
            resolved.prompt,
            ownerDescription,
            resolved.sessionType,
            !!owner.projectId,
            run.loop ? (run.iteration ?? 1) : undefined,
        );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: PASS — whole file.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts packages/backend/src/services/__tests__/flow-runner.test.ts
git commit -m "feat(flows): tell looped-flow agents the loop contract and iteration"
```

---

### Task 10: Flow editor — the loop toggle

**Files:**
- Modify: `packages/ui/src/components/flows/FlowEditor.tsx` — state (61-67), save payload (186-195), dirty check (218-233), and the form body near the description field (260-270)
- Modify: `packages/ui/src/stores/flow-store.ts` — whichever save path builds the `FlowDefinition` sent to the backend

**Interfaces:**
- Consumes: `FlowDefinition.loop` (Task 1).
- Produces: a flow definition carrying `loop` from the editor to the backend.

- [ ] **Step 1: Add the state**

Beside the existing `description` state at line 62:

```tsx
    const [loop, setLoop] = useState(flow?.loop ?? false);
```

- [ ] **Step 2: Add the control**

Import `Switch` and `Label` if not already imported (`@/components/ui/switch`, `@/components/ui/label`). Add below the description field, following the pattern used in `NewTaskDialog.tsx:250`:

```tsx
                    <div className="flex items-center gap-2">
                        <Switch id="flow-loop" checked={loop} onCheckedChange={setLoop} />
                        <Label
                            htmlFor="flow-loop"
                            className="cursor-pointer tracking-normal normal-case">
                            Loop this flow
                        </Label>
                    </div>
                    <p className="text-muted-foreground text-xs">
                        Restarts from the first action after the last one finishes. Inputs and
                        artifacts carry over. An agent ends it with{" "}
                        <code>taskflow-cli flow complete</code>.
                    </p>
```

- [ ] **Step 3: Include it in save and dirty-check**

In the `handleSave` payload (line 188):

```tsx
            name: name.trim(),
            description: description.trim(),
            loop,
```

Add `loop` to that callback's dependency array (line 195), to the reset object (line 220-223) as `flow?.loop ?? false`, and to the dirty-check dependency list (line 229-232). Follow exactly how `description` is threaded through all four places.

- [ ] **Step 4: Confirm the store forwards it**

Read `packages/ui/src/stores/flow-store.ts` and check whether its save action passes the whole `FlowDefinition` through or picks fields explicitly. If it picks fields, add `loop`. If it forwards the object, no change is needed.

- [ ] **Step 5: Verify**

Run: `bun run typecheck`
Expected: no type errors.

Then start the app (`bun run dev:electron`), create a flow, tick "Loop this flow", save, reopen it, and confirm the toggle is still on.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/flows/FlowEditor.tsx packages/ui/src/stores/flow-store.ts
git commit -m "feat(ui): add loop toggle to the flow editor"
```

---

### Task 11: Flow panel — iteration indicator and loop-aware stop

**Files:**
- Modify: `packages/ui/src/components/flows/FlowPanel.tsx` — header (142-146), stop button (167-176)
- Modify: `packages/ui/src/components/flows/FlowManagementDialog.tsx:188` (flow list rows)

**Interfaces:**
- Consumes: `FlowRun.loop`, `FlowRun.iteration` (Task 1), `FlowDefinition.loop`.
- Produces: nothing consumed by later tasks.

**Why the indicator matters:** when a loop wraps, every step flips from completed back to pending at once. Without a visible iteration number that reads as the panel glitching.

- [ ] **Step 1: Show the iteration in the header**

Import `Repeat` from `lucide-react` alongside the existing icon imports. Replace the header's name block (line 142):

```tsx
                <div className="ml-2 flex min-w-0 items-center gap-1.5">
                    <TruncatedText tooltip tooltipSide="bottom" className="text-xs font-medium">
                        {flowName}
                    </TruncatedText>
                    {run.loop && (
                        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]">
                            <Repeat className="h-2.5 w-2.5" />
                            Iteration {run.iteration ?? 1}
                        </span>
                    )}
                </div>
```

- [ ] **Step 2: Make Stop read as the normal ending for a loop**

Replace the stop button (line 167):

```tsx
                    {(run.status === "running" || run.status === "paused") && (
                        <Button
                            variant="ghost"
                            size="icon-2xs"
                            className={run.loop ? undefined : "text-destructive"}
                            onClick={handleStop}
                            tooltip={run.loop ? "Finish loop" : "Stop"}
                            tooltipSide="bottom">
                            <Square className="h-2 w-2" />
                        </Button>
                    )}
```

- [ ] **Step 3: Badge looped flows in the management dialog**

In `FlowManagementDialog.tsx`, inside the flow list row at line 188, render a `Repeat` icon when `f.loop` is true, beside the flow name. Match the row's existing icon sizing and muted-foreground colour.

- [ ] **Step 4: Verify**

Run: `bun run typecheck`
Expected: no type errors.

Then, in the running app: create a two-step looped flow whose actions are trivial (e.g. shell actions that exit 0), start it, and confirm the header counts up through iterations, the step rows reset each lap, and the Stop button reads "Finish loop" and leaves the run green rather than red.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/flows/FlowPanel.tsx packages/ui/src/components/flows/FlowManagementDialog.tsx
git commit -m "feat(ui): show loop iteration and loop-aware stop in the flow panel"
```

---

### Task 12: Full verification

**Files:** none modified unless a failure turns up.

- [ ] **Step 1: Run the whole backend test suite**

Run: `bun test packages/backend`
Expected: PASS. Pay particular attention to any pre-existing test that asserts on flow completion or stop semantics.

- [ ] **Step 2: Run the whole UI test suite**

Run: `bun test packages/ui`
Expected: PASS.

- [ ] **Step 3: Lint, typecheck, and format**

```bash
bun run lint
bun run typecheck
bun run format:check
```

Expected: clean. Do not silence eslint rules; fix the cause. If `format:check` complains, run `bun run format`.

- [ ] **Step 4: End-to-end check by hand**

In the running app:
1. Create a looped flow with two shell actions.
2. Start it on a task. Confirm it wraps and the iteration counter advances.
3. Confirm only about one agent session is live at a time — not one per step per lap.
4. From an agent action, run `taskflow-cli flow complete` and confirm the run ends as completed with the later steps skipped.
5. Start it again and press Stop. Confirm the run ends completed, not failed.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(flows): address issues found in full verification"
```

# Flow Loops Implementation Plan

> Handoff: docs/superpowers/plans/2026-08-13-taskflow-flow-loops.handoff.md

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

### Scope decision — `--loop` ships on `flow create` only, not `flow update`

`taskflow-cli flow update` is **already broken in both CLIs**, independently of this feature, so `--loop` is not added to it. Both bugs are reproducible in seconds:

**Shell** — `flow update` extracts the existing flow with an `awk` script using `RS="{"; FS="}"` (`taskflow-cli.sh:745-746`). Any flow with actions contains a nested `{`, so the extraction truncates at `"actions":[` and the `sed` merge (`:772`) posts invalid JSON, which the route rejects with 400:

```bash
printf '%s' '{"flows":[{"id":"flow-1","name":"L","actions":[{"id":"e1","actionId":"a1"}],"loop":true}]}' \
  | awk -v id="flow-1" 'BEGIN { RS="{"; FS="}" } NR>1 { obj = "{" $1 "}"; if (index(obj, "\"id\":\"" id "\"") > 0) { print obj; exit } }'
# {"id":"flow-1","name":"L","actions":[}     <- truncated, not valid JSON
```

**TypeScript** — `flow get` (`taskflow-cli-bin.ts:738`) and `flow update` (`:790`) do `JSON.parse(...) as ParsedItem[]` then `.find(...)`, but `GET /api/flows` returns `{ flows: [...] }` (`flow-routes.ts:166-168`), so both throw `parsed.find is not a function`.

Neither is caused by looping and neither is in scope here — fixing the shell one means writing a nested-JSON extractor in POSIX sh, which does not belong in a loop feature. **File them as a separate follow-up.**

Consequences for this plan, applied throughout Task 8:

- `flow create` gets `--loop` / `--no-loop`. `flow update` does not.
- Turning looping off on an existing flow is done in the flow editor UI (Task 10), which posts the whole definition and is unaffected by either bug.
- No `flow update` CLI tests are added; the tri-state is pinned on `create` only.

**This supersedes the design spec.** The spec still says `flow create` *and* `flow update` gain `--loop` / `--no-loop` (`docs/superpowers/specs/2026-08-13-taskflow-flow-loops-design.md:301-303`), written before those two bugs were found. The plan is the authority here; the spec line is stale.

If you would rather have `--loop` on `flow update`, fix those two bugs first as a prerequisite task with their own tests, then add the flag. Do not add the flag on top of a broken command.

### Accepted limitation — a loop has no throttle and no iteration cap

Nothing in this design rate-limits a wrap. A looped flow whose actions finish instantly (shell actions that just `exit 0`) will spin as fast as the machine can spawn PTYs, indefinitely: `advanceOrComplete` → `startNextIteration` → `launchPersistedActionWithRecovery` → spawn → exit → repeat. This is not stack recursion (each hop is a fresh task off a promise callback), so it will not blow the stack — it will just burn CPU and grow the run's log until someone stops it.

The escape hatch does work: `stopFlow` takes the owner lock, so it queues behind the in-flight hop rather than racing it, and `endRun` clears `currentAction.sessionId` and deletes the `sessionFlowMap` entry — which makes the next `handleSessionExit` return at its mapping check (`flow-runner.ts:255-257`) instead of advancing again. Verify this by hand in Task 12 step 4.

This is accepted for the MVP, matching the spec's "exactly two commands" scope — no max-iteration setting, no minimum wrap delay. If it turns out to bite in practice, the natural follow-up is a `maxIterations` field on `FlowDefinition` snapshotted onto the run beside `loop`, checked in `startNextIteration`. Do not add it in this plan.

### Known pre-existing race — read before the manual shell-loop check

`launchAction` registers the session in `sessionFlowMap` only *after* `spawnSession` resolves (`flow-runner.ts:437`). In production `spawnSession` → `createSession` calls `ptyManager.spawn` at `session-lifecycle.ts:444` but does not return until `session-lifecycle.ts:548`, with `await taskStore.updateTask(...)` / `updateProject(...)` in between (`:517-531`). The PTY's exit path is `void proc.exited.then(cleanup)` (`pty-manager.ts:251`) → `options.onExit` (`:210`) → `flowRunner.handleSessionExit` (`index.ts:220`). So a shell action that exits within milliseconds can fire its exit before the mapping exists, and `handleSessionExit` returns immediately on the missing mapping (`flow-runner.ts:255-257`) — the step stays `running` and the flow stalls.

This is **pre-existing and out of scope for this plan** — it is not caused by looping and the fix (pre-registering the mapping, or buffering exits that arrive before registration) belongs in the session-lifecycle layer. It matters here for two reasons:

1. Looping re-runs every action every iteration, so a race that was rare becomes routine.
2. Task 12's manual check asks for "a looped flow with two shell actions". Use shell actions that take a beat (`sleep 2; echo done`) rather than instant ones. If a loop stalls with a step stuck on `running` and no live PTY, this race is the first thing to suspect — not the loop code.

Do not attempt the fix as part of this plan. Note it for a follow-up.

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

That file currently imports no shared types (only `FlowStore` from `../flow-store`), so the `as unknown as FlowDefinition` cast below needs a new import:

```ts
import type { FlowDefinition } from "@taskflow/shared";
```

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
Expected: FAIL. Under `bun test` the visible failure is the second test: `assertValidFlowDefinition` has no `loop` check yet, so `saveFlow` resolves instead of throwing. The first test fails only under `bun run typecheck`, where `loop` is not a field on `FlowDefinition` — `bun test` does not typecheck, so do not expect it to go red there.

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
        // Pin that we actually wrapped — without these three, the test passes on
        // current code, since a completed finite run also retains inputs/artifacts.
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
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

    // Regression guard: green before and after. Pins that adding the wrap branch
    // does not change the finite-flow path.
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

    test("stopping an already-ended run writes nothing", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.stopFlow("task-1", "loop-flow");
        const broadcastCount = broadcasts.length;

        await runner.stopFlow("task-1", "loop-flow");

        expect(broadcasts).toHaveLength(broadcastCount);
        expect(closedSessions).toEqual(["session-1"]);
    });
});
```

That test is the reason for the terminal-status guard in Step 3. It asserts on `broadcasts` rather than on `completedAt` deliberately: `endRun` stamps `new Date().toISOString()`, so two back-to-back stops normally land in the same millisecond and a timestamp comparison would go green against unguarded code. Every write path in `endRun` ends in `broadcastUpdate`, so an unguarded second stop always pushes another entry — that is the reliable signal, and it needs no cast into the mock store (`broadcasts` is a plain array the harness resets in `beforeEach`).

Note the guard also changes the non-looped path, which today happily re-fails a finished run. The Task 2 characterisation tests do not cover a double stop, so confirm the whole file still passes.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
Expected: FAIL with `status` being `"failed"`, not `"completed"`.

- [ ] **Step 3: Branch on `run.loop`**

```ts
    async stopFlow(ownerId: string, flowId: string): Promise<void> {
        return this.withOwnerLock(ownerId, async () => {
            const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
            if (!run) return;
            // Stopping an already-ended run must not rewrite it. Without this,
            // a second Stop on a finished looped run bumps completedAt and
            // re-broadcasts; on a failed run it would flip it to completed.
            if (run.status !== "running" && run.status !== "paused") return;
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

    // Regression guard: green before and after — the current runner never closes
    // on completion. Pins that the close stays scoped to looped runs.
    test("a non-looped flow leaves the completed step's session open", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);

        expect(closedSessions).toEqual([]);
    });

    test("a looped shell step leaves no session id behind when it auto-completes", async () => {
        const shellLoop: FlowDefinition = {
            ...loopFlow,
            id: "shell-loop-flow",
            actions: [
                { id: "entry-1", inline: { name: "A", prompt: "echo a", sessionType: "shell" } },
                { id: "entry-2", inline: { name: "B", prompt: "echo b", sessionType: "shell" } },
            ],
        };
        await flowStore.saveFlow(shellLoop);
        await runner.startFlow(taskOwner, shellLoop);

        await runner.handleSessionExit(spawnedSessions[0].sessionId, 0);

        const run = await flowStore.getFlowRun("task-1", "shell-loop-flow");
        expect(run?.actions[0].status).toBe("completed");
        expect(run?.actions[0].sessionId).toBeUndefined();
        expect(run?.currentActionIndex).toBe(1);
    });

    // Green before this task too, because handleActionComplete already deletes the
    // mapping. It earns its place by pinning that adding closeSession here does not
    // make a late exit destructive.
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

- [ ] **Step 3b: Do the same for shell steps, which complete by a different path**

`handleActionComplete` is the agent path. Shell actions never call it — they auto-complete in `handleSessionExit`'s clean-exit branch (`flow-runner.ts:272-277`), which marks the step completed and advances but leaves `currentAction.sessionId` pointing at the now-dead PTY. `FlowPanel` renders any step with a `sessionId` as clickable session state, so a looped shell run accumulates completed steps that offer to open sessions that no longer exist. In the locked body of `handleSessionExit`:

```ts
            if (sessionType === "shell" && exitCode === 0) {
                // Shell actions auto-complete on clean exit
                currentAction.status = "completed";
                currentAction.completedAt = new Date().toISOString();
                if (run.loop) {
                    // Match the agent path: a looped step keeps no session id.
                    // The process is already gone, so there is nothing to close.
                    currentAction.sessionId = undefined;
                }
                this.sessionFlowMap.delete(sessionId);
                await this.advanceOrComplete(run);
            }
```

No `closeSession` call here — the PTY exited on its own, which is what got us into this branch. And no nested lock: `advanceOrComplete` is private and unlocked, so this stays inside the single lock `handleSessionExit` already holds from Task 3.

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

- [ ] **Step 5: Write the failing route tests**

Note the two different harnesses in this repo — use the right one:
- `packages/backend/src/services/__tests__/flow-integration.test.ts` wires a **real `FlowStore` against a temp dir** and calls `FlowRunner` methods directly. It does **not** issue HTTP requests.
- `packages/backend/tests/api/routes.test.ts` builds an `ApiRouter` via `registerApiRoutes` and exercises real HTTP routes.

Put the HTTP test in `packages/backend/tests/api/routes.test.ts`. **Do not add it to that file's top-level `describe`** — that block registers `flowRunner: {} as never` (`routes.test.ts:71`), so any route that actually calls the runner throws and returns 500. Copy the `describe("flow artifact routes", ...)` block at `routes.test.ts:217` instead, which is the established pattern for flow-route tests: its own `ApiRouter`, a hand-mocked `flowRunner`, everything else stubbed. Note the router variable there is `apiRouter`, and requests go through `apiRouter.handle(...)`.

```ts
describe("flow complete route", () => {
    let apiRouter: ApiRouter;
    const flowRunner = {
        completeFlow: mock(async () => {}),
    };

    beforeEach(() => {
        apiRouter = new ApiRouter();
        flowRunner.completeFlow.mockClear();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore: {} as never,
            flowStore: {} as never,
            flowRunner: flowRunner as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    it("delegates a valid request to the runner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskId: "task-1",
                    flowId: "flow-1",
                    sessionId: "session-1",
                }),
            }),
        );

        expect(response?.status).toBe(200);
        expect(flowRunner.completeFlow).toHaveBeenCalledWith("task-1", "flow-1", "session-1");
    });

    it("rejects a request with no owner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ flowId: "flow-1", sessionId: "session-1" }),
            }),
        );

        expect(response?.status).toBe(400);
        expect(flowRunner.completeFlow).not.toHaveBeenCalled();
    });

    it("rejects an invalid JSON body", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "not json",
            }),
        );
        expect(response?.status).toBe(400);
    });
});
```

The `toHaveBeenCalledWith` assertion is the point of the positive test — asserting only `status === 200` would pass against a route that parsed the body and did nothing. The `not.toHaveBeenCalled()` on the rejection case is what pins that validation happens *before* dispatch.

Read how neighbouring tests in that file construct the router and dispatch a request, and match it exactly — the `router.handle(...)` call above is indicative, not verbatim.

Also add a lifecycle test to `flow-integration.test.ts`, which exercises the runner against a real store — this is where the loop's persistence behaviour is worth checking end to end. That file uses `test(...)`, not `it(...)`, and does not import `it` at all (`flow-integration.test.ts:1`), so keep the snippets below as written:

```ts
    test("runs a looped flow through two iterations and ends on completeFlow", async () => {
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

And one for restart recovery — a looped run is the only kind that can realistically be mid-flight when the backend restarts, so its recovery path is worth pinning. `packages/backend/src/index.ts:242` pauses every `running` run at startup and marks its in-flight action `failed`; the run must then resume in the *same* iteration, not a new one:

```ts
    test("resumes a looped run in the same iteration after crash recovery", async () => {
        const loopFlow: FlowDefinition = { ...testFlow, id: "loop-recover", loop: true };
        await flowStore.saveFlow(loopFlow);
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-recover", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-recover", spawnedSessions[1].sessionId);

        // Replicate the startup recovery transform from index.ts:242.
        const stranded = await flowStore.getFlowRun("task-1", "loop-recover");
        if (!stranded) throw new Error("expected a run");
        stranded.status = "paused";
        stranded.actions[stranded.currentActionIndex].status = "failed";
        stranded.actions[stranded.currentActionIndex].sessionId = undefined;
        await flowStore.saveFlowRun(stranded);

        await runner.resumeFlow("task-1", "loop-recover");

        const run = await flowStore.getFlowRun("task-1", "loop-recover");
        expect(run?.status).toBe("running");
        expect(run?.loop).toBe(true);
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
    });
```

- [ ] **Step 6: Run route tests to verify they fail**

Run: `bun test packages/backend/tests/api/routes.test.ts packages/backend/src/services/__tests__/flow-integration.test.ts`
Expected: FAIL — `ApiRouter.handle` returns `null` for an unregistered path (`router.ts:43`), so `response?.status` is `undefined` and all three route assertions fail. The `flow-integration.test.ts` case should already pass at this point, since Step 3 added `completeFlow`; if it fails, Step 3 is incomplete.

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
git add packages/backend/src/services/flow-runner.ts \
  packages/backend/src/api/routes/flow-routes.ts \
  packages/backend/src/services/__tests__/flow-runner.test.ts \
  packages/backend/src/services/__tests__/flow-integration.test.ts \
  packages/backend/tests/api/routes.test.ts
git commit -m "feat(flows): add completeFlow and POST /api/flow/complete"
```

---

### Task 8: CLI — `flow complete` and `--loop` on `flow create`

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh:548` (the `flow)` case) and its `flow create` handler at :691
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts:605` (`handleFlow`) and its `create` case at :743
- Modify: `packages/backend/src/services/taskflow-cli-flow-context-commands.md`
- Modify: `packages/backend/src/services/taskflow-cli-flow-commands.md`
- Test: `packages/backend/tests/services/taskflow-cli.test.ts`

**Interfaces:**
- Consumes: `POST /api/flow/complete` (Task 7).
- Produces: `taskflow-cli flow complete`; `--loop` / `--no-loop` flags on `flow create` only.

Both CLI implementations must change. The shell script is what actually runs on macOS and Linux.

- [ ] **Step 1: Write the failing tests**

Add to `packages/backend/tests/services/taskflow-cli.test.ts`. **Read the top of that file first** — the harness is specific and easy to get wrong:

- `setupCliHarness()` (async) returns `{ cliPath, captureFile, env }`. `cliPath` points at the **shell** CLI, so this file only exercises `taskflow-cli.sh`. The TypeScript CLI has no test harness; its changes are verified by `bun run typecheck` and by hand.
- `runCli(cliPath, args, env)` is **synchronous** — it returns `spawnSync`'s result, so the exit code is `result.status`, not `result.exitCode`.
- The stub `curl` writes the request to `captureFile`; read it with `await readCapturedRequest(captureFile)`, which returns `{ method, url, data }` where `data` is the raw `-d` string.
- Tests use `it(...)`, not `test(...)`.

```ts
    it("ends the whole flow from a flow action", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["flow", "complete"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_FLOW_ID: "flow-1",
            TASKFLOW_SESSION_ID: "session-1",
        });

        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/flow/complete");
        expect(JSON.parse(request.data)).toEqual({
            taskId: "task-1",
            flowId: "flow-1",
            sessionId: "session-1",
        });
    });

    it("refuses flow complete outside a flow action", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(cliPath, ["flow", "complete"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TASKFLOW_FLOW_ID is not set");
    });

    it("sets loop on flow create", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();

        // Include --action so the payload is a flow a real backend would accept —
        // flow-store.ts:13 rejects a definition with no actions.
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Looper", "--action", "action-1", "--loop"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse((await readCapturedRequest(captureFile)).data).loop).toBe(true);
    });

    it("omits loop from flow create when neither flag is given", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Plain", "--action", "action-1"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse((await readCapturedRequest(captureFile)).data)).not.toHaveProperty("loop");
    });

    it("sets loop false on flow create with --no-loop", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Plain", "--action", "action-1", "--no-loop"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse((await readCapturedRequest(captureFile)).data).loop).toBe(false);
    });

    it("rejects --loop and --no-loop together", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "X", "--action", "action-1", "--loop", "--no-loop"],
            env,
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("mutually exclusive");
    });
```

Expect these to behave differently in Step 2. Three go red: "sets loop on flow create" and "sets loop false" both fail because the shell `create` payload has no `loop` handling at all (`taskflow-cli.sh:722-731`), and "rejects --loop and --no-loop together" fails because the flag loop's `*) shift ;;` catch-all silently swallows both flags and exits 0. **"omits loop from flow create when neither flag is given" is green before and after** — it is a regression test that pins the absent case, not a driver. Do not treat its passing in Step 2 as a problem.

`not.toHaveProperty("loop")` is the important assertion in that one; asserting `loop === undefined` would pass against a payload that emits `"loop":null`.

There are deliberately **no `flow update` tests here** — see "Scope decision" at the top of this plan. `flow update` is broken in both CLIs today for any flow that has actions, so `--loop` is not added to it.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/services/taskflow-cli.test.ts`

Expected, per test — do not expect a uniform FAIL:

| Test | Before |
|---|---|
| ends the whole flow from a flow action | FAIL — `flow complete` is an unknown subcommand |
| refuses flow complete outside a flow action | FAIL — same |
| sets loop on flow create | FAIL — no `loop` in the create payload |
| omits loop from flow create when neither flag is given | **PASS** — regression test, green before and after |
| sets loop false on flow create with --no-loop | FAIL — no `loop` in the create payload |
| rejects --loop and --no-loop together | FAIL — the flag loop's `*) shift ;;` swallows both and exits 0 |

- [ ] **Step 3: Add `complete` to the shell CLI**

In `packages/backend/src/services/taskflow-cli.sh`, inside the `flow)` case (line 548), add a `complete)` branch before `input)`. It mirrors the existing `action complete` branch at line 292:

```sh
      complete)
        if [ -z "$TASKFLOW_FLOW_ID" ]; then
          echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
          exit 1
        fi
        if [ -z "$TASKFLOW_SESSION_ID" ]; then
          echo "Error: TASKFLOW_SESSION_ID is not set" >&2
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
            requireSessionId();
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

The `requireSessionId()` call (and its shell counterpart above) is deliberate and differs from the neighbouring `action complete`, which omits it. `completeFlow` only acts when `sessionId` matches the current action's session, so an empty `sessionId` would otherwise post successfully, do nothing, and print `{"success":true}` — a silent no-op on the one command whose whole job is to end the run. `TASKFLOW_SESSION_ID` is always set for real flow-action sessions (`session-lifecycle.ts:424`), so this only fires on misuse.

- [ ] **Step 5: Add `--loop` / `--no-loop` to `flow create`**

`flow create` only — not `flow update`, which is broken in both CLIs today (see "Scope decision" at the top of this plan). The snippet below is the complete version, guards included; there is no separate unguarded step, and no second `--loop` / `--no-loop` `case` pair anywhere.

**Shell `create` (line 691)** accumulates into named variables and assembles the payload with `printf` at the end, appending `projectId` afterwards via `sed "s/}$/,...}/"`. Initialise `flow_loop=""` beside the existing `flow_name=""` / `flow_description=""` / `flow_action_ids=""`, and add to its flag loop:

```sh
            --loop)
              if [ "$flow_loop" = "false" ]; then
                echo "Error: --loop and --no-loop are mutually exclusive" >&2
                exit 1
              fi
              flow_loop="true"; shift ;;
            --no-loop)
              if [ "$flow_loop" = "true" ]; then
                echo "Error: --loop and --no-loop are mutually exclusive" >&2
                exit 1
              fi
              flow_loop="false"; shift ;;
```

Then append the value **immediately after the existing `projectId` block and before the `curl`**, so the conditional stays out of the `printf` format string:

```sh
        if [ -n "$flow_loop" ]; then
          payload=$(printf '%s' "$payload" | sed "s/}\$/,\"loop\":$flow_loop}/")
        fi
```

An empty `flow_loop` omits the key entirely. No `json_string` here — `flow_loop` is already the bare JSON literal `true` or `false`, and quoting it would produce a string that fails the new `typeof flow.loop !== "boolean"` validation from Task 1.

Leave the shell `update` handler alone entirely — no `flow_loop`, no `overlay` entries, no new `case` branches.

**TypeScript `create` (line 743)** uses the existing `parseFlags(args, spec)` helper (line 131), whose spec maps a flag name to `"string"` or `"boolean"`. Extend only the `create` spec; leave `update`'s spec untouched:

```ts
            const { flags } = parseFlags(subArgs, {
                name: "string",
                description: "string",
                action: "string",
                loop: "boolean",
                "no-loop": "boolean",
            });
```

Do not touch the `update` spec at line 792.

**`action: "string"` fixes a pre-existing bug** and is only in the `create` spec, not `update`. `parseFlags` calls `process.exit(1)` on any flag missing from the spec (`taskflow-cli-bin.ts:131` → `cli-flags.ts:30`), and `create`'s current spec omits `action` even though `create` documents `--action` and collects it in a manual loop afterwards. So `taskflow-cli flow create --name X --action a1` exits 1 with `Error: unknown flag "--action"` today. Verify before and after:

```bash
bun -e 'import {consumeFlags} from "./packages/backend/src/services/cli-flags";
console.log(consumeFlags(["--name","X","--action","a1"], {name:"string",description:"string"}).unknown)'
# prints [ "--action" ] — that non-empty array is what makes parseFlags exit 1
```

Adding `action: "string"` makes `parseFlags` consume the `--action <id>` pairs (keeping only the last in `flags`, which is unused) and report no unknowns; the existing manual loop still collects all of them, because `parseFlags` does not mutate `subArgs`.

**This fix cannot be covered by `taskflow-cli.test.ts`.** That file's `setupCliHarness` writes and runs `taskflow-cli.sh` (`taskflow-cli.test.ts:35`, `:77`), so every test in it exercises the shell CLI only — the TypeScript CLI has no harness in this repo. Verify the `--action` fix and the TS `--loop` handling by hand, and keep them honest with a unit-level check of the flag spec, which needs no CLI process:

```bash
bun -e 'import {consumeFlags} from "./packages/backend/src/services/cli-flags";
const r = consumeFlags(["--name","X","--action","a1","--action","a2","--loop"],
  {name:"string",description:"string",action:"string",loop:"boolean","no-loop":"boolean"});
console.log(r.unknown.length === 0 && r.flags.loop === true ? "OK" : "BROKEN", JSON.stringify(r))'
```

Do not claim the TS CLI is test-covered; state plainly in the commit that it is verified by `bun run typecheck` plus this check plus manual invocation.

Then, in the `create` case only, derive the tri-state value after the `parseFlags` call and apply it to the `body` object literal:

```ts
            if (flags.loop === true && flags["no-loop"] === true) {
                process.stderr.write("Error: --loop and --no-loop are mutually exclusive\n");
                process.exit(1);
            }
            const loopFlag =
                flags.loop === true ? true : flags["no-loop"] === true ? false : undefined;
            // ...after the body literal is built:
            if (loopFlag !== undefined) body.loop = loopFlag;
```

`undefined` must leave the key off entirely rather than write `loop: undefined` — `JSON.stringify` drops undefined values so either happens to work over the wire, but the explicit guard is what the "omits loop when neither flag is given" test pins.

**Rejecting the conflicting pair.** This is not defensive padding — it is what keeps the two CLIs from disagreeing. Left alone, the shell handler is last-flag-wins (each `case` branch overwrites) while the TS expression above is `--loop`-wins, so `flow create --no-loop --loop` would mean different things depending on which CLI ran. `consumeFlags` collapses booleans to `true` and loses their order (`cli-flags.ts:24`), so the TS side cannot cheaply be made last-wins; erroring is the one rule both can implement identically. The shell guard is already folded into the Step 5 snippet above — do not add a second pair of `--loop` / `--no-loop` `case` branches, or the first match wins and the guarded one becomes dead code.

Also update the usage strings so the new surface is discoverable: the `flow create` usage line (`taskflow-cli-bin.ts:759-763`, which must gain `[--loop|--no-loop]`) and the `handleFlow` default-case usage list (`taskflow-cli-bin.ts:816`, which must gain `complete`), plus their shell-script equivalents.

- [ ] **Step 6: Update the CLI docs**

In `packages/backend/src/services/taskflow-cli-flow-context-commands.md`, add after the `action complete` line:

```markdown
`taskflow-cli flow complete` End the whole flow now (in a looped flow, stops the loop).
```

And add a note at the end of that file:

```markdown
Note: in a looped flow, `action complete` finishes the current step and the flow moves on; after the last step it starts again from the first. `flow complete` ends the entire run immediately. Reuse the same artifact `<type>` names on every iteration rather than inventing new ones per lap.
```

In `packages/backend/src/services/taskflow-cli-flow-commands.md`, document `--loop` / `--no-loop` on the `flow create` entry only. Do not document them on `flow update` — they are not implemented there.

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

    // Regression guard: green before and after. Pins that loop instructions never
    // leak into a finite flow's prompt.
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

Import `Switch` and `Label` if not already imported (`@/components/ui/switch`, `@/components/ui/label` — both exist). Add below the description field, following the pattern used in `packages/ui/src/components/sidebar/NewTaskDialog.tsx:250`:

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

Add `loop` to that callback's dependency array (line 195). The dirty check is a pair of `JSON.stringify` snapshots, not a reset object: add `loop: flow?.loop ?? false` to `initialSnapshot` (line 216-226) and `loop` to `currentSnapshot` (line 227-234). Follow exactly how `description` is threaded through all four places — `useState`, `handleSave` payload, `handleSave` deps, and both snapshots. Miss a snapshot and the Save button stays disabled after toggling.

- [ ] **Step 4: Confirm the store forwards it**

`packages/ui/src/stores/flow-store.ts:109` sends the whole `FlowDefinition` over `MSG.FLOW_DEFINITION_SAVE`, and the backend handler (`packages/backend/src/handlers/flow.ts:44`) passes the whole payload to `flowStore.saveFlow`. No change is expected — re-read both to confirm, and if either picks fields explicitly, add `loop`.

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

Then, in the running app: create a two-step looped flow whose actions are shell actions that take a beat (`sleep 2; echo done` — *not* instant exits; see "Known pre-existing race" at the top of this plan), start it, and confirm the header counts up through iterations, the step rows reset each lap, and the Stop button reads "Finish loop" and leaves the run green rather than red.

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

This needs **two** looped flows, because shell actions and agent actions exercise different paths and only an agent action can run `taskflow-cli flow complete`.

**Flow A — two shell actions**, each `sleep 2; echo done` (not instant exits; see "Known pre-existing race" at the top of this plan):

1. Start it on a task. Confirm it wraps and the iteration counter advances.
2. Confirm a completed shell step shows no clickable session — Task 6 Step 3b clears `sessionId` on the shell auto-complete path.
3. Press Stop. Confirm the run ends completed, not failed, and that the loop actually halts rather than spawning another lap.

**Flow B — one shell action then one agent action:**

4. Start it and let it run **at least one full wrap** — have the agent action run `taskflow-cli action complete` so the loop returns to step 1 and the agent step launches a second time. Session accumulation is what Task 6 fixes, and it only shows up across laps: confirm roughly one agent session is live at a time, not one per step per lap.
5. On the second lap, from the agent action, run `taskflow-cli flow complete`. Confirm the run ends as completed and the agent's own session is closed. To also see the skip-the-rest behaviour, make Flow B three steps (shell, agent, shell) and issue `flow complete` from the middle one — with the agent as the last step there is nothing left to skip.
6. Run `taskflow-cli flow complete` again from a stale terminal in that closed session. Confirm it does not resurrect or alter the finished run.

- [ ] **Step 5: Commit any fixes**

Run `git status --short` and stage only the paths this plan touched. Never `git add -A` here — it would sweep in unrelated working-tree changes.

```bash
git status --short
git add <the specific files you changed>
git commit -m "fix(flows): address issues found in full verification"
```

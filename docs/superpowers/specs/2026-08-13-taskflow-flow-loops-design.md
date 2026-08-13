# Flow Loops — Design

Date: 2026-08-13
Status: Approved for planning

## Problem

Flows run each action once and then complete. Two flows built today are meant to
run continuously — each is hand-rolled as a loop, and controlling them is
awkward: there is no way to say "keep going" and no clean way to say "stop
going" from inside an action.

The desired behavior: a flow marked as a loop restarts from its first action as
soon as the last one finishes, keeping its original inputs. An agent inside the
flow needs exactly two commands — one to finish the current step, one to finish
the whole flow.

## Scope

In scope: a `loop` flag on flow definitions, wrap-around in the runner, a
`taskflow-cli flow complete` command with its API route, prompt changes so
agents know the contract, and UI to set and observe the flag.

Also in scope because loops make them load-bearing rather than latent: closing
agent sessions when a looped step completes, and serializing the runner's
mutating methods under the existing owner lock.

Out of scope: per-iteration history, iteration caps, cooldowns between laps,
any change to how a run recovers from a backend restart, and making
master-owned flows reachable from the CLI (see Known consequences).

## Decisions

| Question | Decision |
|---|---|
| Where `loop` lives | Property of `FlowDefinition`, toggled in the flow editor; snapshot onto the run at start |
| Artifacts across iterations | Carried over, latest-wins per action + type |
| Inputs across iterations | Carried over (already stored on the run) |
| `flow complete` from a mid-flow step | Ends the run immediately; remaining steps marked skipped |
| Safety limits | None. A loop ends via `flow complete`, Stop, or a failing step |
| Stop on a looped run | Ends the run as `completed`, not `failed` |
| Runner mechanic | Wrap inside `advanceOrComplete`; one long-lived `FlowRun` |
| Session cleanup | Looped flows close each step's session on completion; non-looped unchanged |

### Rejected alternatives

**A new `FlowRun` per iteration.** Gives real per-lap history, but fights the
"one active run per owner" guard in `startFlow`, grows stored runs without
bound on a flow designed to run indefinitely, and forces the UI to understand
run series.

**An `iterations: FlowActionState[][]` array on the run.** Full history in one
record, but the document grows forever, and every consumer of `run.actions`
changes shape.

Both were rejected because the requirement is a loop that runs indefinitely;
anything accumulating per-lap state is unbounded by construction.

## Types

`packages/shared/src/types/flow.ts`:

- `FlowDefinition.loop?: boolean` — optional, so stored flows stay valid.
- `FlowRun.iteration?: number` — 1-based; `undefined` means 1, so stored runs
  need no migration.
- `FlowRun.loop?: boolean` — snapshot of the definition's `loop` taken at
  `startFlow`.

The snapshot is load-bearing. `saveFlow` (`flow-store.ts:144`) permits editing a
flow while it has active runs — only `deleteFlow` is guarded by
`hasActiveRunsForFlow` (line 160). Without a snapshot, toggling `loop` on a
definition would retroactively change a live run: a running loop would quietly
stop wrapping, or a finite run would start wrapping, and Stop would switch
between `completed` and `failed` mid-run.

**The runner reads `run.loop`, never `flow.loop`, once a run exists.** Only
`startFlow` reads the definition's flag. This also means `advanceOrComplete`
does not need to resolve the flow definition merely to decide whether to wrap.

No new `FlowRunStatus` or `FlowActionStatus` values. A loop that ends is
`completed`, like any other flow.

## Runner

`packages/backend/src/services/flow-runner.ts`.

### Wrap-around

`advanceOrComplete` (line 380) currently completes the run when
`nextIndex >= run.actions.length`. It gains one branch: if `run.loop` is set,
call a new `startNextIteration` instead of completing.

`startNextIteration(run)`:

1. Reset every action state via the existing `resetActionState`.
2. `run.iteration = (run.iteration ?? 1) + 1`.
3. `run.currentActionIndex = 0`; mark action 0 `running` with a fresh
   `startedAt`.
4. Save, broadcast, then `launchPersistedActionWithRecovery(owner, run.flowId, run, 0)`.

If launching the first action of a new iteration fails,
`markActionLaunchFailed` (line 509) applies unchanged: that action is marked
`failed` and the run is `paused`. The run is left coherent and recoverable —
the user can Resume to retry step 0 of that iteration, or Stop. This is the
same outcome as a launch failure anywhere else in a flow.

### Session cleanup on completion

`closeSession` is currently called on skip (line 152), jump (174), pause (219),
and fail (365) — but never on the normal completion path.
`handleActionComplete` marks the step complete and `advanceOrComplete`
immediately spawns the next one alongside the still-live session. This is
deliberate: the runner expects agent sessions to outlive their step, which is
why an agent exiting without signaling is treated as a failure (line 281) and
why only `shell` sessions auto-complete on clean exit (line 272).

For a finite flow this is bounded by the action count. For a loop it is
unbounded — one live PTY per step per lap, forever.

Therefore: **in a looped flow, `handleActionComplete` closes the completed
step's session** after marking it complete and removing it from
`sessionFlowMap`. Live sessions stay at roughly one. Non-looped flows keep
today's behavior, so a finished flow's agent output remains inspectable.

`completeFlow` closes the calling session **always**, looped or not, because the
run is ending — which is already what `stopFlow` and `failFlow` do. The
looped-only rule applies to `handleActionComplete`, where the run continues.

Closing is safe to do from inside `handleActionComplete`: `PtyManager.close`
(`pty-manager.ts:291`) kills the process and drops it from its registry, and
the exit callback fires later from `cleanup` (line 199), asynchronously. It
does not re-enter the runner synchronously, so it cannot deadlock against the
owner lock described below.

The guard that makes the eventual exit a no-op is the `sessionFlowMap` deletion,
not the already-completed status check: `handleSessionExit` returns at line 257
when the map has no entry for the session, before it looks at any run state.
`handleActionComplete` already deletes that entry (line 140). Order the work as
delete-from-map, mark completed, persist, then close, so the exit is inert no
matter when it lands — including after the loop has wrapped and a new session
is running on the same action entry.

### Artifacts and inputs on wrap

Neither is touched. `inputValues` already live on the run, so the original
inputs stay available through `taskflow-cli flow input` on every lap.

Artifacts carry over. `saveArtifact`'s existing latest-wins rule (line 321,
keyed on `actionEntryId` + `type`) means iteration 2's `plan` replaces
iteration 1's for the same step, while an artifact written by a step that did
not run again remains readable. No new storage is required.

This is bounded **only if artifact type names are stable across laps**. An
agent that invents `plan-1`, `plan-2`, … per iteration grows `run.artifacts`
without limit, and `saveFlowRun` rewrites the entire run JSON on every save
(`flow-store.ts:179`). The looped-flow prompt therefore instructs agents to
reuse the same artifact type names each iteration. This is guidance, not
enforcement — no cap is imposed.

`jumpToAction` (line 198) deletes artifacts for the target step and everything
after it, and `resumeFlow` (line 238) deletes artifacts for the current step.
Both are intended loop semantics: they mean "redo from here", and the artifacts
being cleared are exactly the ones about to be rewritten. Neither changes.

### `completeFlow(ownerId, flowId, sessionId)`

New public method:

1. Load the run; no-op unless `status === "running"`.
2. Guard on session identity, matching `handleActionComplete` (line 136): the
   caller must own the currently-running step. A stale session cannot end a
   live flow.
3. Mark the calling step `completed` with `completedAt`; remove it from
   `sessionFlowMap`.
4. Mark every remaining `pending` step `skipped` with the same timestamp.
5. Set the run `completed` with `completedAt`; save and broadcast.

Steps 2–5 are exactly `endRun(run, { status: "completed", runningStepOutcome:
"completed", skipPending: true })`, which also closes the calling session and
drops its mapping first — making the asynchronous exit inert.

`completeFlow` applies to looped and non-looped flows alike; on a non-looped
flow it is simply an early finish.

### Stop

`stopFlow` on a looped flow ends the run as `completed` rather than `failed`,
with the in-flight step marked `skipped`. Non-looped flows keep today's
behavior.

A shared helper backs the three ending paths so they cannot drift:

```
endRun(run, {
  status,               // "completed" | "failed"
  runningStepOutcome,   // "completed" | "skipped" | "failed"
  skipPending,          // boolean
})
```

It closes the in-flight session if there is one, applies `runningStepOutcome`
to the currently-running step, optionally marks remaining `pending` steps
`skipped`, sets the run status and `completedAt`, then saves and broadcasts.

The three callers:

| Caller | status | runningStepOutcome | skipPending |
|---|---|---|---|
| `completeFlow` | `completed` | `completed` | yes |
| `stopFlow`, looped | `completed` | `skipped` | yes |
| `stopFlow`, non-looped / `failFlow` | `failed` | `failed` | no |

The last row must reproduce today's `failFlow` (line 362) exactly, including
the detail that the current step is marked failed **only if its status is
`running`**, and that pending steps are left pending. `runningStepOutcome` is
likewise applied only to a step whose status is `running`. Existing non-looped
stops must come out identical field by field; the regression test below pins
this. Timestamps are exempt: today `failFlow` calls `new Date()` twice, once for
the action and once for the run, so a helper capturing a single timestamp may
differ textually. That difference is immaterial and the test should not assert
on it.

### Concurrency hardening

`withOwnerLock` (line 50) currently guards only `startFlow` (line 89). Every
other public mutator reads the run, mutates it, and writes it back with no
serialization. Two concurrent callers can each read the same run and both
advance, spawning duplicate sessions, or a stale copy can overwrite an advanced
one.

The complete set to wrap:

| Locked (public entry points) | Unlocked (private helpers) |
|---|---|
| `startFlow` (already), `handleActionComplete`, `completeFlow`, `skipAction`, `jumpToAction`, `pauseFlow`, `resumeFlow`, `stopFlow`, `handleSessionExit`, `saveArtifact`, `failFlowByIds` | `failFlow`, `endRun`, `advanceOrComplete`, `startNextIteration`, `launchAction` and its recovery wrappers, `markActionLaunchFailed` |

`handleSessionExit` and `failFlowByIds` are easy to miss and both matter.
`handleSessionExit` (line 255) is invoked asynchronously from the PTY exit path
(`index.ts:220`) and can read a step as running while a completion advances
underneath it, then save its stale paused/failed copy over the advanced run.
`failFlowByIds` (line 340) is called from the task archive and delete paths
(`handlers/task.ts:52`, `task-routes.ts:363`, `task-routes.ts:448`).

`handleSessionExit` must read `sessionFlowMap` before taking the lock — the
mapping is what supplies the `ownerId` to lock on — then re-read the run inside
the lock.

This is pre-existing and largely mitigated in the CLI path: the route awaits
`handleActionComplete` before responding (`flow-routes.ts:57`) and the CLI's
`curl` blocks, so an agent cannot exit into a concurrent `handleSessionExit`.
It remains reachable when a UI action (pause, stop, skip, jump) races an
in-flight completion.

Looping does not raise the per-event probability, but it multiplies the number
of events over a run's lifetime. Since the lock helper already exists, this
work wraps the paths above in `withOwnerLock`.

`withOwnerLock` is **not** re-entrant: a nested call waits on a gate its own
caller holds, and deadlocks. The public/private split in the table is what
keeps that from happening and must be preserved. The helper is otherwise
correct — `finally` releases the gate even when `fn()` throws, and the
`ownerLocks.get(ownerId) === queued` check deletes the entry only when it is
still the tail.

### Failure inside a loop

Unchanged. A step whose agent exits without signaling completion fails the step
and pauses the run; Resume re-runs that step within the current iteration. A
loop therefore cannot spin on a broken step.

### Validation and small fixes in touched code

- `assertValidFlowDefinition` (`flow-store.ts:12`) validates actions and inputs
  but not `loop`. Add a `typeof flow.loop === "boolean"` check when the field is
  present, so a hand-edited `"loop": "false"` cannot read as truthy.
- `getArtifacts` (line 337) sorts `run.artifacts` in place, mutating the run for
  every caller. Sort a copy.

## API and CLI

New route in `packages/backend/src/api/routes/flow-routes.ts`:

```
POST /api/flow/complete
body: { taskId | projectId, flowId, sessionId }
```

Mirrors `/api/flow/action-complete` (line 34) in body shape, validation, and
error handling; delegates to `flowRunner.completeFlow`.

`taskflow-cli flow complete` is added to the existing `flow)` case
(`taskflow-cli.sh:548`) alongside `flow input`, and to the TypeScript
implementation in `taskflow-cli-bin.ts`. Both must change: the shell script is
what runs on macOS and Linux, but the two implementations are expected to stay
in sync.

`taskflow-cli-flow-context-commands.md` documents the command. That file is a
bundled text import written to `~/.config/taskflow/agent-skills/` on startup
(`internal-agent-skill.ts:107`), so editing the repo copy is sufficient.

`taskflow-cli flow create` and `flow update` carry name, description, and
actions but no `loop` (`taskflow-cli-bin.ts:743`, `taskflow-cli.sh:691`). They
gain `--loop` / `--no-loop` so a flow defined from the CLI can be a loop.

## Prompt

`buildActionPrompt` (line 528) gains the flow's `loop` flag and the run's
iteration number. `launchAction` already holds both the `flow` and the `run`,
so no new plumbing is needed.

For a looped flow the system prompt states the contract explicitly: the flow
loops; after the last action it restarts from the first with the same inputs;
artifacts carry over; this is iteration N; `taskflow-cli action complete`
finishes this action; `taskflow-cli flow complete` ends the whole loop. It also
tells the agent to reuse the same artifact type names on every iteration rather
than inventing per-iteration names, for the unbounded-growth reason above.

Non-looped flows keep today's prompt.

## UI

**FlowEditor** (`FlowEditor.tsx`): a "Loop this flow" checkbox under the
description field, with helper text — "Restarts from the first action after the
last one finishes. Inputs and artifacts carry over. An agent ends it with
`taskflow-cli flow complete`." It joins the existing `handleSave` payload
(line 188) and dirty-check (line 220).

**FlowPanel** (`FlowPanel.tsx`): when `run.iteration` is set, the header shows a
`Repeat` icon and "Iteration N" beside the flow name. This is load-bearing: on
wrap, every step flips from completed back to pending at once, and without a
counter that reads as a glitch. The step list keys on `actionEntryId`
(line 187), which is stable across laps, so rows update in place.

For a looped run, the Stop button's tooltip reads "Finish loop" and drops the
`text-destructive` styling — ending a loop is the normal exit, not an abort.

**FlowManagementDialog**: a small `Repeat` icon on looped flows in the list
(line 188).

**flow-store** (`packages/ui/src/stores/flow-store.ts`): pass `loop` through the
save path. No other store change — `FlowRun` updates already arrive whole over
`FLOW_RUN_UPDATED`.

## Testing

`flow-runner.test.ts` carries the semantics:

- A 2-step looped flow completing its last step wraps to iteration 2, with both
  steps reset and step 0 running on a fresh session.
- Artifacts and `inputValues` survive the wrap; an artifact re-saved in
  iteration 2 replaces its iteration-1 counterpart for the same step.
- `completeFlow` from step 1 of 3 marks step 1 completed, steps 2–3 skipped, run
  completed.
- `completeFlow` from a session that is not the current step's is a no-op.
- A step failing mid-loop pauses the run instead of wrapping; Resume re-runs
  that step in the same iteration.
- Stop on a looped run yields `completed`; on a non-looped run it still yields
  `failed`.
- A non-looped flow still completes after its last step.
- Completing a step in a looped flow closes that step's session; completing a
  step in a non-looped flow does not.
- `completeFlow` on a looped flow closes the calling session; the subsequent
  `handleSessionExit` for that session is a no-op and does not alter the run.
- Two concurrent `handleActionComplete` calls for the same session advance the
  run once and spawn exactly one next session (the owner-lock guard).
- `saveFlow` rejects a definition whose `loop` is present but not a boolean.
- `getArtifacts` does not reorder `run.artifacts`.
- Toggling `loop` off on the definition while a looped run is active does not
  change that run: it still wraps, and Stop still completes it. (Pins the
  `run.loop` snapshot.)
- A session exit arriving after the loop has wrapped — for the same action
  entry id, from the previous iteration's session — does not modify the run.
  (Pins the `sessionFlowMap` guard.)
- `handleSessionExit` racing a completion does not overwrite the advanced run.

`flow-integration.test.ts` covers `POST /api/flow/complete` end to end.
`taskflow-cli.test.ts` covers the new `flow complete` verb.

## Known consequences

**An owner running a loop cannot start another flow.** A looped run stays
active indefinitely, and `startFlow` refuses to start when its owner already
has an active run (line 94). Inherent to the design, not a defect introduced by
it.

**Backend restart mid-loop.** Startup already downgrades stuck runs
(`index.ts:242`): a `running` run becomes `paused` and its in-flight step is
marked `failed` with its `sessionId` cleared. A looped run therefore survives a
restart as a resumable paused run — Resume re-runs the interrupted step within
its iteration and the loop continues. The consequence is that it stays an
*active* run, so it keeps blocking other flows for that owner until someone
resumes or stops it. No change is made here.

**Master-owned flows cannot use flow-context CLI commands.** `resolve_owner_id`
(`taskflow-cli.sh:29`) resolves only `TASKFLOW_TASK_ID` and
`TASKFLOW_PROJECT_ID`, and master sessions receive neither
(`session-lifecycle.ts:421`). So `action complete`, `artifact`, `flow input`,
and the new `flow complete` are all unreachable from a master-owned flow
action, and `POST /api/flow/action-complete` accepts only task/project owners
(`flow-routes.ts:42`). This is pre-existing and unrelated to loops; a master
flow was already unable to advance itself. Loops do not fix it and do not make
it worse. Fixing it means a master owner shape in the HTTP body and a
`TASKFLOW_MASTER` env var — deliberately out of scope here.

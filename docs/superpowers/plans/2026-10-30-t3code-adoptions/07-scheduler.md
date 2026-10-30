# Section 7: Scheduler admission, run-once catch-up and stable nextRunAt

Apply design.md §4. Read the index, design and handoff before implementation. All paths below are repository-relative; anchors were checked against the current source on 2026-10-30. This section has no dependency on another adoption section, but the index's agent-browser completion gate still applies.

**Files:**

- Modify: `packages/backend/src/services/scheduler-service.ts:12` dependencies, `:43` next-occurrence calculation, `:60` service state, `:77` startup, `:114` scheduling, `:144` execution, `:208` completion/exit/timeout, `:278` updates, `:308` manual trigger and `:337` shutdown.
- Modify: `packages/backend/src/services/schedule-store.ts:48`. Add a definition-update wrapper around the existing serialized `update` mutation. Reuse `withMutation` at `:72`; keep execution-state updates on `update`.
- Modify: `packages/shared/src/types/schedule.ts:14` and `:21`. Document the timing tuple and persisted due-time invariant. Reuse `Schedule` and its existing nullable fields; no timezone field, schema migration or new exported type.
- Modify: `packages/backend/src/api/routes/schedule-routes.ts:108` HTTP update and `:147` scheduler notification.
- Modify: `packages/backend/src/handlers/schedule.ts:93` WS update and `:124` scheduler notification. These are the only current `onScheduleUpdated` callers.
- Create: `packages/backend/tests/services/schedule-store.test.ts`, `packages/backend/tests/services/scheduler-service.test.ts`, `packages/backend/tests/api/schedule-routes.test.ts`, `packages/backend/tests/handlers/schedule.test.ts`.
- Read/reuse: `packages/backend/tests/services/dev-server-store.test.ts:1` temporary-file fixtures; `packages/backend/tests/api/dev-server-routes.test.ts:1` real `ApiRouter` requests; `packages/backend/tests/handlers/dev-server.test.ts:1` real services and injected effects; `packages/backend/tests/test-router.ts:8` `TestRouter`; `packages/backend/src/services/browser-tab-service.ts:40` injected clock and cancellable timer pattern.
- Inspect only: `packages/backend/src/index.ts:161`, `:498`, `:569`, `:602`. Construction, online-resume, initialization and shutdown already exist. Keep those call sites; the service owns the new tick.

**Interfaces:**

Consumes the existing `Schedule`, `SpawnResult`, `ScheduleStore`, `MSG.SCHEDULE_UPDATED` and `SchedulerDeps` effects. Existing `spawnSession(schedule): Promise<{ sessionId: string; isShell: boolean }>` and `closeSession(sessionId): void` stay unchanged.

Produces these service/store changes. Types nested in these signatures stay local unless an actual import needs them.

```ts
// Additions/changed signatures only; existing members remain.
interface ScheduleStore {
    // Calls update(), so comparison and invalidation share its mutation lock.
    updateDefinition(
        id: string,
        updater: (schedule: Schedule) => Schedule,
    ): Promise<{ schedule: Schedule; timingChanged: boolean }>;
}
interface SchedulerService {
    onScheduleUpdated(scheduleId: string, timingChanged: boolean): Promise<void>;
    triggerNow(scheduleId: string): Promise<void>; // existing public contract
    scheduleNext(scheduleId: string): Promise<void>; // preserve stored due time
}
interface SchedulerDeps {
    now?: () => number; // defaults to Date.now
    schedule?: (callback: () => void, delayMs: number) => () => void;
    // Default schedule uses setTimeout and returns a clearTimeout closure.
}
// Private methods on SchedulerService, not interface members or exports:
// admit(scheduleId: string): boolean
// checkDue(): Promise<void>
// execute(scheduleId: string, source: "scheduled" | "manual"): Promise<void>
```

## Behavior

### Definition updates

- The timing tuple is exactly `expressionType`, `expression`, `enabled`. There is no timezone field in `Schedule` or either update payload. Keep cron-parser's existing local-time interpretation.
- `updateDefinition` builds the proposed record from the current record inside `update`'s existing mutation lock. Compare tuple values, not whether keys were supplied. A patch repeating the same expression/enabled values is unrelated for scheduling purposes.
- If the tuple changes, persist `nextRunAt: null` in that same write and return `timingChanged: true`. Otherwise preserve the current `nextRunAt` byte-for-byte and return `false`. Internal run-state writes still use `update`, which must remain able to set `nextRunAt`.
- Both HTTP and WS paths keep their existing field-clearing and validation conventions, build the merged record, and validate its effective expression/type with `validateExpression`. This also validates a type-only edit. Replace their definition `update` call with `updateDefinition`, then call `onScheduleUpdated(result.schedule.id, result.timingChanged)`.
- `onScheduleUpdated(false)` broadcasts the latest stored schedule without touching its due timer, active-run admission or timeout timer. Names, prompts, action/agent options and timeout edits must not move the due time. An already running session keeps the timeout that was installed at its start.
- `onScheduleUpdated(true)` clears only the due timer and deferred entry, then arms/checks the latest record if enabled. Disabling clears the due time and lets an admitted/running session finish, with its timeout intact. Enabling or changing timing initializes the next occurrence from the current wall clock even during a run, but installs no due timer until admission is released.
- Return the latest stored record after the scheduler notification in both update handlers, so a response cannot advertise the temporary invalidated `nextRunAt`. Keep HTTP status 200 and the WS response shape `Schedule`. Keep `MSG.SCHEDULE_UPDATED`'s payload shape unchanged.

Why: t3code `apps/server/src/scheduledTasks/ScheduledTaskService.ts:1151` preserves due times across title/prompt edits.

### Admission and lifetime

- Maintain a private `Set<string>` for admitted schedules, including pending spawns and running sessions. `runningSessions` still maps successful sessions to `SpawnResult`.
- `execute` calls synchronous `admit` before its first `await`, including the first store read. Both `triggerNow` and automatic scheduling enter this method. A manual duplicate rejects with exactly `Schedule is already running`; an automatic duplicate returns without spawning or advancing the due time.
- After admission, re-read the schedule. Automatic execution requires `enabled` and `Date.parse(nextRunAt) <= now()`. An early/stale timer only re-arms. Preserve the current disabled-manual-trigger behavior: no spawn. Release admission on these no-run returns.
- Keep the reservation through a pending spawn, successful registration, run-state persistence, and the session's lifetime. Do not release it in an unconditional `finally` immediately after `spawnSession` resolves.
- Release on spawn failure and on each existing terminal path: explicit completion, shell/agent exit, timeout, deletion and shutdown. When a completion path closes a PTY, retain admission until it has cleared the stored `runningSessionId`; its exit callback must not complete the same run a second time. Use the existing running-session identity as the completion guard.
- If a spawn succeeded but registration/persistence fails, close that returned session and remove its run/timeout state before releasing admission. A failed store read must also release a pending reservation. Timer/tick callbacks catch rejected work and log it rather than leave an unhandled rejection.
- A pending spawn that resolves after deletion or shutdown must close its returned session and must not register/re-arm it. Check the service's stopped state and the latest record before registration. Do not add process-wide locks or persist the admission set.

Why: t3code `apps/server/src/scheduledTasks/ScheduledTaskService.ts:756` reserves before asynchronous spawn work.

### Due time and catch-up

- `nextRunAt` is authoritative whenever it is a valid stored timestamp. `scheduleNext` preserves it rather than calling cron-parser afresh. If it is null or invalid on an enabled record, initialize once from `now()`. A legacy record without a due timestamp starts a new timetable; there is no missing occurrence to reconstruct.
- Change private `computeNextRun` to accept an explicit wall-clock time. Cron uses `CronExpressionParser.parse(expression, { currentDate: new Date(nowMs) }).next().toDate()`. Rate uses `new Date(nowMs + parseRateExpression(expression))`. Do not use `lastRunAt` as the rate base for a new timetable.
- Run the same due check during `init`, from every due-timer callback and every 30,000 ms wall-clock tick. Use the injected `schedule` for a repeating cancellable tick as well as due/timeout timers. Each tick re-reads `now()` and stored due times; elapsed timer duration is not the due test.
- Start the tick once after stale-run cleanup. `enabled: false` on `SchedulerDeps` installs no timers and spawns nothing. Repeated `init` must not install a second tick. `shutdown` cancels the tick as well as all existing timers.
- An overdue enabled schedule runs once whether it missed one occurrence or a thousand. Do not loop through historical occurrences. At the run attempt's persisted outcome, store a new future due time calculated after the current wall clock: next cron occurrence, or current time plus rate interval. Persist that future value on success and spawn failure; never clear it merely because a session started.
- An edit during a pending spawn must win over that spawn's captured definition. In its outcome mutation, inspect the current enabled/timing fields: a disabled record keeps a null due time, and a changed timing tuple keeps the new edit's initialized due time, initializing it from the current tuple only if still null. Never restore the captured expression or enabled value.
- While admitted/running, automatic due checks do not spawn, advance the due time or clear admission. Completion/exit/timeout releases the run and calls `scheduleNext`; if the stored future occurrence became overdue during the run, the same run-once rule applies. Otherwise arm its remaining delay. Keep a single due timer per schedule. Cap a timeout delay at `2_147_483_647` ms, then recheck the stored due time on firing.
- Manual triggering of an enabled schedule uses the same admission and outcome handling, and starts the following timetable after its attempt, preserving the existing manual-run reset behavior. It does not require the old due time to have arrived.
- Offline due checks defer without consuming/clearing `nextRunAt`. Keep `Skipped: offline` when a due run is deferred, avoid repeated identical writes/broadcasts, and use the existing `resumeDeferred()` wiring to recheck on reconnection. A future offline schedule retains its future due time. On reconnect, an overdue schedule catches up once.
- At startup retain stale-run cleanup and exactly `Previous run did not complete (app restarted)`. After cleanup, catch-up still uses the stored due timestamp. Preserve `lastRunAt` as the most recent attempt time.

Implementation detail: use the existing JSON store and one cancellable timeout function for all timer kinds; a second scheduler or timer library is unnecessary.

Preserve these existing strings and contracts: `Schedules are owned by the production Taskflow instance`, `Cannot trigger schedule while offline`, `Schedule not found: ${scheduleId}`, `Failed to spawn session: ${errorMessage}`, `Timed out after ${timeout} minutes`, `Shell exited unexpectedly with code ${exitCode}`, `Agent exited unexpectedly with code ${exitCode}`, and `taskflow-cli schedule complete`. No CLI syntax changes, so neither CLI implementation changes in this section.

## Task 7.1: Preserve due times through HTTP and WS edits

### Steps

- [ ] **Step 1:** Write `schedule-store.test.ts` using temporary JSON files and the real store. Name tests:
  - `an unrelated definition edit preserves the stored nextRunAt exactly`
  - `repeating the same timing fields does not invalidate nextRunAt`
  - `changing expression, expressionType or enabled invalidates nextRunAt`
  - `timing comparison runs against the current record inside the mutation queue`
  - `execution-state update can still advance nextRunAt`

  Write the update tests in `api/schedule-routes.test.ts` and `handlers/schedule.test.ts`. Use real `ApiRouter`/`TestRouter`, a real temporary `ScheduleStore`, a real `SchedulerService` with injected spawn/clock/timers, and an empty `FlowStore` fixture. Use fake `generateScheduleName`/`generateName`; no agents, listeners or `mock.module`.
  - `HTTP PATCH preserves nextRunAt for prompt and timeout edits`
  - `HTTP PATCH repeating enabled true preserves nextRunAt`
  - `HTTP PATCH changing timing returns the newly stored due time`
  - `WS schedule:update preserves nextRunAt for agent and action edits`
  - `WS schedule:update changing timing returns the newly stored due time`
  - `HTTP and WS type-only edits validate the merged expression`
- [ ] **Step 2:** From the repository root run `bun test packages/backend/tests/services/schedule-store.test.ts packages/backend/tests/api/schedule-routes.test.ts packages/backend/tests/handlers/schedule.test.ts`. Expected: FAIL on missing `updateDefinition` and preserved/returned due-time assertions.
- [ ] **Step 3:** Implement the definition wrapper, the shared-type comments, both update paths and the `onScheduleUpdated` timing flag. Add the clock/timer injection needed by these fixtures. Preserve active-run timeouts on edits.
- [ ] **Step 4:** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/backend/tests` and `bun test packages/shared`. Expected: PASS. Format only changed files with `bunx prettier --write <explicit changed paths>` and lint changed TypeScript paths with `bunx eslint <explicit changed paths>`. Record any independently reproduced baseline failure separately; a changed-path regression must be fixed.
- [ ] **Step 6:** Review `git diff --check`, stage only this task's paths and commit `fix(scheduler): preserve due times across unrelated schedule edits`. No push or commit trailers.

## Task 7.2: Admit once and catch up from the stored timetable

### Steps

- [ ] **Step 1:** Write `scheduler-service.test.ts`. Use a real temporary `ScheduleStore`, recorded broadcasts/closes, a deferred `spawnSession` promise, and a manual clock with cancellable callbacks. Advance wall time separately from timer callbacks to model sleep. Drain asynchronous callbacks before assertions. Tests must not wait 30 real seconds or invoke an installed agent.
  - `two concurrent manual triggers reserve before the first await and spawn once`
  - `a due timer racing a manual trigger spawns once`
  - `a wall-clock tick racing a due timer spawns once`
  - `a duplicate manual trigger rejects with Schedule is already running`
  - `startup runs an overdue cron once and stores the next occurrence after now`
  - `startup runs an overdue rate once and stores now plus interval`
  - `sleep across many occurrences catches up once on the next wall-clock tick`
  - `an early timer rechecks the stored due time and does not spawn`
  - `a future stored cron due time survives startup without a write`
  - `a missing due time initializes once and remains stable on later checks`
  - `offline deferral preserves nextRunAt and reconnect catches up once`
  - `spawn failure records its exact error, releases admission and arms a future retry`
  - `completion, shell exit, agent exit and timeout each release admission`
  - `closing a completed session does not finalize its run twice`
  - `an unrelated edit during a run keeps its admission and timeout`
  - `a timing edit during pending spawn keeps the new definition and its due time`
  - `disabling a running schedule lets it finish without rescheduling`
  - `a due time passed during a run catches up once after completion`
  - `deletion or shutdown during spawn closes the late session without rearming`
  - `startup clears a stale runningSessionId and retains the restart error`
  - `a disabled scheduler installs no timers and rejects manual triggering`
  - `shutdown cancels the wall-clock tick and init never duplicates it`
- [ ] **Step 2:** Run `bun test packages/backend/tests/services/scheduler-service.test.ts`. Expected: FAIL, including the concurrent-spawn and missed-cron assertions.
- [ ] **Step 3:** Implement synchronous admission, guarded release paths, explicit-now next-occurrence calculation, stored-due scheduling, offline preservation and the 30,000 ms tick. Keep existing index wiring and completion CLI unchanged. Add attribution only if copying code: `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/server/src/scheduledTasks/ScheduledTaskService.ts`.
- [ ] **Step 4:** Run the Step 2 command and Task 7.1's focused command. Expected: PASS. Assert persisted timestamps and spawn counts, not private-set contents or source text.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/backend/tests` and `bun test packages/shared`. Expected: PASS. Run changed-file Prettier/ESLint and `git diff --check`. Do not run the root format command.
- [ ] **Step 6:** Commit `fix(scheduler): admit runs once and catch up overdue schedules`. Stage only reviewed paths; no push or trailers. Record the two commits, tests and any baseline failures in the existing handoff as required by the chain.

## Open questions for the planner

None. The current schema has no timezone field; this section preserves that contract and applies the fixed run-once policy.

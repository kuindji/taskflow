# Flow Loops — Implementation Handoff

Plan: `docs/superpowers/plans/2026-08-13-taskflow-flow-loops.md`

This document is the source of truth for progress. One bounded step per session.

## Status legend

`pending` / `implemented` / `in-review round N` / `clear` / `review-skipped`

## Tasks

| # | Task | Status | Base commit | Notes |
|---|------|--------|-------------|-------|
| 1 | Types and `loop` validation | clear | `e72babf` | Round 1 clean; its tests later broke `bun run lint`, repaired in `69950b5` |
| 2 | Extract `endRun` (pure refactor) | clear | `c505881` | Impl `75534e4`; round 1 fixes `552acf8` + `69950b5`; round 2 clean |
| 3 | Serialize runner public mutators under owner lock | clear | `f2fdb9d` | Impl `7d0cc45`; round 1 clean, no fix commit |
| 4 | Snapshot `loop` onto run, wrap around | clear | `2e73030` | Impl `934d25d`; round fixes `81ea944` / `7e82f63` / `1cd22d4`; round 4 clear; test-only guard `888f517` |
| 5 | Stop completes a looped run | clear | `4974457` | Impl `e9dc752`; round 1 fix `5f72826`; round 2 clear; test-only guard `d509159` |
| 6 | Close session when a looped step completes | clear | `a20836b` | Impl `02b05b4`; round 1 clean, no fix commit |
| 7 | `completeFlow` and its route | clear | `f2a3228` | Impl `8ea61ed`; round 1 clear, test-only guard `be060a3` |
| 8 | CLI — `flow complete` and `--loop` on `flow create` | clear | `fe5d92d` | Impl `6d419d6`; round 1 clear, no fix commit |
| 9 | Tell the agent it is in a loop | pending | — | |
| 10 | Flow editor — loop toggle | pending | — | |
| 11 | Flow panel — iteration indicator, loop-aware stop | pending | — | |
| 12 | Full verification | pending | — | Includes manual E2E — likely a user gate |

## Review rounds

### Task 1 — round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `e72babf..ecafa5d`,
  code files only — plan/handoff doc changes excluded from the diff).
- Result: **clear — zero findings.** No fix commit; HEAD stays `ecafa5d`.
- Reviewer traced every `saveFlow` caller (HTTP route `flow-routes.ts:182`, WS handler
  `handlers/flow.ts:48`, UI `FlowManagementDialog.tsx:86` via the UI flow store, and both
  CLIs). None currently emits a non-boolean `loop`, so the new validation rejects nothing
  that previously worked.
- Verified independently by Claude:
  - `assertValidFlowDefinition` runs on **load** too (`flow-store.ts:137-139` inside
    `getFlows`), not only on save. Harmless now — no persisted definition carries `loop` —
    but it means a hand-edited `definitions.json` with `"loop":"false"` breaks *reads* of
    every flow, not just that one. Worth remembering if Task 8/10 ever writes the flag as
    a string.
  - `bun test packages/backend/src/services/__tests__/flow-store.test.ts` → 19 pass, 0 fail.
  - `bun run typecheck` → all four packages exit 0 (this is what covers the positive test,
    which `bun test` cannot fail on since it does not typecheck).
  - `git status` clean after both runs.

### Task 2 — implementation (2026-08-13)

- Base commit `c505881`; implementation commit `75534e4`.
- Step 1 characterisation tests added to `flow-runner.test.ts` (`describe("stopFlow — non-looped
  behaviour is preserved")`). Verified green **before** the extraction (22 pass / 0 fail) and
  again after — that is what makes this a genuine pure refactor rather than an assumed one.
- `endRun` + `EndRunOptions` added to `flow-runner.ts`; `failFlow` now delegates to it.
  `FlowActionStatus` added to the shared type import.
- One intentional ordering change carried over from the plan: `sessionFlowMap.delete` now runs
  *before* `closeSession` (old code closed first). Safe because the PTY exit is asynchronous,
  and delete-first is the ordering Tasks 5–7 rely on.
- Validation: `bun test packages/backend/src/services/__tests__/` → 53 pass, 0 fail (4 files).
  `bun run typecheck` → all four packages exit 0. `git status` clean apart from the handoff.

### Task 2 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `c505881..4508503`,
  `packages/` only — plan/handoff doc changes excluded from the diff).
- Reviewer's verdict on the core question: **no behaviour-preservation defect.** It traced
  both `failFlow` callers (`stopFlow`, `failFlowByIds`) and confirmed saved state and
  broadcast payload are unchanged. It also independently checked the delete-before-close
  reorder against the production wiring and agreed it is safe — `closeSession` is
  `ptyManager.close`, whose exit path runs later via `proc.exited.then(cleanup)`
  (`pty-manager.ts:251`), and on Windows `kill()` only messages the child
  (`pty-session-win.ts:149`). Claude confirmed both paths by reading them: there is no
  production path where `closeSession` synchronously re-enters `handleSessionExit`.
- Three minor/nit findings raised. Each was verified by mutation before acting:

  1. **Accepted — `runningStepOutcome` typed too wide** (`flow-runner.ts:44`). Verified: a
     probe file assigning `runningStepOutcome: "running"` compiled cleanly under
     `bunx tsc --noEmit`. Not reachable from `failFlow` today, but Tasks 5 and 7 add two
     more callers. Narrowed to `Extract<FlowActionStatus, "completed" | "skipped" | "failed">`,
     which covers every value the plan's future callers pass.
  2. **Accepted — the characterisation tests never pinned the broadcast.** Verified by
     mutation: deleting `this.broadcastUpdate(run)` from `endRun` left **all 22 tests
     green**, so a refactor could silently stop every connected UI from updating on
     stop/fail. Added `test("broadcasts the ended run")`, which asserts the
     `FLOW_RUN_UPDATED` payload; confirmed red under that same mutation and green without it.
  3. **Rejected — "assert action 0's `completedAt` is unchanged".** The suggested assertion
     is vacuous here: two `new Date().toISOString()` calls across an await boundary landed in
     the same millisecond in **1000/1000** samples, so a helper that wrongly rewrote the
     timestamp would still pass. This is the same hazard the plan itself flags for Task 5,
     where the fix was to assert on `broadcasts` instead. Not implemented; finding 2's test
     covers the underlying "don't disturb finished steps" concern via the payload.
- Fix commit `552acf8`.
- Separately found and fixed: `bun run lint` was **red**, and had been since Task 1. The two
  loop tests in `ecafa5d` used `await expect(...).resolves` / `.rejects`, which
  `@typescript-eslint/await-thenable` rejects because bun-types declares those matchers as
  returning `void`. Confirmed by checking out `flow-store.test.ts` at `e72babf` and re-running
  eslint — clean there, two errors at HEAD. Rewritten without awaiting a non-thenable and
  without disabling the rule (`69950b5`); the rejection test was re-verified by deleting the
  loop validation from `flow-store.ts` and watching it go red.
- Validation after both commits: `bun test packages/backend/src/services/__tests__/` →
  **54 pass, 0 fail** (4 files). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `git status` clean apart from this handoff.

### Task 2 — review round 2 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `4508503..16c80cb`,
  `packages/` only — that range is exactly the two round-1 fix commits `552acf8` and `69950b5`).
- Result: **clear — zero findings.** No fix commit; HEAD stays `16c80cb` plus this handoff update.
- The review was pointed at the three things round 1 changed, and confirmed each:
  1. The `flow-store.test.ts` rewrite (dropping `.resolves` / `.rejects` for the lint gate) did
     not make either test vacuous. The positive test awaits `saveFlow` directly, so a rejection
     fails it; the negative test's `rejection` is `undefined` when the validation is removed, so
     `toBeInstanceOf(Error)` goes red. No unhandled-rejection gap.
  2. The `broadcasts the ended run` test is sound. `broadcasts` is a module-level `let` and the
     runner's `broadcast` callback reads that binding at call time (`flow-runner.test.ts:109`),
     so the mid-test `broadcasts = []` cannot desynchronise it.
  3. `Extract<FlowActionStatus, "completed" | "skipped" | "failed">` matches the real union
     (`shared/src/types/flow.ts:61`) — all three literals are members, none silently dropped.
- Verified independently by Claude:
  - **Mutation check on finding 2:** deleted `this.broadcastUpdate(run)` from `endRun`
    (`flow-runner.ts:407`) and re-ran the file → **22 pass, 1 fail**, the single failure being
    `broadcasts the ended run` (`Expected: "flow:run-updated" / Received: undefined`). Restored
    the line and re-ran → 23 pass, 0 fail. So the round-1 test really is the only thing standing
    between a silent broadcast regression and green tests.
  - Read the `FlowActionStatus` union directly: `"pending" | "running" | "completed" | "skipped"
    | "failed"` — the `Extract` keeps exactly the three terminal outcomes Tasks 5 and 7 need.
  - `bun test packages/backend/src/services/__tests__/` → **54 pass, 0 fail** (4 files).
    `bun run typecheck` → all four packages exit 0. `bun run lint` → clean. `git status` clean
    apart from this handoff.
- Non-finding worth carrying forward (reviewer's own note, not a defect): `Extract` fails open —
  if a literal is ever removed from `FlowActionStatus`, `Extract` silently drops it instead of
  erroring. Harmless today; only matters if that union is ever narrowed.

### Task 3 — implementation (2026-08-13)

- Base commit `f2fdb9d`; implementation commit `7d0cc45`.
- Wrapped nine public mutators in `withOwnerLock`, bodies kept verbatim: `handleActionComplete`,
  `skipAction`, `jumpToAction`, `pauseFlow`, `resumeFlow`, `stopFlow`, `handleSessionExit`,
  `saveArtifact`, `failFlowByIds`. `startFlow` already locked and was left alone. No private
  helper was locked, so there is no re-entrancy path.
- `handleSessionExit` keeps its `sessionFlowMap` lookup **outside** the lock — it is what
  supplies the owner key. Added a comment on `withOwnerLock` recording the non-re-entrancy rule
  so a future edit does not lock a private helper.
- Step 1 test results were **asymmetric**, worth knowing before the review:
  - `concurrent action completions advance the run only once` was genuinely **red** on
    `f2fdb9d` (`Expected length: 2 / Received length: 3` — the duplicate advance spawned a
    third session) and green after.
  - `a session exit racing a completion does not overwrite the advanced run` was **already
    green** on unlocked code. The interleaving happens to land `handleActionComplete`'s save
    last, so the clobber it is meant to catch is invisible from the final state. It is kept as
    a regression guard, not treated as proof the lock works — the first test is that proof.
- Checked every production caller of the nine methods (`index.ts:221`,
  `api/routes/flow-routes.ts`, `api/routes/task-routes.ts`, `handlers/flow.ts`,
  `handlers/task.ts`): all are top-level entry points, none is invoked from inside another
  runner method, so no caller can nest the lock. The one callback that re-enters the runner
  (`onSessionExited` → `handleSessionExit`, `index.ts:220-222`) is fire-and-forget `void`,
  so even a synchronous PTY exit queues behind the lock instead of deadlocking.
- Validation: `bun test packages/backend/src/services/__tests__/` → **56 pass, 0 fail**
  (4 files, up from 54 by the two new tests). Full `bun test packages/backend` →
  **533 pass, 0 fail** (54 files). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on both changed files → clean.
  No test run hung, which is the signal that no private helper got locked.

### Task 3 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `f2fdb9d..8719e5b`,
  `packages/` only — plan/handoff doc changes excluded from the diff).
- Result: **clear — zero substantiated findings.** No fix commit; HEAD stays `8719e5b` plus
  this handoff update.
- The review was pointed at the four things this task could plausibly have broken. Each was
  independently re-verified by Claude rather than taken on the reviewer's word:

  1. **Are the nine bodies verbatim?** (the headline risk of a whole-body re-indent).
     Reviewer's normalized extraction matched seven exactly, with `jumpToAction` / `resumeFlow`
     differing only by prettier reflow and `handleSessionExit` by the deliberate
     outside-the-lock mapping lookup. Claude proved it more strongly: stripped **all**
     whitespace and line comments from `flow-runner.ts` at `f2fdb9d` and at HEAD and ran a
     character-level `difflib` opcode diff. Every opcode is `insert`; there is **not one
     `delete` or `replace`**. The inserted text is exactly nine
     `returnthis.withOwnerLock(ownerId,async()=>{` openers, nine `);}` closers, and one
     trailing comma from prettier's multi-line reflow of the `resumeFlow` call. That is
     mechanical proof the bodies are untouched, not a spot check.
  2. **Nested-lock / deadlock.** Confirmed there are exactly ten `this.withOwnerLock(` sites
     and **zero** internal calls from any method to a locked public method — so no private
     helper can nest. All 22 production call sites (`index.ts:221`, `flow-routes.ts`,
     `task-routes.ts:363,448`, `handlers/flow.ts`, `handlers/task.ts:52`) are top-level entry
     points. The one callback that re-enters the runner, `onSessionExited` →
     `handleSessionExit` (`index.ts:220-222`), is fire-and-forget `void`, so a locked method
     never awaits it — a re-entrant exit queues rather than deadlocks.
  3. **Lock released on the throwing path.** `saveArtifact` and `jumpToAction` throw from
     inside the lock. `withOwnerLock` (`flow-runner.ts:64-81`) releases in `finally` and
     deletes the map entry only when the tail is still its own `queued`. `queued` is built
     from `previous.catch(() => undefined).then(() => gate)` and `gate` only ever resolves,
     so `queued` can never reject — a throwing body cannot poison later acquirers for that
     owner.
  4. **Test power — verified by mutation, not by reading.** Turned `withOwnerLock` into a
     passthrough (`if (ownerId) return await fn();`) and re-ran the file: **24 pass, 1 fail**.
     The single failure is `concurrent action completions advance the run only once`
     (`Expected length: 2 / Received length: 3` — the duplicate advance spawns a third
     session). Restored and re-ran → 25 pass, 0 fail. This confirms the asymmetry recorded at
     implementation time: test 1 is the real lock regression test, test 2 would not catch a
     removed lock. Reviewer reached the same conclusion independently.
- One **speculative concern**, raised as such and not a defect: `stopFlow` / `pauseFlow` can be
  *delayed* behind a held owner lock, notably while a launch awaits `spawnSession`. Both Claude
  and the reviewer traced the gate and found it FIFO — each caller chains on the current tail,
  later waiters cannot jump ahead, and `stopFlow` re-reads the run from the store *after*
  acquiring the lock, so it acts on post-launch state rather than stale state. Delay, not
  starvation, and bounded by one action launch. Carried forward as context for Task 5 (which
  makes Stop the normal ending of a loop) — not something to fix here.
- Validation at `8719e5b`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → 25 pass / 0 fail; `bun test packages/backend/src/services/__tests__/` → **56 pass, 0 fail**
  (4 files); `bun run typecheck` → all four packages exit 0; `bun run lint` → clean.
  `git status` clean after the mutation experiment was reverted (verified by `git diff --stat`
  returning empty before continuing).

### Task 4 — implementation (2026-08-13)

- Base commit `2e73030`; implementation commit `934d25d`.
- Added the `loopFlow` fixture beside `testFlow` **and** seeded it in `beforeEach` next to
  `saveFlow(testFlow)` — the mistake the previous session flagged was avoided.
- Three production changes, all as the plan specifies:
  1. `startFlow` snapshots `loop: flow.loop ? true : undefined` and `iteration: flow.loop ? 1 :
     undefined` onto the run. Nothing later reads the live definition for looping.
  2. `advanceOrComplete` gains one branch at the end-of-list check: `if (run.loop) { await
     this.startNextIteration(run); return; }`. The finite path below it is untouched.
  3. New private `startNextIteration` — resets every action, bumps `iteration`, sets index 0
     running, saves, broadcasts, then relaunches action 0 via
     `launchPersistedActionWithRecovery`. It takes **no** lock (it runs inside the one
     `handleActionComplete` already holds, via the unlocked `advanceOrComplete`); a comment on
     the method records that so a later edit does not deadlock the run.
  4. `getArtifacts` copies before sorting on the untyped branch (`[...run.artifacts]`), so it no
     longer reorders the caller's array in place.
- Red-then-green signal, recorded per the plan's warning about the two green-before-and-after
  guards: on `2e73030` the file ran **26 pass / 7 fail** — the seven reds being `wraps to
  iteration 2`, `carries inputs and artifacts`, `an artifact re-saved in iteration 2`,
  `editing loop off`, `a launch failure on the first action of a new iteration`, `a step failing
  mid-loop`, and `getArtifacts does not reorder`. `a non-looped flow still completes after its
  last action` passed before and after, as designed. After the change: **33 pass / 0 fail**.
- Validation at `934d25d`: `bun test packages/backend/src/services/__tests__/` → **64 pass,
  0 fail** (4 files, up from 56 by the eight new tests). `bun test packages/backend` →
  **541 pass, 0 fail** (54 files, up from 533). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on both changed files → clean.
  `git status` clean apart from this handoff.

### Task 4 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `2e73030..297398e`,
  `packages/` only — plan/handoff doc changes excluded from the diff, so the code scope is
  exactly implementation commit `934d25d`).
- Result: **one substantiated finding, fixed in `81ea944`.** Plus one minor finding that was
  the same defect seen from the test side; the same commit closes both.
- **Finding (major, accepted and fixed) — `resumeFlow` deleted artifacts the wrap had just
  carried over** (`flow-runner.ts:266-269`). `resumeFlow` unconditionally purges every artifact
  belonging to the action it is about to retry. That is right for a finite run — the action
  never finished, so anything it saved is partial. It is wrong for a looped run at the start of
  a new iteration: the entry that action owns holds a *completed* value from the previous
  iteration, which `startNextIteration` deliberately preserved and which the retried action may
  be about to read (agents are told about `taskflow-cli artifact get <type>` in every flow
  system prompt, so reading the last iteration's output is a first-class loop pattern).
  - Verified by a failing test before touching production code:
    `looping > resuming a wrapped iteration keeps the artifact carried from the previous one`.
    It saves a `plan` artifact in iteration 1, wraps, forces the wrap's relaunch to fail (run
    paused at iteration 2 / action 0, artifact still attached — asserted mid-test), then
    resumes. On `297398e` it went **red**: `Expected length: 1 / Received length: 0` at the
    post-resume artifact assertion. Green after the fix.
  - Fix: the purge is now skipped when `run.loop`. Two lines plus a comment; no other resume
    behaviour changed.
  - Scoped by a companion guard in the `resumeFlow` describe,
    `drops the retried action's artifacts on a non-looped run`, which pins that a finite run
    still purges. It was green before the fix and after, which is what makes it a guard.
- **Finding (minor, accepted) — the launch-failure test could not have caught the above.** True:
  it asserted only the paused state and never resumed. Closed by the new test rather than by
  extending the old one, so the paused-state assertions stay a separate, single-purpose test.
- Four focus areas came back **clear**, each re-checked by Claude rather than taken on the
  reviewer's word:
  1. **Wrap coherence.** `FlowActionState` has exactly `actionEntryId`, `status`, `sessionId`,
     `startedAt`, `completedAt` (`shared/src/types/flow.ts:63`); `resetActionState`
     (`flow-runner.ts:608`) clears all four mutable fields, so no wrapped step is left both
     fresh and finished, and no dead `sessionId` survives the wrap.
  2. **Lock discipline.** `startNextIteration` is reachable only via `advanceOrComplete`, whose
     three callers (`handleActionComplete`, `skipAction`, `handleSessionExit`) all hold the
     owner lock; nothing on its transitive launch path re-acquires it.
  3. **Launch failure across the wrap.** The immediate state is coherent — iteration bumped,
     action 0 failed, run paused — and the error propagates to `handleActionComplete`'s only
     production caller (`flow-routes.ts:57`), which catches it and returns 500. Same shape as
     the pre-existing finite-flow path. The *follow-up* resume was the defect above.
  4. **`getArtifacts` copy.** Both production callers are the artifact GET routes
     (`flow-routes.ts:131` and `:137`); each loads a fresh run, reads, and never persists it, so
     nothing depended on the old in-place sort. The WS path returns raw runs and the UI reads
     `run.artifacts` directly — neither goes through the helper.
- Validation at `81ea944`: `bun test packages/backend/src/services/__tests__/` → **66 pass,
  0 fail** (4 files, up from 64 by the two new tests). `bun test packages/backend` →
  **543 pass, 0 fail** (54 files, up from 541). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on both changed files → clean.
  `git status` clean apart from this handoff.

### Task 4 — review round 2 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `297398e..7b0b909`,
  `packages/` only — that range is exactly the round-1 fix commit `81ea944`).
- Result: **one substantiated major finding, fixed in `7e82f63`.** The fix **reverses** the
  round-1 decision recorded below (the `iteration`-field alternative was rejected there; it is
  now implemented, because round 2 produced the reachable harm that decision was waiting on).
- **Finding (major, accepted and fixed) — round 1's blanket exemption let a *failed* attempt's
  partial artifact be read as if it were finished** (`flow-runner.ts:266`). Round 1 skipped the
  `resumeFlow` purge for the whole run whenever `run.loop` was true. That protected the carried
  value, but it also protected whatever the *current, failed* attempt had saved.
  - Reproduced by Claude as a failing test before any production change:
    `looping > resuming drops an artifact the current iteration's failed attempt saved`.
    Sequence: iteration 1 action 0 saves `plan` = "good"; wrap to iteration 2; iteration 2's
    action 0 saves `plan` = "partial" (which **replaces** the good value — `saveArtifact` dedupes
    on (`actionEntryId`, `type`), `flow-runner.ts:370`) and then exits 1, pausing the run; resume;
    the retry completes without re-saving `plan`; action 1 reads the partial.
    On `7b0b909` it was **red** — `Received: [{ text: "partial plan from the failed attempt" }]`
    against `Expected: []`. Green after the fix.
  - Note what the fix does *not* do: the good iteration-1 value is already gone by then, destroyed
    by `saveArtifact`'s dedupe at the moment the partial was written. That loss is independent of
    this task. What round 1 changed, and what this fixes, is the marginal step from
    "action 1 reads nothing" to "action 1 reads a partial as if it were fresh".
- **Fix — artifacts now carry the iteration that produced them.**
  1. `FlowArtifact` gains `iteration?: number` (`shared/src/types/flow.ts:72`). Additive and
     optional; undefined on every non-looped run and on every artifact written before this commit.
  2. `saveArtifact` stamps `iteration: run.iteration` at save time. Its parameter type is now
     `Omit<FlowArtifact, "actionEntryId" | "iteration" | "createdAt">`, so no caller can forge it.
  3. `resumeFlow` purges the retried entry's artifacts unless the run is looped *and* the artifact
     is stamped with an earlier iteration. One filter, no `if (!run.loop)` branch.
- Verified by mutation, not by reading:
  - Guard inverted to `if (run.loop)` on round-1 code → **both** round-1 tests red
    (`drops the retried action's artifacts on a non-looped run` and `resuming a wrapped iteration
    keeps the artifact carried from the previous one`). Each pins its own direction.
  - Purge widened to all runs on round-1 code → only the looped test red, as designed (the finite
    one is a deliberate green-before-and-after guard).
  - Iteration stamp neutered (`iteration: undefined` in `saveArtifact`) at HEAD → **35 pass,
    1 fail**, the failure being the new test. So the stamp is load-bearing, not decoration.
- Reviewer's other three focus areas came back **clear**, each re-checked by Claude:
  1. **Scoping.** `startFlow` writes `loop: flow.loop ? true : undefined`, so the flag is only
     ever `true` or absent — a finite run cannot accidentally take the looped path. Runs persisted
     before the feature lack the field entirely. The crash-recovery transform
     (`index.ts:242-255`) rewrites only `status` / the in-flight action and saves the same run
     object, so it preserves `loop` and `iteration` in both directions.
  2. **`jumpToAction` left unguarded is coherent** (`flow-runner.ts:222-227`). It clears artifacts
     for the target action and everything after it, which is what an explicit user rewind means;
     it does not produce a state the wrap cannot handle.
  3. **Test power on the round-1 pair** — confirmed by the mutations above.
- One reviewer suggestion **not** taken: a timestamp-based purge (`createdAt` vs the action's
  `startedAt`) as an alternative to the iteration stamp. It ties correctness to millisecond
  resolution, which the plan's own "no throttle" limitation (plan lines 52-58) makes reachable —
  a fast loop can stamp a carried artifact and the next attempt's `startedAt` in the same
  millisecond. The explicit iteration marker has no such tie.
- Validation at `7e82f63`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **36 pass, 0 fail**. `bun test packages/backend` → **544 pass, 0 fail** (54 files, up from 543
  by the one new test). `bun run typecheck` → all four packages exit 0. `bun run lint` → clean.
  `bunx prettier --check` on all three changed files → clean. `git status` clean apart from this
  handoff, and verified clean again after each mutation experiment was reverted.

### Task 4 — review round 3 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `7b0b909..af4469d`,
  `packages/` only — that range is exactly the round-2 fix commit `7e82f63`).
- Result: **one substantiated minor finding, fixed in `1cd22d4`.**
- **Finding (minor, accepted and fixed) — an artifact with no `iteration` stamp was treated as
  carried** (`flow-runner.ts:274`). The round-2 predicate ended in
  `artifact.iteration !== run.iteration`, so an unstamped artifact on a looped run compared
  `undefined !== 2` and was **kept**. That is right for a value carried from an earlier
  iteration and wrong for one the current failed attempt saved — the exact harm round 2 set out
  to remove, surviving through the one input the predicate cannot classify.
  - Reproduced by Claude before any production change, as a permanent regression test:
    `looping > resuming drops an artifact that carries no iteration stamp`. It persists a paused
    looped run at iteration 2 whose action 0 failed, holding one unstamped `plan` artifact, then
    resumes. Red on `af4469d` (`Received: [{ text: "unstamped partial from the failed attempt" }]`
    against `Expected: []`), green after.
  - Fix: keeping an artifact now requires an **explicit earlier stamp** —
    `run.loop === true && currentIteration !== undefined && artifact.iteration !== undefined &&
    artifact.iteration < currentIteration`. `<` rather than `!==` states "earlier" directly
    instead of leaning on inequality; `run.iteration` is hoisted to a local so the narrowing
    survives into the closure without a cast.
- **Reachability, stated plainly, because it governed the decision:** this is *not* reachable
  against real data. Producing an unstamped artifact on a looped run requires a run persisted in
  the window `934d25d..7e82f63` — three commits, all authored today, all validated against
  in-memory mocks. Claude checked the real data dir (`~/.config/taskflow/flow-runs`): **zero
  persisted flow runs, zero containing `loop`**. The feature is unreleased. It was fixed anyway
  because the change provably cannot alter any state this code can produce (`saveArtifact` stamps
  every artifact a looped run creates), so the live blast radius is empty, while it removes an
  implicit semantic — "absent stamp means earlier iteration" — riding accidentally on a
  comparison in a newly-permanent shared field.
- Reviewer's other five focus areas came back **clear**, each re-checked by Claude:
  1. **Only writer.** `run.artifacts.push` appears once (`flow-runner.ts:373`, in `saveArtifact`).
     Every other mutation is initialisation (`startFlow:130`) or a purge (`jumpToAction:225`,
     `resumeFlow:272`). Confirmed by grep across `packages/backend/src`, `packages/shared/src`,
     `packages/ui/src`.
  2. **No stale-iteration write.** `startNextIteration` bumps `run.iteration` *before* relaunching
     action 0, and every runner mutator is serialized by `withOwnerLock`, so a queued
     `saveArtifact` reads the bumped run. A stale session from the previous iteration cannot slip
     one in either: `saveArtifact` rejects on both the `actionEntryId` and `sessionId` guards
     (`flow-runner.ts:354-359`).
  3. **Shared-type back-compat.** `FlowStore` casts parsed JSON with no strict run validation
     (there is no artifact validator at all — grep for `artifact` in `flow-store.ts` returns
     nothing); the HTTP artifact routes pass plain JSON through (`flow-routes.ts:131,139`); **both**
     CLIs `curl`/`api()` the response straight to stdout without parsing
     (`taskflow-cli.sh:531,539`, `taskflow-cli-bin.ts:587,596`), so an extra field is inert;
     `FlowPanel.tsx:256-290` reads only `type`, `path`, `text`, `actionEntryId`, `createdAt`.
  4. **Round 1 not regressed.** `resuming a wrapped iteration keeps the artifact carried from the
     previous one` is green and still pins its direction — see the mutation matrix below.
  5. **`saveArtifact` parameter narrowing is safe.** Its one production caller
     (`flow-routes.ts:103`) passes `{ type, path, text }` and never `iteration`; the route test in
     `tests/api/routes.test.ts` asserts exactly that shape, and is green.
- **Test power verified by mutation, not by reading.** Three mutations of the single predicate,
  each reverted immediately:
  - `return true` (round-1 blanket keep) → **2 fail**: `resuming drops an artifact the current
    iteration's failed attempt saved` and the new unstamped test.
  - `return false` (pre-plan purge-all) → **1 fail**: `resuming a wrapped iteration keeps the
    artifact carried from the previous one`.
  - `return artifact.iteration !== currentIteration` (the exact round-2 predicate) → **1 fail**:
    the new unstamped test, and only it. That is what makes the new test precisely the guard for
    this round's fix rather than a duplicate of the round-2 one.
  Restored between each; `git status` clean and 37 pass / 0 fail confirmed after the last revert.
- Validation at `1cd22d4`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **37 pass, 0 fail**. `bun test packages/backend` → **545 pass, 0 fail** (54 files, up from 544
  by the one new test). `bun run typecheck` → all four packages exit 0. `bun run lint` → clean.
  `bunx prettier --check` on both changed files → clean. `git status` clean apart from this
  handoff.

### Task 4 — review round 4 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `af4469d..HEAD`, `packages/`
  only — that range is exactly the round-3 fix commit `1cd22d4`).
- Result: **clear — zero substantiated defect findings.** Task 4 is now **clear**. One non-blocking
  *coverage* note was raised, verified as real, and closed by a test-only commit (`888f517`); no
  production code changed in this round, so no round 5 is required.
- The four scoped questions all came back clean, each re-checked by Claude rather than taken on the
  reviewer's word:
  1. **Predicate across every combination.** Walked by hand: different action → kept by the first
     branch; finite run → `run.loop !== true` purges unconditionally, so the finite path is
     unchanged; looped with `iteration === undefined` (unreachable — `startFlow` writes `loop` and
     `iteration` together) → purge, the conservative outcome; looped at iteration *n* → unstamped
     purged, earlier stamp kept, current stamp purged, later stamp purged. Every cell lands where
     the comment says it should.
  2. **The `currentIteration` hoist.** `resumeFlow` never assigns `run.iteration`, and the `filter`
     callback runs synchronously inside the same body, so the local cannot drift. The narrowing
     after `currentIteration === undefined` needs no cast and no non-null assertion — confirmed by
     `bun run typecheck` exiting 0 on all four packages.
  3. **`<` versus the `!==` it replaced.** They differ only on a *later*-than-current stamp, which
     this code cannot produce: `saveArtifact` stamps `run.iteration` and `startNextIteration` only
     ever increments. If one appeared via hand-edited state, purging is the safer result.
  4. **Test power / redundancy.** No pair is redundant — round 3's mutation matrix already showed
     each of the four resume/artifact tests pinning its own direction, and the reviewer reached the
     same conclusion independently.
- **Coverage note (verified, then closed).** The reviewer observed that no test pinned the
  *first* line of the predicate — `if (artifact.actionEntryId !== retriedEntryId) return true;` —
  which keeps every other action's artifacts. That line is pre-existing and unchanged by this task,
  and the current code is correct, so it is a coverage gap rather than a defect.
  - Verified by mutation before acting: flipping that line to `return false` (so resume purges
    *every* action's artifacts, not just the retried one) left **all 37 tests green**. A future task
    touching `resumeFlow` — Tasks 5-7 all work in this file — could have silently deleted every
    artifact on a resume with no test objecting.
  - Closed by `888f517`, a **test-only** commit: `resumeFlow > keeps another action's artifacts
    while dropping the retried action's`. It saves a `plan` on action 0, completes it, saves a
    partial `review` on action 1, pauses, resumes, and asserts the `plan` survives while the
    `review` is gone — pinning both directions of the branch in one test.
  - Re-verified by mutation after adding it: same `return false` flip → **37 pass, 1 fail**, the
    single failure being the new test. Restored; 38 pass / 0 fail.
- **Why this did not trigger a round 5.** The plan's loop rule sends a *fix* back for another
  review round. This round produced no production change at all — the commit adds one test whose
  correctness is established by the red/green mutation evidence above, which is exactly the
  "trivial change may skip review" case. Marking Task 4 clear here also follows the round-3 note's
  guidance: three rounds of fixes on twenty lines is enough, and the unreviewed risk now lives in
  Tasks 5-12.
- Validation at `888f517`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **38 pass, 0 fail**. `bun test packages/backend` → **546 pass, 0 fail** (54 files, up from 545
  by the one new test). `bun run typecheck` → all four packages exit 0. `bun run lint` → clean.
  `bunx prettier --check` on the changed file → clean. `git status` clean apart from this handoff,
  and verified clean again after each mutation experiment was reverted.

### Task 5 — implementation (2026-08-13)

- Base commit `4974457`; implementation commit `e9dc752`. The table's earlier `888f517` guess was
  superseded on reconciliation: HEAD at session start was `4974457`, a docs-only commit on top of
  `888f517`. Code state is identical between the two, but `4974457` is the right review base
  because it excludes the handoff prose from the diff.
- One production change, exactly as the plan specifies (`flow-runner.ts:295-315`): `stopFlow` now
  returns early on a terminal run, then branches on `run.loop` to `endRun({ status: "completed",
  runningStepOutcome: "skipped", skipPending: true })`; the non-looped path still falls through to
  `failFlow`.
- Two tests added in `describe("stopFlow — looped runs")`. Both were genuinely **red** on `4974457`
  before the change: `ends a looped run as completed` (`Expected "completed" / Received "failed"`)
  and `stopping an already-ended run writes nothing` (`Expected length 3 / Received length 4`).
- **Test power verified by mutation, one clause at a time**, since the two clauses landed in the
  same commit and a joint red does not prove each test pins its own:
  - Guard line deleted, loop branch kept → **39 pass / 1 fail**, the single failure being
    `stopping an already-ended run writes nothing`. So the guard, not the loop branch, is what
    that test holds.
  - Loop branch deleted, guard kept → **39 pass / 1 fail**, the single failure being `ends a
    looped run as completed`. Neither test is a duplicate of the other.
  - Restored from a pristine copy after each; 40 pass / 0 fail and `git status` clean before
    committing.
- The plan's warning about the guard changing the **non-looped** path was taken seriously: the guard
  makes a finished finite run un-re-stoppable, which it was not before. `FlowRunStatus` is
  `"running" | "paused" | "completed" | "failed"` (`shared/src/types/flow.ts:60`), so the guard only
  rejects the two terminal states — no legitimate stop is refused. The whole file and the whole
  backend suite were run, not just the new tests.
- Followed the handoff's standing note on assertions: the double-stop test asserts on `broadcasts`,
  not on `completedAt` (two `toISOString()` calls land in the same millisecond), and no
  `await expect(...).rejects` / `.resolves` was used, so `bun run lint` stays green.
- Validation at `e9dc752`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts` →
  **40 pass, 0 fail** (up from 38 by the two new tests). `bun test packages/backend` → **548 pass,
  0 fail** (54 files, up from 546). `bun run typecheck` → all four packages exit 0. `bun run lint`
  → clean. `bunx prettier --check` on both changed files → clean. `git status` clean apart from
  this handoff.

### Task 5 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `4974457..a182f5e`,
  `packages/` only — that range is exactly the implementation commit `e9dc752`).
- Result: **one substantiated major finding, fixed in `5f72826`.**
- **Finding (major, accepted and fixed) — a looped run that paused *because its action failed*
  ended as `completed` when stopped** (`flow-runner.ts:303`). The loop branch passed
  `status: "completed"` unconditionally, and `endRun` only rewrites a step whose status is
  `running`, so the failed step survived into a run marked completed. A finite run in exactly
  that situation reports `failed` (`stopFlow` → `failFlow`), so the same user-visible state —
  paused on a failed action, then Stop — reported two different outcomes depending on `loop`.
  The harm is not in the UI (`FlowPanel` only uses `run.status` for `isFlowDone`, which treats
  both terminal states alike) but in `taskflow-cli flow status`, which agents read: a loop that
  died on an error reported success.
  - Reproduced before touching production code, first as a throwaway probe that printed the
    actual state — `BEFORE STOP: paused ["completed","failed"]` →
    `AFTER STOP: completed ["completed","failed"]` — then as the permanent test
    `stopFlow — looped runs > ends a looped run paused on a failed action as failed, not
    completed`. Red on `a182f5e` (`Expected "failed" / Received "completed"`), green after.
  - Fix: `status: currentAction?.status === "failed" ? "failed" : "completed"`. One line plus a
    comment; `runningStepOutcome` and `skipPending` are unchanged.
- **Why only the *current* action is consulted, not "any failed action".** `jumpToAction`
  (`flow-runner.ts:204-216`) converts only `running` / `pending` steps to `skipped` when jumping
  forward — an earlier `failed` step is left as-is while the run carries on. So a run can be
  legitimately healthy with a failed step behind it that the user deliberately jumped past, and
  an "any failed action" rule would turn a later Stop into a spurious failure. Checking
  `run.actions[run.currentActionIndex]` matches what `endRun` itself looks at.
- **The complementary case was checked and is correct as-is:** `pauseFlow`
  (`flow-runner.ts:243-248`) clears the session but leaves the action `running`, so a *manually*
  paused loop still ends `completed`. Pinned by the companion guard
  `ends a manually paused looped run as completed`.
- **Test power verified by mutation:**
  - Fix reverted to unconditional `"completed"` → **41 pass / 1 fail**, the single failure being
    the new failed-action test. The companion guard stayed green, as designed.
  - Ternary inverted (`"failed"` and `"completed"` swapped) → **39 pass / 3 fail**: the new
    failed-action test, the companion guard, and the round-0 `ends a looped run as completed with
    the in-flight step skipped`. So the companion is not vacuous — it holds the paused-but-not-
    failed direction that the round-0 test (which stops a *running* loop) does not reach.
  - Restored after each; `git diff` confirmed the production change is exactly the eight-line
    hunk before committing.
- Reviewer's other three focus areas came back **clear**, each re-checked by Claude rather than
  taken on the reviewer's word:
  1. **Terminal-status guard breaks no legitimate Stop.** The three production callers —
     `flow-routes.ts:360`, `handlers/flow.ts:127`, `FlowPanel.tsx:54` — are all fire-and-forget
     (`{ success: true }` or a relayed route response); none reads the run back or depends on a
     second broadcast. `FlowPanel` renders the Stop button only for `running` / `paused`
     (`FlowPanel.tsx:167`), which is exactly the guard's condition, so the terminal case is not
     reachable from the UI at all.
  2. **`skipPending: true` erases no history.** Per-iteration action history is not represented
     in `FlowActionState` after a wrap — `startNextIteration` resets every step — so marking the
     current iteration's pending steps `skipped` cannot destroy a record that exists. Artifacts
     are the cross-iteration record and are untouched.
  3. **Non-looped path unchanged.** Active finite runs still fall through to `failFlow`; only
     terminal re-stop behaviour changed, which is the guard's stated purpose.
- One reviewer note **not** actioned (not a defect): the double-stop test's
  `expect(closedSessions).toEqual(["session-1"])` would stay green with the guard removed, since
  the first stop already cleared `sessionId` and a second `endRun` would find nothing to close.
  True, and already anticipated — the plan put the real weight on the `broadcasts` assertion, and
  the mutation matrix in the Task 5 implementation entry shows that is the clause doing the work.
  The `closedSessions` line is a harmless no-double-close assertion; removing it would buy
  nothing.
- Validation at `5f72826`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **42 pass, 0 fail** (up from 40 by the two new tests). `bun test packages/backend` →
  **550 pass, 0 fail** (54 files, up from 548). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on both changed files → clean. `git status`
  clean apart from this handoff.

### Task 5 — review round 2 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `a182f5e..HEAD`,
  `packages/` only — that range is exactly the round-1 fix commit `5f72826`: one changed line
  plus a six-line comment in `stopFlow`, and two tests).
- Result: **clear — zero substantiated defect findings.** Task 5 is now **clear.** One
  non-blocking *test-power* note was raised, verified real by mutation, and closed by a
  test-only commit (`d509159`). No production code changed in this round, so no round 3.
- All four scoped questions came back clean, each re-checked by Claude by reading the code
  rather than taken on the reviewer's word:
  1. **Discriminator across every path into `stopFlow`.** Walked all five: running normally →
     `completed`; `pauseFlow` (leaves the action `running`, `flow-runner.ts:243-250`) →
     `completed`; `handleSessionExit`'s failure branch (`:353-360`) → `failed`;
     `markActionLaunchFailed` (`:631-641`, sets the action `failed` and pauses) → `failed`;
     mid-wrap relaunch failure, which routes through that same helper with `actionIndex` 0
     while `startNextIteration` has already set `currentActionIndex` to 0 → `failed`. In every
     launch path `actionIndex === run.currentActionIndex`, so the discriminator sees the action
     that actually failed. Each outcome is the intended one.
  2. **The optional chain hides nothing reachable.** `currentAction` is `undefined` only on an
     out-of-range `currentActionIndex`. Confirmed every writer keeps it in range: `startFlow`
     writes 0, `advanceOrComplete` bounds-checks before assigning `nextIndex`,
     `startNextIteration` resets to 0, and `jumpToAction` validates its target explicitly
     (`flow-runner.ts:188-190`). `assertValidFlowDefinition` also rejects a zero-action flow.
     `completed` is the right fallback for malformed persisted state — there is no failed
     current action to preserve.
  3. **`runningStepOutcome: "skipped"` is inert on the failed path**, as designed: `endRun`
     rewrites the current step only when its status is `running` (`:460`), and the `failed`
     branch is taken precisely when it is already `failed`. `skipPending: true` still marks
     remaining `pending` steps `skipped` on a failed ending, which records unattempted work
     rather than rewriting a failure. Not a misreport.
  4. **No vacuous assertions** in either round-1 test.
- **Test-power note (verified, then closed).** The reviewer observed that both round-1 tests
  would stay green if the discriminator were mutated from "the current action failed" to
  "*any* action in the run failed" — the exact alternative the Decisions list rejects.
  - Verified by mutation before acting: replacing line 314 with
    `run.actions.some((a) => a.status === "failed") ? "failed" : "completed"` left **all 42
    tests green**. So the documented decision had no guard at all.
  - Reachability is real, not theoretical: `jumpToAction` has no run-status guard and its
    forward-skip block rewrites only `running` / `pending` steps (`:207-215`), so a user can
    jump past a failed action on a paused loop and carry on with that `failed` step behind
    them. A later Stop would then report failure for a run the user knowingly moved past.
  - Closed by `d509159`, a **test-only** commit: `stopFlow — looped runs > ends a looped run
    stopped after jumping past a failed action as completed`. Action 0 fails via
    `handleSessionExit`, `jumpToAction(1)` moves past it, Stop → run `completed`, action 0 still
    `failed`, action 1 `skipped`.
  - Re-verified by mutation after adding it: the same any-failed flip → **42 pass, 1 fail**, the
    single failure being the new test (`Expected "completed" / Received "failed"`). Restored
    from a pristine copy; `git status` showed only the test file dirty before committing.
- Validation at `d509159`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **43 pass, 0 fail** (up from 42 by the one new test). `bun test packages/backend` →
  **551 pass, 0 fail** (54 files, up from 550). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on the changed file → clean. `git status`
  clean apart from this handoff.

### Task 6 — implementation (2026-08-13)

- Base commit `a20836b`; implementation commit `02b05b4`. `a20836b` is a docs-only commit carrying
  this handoff, which is exactly the base the standing convention calls for — the review range
  `a20836b..HEAD` then contains only code.
- Two production changes in `flow-runner.ts`, both inside methods Task 3 already wrapped in the
  owner lock; no second lock was added to either:
  1. `handleActionComplete` (`:159-165`): when `run.loop`, clear `currentAction.sessionId` and call
     `this.deps.closeSession(sessionId)` after the existing `sessionFlowMap.delete(sessionId)` and
     before `advanceOrComplete`.
  2. `handleSessionExit`'s shell clean-exit branch (`:354-358`): when `run.loop`, clear
     `currentAction.sessionId` only. No `closeSession` — the PTY exited on its own, which is what
     got the code into that branch.
- **Red/green signal recorded per test**, as the previous session asked, because two of the four
  are green-before-and-after guards by design. On `a20836b` the file ran **45 pass / 2 fail**:
  - RED: `a looped flow closes the completed step's session` (`Expected ["session-1"] /
    Received []`) — the agent path.
  - RED: `a looped shell step leaves no session id behind when it auto-completes`
    (`Expected undefined / Received "session-1"`) — the shell path.
  - GREEN before and after: `a non-looped flow leaves the completed step's session open` and
    `a late exit from a closed session does not disturb the wrapped run`, both as the plan predicts.
  After the change: **47 pass / 0 fail**.
- **Test power verified by mutation, one clause at a time**, since both clauses landed in the same
  commit and a joint red would not prove each test pins its own:
  - Agent-path block deleted, shell clause kept → **46 pass / 1 fail**, the single failure being
    `a looped flow closes the completed step's session`.
  - Shell clause deleted, agent block kept → **46 pass / 1 fail**, the single failure being
    `a looped shell step leaves no session id behind when it auto-completes`. Neither test is a
    duplicate of the other.
  - Agent-path guard widened to every run (`if (run.loop)` → `if (true)`) → **45 pass / 2 fail**:
    the new `a non-looped flow leaves the completed step's session open` guard **and the
    pre-existing** `jumpToAction > restarts the target action and clears later action state when
    jumping backward`. That second failure is independent evidence that scoping the close to
    looped runs is load-bearing rather than stylistic: finite runs really do rely on a completed
    action retaining its `sessionId`, so this could not have been applied unconditionally.
  - Restored from a pristine copy after each mutation; `git diff --stat` confirmed the production
    change is exactly the two hunks (13 inserted lines) before committing.
- Validation at `02b05b4`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts` →
  **47 pass, 0 fail** (up from 43 by the four new tests). `bun test packages/backend` →
  **555 pass, 0 fail** (54 files, up from 551). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on both changed files → clean. `git status` clean
  apart from this handoff.

### Task 6 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `a20836b..HEAD`, `packages/`
  only — that range is exactly implementation commit `02b05b4`).
- Result: **clear — zero substantiated findings.** Task 6 is now **clear.** No fix commit; HEAD
  stays `d202bf6` plus this handoff update. No production code changed in this round, so no round 2.
- All four scoped questions came back clean. Each was re-derived by Claude from the code before
  the reviewer's report arrived, and the two independent analyses agreed on every point:
  1. **Closing before `advanceOrComplete` is safe.** Nothing on the chain
     `advanceOrComplete` → `startNextIteration` → `launchPersistedActionWithRecovery` reads the
     cleared id; `launchAction` only ever *writes* `run.actions[actionIndex].sessionId` for the
     newly spawned session (`flow-runner.ts:579`), and the wrap resets every action first. The
     late exit is inert for a stronger reason than "close is async": `ptyManager.close`
     (`pty-manager.ts:291-300`) deletes the session and kills, and the separate
     `proc.exited.then(cleanup)` (`:251`) still fires afterwards — but `cleanup` → `options.onExit`
     → `handleSessionExit` returns at the mapping check (`flow-runner.ts:335-336`), which
     `handleActionComplete` deleted one line before the close.
  2. **No PTY leaked on any shell path.** The clean-exit branch is reached *because* the PTY
     already exited, so `cleanup` has already deleted it from `ptyManager.sessions` and already
     called `removeSessionFromOwner` (`session-lifecycle.ts:475-497`) — there is nothing left to
     close. A non-zero shell exit does not take that branch at all; it falls to the failure branch,
     which leaves `sessionId` set on an already-dead PTY, so a later Stop's `endRun` closes a
     session that no longer exists — a harmless no-op (`ptyManager.close` returns immediately on a
     missing id), and pre-existing behaviour identical on finite runs.
  3. **Nothing that reads `sessionId` is degraded.** Every backend reader —
     `handleActionComplete:153`, `skipAction:178`, `jumpToAction:202`, `pauseFlow:252`,
     `saveArtifact:397`, `endRun:466` — acts on `run.actions[run.currentActionIndex]`, which on a
     looped run is the freshly launched *running* action, never a completed one. `FlowPanel` gates
     click-through on `action.sessionId` (`FlowPanel.tsx:101,198`), so a looped completed row
     becomes non-clickable — which is the intended consequence of closing the session, not a
     regression.
  4. **Test power adequate**, confirmed by mutation rather than by reading — see below.
- **Correction to the Task 6 implementation entry above, made after re-running its mutation.**
  That entry claims the widening mutation (`if (run.loop)` → `if (true)`) proves "finite runs
  really do rely on a completed action retaining its `sessionId`". Claude re-ran it: the run is
  **45 pass / 2 fail**, as recorded, but the `jumpToAction > restarts the target action and clears
  later action state when jumping backward` failure is **only** the assertion
  `expect(closedSessions).toEqual(["session-2"])` receiving `["session-1", "session-2"]`. It is a
  bookkeeping assertion about *which* sessions got closed, not a functional dependency —
  `jumpToAction` calls `resetActionState`, which clears `sessionId` regardless, so the jump itself
  behaves identically either way. The scoping to looped runs is still right, but for the design
  reason rather than the mechanical one: on a **finite** run a completed agent session is
  deliberately left open so the user can still read what the agent did. Recorded because Task 7
  edits this same method and should not inherit the stronger claim.
- **Mutation matrix run this round** (each reverted from a pristine copy, `git status` verified
  clean between):
  - Agent-path close widened to every run (`if (run.loop)` → `if (true)`) → **45 pass / 2 fail**:
    `a non-looped flow leaves the completed step's session open` and the `jumpToAction` assertion
    described above.
  - Agent path closes but **does not** clear `currentAction.sessionId` → **46 pass / 1 fail**, the
    single failure being `a looped flow closes the completed step's session`. So that test pins
    both halves of the agent-path block, not just the close.
  - Shell branch given a redundant `closeSession(sessionId)` → **47 pass / 0 fail**, i.e. uncaught.
    Deliberately left uncovered: closing an already-exited session is a genuine no-op
    (`ptyManager.close` finds nothing in `this.sessions` and returns), so there is no wrong
    behaviour for a test to pin. This is unlike the Task 4 round 4 and Task 5 round 2 coverage
    notes, where the unguarded mutation produced observably wrong state — hence no test-only commit
    here.
- Validation at `d202bf6` (unchanged from the implementation entry, re-run this round to confirm
  the mutation experiments left nothing behind):
  `bun test packages/backend/src/services/__tests__/flow-runner.test.ts` → **47 pass, 0 fail**.
  `bun test packages/backend` → **555 pass, 0 fail** (54 files). `bun run typecheck` → all four
  packages exit 0. `bun run lint` → clean. `git status` clean apart from this handoff.

### Task 7 — implementation (2026-08-13)

- Base commit `f2a3228`; implementation commit `8ea61ed`. `f2a3228` is the docs-only commit carrying
  this handoff, so the review range `f2a3228..HEAD` contains only code — the standing convention.
- Two production changes, both as the plan specifies:
  1. New public `completeFlow(ownerId, flowId, sessionId)` on `FlowRunner`, placed directly after
     `handleActionComplete` (`flow-runner.ts:171-191`). Takes the owner lock, requires
     `status === "running"`, requires the calling session to own the current action, then delegates
     everything to `endRun({ status: "completed", runningStepOutcome: "completed",
     skipPending: true })`. Nothing is re-implemented inline and no second lock is taken.
  2. `POST /api/flow/complete` registered in `flow-routes.ts`, immediately after
     `/api/flow/action-complete`, with the same body shape and validation.
- The plan's refinement of the spec is implemented as written: **`completeFlow` always closes the
  calling session, looped or not**, because the run is ending. That falls out of delegating to
  `endRun`, which closes unconditionally — no `run.loop` branch was added here.
- **Red/green signal.** Six new runner tests were red on `f2a3228` (`runner.completeFlow is not a
  function`) → 47 pass / 6 fail; green after Step 3 → 53 pass / 0 fail. The five new route tests
  were red before Step 7 (`ApiRouter.handle` returns `null` for an unregistered path, so
  `response?.status` is `undefined`) → 22 pass / 5 fail across the two files; the two new
  `flow-integration.test.ts` cases were **already green** at that point, exactly as the plan
  predicts, since Step 3 had added the method.
- **Test power verified by mutation, one clause at a time.** This round the mutations found a real
  hole and changed a test, so the sequence matters:
  - **`run.status !== "running"` guard deleted → all 53 tests stayed green.** The originally written
    `a paused run cannot be completed by its stale session` was **vacuous**: `pauseFlow`
    (`flow-runner.ts:274-277`) clears `currentAction.sessionId`, so the *ownership* check rejected
    the call and the status guard was never reached. Replaced with
    `a run paused by a failed session exit cannot then be completed`, which uses the one reachable
    state where a non-running run still holds its session id: `handleSessionExit`'s failure branch
    (`:366-374`) sets the action `failed` and the run `paused` but leaves `sessionId` in place. The
    test asserts that intermediate state explicitly before calling `completeFlow`, so it cannot
    silently stop exercising it. Re-run of the same mutation → **52 pass / 1 fail**, that test alone.
  - Ownership check deleted → 1 fail: `a session that does not own the current step cannot end the
    run`.
  - `skipPending: false` → 1 fail: `ends the run immediately and skips the remaining steps`.
  - `runningStepOutcome: "skipped"` → 1 fail: the same test (it asserts both halves).
  - Session close scoped to looped runs only (`if (!run.loop) currentAction.sessionId = undefined;`
    before `endRun`, i.e. the spec's original rule that the plan overrides) → 1 fail:
    `closes the calling session on a non-looped run too`. So the plan's refinement is pinned, not
    merely implemented.
  - Route validation block deleted → 2 fail: `rejects a request with no owner` and
    `rejects a request with no sessionId`.
  - `completeFlow(ownerId, sessionId, flowId)` (argument order swapped) → 2 fail:
    `delegates a valid request to the runner` and `accepts a project owner`. This is what the
    `toHaveBeenCalledWith` assertions buy over a bare `status === 200`.
  - Restored from a pristine copy after every mutation; `git status` / `git diff --stat` verified
    clean before committing.
- Two tests were added beyond the plan's snippets, both cheap: `accepts a project owner` and
  `rejects a request with no sessionId` on the route (the plan tested only the taskId and
  no-owner cases), plus the non-looped close test described above.
- Harness notes confirmed rather than assumed: route tests went into
  `packages/backend/tests/api/routes.test.ts` in their **own** `describe` with a hand-mocked
  `flowRunner` (the top-level block registers `flowRunner: {} as never`), and
  `flow-integration.test.ts` uses `test(...)`, which is what its two new cases use.
- Validation at `8ea61ed`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts` →
  **53 pass, 0 fail** (up from 47 by the six new tests). `bun test packages/backend` → **568 pass,
  0 fail** (54 files, up from 555 by 6 runner + 2 integration + 5 route tests). `bun run typecheck`
  → all four packages exit 0. `bun run lint` → clean. `bunx prettier --check` on all five changed
  files → clean. `git status` clean apart from this handoff.

### Task 7 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `f2a3228..HEAD`, `packages/`
  only — that range is exactly implementation commit `8ea61ed`).
- Result: **zero substantiated defect findings in Task 7's scope.** Task 7 is now **clear.** The
  reviewer's one "major" finding is out of scope (it is Task 8); one test-power note was verified
  real by mutation and closed by a test-only commit (`be060a3`). No production code changed this
  round, so no round 2.
- **Reviewer's only major finding — rejected as out of scope, not as wrong.** It reports that
  `taskflow-cli flow complete` does not exist in either CLI (`taskflow-cli.sh:548` has no
  `complete` arm; `taskflow-cli-bin.ts:606` likewise), so an agent cannot reach the new route
  through the documented path. That is **true and already the plan's next task** — Task 8 is
  literally "CLI — `flow complete` and `--loop` on `flow create`". Task 7's stated scope is the
  runner method and its HTTP route. Recorded here because the finding is a correct statement about
  HEAD and a reader of this document should not re-derive it: **the feature is not reachable by an
  agent until Task 8 lands.** The reviewer had the plan's task boundary in its prompt only
  implicitly, which is the likely cause; future round prompts should state the task boundary
  explicitly.
- All four scoped questions came back **clear**, and each was independently re-derived by Claude
  from the code rather than taken on the reviewer's word:
  1. **`endRun` is right for a successful ending.** `completed` on the calling step plus `skipped`
     on pending steps misreports nothing a consumer reads: `flow status` returns raw run JSON,
     the WS payload is the persisted run, and `FlowPanel` renders `skipped` distinctly. The one
     consequence the reviewer flagged — a skipped step gets no "Re-run" button, which is limited
     to completed/failed actions — is correct behaviour for a run that has ended, not a misreport.
  2. **Neither guard refuses a legitimate complete.** The plan's known pre-existing
     `sessionFlowMap` registration race does **not** apply to `completeFlow`: it reads the
     persisted `currentAction.sessionId` under the owner lock, never the map. Both Claude and the
     reviewer reached this independently.
  3. **A terminal run carrying `loop: true` / `iteration: n` is coherent.** Verified by reading
     both consumers: `startFlow` deletes an existing *terminal* run before creating a fresh one
     (`flow-runner.ts:113-120`), so a stale `loop` flag cannot leak into a restart; the crash
     recovery transform (`index.ts:243-255`) iterates `getAllActiveRuns()` and mutates only runs
     whose status is `running`, so a completed looped run is untouched.
  4. **Route parity is exact.** Diffed the new handler against `/api/flow/action-complete` by
     reading both: identical body parse, identical owner resolution ternary, identical 400
     message and validation expression, identical 500 catch. No divergence hides in the
     duplication.
- **Test-power note (verified by mutation, then closed).** The reviewer observed that nothing
  pinned `skipPending: true` for a **non-looped** run — the `ends the run immediately and skips
  the remaining steps` test builds its three-step fixture by spreading `...loopFlow`, so it is a
  *looped* flow, and the one finite-run test (`closes the calling session on a non-looped run
  too`) asserts only on the session and run status.
  - Verified before acting: mutating `skipPending: true` → `skipPending: run.loop === true` left
    **all 53 tests green**. The resulting state is observably wrong, not merely untested — a
    finite run completed early would persist as `completed` while still carrying `pending` steps,
    which `FlowPanel` renders as pending work on a finished run.
  - Closed by `be060a3`, a **test-only** commit: `completeFlow > marks a non-looped run's
    remaining steps skipped`. It completes `testFlow` at action 0 and asserts action 1 is
    `skipped` with a `completedAt`.
  - Re-verified by mutation after adding it: the same flip → **53 pass, 1 fail**, the single
    failure being the new test. Restored from a pristine copy; `git status` showed only the test
    file dirty before committing.
- **Two further reviewer notes checked and deliberately not actioned:**
  1. *"The completeFlow tests do not pin broadcasting."* True as stated, but there is no uncaught
     mutation behind it. Verified: deleting `this.broadcastUpdate(run)` from `endRun`
     (`flow-runner.ts`) → **52 pass, 1 fail**, the failure being Task 2's
     `stopFlow — non-looped behaviour is preserved > broadcasts the ended run`. `completeFlow`
     has no broadcast of its own to pin; it delegates to the one line that test already guards.
     A duplicate would add no power.
  2. *"Route tests do not cover a non-string `flowId` or the 500 branch."* Both are true and both
     are matched exactly by the pre-existing `/api/flow/action-complete` tests, which this route
     was deliberately built as a parity copy of. The `flowId` clause is the third arm of a single
     `if` whose other two arms are pinned, and the 500 branch is unreachable today because every
     `completeFlow` rejection path is a silent early return. Adding coverage here would pin the
     copy more tightly than the original, which is the wrong place to spend it — if it is worth
     doing it is worth doing for both routes, as a separate cleanup.
- **Design consequence worth carrying into Task 8, not a defect:** a refused `completeFlow` (wrong
  session, or a run that is not `running`) returns `{ success: true }` / 200, exactly as
  `action-complete` does. So `taskflow-cli flow complete` cannot distinguish "the run ended"
  from "your request was ignored" without reading `flow status` afterwards. Mirroring the existing
  route was the right call for this task; Task 9's agent-facing prompt should not tell an agent to
  treat a successful exit code as proof the run ended.
- Validation at `be060a3`: `bun test packages/backend/src/services/__tests__/flow-runner.test.ts`
  → **54 pass, 0 fail** (up from 53 by the one new test). `bun test packages/backend` →
  **569 pass, 0 fail** (54 files, up from 568). `bun run typecheck` → all four packages exit 0.
  `bun run lint` → clean. `bunx prettier --check` on the changed file → clean. `git status` clean
  apart from this handoff, and verified clean again after each mutation experiment was reverted.

### Task 8 — implementation (2026-08-13)

- Base commit `fe5d92d`; implementation commit `6d419d6`. `fe5d92d` is the docs-only commit carrying
  this handoff, so the review range `fe5d92d..HEAD` contains only code — the standing convention.
- **Both CLIs changed**, which is this task's headline risk. `taskflow-cli.sh` (the one that runs on
  macOS/Linux) and `taskflow-cli-bin.ts` were given the same two surfaces, and their request bodies
  were compared side by side rather than assumed equal — see the parity check below.
- Four production changes:
  1. `flow complete` in both CLIs → `POST /api/flow/complete`. Requires `TASKFLOW_FLOW_ID` **and**
     `TASKFLOW_SESSION_ID`; the session guard is the deliberate divergence from the neighbouring
     `action complete`, for the reason the plan gives (an empty session id would post, be refused
     silently by `completeFlow`, and still print `{"success":true}`).
  2. `--loop` / `--no-loop` on `flow create` in both CLIs, tri-state: `true`, `false`, or the key
     omitted entirely. Shell appends the bare JSON literal via `sed` after the `projectId` block —
     no `json_string`, which would produce a string and fail Task 1's boolean validation.
  3. Mutual-exclusion error in both CLIs, which is what keeps them from disagreeing (shell is
     last-flag-wins; `consumeFlags` collapses booleans and loses order, so the TS side cannot
     cheaply be made last-wins).
  4. `action: "string"` added to the TS `create` flag spec. `flow update`'s spec was left untouched,
     per the plan's scope decision.
- **Pre-existing bug fixed and confirmed by direct repro, not by reading.** At base `fe5d92d`,
  `taskflow-cli-bin.ts flow create --name X --action a1` exited **1** with
  `Error: unknown flag "--action"` (checked out that exact file version and ran it). `parseFlags`
  exits on any unknown flag and `create`'s spec omitted `action`, even though the command documents
  it and collects it in a manual loop afterwards. Adding it to the spec fixes the command; the
  manual loop still collects every occurrence, since `parseFlags` does not mutate `subArgs`.
- **Red/green signal, per test.** On `fe5d92d` the file ran **9 pass / 7 fail**. The seven reds were
  the three `flow complete` tests, `sets loop on flow create`, `sets loop false on flow create with
  --no-loop`, and both mutual-exclusion tests. `omits loop from flow create when neither flag is
  given` was **green before and after**, exactly as the plan predicts — it is a regression guard on
  the absent case, not a driver. After the change: **16 pass / 0 fail**.
- **Three tests added beyond the plan's snippets, and the mutation matrix shows all three are
  load-bearing rather than padding:**
  - `refuses flow complete when the session id is missing` — the only guard on the plan's own
    deliberate divergence from `action complete`. Nothing else pinned it.
  - `rejects --no-loop and --loop together regardless of order` — the plan tests one order only.
    The shell implementation has **two** guards, one per `case` branch, and each order exercises a
    *different* one, so a single-order test leaves the other guard entirely unguarded. Proven
    below.
- **Test power verified by mutation** (each applied to a pristine copy of `taskflow-cli.sh` and
  reverted immediately; `git diff --stat` checked between):

  | Mutation | Result |
  |---|---|
  | `--loop` case branch deleted | 3 fail: `sets loop on flow create`, both exclusion tests |
  | `--no-loop` case branch deleted | 3 fail: `sets loop false…`, both exclusion tests |
  | exclusion guard removed from `--loop` branch only | **1 fail: reversed-order test only** |
  | exclusion guard removed from `--no-loop` branch only | **1 fail: forward-order test only** |
  | `sed` append of the loop value deleted | 2 fail: `sets loop on…`, `sets loop false…` |
  | loop value wrapped in `json_string` (the plan's stated hazard) | 2 fail: both payload tests |
  | `TASKFLOW_SESSION_ID` guard deleted | 1 fail: `refuses flow complete when the session id is missing` |

  The two middle rows are the point: each order test pins exactly one guard, so the plan's single
  exclusion test would have left the `--loop` branch's guard uncovered.
- **A first attempt at the `json_string` mutation was malformed and is recorded so the result is not
  misread.** Escaping `\"` inside the `sed` replacement made sed emit a literal tab
  (`"loop":<TAB>rue`) instead of a quoted value, which failed only the `true` test and left the
  `false` one green. Caught by printing the mutated payload by hand rather than trusting the pass
  count. Re-done as `$(json_string "$flow_loop")` — the realistic mistake — it fails both, as it
  should.
- **The TypeScript CLI has no harness in this repo and is not claimed to be test-covered.** It was
  verified three ways: `bun run typecheck` (all four packages exit 0), the plan's unit-level
  `consumeFlags` check (`unknown: []`, `flags.loop === true`, both `--action` values seen), and a
  scratch stub-server harness that ran the real binary as a subprocess across nine scenarios. The
  bodies came back **identical to the shell CLI's**, including key order:
  `{"taskId":"task-1","flowId":"flow-1","sessionId":"session-1"}` for `flow complete`, and
  `…,"projectId":"project-1","loop":true}` / `"loop":false}` / no `loop` key for the three create
  cases. Both exclusion orders exit 1 with the same message; both missing-env cases exit 1 with the
  same messages. Project-owner `flow complete` was checked on **both** CLIs and matches
  (`{"projectId":"p1","flowId":"f1","sessionId":"s1"}`).
  - Note for anyone re-running that harness: `spawnSync` deadlocks against a `Bun.serve` stub in the
    same process (the blocked event loop cannot answer the CLI's own fetch). Use `Bun.spawn`.
- `sh -n` on the modified shell script passes, and `flow bogus` prints the updated usage line, which
  now lists `complete`.
- Docs updated: `flow complete` and the loop note in `taskflow-cli-flow-context-commands.md`;
  `--loop` / `--no-loop` on the `flow create` entries plus two notes in
  `taskflow-cli-flow-commands.md`, documented on **`create` only**. These are text imports rewritten
  to `~/.config/taskflow/agent-skills/` on startup, so editing the repo copies is sufficient.
- **Deviation from the plan's Step 1 snippet, forced by the lint gate.** The plan writes the payload
  assertions as `expect(JSON.parse(...).loop).toBe(true)`, which `@typescript-eslint/no-unsafe-member-access`
  rejects (`JSON.parse` returns `any`). Rewritten as a typed cast to `{ loop?: unknown }` plus a
  member read, matching the `agentOptions` assertion already in that file. No rule disabled; same
  assertion strength — the `json_string` mutation above still fails both tests.
- Validation at `6d419d6`: `bun test packages/backend/tests/services/taskflow-cli.test.ts` →
  **16 pass, 0 fail** (up from 9 by the seven new tests). `bun test packages/backend` → **577 pass,
  0 fail** (54 files, up from 569). `bun run typecheck` → all four packages exit 0. `bun run lint` →
  clean. `bunx prettier --check` on the four formattable changed files → clean (the `.sh` has no
  prettier parser). `git status` clean apart from this handoff.

### Task 8 — review round 1 (2026-08-13)

- Reviewer: gpt-5.5 via `codex exec` (Mode B, prompted review over `fe5d92d..HEAD`, `packages/`
  only — that range is exactly implementation commit `6d419d6`). The brief stated the task boundary
  explicitly (Tasks 9-11 pending, `flow update` out of scope, Task 7's route already reviewed), which
  is what kept this round from repeating Task 7 round 1's out-of-scope "major" finding.
- Result: **clear — zero substantiated findings.** Task 8 is now **clear.** No fix commit and — for
  the first time since Task 6 round 1 — **no test-only commit either**; see the mutation result
  below for why. HEAD stays `afe21de` plus this handoff update. No production code changed in this
  round, so no round 2.
- **Claude ran its own end-to-end parity harness rather than relying on the reviewer's reading or on
  the implementation entry's nine-scenario claim.** This is the task's headline risk and only the
  shell CLI has a test harness, so "the two CLIs agree" needed to be measured, not asserted. The
  harness (`scratchpad/t8r1/parity.ts`) runs **both** real CLIs as subprocesses over the same
  args/env — the shell against the repo's own fake-`curl` capture stub, the TS binary against a
  `Bun.serve` stub — normalises the uuid and timestamp fields, and diffs body, exit code, and path.
  **Eleven cases, ten byte-identical matches**, deliberately weighted to the paths the
  implementation's own check did *not* cover:
  - `--loop` with no `--action` at all → both `"actions":[],…,"loop":true`.
  - flow name containing `}` (`we}ird`) → both correct. This is the `sed "s/}$/…/"` hazard, and it
    is safe for a structural reason worth writing down: the regex is anchored to end-of-line, so the
    *only* `}` it can match is the final one, no matter how many the payload contains.
  - flow name containing `"` and `\` → both `"q\"b\\s"`.
  - description ending in `}` → both correct.
  - flow name containing a **newline** → both `"line1\nline2"`. The multi-line hazard the `sed` would
    have (it substitutes per line, so an embedded newline could insert `"loop"` mid-payload) is
    unreachable because `json_string` escapes newlines to `\n` in awk before the payload is built
    (`taskflow-cli.sh:16-18`). Checked directly rather than assumed.
  - `--loop` passed twice; `--loop` placed *before* `--name`; two `--action` values with `--loop`;
    `--no-loop` with no project id.
- **The one mismatch is pre-existing and correctly left alone:** `flow complete` with **neither**
  `TASKFLOW_TASK_ID` nor `TASKFLOW_PROJECT_ID` set. The shell falls through its `if/else` and posts
  `{"projectId":"",…}` (curl `-sf` then fails the 400, exit 22, no message); the TS `ownerField()`
  exits 1 with a clear error. Both fail closed. The shell's shape is the **established** local
  pattern — `taskflow-cli.sh:298` (`action complete`) and `:474` do exactly the same — so
  "fixing" only the new command would introduce a fresh inconsistency inside the shell script for no
  behavioural gain. Recorded, not changed.
- **Pre-existing `--action` bug fix confirmed by direct repro**, not taken from the implementation
  entry: checked out `taskflow-cli-bin.ts` at `fe5d92d` over the working copy and ran
  `flow create --name X --action a1` → `Error: unknown flag "--action"`. Restored from a pristine
  copy and confirmed `git status` clean. At HEAD the same command posts both actions
  (`"actions":[{…"a1"},{…"a2"}]` in the parity run), so `action: "string"` in the spec and the manual
  `subArgs` collector do not fight — `parseFlags` does not mutate `subArgs` (`cli-flags.ts:9-40`).
- Claude also read `consumeFlags` directly to check two things the reviewer asserted: there is **no**
  `--no-` negation magic (so `flags["no-loop"]` is an ordinary boolean key, not a negation of
  `loop`), and an unknown `--flag` whose name collides with an `Object.prototype` member yields a
  non-`"string"`/`"boolean"` `kind` and lands in `unknown`, so there is no prototype-chain hole.
- **The one mutation that left the whole suite green was chased down and proved to be a no-op** —
  which is why this round earns no test-only commit, unlike Tasks 4, 5, and 7. Flipping the shell's
  project-owner branch (`taskflow-cli.sh:567`) from `"projectId"` to `"taskId"` left **16 pass /
  0 fail**. That looks like an unguarded wrong-owner bug, and it is not: `POST /api/flow/complete`
  collapses both keys into a single `ownerId` string
  (`flow-routes.ts:77-82`, `taskId ?? projectId`), and `flowStore.getFlowRun(ownerId, flowId)` takes
  a plain string with no owner-kind distinction (`flow-store.ts:179`). The same id under either key
  resolves the same run. **There is nothing for a test to assert** — exactly the Task 6 round 1
  distinction. Restored from a pristine copy; `git status` clean before continuing.
- The reviewer's five other focus areas came back clear and each matches what Claude checked
  independently: the `sed` append, `action: "string"`, the session-id guard (no `set -u` interaction;
  the script runs `set -e` only, `taskflow-cli.sh:2`), the docs' scoping of `--loop` to `create`, and
  test non-vacuity.
- **One docs observation, deliberately not changed:** `taskflow-cli-flow-commands.md` tells the agent
  to "turn looping off on an existing flow in the flow editor UI" — a UI that **Task 10 has not built
  yet**. It is a forward reference inside this same plan, the feature is unreleased, and Task 10
  lands the toggle, so it self-resolves. Flagged here so that **if Task 10 is ever dropped or
  rescoped, this doc line must be revisited** — otherwise it becomes a standing lie to every agent
  that reads the skill docs.
- Validation at `afe21de`: `bun test packages/backend/tests/services/taskflow-cli.test.ts` →
  **16 pass, 0 fail**. `bun test packages/backend` → **577 pass, 0 fail** (54 files). `bun run
  typecheck` → all four packages exit 0. `bun run lint` → clean. `git status` clean apart from this
  handoff, and verified clean again after each mutation and file-swap experiment was reverted.

## Decisions taken

- 2026-08-13: `bun run format:check` reports a pre-existing warning on
  `packages/ui/src/lib/fuzzy-match.test.ts`. It is unrelated to this plan and was
  already dirty-formatted at base commit `e72babf`. Left untouched; do not treat it
  as a regression in later tasks. If Task 12 requires a clean `format:check`, fix it
  there as a separate one-line commit.
- 2026-08-13: Task 1 is a type + validation change with real behavioural effect
  (`saveFlow` now rejects a payload it used to accept), so it gets a review round
  rather than being skipped as trivial.
- 2026-08-13: Task 2 gets a review round rather than being skipped as trivial. It is
  labelled a pure refactor, but it rewrites the run-ending path that stop, fail, and
  (soon) `completeFlow` all share, and it deliberately reorders the session teardown.
  That is exactly the kind of change where "no behaviour change" needs checking, not
  asserting.
- 2026-08-13: repaired Task 1's lint breakage inside Task 2's review round rather than
  deferring it to Task 12. Leaving `bun run lint` red for ten more tasks would mean every
  later task cannot tell its own lint errors from the inherited ones. The fix is two test
  assertions in a file this plan already owns, and it is separately committed (`69950b5`)
  so it can be reverted on its own.
- 2026-08-13: deviated from the plan's literal `runningStepOutcome: FlowActionStatus`
  (plan Task 2 step 3) in favour of the narrowed `Extract<...>` union. The plan's own future
  callers only ever pass terminal outcomes, so nothing downstream is blocked, and the
  narrower type removes the footgun round 1 identified.
- 2026-08-13: deviated from the plan's literal Step 1 snippet for `a launch failure on the first
  action of a new iteration pauses the run`. The plan writes it as
  `await expect(...).rejects.toThrow("spawn failed")`, which is exactly the construct that made
  `bun run lint` red after Task 1 (`@typescript-eslint/await-thenable` — bun-types declares those
  matchers as returning `void`). Written instead as
  `const rejection = await runner.handleActionComplete(...).catch((e: unknown) => e)` plus
  `toBeInstanceOf(Error)` / `toHaveProperty("message", ...)`, matching the repair already applied
  to `flow-store.test.ts`. Same assertion strength, no rule disabled, lint stays green.
- 2026-08-13: chose the narrow fix for Task 4 round 1's artifact defect — skip the `resumeFlow`
  purge when `run.loop` — over the reviewer's alternative of adding an `iteration` field to
  `FlowArtifact` and purging only the current iteration's artifacts. The precise variant is
  strictly more correct in one edge case (a looped run whose *failed* attempt saved an artifact
  type the retry does not re-save leaves that partial value behind), but it expands a shared
  type mid-plan for a case that self-heals on the next save. The chosen fix also matches the
  loop's own semantics as the plan states them: within a loop, artifacts persist until they are
  replaced, they are not cleared by lifecycle transitions. Revisit only if Task 12's manual E2E
  shows a stale artifact actually confusing an agent.
- 2026-08-13: **reversed the decision immediately above** in round 2, ahead of Task 12. The
  condition it set — "revisit if a stale artifact is actually read as fresh" — was met by a
  reproducible sequence rather than by a manual E2E, so waiting for Task 12 would have meant
  knowingly shipping the defect through eight more tasks. `FlowArtifact.iteration` is now
  implemented (commit `7e82f63`). Cost was smaller than the round-1 estimate: one optional field
  on an existing shared type, written in one place (`saveArtifact`) and read in one place
  (`resumeFlow`). The field is optional and undefined for every non-looped run, so no persisted
  data or UI path changes — `FlowPanel.tsx:261` renders only `type` and `text`.
- 2026-08-13: fixed round 3's unstamped-artifact finding despite it being **unreachable against
  real data** (zero persisted flow runs exist on this machine, and the loop feature is
  unreleased). Two things made it worth the commit rather than a note: the change provably cannot
  alter any state the code can produce, since `saveArtifact` stamps every artifact a looped run
  creates — so the live blast radius is empty — and it converts an accidental implicit semantic
  ("no stamp means earlier iteration", riding on `undefined !== 2`) into an explicit one on a
  shared field that is now permanent. The alternative reading is equally defensible in isolation:
  a finding with no real-data repro is a robustness note, not a defect. It was not left as one
  because Tasks 8-12 add more readers of this field and an implicit rule is the kind of thing a
  later task inherits without noticing.
- 2026-08-13: chose `artifact.iteration < currentIteration` over merely adding an
  `!== undefined` guard to the round-2 `!==` comparison. Both are identical for well-formed data
  (iteration never decreases), but `<` states "earlier iteration" directly, matching the comment
  above it, instead of making correctness depend on the reader knowing that a *later* stamp is
  unreachable. `run.iteration` is hoisted into `currentIteration` so the `undefined` narrowing
  survives into the filter closure — no cast, no non-null assertion.
- 2026-08-13: closed round 4's coverage note with a **test-only** commit (`888f517`) and marked
  Task 4 clear in the same session, rather than opening a round 5. The note was not a defect — the
  line it concerns (`resumeFlow`'s "keep other actions' artifacts" branch) is pre-existing,
  unchanged by this task, and correct. What made it worth a commit anyway is that a mutation proved
  it entirely unguarded: flipping that branch to purge every action's artifacts left all 37 tests
  green, and Tasks 5-7 all edit this same file. The plan's "a fix sends you back for another round"
  rule is about production changes; a test whose power is demonstrated red-then-green is the
  trivial-change case that may skip review. The opposite call — record it as a follow-up and leave
  the gap open through eight more tasks — was rejected for that reason.
- 2026-08-13: kept `jumpToAction`'s artifact filter unguarded and iteration-blind. A jump is an
  explicit user rewind of the target action *and everything after it*, so clearing those
  artifacts is the intended meaning regardless of iteration. Only `resumeFlow` — a retry of an
  attempt that failed — needed the distinction between "this attempt's partial output" and "a
  completed value carried across the wrap".
- 2026-08-13: recorded Task 5's base commit as `4974457` rather than the `888f517` pre-filled in the
  table. The two are code-identical (`4974457` only carries handoff prose), so nothing about the
  implementation changes; the point is that the review range `4974457..HEAD` contains only code,
  which keeps the reviewer from spending its budget on this document. This is the same reconciliation
  every prior task did implicitly — writing it down so the next session does not re-derive it.
- 2026-08-13: deviated from the plan's literal Task 5 Step 3 snippet, which passes
  `status: "completed"` unconditionally in the loop branch. Round 1 showed that ends a run
  `completed` when it actually stopped on a failed action. This is a sanctioned deviation rather
  than a plan violation: the handoff's own round-1 brief posed exactly this as open question 2
  ("Is `completed` the right ending for a Stop that lands on a *paused* looped run?"), so the
  plan author left the call to the review. The alternative — keep the plan's literal behaviour on
  the grounds that "stopping a loop is its normal ending" — was rejected because it makes the same
  observable situation report two different outcomes depending only on `loop`, and because the
  consumer that matters here is `taskflow-cli flow status`, which agents read to decide what
  happened.
- 2026-08-13: scoped the failure check to `run.actions[run.currentActionIndex]` rather than "any
  failed action in the run". `jumpToAction` deliberately leaves earlier failed steps in place
  while the run continues, so an any-failed rule would report a spurious failure for a run the
  user knowingly jumped past a failure in.
- 2026-08-13: closed Task 5 round 2's test-power note with a **test-only** commit (`d509159`) and
  marked Task 5 clear in the same session, rather than opening a round 3 — the same call, for the
  same reason, as Task 4 round 4. The plan's "a fix sends you back for another round" rule is about
  production changes; this round changed none. What made the note worth a commit rather than a
  shrug is that the missing guard protected an explicit **Decision taken** (current action, not any
  failed action), and a mutation proved that decision could have been silently reversed by a later
  task with all 42 tests green. Tasks 6 and 7 both edit this same method.
- 2026-08-13: Task 5 gets a review round rather than being skipped as trivial. It is eleven lines,
  but they sit on the run-ending path that Stop, fail, and (in Task 7) `completeFlow` all share, and
  the terminal-status guard silently changes behaviour for **finite** runs too — a case no test
  covered before this task. Small diff, wide blast radius.
- 2026-08-13: Task 6 gets a review round rather than being skipped as trivial. Thirteen lines, but
  they change session lifecycle on the hot path of every looped iteration, and the widening mutation
  showed the `run.loop` scoping is the only thing keeping a pre-existing `jumpToAction` behaviour
  intact. That is precisely the "chance of breaking something" case the flow's rule reserves review
  for. (Round 1 corrected the `jumpToAction` half of that reasoning — see the correction in the
  round 1 entry — but the decision to review stands on the session-lifecycle change alone.)
- 2026-08-13: replaced Task 7's `a paused run cannot be completed by its stale session` with
  `a run paused by a failed session exit cannot then be completed` **before committing**, after a
  mutation showed the original was vacuous. Both tests describe "a non-running run must not be
  completed", but only the second reaches the `status !== "running"` guard — `pauseFlow` clears
  `sessionId`, so the first was rejected one line earlier by the ownership check. Recorded because
  the general shape recurs in this file: when two guards can both reject the same call, a test only
  pins the one that fires *first*, and only a mutation reveals which that is.
- 2026-08-13: implemented the plan's spec refinement (plan lines 71-73) literally — `completeFlow`
  closes the calling session on **every** run, not only a looped one — and added a test that goes
  red if a later task scopes it to `run.loop`. The alternative reading (mirror Task 6's looped-only
  rule) was rejected for the plan's stated reason: Task 6's rule exists because a finite run's
  completed session is deliberately left open for the user to read, and that only makes sense while
  the run *continues*. `completeFlow` ends the run, which is the `stopFlow` / `failFlow` case, and
  both of those already close unconditionally via `endRun`.
- 2026-08-13: rejected Task 7 round 1's only major finding — "`taskflow-cli flow complete` is not
  implemented" — as **out of scope rather than wrong**. It is an accurate description of HEAD and
  it is exactly Task 8's content. Accepting it would have meant implementing the next task inside
  this task's review round, which defeats the one-bounded-step-per-session structure and would
  land CLI code with no review round of its own. Recorded in the round entry rather than silently
  dropped, because a reader diffing HEAD against the spec will notice the same gap.
- 2026-08-13: closed Task 7 round 1's test-power note with a **test-only** commit (`be060a3`) and
  marked Task 7 clear in the same session — the same call, for the same reason, as Task 4 round 4
  and Task 5 round 2. The mutation produced observably wrong state (a `completed` run still
  carrying `pending` steps), which is the distinction that earns a commit; contrast Task 6 round
  1, whose only uncovered mutation was a provable no-op and earned none.
- 2026-08-13: did **not** add route tests for a non-string `flowId` or the 500 branch, despite the
  reviewer noting both as gaps. `/api/flow/complete` is a deliberate parity copy of
  `/api/flow/action-complete`, whose tests have exactly the same two gaps. Pinning the copy more
  tightly than the original buys nothing and makes the pair harder to keep in step; if the
  validation is worth exhaustive coverage it should be extracted and covered once, as a separate
  cleanup outside this plan.
- 2026-08-13: Task 8 gets a review round rather than being skipped as trivial. It is the first task
  that changes an **agent-facing** surface — two CLI implementations that must stay byte-identical,
  plus the docs agents read — and it carries a pre-existing bug fix (`action: "string"`) that was
  not in the plan's risk framing. A divergence between the two CLIs would not be caught by any test
  in this repo, since only the shell one has a harness.
- 2026-08-13: added three tests beyond the plan's Task 8 snippets rather than implementing the plan's
  set verbatim. The mutation matrix justifies each: the reversed-order exclusion test is the **only**
  guard on the shell `--loop` branch's mutual-exclusion check (the plan's single order test exercises
  only the `--no-loop` branch's), and the missing-session-id test is the only guard on the plan's own
  deliberate divergence from `action complete`. Adding them cost two `spawnSync` runs.
- 2026-08-13: deviated from the plan's Task 8 assertion style (`JSON.parse(...).loop`) because
  `@typescript-eslint/no-unsafe-member-access` rejects a member read on `any` and `bun run lint`
  went red. Cast to `{ loop?: unknown }` first, matching the `agentOptions` assertion already in that
  file. This is the same class of plan-snippet-versus-lint conflict recorded for Tasks 1 and 4; the
  standing note about `.rejects` / `.resolves` should be read as one instance of a broader rule —
  **the plan's test snippets are not lint-checked, so expect to adapt them.**
- 2026-08-13: verified the TypeScript CLI with a scratch stub-server harness instead of adding a
  second permanent test harness to the repo. Building one properly is a real piece of work (process
  spawning, port allocation, request capture) and it belongs to whoever decides the TS CLI needs
  ongoing coverage — not to a task whose scope is two subcommands. The commit message states plainly
  that the TS CLI is verified by typecheck plus manual invocation rather than by tests, so nobody
  reads the green suite as covering it. **If the TS CLI ever ships as the default on macOS/Linux,
  this gap becomes urgent** — today it does not run there at all.
- 2026-08-13: did **not** fix the two `flow update` bugs the plan documents (shell `awk` extractor
  truncating any flow with actions; TS calling `.find` on `{ flows: [...] }`), and did not add
  `--loop` to `flow update`. Both are out of scope per the plan's scope decision, and both remain
  open. **Carry them as a follow-up** — they are unrelated to looping and each needs its own tests.
- 2026-08-13: closed Task 6 round 1 with **no commit at all** — not even a test-only one — and
  marked the task clear. The only uncovered mutation found this round (a redundant `closeSession`
  on the shell clean-exit branch) is a provable no-op rather than wrong behaviour, so there is
  nothing for a test to assert. This is the distinction that separates it from the Task 4 round 4
  and Task 5 round 2 notes, both of which *did* earn test-only commits because their mutations
  silently produced wrong state.
- 2026-08-13: closed Task 8 round 1 with **no commit at all** and marked the task clear — the Task 6
  round 1 call, not the Task 4/5/7 one. The only mutation that left the suite green (shell
  `flow complete` posting the project id under the `taskId` key) is a **provable no-op**: the route
  collapses both keys into one `ownerId` string and the store keys runs by that string alone, so both
  payloads resolve the same run. A test asserting the key name would pin the shell's internal
  convention, not any behaviour — which is coverage theatre, and the wrong precedent to set in a file
  three more tasks will edit.
- 2026-08-13: did **not** align the shell's `flow complete` owner fallback with the TS
  `ownerField()`'s hard error when neither owner env var is set. The shell's `if/else` (posting
  `"projectId":""`, which the route rejects with 400) is the pattern its two nearest neighbours
  already use (`taskflow-cli.sh:298`, `:474`), both CLIs fail closed, and the case is unreachable
  from a real flow action, which always has an owner. Changing one of three identical blocks would
  make the script *less* consistent. If this is ever worth fixing it is worth fixing for all three,
  as a separate cleanup outside this plan.
- 2026-08-13: left `taskflow-cli-flow-commands.md`'s "turn looping off in the flow editor UI" line
  in place even though Task 10 has not built that toggle yet. It is a forward reference inside this
  plan, not an external promise, and the feature is unreleased so no agent can read it before Task 10
  lands. **Conditional on Task 10 shipping** — recorded in the round entry so that dropping or
  rescoping Task 10 forces a revisit rather than silently leaving agent-facing docs wrong.


## Next step

Next step: **Task 9 — implementation** (plan section "Task 9: Tell the agent it is in a loop").

Record the base commit before touching anything. HEAD at the start of that session will be the
docs-only commit carrying this handoff — use **that** commit as the base, not the code commit under
it, so the review range contains only code. This is the standing convention every task since Task 5
has followed.

Task 9 threads loop context into the agent's **system prompt**: `buildActionPrompt`
(`flow-runner.ts`) gains a `loopIteration?: number` parameter and appends a `## Loop` section when it
is defined; `launchAction` passes `run.loop ? (run.iteration ?? 1) : undefined`. Step 1 also has to
extend the test harness's `spawnSession` stub to capture `systemPrompt`, which it does not record
today — do that first or the new tests cannot assert anything.

Specific to this task, in rough order of risk:

1. **The prompt text is a contract with the agent, and this plan has already established one thing
   it must not say.** A refused `completeFlow` returns 200 `{"success":true}` and
   `taskflow-cli flow complete` exits 0 either way. The prompt must not tell an agent that running
   the command proves the run ended. The plan's Step 3 snippet says "Run `taskflow-cli flow complete`
   to end the whole loop immediately", which is fine as an instruction — do not embellish it into a
   guarantee.
2. **The third test is a green-before-and-after guard**, like Tasks 4 and 6 had: `a non-looped flow's
   prompt does not mention flow complete`. Record its red/green status per test, and do not read its
   passing as evidence the change worked.
3. **Watch the guard's substring.** It asserts `not.toContain("flow complete")` on a **finite** run's
   prompt. The base prompt already contains `taskflow-cli action complete` — check by hand that no
   existing line contains the literal `flow complete` as a substring, or the guard is red before you
   start for a reason unrelated to your change.
4. **Verify by mutation, as every round since Task 2 has.** Deleting the `## Loop` section, and
   separately changing the call site to pass `run.iteration` without the `?? 1` fallback, should each
   fail a specific test. If one of them leaves the file green, the tests are the problem.
5. Docs were already updated in Task 8 (`taskflow-cli-flow-context-commands.md` carries the looped
   `action complete` / `flow complete` note and the artifact-naming advice). Task 9 duplicates that
   guidance **into the system prompt**; keep the two consistent, and do not re-edit the docs unless
   they turn out to disagree with what the prompt now says.

Carry forward, established in earlier rounds and not to be re-derived:

- **A refused complete still returns 200 `{"success":true}`.** See point 1 above — this is now
  directly load-bearing for Task 9's wording.
- **`flow update` is broken in both CLIs**, independently of looping. Not in scope; open follow-up.
- **The TypeScript CLI does not run on macOS/Linux today** — the shell script does. That is what makes
  its missing test harness tolerable.
- **`taskflow-cli-flow-commands.md` promises a flow-editor loop toggle that Task 10 has not built
  yet.** Self-resolves when Task 10 lands; must be revisited if Task 10 is dropped or rescoped.

Standing constraints, all learned the hard way earlier in this plan:

- **Do not use `await expect(...).rejects` / `.resolves`.** `@typescript-eslint/await-thenable`
  rejects them and `bun run lint` goes red. Use `const rejection = await promise.catch((e: unknown) => e)`
  plus `toBeInstanceOf(Error)`.
- **Do not read a member off `JSON.parse(...)` directly** in a test — `no-unsafe-member-access` goes
  red. Cast to a narrow shape first.
- **Do not assert on `completedAt` to detect a duplicate write.** Two `toISOString()` calls across an
  await boundary land in the same millisecond. Assert on `broadcasts`.
- **The plan's test snippets are not lint-checked — expect to adapt them.** Three tasks have hit this.
- **Verify every finding by mutation before fixing it, and every new guard by mutation after adding
  it — then check what the mutation actually produced, not just the pass count.**
- **When two guards can reject the same call, only the first one fires.** Mutate each separately.
- **A green-leaving mutation is not automatically a coverage gap.** Task 8 round 1's was a provable
  no-op. Trace what the mutated code actually does before writing a test against it.
- `withOwnerLock` is **not** re-entrant. `endRun`, `advanceOrComplete`, `startNextIteration`,
  `failFlow`, and the launch helpers must stay unlocked.

Baseline for judging any redness: at `afe21de`,
`bun test packages/backend/src/services/__tests__/flow-runner.test.ts` -> 54 pass / 0 fail,
`bun test packages/backend` -> 577 pass / 0 fail, `bun run typecheck` -> all four packages exit 0,
`bun run lint` -> clean. Anything red belongs to Task 9's own changes.

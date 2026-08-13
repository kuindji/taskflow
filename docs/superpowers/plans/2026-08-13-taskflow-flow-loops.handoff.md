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
| 4 | Snapshot `loop` onto run, wrap around | in-review round 3 | `2e73030` | Impl `934d25d`; round 1 fix `81ea944`; round 2 fix `7e82f63`; round 3 due |
| 5 | Stop completes a looped run | pending | — | |
| 6 | Close session when a looped step completes | pending | — | |
| 7 | `completeFlow` and its route | pending | — | |
| 8 | CLI — `flow complete` and `--loop` on `flow create` | pending | — | |
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
- 2026-08-13: kept `jumpToAction`'s artifact filter unguarded and iteration-blind. A jump is an
  explicit user rewind of the target action *and everything after it*, so clearing those
  artifacts is the intended meaning regardless of iteration. Only `resumeFlow` — a retry of an
  attempt that failed — needed the distinction between "this attempt's partial output" and "a
  completed value carried across the wrap".

## Next step

Next step: Task 4 — review round 3. Round 2 produced a fix commit (`7e82f63`), so the plan's
loop requires another round over that fix before Task 4 can be marked clear.

Run one gpt-5.5 review via the `codex-review` skill over `7b0b909..HEAD`, restricted to
`packages/`. That range is exactly the round-2 fix commit `7e82f63` — re-read HEAD with
`git rev-parse --short HEAD` first, since the commit carrying this handoff update sits on top
of it and must be excluded from the review range's code scope.

This round's fix is larger than round 1's: it touches a **shared type**, so the review should be
pointed wider than "did the branch flip correctly".

1. **Does the `iteration` stamp reach every artifact that needs it?** `saveArtifact` is the only
   writer (`flow-runner.ts:375-381`), stamping `run.iteration`. Check there is no other path that
   pushes onto `run.artifacts`, and no path where an artifact is written while `run.iteration` is
   stale relative to the action that produced it — in particular across `startNextIteration`,
   where the bump and the relaunch are not atomic from the agent's point of view.
2. **Is the new `resumeFlow` filter right in all four combinations?** The one predicate is
   `artifact.actionEntryId !== retriedEntryId || (run.loop === true && artifact.iteration !==
   run.iteration)`. Walk finite/looped × current-iteration/earlier-iteration and confirm each
   lands where intended. Pay attention to `undefined` on both sides: a looped run's artifact
   written before this commit has `iteration === undefined`, and `run.iteration` is `undefined`
   on a finite run. Is either comparison accidentally load-bearing?
3. **Backwards compatibility of the shared-type change.** `FlowArtifact.iteration` is optional
   and additive, and no persisted artifact has it. Confirm nothing validates artifact shape
   strictly (the flow-store validators, the WS payloads, the CLI's JSON handling) such that an
   extra field on the wire breaks a consumer, and that `FlowPanel.tsx:256-266` still renders.
4. **Is the round-1 behaviour still intact?** The carried-artifact case that round 1 fixed must
   not have regressed while being narrowed. `resuming a wrapped iteration keeps the artifact
   carried from the previous one` covers it and is green.
5. **Test power.** Three looping/resume tests now exist. The new one,
   `resuming drops an artifact the current iteration's failed attempt saved`, was verified red on
   `7b0b909` and green after. Flag any test that does not pin what it claims.

Do not re-review the Task 4 implementation itself (`934d25d`) or the round-1 fix (`81ea944`) —
rounds 1 and 2 covered them.

Baseline for judging any redness: at `7e82f63`,
`bun test packages/backend/src/services/__tests__/flow-runner.test.ts` → 36 pass / 0 fail,
`bun test packages/backend` → 544 pass / 0 fail, `bun run typecheck` → all four packages
exit 0, `bun run lint` → clean. Anything red belongs to the review round's own changes.

If round 3 comes back with zero substantiated findings, mark Task 4 **clear** and set the next
step to Task 5 (Stop completes a looped run), whose base commit is whatever HEAD is at that
point.

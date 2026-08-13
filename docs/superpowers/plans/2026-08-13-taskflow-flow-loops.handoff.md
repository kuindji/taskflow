# Flow Loops — Implementation Handoff

Plan: `docs/superpowers/plans/2026-08-13-taskflow-flow-loops.md`

This document is the source of truth for progress. One bounded step per session.

## Status legend

`pending` / `implemented` / `in-review round N` / `clear` / `review-skipped`

## Tasks

| # | Task | Status | Base commit | Notes |
|---|------|--------|-------------|-------|
| 1 | Types and `loop` validation | clear | `e72babf` | Round 1 clean; its tests later broke `bun run lint`, repaired in `69950b5` |
| 2 | Extract `endRun` (pure refactor) | in-review round 1 (fixes applied) | `c505881` | Impl `75534e4`; round 1 fixes `552acf8`; round 2 due |
| 3 | Serialize runner public mutators under owner lock | pending | — | |
| 4 | Snapshot `loop` onto run, wrap around | pending | — | |
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

## Next step

Next step: Task 2 review round 2 — one gpt-5.5 review via the `codex-review` skill over the
round-1 fixes, `4508503..HEAD` (`packages/` only; exclude the handoff doc). That range is
exactly the two fix commits `552acf8` and `69950b5`. Verify any findings independently,
fix the substantiated ones, validate with `bun test packages/backend/src/services/__tests__/`
plus `bun run typecheck` **and `bun run lint`** (the lint gate is green again as of `69950b5`
— keep it that way), and commit. Zero substantiated findings → Task 2 is clear and the next
step is implementing Task 3 (serialize the runner's public mutators under the owner lock).

Notes for that review:
- The delete-before-close reordering inside `endRun` is intentional and specified by the
  plan; round 1 already confirmed it safe against the production PTY wiring.
- The narrowed `runningStepOutcome` type must still admit `"completed"`, `"skipped"` and
  `"failed"` — Tasks 5 and 7 pass the first two.
- Round 1's rejected finding (asserting an unchanged `completedAt`) should stay rejected;
  the timestamp resolution makes it vacuous. See the round-1 notes above for the measurement.

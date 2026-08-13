# Flow Loops — Implementation Handoff

Plan: `docs/superpowers/plans/2026-08-13-taskflow-flow-loops.md`

This document is the source of truth for progress. One bounded step per session.

## Status legend

`pending` / `implemented` / `in-review round N` / `clear` / `review-skipped`

## Tasks

| # | Task | Status | Base commit | Notes |
|---|------|--------|-------------|-------|
| 1 | Types and `loop` validation | implemented | `e72babf` | Needs review round 1 |
| 2 | Extract `endRun` (pure refactor) | pending | — | |
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

_(none yet)_

## Decisions taken

- 2026-08-13: `bun run format:check` reports a pre-existing warning on
  `packages/ui/src/lib/fuzzy-match.test.ts`. It is unrelated to this plan and was
  already dirty-formatted at base commit `e72babf`. Left untouched; do not treat it
  as a regression in later tasks. If Task 12 requires a clean `format:check`, fix it
  there as a separate one-line commit.
- 2026-08-13: Task 1 is a type + validation change with real behavioural effect
  (`saveFlow` now rejects a payload it used to accept), so it gets a review round
  rather than being skipped as trivial.

## Next step

Next step: review round 1 for Task 1 — gpt-5.5 review of `e72babf..HEAD`.

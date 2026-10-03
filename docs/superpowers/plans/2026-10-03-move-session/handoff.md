# Handoff: Move Session Between Owners

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-03-move-session.md`. Spec: `docs/superpowers/specs/2026-10-03-move-session-design.md`. TaskTray: `TSK-3`. Chain protocol: `chain.md`.

## Next step

Implement Section 1: follow `01-store-log-move.md` per `chain.md` → Implementation steps. Plan reviews are closed (round 5: one minor, folded in). First, record the base hash for the final review below.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Types, owner helpers, store move/locks/repair | not started | |
| 2 | Owner registry + per-session queue | not started | |
| 3 | Move API, rollback, entry-point locks, WS/REST | not started | |
| 4 | CLI (sh, binary, docs) | not started | |
| 5 | UI drag | not started | |
| 6 | Links, TUI check, manual, review | not started | |

## Facts for the next section

- Base for the final whole-change review: the last plan/handoff commit before Section 1 starts (the handoff commit right after 135c0ea9). The Section 1 session records its exact hash here.
- Round 5: 1 minor confirmed and folded in (commit 135c0ea9): Section 5 Task 8 Step 4 runs `terminal-wrapped-links.test.ts` instead of an empty glob.
- Review artifacts: `reviews/round-N.md` (Codex reports), `reviews/round-N-triage.md`, `reviews/round-5-prompt.md` (latest round prompt).
- Round 4: all 4 findings confirmed and folded in (commit 8a4e3a04), all in Section 6 Task 10: bare-name links pass the owner, `createSession` releases its pending mark in `finally` (new `session-store.create.test.ts`), `open-file.test.ts` uses `AppSettings`, answers `TASK_LIST` and calls `syncWithTasks` itself, plus a bare-name test on a headless terminal (helper moved to `lib/test-headless-terminal.ts`).
- Round 3: both findings confirmed and folded in (commit 571d4be5). Section 6 Task 10 now threads `SessionOwnerRef` through file links into `openFileInApp` and forwards `targetWorkspaceKey`. Section 1 Task 2 adds a `masterFileOperations` seam with failing-write tests.
- Round 2: 7 confirmed and folded in (commit 4444ed6d), 2 rejected (shutdown create gating, cross-process owner locks). Don't re-litigate those unless a new reason is factually grounded.
- The plan was reviewed by gpt-6.1-sol before execution. See "Plan review log" in the plan index.

## Deviations from the spec

- UI refusals use the existing `alert()` dialog (`@/stores/dialog-store`), not a toast. The app has no toast system.

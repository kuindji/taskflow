# Handoff: Move Session Between Owners

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-03-move-session.md`. Spec: `docs/superpowers/specs/2026-10-03-move-session-design.md`. TaskTray: `TSK-3`. Chain protocol: `chain.md`.

## Next step

Plan review round 4: triage `reviews/round-4.md` per `chain.md` → Review steps. It reports 2 majors (a failed targeted `createSession` leaves `pendingSessionCreates` set and hides later tabs; bare-name file links still pass no owner to `openFileInApp`) and 2 minors (the shared type is `AppSettings`, not `Settings`; the `open-file.test.ts` refetch/resync fixture). All four are in Section 6 Task 10. If round 5 still has a confirmed blocker or major, stop the chain (round cap).

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

- Base for the final whole-change review: the last plan/handoff commit before Section 1 starts. The Section 1 session records its hash here.
- Review artifacts: `reviews/round-N.md` (Codex reports), `reviews/round-N-triage.md`, `reviews/round-4-prompt.md` (latest round prompt; template for the next one).
- Round 3: both findings confirmed and folded in (commit 571d4be5). Section 6 Task 10 now threads `SessionOwnerRef` through file links into `openFileInApp` and forwards `targetWorkspaceKey`. Section 1 Task 2 adds a `masterFileOperations` seam with failing-write tests.
- Round 2: 7 confirmed and folded in (commit 4444ed6d), 2 rejected (shutdown create gating, cross-process owner locks). Don't re-litigate those unless a new reason is factually grounded.
- The plan was reviewed by gpt-6.1-sol before execution. See "Plan review log" in the plan index.

## Deviations from the spec

- UI refusals use the existing `alert()` dialog (`@/stores/dialog-store`), not a toast. The app has no toast system.

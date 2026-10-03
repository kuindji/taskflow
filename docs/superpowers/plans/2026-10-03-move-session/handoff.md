# Handoff: Move Session Between Owners

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-03-move-session.md`. Spec: `docs/superpowers/specs/2026-10-03-move-session-design.md`. TaskTray: `TSK-3`. Chain protocol: `chain.md`.

## Next step

Implement Section 5: follow `05-ui-drag.md` per `chain.md` → Implementation steps.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Types, owner helpers, store move/locks/repair | done | bf861fd2, 6cab0a3f, 345cc1f5 |
| 2 | Owner registry + per-session queue | done | 6d0c97dc |
| 3 | Move API, rollback, entry-point locks, WS/REST | done | f1c5a1dc, 323cc813, e33ccb39, 6a8b87ab |
| 4 | CLI (sh, binary, docs) | done | fcf2bc72, acb4f815 |
| 5 | UI drag | not started | |
| 6 | Links, TUI check, manual, review | not started | |

## Facts for the next section

- Base for the final whole-change review: `f07f23e6` (diff `f07f23e6..HEAD`).
- Section 1 produced: `SessionOwnerRef`, `SessionMovePayload`, `MSG.SESSION_MOVE` (shared); `services/session-owner.ts` (`normalizeOwner`, `ownerIdOf`, `ownerKey`, `sameOwner`); `services/keyed-queue.ts` (`KeyedQueue.run/drain`); `TaskStore.moveSessionHistory`, `withOwnerLocks`, `repairMovedSessions` (called in `index.ts` before reconcile), optional `masterFileOperations` constructor arg. `SessionHistoryPayload` now `extends SessionOwnerRef` (same fields).
- Section 2 produced, inside `createSessionLifecycle` (`session-lifecycle.ts`): `owners` (Map), `sessionQueue` (KeyedQueue), `currentOwnerOf`, `broadcastOwner`, `patchOwnedSessionRef`, declared right after `broadcastProjectUpdate`. In `createSession`: `spawnOwner` and `ownerNow()`, plus the once-only `releaseNativeLaunchLock` wrapper. On the lifecycle object: `readSessionHistory`, `drainSessionOutput`, `closeClientSession`. `SessionOwner` is now `type SessionOwner = SessionOwnerRef`. `tests/handlers/session.test.ts` has a module-level `waitFor` helper (below `FakePtyManager`) for Section 3.
- Section 3 produced: on the lifecycle object, `moveSession(sessionId, target: SessionOwnerRef)` and `getSessionOwner(sessionId)` (a task owner also gets `projectId`; `null` when not registered). WS `MSG.SESSION_MOVE` (payload `SessionMovePayload`) → `{ success: true }`. REST `POST /api/sessions/:sessionId/move`, body `{ taskId? | projectId? | master: true }` → 200 `{ success: true }` / 400 `{ error }` (the move's own message). REST `GET /api/sessions/:sessionId/owner` → 200 `SessionOwnerRef` / 404 `{ error: "Session not found" }`. `SessionRouteLifecycle` is exported from `api/routes/session-routes.ts` and used by `api/routes.ts`. `TaskStore.withTaskCascadeLock` and `withProjectRemovalLock` wrap archive, delete and project removal (WS + REST).
- Section 4 produced: both CLIs look up `GET /api/sessions/$TASKFLOW_SESSION_ID/owner` before dispatch (skipped when `--task`/`--project-id` is given) and `session move --task|--project|--master [--session]`. The sh `attr_request` is now the top-level `api_request` (prints error bodies). Tests: `tests/services/taskflow-cli.test.ts` (fake curl handles `/owner`, `-w`), `tests/services/taskflow-cli-bin-session.test.ts`. Not yet run by hand against a live backend; do that in Section 6's manual check (`sh packages/backend/src/services/taskflow-cli.sh …`).
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`. `await expect(p).rejects.toThrow()` trips eslint `await-thenable`. Convert any such plan snippet.
- Pre-existing, not ours: `packages/backend/src/index.ts` fails `prettier --check` at HEAD before Section 1. `platform.test.ts` "resolveConfigBaseDir … isolated backend" is the known flaky test (passes on rerun).
- `electron/package.json` has an uncommitted version bump by the user. Don't commit it.
- Round 5: 1 minor confirmed and folded in (commit 135c0ea9): Section 5 Task 8 Step 4 runs `terminal-wrapped-links.test.ts` instead of an empty glob.
- Review artifacts: `reviews/round-N.md` (Codex reports), `reviews/round-N-triage.md`, `reviews/round-5-prompt.md` (latest round prompt).
- Round 4: all 4 findings confirmed and folded in (commit 8a4e3a04), all in Section 6 Task 10: bare-name links pass the owner, `createSession` releases its pending mark in `finally` (new `session-store.create.test.ts`), `open-file.test.ts` uses `AppSettings`, answers `TASK_LIST` and calls `syncWithTasks` itself, plus a bare-name test on a headless terminal (helper moved to `lib/test-headless-terminal.ts`).
- Round 3: both findings confirmed and folded in (commit 571d4be5). Section 6 Task 10 now threads `SessionOwnerRef` through file links into `openFileInApp` and forwards `targetWorkspaceKey`. Section 1 Task 2 adds a `masterFileOperations` seam with failing-write tests.
- Round 2: 7 confirmed and folded in (commit 4444ed6d), 2 rejected (shutdown create gating, cross-process owner locks). Don't re-litigate those unless a new reason is factually grounded.
- The plan was reviewed by gpt-6.1-sol before execution. See "Plan review log" in the plan index.

## Deviations from the spec

- Section 4: both CLIs adopt the owner lookup only when the reply names an owner (`taskId`, `projectId` or `master: true`). Otherwise they keep the env values. `internal-agent-skill.test.ts`'s fake curl answers `{}` to everything, and adopting that wiped the task id. Two extra tests pin it.
- Section 3: the plan's `addOwnedSessionRef` / `removeOwnedSessionRef` share an `updateOwnerSessions(owner, change)` helper with the existing `patchOwnedSessionRef` (dedup; still calls `taskStore.updateTask` / `updateProject` live, so the spies work). The refusal test uses `testShell`, not a literal `/bin/sh`. The `lockRequested` helper was added with Task 6, where it's first used (lint).

- Section 1: `SessionHistoryPayload` reuses `SessionOwnerRef` via `extends` (type reuse; same shape).
- Section 1: plan test snippets using `await expect(...).rejects.toThrow(...)` were written with `expectRejects` (lint).
- UI refusals use the existing `alert()` dialog (`@/stores/dialog-store`), not a toast. The app has no toast system.

Round 3 review of an implementation PLAN (not code) in the current repository (Taskflow: Bun/TypeScript monorepo).

Feature: move a LIVE agent session (PTY process) between owners (task / project-level / master workspace) without restarting it or changing its cwd; via `taskflow-cli session move` and by dragging a tab onto the desktop sidebar.

Rounds 1 and 2 (by you) found issues; the plan and spec were revised after each. Read:
1. Spec incl. its final "Amendments" section and its "Round 2" subsection: docs/superpowers/specs/2026-10-03-move-session-design.md
2. Plan index incl. "Global Constraints" (lock order) and "Plan review log": docs/superpowers/plans/2026-10-03-move-session.md
3. All section files in docs/superpowers/plans/2026-10-03-move-session/ (01..06 + handoff.md)
4. Round 2 report: docs/superpowers/plans/2026-10-03-move-session/reviews/round-2.md, and Claude's triage of it: reviews/round-2-triage.md (findings 5 and 6 were rejected with reasons, and finding 1 was downgraded; challenge those only if the stated reason is factually wrong against the code).

Your job:
A. For each round-2 finding Claude confirmed, check that the revised plan actually fixes it against the real code: packages/backend/src/services/session-lifecycle.ts, task-store.ts, native-session-discovery.ts, flow-runner.ts, pty-manager.ts, handlers/session.ts, handlers/task.ts, handlers/project.ts, api/routes/*.ts, index.ts; packages/ui/src/components/AppShell.tsx, components/sidebar/TaskSidebar.tsx, components/panes/terminal/terminal-link-provider.ts, terminal-links.ts, terminal-lifecycle.ts, stores/session-helpers.ts, stores/session-store.ts, hooks/useActiveWorkspace.ts, lib/open-file.ts.
B. Find NEW problems introduced by the round-2 revisions, especially:
   - the new TaskStore.withOwnerLocks (synchronous reservation of all keys via a Map of tail promises): correctness, deadlock freedom, cleanup of the map, failure of `work`;
   - commitMasterSessions (write then assign) and every former persistMasterSessions caller, incl. reconcileAllSessionLists;
   - the release-once native launch lock wrapper: every existing call site of releaseNativeLaunchLock in createSession (spawn failure path, capture failure path, discovery chain), and whether early release breaks what the lock protects (identifying the new native session among concurrent launches);
   - shutdown onExit deregistering on the session queue; interplay with drainSessionOutput and prepareForShutdown;
   - closeClientSession on the session queue: any path where something holding a lock the queue step needs is waiting on that session's queue;
   - the new tests: the lockRequested spy helper (spyOn + mockImplementation on a generic method, interaction with afterEach mock.restore, with `held` calls, with withTaskCascadeLock calling this.withOwnerLocks), the barrier-based native-id test, the shutdown-output test, the Master rollback tests (whether the spied methods are the ones moveQueued actually calls first) — would they compile and pass deterministically against the real code and FakePtyManager in packages/backend/tests/handlers/session.test.ts?
   - sessionWorkspace() and its use in terminal-link-provider.ts; the AppShell drop-zone marker vs. the resolver in Section 5 (elementsFromPoint, overlays, WebkitAppRegion drag).
C. Anything still blocking execution by an implementer who sees one section at a time (names that differ between sections, missing interfaces, wrong line references that would mislead).

Report: numbered findings with severity (blocker/major/minor), plan file + task/step, code file:line evidence, why, concrete fix. Then list the round-2 findings you consider resolved. Be concise; do not restate resolved items in detail. Do not modify files.

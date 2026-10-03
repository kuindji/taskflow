Round 4 review of an implementation PLAN (not code) in the current repository (Taskflow: Bun/TypeScript monorepo).

Feature: move a LIVE agent session (PTY process) between owners (task / project-level / master workspace) without restarting it or changing its cwd; via `taskflow-cli session move` and by dragging a tab onto the desktop sidebar.

Rounds 1-3 (by you) found issues; the plan and spec were revised after each. Read:
1. Spec incl. its final "Amendments" section and its "Round 2" and "Round 3" subsections: docs/superpowers/specs/2026-10-03-move-session-design.md
2. Plan index incl. "Global Constraints" and "Plan review log": docs/superpowers/plans/2026-10-03-move-session.md
3. All section files in docs/superpowers/plans/2026-10-03-move-session/ (01..06 + handoff.md)
4. Round 3 report: docs/superpowers/plans/2026-10-03-move-session/reviews/round-3.md, and Claude's triage: reviews/round-3-triage.md. Earlier rejected findings (round-2 #5, #6) stay rejected unless the stated reason is factually wrong against the code.

Your job:
A. Check that the round-3 fixes hold against the real code:
   - Section 6 Task 10: sessionWorkspace() returning SessionOwnerRef ({ master: true } for Master), handlePathActivation taking `owner?: SessionOwnerRef`, openFileInApp typed with SessionOwnerRef and forwarding workspaceKey as createSession's targetWorkspaceKey. Check every openFileInApp caller (FileExplorer, SearchPanel, EditedFilesList, MarkdownPaneImpl, WikiPanel, EditorPaneImpl) for behaviour changes, and createSession's pendingSessionCreates / addTab / refetchRecords path in packages/ui/src/stores/session-store.ts.
   - The new packages/ui/src/lib/open-file.test.ts: would it compile and pass deterministically using startTestServer (packages/ui/src/lib/test-ws-server.ts), openConnection/setPrimary (lib/connection-registry.ts), the per-backend editor cache (lib/per-backend-cache.ts), the settings store, and run from the repo root with the happy-dom preload? Does the refetchRecords → fetchTasks resync drop the editor tab it just added?
   - Section 1 Task 2: the optional `masterFileOperations?: FileOperations` constructor argument, commitMasterSessions using it, and the "master session writes" tests (rename failing with EIO; assertions after each failed call; reconcile path). Do they fail on today's code and pass after the change? Check writeFileAtomic's fallback (packages/backend/src/services/write-file-atomic.ts), acquireFileMutationLock, withMasterSessionsMutation's reload, and reconcileAllSessionLists.
B. Find NEW problems introduced by the round-3 revisions.
C. Anything still blocking execution by an implementer who sees one section at a time (names that differ between sections, missing interfaces, wrong line references that would mislead).

Report: numbered findings with severity (blocker/major/minor), plan file + task/step, code file:line evidence, why, concrete fix. Then list the round-3 findings you consider resolved. Be concise. Do not modify files.

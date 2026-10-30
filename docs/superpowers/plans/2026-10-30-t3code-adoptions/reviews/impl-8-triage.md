# Section 8 implementation review triage

Review: `impl-8.md` (gpt-6.1-sol, `codex exec review --base b665a16e`). The HTTP finding was listed twice; it is one finding.

1. **Conflicted-file previews fail** (`file-preview.ts`): confirmed. With a real merge conflict, `getFileContentsForDiff` rejected with `path 'initial.txt' is in the index, but not at stage 0`, because `ls-files --stage` lists stages 1–3. Fixed: an index read counts only a stage-0 entry as present, so a conflicted index side is a missing blob (`null`, as before Section 8). Test `a conflicted file still previews its working copy`. e0363a13.
2. **Slow HTTP task deletes lose their reply** (`task-routes.ts`): confirmed. Bun 1.4.2 drops a request idle for 10 s (`curl: (52) Empty reply from server`, `Bun.serve() timed out a request after 10 seconds`); `taskflow-cli task delete --worktree` uses this route. Bun's own `fetch` didn't show it in a test, curl does. Fixed: `server.ts` calls `server.timeout(req, TASK_DELETE_TIMEOUT_MS / 1000)` for `DELETE /api/tasks/:id`. Test `ws/server-timeout.test.ts` (15 s, curl). e0363a13.

Own findings (gate session):

3. **Bulk diffs ran `git status -uall` once per changed file** and diffed a path in both lists twice (`diff()` called `diffFile(repo, path)`, which resolves status again). Fixed: `diff()` resolves every path from its one status and shares one combined-patch promise per path; `getFileContentsForDiff` passes its resolved pair too. Test `bulk diffs read status once and diff a path in both lists once` (red on c24dbf43: 4 status calls). 04f3d6ee.
4. **Awaited cleanup outlasted the 30 s client request timeout** (Sol's stop after Step 6). Fixed before Step 7 by the gate decision in `impl-8-brief-2.md`: `TASK_DELETE_TIMEOUT_MS` (300 s) on UI and TUI deletion; TUI archive delete shows `cleanupError`. c24dbf43.

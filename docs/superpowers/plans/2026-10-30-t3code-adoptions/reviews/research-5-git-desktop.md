## 1. Area summary

Taskflow uses Bun subprocesses for Git/`gh`, task-owned worktrees, and shell initialization in real PTYs. [GitService](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-service.ts)  
Its UI loads selected-file contents into Monaco; file watches already share handles and collapse event floods. [ChangesPane](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/ChangesPane.tsx:216), [recursive-watcher](/Users/kuindji/Projects/taskflow/packages/backend/src/services/recursive-watcher.ts)  
t3code adds bounded Git execution, shared-config locks, platform-specific cleanup, source-control providers, progressive diffs, and explicit updater states. [GitVcsDriverCore](t3code/apps/server/src/vcs/GitVcsDriverCore.ts), [updateMachine](t3code/apps/desktop/src/updates/updateMachine.ts)  
**Yes: several small reliability techniques are worth taking. The larger Effect architecture is unnecessary for Taskflow.**

## 2. Recommendations

1. **Make selected filenames literal Git pathspecs.**  
   t3code wraps review paths in `:(top,literal)` and uses `--literal-pathspecs` when adding enumerated files. See [GitVcsDriverCore.ts](t3code/apps/server/src/vcs/GitVcsDriverCore.ts:3260). Taskflow passes filenames directly after `--` in stage, unstage, restore, and diff commands. [git-service.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-service.ts:395)  
   `--` stops option parsing but leaves wildcard interpretation active. Bracketed route names can therefore match other paths, particularly dangerous during revert. Apply literal handling consistently through one helper. This protects ordinary file actions regardless of the agent CLI. **S; reimplement the technique.**

2. **Port worktree deletion safeguards, especially on Windows.**  
   [worktreeRemoval.ts](t3code/apps/server/src/vcs/worktreeRemoval.ts) validates repository ownership and locks before using removal that unlinks junctions without following their targets. [GitVcsDriverCore.ts](t3code/apps/server/src/vcs/GitVcsDriverCore.ts:4549) also handles already-absent worktrees and leftover links. Taskflow delegates directly to `git worktree remove --force`; cleanup failure then prevents branch deletion and only reaches the log. [git-worktree.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-worktree.ts:24), [task handler](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/task.ts:216)  
   This fits task-owned workspace cleanup. Port the validation alongside the deletion strategy. **M; reimplement and adapt its regression cases.**

3. **Bound Git output and file previews before optimizing rendering.**  
   t3code has subprocess concurrency/output/time limits in [VcsProcess.ts](t3code/apps/server/src/vcs/VcsProcess.ts), plus binary detection and a 1 MiB diff-expansion limit in [GitVcsDriverCore.ts](t3code/apps/server/src/vcs/GitVcsDriverCore.ts:3537). Taskflow’s [git-helpers.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-helpers.ts) buffers complete output without limits; [file.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/file.ts:48) reads entire files as text. Bulk diff generation also launches one process per entry concurrently.  
   Large generated files or changesets can consume backend memory and flood remote connections. Expose oversized/binary states and block saves of incomplete content. Keep long checkouts/hooks exempt from short query deadlines. **M; reimplement policy in Bun, retaining Monaco.**

4. **Adapt the updater’s pure state reducer.**  
   [updateMachine.ts](t3code/apps/desktop/src/updates/updateMachine.ts:202) preserves downloaded updates after installation failure and supports retry; it also preserves readiness across failed checks. Taskflow’s generic updater error handler clears both version fields and reports `idle`. [auto-updater.ts](/Users/kuindji/Projects/taskflow/electron/src/auto-updater.ts:81)  
   Distinguishing check, download, and install failures prevents losing the restart action after a recoverable error. This is independent desktop plumbing. **S–M; copy/adapt the pure reducer and relevant tests with MIT attribution.**

5. **Serialize shared Git configuration writes by common Git directory.**  
   t3code’s [GitVcsDriverCore.ts](t3code/apps/server/src/vcs/GitVcsDriverCore.ts:1093) keys locks by `gitCommonDir` and separates branch creation from lengthy checkout. Taskflow’s [git-worktree.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-worktree.ts:5) has no equivalent coordination.  
   This helps concurrent task launches when branch tracking writes shared configuration. Keep read-only operations concurrent. It coordinates Taskflow’s commands only; agent CLIs remain independent. **M; reimplement the locking pattern without Effect.**

6. **Improve external-editor discovery beyond PATH.**  
   [packages/shared/src/editor.ts](t3code/packages/shared/src/editor.ts:28) searches application bundles, versioned JetBrains installations, Toolbox scripts, and Linux’s `zeditor`; it also avoids confusing OpenZFS’s `zed` with the editor. Taskflow uses `Bun.which` alone in [editor-detector.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/editor-detector.ts) and external launch. [file.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/file.ts:116)  
   Share command resolution between discovery and launching so installed GUI editors work without manually installed CLI shims. This suits editor handoff around PTYs. **S–M; port candidate rules into a shared resolver.**

7. **Add a small GitLab adapter only if users need it.**  
   Reuse the command patterns in [GitLabCli.ts](t3code/packages/source-control-gitlab/src/server/GitLabCli.ts:470) and normalization in [gitLabMergeRequests.ts](t3code/packages/source-control-gitlab/src/server/gitLabMergeRequests.ts). Taskflow’s [git-pr.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-pr.ts) hardcodes `gh`, returns only URL/number, and collapses lookup failures into “no PR.”  
   A create/find/status adapter using `glab` fits Taskflow’s CLI approach. Distinguish unavailable status from absent requests. **M; reimplement a narrow adapter, not the provider framework.**

## 3. Considered and rejected

- **Pierre renderer/worker-pool replacement:** Taskflow already fetches one selected file. No measured rendering bottleneck justifies migration.
- **Watcher replacement:** existing reference counting, batching, ignore filtering, and overflow collapsing already address the useful concerns.
- **Effect service framework, provider-driven reviews, and turn checkpoints:** substantial coupling and port cost; unnecessary for PTY-based workspace tools.
- **Clerk deep-link/bootstrap plumbing:** tied to T3 authentication; no demonstrated Taskflow requirement.

## 4. Uncertainties

Source comparison only. Windows junction behavior, concurrent Git-config contention, packaged update recovery, and performance gains were not reproduced. The read-only Git check confirmed that ordinary pathspecs expand wildcards while literal pathspecs do not. GitLab demand remains unknown.


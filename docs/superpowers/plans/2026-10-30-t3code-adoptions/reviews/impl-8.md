Changes required. Conflicted-file previews now fail, and slow HTTP task deletions can lose their success response and cleanup warning.

Full review comments:

- [P2] Handle unmerged index entries when loading previews — /Users/kuindji/Projects/taskflow/packages/backend/src/services/file-preview.ts:92-99
  During a merge or rebase conflict, `:path` has no stage-0 blob, but `ls-files --stage` returns entries for the conflict stages. This nonempty check therefore rethrows the expected `git show` failure. Consequently, `getFileContentsForDiff()` rejects the entire response, preventing the Changes pane from displaying even the readable working-tree content. Handle unmerged entries explicitly rather than treating them as repository corruption.

- [P2] Extend the HTTP timeout before awaiting worktree cleanup — /Users/kuindji/Projects/taskflow/packages/backend/src/api/routes/task-routes.ts:447-450
  When worktree cleanup takes longer than 10 seconds, this await leaves the HTTP response idle after the task has already been deleted. The production `Bun.serve` configuration in `ws/server.ts` retains Bun's default 10-second idle timeout, so HTTP and CLI callers receive a connection reset instead of the success response and any cleanup warning. Extend or disable the request's server-side timeout alongside the new WebSocket client timeout.

A reproduced recovery failure discards queued resync requests and can leave terminal output stale. The 69 focused tests and UI, TUI, and backend typechecks passed, but do not cover this failure path.

Review comment:

- [P2] Preserve queued resync requests when replay fails — /Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-attachment.ts:160-163
  If another `terminal:resync` arrives during replay, `followUp` is set. But if a new output gap makes that replay fail its final continuity check, `await replace()` rejects before the loop checks `followUp`. The queued recovery is therefore discarded without requesting another snapshot. Reproducing this leaves the terminal buffering with the missing tail undisplayed indefinitely if the output burst has ended. Honor the queued follow-up after a recoverable replacement failure, without retrying indefinitely when no new recovery was requested.

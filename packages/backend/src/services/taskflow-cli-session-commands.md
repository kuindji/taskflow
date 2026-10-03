## Session commands
`taskflow-cli session rename <sessionId> "New Label"` Rename a session tab.
`taskflow-cli session snapshot <sessionId>` Get terminal snapshot of a session.
`taskflow-cli session tail <sessionId>` Get last 100 lines of session output.
`taskflow-cli session tail <sessionId> --lines 50` Get last N lines of session output.
`taskflow-cli session status <sessionId>` Get session status (working, attention, idle).
`taskflow-cli session close` Close/terminate your own process (usually, when you have finished your work).
`taskflow-cli session close <sessionId>` Close/terminate another session.
`taskflow-cli session move --task <taskId>` Move your own session to another task (e.g. one you just created). The process and its working directory stay the same.
`taskflow-cli session move --project <projectId>` Move your own session to a project's level.
`taskflow-cli session move --master` Move your own session to the Master Workspace.
`taskflow-cli session move --task <taskId> --session <sessionId>` Move another session. Only agent sessions can be moved; flow sessions and the remote agent cannot.
After a move, taskflow-cli commands run from inside the session act on its new owner.
`taskflow-cli session input <sessionId> "<message>"` Write to a session's terminal stdin (appends \r by default, simulating Enter).
`taskflow-cli session input <sessionId> "<message>" --raw` Write without appending \r (for control sequences or partial input).
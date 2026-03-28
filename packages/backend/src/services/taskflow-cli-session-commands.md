## Session commands
`taskflow-cli session rename <sessionId> "New Label"` Rename a session tab.
`taskflow-cli session snapshot <sessionId>` Get terminal snapshot of a session.
`taskflow-cli session tail <sessionId>` Get last 100 lines of session output.
`taskflow-cli session tail <sessionId> --lines 50` Get last N lines of session output.
`taskflow-cli session status <sessionId>` Get session status (working, attention, idle).
`taskflow-cli session close` Close/terminate your own process (usually, when you have finished your work).
`taskflow-cli session close <sessionId>` Close/terminate another session.
`taskflow-cli session input <sessionId> "<message>"` Write to a session's terminal stdin (appends \r by default, simulating Enter).
`taskflow-cli session input <sessionId> "<message>" --raw` Write without appending \r (for control sequences or partial input).
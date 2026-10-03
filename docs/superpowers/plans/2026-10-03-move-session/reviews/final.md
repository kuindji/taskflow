Changes required for storage compatibility and moved-session directory navigation. Backend/UI typechecks and 44 focused tests passed; persistence and server-based integration tests were sandbox-blocked.

Full review comments:

- [P2] Preserve File Provider compatibility when moving session logs — /Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:899-902
  On supported macOS File Provider storage that rejects rename with `EACCES` or `EPERM`, moving a session with persisted output fails here. `sessionLogsDir` lives under the configured data directory, but this raw rename bypasses the compatibility fallbacks already used by `write-file-atomic.ts` and log deletion. Add a compatible write-and-clear fallback under both log queues, accounting for any empty source file left behind during boot repair.

- [P2] Handle directory links outside the destination explorer root — /Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-link-provider.ts:127-129
  After moving an agent between owners with different working directories, a directory link resolves against the session's original cwd but still reaches `expandToPathAndLoad`, which immediately returns when the path is outside the destination explorer's `treePath`. Clicking `src/lib`, for example, merely opens the destination explorer without revealing the linked directory. Handle these out-of-root directory links explicitly instead of passing them to an incompatible explorer tree.

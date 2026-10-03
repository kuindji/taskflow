# Final whole-change review triage (gpt-6.1-sol, `codex exec review --base f07f23e6`)

The report lists the directory-link finding twice; two distinct findings.

1. Session log move bypasses File Provider fallbacks (`task-store.ts` raw `rename`) — confirmed. `sessionLogsDir` is under the configurable data dir, and the store already treats EACCES/EPERM on rename/unlink as possible there (`write-file-atomic.ts`). Fixed in 8e77a8ea: copy + `removeFileOrWrite` fallback through the injected `fileOperations`; boot repair ignores empty logs (the leftover). Tests: `task-store.test.ts` "copies the log and clears the source where the storage refuses renames", "ignores the empty log a refused rename leaves at the source" (both red before the fix).
2. Directory links outside the destination explorer root — confirmed. After a move, a directory resolves under the session's original cwd; `expandToPathAndLoad` returns early outside `treePath`, so the click only opened the explorer. Fixed in 2f4c41cb: an out-of-tree directory opens in Finder on this machine and opens nothing on another machine. Tests: `terminal-link-provider.test.ts` (both red before the fix).

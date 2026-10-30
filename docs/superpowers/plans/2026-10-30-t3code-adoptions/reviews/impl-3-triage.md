# Section 3 review triage

Review: `impl-3.md` (gpt-6.1-sol, `codex exec review --base ff0c5c39`). Two distinct findings (the second is listed twice).

1. **P2, rebuild stale live tunnels during recovery: confirmed.** `tunnel-manager.ts` `openTunnel` returns an established tunnel without probing, and the automatic attempt called `attach` directly, so a tunnel left by a failed handshake or bootstrap was reused on every retry and Task 3.5's port refresh never ran. Fixed in d25b1161: manual Retry's close-live-tunnel step is now the shared `closeLiveTunnel(id, current)` in `backend-store.ts`, and the automatic attempt runs it before `attach`. Refresh keeps `keepAttached` during the brief detach because the automatic attempt is already registered. Test: `an automatic retry closes a tunnel left by a failed attempt`.
2. **P2, host-key dialog reopens on every automatic retry: confirmed.** `MachinesMenu` keys dismissals by `TunnelFailure` object, and each attempt patched a new object. Fixed in d25b1161: `patch` keeps the existing failure object when kind, message and stderr are unchanged. Test: `a repeated failure keeps its identity across automatic retries`.

Own check while reading the diff: Sol dropped the comment explaining why the port read's host-key options matter. Restored it above `buildRemoteReadArgs` (d25b1161). Two existing wake tests asserted a synchronous `attachBackend` call; the attempt now awaits `getAttached` first, so they wait for the call.

Verification after the fix: typecheck pass; shared 240/0, TUI 467/0, Electron 78/0; every UI test file touching the backend store passes on its own (backend-store 34/0); scoped ESLint and Prettier clean; `git diff --check` clean.

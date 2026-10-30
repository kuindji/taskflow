# Section 5 review triage

Review: `impl-5.md` (gpt-6.1-sol, `codex exec review --commit e46c0d85`; the base range also held unrelated t3code doc commits). Fixes: 2f853a0f.

- [P1] Secret prefix dropped by the backend host client (reported twice): **confirmed**. `browser-host-client.ts` built `new URL("/tabs/ensure", controlUrl)`, which resolves against the origin; the smoke test's first `open` got 503. The plan's claim that the client concatenates was wrong. Fixed to concatenation; test `keeps the control url's secret path prefix` fails before, passes after. A cross-package integration test isn't possible (Electron `rootDir`); the smoke test covers it.

Own findings (from reading the diff):
- Backend link queued one heartbeat per tick and per flush behind a stuck event, sent back to back once the backend returned: **confirmed**, fixed: a heartbeat still waiting at the queue's tail (not in flight) covers a new flush. Tests: `heartbeats queued behind a stuck event collapse into one`, `a flush while a heartbeat is in flight sends another one after it`.
- `main.ts` ran `onAllAppWindowsClosed` from the main window's `closed` when no window was left, and `window-all-closed` ran it again: **confirmed** (Electron 33 removes the window from `getAllWindows` before `closed`, `WindowList::RemoveWindow` after), fixed: only when windows remain and all are the park window.
- The first heartbeat goes out before `createWindow`, so the main window's target was missing from `appTargetIds` for up to 5 s (also after a reopen): **confirmed**, fixed: flush on `browser-window-created`.
- Dev UA keeps `TaskflowDev(main)/x` (the regex strips `Taskflow/x` only): **rejected** as a defect. Same as the original renderer rule; packaged apps are named `Taskflow`. Noted for Section 8 item 15.

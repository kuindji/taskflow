# Plan review round 1: triage

Codex report: `round-1.md` (gpt-6.1-sol, 1 blocker, 5 major, 6 minor). Each finding checked against the code by the Opus session. Items O1–O4 are the session's own.

| # | Verdict | Severity | Why |
|---|---|---|---|
| 1 | confirmed, downgraded to minor | minor | `writeFile(..., { mode })` keeps an existing file's mode (`index.ts:528`). But both spawners pick a fresh unique path (`electron/src/backend-manager.ts:108`, `tui/src/backend/manager.ts:103`), so only a hand-set `TASKFLOW_PORT_FILE` or the predictable `/tmp/.taskflow-port-<pid>` fallback (`config.ts:178`) is exposed. Fix folded into Section 1: write through a fresh `0600` temp file and rename, reusing `instance-port-file.ts`'s pattern. |
| 2 | confirmed | major | Section 4 puts status `connected:false` before `onUnauthorized`, and `followSocket` (`backend-store.ts:473-476`) patches the row `offline` on that status, so the "only when attached" listener never fires. A live 4401 lands on `rehandshake`'s `SYSTEM_INFO` (`:419`), which Section 4 left without an unauthorized branch. Fixed: one recovery path from `handshake`, used by `attach` and `rehandshake`, guarded by attempt and intent; the `onUnauthorized` listener is dropped. |
| 3 | confirmed | major | `WsClient.onopen` sets connected (`tui/src/net/client.ts:94-100`) before the 4401 close arrives, and `reconcile` turns that into `online` (`machine-session.ts:381-383`), which Section 4 used to reset the gate: an endless refresh loop. Fixed: the gate resets only after a `SYSTEM_INFO` succeeds. |
| 4 | confirmed | major | Section 3 removes the `no-backend` stop (`machine-session.ts:429-433`) per design §2; Section 4 decision 1 put it back. Fixed: only an exhausted token rejection stops; `no-backend` keeps retrying. |
| 5 | confirmed | major | Sequence is issued before parsing (`pty-manager.ts:262`), snapshots report `parsedSequence` (`:431`). A 2000 ms timeout returning the current state looks complete to a client that never saw the tail. `getSnapshot` already returns `snapshot: null` to force history (`:405-416`). Fixed in design §3 and Section 6: timeout answers `snapshot: null`. |
| 6 | confirmed | major | Section 9 awaits a Pi probe with the 60 000 ms deadline inside session creation; both clients time requests out at 30 000 ms (`ui/src/lib/connection.ts:9`, `tui/src/net/client.ts:26`). Fixed: launch normalisation has its own 10 000 ms budget, then falls back to `high`. |
| 7 | confirmed | minor | `open()`/`connect()` resolve on `onopen` (`connection.ts:99-104`, `client.ts:94-100`); the 4401 close comes after. Tests now assert the handshake request rejects, not `open()`. |
| 8 | confirmed | minor | Answering `taskflow` to an auth-only offer selects an unoffered protocol (RFC 6455 §4.1). Fixed: answer `taskflow` only when it was offered; an auth entry without `taskflow` is not a credential. |
| 9 | confirmed | minor | Ran `ssh -G` on OpenSSH 10.5p1 with the overrides: `controlmaster false`, `controlpersist no`, no `controlpath` line. Section 3 test and Section 13 item 8 fixed. |
| 10 | confirmed | minor | `11-editor-discovery.md:74` lists `.cmd` candidates and Step 1 tests Toolbox scripts on Windows, against its own decision (`:103`) and design §8. Fixed. |
| 11 | confirmed | minor | Section 13 item 7 expects 404 for a wrong key; Section 5's gate gives 401. Section 5's Bearer table includes unkeyed `/cdp/tab1/json/version` and `/nothing-here`, which have no handler after Task 5.1. Fixed. |
| 12 | confirmed | minor | `git fetch --depth 1 origin 32ecd717` fails: `fatal: couldn't find remote ref 32ecd717` (run here). Full SHA `32ecd71726fee16f335484c1f95cbce126d461f6` (GitHub API). Fixed in design.md. |
| O1 | confirmed | minor | `buildRemoteReadArgs(record, remotePath)` in Section 3 vs `(record, fileName)` in Section 4. Unified on `fileName`, defined in Section 3. |
| O2 | confirmed | minor | Section 4 Behavior heading and Task 4.4 Step 4 say Settings → Remote / Remote Agent; its decision 2, design and Section 13 say General. Fixed. |
| O3 | confirmed | minor | Section 4 decision 4 (editable saved token through `updateBackend`, `backend-registry.ts:438`) had no files or steps. Added to Tasks 4.1–4.3. |
| O4 | confirmed | minor | Section 6 Task 6.1 says to preserve "the auth work from Sections 1–5"; only 1 and 2 have run then. Wording fixed. |

Result: 5 confirmed majors (2, 3, 4, 5, 6). Next step: plan review round 2.

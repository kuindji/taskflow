# Handoff: adoptions from t3code

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next step needs. Don't add narrative.

Plan: `../2026-10-30-t3code-adoptions.md`. Design: `design.md`. Chain protocol: `chain.md`.

## Next step

Implement Section 5.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan written | done | 44400fd7 |
| — | Plan review round 1 | done: 5 majors and 11 minors confirmed (12 Codex + 4 own) and folded in | 069344e1 |
| — | Plan review round 2 | done: round-1 fixes hold; 2 majors and 5 minors confirmed and folded in | 29122909 |
| — | Plan review round 3 | done: round-2 fixes hold; 0 majors (2 downgraded), 5 minors confirmed and folded in; reviews done | 321591d4 |
| 1 | Auth core | done: Codex review clean, 1 minor triaged (no change); backend 1137/0, shared, TUI, typecheck, Electron build pass | 4bcd5792, cf6b9ad0, f651167e, 6c5641dc |
| 2 | Auth, local clients | done: Codex review clean; Task 2.5 manual checks pass; backend 1148/0, electron 76/0, TUI 453/0, typecheck, Electron build and package pass | 427eefd0, bbc9182e, 50de5869, f9324890 |
| 3 | Remote connectivity | done: Codex review 2 P2 confirmed and fixed (stale tunnel reused by automatic retries; host-key dialog reopened per retry); shared 240/0, TUI 467/0, electron 78/0, every backend-store UI file, typecheck pass | aae85582, a742840d, f2d891c1, e355fe74, d4718675, d25b1161 |
| 4 | Auth, remote clients | done: Codex review clean; 1 own minor fixed (empty `TASKFLOW_TOKEN`); Task 4.4 checked over `ssh localhost` for the TUI/registry path (desktop parts in Section 13); shared 220/0, TUI 489/0, all 82 UI files, electron 78/0, typecheck, Electron build pass | 4b06d3ec, 24f723fa, 1b2454c8, bddbd529, 815b4756 |
| 5 | Auth, browser endpoints, enforcement | not started | |
| 6 | Terminal | done: Codex review 1 P2 confirmed and fixed (queued resync lost on a failed replacement); backend 1160/0, shared 224/0, TUI 464/0, every UI file, typecheck pass | 24d21dc8, 3259c05b, 2660ddc5, 0532144b, 6a3e31bd |
| 7 | Scheduler | not started | |
| 8 | Git safety | not started | |
| 9 | Agent discovery | not started | |
| 10 | Desktop updater | not started | |
| 11 | Editor discovery | not started | |
| 12 | GitLab | not started | |
| 13 | Verification, final review | not started | |

## Facts for the next step

- Base commit before implementation (final-review base): `bf807eaea354b57763e3f994a4a77ddef519152f`.
- Section 1 outputs: `config.apiToken` (lazy, file `api-token-<instanceId>`, `0600`). Spawn handshake `<port>\n<token>\n` via `writePortHandshake`; Electron `startBackend` resolves `{ port, token }` (main.ts keeps only `port` for now); TUI `BackendHandle.token`. Stable `<instanceId>.port` files still hold only the port. `createServer(router, port, apiRouter, cdpGateway, auth: ServerAuth)`; `AUTH_ENFORCED = false` in `ws/auth.ts`. PTY sessions get `TASKFLOW_API_TOKEN`.
- Section 2 outputs: `electron/src/backend-fetch.ts` (`BackendFetch`, `createBackendFetch({ tokenFor, fetchImpl? })`), used by every main-process backend call except `browser-host/backend-link.ts` (Section 5). `get/setBackendToken` in `backend-manager.ts`. `AttachedBackend.token`, `listAttachedBackends(localPort, localToken, remote)`. `AttachResult.token?`. UI: `openConnection(id, origin, token)`, `tokenFor(id)`, `Connection.authToken`; `rawFileUrl` appends `&token=`. TUI: `new WsClient(port, host, token)`, `createLocalClient(port, token)`. CLIs: sh `tf_curl` (token via `-K -` on stdin), TS bin `authHeaders()`.
- Section 2 Task 2.5 results (sandbox config dirs): plain-browser dev UI, Electron dev against Vite, a real PTY session running the sh CLI (`system info`, `devserver list --all`, `--help`) and the TS bin, and the raw image URL in both renderers produced no report-only line. Tokenless controls did log (`ua=curl`, `GET /api/file from ua=Mozilla`). The only remaining line in Electron dev is `PUT /api/browser from ua=node` (browser host, Section 5). Report-only lines are de-duplicated per backend process (`ws/auth.ts` `seen`), so a control must come first or use a fresh backend.
- Section 6 outputs: event `terminal:resync` (`MSG.TERMINAL_RESYNC`, payload `TerminalResyncEvent { sessionIds }`), sent per socket from `websocket.drain` by `ws/terminal-broadcaster.ts`. Output sequences are per session and contiguous (`pty-manager.ts` `lastSequence += 1` per batch). `PtyManager.getSnapshot` is async and waits up to 2000 ms for the parser, else answers `snapshot: null` and logs `snapshot returned before parser caught up`. Web: `terminal-attachment.ts` (`createTerminalAttachment`, `subscribeTerminalRecovery`), `CachedTerminal.attachment`. Readiness hook: `packages/ui/src/lib/backend-ready.ts` `notifyBackendReady/onBackendReady`, published by `backend-store` `attach`/`rehandshake` after bootstrap (same attempt, row still attached) and by the dev renderer on reconnect. Section 3's desktop reconnect must end in `attach`/`rehandshake` (or call `notifyBackendReady`) so terminals resync. TUI: `SessionBridge.attach()` is one coalesced operation; resync event and gaps trigger it.
- Section 3 outputs: `buildRemoteReadArgs(record, fileName)` in `shared/src/remote/tunnel-args.ts` (Section 4's token read passes `` `api-token-${record.instanceId}` ``; keep `isSafeLabel` in the manager). Shared policy `createReconnectPolicy` at subpath `@taskflow/shared/remote/reconnect-policy` (TUI `machine-session.ts` and UI `lib/backend-reconnect.ts`). Store: module-level `reconnects = createBackendReconnects(...)`, `recovering` set, `automaticAttempts` map (owner symbol per attempt), `recoveryState(id)`; an automatic attempt runs `closeLiveTunnel` then `attach`, and succeeds only when the row ends `attached`. `MachineState.state` gains `"reconnecting"`. `attach` restores primary (`setPrimaryBackend(liveId)`) when the store's `primaryId` names it. Refresh now drops connections and recovery for rows that vanish or lose `keepAttached`; `confirmingIds` keeps a row whose uid rename main published before `confirmBackend` resolved. Wake: IPC `remote-resume` (`electron/src/remote-wakeup.ts`, `powerMonitor`), preload `onRemoteResume` (optional in the store for partial bridges), DOM `online`; both call `reconnects.retryNow()`. Section 4's token refresh goes into this attempt lifecycle (the `attempt` dep in `backend-store.ts`), not a new timer.
- Section 4 outputs: `@taskflow/shared` exports `ACCESS_TOKEN_REJECTED`, `LOCAL_ACCESS_TOKEN_REJECTED`, `BackendUnauthorizedError`, `unauthorizedFailure(local)`, `createTokenRefreshGate()` (`utils/backend-auth.ts`). `BackendRecord.token`, `MenuEntry.token?`, failure kind `"unauthorized"`. Registry: `readRemoteToken` dep, `refreshToken(id)`, `attached()` carries `token`, `backends.json` written `0600` via unique `wx` temp. IPC `refresh-backend-token`, `get-local-api-token`. Renderer `Connection` and TUI `WsClient` treat close `4401` as final (no redial; `request()` rejects `BackendUnauthorizedError`); `WsClient.wasUnauthorized()`, `retarget(port, host, token)`. Desktop `recoverUnauthorized` in `backend-store.ts`; `isWanted` and `onBackendDropped` skip `unauthorized` rows. TUI `--token`/`TASKFLOW_TOKEN` (empty = unset). `ConnectionOverlay` now lives in `components/ConnectionOverlay.tsx`.
- Section 4 Task 4.4 (sandbox remote `TASKFLOW_CONFIG_DIR=<scratch>`, dev port 18801, token copied to `~/.config/taskflow/api-token-dev-main` for the ssh read, removed after; client `HOME=<scratch>` so `~/.taskflow/known_hosts` stays untouched): registry attach over `ssh localhost` read the token, `backends.json` `-rw-------` holds it, `connectMachine` and `taskflow-tui --connect --token` logged no report-only line; a tokenless `WsClient` control logged `(credential) WS / from ua=none`. After a rotation the stale token logged one `(credential) WS / from ua=none`; remove and re-add stored the fresh token. A script must call `registry.load()` before using saved records, and confirmed records are keyed by backend uid. Not done here (Section 13 items 5, 6, 9 cover them): desktop attach log lines (`file://`, `ua=node`), Settings → General token row and copy.
- Section 4 open for Section 13: the overlay shows `Connection Failed` and `Return to local` for a remote primary that is still auto-reconnecting (its row carries a failure). See `reviews/impl-4-triage.md`.
- Section 3 deviations: `MachineSection.tsx` exhaustive state map gained `reconnecting` (compile fix).
- Section 6 open for the user (Section 13): a web terminal on a remote backend whose snapshot lacks `mouseEncoding` now stays blank (plan decision: compatibility error, no history fallback; the old web code fell back silently). See `reviews/impl-6-triage.md`.
- Packaged renderer Origin: `file://`; protocol answer: `taskflow` (packaged app with `TASKFLOW_DEV=1`, read via CDP `Network.webSocketWillSendHandshakeRequest`).
- TUI local log check: deferred to Section 13. The TUI connected to its spawned backend and started a session end to end.
- Dev UI token: `VITE_BACKEND_TOKEN=$(cat "$TASKFLOW_CONFIG_DIR/api-token-dev-<branch>")` (or `~/.config/taskflow/...` without `TASKFLOW_CONFIG_DIR`), next to `VITE_BACKEND_PORT`. Remote records still send no token (Section 4). After Section 5, a remote backend also needs `TASKFLOW_UI_ORIGINS` set for a dev renderer to attach to it.
- Driving the dev or packaged app without stealing focus: launch the packaged app with `open -g -n --env ...`. Both use userData `~/.config/taskflow-dev-main`, and its `DevToolsActivePort` gives the CDP port. In Electron dev, the renderer page can `import('/src/lib/backend-url.ts')` through Vite to reach the app's live module instances.
- Section 1 smoke (sandbox, `TASKFLOW_DEV_PORT=18799`): handshake has two lines, it and `api-token-dev-main` are `-rw-------`; two `curl /api/settings` answer and log one `[auth] report-only: would reject (credential) GET /api/settings from ua=curl`.
- Report-only log lines today, from the backend's own tests: CDP clients give `(credential) GET /cdp/* from ua=Bun` and `WS /cdp/* from ua=none`. Section 5 handles CDP.
- Running Sol: `codex exec -m gpt-6.1-sol -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$PWD/.git" -C "$PWD" -o <report> - < <brief>`. In its sandbox 19 backend tests fail (process-stopper, watchers: `ps` EPERM, no FS events) and typecheck needs `TMPDIR=/private/tmp`; rerun the suites yourself outside it. Sol also edits `handoff.md`; rewrite its entries tightly.
- Implementation waits for the agent-browser chain (`../2026-10-30-agent-browser/handoff.md`, Next step "None: complete"). Plan reviews don't.
- **Push order:** the agent-browser feature's `/cdp/` upgrade (`ws/server.ts`) and `/api/browser/*` routes are as unauthenticated as the rest of the API until Section 5 here enforces auth. Tell the user not to push the browser work separately before Section 5, unless they accept that.
- The agent-browser plan already took the browser-specific t3code lessons (commit `38523814`, its spec Amendment 12). Don't redo them here.
- t3code source: fetch commit `32ecd71726fee16f335484c1f95cbce126d461f6` into your scratchpad with the command in `design.md` (the short SHA can't be fetched).
- Plan reviews are done (3 rounds). Round 3 added: S4 moves `ConnectionOverlay` out of `App.tsx` and exports `switchRefusal` from `MachinesMenu.tsx`; S6 Task 6.3 touches `WebSocketProvider.tsx` (dev renderer readiness) and adds its first test file.
- **User decision 2026-10-30:** don't stop the chain for the agent-browser feature's open manual checks (hand typing, Windows/Linux close, remote workspaces, `newCDPSession`). The user tests the browser work and this plan together after Section 13. Stop only for the reasons in `chain.md`.
- The agent-browser work is fully committed (tree clean at 841437f4). Line anchors in UI files may still differ from the plan; sections say to find code by landmarks.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.

## Deviations from the design

- Section 4: none to the design. `runSsh` now reports exit code `0` on success (was `null`), which the token read needs; `MenuEntry` carries the saved token for the edit dialog; both socket clients keep a request sent in Bun's gap between `readyState` closing and the close event pending, so it gets the `4401` reason; TUI refresh uses Section 3's policy (`start`/`retryNow`), not `scheduleReattach`.
- Section 6: none to the design. The provider test uses a stub Bun WebSocket server, not a real backend.
- Section 2: none to the design. `Connection`'s token parameter defaults to `null`; the TUI types Bun's header-capable `WebSocket` constructor locally.
- Section 1: none to the design. The TUI late-write deadline fixture writes a full two-line handshake; `server.test.ts` types Bun's header-capable `WebSocket` constructor locally (DOM typings omit it).

# Design: adoptions from t3code

These are the decisions every section follows. Sections apply them and add only the details they need. When a section disagrees with this file, this file wins. Fix the section and record the change under "Plan review log" in the index.

Source: research in `reviews/research-*.md` (gpt-6.1-sol, 2026-10-30) against t3code (MIT, https://github.com/pingdotgg/t3code, commit `32ecd717`). The reports cite t3code paths under a scratchpad that no longer exists. To read the cited code, fetch it into your own scratchpad:

```bash
git init -q <scratch>/t3code && cd <scratch>/t3code && git remote add origin https://github.com/pingdotgg/t3code.git && git fetch -q --depth 1 origin 32ecd717 && git checkout -q FETCH_HEAD
```

Code copied from t3code keeps an attribution comment at the top of the file or block: `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): <path>`.

## 1. Backend authentication (Sections 1, 2, 4, 5)

**Problem.** `packages/backend/src/ws/server.ts:74` upgrades every request to a full app WebSocket. The HTTP API has no auth, no CORS and no Origin or Host check. Binding to loopback keeps the LAN out, but any web page in the user's browser, and any page in a hosted browser tab, can reach the port. A WebSocket or a "simple" cross-site `text/plain` POST can create sessions, write PTY input, change settings, or read any file (through `POST /api/flow/artifact` followed by `GET .../raw`). The full client map is in `reviews/research-6-auth-surface.md`.

### Token

- One secret per instance: 32 random bytes, base64url. It lives in `join(BASE_DIR, \`api-token-${instanceId}\`)`, mode `0600`, written to a temp file and renamed, like the backend-uid file (`config.ts:104-135`; reuse its writer, don't copy it).
- The backend creates the file at startup if it's missing and reads it otherwise. It persists across restarts, so remembered remote tokens and CDP endpoints stay valid. Deleting the file rotates the token on the next start. No rotation UI.
- Windows: no POSIX modes. `%APPDATA%` is per-user, which is accepted.

### Credentials the backend accepts

These are checked in one pure module, `packages/backend/src/ws/auth.ts`. Every comparison uses `timingSafeEqual`.
1. **`Authorization: Bearer <token>` header**, on HTTP and on WebSocket upgrades. Used by the CLI (sh and TS), Electron main, the TUI and every other header-capable client.
2. **WebSocket subprotocol**, for the browser renderer, which can't set headers. The client offers `["taskflow", "taskflow.auth.<token>"]`. The server checks the auth entry and answers with `Sec-WebSocket-Protocol: taskflow`, never echoing the token.
3. **`token` query parameter**, only on `GET` of the raw file routes the renderer loads through `<img src>` and links: `/api/file/raw` and the flow-artifact raw route. Nowhere else.
4. **CDP key in the path** (Section 5): `/cdp/<tabId>/<key>/...`, where `key = base64url(HMAC-SHA256(token, "cdp:" + tabId))`. Agents' CDP clients can't add headers, and a key per tab means a leaked endpoint exposes one tab, not the API.

`GET /` (the `"Taskflow backend"` identity probe used by tunnel readiness) stays unauthenticated. Nothing else does.

### Request checks, in order

1. **Host.** The `Host` hostname must be `127.0.0.1`, `localhost` or `[::1]`, on any port. Otherwise the answer is 403. This blocks DNS rebinding. Tunnels pass, because a tunneled request carries `Host: 127.0.0.1:<local port>`.
2. **Origin.** If an `Origin` header is present, it must be in the allowlist, or the answer is 403 and no upgrade happens. The allowlist is `file://`, `null`, and the origins in `TASKFLOW_UI_ORIGINS` (comma-separated, set by the backend dev script and by Electron main in dev for the Vite UI, for example `http://localhost:5173`). Requests without `Origin` (CLI, TUI, Electron main, the backend's own Bun `fetch`) skip this check. Section 2 records, as a fact in `handoff.md`, which Origin the packaged renderer actually sends.
3. **Credential.** A missing or wrong credential gives HTTP `401 {"error":"Unauthorized"}`. For a WebSocket, the backend completes the upgrade, then closes at once with code `4401`, reason `unauthorized`. The socket is never added to `clients`, and no message reaches the router. The close code lets the renderer and the TUI tell "bad token" from "backend down", which an HTTP 401 on the upgrade can't do for a browser `WebSocket`.

### Rollout without breaking the app between sections

- Section 1 builds all of this in **report-only mode**: a module constant `AUTH_ENFORCED = false` in `auth.ts`. Requests that would fail are logged once per (reason, path pattern, client kind) and then served as today.
- Sections 2 and 4 make every client send credentials. Their verification greps the backend log for report-only rejections from each client they touch.
- Section 5 adds the CDP key, then sets enforcement on and deletes the constant and the report-only branch.

### Token distribution

| Client | Gets the token from | Sends it as |
|---|---|---|
| Electron main (spawns the backend) | The spawn handshake file `TASKFLOW_PORT_FILE`, which becomes two lines, `<port>\n<token>`, mode `0600`. One parser in `packages/shared`, `parsePortHandshake(content): { port: number; token: string } \| null`, used by every reader of that file. | header, through one `backendFetch(origin, path, init)` helper in `electron/src/` that every main-process call uses |
| Electron renderer | IPC from main: the token for each backend origin, local and attached | subprotocol; `token` query on raw file URLs, built by `packages/ui/src/lib/backend-url.ts` |
| Plain-browser dev UI (`VITE_BACKEND_PORT`) | `VITE_BACKEND_TOKEN`, set next to `VITE_BACKEND_PORT` wherever that is set | same as the renderer |
| TUI, local | its spawn handshake file (same parser) | header on the Bun `WebSocket` |
| TUI `--connect host:port` | new `--token <t>` flag, falling back to `TASKFLOW_TOKEN` | header |
| PTY sessions and the CLIs they run | `TASKFLOW_API_TOKEN` in the session env, next to `TASKFLOW_API_URL` (`session-lifecycle.ts:541`) | header. **POSIX sh:** one wrapper, `tf_curl`, replaces every bare `curl` call. **TS bin:** `api()` and its one outlier. Both CLIs change (see memory: the sh script is what runs on macOS/Linux). |
| Remote backends over SSH (Section 4) | read once over ssh, `cat ~/.config/taskflow/'api-token-<instanceId>'`, with the same command builder as the port read. Stored in the client's backend record. Re-read once after a `4401`; a second `4401` shows `Remote backend rejected the access token` (local: `The local backend rejected the access token`). | as for the local client of that kind |
| Remotes whose token can't be read over ssh (Windows, `TASKFLOW_CONFIG_DIR`) | entered by hand where the record's port can be. The remote machine shows its own token in Settings → General, under "Discoverable on this network", with a copy button (Electron, local backend only, read through main). The saved token is editable in the machine's edit dialog. | same |

### Out of scope

- No per-client tokens, no scopes, no expiry. Any holder of the token is fully trusted, as every session already is: it runs as the user.
- The `flow/artifact` arbitrary path stays as it is. Only authenticated callers can reach it, and they can already run commands.

## 2. Remote connectivity (Section 3)

- **No SSH multiplexing for our connections.** Every ssh argv Taskflow builds (tunnels and remote file reads) carries `-o ControlMaster=no -o ControlPath=none -o ControlPersist=no`, added in one place in `packages/shared/src/remote/tunnel-args.ts`. Killing our ssh child must close our forwarding, and host-key approval must happen on our own connection.
- **Desktop reconnects by itself.** When a desktop remote's tunnel exits, the desktop keeps the backend in a "reconnecting" state and retries, instead of dropping it to manual Retry. Reuse the TUI's reattachment logic (`packages/tui/src/opentui/machine-session.ts:399`) by moving its policy into `packages/shared/src/remote/`, where both use it. Don't write a second copy.
  - Backoff: 1 s, 2 s, 4 s … capped at 30 s, with ±20 % jitter. Reset after a connection stays up for 60 s.
  - Retry at once on OS resume (Electron `powerMonitor` `resume`) and on network change (`online`).
  - Give up only when the user removes or disconnects the backend.
  - Terminal state resyncs through the snapshot attach path, which Section 6 (run before Section 3) adds to the web UI. Uncertain terminal input is never replayed.
- **Stale cached port.** When every cached and discovered port fails, read the port over ssh once and try it if it's new. An explicitly entered port is a fallback: it's kept and retried when the port file can't be read.

## 3. Terminal correctness (Section 6)

- **No replies during replay.** While the web UI writes a snapshot or history into xterm, every `onData` it produces is dropped: from before the first write until the writer's flush resolves **and** xterm's write callback for the last chunk has fired. The same invariant as the TUI (`session-bridge.ts:72`). User keys typed in that window are dropped too; that's accepted.
- **Recover dropped output.** When `broadcast(..., { dropOnBackpressure })` skips a client, the server records `(client, sessionId)` as dirty. In the Bun `websocket.drain` handler it sends that client `{ type: MSG.TERMINAL_RESYNC, payload: { sessionIds } }` and clears the record. The web UI and the TUI each answer by re-running their existing snapshot attach for those sessions: buffer live chunks, apply the snapshot, flush chunks with a newer sequence. A client that sees a sequence gap in `terminal:output` does the same without waiting for the event.
- **Snapshots cover what was sent.** `SESSION_SNAPSHOT` records the issued output sequence when the request arrives, and answers once the headless parser has consumed up to it, or after 2000 ms with the current state (logged). Without this, a quiet session's last dropped chunk could be missing from the snapshot meant to repair it.

## 4. Scheduler (Section 7)

- **Admission.** One synchronous `admit(scheduleId)` guards both the timer path and `triggerNow`. It reserves the schedule before the first `await` and is released when the run ends or the spawn fails. Two concurrent triggers spawn one session.
- **Missed runs: run once, then resume the timetable** (the user's choice, 2026-10-30). The due check compares wall-clock time with the stored `nextRunAt`. It runs at startup, on every timer fire, and on a 30 s wall-clock tick, because macOS timers don't count sleep time. When `nextRunAt` is in the past, the schedule runs once, however many occurrences were missed. Then `nextRunAt` becomes the next occurrence after now (cron) or now + interval (rate).
- **Unrelated edits keep `nextRunAt`.** Recompute only when the timing fields (cron expression, interval, timezone, if any) or `enabled` change.

## 5. Git safety (Section 8)

- **Literal pathspecs.** Every git call that passes file paths from a user or the UI adds the global `--literal-pathspecs` option, through one opt-in in `git-helpers.ts`. `git diff --no-index` takes file paths, not pathspecs, and is left alone.
- **Worktree removal.** Before removing, check that the path is a registered, non-main worktree of this repo (`git worktree list --porcelain`). If it's already gone, prune. POSIX: `git worktree remove --force` first; if it fails, delete the directory with a remover that unlinks symlinks without following them (port t3code's `worktreeRemoval.ts`), then `git worktree prune`. **Windows: the safe remover runs first**, unlinking junctions without following them, then `git worktree prune`, because Git for Windows before 2.54 follows junctions on `worktree remove`. Branch deletion still runs after a cleanup failure, and the failure reaches the user (the task handler's response), not only the log.
- **Limits.**
  - Read-only git queries get a 30 s timeout and a 32 MiB output cap. Checkout, commit, push, pull and anything that runs hooks don't.
  - A single-file diff over 1 MiB comes back as a `tooLarge` state.
  - A file preview over 5 MiB, or with a NUL byte in its first 8 KiB, comes back as `tooLarge` or `binary` instead of its text. The UI shows a placeholder and disables saving, so incomplete content can never be written back.
  - Bulk per-file diffs run at most 4 at a time.

## 6. Agent discovery (Section 9)

- **Codex models.** Follow `nextCursor` until the end, and probe with the environment of the account being launched (its `CODEX_HOME`), so each account gets its own model list. Also read `account/read`, to show "signed in as …" or "not signed in" next to each Codex account in Settings. Discovery only: sessions still run the CLI in a PTY.
- **Templates without a project** (global flows, built-in actions) preview the owning backend's default account, labelled `Models for the default account; launch may inherit a project account`.
- **Pi thinking levels.** Offer `xhigh` only for models that declare support for it, following t3code's `packages/provider-pi/src/server/thinkingCapabilities.ts`. A saved `xhigh` on a model without support is shown and sent as `high`.
- Options still mirror each CLI's real flags (memory: agent options reflect CLI flags).

## 7. Desktop updater (Section 10)

Port t3code's pure update reducer (`apps/desktop/src/updates/updateMachine.ts`) and its tests into `electron/src/`, with attribution. A failed check keeps a downloaded update ready. A failed install keeps the downloaded update and offers Retry. Check, download and install failures are told apart. `auto-updater.ts` dispatches events into the reducer instead of setting fields directly.

## 8. Editor discovery (Section 11)

One resolver, used by both detection (`editor-detector.ts`) and launching (`handlers/file.ts:116`). It finds editors on `PATH` and in the places t3code's `packages/shared/src/editor.ts` checks: macOS app bundles, versioned JetBrains installs and Toolbox scripts, and Linux `zeditor`. It never takes OpenZFS's `zed` for the Zed editor. On Windows it adds native executables only, no `.cmd` scripts; `PATH` lookup behaves as today.

## 9. GitLab merge requests (Section 12)

A narrow adapter behind the existing `git-pr.ts` surface. It picks `gh` or `glab` from the remote's host: github.com or a host `gh` is logged into gives GitHub; gitlab.com or a host `glab` is logged into gives GitLab. A self-hosted host that both CLIs are logged into is ambiguous: status is unavailable, with `Remote host is authenticated in both gh and glab; provider selection is ambiguous`. Create, find and status only. Results tell "no PR/MR" apart from "status unavailable" (CLI missing, not authenticated, or failed). The UI says "MR" for GitLab. No provider framework.

## Not taken (decided 2026-10-30)

Wholesale Effect-TS infrastructure, protocol-driven agent control, chat UI, turn checkpoints, the MCP browser broker, the hosted relay, Tailscale and pairing (unless phone access becomes a goal), secret providers, the Pierre diff renderer, a watcher replacement, and git-config locks by common dir. Reasons are in the research reports.

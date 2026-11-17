# Handoff: browser passkeys

Keep this short. It's the only state carried between sessions. No narrative.

Plan: `../2026-11-17-browser-passkeys.md`. Spec: `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Chain protocol: `chain.md`.

## Next step

Plan review round 2

## Status

| # | Step | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 10 findings confirmed (8 major, 2 minor), folded; `reviews/plan-round-1-triage.md` | see git log |
| — | Plan review round 2 | pending | |
| 1 | Sandbox fix + entitlement/profile preflight (gate), sessions A and B | pending | |
| 2 | Electron 45.3.3 upgrade | pending | |
| 3 | Touch ID wiring + account selection | pending | |
| 4 | Final review, owner checks, release | pending | |

## Final-review base

(Section 1 writes the sha here.)

## Facts

- Baseline 2026-11-17, Electron 33.4.11 / Chrome 130, live tab: `isUserVerifyingPlatformAuthenticatorAvailable()` → `false`; `create()` never settles, no UI. webauthn.io itself starts a conditional `get()` on load, so probe on example.com.
- Electron 45.3.3 typings: `ConfigureWebAuthnOptions`, `SelectWebauthnAccountDetails`, `WebAuthnAccount`; Chromium clamps WebAuthn timeouts to ≥ 3 min. Apple TN3125: `keychain-access-groups` needs a profile on macOS.
- **Launch recipe** (every app run; one Bash call each, since shell state doesn't persist):
  - Pick `S=<absolute dir in this session's scratchpad>/run` and `mkdir -p "$S"`. Before launching, `pgrep -fl "release/mac-arm64/Taskflow.app|electron/node_modules/.*Electron \."` must print nothing that isn't yours; if it does, stop and ask.
  - Scrub this session's Taskflow context, so nothing reaches the owner's real backend: prefix every app launch, curl and CLI call with `env -u TASKFLOW_API_URL -u TASKFLOW_API_TOKEN -u TASKFLOW_SESSION_ID -u TASKFLOW_PROJECT_ID -u TASKFLOW_TASK_ID -u TASKFLOW_PORT_FILE -u TASKFLOW_RESTARTABLE`.
  - Packaged: `<scrub> TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR="$S" nohup electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow > "$S/app.log" 2>&1 & echo $! > "$S/app.pid"` (repo root). Run the binary directly so stdout is captured; `bun run open` sets only `TASKFLOW_DEV` and hides stdout.
  - Dev (after `bun run build`): same, but from `electron/` with `electron/node_modules/.bin/electron .` (or `bunx electron .`) instead of the bundle binary. Never `bun run dev:electron`.
  - Until Section 1 Step 3 lands, Electron's `userData` is `~/.config/taskflow-dev-main` even with this recipe. After it, it's `$S/electron-user-data` (holds `DevToolsActivePort`).
  - Port: `grep -o "Backend started on port [0-9]*" "$S/app.log"` (`electron/src/main.ts:249`). Token: `TOKEN=$(cat "$S"/api-token-*)` (`packages/backend/src/config.ts:115`). Never echo it.
  - Tab: `curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -X POST "http://127.0.0.1:$PORT/api/browser/tabs" -d '{"scope":"master","url":"https://example.com"}' > "$S/tab.json"`, then read the CDP `endpoint` from it. List tabs: `GET /api/browser/tabs` with the same header.
  - Notification: `curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'x-taskflow-project-id: smoke' -H 'x-taskflow-session-id: smoke' -X POST "http://127.0.0.1:$PORT/api/notifications" -d '{"message":"passkeys smoke"}'` → 201. The app's poller shows it.
  - WS: `ws://127.0.0.1:$PORT/` with subprotocols `["taskflow", "taskflow.auth.<token>"]`; frames `{correlationId, type, payload}` (`project:list`, `project:add {path}`, `session:create`, `session:input`, `terminal:output`; shapes in `packages/shared/src/types/ws.ts`).
  - App debug port: `$S/electron-user-data/DevToolsActivePort` (or the `DevTools listening on ws://…` log line).
  - Stop: `kill "$(cat "$S/app.pid")"`, then check that `pgrep -fl "release/mac-arm64/Taskflow.app"` prints nothing and `lsof -nP -iTCP:$PORT -sTCP:LISTEN` shows no backend left.

## Owner notes (for the final notify)

- Root `package.json` `dev:electron` (`TASKFLOW_DEV=1 cd electron && bun run dev`): the variable only reaches `cd`, so Electron runs in non-dev mode. Not fixed in this plan.

## Deviations

(none yet)

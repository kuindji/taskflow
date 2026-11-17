# Handoff: browser passkeys

Keep this short. It's the only state carried between sessions. No narrative.

Plan: `../2026-11-17-browser-passkeys.md`. Spec: `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Chain protocol: `chain.md`.

## Next step

Section 1 profile (waiting for the owner). Session A (Steps 1–8) is done; the chain stopped at the owner-gated Step 8.

Owner:
1. Apple Developer portal → Certificates, Identifiers & Profiles → Identifiers. Make sure an explicit App ID `com.taskflow.app` exists for team 9SX8S58CA8. No extra capabilities are needed: the profile grants `9SX8S58CA8.*` keychain groups by default.
2. Profiles → "+" → Distribution → **Developer ID** → App ID `com.taskflow.app` → certificate "Developer ID Application: Ivan Kuindzhi (9SX8S58CA8)" → name it → Generate → Download.
3. Save it as `electron/build/embedded.provisionprofile`, then start a session with the usual chain prompt (Session B runs `01-preflight.md` Steps 9–12).

## Status

| # | Step | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 10 findings confirmed (8 major, 2 minor), folded; `reviews/plan-round-1-triage.md` | see git log |
| — | Plan review round 2 | done: 7 findings confirmed (3 major, 4 minor), folded; `reviews/plan-round-2-triage.md` | see git log |
| — | Plan review round 3 | done: 3 findings confirmed (2 minor, 1 nit), folded; no blocker/major; `reviews/plan-round-3-triage.md` | see git log |
| 1 | Sandbox fix + entitlement/profile preflight (gate), sessions A and B | A done (base `d115dad9`); B waits for the owner's profile | `badb7772`, `4dc780d7` |
| 2 | Electron 45.3.3 upgrade | pending | |
| 3 | Touch ID wiring + account selection | pending | |
| 4 | Final review, owner checks, release | pending | |

## Final-review base

`d115dad9180a06498395b4b4c675f4b657d1e582`

## Facts

- Baseline 2026-11-17, Electron 33.4.11 / Chrome 130, live tab: `isUserVerifyingPlatformAuthenticatorAvailable()` → `false`; `create()` never settles, no UI. webauthn.io itself starts a conditional `get()` on load, so probe on example.com.
- Electron 45.3.3 typings: `ConfigureWebAuthnOptions`, `SelectWebauthnAccountDetails`, `WebAuthnAccount`; Chromium clamps WebAuthn timeouts to ≥ 3 min. Apple TN3125: `keychain-access-groups` needs a profile on macOS.
- No-profile launch (Section 1 Step 7, signed Electron 33 build with `keychain-access-groups`): **killed** at exec (exit 137, SIGKILL, empty `app.log`). `taskgated-helper: com.taskflow.app: Unsatisfied entitlements: keychain-access-groups` → `Disallowing: com.taskflow.app`. So a signed build of `main` does not launch until Session B embeds the profile. Nothing gets released before Section 4.
- Step 3 fix proven by an unsigned dev launch (recipe, Electron 33): alive, backend up, `$S/electron-user-data/` populated, `~/.config/taskflow-dev-main` mtime unchanged.
- On Electron 33 no `DevToolsActivePort` is written in `$S/electron-user-data/`. Use the `DevTools listening on ws://…` line in `app.log` for the app debug port.
- In zsh, `log` is a builtin. Call `/usr/bin/log show …` for AMFI lines. The useful predicate includes `process == "taskgated-helper"` (that's where the rejection is logged, not `amfid`/`kernel`).
- **Launch recipe** (every app run). Work from the repo root. Shell state doesn't persist between Bash calls, so start each call with the setup line and re-derive what it needs:
  - Setup: `S=<absolute dir in this session's scratchpad>/run; mkdir -p "$S"` (same `S` all session). Before launching, `pgrep -fl "release/mac-arm64/Taskflow.app|MacOS/Electron (electron|\.)( |$)"` must print nothing that isn't yours; if it does, stop and ask.
  - Scrub: where a command below says `X`, write out this full prefix (`X` is not a real command): `env -u TASKFLOW_API_URL -u TASKFLOW_API_TOKEN -u TASKFLOW_SESSION_ID -u TASKFLOW_PROJECT_ID -u TASKFLOW_TASK_ID -u TASKFLOW_PORT_FILE -u TASKFLOW_RESTARTABLE`. Use it for the sandbox app launch, so nothing reaches the owner's real backend. Talk to the sandbox backend with `curl`/WS; no step needs `taskflow-cli` there. If one ever does, write the prefix and then `TASKFLOW_API_URL=http://127.0.0.1:$PORT TASKFLOW_API_TOKEN=$TOKEN` (the CLI exits without a URL). Don't use it for the chain's own `taskflow-cli` calls (`log`, `notify`, `agent run`, `session close`): those need this session's real context. `curl` calls carry an explicit URL and token, so they don't need it.
  - Packaged: `X TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR="$S" nohup electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow > "$S/app.log" 2>&1 & echo $! > "$S/app.pid"`. Run the binary directly so stdout is captured; `bun run open` sets only `TASKFLOW_DEV` and hides stdout. Extra Electron flags (e.g. `--inspect=127.0.0.1:0`) go after the binary path.
  - Dev (after `bun run build`): `X TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR="$S" nohup electron/node_modules/.bin/electron electron > "$S/app.log" 2>&1 & echo $! > "$S/app.pid"` (still from the repo root; the last argument is the app directory). Never `bun run dev:electron`.
  - Until Section 1 Step 3 lands, Electron's `userData` is `~/.config/taskflow-dev-main` even with this recipe. After it, it's `$S/electron-user-data` (holds `DevToolsActivePort`).
  - Port and token (start of every call that talks to the app): `PORT=$(grep -o "Backend started on port [0-9]*" "$S/app.log" | grep -o "[0-9]*$" | tail -1); TOKEN=$(cat "$S"/api-token-*); [ -n "$PORT" ] && [ -n "$TOKEN" ] || echo "app not ready"` (`electron/src/main.ts:249`, `packages/backend/src/config.ts:115`). Never echo the token.
  - Tab: `curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -X POST "http://127.0.0.1:$PORT/api/browser/tabs" -d '{"scope":"master","url":"https://example.com"}' > "$S/tab.json"`, then `ENDPOINT=$(jq -r .endpoint "$S/tab.json")` (`browser-routes.ts:98`; never print the URL into committed files). List tabs: `GET /api/browser/tabs` with the same header.
  - Notification: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'x-taskflow-project-id: smoke' -H 'x-taskflow-session-id: smoke' -X POST "http://127.0.0.1:$PORT/api/notifications" -d "{\"message\":\"passkeys smoke $(date +%s)\"}"` → `201`. Keep the message you sent; the app's poller shows it.
  - WS: `ws://127.0.0.1:$PORT/` with subprotocols `["taskflow", "taskflow.auth.<token>"]`; frames `{correlationId, type, payload}` (`project:list`, `project:add {path}`, `session:create`, `session:input`, `terminal:output`; shapes in `packages/shared/src/types/ws.ts`).
  - App debug port: `$S/electron-user-data/DevToolsActivePort` (or the `DevTools listening on ws://…` log line). Main-process inspector (only with `--inspect`): the `Debugger listening on ws://…` log line.
  - Stop: `kill "$(cat "$S/app.pid")"`, then check that `pgrep -fl "release/mac-arm64/Taskflow.app|MacOS/Electron (electron|\.)( |$)"` prints nothing of yours and `lsof -nP -iTCP:$PORT -sTCP:LISTEN` shows no backend left.

## Owner notes (for the final notify)

- Root `package.json` `dev:electron` (`TASKFLOW_DEV=1 cd electron && bun run dev`): the variable only reaches `cd`, so Electron runs in non-dev mode. Not fixed in this plan.

## Deviations

- Section 1 Step 7: the signed app was killed before `main.ts` ran, so it couldn't prove the Step 3 fix. Added one unsigned dev launch (same recipe) to prove it.

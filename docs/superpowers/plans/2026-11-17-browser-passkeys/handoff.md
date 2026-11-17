# Handoff: browser passkeys

Keep this short. It's the only state carried between sessions. No narrative.

Plan: `../2026-11-17-browser-passkeys.md`. Spec: `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Chain protocol: `chain.md`.

## Next step

Section 4

## Status

| # | Step | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 10 findings confirmed (8 major, 2 minor), folded; `reviews/plan-round-1-triage.md` | see git log |
| — | Plan review round 2 | done: 7 findings confirmed (3 major, 4 minor), folded; `reviews/plan-round-2-triage.md` | see git log |
| — | Plan review round 3 | done: 3 findings confirmed (2 minor, 1 nit), folded; no blocker/major; `reviews/plan-round-3-triage.md` | see git log |
| 1 | Sandbox fix + entitlement/profile preflight (gate), sessions A and B | done, **gate passed** (base `d115dad9`) | `badb7772`, `4dc780d7`, `833216c0` |
| 2 | Electron 45.3.3 upgrade | done (base `14ac16e9`); dev + signed smoke pass, notification pass, updater deferred; diff review clean (`reviews/impl-2-triage.md`) | `8381ca90`, `e1d6265d` |
| 3 | Touch ID wiring + account selection | done (base `5cb6e3ea`); signed probe `uvpaa: true`, dev run clean; diff review clean (`reviews/impl-3-triage.md`) | `ed25dec4` |
| 4 | Final review, owner checks, release | pending | |

## Final-review base

`d115dad9180a06498395b4b4c675f4b657d1e582`

## Facts

- Baseline 2026-11-17, Electron 33.4.11 / Chrome 130, live tab: `isUserVerifyingPlatformAuthenticatorAvailable()` → `false`; `create()` never settles, no UI. webauthn.io itself starts a conditional `get()` on load, so probe on example.com.
- Electron 45.3.3 typings: `ConfigureWebAuthnOptions`, `SelectWebauthnAccountDetails`, `WebAuthnAccount`; Chromium clamps WebAuthn timeouts to ≥ 3 min. Apple TN3125: `keychain-access-groups` needs a profile on macOS.
- No-profile launch (Section 1 Step 7, signed Electron 33 build with `keychain-access-groups`): **killed** at exec (exit 137, SIGKILL, empty `app.log`). `taskgated-helper: com.taskflow.app: Unsatisfied entitlements: keychain-access-groups` → `Disallowing: com.taskflow.app`. So a signed build of `main` does not launch until Session B embeds the profile. Nothing gets released before Section 4.
- Step 3 fix proven by an unsigned dev launch (recipe, Electron 33): alive, backend up, `$S/electron-user-data/` populated, `~/.config/taskflow-dev-main` mtime unchanged.
- `DevToolsActivePort` lands in `$S/electron-user-data/` for the packaged build, but wasn't there for the unsigned dev run (Electron 33). In that case use the `DevTools listening on ws://…` line in `app.log`.
- In zsh, `log` is a builtin. Call `/usr/bin/log show …` for AMFI lines. The useful predicate includes `process == "taskgated-helper"` (that's where the rejection is logged, not `amfid`/`kernel`).
- **Mac bundle ID is `com.kuindji.taskflow`** (`build.mac.appId`; top-level `appId` stays `com.taskflow.app` for Windows/Linux). Apple refused App ID `com.taskflow.app` because another team owns it. App ID `com.kuindji.taskflow` (description "Taskflow") was registered 2026-11-17. Keychain group: `9SX8S58CA8.com.kuindji.taskflow.webauthn`.
- Profile `electron/build/embedded.provisionprofile` ("Taskflow Developer ID", portal id `6WZA99DX76`): app id `9SX8S58CA8.com.kuindji.taskflow`, keychain groups `9SX8S58CA8.*`, `ProvisionsAllDevices` true, cert SHA-1 `DDE285C9…2C4886` = signing identity. Profile `ExpirationDate` 2044-11-12. The embedded Developer ID cert expires 2027-02-01.
- **Gate passed** (Section 1 Step 11, Electron 33, `833216c0`). `codesign --verify --deep --strict` is OK. Main-app entitlements are the 4 keys + group + application-identifier + team-identifier, the renderer helper has only the 4 keys, the embedded profile matches the repo file (`profile-ok`), `TeamIdentifier=9SX8S58CA8`, and the DR is `identifier "com.kuindji.taskflow" …`. Sandboxed launch: alive at 16 s, backend up, `taskgated-helper: allowing entitlement(s) for com.kuindji.taskflow due to provisioning profile`.
- A `bun run package` (`--dir`) bundle has no `app-update.yml`. The packaged launch logs `[updater] Error: ENOENT … app-update.yml` (baseline, Electron 33). See Section 2 Step 11.
- Notification permission is per bundle ID. `com.kuindji.taskflow` may not be authorized yet; Section 2 Step 11 says how to treat that.
- **Launch recipe** (every app run). Work from the repo root. Shell state doesn't persist between Bash calls, so start each call with the setup line and re-derive what it needs:
  - Setup: `S=<absolute dir in this session's scratchpad>/run; mkdir -p "$S"` (same `S` all session). Before launching, `pgrep -fl "release/mac-arm64/Taskflow.app|MacOS/Electron (electron|\.)( |$)"` must print nothing that isn't yours; if it does, stop and ask.
  - Scrub: where a command below says `X`, write out this full prefix (`X` is not a real command): `env -u TASKFLOW_API_URL -u TASKFLOW_API_TOKEN -u TASKFLOW_SESSION_ID -u TASKFLOW_PROJECT_ID -u TASKFLOW_TASK_ID -u TASKFLOW_PORT_FILE -u TASKFLOW_RESTARTABLE`. Use it for the sandbox app launch, so nothing reaches the owner's real backend. Talk to the sandbox backend with `curl`/WS; no step needs `taskflow-cli` there. If one ever does, write the prefix and then `TASKFLOW_API_URL=http://127.0.0.1:$PORT TASKFLOW_API_TOKEN=$TOKEN` (the CLI exits without a URL). Don't use it for the chain's own `taskflow-cli` calls (`log`, `notify`, `agent run`, `session close`): those need this session's real context. `curl` calls carry an explicit URL and token, so they don't need it.
  - Packaged: `X TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR="$S" nohup electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow > "$S/app.log" 2>&1 & echo $! > "$S/app.pid"`. Run the binary directly so stdout is captured; `bun run open` sets only `TASKFLOW_DEV` and hides stdout. Extra Electron flags (e.g. `--inspect=127.0.0.1:0`) go after the binary path.
  - Dev (after `bun run build`): `X TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR="$S" nohup electron/node_modules/.bin/electron electron > "$S/app.log" 2>&1 & echo $! > "$S/app.pid"` (still from the repo root; the last argument is the app directory). Never `bun run dev:electron`.
  - Until Section 1 Step 3 lands, Electron's `userData` is `~/.config/taskflow-dev-main` even with this recipe. After it, it's `$S/electron-user-data` (holds `DevToolsActivePort`).
  - Port and token (start of every call that talks to the app): `PORT=$(grep -o "Backend started on port [0-9]*" "$S/app.log" | grep -oE "[0-9]+$" | tail -1); TOKEN=$(cat "$S"/api-token-*); [ -n "$PORT" ] && [ -n "$TOKEN" ] || echo "app not ready"` (`electron/src/main.ts:249`, `packages/backend/src/config.ts:115`). Never echo the token.
  - Tab: `curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -X POST "http://127.0.0.1:$PORT/api/browser/tabs" -d '{"scope":"master","url":"https://example.com"}' > "$S/tab.json"`, then `ENDPOINT=$(jq -r .endpoint "$S/tab.json")` (`browser-routes.ts:98`; never print the URL into committed files). List tabs: `GET /api/browser/tabs` with the same header.
  - Notification: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'x-taskflow-project-id: smoke' -H 'x-taskflow-session-id: smoke' -X POST "http://127.0.0.1:$PORT/api/notifications" -d "{\"message\":\"passkeys smoke $(date +%s)\"}"` → `201`. Keep the message you sent; the app's poller shows it.
  - WS: `ws://127.0.0.1:$PORT/` with subprotocols `["taskflow", "taskflow.auth.<token>"]`; frames `{correlationId, type, payload}` (`project:list`, `project:add {path}`, `session:create`, `session:input`, `terminal:output`; shapes in `packages/shared/src/types/ws.ts`).
  - App debug port: `$S/electron-user-data/DevToolsActivePort` (or the `DevTools listening on ws://…` log line). Main-process inspector (only with `--inspect`): the `Debugger listening on ws://…` log line.
  - Stop: `kill "$(cat "$S/app.pid")"`, then check that `pgrep -fl "release/mac-arm64/Taskflow.app|MacOS/Electron (electron|\.)( |$)"` prints nothing of yours and `lsof -nP -iTCP:$PORT -sTCP:LISTEN` shows no backend left.

- **Section 2 (Electron 45.3.3, Chrome 156.0.8078.100):** `bunx electron --version` from `electron/` downloads the dev binary on first run (`v45.3.3`; it lands in `node_modules/.bun/electron@45.3.3/.../dist`). electron-builder downloads its own `electron-v45.3.3-darwin-arm64.zip` during `bun run package`, so no extra step is needed.
- Section 2 dev smoke (2026-11-17): backend up, `$S/electron-user-data` in use, `~/.config/taskflow-dev-main` mtime unchanged. Probe `ua` has `Electron/45.3.3`, `uvpaa` false, `cma` true, create pending at 20 s. Playwright click navigates, and a `window.open` child shows up in `GET /api/browser/tabs` with `parentId`. Main window `document.title` = `Taskflow` over the debug port; screenshot by window id shows the UI. WS `project:add` + shell `session:create` + `echo smoke-ok` round-trip works. An unsigned notification logs `Desktop notification failed: … (UNErrorDomain error 1.)` and the app keeps running.
- Section 2 signed smoke (2026-11-17): profile-backed checks all pass (same entitlements, `profile-ok`, `TeamIdentifier=9SX8S58CA8`, DR `com.kuindji.taskflow`). The app is alive at 16 s, `taskgated-helper` logs `allowing entitlement(s) for com.kuindji.taskflow due to provisioning profile`, and a tab opens through the API. **Notification passed**: the unique message appeared in `Notification.getHistory()` about 9 s after the POST, with no `failed` line (so `com.kuindji.taskflow` is authorized). **Updater check deferred: --dir build has no app-update.yml** (`getUpdateState()` → `status: "error"`, the ENOENT only); Section 4 Step 3 checks it on the `dist` bundle.
- Dev launch recipe: `app.pid` holds the `node …/cli.js` launcher, not Electron. Killing it stops Electron too. For window ids or Electron's own pid, use `pgrep -f "MacOS/Electron electron$"`. Main window = the `Taskflow` window (1400×900); `Taskflow Dev (main)` is the park window that hosts tab views.
- Main-process inspector: `Runtime.evaluate` with `includeCommandLineAPI: true` makes `require("electron")` work directly. Scratch helpers from this session (`cdp-eval.ts`, `inspect-eval.ts`, `winid.swift`) live in the session scratchpad and are not kept. Rewrite them if needed (each is ~10 lines).

- **Section 3 signed check (2026-11-17, `ed25dec4`):** `bun run package` signed with the profile (`release/mac-arm64/Taskflow.app`, entitlement has `9SX8S58CA8.com.kuindji.taskflow.webauthn`). Probe `--uvpaa-only` on example.com: `hasPKC` true, `ua` `… Chrome/156.0.8078.100 Electron/45.3.3 …`, **`uvpaa: true`**, `cma` true, `create` `skipped`. `app.log` has no WebAuthn/Touch ID/passkey line (only the known `app-update.yml` ENOENT).
- Section 3 unsigned dev check: starts cleanly, no WebAuthn line in `app.log`, probe `uvpaa: false` (configure skipped, no listener).
- Signed package path for Section 4: `electron/release/mac-arm64/Taskflow.app` (the `--dir` build; Section 4 Step 3 makes its own notarized build).
- `persist:browser` is now one constant, `BROWSER_PARTITION` (`electron/src/browser-host/electron-views.ts`, re-exported from `browser-host/index.ts`). `main.ts` registers `select-webauthn-account` on it.

## Owner notes (for the final notify)

- Mac bundle ID changed to `com.kuindji.taskflow`. 0.16.x can't auto-update to 0.17.0; install it by hand once (Section 4 covers the release notes).
- Profile backup: `~/Downloads/Taskflow_Developer_ID.provisionprofile` (same bytes as the repo file). When the Developer ID Application cert is renewed (current one expires 2027-02-01), regenerate the profile in the portal with the new cert and replace `electron/build/embedded.provisionprofile`. Otherwise signed builds won't launch.

- Root `package.json` `dev:electron` (`TASKFLOW_DEV=1 cd electron && bun run dev`): the variable only reaches `cd`, so Electron runs in non-dev mode. Not fixed in this plan.

## Deviations

- Section 1: the owner logged in to the Apple Developer portal and asked the agent to do the profile steps. Session A and Session B both ran in one session. The agent registered App ID `com.kuindji.taskflow` (owner's choice after `com.taskflow.app` was refused) and created the profile. Plan, spec and entitlement were updated for the new ID; Section 2 Step 11 and Section 4 Steps 5–6 were adjusted.
- Section 1 Step 7: the signed app was killed before `main.ts` ran, so it couldn't prove the Step 3 fix. Added one unsigned dev launch (same recipe) to prove it.
- Section 2: the plan's recipe extracted the port with `grep -o "[0-9]*$"`, which prints nothing with BSD grep. Fixed in Facts to `grep -oE "[0-9]+$"`.
- Section 2: typecheck flagged `app.dock` as possibly undefined (Electron 45 typings). Fixed with `app.dock?.` in `window-manager.ts`. This isn't in the breaking-changes doc and is noted at the end of `reviews/breaking-changes-audit.md`.
- Section 2 Step 7: the plan named the generic open-file tracker `filePath`. It became `selectFilePath` because two handlers in the same function take a `filePath` parameter, which would shadow it.
- Section 2 Step 9: two commits instead of one (upgrade + audit + notification listener; dialog tracker).
- Section 3: `chooseWebAuthnAccount` uses the main window as the dialog parent only when it's visible (the plan said "when there is one"). A sheet on a hidden window would leave the request pending with nothing on screen.
- Section 3: the `persist:browser` literal became the shared constant `BROWSER_PARTITION`, so the listener and the tab views can't drift apart. `electron-views.ts` and `browser-host/index.ts` were touched for this.

# Passkeys in the integrated browser — design

Date: 2026-11-17. Status: approved by the owner in conversation.

## Intent

"Sign in with passkey" does nothing in Taskflow's integrated browser. Verified on
2026-11-17 in a live tab (Electron 33.4.11, Chrome 130):
`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves
`false`, and `navigator.credentials.create()` shows no UI and never settles (not even
after its own `timeout`). Electron before 41.5/42 has no macOS platform authenticator
and no Chrome-style authenticator dialog.

The owner is the only user of Taskflow and wants passkey sign-in to work inside the
integrated browser on their Mac via Touch ID.

## Goals

- Websites opened in Taskflow browser tabs (the `persist:browser` partition, hosted as
  `WebContentsView`s by `electron/src/browser-host/`) can create and use passkeys
  through Touch ID.
- The app keeps working everywhere it works today after the Electron upgrade:
  terminals/sessions, browser tabs + per-tab CDP endpoints for agents, notifications,
  dialogs, auto-updater, mac packaging/signing/notarization, Windows/Linux builds.

## Non-goals

- iCloud Keychain / 1Password / synced passkeys. Electron only reaches those via
  `platformPasskeys`, which is limited to domains the app is associated with
  (AASA file on the site) — useless for arbitrary sites. Not pursued.
- Phone/QR (hybrid) passkeys and a Chrome-like account picker — Electron has neither.
  (A minimal native account chooser *is* in scope; see Part 2.)
- Making passkeys work in unsigned dev runs (`bun run dev:electron`). Touch ID needs the
  signed bundle's entitlement; dev runs may keep hanging.
- Windows Hello / Linux work. Not tested; only typecheck and tests must pass (see
  release scope below).

## Anti-goals

- Weakening the browser tab permission policy (`permission-policy.ts`) beyond what
  WebAuthn strictly needs.
- Breaking agent CDP access (Playwright `connectOverCDP`) to tabs.
- Shipping an upgrade that silently breaks notifications or the updater.

## Constraints and known facts

- Current: `electron ^33.0.0` (33.4.11), `electron-builder ^26.8.1`,
  `@electron/notarize ^3.1.1`, bun workspace. Electron main-process code lives in
  `electron/src/`; built by `electron/build.ts` to `electron/dist/`.
- Bundle ID (changed in Section 1, owner decision 2026-11-17): `com.taskflow.app` is registered
  to another Apple team, so no App ID or profile can exist for it. The mac build uses
  `build.mac.appId` = `com.kuindji.taskflow`; the top-level `appId` stays `com.taskflow.app`, so
  Windows/Linux (NSIS GUID, AppUserModelID) don't change. Cost: installed mac copies can't
  auto-update across the change, because Squirrel.Mac checks the update against the running app's
  designated requirement (`identifier "com.taskflow.app" …`). Every mac install needs one manual
  reinstall, and macOS asks again for permissions keyed by bundle ID (notifications, local network).
  App data stays put (`userData` follows the product name `Taskflow`).
- Mac signing: identity `Ivan Kuindzhi (9SX8S58CA8)`, mac `appId` `com.kuindji.taskflow`,
  hardened runtime, `entitlements.mac.plist` used for both `entitlements` and
  `entitlementsInherit`, notarized via `scripts/notarize.js`.
- Owner's machine: Apple silicon, macOS 27 (Darwin 27.2). Electron 44 drops macOS 12 —
  irrelevant here.
- `app.configureWebAuthn(options)` (macOS, Electron ≥ 42; Touch ID landed in 41.5):
  `touchID: { keychainAccessGroup, promptReason? }`. The group must also be in the
  app's `keychain-access-groups` entitlement, form `<TEAM_ID>.<BUNDLE_ID>.webauthn`.
  Until called, platform authenticator requests are not serviced. Credentials are
  device-bound (Secure Enclave), per-session-partition, not synced. Docs:
  https://github.com/electron/electron/blob/main/docs/api/app.md
- Provisioning profile (resolved in plan review round 1): Apple TN3125 ("Entitlements
  on macOS") says `keychain-access-groups` is a restricted entitlement that must be
  authorized by a provisioning profile. So the owner creates a Developer ID provisioning
  profile for `com.kuindji.taskflow` in the Apple Developer portal, and the build embeds it
  (`mac.provisioningProfile` in electron-builder) together with the
  `com.apple.application-identifier` and `com.apple.developer.team-identifier`
  entitlements. osx-sign doesn't add those for apps without App Sandbox.
- Discoverable-credential sign-in (resolved in plan review round 1): Electron 45 cancels
  every discoverable Touch ID `get()` with `NotAllowedError`, even with one matching
  credential, unless the session has a `select-webauthn-account` listener
  (`docs/api/session.md`).
- Test sandbox: with `TASKFLOW_DEV=1`, Electron's `userData` is
  `~/.config/taskflow-dev-<branch>` regardless of `TASKFLOW_CONFIG_DIR`, and
  `bun run dev:electron` doesn't actually pass `TASKFLOW_DEV` to Electron. Test runs need
  `userData` inside `TASKFLOW_CONFIG_DIR` and must not use that script.

### Electron 34–45 breaking changes that touch this codebase

Audited against `electron/src` on 2026-11-17:

- 42: macOS notifications use `UNNotification`; unsigned apps get a `failed` event
  instead of a shown notification (`main.ts` `new Notification`). Signed builds fine;
  dev runs lose notifications. Acceptable, but add a `failed` listener that logs.
- 42: `electron` no longer downloads its binary in `postinstall`; it downloads on the
  first run of its `bin`, or via `install-electron`. Affects `bun run dev`
  (`electron .`) and electron-builder packaging. `ELECTRON_SKIP_BINARY_DOWNLOAD` is gone.
- 43: dialogs default to the Downloads directory when no `defaultPath` (ipc-handlers
  `showOpenDialog`/`showSaveDialog`). Check each call; set explicit paths only where
  the old default mattered.
- 45: sandboxed preloads lose Node shims/`Buffer`/`setImmediate` — `preload.ts` and
  `browser-preload.ts` do not use them (verified by grep), but confirm at runtime.
- 45: `window.open()` children of unsandboxed windows get their own sandboxed process —
  check any `setWindowOpenHandler` / popup flows (OAuth popups in browser tabs).
- 35/47: `console-message` event signature; `top-level-storage-access` permission is
  removed in 47 (we're on 45 — leave the allowlist alone).
- Chromium jumps from 130 to Electron 45's version: re-verify CDP endpoint proxying in
  `browser-host` (control-server, debug-port, tab-host) and Playwright connection.

The builder must still read the full breaking-changes doc for 34–45
(https://github.com/electron/electron/blob/main/docs/breaking-changes.md) and the
electron-builder compatibility notes; the list above is an audit, not a guarantee.

## Approaches considered

1. **Electron 45 + Touch ID platform authenticator (chosen).** Latest stable Electron;
   `configureWebAuthn({ touchID })`. Works on any site; credentials stay in Taskflow on
   this Mac. Owner accepted that limitation.
2. Electron 42 + Touch ID. Fewer breaking changes, but 42 is already out of upstream
   support; upgrading again soon costs more than doing it once.
3. `electron-webauthn-mac` (Vault12 native addon) or `platformPasskeys`. Give synced
   passkeys, but only for domains associated with the app. Rejected — doesn't serve
   arbitrary sites.
4. Fail-fast preload shim (reject passkey requests so sites fall back). Rejected by the
   owner in favour of real support.

## Decided design

A preflight, then two parts, in order.

### Part 0 — Entitlement preflight (builder-check call, made by Claude)

The `keychain-access-groups` signing question does not depend on the Electron version,
so answer it before the expensive upgrade. First make dev runs keep Electron's
`userData` inside `TASKFLOW_CONFIG_DIR`. Then sign the current Electron 33 package with
the entitlement added and launch it without a profile (evidence only), and hand off to
the owner, who creates the Developer ID profile for `com.kuindji.taskflow`. The build then
embeds the profile, and the signed, profile-backed app must launch. Do not start Part 1
until it does.

### Part 1 — Electron 33 → 45.3.3 upgrade

- Pin `electron` to 45.3.3 (latest stable on 2026-11-17) in `electron/package.json`;
  update `electron-builder`/`@electron/notarize`/`electron-updater` only if 45 needs it.
- Make the binary download work under the new on-demand model for `bun install`,
  the dev launch (`electron .` from `electron/`, run sandboxed per the plan's launch
  recipe, not through the broken `bun run dev:electron`), and packaging.
- Fix every breaking change that applies (list above + full doc audit).
- Verify: typecheck/lint/tests; the sandboxed dev app runs (sessions, terminals,
  browser tabs, agent CDP via `taskflow-cli browser open` + Playwright); a signed
  `bun run package` build launches, a unique smoke notification shows up in
  Notification Center (`Notification.getHistory()`), updater initializes.

### Part 2 — Touch ID passkeys

- Add to `entitlements.mac.plist`:
  `keychain-access-groups` = [`9SX8S58CA8.com.kuindji.taskflow.webauthn`].
- In main, on macOS, call
  `app.configureWebAuthn({ touchID: { keychainAccessGroup: "9SX8S58CA8.com.kuindji.taskflow.webauthn", promptReason: "sign in to $1" } })`
  so it is in effect before any browser tab makes a WebAuthn request.
- Register `select-webauthn-account` on the `persist:browser` session (only when
  configure succeeded): one matching account is picked automatically; several → a
  native `dialog.showMessageBox` chooser with Cancel; none/cancel/error → cancel. The
  callback runs exactly once. Chromium asks for Touch ID *before* it hands the
  matching accounts to this listener, so the user touches first and then chooses.
- Verify in a signed build: `isUserVerifyingPlatformAuthenticatorAvailable()` is
  `true`; on webauthn.io, register and authenticate with Touch ID, including with an
  empty username (discoverable) and with two accounts (touch, then chooser + cancel);
  then one real site of the owner's choosing. Touch ID credentials are tied to the
  browser profile (Electron keeps a per-profile metadata secret), so passkeys made in a
  sandboxed test build don't show up in the installed app. WebAuthn timeouts are clamped to ≥ 3 minutes by
  Chromium, so automated checks can't use "settles within N s" as a signal.
- Agent tabs share the partition, so they can trigger the Touch ID prompt; the prompt
  needs a physical finger, so no extra gating.

### Release and verification scope (owner decisions, 2026-11-17)

- **Mac: local verification plus a real release.** Verify on a local signed package
  first. The plan then ends with a version bump and a published mac release
  (`release:mac-all` path, notarized). `release:mac-all` uploads to a GitHub **draft**
  (electron-builder's default); the owner publishes the draft, optionally after adding
  Linux assets as in earlier releases. The owner installs 0.17.0 by hand over 0.16.1 (the
  mac bundle ID change rules out auto-update across it) and confirms that passkeys work
  in the installed app. Uploading and
  publishing are owner-gated: the agent asks before uploading and never publishes the
  draft itself.
- **Windows/Linux: typecheck and tests only.** No Windows or Linux artifacts are built
  in this plan. Packaging-script changes for the new Electron download model must not
  obviously break those paths, but they are not exercised.

## Left to the builder

- Whether to call `configureWebAuthn` only when `app.isPackaged` (dev runs lack the
  entitlement) or always with error handling — pick what keeps dev runs clean.
- Whether helper processes need the new entitlement (`entitlementsInherit`) or only
  the main app; prefer a separate inherit plist without it if signing allows.
- Exact mechanism for the binary download change.
- Whether the permission policy needs any WebAuthn-related entry (only if Electron 45
  routes a WebAuthn permission check through it; verify, don't guess).
- Whether to add a small unit test seam around the WebAuthn config call.

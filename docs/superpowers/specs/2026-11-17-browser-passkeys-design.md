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
- Mac signing: identity `Ivan Kuindzhi (9SX8S58CA8)`, `appId` `com.taskflow.app`,
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
- Open fact: Electron docs single out `associated-domains` as provisioning-profile
  backed, implying `keychain-access-groups` is not. Apple treats
  `keychain-access-groups` as a restricted entitlement on macOS in some contexts. It is
  **unverified** whether a Developer ID signed build with this entitlement launches and
  works without an embedded provisioning profile. This must be verified first in the
  WebAuthn part (see below); if a profile is needed, the owner creates a Developer ID
  provisioning profile for `com.taskflow.app` in the Apple Developer portal and the
  build embeds it (`mac.provisioningProfile` in electron-builder).

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
so answer it before the expensive upgrade: sign the current Electron 33 package with
the entitlement added and see whether it launches. If it only launches with an embedded
Developer ID provisioning profile, stop and hand off to the owner, who creates the
profile for `com.taskflow.app` in the Apple Developer portal; the build then embeds it.
Do not start Part 1 until the entitlement is known to work, with or without a profile.

### Part 1 — Electron 33 → 45.3.3 upgrade

- Pin `electron` to 45.3.3 (latest stable on 2026-11-17) in `electron/package.json`;
  update `electron-builder`/`@electron/notarize`/`electron-updater` only if 45 needs it.
- Make the binary download work under the new on-demand model for `bun install`,
  `bun run dev:electron`, and packaging.
- Fix every breaking change that applies (list above + full doc audit).
- Verify: typecheck/lint/tests; `bun run dev:electron` app runs (sessions, terminals,
  browser tabs, agent CDP via `taskflow-cli browser open` + Playwright); a signed
  `bun run package` build launches, notifications show, updater initializes.

### Part 2 — Touch ID passkeys

- Add to `entitlements.mac.plist`:
  `keychain-access-groups` = [`9SX8S58CA8.com.taskflow.app.webauthn`].
- In main, on macOS, call
  `app.configureWebAuthn({ touchID: { keychainAccessGroup: "9SX8S58CA8.com.taskflow.app.webauthn", promptReason: "sign in to $1" } })`
  so it is in effect before any browser tab makes a WebAuthn request.
- Verify first that the signed build with the entitlement launches (provisioning
  profile question above). Then in a signed build: on webauthn.io, register and
  authenticate with Touch ID; `isUserVerifyingPlatformAuthenticatorAvailable()` is
  `true`; then one real site of the owner's choosing.
- Agent tabs share the partition, so they can trigger the Touch ID prompt; the prompt
  needs a physical finger, so no extra gating.

### Release and verification scope (owner decisions, 2026-11-17)

- **Mac: local verification plus a real release.** Verify on a local signed package
  first. The plan then ends with a version bump and a published mac release
  (`release:mac-all` path, notarized). The owner confirms that the installed 0.16.1 app
  auto-updates to it and that passkeys work in the updated app. Publishing is an
  owner-gated step: the agent asks before running it.
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

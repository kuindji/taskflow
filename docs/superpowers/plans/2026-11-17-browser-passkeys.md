# Browser Passkeys (Electron 45 + Touch ID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan section by section (each section runs in its own chained session, see `2026-11-17-browser-passkeys/chain.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Sign in with passkey" works in Taskflow's integrated browser on the owner's Mac through Touch ID.

**Architecture:** Upgrade Electron 33.4.11 → 45.3.3, which has a macOS Touch ID platform authenticator for WebAuthn. Add the `keychain-access-groups` entitlement `9SX8S58CA8.com.taskflow.app.webauthn` to the signed app, authorized by an embedded Developer ID provisioning profile (a restricted entitlement on macOS, Apple TN3125). Call `app.configureWebAuthn({ touchID })` at startup and register a `select-webauthn-account` listener on the `persist:browser` session, so tabs can create device-bound passkeys and sign in with them. A preflight first fixes the test sandbox and proves the entitlement + profile can be signed and launched at all.

**Tech Stack:** Bun, TypeScript, Electron 45.3.3, electron-builder 26, `@electron/notarize`, bun:test, Playwright (`playwright-core`, probe only, not a dependency), Codex CLI (`gpt-6.1-sol`) for reviews.

**Spec:** `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Read it before starting any section.

## How this plan is laid out

Each section is a file in `2026-11-17-browser-passkeys/`, written to be done in a fresh session. Before starting a section, read `2026-11-17-browser-passkeys/handoff.md`, then the section file and the spec. When a section is done, update the handoff. The chain protocol is `2026-11-17-browser-passkeys/chain.md`.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Dev sandbox fix + entitlement/profile preflight on Electron 33. **Gate.** Two sessions (A, then B after the owner's profile). | `01-preflight.md` | — |
| 2 | Electron 33 → 45.3.3 upgrade | `02-electron-upgrade.md` | 1 |
| 3 | Touch ID WebAuthn wiring + account selection + signed-build check | `03-touchid.md` | 2 |
| 4 | Final review, owner checks, version bump, release | `04-release.md` | 3 |

**Gate after Section 1.** If the signed app with the entitlement and the owner's Developer ID provisioning profile does not launch, or the profile doesn't authorize the access group, stop: the plan is revised before any upgrade work.

**Owner-gated steps** (the chain stops and notifies; the agent never does these on its own):
- creating a Developer ID provisioning profile in the Apple Developer portal (Section 1, expected);
- the hand checks with a real finger on Touch ID, including one real site (Section 4);
- uploading the GitHub draft release (Section 4, after the owner's approval); publishing that draft is done by the owner, never the agent.

## Cross-section interfaces (fixed names)

- Keychain access group, used verbatim in the entitlement and the code:
  `9SX8S58CA8.com.taskflow.app.webauthn`
- Entitlement files (Section 1 creates the split; later sections use these exact paths):
  - `electron/entitlements.mac.plist` — main app: the existing four keys + `keychain-access-groups`
    + `com.apple.application-identifier` (`9SX8S58CA8.com.taskflow.app`) + `com.apple.developer.team-identifier` (`9SX8S58CA8`).
  - `electron/entitlements.inherit.mac.plist` — helpers: the existing four keys only.
  - `electron/package.json` `build.mac.entitlementsInherit` → `entitlements.inherit.mac.plist`;
    `build.mac.provisioningProfile` → `build/embedded.provisionprofile` (file committed at `electron/build/embedded.provisionprofile`).
- Dev sandbox (Section 1): `electron/src/dev-user-data.ts`
  - `export function devUserDataPath(env: Readonly<Record<string, string | undefined>>, home: string, branch: string): string`
    — `<TASKFLOW_CONFIG_DIR>/electron-user-data` when set (absolute, else throws), otherwise `<home>/.config/taskflow-dev-<branch>`. Used only when `TASKFLOW_DEV` is set.
- WebAuthn module (Section 3): `electron/src/webauthn.ts`
  - `export const WEBAUTHN_KEYCHAIN_ACCESS_GROUP = "9SX8S58CA8.com.taskflow.app.webauthn";` (not exported unless the test needs it — the test does)
  - `export function configureTouchIdWebAuthn(deps: WebAuthnDeps): boolean`
  - `interface WebAuthnDeps { platform: NodeJS.Platform; isPackaged: boolean; configure(options: Electron.ConfigureWebAuthnOptions): void; warn(message: string, error?: unknown): void }`
    (type name checked in `electron@45.3.3/electron.d.ts`)
  - `export function handleWebAuthnAccountSelection(details: Pick<Electron.SelectWebauthnAccountDetails, "relyingPartyId" | "accounts">, callback: (credentialId?: string | null) => void, choose: (relyingPartyId: string, labels: string[]) => Promise<number | null>, warn: (message: string, error?: unknown) => void): Promise<void>`
  - Imports Electron types only; the dialog chooser lives in `main.ts`.
- Dialog last-path tracker (Section 2): `electron/src/dialog-last-path.ts`
  - `export function createLastPathTracker(): { defaultPath(): string | undefined; remember(selectedPath: string, kind: "file" | "directory"): void }`
- Probe: `2026-11-17-browser-passkeys/spike/webauthn-probe.ts` (usage in its header; under `spike/` so repo lint skips it).
- Sandbox launch/smoke recipe (dev and packaged): `2026-11-17-browser-passkeys/handoff.md` Facts. Every app run uses it.

## Global Constraints

- Electron version: exactly `45.3.3` (pinned, no caret) in `electron/package.json`.
- Use `bun` for everything; never npm/yarn. Format only touched files (`bun fmt <paths>`); never bare `bun fmt`.
- No `as any`; no needless exports; no oxlint disables (`.oxlintrc.json`).
- No `Co-Authored-By` trailers in commits. Work on `main`; no branches/worktrees. Never push.
- Never run a second Taskflow instance against the owner's real data or profile: use the launch recipe in `handoff.md` Facts
  (`TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<absolute scratch dir>`, Taskflow env vars scrubbed; after Section 1 Step 3 this also isolates Electron's `userData`).
  Never use `bun run dev:electron`: its `TASKFLOW_DEV=1` applies only to `cd`, so Electron runs in non-dev mode.
- Never print the sandbox API token or CDP endpoint URLs into committed files.
- Never activate/raise apps or steal focus while testing; capture by window id, drive over debug ports.
- Windows/Linux: typecheck and tests only; no Windows/Linux artifacts are built.
- Passkeys are not expected to work in unsigned dev runs.

## Review Focus

- Unsigned dev run (dev launch recipe) must start cleanly — `configureTouchIdWebAuthn` must not throw or log scary errors there (Section 3 test: returns `false`, `configure` not called, when `isPackaged` is false).
- `configure` throwing (missing entitlement, older macOS) must not crash startup (Section 3 test: `configure` throws → returns `false`, `warn` called once).
- Passkey sign-in (`get()` with discoverable credentials) needs the `select-webauthn-account` listener: one account auto-picked, several → dialog, cancel/error → `callback()` exactly once (Section 3 tests).
- Agent CDP access to tabs after the Chromium jump (Section 2 smoke: `taskflow-cli browser open` endpoint + Playwright `connectOverCDP` works, popups still open as tabs).
- Notifications on unsigned dev runs now fail (Electron 42 `UNNotification`); the failure must be logged, not crash (Section 2: `failed` listener). On the signed build a unique smoke message must show up in `Notification.getHistory()` (Section 2 Step 11).
- Open dialogs default to Downloads after Electron 43; the project-directory picker must reopen where the user last picked (Section 2 tests on `createLastPathTracker`).

## Plan review log

(Chain sessions append one line per review round here.)

- Round 1 (2026-11-17): 8 Codex findings + 2 own, all 10 confirmed (8 major, 2 minor) and folded (`reviews/plan-round-1-triage.md`). Added: account-selection listener, profile as the expected path, dev `userData` sandbox fix, full smoke recipe, abort-based probe under `spike/`, positive notification/updater/real-site gates. Next: round 2.
- Round 2 (2026-11-17): 5 Codex findings + 2 own, all 7 confirmed (3 major, 4 minor) and folded (`reviews/plan-round-2-triage.md`). Changed: the release uploads a GitHub draft that the owner publishes; the notification gate checks `Notification.getHistory()` for a unique message; the owner flow is touch-then-choose; the recipe and Session B checks are fixed; the real-site passkey is cleaned up; Section 3 probes with `--uvpaa-only`. Next: round 3.
- Round 3 (2026-11-17): 3 Codex findings, all confirmed (2 minor, 1 nit), no blocker/major; folded (`reviews/plan-round-3-triage.md`). Changed: the launch recipe's process guard matches the repo-root dev launch; sandbox `taskflow-cli` use is spelled out (URL and token set after the scrub); the updater pass condition names the real `idle` state. Next: Implement Section 1.

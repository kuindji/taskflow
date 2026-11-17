# Browser Passkeys (Electron 45 + Touch ID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan section by section (each section runs in its own chained session, see `2026-11-17-browser-passkeys/chain.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Sign in with passkey" works in Taskflow's integrated browser on the owner's Mac through Touch ID.

**Architecture:** Upgrade Electron 33.4.11 → 45.3.3, which has a macOS Touch ID platform authenticator for WebAuthn. Add the `keychain-access-groups` entitlement `9SX8S58CA8.com.taskflow.app.webauthn` to the signed app and call `app.configureWebAuthn({ touchID })` at startup, so tabs in the `persist:browser` partition can create and use device-bound passkeys. A preflight first proves the entitlement can be signed and launched at all.

**Tech Stack:** Bun, TypeScript, Electron 45.3.3, electron-builder 26, `@electron/notarize`, bun:test, Playwright (`playwright-core`, probe only, not a dependency), Codex CLI (`gpt-6.1-sol`) for reviews.

**Spec:** `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Read it before starting any section.

## How this plan is laid out

Each section is a file in `2026-11-17-browser-passkeys/`, written to be done in a fresh session. Before starting a section, read `2026-11-17-browser-passkeys/handoff.md`, then the section file and the spec. When a section is done, update the handoff. The chain protocol is `2026-11-17-browser-passkeys/chain.md`.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Entitlement preflight on Electron 33. **Gate.** | `01-preflight.md` | — |
| 2 | Electron 33 → 45.3.3 upgrade | `02-electron-upgrade.md` | 1 |
| 3 | Touch ID WebAuthn wiring + signed-build check | `03-touchid.md` | 2 |
| 4 | Final review, owner checks, version bump, release | `04-release.md` | 3 |

**Gate after Section 1.** If the signed app with the entitlement does not launch, and also does not launch with a provisioning profile the owner provides, stop: the plan is revised before any upgrade work.

**Owner-gated steps** (the chain stops and notifies; the agent never does these on its own):
- creating a Developer ID provisioning profile in the Apple Developer portal (only if Section 1 needs it);
- the hand check with a real finger on Touch ID (Section 4);
- publishing the GitHub release (Section 4).

## Cross-section interfaces (fixed names)

- Keychain access group, used verbatim in the entitlement and the code:
  `9SX8S58CA8.com.taskflow.app.webauthn`
- Entitlement files (Section 1 creates the split; later sections use these exact paths):
  - `electron/entitlements.mac.plist` — main app: the existing four keys + `keychain-access-groups`
    (+ profile-backed keys only if Section 1 needs a profile).
  - `electron/entitlements.inherit.mac.plist` — helpers: the existing four keys only.
  - `electron/package.json` `build.mac.entitlementsInherit` → `entitlements.inherit.mac.plist`.
- WebAuthn module (Section 3): `electron/src/webauthn.ts`
  - `export const WEBAUTHN_KEYCHAIN_ACCESS_GROUP = "9SX8S58CA8.com.taskflow.app.webauthn";` (not exported unless the test needs it — the test does)
  - `export function configureTouchIdWebAuthn(deps: WebAuthnDeps): boolean`
  - `interface WebAuthnDeps { platform: NodeJS.Platform; isPackaged: boolean; configure(options: Electron.WebAuthnOptions): void; warn(message: string, error?: unknown): void }`
    — use Electron 45's exported options type for `configure`'s parameter; if Electron names it differently, use that name and record it in the handoff.
- Dialog last-path tracker (Section 2): `electron/src/dialog-last-path.ts`
  - `export function createLastPathTracker(): { defaultPath(): string | undefined; remember(selectedPath: string, kind: "file" | "directory"): void }`
- Probe: `2026-11-17-browser-passkeys/probe/webauthn-probe.ts` (usage in its header).

## Global Constraints

- Electron version: exactly `45.3.3` (pinned, no caret) in `electron/package.json`.
- Use `bun` for everything; never npm/yarn. Format only touched files (`bun fmt <paths>`); never bare `bun fmt`.
- No `as any`; no needless exports; no oxlint disables (`.oxlintrc.json`).
- No `Co-Authored-By` trailers in commits. Work on `main`; no branches/worktrees. Never push.
- Never run a second Taskflow instance against the owner's real data: sandbox every run with
  `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<absolute scratch dir>`.
- Never activate/raise apps or steal focus while testing; capture by window id, drive over debug ports.
- Windows/Linux: typecheck and tests only; no Windows/Linux artifacts are built.
- Passkeys are not expected to work in unsigned dev runs (`bun run dev:electron`).

## Review Focus

- Unsigned dev run (`bun run dev:electron`) must start cleanly — `configureTouchIdWebAuthn` must not throw or log scary errors there (Section 3 test: returns `false`, `configure` not called, when `isPackaged` is false).
- `configure` throwing (missing entitlement, older macOS) must not crash startup (Section 3 test: `configure` throws → returns `false`, `warn` called once).
- Agent CDP access to tabs after the Chromium jump (Section 2 smoke: `taskflow-cli browser open` endpoint + Playwright `connectOverCDP` works, popups still open as tabs).
- Notifications on unsigned dev runs now fail (Electron 42 `UNNotification`); the failure must be logged, not crash (Section 2: `failed` listener).
- Open dialogs default to Downloads after Electron 43; the project-directory picker must reopen where the user last picked (Section 2 tests on `createLastPathTracker`).

## Plan review log

(Chain sessions append one line per review round here.)

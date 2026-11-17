# Handoff: browser passkeys

Keep this short. It's the only state carried between sessions. No narrative.

Plan: `../2026-11-17-browser-passkeys.md`. Spec: `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`. Chain protocol: `chain.md`.

## Next step

Plan review round 1

## Status

| # | Step | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | pending | |
| 1 | Entitlement preflight (gate) | pending | |
| 2 | Electron 45.3.3 upgrade | pending | |
| 3 | Touch ID wiring | pending | |
| 4 | Final review, owner checks, release | pending | |

## Final-review base

(Section 1 writes the sha here.)

## Facts

- Baseline 2026-11-17, Electron 33.4.11 / Chrome 130, live tab: `isUserVerifyingPlatformAuthenticatorAvailable()` → `false`; `create()` never settles, no UI. webauthn.io itself starts a conditional `get()` on load, so probe on example.com.
- Sandboxed app runs: `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<abs scratch>`. Packaged: run the bundle's binary directly so stdout is captured, in the background: `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<abs scratch> electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow > <scratch>/app.log 2>&1` (`bun run open` sets only `TASKFLOW_DEV` and hides stdout). Backend port from the `Backend started on port` line (`electron/src/main.ts:249`); open a tab with `POST http://127.0.0.1:<port>/api/browser/tabs` body `{"scope":"master","url":"https://example.com"}` → response has the CDP `endpoint` (pattern from agent-browser handoff, Section 5 smoke). App debug port: `<userData>/DevToolsActivePort`.

## Deviations

(none yet)

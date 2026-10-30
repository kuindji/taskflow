# Handoff: Agent-Drivable Internal Browser

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-30-agent-browser.md`. Spec: `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`. Chain protocol: `chain.md`.

## Next step

**Stopped for the user (round cap).** Round 4 confirmed 1 blocker (Puppeteer's `tab` targets), 2 majors (popup-name reservation race, an attached view covering the UI after a renderer reload) and 1 minor (a `closed` event lost on HTTP 500). All are folded in (`reviews/round-4-triage.md`, spec Amendment 10). Per `chain.md` no round 5 runs. The user decides: accept the plan as amended and continue with "Implement Section 1", or run one more review round on the round-4 fixes first. The new design to look at is the tab-target resolution (`04-cdp-gateway.md` "Tab targets" and `pageOfTabTarget`), which the spike must confirm.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 1 blocker and 14 majors confirmed and folded in; round 2 output saved | 3b82b51e |
| — | Plan review round 2 | done: 1 blocker, 7 majors, 1 minor + 1 own major confirmed and folded in; round 3 output saved | 0286d1f4 |
| — | Plan review round 3 | done: 1 blocker, 3 majors, 1 minor confirmed and folded in; round 4 output saved | 84c0815b |
| — | Plan review round 4 (cap) | done: 1 blocker, 2 majors, 1 minor confirmed and folded in; chain stopped for the user | cd1699ab |
| 1 | Spike (gate) | not started | |
| 2 | Shared types, store, host client, service | not started | |
| 3 | HTTP/WS API, wiring, cleanup hooks | not started | |
| 4 | CDP gateway | not started | |
| 5 | Electron host | not started | |
| 6 | UI | not started | |
| 7 | CLI, doc, prompt | not started | |
| 8 | Manual verification, final review | not started | |

## Facts for the next section

- Base commit before implementation (final-review base): not recorded yet. The Section 2 session records it.
- Spike facts (Section 1 fills these in): debug port source; hidden-view rendering method; `createWindow` + `window.opener`; CDP method list with decisions; `Target.createTarget` behavior.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- Section order is now 2, 3, 4, 5, 6, 7 (round 2 changed it; `chain.md` updated).
- Electron v33.4.11 and Chromium 130 sources can be fetched from raw.githubusercontent.com (`electron/electron/v33.4.11/...`, `chromium/chromium/130.0.6723.191/...`) to check review claims.
- `bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --moduleResolution bundler --module esnext --target es2022 .probe/p.ts`, run from `electron/` with a throwaway `.probe/` dir, type-checks Electron API claims against the installed 33.4.11 typings.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

(none yet)

# Handoff: Agent-Drivable Internal Browser

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-30-agent-browser.md`. Spec: `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`. Chain protocol: `chain.md`.

## Next step

Plan review round 4. The Codex round-4 output is already saved in `reviews/round-4.md` (it reviewed commit 84c0815b: 1 blocker, 3 majors claimed: Puppeteer's tab-target hierarchy, popup-name reservation race, close event lost on HTTP 500, renderer reload leaving a view attached). Start at chain step 2: verify and triage it into `reviews/round-4-triage.md`, fold confirmed findings in. Round 4 is the cap: if a blocker or major is confirmed, fold it in, then stop the chain and notify the user (don't run round 5).

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 1 blocker and 14 majors confirmed and folded in; round 2 output saved | 3b82b51e |
| — | Plan review round 2 | done: 1 blocker, 7 majors, 1 minor + 1 own major confirmed and folded in; round 3 output saved | 0286d1f4 |
| — | Plan review round 3 | done: 1 blocker, 3 majors, 1 minor confirmed and folded in; round 4 output saved | 84c0815b |
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

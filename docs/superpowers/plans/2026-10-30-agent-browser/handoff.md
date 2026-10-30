# Handoff: Agent-Drivable Internal Browser

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-30-agent-browser.md`. Spec: `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`. Chain protocol: `chain.md`.

## Next step

Plan review round 2. The Codex round-2 output is already saved in `reviews/round-2.md` (it reviewed commit 3b82b51e). Start at chain step 2: verify and triage it into `reviews/round-2-triage.md`.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 1 blocker and 14 majors confirmed and folded in; round 2 output saved | 3b82b51e |
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
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

(none yet)

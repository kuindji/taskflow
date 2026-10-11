# Handoff: Running Dev Servers

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-11-dev-servers.md`. Spec: `docs/superpowers/specs/2026-10-11-dev-servers-design.md`. TaskTray: `TSK-4`. Chain protocol: `chain.md`.

## Next step

Plan review round 2 (report: `reviews/round-2.md`; prompt `reviews/round-2-prompt.md`).

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Shared types, store, stopper, service | not started | |
| 2 | Config, HTTP routes, WS handlers, wiring | not started | |
| 3 | CLI (sh, TS bin), doc, prompt | not started | |
| 4 | Desktop UI | not started | |
| 5 | Manual verification, final review | not started | |

## Facts for the next section

- Round 1 triaged in `reviews/round-1-triage.md` (all 11 confirmed; DS-08's promptless-Kimi part rejected as a known limitation). Fixes are in the section files, the plan index ("Plan review log", Review Focus) and the spec's new "Amendments" (items 1-8). Section 1 and 4 no longer write spec amendments for plan-time refinements; they only add implementation deviations.
- The revised Section 1 stopper snippet + test were run from a scratch copy on macOS: 29/29 pass; tsc and eslint clean.

- Base commit before implementation: fill in when Section 1 starts (`git rev-parse HEAD`).
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage; every UI test file passes alone. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts` (`await expect(p).rejects.toThrow()` trips eslint `await-thenable`).
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

(none yet)

# Handoff: Running Dev Servers

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-11-dev-servers.md`. Spec: `docs/superpowers/specs/2026-10-11-dev-servers-design.md`. TaskTray: `TSK-4`. Chain protocol: `chain.md`.

## Next step

Implement Section 2 (`02-backend-api.md`), following "Implementation steps" in `chain.md`.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Shared types, store, stopper, service | implemented | `d71ac82c`, `57a36915`, `e0cb88e1` |
| 2 | Config, HTTP routes, WS handlers, wiring | not started | |
| 3 | CLI (sh, TS bin), doc, prompt | not started | |
| 4 | Desktop UI | not started | |
| 5 | Manual verification, final review | not started | |

## Facts for the next section

- Plan reviews are done. Round 2: 6 confirmed (`reviews/round-2-triage.md`), spec Amendments 9-11. Round 3: all round 2 fixes hold, plus 1 minor (Section 5 item 10), fixed (`reviews/round-3-triage.md`).
- Round 1 triaged in `reviews/round-1-triage.md` (all 11 confirmed; DS-08's promptless-Kimi part rejected as a known limitation). Fixes are in the section files, the plan index ("Plan review log", Review Focus) and the spec's new "Amendments" (items 1-8). Section 1 and 4 no longer write spec amendments for plan-time refinements; they only add implementation deviations.
- The revised Section 1 stopper snippet + test were run from a scratch copy on macOS: 29/29 pass; tsc and eslint clean.

- Base commit before implementation: `c27573920a56ef3a021729c7cba3bb1046b9aaee`.
- Section 1 followed all three test-first cycles: missing-module failures, then store 8/8, stopper 29/29 (including 6 real-process tests on macOS), service 11/11. No implementation deviations from the snippets.
- Section 1 checks: root typecheck, scoped eslint and prettier passed; shared suite 214/214. Backend suite: 867 passed, 2 skipped, 1 known isolated-backend shutdown flake (exit 143 instead of 0); `bun test tests/services/platform.test.ts` rerun passed 7/7.
- Section 1 adds the exact shared types and MSG entries, queued store, process stopper and service exports specified in the index; backend wiring is still Section 2.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage; every UI test file passes alone. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts` (`await expect(p).rejects.toThrow()` trips eslint `await-thenable`).
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

No implementation deviations. Workflow deviation: the referenced superpowers execution skill was not installed; Section 1 was executed directly, in the written order, with the required TDD checks and commits.

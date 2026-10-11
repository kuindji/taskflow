# Handoff: Running Dev Servers

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-11-dev-servers.md`. Spec: `docs/superpowers/specs/2026-10-11-dev-servers-design.md`. TaskTray: `TSK-4`. Chain protocol: `chain.md`.

## Next step

Implement Section 2 (`02-backend-api.md`), following "Implementation steps" in `chain.md`.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Shared types, store, stopper, service | done, reviewed | `d71ac82c`, `57a36915`, `e0cb88e1`, fix `bbf73d40` |
| 2 | Config, HTTP routes, WS handlers, wiring | not started | |
| 3 | CLI (sh, TS bin), doc, prompt | not started | |
| 4 | Desktop UI | not started | |
| 5 | Manual verification, final review | not started | |

## Facts for the next section

- Plan reviews are done. Round 2: 6 confirmed (`reviews/round-2-triage.md`), spec Amendments 9-11. Round 3: all round 2 fixes hold, plus 1 minor (Section 5 item 10), fixed (`reviews/round-3-triage.md`).
- Round 1 triaged in `reviews/round-1-triage.md` (all 11 confirmed; DS-08's promptless-Kimi part rejected as a known limitation). Fixes are in the section files, the plan index ("Plan review log", Review Focus) and the spec's new "Amendments" (items 1-8). Section 1 and 4 no longer write spec amendments for plan-time refinements; they only add implementation deviations.

- Base commit before implementation (final-review base): `c27573920a56ef3a021729c7cba3bb1046b9aaee`.
- Section 1 code matches the plan snippets exactly, plus the review fix. Verified: typecheck, scoped eslint/prettier, store 8, stopper 31, service 11; backend suite 868 pass / 0 fail; shared 214. Review triage: `reviews/impl-1-triage.md`.
- Section 2 consumes `createDevServerService`, `DevServerInputError`, `type DevServerService` (`services/dev-server-service.ts`) and `DevServerStore` (`services/dev-server-store.ts`) exactly as in the plan index.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage; every UI test file passes alone. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts` (`await expect(p).rejects.toThrow()` trips eslint `await-thenable`).
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

- Section 1 (review fix `bbf73d40`, spec Amendment 12): stopping the backend's own PID (or `<= 0`) fails `operation not permitted` with no process command run; the tree walk prunes the backend's subtree. Two stopper tests added (31 total).

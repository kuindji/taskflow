Committed `f32f107a` — `feat(backend): enforce API authentication`. No push.

Validation commands and results:

| Command | Result |
|---|---|
| Backend: `bun test src/ws tests/ws` | Expected FAIL first, then PASS: 100 tests |
| Backend: `bun test tests/services/cdp tests/api/browser-routes.test.ts` | Initially 1 fixture failure; then PASS: 88 tests |
| Backend: `bun test` | 1,192 pass, 2 skipped, 19 sandbox failures from blocked `ps` or missing filesystem events |
| Root: `bun test packages/shared/src` | PASS: 220 |
| TUI: `bun test` | PASS: 489 |
| Root: `bun test electron/src` | PASS: 78 |
| Root: `TMPDIR=/private/tmp bun run typecheck` | PASS |
| `bunx prettier --write/check <six changed files>` | PASS |
| `bunx eslint <six changed files>` | PASS |
| `git diff --check` and staged equivalent | PASS |

Individual root-level `bun test <file>` runs all passed for `connection-registry`, `backend-url`, `backend-store`, `ManageBackendsDialog`, `ConnectionOverlay`, `AccessTokenRow`, `hard-switch`, and the three `MarkdownPaneImpl` test files.

Deviations: the CDP broadcast fixture’s app socket also needed the existing auth subprotocol after enforcement. No design changes.

Step 6 was skipped as requested. `handoff.md` and the pre-existing untracked files remain untouched.

Release-note fact for the briefing session: `Clients older than this release can't connect; update every machine.`
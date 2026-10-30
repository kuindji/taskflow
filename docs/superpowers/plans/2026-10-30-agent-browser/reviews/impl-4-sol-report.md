Committed `e1ebcb34` — `feat(backend): filtered CDP gateway for browser tabs`. No push. Handoff updated.

Validation commands:

| Command | Result |
|---|---|
| `bun test …/cdp-filter.test.ts` | Expected FAIL, then PASS: 51 tests |
| `bun test …/cdp-gateway.test.ts` | Expected FAIL, then PASS: 17 tests |
| `bun test <CDP and API test files>` | PASS: 112 tests |
| `PATH="$PWD/packages/backend/node_modules/.bin:$PATH" bun run typecheck` | PASS |
| `bunx eslint <changed TS files>` | Initial lint errors corrected; PASS |
| `bunx prettier --write <changed files>` and `--check` | PASS |
| `git diff --check` | PASS |
| `cd packages/backend && bun test` | FAIL: 1,039 passed, 2 skipped, 20 failed, 1 error |
| `bun test tests/services/taskflow-cli.test.ts` | Rerun PASS: 46 tests |

Deviations: No implementation deviations. Bare typecheck hit Bun temp-write restrictions; using the installed compiler through `PATH` passed. The full suite retained 19 documented process/watcher sandbox failures and one CLI timeout that passed on rerun. [Full failure details](/tmp/taskflow-cdp-section4/backend-tests.log).

Spike method decisions:

- `WebMCP.enable`: denied as an unknown Chromium 130 domain; dedicated test added.
- `Browser.close`: remains denied because forwarding it quits Taskflow.
- No additional allowed methods were needed; all other recorded methods fit the prescribed rules and intercepts.


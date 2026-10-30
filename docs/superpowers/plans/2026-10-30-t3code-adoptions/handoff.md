# Handoff: adoptions from t3code

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next step needs. Don't add narrative.

Plan: `../2026-10-30-t3code-adoptions.md`. Design: `design.md`. Chain protocol: `chain.md`.

## Next step

Implement Section 2. Section 1 is implemented and smoke-tested in report-only mode. Full backend validation has the 19 baseline sandbox failures recorded below.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan written | done | 44400fd7 |
| — | Plan review round 1 | done: 5 majors and 11 minors confirmed (12 Codex + 4 own) and folded in | 069344e1 |
| — | Plan review round 2 | done: round-1 fixes hold; 2 majors and 5 minors confirmed and folded in | 29122909 |
| — | Plan review round 3 | done: round-2 fixes hold; 0 majors (2 downgraded), 5 minors confirmed and folded in; reviews done | 321591d4 |
| 1 | Auth core | done: TDD, typecheck, focused suites and smoke pass; 19 baseline sandbox failures in the full backend suite | 4bcd5792, cf6b9ad0, this commit |
| 2 | Auth, local clients | not started | |
| 3 | Remote connectivity | not started | |
| 4 | Auth, remote clients | not started | |
| 5 | Auth, browser endpoints, enforcement | not started | |
| 6 | Terminal | not started | |
| 7 | Scheduler | not started | |
| 8 | Git safety | not started | |
| 9 | Agent discovery | not started | |
| 10 | Desktop updater | not started | |
| 11 | Editor discovery | not started | |
| 12 | GitLab | not started | |
| 13 | Verification, final review | not started | |

## Facts for the next step

- Base commit before implementation (final-review base): `bf807eaea354b57763e3f994a4a77ddef519152f`.
- Section 1 outputs: `config.apiToken` is lazy; startup mints/reads `api-token-<instanceId>` through the shared uid/secret writer. Spawn handshakes are `<port>\n<token>\n`, published with a fresh `0600` temp file and rename. Electron and TUI use `parsePortHandshake`; the TUI handle carries `token`. Stable `<instanceId>.port` files still contain only the port.
- Section 1 auth: `AUTH_ENFORCED = false`; `createServer` requires a fifth `ServerAuth` argument. Host, Origin and credential checks precede all app/CDP routing, log to stderr once per reason/pattern/client, and serve requests in report-only mode. Tests inject enforcement and cover 403/401/4401, rejected-socket isolation and both subprotocol orders. Every PTY session gets `TASKFLOW_API_TOKEN` next to `TASKFLOW_API_URL`.
- Section 1 smoke: isolated `TASKFLOW_CONFIG_DIR`, `TASKFLOW_DEV=1`, `TASKFLOW_DEV_PORT=18799`, `TASKFLOW_PORT_FILE=<scratch>/hs`, branch `main`. The handshake has exactly two lines and its token matches `api-token-dev-main`; `ls -l` shows `-rw-------` for both. Two `curl -s http://127.0.0.1:18799/api/settings` calls return JSON and emit exactly one `[auth] report-only: would reject (credential) GET /api/settings from ua=curl`. Backend stopped cleanly, exit 0.
- Section 1 validation: config 16/0; handshake 45/0 on retry; request checks/socket 41/0; CDP 74/0; session handlers 40/0; final focused request/session/repro set 85/0; shared 224/0; TUI 449/0. Root typecheck and Electron build pass. Changed-file ESLint and `git diff --check` pass. TDD red runs observed missing exports/modules and the missing session env key before implementation.
- Section 1 environment limits: full backend `bun test` = 1118 pass, 2 skip, 19 fail. All 19 reproduce from a plain `git archive` snapshot of the original `bf807eae` sources in the same sandbox: process-stopper 6 (`ps` EPERM), file-watcher 3, file-watcher-ownership 1, wiki-index 5, recursive-watcher 4 (watch events absent). These source/test files are unchanged. No branches/worktrees created. Run the full backend suite outside this sandbox before claiming it green. The handshake set initially hit the known platform SIGTERM exit-143 flake; its unchanged rerun passed 45/0. Final typecheck uses `TMPDIR=/private/tmp` after Bun's default temp path returned EPERM.
- Implementation waits for the agent-browser chain (`../2026-10-30-agent-browser/handoff.md`, Next step "None: complete"). Plan reviews don't.
- **Push order:** the agent-browser feature's `/cdp/` upgrade (`ws/server.ts`) and `/api/browser/*` routes are as unauthenticated as the rest of the API until Section 5 here enforces auth. Tell the user not to push the browser work separately before Section 5, unless they accept that.
- The agent-browser plan already took the browser-specific t3code lessons (commit `38523814`, its spec Amendment 12). Don't redo them here.
- t3code source: fetch commit `32ecd71726fee16f335484c1f95cbce126d461f6` into your scratchpad with the command in `design.md` (the short SHA can't be fetched).
- Plan reviews are done (3 rounds). Round 3 added: S4 moves `ConnectionOverlay` out of `App.tsx` and exports `switchRefusal` from `MachinesMenu.tsx`; S6 Task 6.3 touches `WebSocketProvider.tsx` (dev renderer readiness) and adds its first test file.
- **User decision 2026-10-30:** don't stop the chain for the agent-browser feature's open manual checks (hand typing, Windows/Linux close, remote workspaces, `newCDPSession`). The user tests the browser work and this plan together after Section 13. Stop only for the reasons in `chain.md`.
- The agent-browser work is fully committed (tree clean at 841437f4). Line anchors in UI files may still differ from the plan; sections say to find code by landmarks.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.

## Deviations from the design

- Section 1 has no design changes. The TUI late-write deadline fixture now writes a complete two-line handshake, preserving its timing assertion. Socket tests use a local constructor type for Bun's supported custom-header options, which the installed DOM `WebSocket` type omits. The full backend suite's expected PASS cannot be obtained in this sandbox; all 19 failures reproduce on the original sources as recorded above.

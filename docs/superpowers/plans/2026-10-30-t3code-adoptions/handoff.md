# Handoff: adoptions from t3code

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next step needs. Don't add narrative.

Plan: `../2026-10-30-t3code-adoptions.md`. Design: `design.md`. Chain protocol: `chain.md`.

## Next step

Implement Section 2.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan written | done | 44400fd7 |
| — | Plan review round 1 | done: 5 majors and 11 minors confirmed (12 Codex + 4 own) and folded in | 069344e1 |
| — | Plan review round 2 | done: round-1 fixes hold; 2 majors and 5 minors confirmed and folded in | 29122909 |
| — | Plan review round 3 | done: round-2 fixes hold; 0 majors (2 downgraded), 5 minors confirmed and folded in; reviews done | 321591d4 |
| 1 | Auth core | done: Codex review clean, 1 minor triaged (no change); backend 1137/0, shared, TUI, typecheck, Electron build pass | 4bcd5792, cf6b9ad0, f651167e, 6c5641dc |
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
- Section 1 outputs: `config.apiToken` (lazy, file `api-token-<instanceId>`, `0600`). Spawn handshake `<port>\n<token>\n` via `writePortHandshake`; Electron `startBackend` resolves `{ port, token }` (main.ts keeps only `port` for now); TUI `BackendHandle.token`. Stable `<instanceId>.port` files still hold only the port. `createServer(router, port, apiRouter, cdpGateway, auth: ServerAuth)`; `AUTH_ENFORCED = false` in `ws/auth.ts`. PTY sessions get `TASKFLOW_API_TOKEN`.
- Section 1 smoke (sandbox, `TASKFLOW_DEV_PORT=18799`): handshake has two lines, it and `api-token-dev-main` are `-rw-------`; two `curl /api/settings` answer and log one `[auth] report-only: would reject (credential) GET /api/settings from ua=curl`.
- Report-only log lines today, from the backend's own tests: CDP clients give `(credential) GET /cdp/* from ua=Bun` and `WS /cdp/* from ua=none`. Section 5 handles CDP.
- Running Sol: `codex exec -m gpt-6.1-sol -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$PWD/.git" -C "$PWD" -o <report> - < <brief>`. In its sandbox 19 backend tests fail (process-stopper, watchers: `ps` EPERM, no FS events) and typecheck needs `TMPDIR=/private/tmp`; rerun the suites yourself outside it. Sol also edits `handoff.md`; rewrite its entries tightly.
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

- Section 1: none to the design. The TUI late-write deadline fixture writes a full two-line handshake; `server.test.ts` types Bun's header-capable `WebSocket` constructor locally (DOM typings omit it).

# Handoff: adoptions from t3code

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next step needs. Don't add narrative.

Plan: `../2026-10-30-t3code-adoptions.md`. Design: `design.md`. Chain protocol: `chain.md`.

## Next step

Plan review round 1.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan written | done | 44400fd7 |
| — | Plan review round 1 | not started | |
| 1 | Auth core | not started | |
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

- Base commit before implementation (final-review base): not recorded yet. The Section 1 session records it.
- Implementation waits for the agent-browser chain (`../2026-10-30-agent-browser/handoff.md`, Next step "None: complete"). Plan reviews don't.
- **Push order:** the agent-browser feature's `/cdp/` upgrade (`ws/server.ts`) and `/api/browser/*` routes are as unauthenticated as the rest of the API until Section 5 here enforces auth. Tell the user not to push the browser work separately before Section 5, unless they accept that.
- The agent-browser plan already took the browser-specific t3code lessons (commit `38523814`, its spec Amendment 12). Don't redo them here.
- t3code source: fetch commit `32ecd717` into your scratchpad with the command in `design.md`.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.

## Deviations from the design

(none yet)

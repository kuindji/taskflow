# Handoff: adoptions from t3code

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next step needs. Don't add narrative.

Plan: `../2026-10-30-t3code-adoptions.md`. Design: `design.md`. Chain protocol: `chain.md`.

## Next step

Implement Section 1. **Chain stopped:** the agent-browser chain isn't finished (its handoff says "Implement Section 6"), and chain.md forbids starting implementation before it is. Restart this chain once that handoff says "None: complete".

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan written | done | 44400fd7 |
| — | Plan review round 1 | done: 5 majors and 11 minors confirmed (12 Codex + 4 own) and folded in | 069344e1 |
| — | Plan review round 2 | done: round-1 fixes hold; 2 majors and 5 minors confirmed and folded in | 29122909 |
| — | Plan review round 3 | done: round-2 fixes hold; 0 majors (2 downgraded), 5 minors confirmed and folded in; reviews done | 321591d4 |
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
- t3code source: fetch commit `32ecd71726fee16f335484c1f95cbce126d461f6` into your scratchpad with the command in `design.md` (the short SHA can't be fetched).
- Plan reviews are done (3 rounds). Round 3 added: S4 moves `ConnectionOverlay` out of `App.tsx` and exports `switchRefusal` from `MachinesMenu.tsx`; S6 Task 6.3 touches `WebSocketProvider.tsx` (dev renderer readiness) and adds its first test file.
- The agent-browser chain has uncommitted edits in `packages/ui/src/stores/backend-store.ts` and other UI files. Line anchors there may shift; sections say to find code by landmarks.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.

## Deviations from the design

(none yet)

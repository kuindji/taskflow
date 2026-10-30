# Plan review round 2: triage

Codex report: `round-2.md` (gpt-6.1-sol, 0 blockers, 3 major, 4 minor). It found every round-1 fix in place and the `snapshot: null` history fallback sound. Each finding checked against the code by the Opus session.

| # | Verdict | Severity | Why |
|---|---|---|---|
| 1 | confirmed | major | `drop` → `closeConnection` clears the registry's `primaryId` (`connection-registry.ts:87-90`); `attach` never calls `setPrimary`, and `onPrimaryStatusChange` reports disconnected while `primaryId` is null (`:193-195`). A primary remote (hard switch, `backend-store.ts:553`) stays behind the overlay after S3's auto-reconnect or S4's `4401` recovery. Pre-existing for manual Retry, but S3/S4 make it the recovery path. Fixed in S3 Task 3.3: `attach` restores primary via `setPrimaryBackend(liveId)` when the store's `primaryId` names the machine; tests in S3 and S4. |
| 2 | confirmed | major | `GET /api/sessions/:sessionId/snapshot` passes `ptyManager.getSnapshot()` straight to `jsonResponse(unknown)` (`session-routes.ts:306`). S6's parser wait makes it async, so a missed `await` compiles and answers `{}` to both CLIs. The amendment named no files. Fixed: S6 Task 6.1 Files and the planner decision list the async signature, both callers, the fakes and two route tests. |
| 3 | confirmed, downgraded to minor | minor | `updateBackend` only persists (`backend-registry.ts:440-462`), `refresh` keeps the row's failure (`backend-store.ts:342`), so a token save leaves an `unauthorized` row offline and unwanted. Manual Retry still recovers (`attach` clears failure, `:212`), so not major. Decision 4 promised it with no step. Fixed in S4: the dialog calls `retry` after a token save on an `unauthorized`, `keepAttached` row; dialog-driven tests; S13 item 6 reworded. |
| 4 | confirmed | minor | `persist` uses the fixed `${file}.tmp` (`backend-registry.ts:96`); `writeFile`'s `mode` doesn't apply to an existing file, so a leftover `0644` temp would publish tokens world-readable. Fixed in S4: unique temp name, `flag: "wx"`, `rm` in `finally`; test with a leftover `0644` temp. |
| 5 | confirmed | minor | S9's launch-budget test asserted only "before 30 000 ms", so a 25 s budget passes. Fixed: assert the 10 000 ms boundary with the injected clock, child killed, no late effects after 60 000 ms. |
| 6 | confirmed | minor | `taskflow-cli.sh:43` is a comment containing `` `curl -sf` ``, which matches S2's regex. Fixed: the assertion ignores comment lines. |
| 7 | confirmed | minor | S13 item 5 expected rejection for any wrong manual token; with a readable remote token the one refresh recovers. Fixed: two cases, matching S5 Task 5.2 Step 6 item 7. |

Own checks: no further findings. Section 4's desktop and TUI `4401` paths traced against `backend-store.ts` (`handshake`, `rehandshake`, `followSocket`, `attempts`) and hold.

Result: 2 confirmed majors (1, 2). Next step: plan review round 3.

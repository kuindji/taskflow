# Final review triage

Review: `final.md` (gpt-6.1-sol, `codex exec -s read-only`, range `bf807eae..HEAD` at ed35debe).

1. **Blocker, confirmed, fixed in 32a73588.** A raw `GET /` with `Upgrade: websocket, h2c` and no credential passed the identity exemption (`isUpgradeRequest` compared the whole header to `websocket`), and `server.upgrade` then opened a full app socket. Reproduced over TCP against the sandbox backend: `101`, then the router answered (`git:change-stats`, `system:clients`). Fix: the exemption needs no `Upgrade` header at all and returns `{ ok: true, anonymous: true }`; the server answers `Taskflow backend` for it before any upgrade; `isUpgradeRequest` splits the header into tokens as Bun does. Tests: `server.test.ts` raw-TCP regression (gets `4401`), `auth.test.ts` token cases. Browsers can't set `Upgrade`, so the exposure was to local processes, but it bypassed the design's only exemption.
2. **Major, confirmed, fixed in fda0e0ee.** `ScheduleStore` wrote with plain `writeFile` while `getById`/`getAll` read without the lock, so a read could see a truncated file and the spawn path's `catch` closed a session that had started. Reproduced as the known flake (`startup runs an overdue cron once…`, `JSON Parse error` at `schedule-store.ts:14`, 1 in ~25 runs). Fix: the store's three writes use the existing `writeJsonAtomic`. Test: a save replaces the file by rename (inode changes, no temp left); 30 consecutive scheduler-suite runs, 0 fails.
3. **Minor, confirmed, fixed in 6032b8c4** (also found by hand in item 2 before the report arrived). Bun echoes the first offered subprotocol when the upgrade sets none, so an offer of only `taskflow.auth.<token>` came back in `Sec-WebSocket-Protocol`. An empty header value doesn't suppress it (Bun sends both). Fix: such an upgrade gets HTTP `401` and is never upgraded (`offersUnansweredToken` in `auth.ts`). Test in `server.test.ts`.

## Re-review of the fixes

Review: `final-2.md` (gpt-6.1-sol, `codex exec -s read-only`, commits 6032b8c4, 32a73588, fda0e0ee, 3ccc65bd). Auth fixes, shell fix and tests: no findings.

4. **Major, confirmed, fixed in 67c17c25.** Under `~/Library/CloudStorage` (File Provider), `writeJsonAtomic` falls back to an in-place write, so the torn read from finding 2 remained there. Fix: `getAll`/`getById`/`findBySessionId` run in the store's mutation queue; mutations read through a private `readAll`. Tests: a `getAll` and a `getById` issued during a save see the saved record (both failed before); scheduler suite 15 runs, 0 fails.

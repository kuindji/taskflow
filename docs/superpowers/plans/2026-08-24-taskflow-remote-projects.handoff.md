# Handoff — Taskflow Remote Projects

Plan: `docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md`

Branch: `task/implement-remote-backend-services` (worktree)

Plan baseline (last plan-revision commit): `6978606`

Tasks 3, 4, 6 and 7 are executed from the superseded plan
(`docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md`, its Tasks 2, 3, 5, 6)
with the deltas listed in this plan. Delete in-tree repros as listed in the plan's
"Notes for the executor" when their task lands.

## Tasks

| # | Task | Status | Base commit | Commits | Review rounds |
|---|---|---|---|---|---|
| 1 | Backend prerequisites — protocol version, stable port file, backend uid | clear | `6978606` | `e7a226c`, `c192cdb`, `586a138`, `6e3673b`, `de96b4e` | R1: 3 fixed, 1 rejected; R2: 2 fixed; R3: 1 fixed; R4: 1 fixed; R5: clean |
| 2 | Per-client file watcher ownership | clear | `43d1a49` | `ea8574a`, `ea2000e` | R1: 1 fixed; R2: clean |
| 3 | Shared discovery types and the pure beacon codec | clear | `f32c53f` | `a0a0907`, `cd0fc47` | R1: 2 fixed; R2: clean |
| 4 | The advertiser and listener, and the backend that runs one | clear | `443a0cd` | `a64af14`, `235d583`, `d5ac582` | R1: 1 fixed; R2: 1 fixed; R3: clean |
| 5 | The backend record list, keyed by uid | in-review round 2 done | `cfe462d` | `be34c1b`, `d9c59ab`, `4ec0bcd` | R1: 3 fixed, 1 deferred to Task 9; R2: 1 fixed |
| 6 | SSH argument construction and failure classification | pending | | | |
| 7 | The tunnel manager | pending | | | |
| 8 | One connection per backend | pending | | | |
| 9 | The registry, the attached set, and the IPC surface | pending | | | |
| 10 | The renderer's attached set — backend-store, handshake, detach | pending | | | |
| 11 | Per-backend slices, revision guards, and the project and task stores | pending | | | |
| 12 | The remaining aggregating stores | pending | | | |
| 13 | Session state per backend | pending | | | |
| 14 | Per-machine caches and path-keyed stores | pending | | | |
| 15 | Editor identity across machines | pending | | | |
| 16 | Machine sections in the sidebar | pending | | | |
| 17 | The machines menu and its dialogs | pending | | | |
| 18 | Routing for sidebar rows and background work | pending | | | |
| 19 | Primary-only managers, gating, and removing the shim | pending | | | |
| 20 | Electron main across several backends | pending | | | |
| 21 | The hard switch | pending | | | |
| 22 | End-to-end verification on two machines | pending | | | |

## Review round results

### Task 1, round 1 (Codex gpt-5.5, prompted review of `6978606..e7a226c`)

Four findings, each checked by hand:

1. **Uid mint race — confirmed, fixed.** Six processes minting into one empty dir
   returned more than one uid in 15/15 trials. Now temp file + `linkSync` (EEXIST →
   adopt winner). Test: "backends starting at the same moment agree on one uid".
2. **Stable port file stale/deleted by the wrong backend — confirmed (trace), fixed.**
   Startup failure after the write left it; the older of two same-instance backends
   deleted the newer one's file. New `services/instance-port-file.ts`
   (`removeInstancePortFile(file, port)` removes only when the file names that port),
   called on shutdown and in the startup `catch`. Test:
   `packages/backend/tests/services/instance-port-file.test.ts`.
3. **`toSafeLabel` collapses distinct branch names — rejected.** Plan-specified
   behaviour; the git fallback (`/`→`-`) and TUI `sanitizeBranch` already collapse
   the same way; needs two dev branches differing only in punctuation running at once.
4. **Importing config writes the uid into the real config dir — confirmed, fixed.**
   The test preload's `process.env.HOME` override does not reach `os.homedir()`;
   `~/.config/taskflow/backend-uid-main` was minted by the Task 1 test run
   (born 08:36:18, commit 08:38:02). `config.backendUid` is now a memoized getter.
   Test: "importing config writes no uid file; reading backendUid mints it".

### Task 1, round 2 (Codex gpt-5.5, prompted review of `6978606..c192cdb`)

Two findings, both reproduced before fixing:

1. **Port file removal is check-then-delete — confirmed, fixed.** A backend
   shutting down read its own port, a newer same-instance backend wrote its port,
   then the first deleted the file. Scratch stress repro: 2589/3000 lost. Now the
   file is renamed aside atomically, judged there, and linked back when not ours
   (link fails if a newer file was written meanwhile). Test: "never deletes a port
   file written while the removal is under way" (266/300 lost before the fix, 0 after).
2. **Corrupt uid file repair races — confirmed, fixed.** Six backends starting on
   an invalid `backend-uid-main` reported more than one uid in 5/10 trials (6
   distinct in the test run). The repair is now serialized with a `mkdir` lock
   (`<file>.lock`, taken over after 10 s as stale) and re-reads under the lock.
   Test: "backends repairing a corrupt uid file at the same moment agree on one uid".

### Task 1, round 3 (Codex gpt-5.5, prompted review of `6978606..586a138`)

One finding, reproduced before fixing:

1. **Port file lost when a backend starts while another shuts down — confirmed,
   fixed in `6e3673b`.** Startup wrote the stable port file in place, so its write
   could land in the inode the shutting-down backend had just renamed aside and
   deleted. The 300-iteration unit test missed it (0/30 runs failed); a
   20000-iteration scratch stress of remover vs plain `writeFile` lost the file
   in 2/60000. New `writeInstancePortFile` (temp file + rename) is used by
   `index.ts`, and the race test now drives that production writer. Stress with
   the writer: 0/100000. No other substantive findings from Codex.

### Task 1, round 4 (Codex gpt-5.5, prompted review of `6978606..b0e49f3`, packages only)

One finding, reproduced before fixing:

1. **Fixed-port restart deletes the new backend's port file — confirmed, fixed in
   `de96b4e`.** Shutdown (and the startup-failure `catch`) called `stop()` before
   removing the stable port file. With `TASKFLOW_DEV_PORT`, a successor backend can
   bind the freed port and write identical contents, so the ownership check passes
   and the old backend deletes it. New `releaseInstancePort(file, port, stop)` in
   `services/instance-port-file.ts` removes the file first and stops in `finally`;
   both paths in `index.ts` use it. Test: "a backend that takes over a fixed port
   keeps its port file" (red with the old order, green after). No other findings.

### Task 1, round 5 (Codex gpt-5.5, prompted review of `6978606..42b6fdb`, packages only)

Clean: no findings. Codex reran the four Task 1 test files and `bun run typecheck`,
both passing. My own read of the full diff found nothing either; the only producer
of `SystemInfo` is `handlers/system.ts`, so the newly required `hostname` breaks no
other code. **Task 1 is clear.**

### Task 2, round 1 (Codex gpt-5.5, prompted review of `43d1a49..ea8574a`, packages only)

One finding, reproduced before fixing (I had found the same one independently):

1. **A watch requested just before a disconnect leaks — confirmed, fixed in `ea2000e`.**
   `FILE_WATCH` awaits `assertWorkspacePath` before `fileWatcher.watch`; if the socket
   closes during that await, `close` runs `releaseClient` first (nothing to release),
   then the handler registers a watch owned by a gone client, and the recursive watcher
   runs for the life of the backend. Handler-level scratch repro: a file write after
   `releaseClient` still broadcast `FILE_CHANGED` (1 event, expected 0). Fix: the
   server's `message` handler, in `finally`, fires the disconnect callback again when the
   socket is no longer in `clients`; `releaseClient` is idempotent. Test in
   `packages/backend/src/ws/server.test.ts`: "releases what a request acquired after its
   socket had already closed" (red on `ea8574a`, green after). No other findings.

### Task 2, round 2 (Codex gpt-5.5, prompted review of `43d1a49..ea2000e`, packages only)

Clean: no findings. Codex checked owner-set interleavings (watch/unwatch/close order,
several clients on one path, unwatch of an unowned path), broadcast semantics, client id
minting and the R1 re-disconnect in `ws/server.ts`; it reran
`file-watcher-ownership.test.ts` + `ws/server.test.ts` (8 pass) and the backend typecheck
(pass). My own read found nothing either. The one sharp edge, `onError` forgetting the entry
and its owners so the next `FILE_WATCH` recreates it with only that client, is the behaviour
the plan's Step 3 explicitly accepts. **Task 2 is clear.**

### Task 3, round 1 (Codex gpt-5.5, prompted review of `f32c53f..a0a0907`, packages only)

Two low-severity findings, both plan-faithful gaps at the LAN trust boundary, both
reproduced with failing tests before fixing (`cd0fc47`):

1. **Non-integer `protocolVersion` accepted — confirmed, fixed.** `"protocolVersion":1e309`
   is valid JSON, parses to `Infinity`, and came back as a valid announce (serializes to
   `null` over IPC/JSON later). Now `Number.isInteger`. Test: "returns null for a
   protocolVersion that is not an integer" (1e309, 1.5, -1e309).
2. **`displayName` over `DISCOVERY_MAX_DISPLAY_NAME` accepted — confirmed, fixed.** An
   800-char name fits in the 1 KiB datagram and was returned whole. The advertiser (superseded
   plan Task 3 Step 9, i.e. this plan's Task 4) clamps with `.slice(0, 64)` in UTF-16 units,
   so the parse-side `length > 64` check never rejects an honest backend. Test: "returns null
   for a displayName longer than the cap".

Codex otherwise found no drift from the superseded plan's Task 2 or Deltas A–C, no extra
returned keys, and no name/signature drift against later consumers. My own read agreed; the
`@taskflow/shared/discovery` subpath the later tasks import is created by Task 4 (superseded
Task 3 Step creating `discovery/index.ts` + package `exports`), so its absence is expected.

### Task 3, round 2 (Codex gpt-5.5, prompted review of `f32c53f..cd0fc47`, packages only)

Clean: no findings. Codex checked encode/parse round trips, malformed JSON, wrong types,
extra fields (dropped by the normalized return), oversized datagrams, prototype-pollution
keys (no merge path), and name/signature drift against later consumers; it reran
`bun test packages/shared/src/discovery` (15 pass) and `bun run typecheck` (pass). My own
read of the diff found nothing either: `displayName` is capped in UTF-16 units, matching the
advertiser's `.slice(0, 64)`; `appVersion`/`os` are bounded only by the 1 KiB datagram cap,
which is what the plan specifies. **Task 3 is clear.**

### Task 4, round 1 (Codex gpt-5.5, prompted review of `443a0cd..a64af14`, packages + `electron/package.json`)

One finding, reproduced with a failing test before fixing:

1. **Listener table unbounded on an untrusted LAN — confirmed, fixed in `235d583`.** Valid
   announces under distinct hostnames each added a `seen` entry (kept until stale, 15 s) and
   copied the whole table into `onChange`. New `DISCOVERY_MAX_BACKENDS = 64`
   (`packages/shared/src/constants.ts`); newcomers past the cap are ignored, known ids keep
   refreshing. Test in `socket.test.ts`: "a listener tracks at most DISCOVERY_MAX_BACKENDS
   machines however many announce" (100 announced → Received 100 before the fix, 64 after;
   LAN-gated like the other socket tests).

Codex otherwise found the socket lifecycle, membership refresh, settings path, advertiser wiring
(with `backendUid`) and UI wiring matching the spec. Not verified by it: `bun build --compile`
JSON import and the packaged local-network prompt (already deferred to Task 22).
My own suspicion that an async send failure emits `error` and permanently kills discovery was
tested and rejected: sends to 0.0.0.1 / 240.0.0.1 / broadcast and a 70 KB datagram produced
neither an `error` event nor a throw in Bun or Node.

### Task 4, round 2 (Codex gpt-5.5, prompted review of `443a0cd..235d583`, packages + `electron/package.json`)

One finding, which I had found independently and fixed (`d5ac582`) before the report landed:

1. **Hand-edited `network` values of the wrong type crash the backend — confirmed, fixed.**
   `SettingsStore.get()` spread `parsed.network` without type checks, so
   `{"network":{"discoverable":"no","displayName":5}}` started the advertiser (truthy string)
   and its payload called `displayName.trim()` inside the bind callback. The backend has no
   `uncaughtException` handler; a scratch script confirmed a throwing timer callback exits Bun
   with code 1. New `normalizeNetworkSettings` (same shape as `normalizeRemoteAgentSettings`).
   Test: "replaces hand-edited network values of the wrong type with defaults" (red before, green after).

Codex otherwise found socket start/stop idempotence, bind-stop settlement, stale expiry freeing
capped slots, membership refresh, shutdown wiring, `backendUid` in the payload, and hostile
datagram parsing sound; it reran `bun test packages/shared/src/discovery` (20 pass) and typecheck.

### Task 4, round 3 (Codex gpt-5.5, prompted review of `443a0cd..d5ac582`, packages + `electron/package.json`)

Clean: no findings. Codex checked the socket lifecycle, listener cap, malformed datagrams, network
settings persistence and the update hook, advertiser wiring with `backendUid`, UI wiring and the
package export split; it reran `bun test packages/shared/src/discovery` (20 pass),
`settings-store.test.ts` (20 pass) and `bun run typecheck` (pass). My own read of the full diff
found nothing substantive either (see the display-name decision below). **Task 4 is clear.**

### Task 5, round 1 (Codex gpt-5.5, prompted review of `cfe462d..be34c1b`)

Four findings; three reproduced with failing tests (red on `be34c1b`, 3 fail / 7 pass) and
fixed in `d9c59ab`, one deferred:

1. **Confirmed record under a stale id duplicates on adoption — confirmed, fixed.** A
   hand-edited `backends.json` entry `{id:"desktop.local:main", backendUid:"abc123"}` kept
   its id, so `adoptUid(…, "192.168.1.20:main", "abc123")` left two records with uid
   `abc123`. `normalizeRecords` now keys confirmed records by uid and drops duplicate ids.
   Test: "a confirmed record saved under a stale id is keyed by its uid, and adopting that
   uid merges into it".
2. **Persisted ports unvalidated — confirmed, fixed.** `sshPort: 0`, `lastKnownPort: -1`
   (and `22.5`, `70000`) were accepted; Task 9 would try port -1. Now `isValidPort`,
   extracted from `parseDatagram`'s inline check into `packages/shared/src/discovery/beacon.ts`
   and reused. Test: "ports outside 1-65535 fall back to their defaults".
3. **Unsaved menu rows keyed by announced uid collide — confirmed, fixed.** Two live beacons
   sharing a uid (spoofed, or a cloned config dir) gave two rows with id `abc123`, and Task 9's
   `addDiscoveredBackend` would save whichever came first. Rows are now keyed by
   `backendIdFor(address, instanceId)` — the id `recordFromDiscovered` saves under. The plan's
   Task 9 interface text, its test call and its lookup were amended to match. Test: "two
   unsaved machines announcing one uid get distinct rows, keyed as they would be saved".
4. **`adoptUid` rekeys an already-confirmed record onto a different uid — deferred to Task 9.**
   True of the function (`adoptUid([{id:"abc123",backendUid:"abc123"}], "abc123", "def456")`
   yields id `def456`), but plan-faithful, and the only caller is Task 9's `confirmBackend`,
   which also moves tunnels and origins by id. Guarding inside `adoptUid` alone would leave that
   caller inconsistent. A note was added to the plan's `confirmBackend` code telling the Task 9
   implementer to decide refuse-vs-adopt there and test it.

### Task 5, round 2 (Codex gpt-5.5, prompted review of `cfe462d..d9c59ab`)

One finding, reproduced with a failing test before fixing:

1. **A stale-id duplicate listed first erases the canonical record — confirmed, fixed in
   `4ec0bcd`.** Introduced by R1's uid re-keying: `[{id:"desktop.local:main",backendUid:"abc123",…},
   {id:"abc123",backendUid:"abc123",host:"192.168.1.20",sshPort:2222,attached:true}]` both
   normalize to id `abc123` and the first won, losing host, ssh port and `attached`. Only a
   hand-edited file can hold this (the registry always writes id = uid). Now the row whose saved
   id already equals its canonical id wins, in the first row's position; otherwise the first
   row still wins. No field merging. Test: "a record already saved under its uid wins over a
   stale-id duplicate listed before it" (red on `d9c59ab`, green after).

Codex otherwise checked Task 9/17 consumer names and semantics and found no `as any`. My own
suspicion, not filed: the listener keys by announced hostname, so one source address announcing
two hostnames (e.g. a machine renamed while running, for up to 15 s) yields two unsaved menu rows
with the same id. `addDiscoveredBackend` would save the same record from either row; the only
effect is a duplicate row/React key for Task 17 to tolerate.

## Decisions taken

- Commits follow the project CLAUDE.md: no Co-Authored-By trailer.
- Task 1: `packages/backend/src/index.ts` already fails `prettier --check` at the
  plan baseline (the `SYSTEM_CLIENTS` registration); left as is, not part of this task.
- Task 1 R1: `config.backendUid` is a lazy getter rather than the plan's eager field;
  the interface (`config.backendUid: string`) is unchanged. It is still minted at
  startup because `registerSystemHandlers` reads it.
- Task 1 R1: the test-minted `~/.config/taskflow/backend-uid-main` holds a valid uid
  and is left in place (it is the file the real backend would mint anyway).
- Task 1 R1: `packages/tui/src/dev.ts:68` prints an unsanitized `dev-${branch}` label
  when `TASKFLOW_DEV_BRANCH` holds characters outside the safe set. Display-only, not fixed.
- Task 2: the plan's Step 10 says only `tests/ws/router.test.ts` needs a context argument,
  but tsc found 110 two-argument `router.handle` calls in 9 more handler test files
  (`tests/handlers/*`, `src/handlers/system.test.ts`, `session-log-leak.repro.test.ts`).
  Threading `{ clientId: "test" }` through each made prettier reflow ~840 lines, so those
  tests use a new `packages/backend/tests/test-router.ts` (`TestRouter extends Router`,
  `handle` defaults the context). Production `Router.handle` keeps `ctx` required, so a
  server path that forgets it still fails to compile. `router.test.ts` tests `Router`
  itself and passes the context explicitly, as the plan says.
- Task 2: one client watching a path twice holds one reference (owners is a `Set`), so a
  single `FILE_UNWATCH` from it releases the watch. Same as before the change; the UI's
  `file-store` watches at most one path per client and unwatches before re-watching.

- Task 3: `parseDatagram` validates `backendUid` with `isSafeLabel` (Delta A). The real
  uid is 32 lowercase hex (`packages/backend/src/config.ts:88`), well inside the safe set;
  the test fixture uses that shape. Besides the plan's "missing backendUid" test, one more
  test rejects unsafe/non-string uids, so the codec suite is 13 tests, not the plan's 10.
- Task 3: `types/backend.ts` holds no `BackendRecord` and no `MenuEntry` (Delta C); Task 5
  writes the only `BackendRecord`. The `MEMBERSHIP_REFRESH_MS` comment dropped the
  superseded spec's line reference.
- Task 4: `SettingsStore.update()` also applies `partial.network` (`applyNullable`). The
  superseded plan's Step 8 adds defaults/clone/merge but no update branch, so a Settings
  toggle would never have persisted. New test "persists a network update and tells update
  listeners the re-read settings".
- Task 4: the superseded plan's "stopping the advertiser stops new announcements" test
  flaked 1/6 as written (a loopback duplicate of a pre-stop announce landed 75 ms after
  `stop()`). The test now waits 300 ms after `stop()` before sampling `lastSeenAt`;
  20/20 runs pass. The multicast test also asserts `backendUid` comes through.
- Task 4: the plan's long code comments were trimmed of references to the superseded
  spec's line numbers and review-round history; the substance is kept.
- Task 4: Step 7's packaged-app check (build with `bun run package`, launch, see the macOS
  local-network prompt) was not run — it needs a signed packaging run. Only the
  `extendInfo` entry was added. Re-check during Task 22.
- Task 4: the listener still keys entries by `backendIdFor(hostname, instanceId)` (the plan's
  delta says no listener change). Task 5 decides uid keying for records.
- Task 4: `AppSettings.network` is required, so three fixtures gained it:
  `packages/backend/tests/services/settings-store.test.ts`, `packages/tui/src/settings/store.test.ts`,
  `packages/tui/src/opentui/app.test.ts`.
- Task 4 R3: the "Name on the network" input sends one non-optimistic `SETTINGS_UPDATE` per
  keystroke and renders the server's answer. That is the existing Settings pattern
  (`RemoteSection` `appName` does the same), so it was left consistent rather than changed here.
- Task 5: `electron/package.json` already had a `dependencies` block; `@taskflow/shared` was
  added to it. `bun install` also refreshed `bun.lock`'s stale electron version
  (0.14.2 → 0.14.4); committed with the task.
- Task 5: `removeRecord`, `matchesDiscovered`, `mergeForMenu` and `MenuEntry` are exported as the
  plan's interface specifies, though nothing consumes them until Task 9. The plan's test file
  covers only `adoptUid`, `recordFromDiscovered`, `normalizeRecords` and `upsertRecord`; it was
  taken as written.
- Task 5 R1: `MenuEntry.id` for an unsaved discovered row changed from the announced uid to
  `backendIdFor(address, instanceId)`; plan Task 9 (`addDiscoveredBackend` interface, test,
  lookup) amended in `d9c59ab`. Task 17 must pass that id to `addDiscoveredBackend`.
- Task 5 R1: `adoptUid` still merges only against `record.id === backendUid`; with
  `normalizeRecords` canonicalizing confirmed ids, a `backendUid` lookup there would be redundant.

## Validation baseline

After Task 5 R2 fix (`4ec0bcd`): `bun test electron/src/backend-records.test.ts
packages/shared/src/discovery/beacon.test.ts` 26 pass (records 11); `bun run typecheck` clean;
eslint and prettier clean on the two changed files.

After Task 5 R1 fix (`d9c59ab`): `bun test electron/src/backend-records.test.ts
packages/shared/src/discovery/beacon.test.ts` 25 pass (records 10); `bun run typecheck` clean;
eslint and prettier clean on the three changed source files.

After Task 5 (`be34c1b`): `bun test electron/src/backend-records.test.ts` 7 pass (red first:
module missing); `bun run typecheck` clean (incl. electron's Bun-less `tsconfig.src.json`);
eslint and prettier clean on the changed files. Additive electron + shared-type change with no
consumers yet, so the full suite was not rerun.

After Task 4 R2 fix (`d5ac582`): `settings-store.test.ts` 20 pass; `bun run typecheck` clean;
eslint and prettier clean on the two changed files.

After Task 4 R1 fix (`235d583`): `bun test packages/shared/src/discovery` 20 pass, 5/5
repeated runs; `bun run typecheck` clean; eslint and prettier clean on the three changed files.
Change is listener-only in `packages/shared`, so the backend suite was not rerun.

After Task 4 (`a64af14`): `bun test packages/shared/src/discovery` 19 pass (socket test
20/20 repeated runs); `packages/backend` 671 pass, 2 skip, 0 fail; settings/handlers/tui
store/shared combined 225 pass; tui `app.test.ts` 34 pass; `bun run typecheck` clean;
`bun run build:ui` ok and no `node:dgram` in `packages/ui/dist/assets`; eslint clean;
prettier clean except the known baseline `SYSTEM_CLIENTS` block in `backend/src/index.ts`.
Live smoke: sandboxed backend (fake HOME, `TASKFLOW_DEV_PORT=48917`) was found by a scratch
listener with `backendUid` matching `backend-uid-main`, `appVersion` 0.14.4.

After Task 3 R1 fix (`cd0fc47`): `bun test packages/shared` 130 pass, 0 fail (codec 15);
`bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 3 (`a0a0907`): `bun test packages/shared` 128 pass, 0 fail; beacon codec 13
pass; `bun run typecheck` clean; eslint and prettier clean on the changed files. Change is
shared-package-only and additive (new files, new constants, one barrel line), so the full
suite was not rerun.

After Task 2 R1 fix (`ea2000e`): `bun test packages/backend` 670 pass, 0 fail (55 s);
`bun run typecheck` clean; eslint and prettier clean on the two changed files. The full
repo `bun test` stalled twice (0% CPU, no output for 10+ min, no overlapping test run)
right after `task-store.test.ts` / `task-store-durability.test.ts` output; that file
passes alone in 0.25 s and the whole backend package passes, so the stall is outside
the backend (the fix is backend-only). Same stall family as noted under Task 1 R4. If
the next session needs the full suite, run packages separately.

Full `bun test` after Task 2 (`ea8574a`): 1255 pass, 2 skip, 10 fail (same ten; +3 new
ownership tests). `bun run typecheck` clean; eslint clean on the changed files.
Known flake, not a Task 2 regression: `FileWatcher > reports a deleted file as delete and
a written file as modify` (`tests/services/file-watcher.test.ts`) fails intermittently
under machine load (load avg ~8, another project's `bun test` running). Alternating
the baseline `43d1a49` watcher + test against `ea8574a` in one loop: baseline failed 5/8,
Task 2 failed 3/8. A killed, overlapping full run also failed `watches for file changes`
once. Rerun watcher tests in isolation before suspecting the code.

Full `bun test` after Task 1 R4 fix (`de96b4e`): 1252 pass, 10 fail (same ten; +1 new test).
One earlier full run in that session stalled with no output past 10 min (Codex saw a
stall too while its own run overlapped); a clean rerun finished in 84 s. If it recurs,
suspect overlapping `bun test` runs before suspecting the code.
Full `bun test` after Task 1 R3 fix (`6e3673b`): 1251 pass, 10 fail (same ten).
Full `bun test` after Task 1 R2 fixes: 1251 pass, 10 fail (same ten; +2 new tests).
Full `bun test` at `c192cdb`: 1249 pass, 10 fail (same ten as below; +6 new tests).
Full `bun test` at `e7a226c`: 1243 pass, 10 fail. All ten are the known
mock.module-leak family: `wiki-backend-collision.repro.test.ts` (1),
`MarkdownPaneImpl.anchors` (3), `MarkdownPaneImpl.checkbox` (5),
`MarkdownPaneImpl.rerender` (1; passes when run alone). Treat these as baseline.
`bun run typecheck` clean.

## Next step

Next step: Task 5 review round 3 — Codex gpt-5.5 prompted review of `cfe462d..4ec0bcd`
(plan Task 5, line ~834; code files only: `electron/src/backend-records*.ts`,
`packages/shared/src/types/backend.ts`, `packages/shared/src/discovery/beacon.ts`,
`electron/package.json`). Tell the reviewer R1 finding 4 is deliberately deferred to Task 9, and
that duplicate rows in a hand-edited `backends.json` are resolved by "saved-under-canonical-id wins,
else first" with no field merging (R2), so it doesn't re-raise merge policy.

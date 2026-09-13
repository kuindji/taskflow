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
| 5 | The backend record list, keyed by uid | clear | `cfe462d` | `be34c1b`, `d9c59ab`, `4ec0bcd`, `39447ae`, `a25f3b5` | R1: 3 fixed, 1 deferred to Task 9; R2: 1 fixed; R3: 1 fixed; R4: Codex clean, 1 own finding fixed; R5: clean |
| 6 | SSH argument construction and failure classification | clear | `e4787f4` | `7c7c421`, `65c25ad`, `f126113` | R1: 1 fixed; R2: 2 fixed; R3: 1 rejected (clean) |
| 7 | The tunnel manager | clear | `6467088` | `d040521` | R1: clean |
| 8 | One connection per backend | clear | `17aebdd` | `dff8dc2`, `4f32c14`, `b34625a`, `22dbeb9` | R1: 3 fixed (1 own, 2 Codex); R2: 1 fixed (Codex + own); R3: 2 fixed (Codex); R4: clean |
| 9 | The registry, the attached set, and the IPC surface | clear | `6baa200` | `a0ad09d`, `3591f54` | R1: 1 fixed (Codex); R2: 1 rejected (clean) |
| 10 | The renderer's attached set — backend-store, handshake, detach | clear | `76a0746` | `4abc696`, `f1b70e0`, `4b40bbf`, `4c6b03b`, `c1ea517` | R1: 1 fixed (Codex + own); R2: Codex clean, 2 own findings fixed; R3: 1 fixed (Codex); R4: 1 fixed (Codex); R5: clean |
| 11 | Per-backend slices, revision guards, and the project and task stores | clear | `d4b6004` | `2856082`, `702378f`, `92c91a9`, `cfc5960`, `550558d`, `993805f` | R1: 1 fixed (Codex + own), 2 rejected; R2: Codex clean, 1 own finding fixed; R3: 2 fixed (Codex; 1 partly deferred to Task 14); R4: 1 fixed, 1 rejected (pre-existing); R5: 1 fixed (Codex); R6: clean |
| 12 | The remaining aggregating stores | clear | `c4d1729` | `fb0f041`, `21bfdc8`, `5d8b515` | R1: 2 fixed (Codex); R2: 1 fixed (Codex); R3: 1 rejected (clean) |
| 13 | Session state per backend | clear | `92b43e2` | `2995b40` | R1: 2 rejected (clean) |
| 14 | Per-machine caches and path-keyed stores | clear | `f03c740` | `fba0011`, `5bae8ff`, `a93ad4d`, `6c65295` | R1: 2 fixed (Codex; 1 also own suspicion), 1 rejected; R2: 2 fixed (Codex), 1 deferred to Task 18/19; R3: 1 fixed (Codex), 2 rejected (already deferred to Task 19); R4: 2 rejected (recorded race; Task 19) (clean) |
| 15 | Editor identity across machines | clear | `57a78e8` | `065a4cc`, `bdb378d`, `67300d3` | R1: 1 fixed (Codex), 1 rejected; R2: Codex clean, 1 own finding fixed; R3: clean |
| 16 | Machine sections in the sidebar | clear | `39abd35` | `c17d813` | R1: 1 rejected (clean) |
| 17 | The machines menu and its dialogs | clear | `111a004` | `30a434e`, `3884b1f` | R1: 2 fixed (Codex); R2: 1 rejected (clean) |
| 18 | Routing for sidebar rows and background work | clear | `c586fef` | `ae16a8a` | R1: 2 rejected (id-collision premise) (clean) |
| 19 | Primary-only managers, gating, and removing the shim | clear | `015186c` | `3ce63bc`, `63c4b71` | R1: Codex clean, 1 own finding fixed (label text; no further round) |
| 20 | Electron main across several backends | in-review round 7 done | `5f0ec24` | `f7438e4`, `930a4bb`, `4a77b3c`, `4509c26`, `6c2e364`, `0949f63`, `ebe46fb`, `40aecede` | R1: 1 fixed (Codex), 2 rejected; R2: 1 fixed (Codex); R3: 1 fixed (Codex); R4: 1 fixed (Codex); R5: 1 fixed (Codex + own); R6: 2 fixed (Codex); R7: 1 fixed (Codex; not reachable with Bun's backend) |
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

### Task 5, round 3 (Codex gpt-5.5, prompted review of `cfe462d..4ec0bcd`)

One finding, reproduced with two failing tests before fixing:

1. **An unvalidated uid can name a provisional record and merge two machines — confirmed,
   fixed in `39447ae`.** `adoptUid` and `normalizeRecords` accepted any non-empty string as a
   uid, but provisional ids are `host:instance`. `adoptUid([desktop.local:main, 192.168.1.20:main],
   "desktop.local:main", "192.168.1.20:main")` returned one record (id `192.168.1.20:main`, host
   `desktop.local`), losing the other machine. Reachable on the planned path: Task 10's handshake
   only checks `if (info.backendUid)`. Now both functions hold uids to `isSafeLabel` (`:` is outside
   it): `normalizeRecords` reads an unsafe uid as provisional, `adoptUid` returns the list unchanged.
   A note in the plan's Task 9 `confirmBackend` tells the implementer to reject such a uid before
   moving origins/tunnels. Tests: "refuses a uid outside the safe label set, which could name a
   provisional record" and "a uid outside the safe label set is read as provisional and cannot take
   another record's id" (2 fail / 11 pass on `28eae4c`, 13 pass after).

Codex otherwise checked the Task 5 contract, Task 9/17 consumer expectations, `as any` usage and the
duplicate-row policy, and reran the tests and typecheck (pass).

### Task 5, round 4 (Codex gpt-5.5, prompted review of `cfe462d..39447ae`)

Codex: no findings (checked the Task 5 contract and the Task 9/17 consumers; reran tests and
typecheck). My own read found one, reproduced with a failing test before fixing:

1. **A provisional row's hand-edited id can spell another machine's uid — confirmed, fixed in
   `a25f3b5`.** Same class as R3, via the id instead of the uid. `normalizeRecords` kept the saved
   id of a record with no `backendUid`, so `{id:"abc123",backendUid:null,host:"other.local",instanceId:"dev"}`
   listed before the real `{id:"abc123",backendUid:"abc123",host:"desktop.local",…}` replaced it
   (1 record out, the confirmed machine lost), and `adoptUid(…, "laptop.local:main", "abc123")`
   merged laptop (`main`) into other.local (`dev`). Provisional records are now always keyed
   `backendIdFor(host, instanceId)`, which is the id every producer in the plan writes
   (`recordFromDiscovered`, Task 9 manual connect). The saved id still decides "exact" for the R2
   duplicate policy. Test: "a provisional record is keyed by host and instance, whatever id the
   file holds" (1 fail / 13 pass on `39447ae`, 14 pass after).

### Task 5, round 5 (Codex gpt-5.5, prompted review of `cfe462d..a25f3b5`)

Clean: no findings. Codex checked the Task 5 contract, the Task 9 consumers (`confirmBackend`,
`addDiscoveredBackend`, `attachedRecordIds`, `mergeForMenu`, `matchesDiscovered`), Task 17's menu
expectations, the export surface and `as any` usage; it reran the records + beacon tests (29 pass)
and `bun run typecheck` (pass). My own read of the full diff found nothing either: the duplicate-slot
logic in `normalizeRecords` replaces in place only when a later row is exact and the held one is not,
and `adoptUid`'s merge keeps the existing record's position. **Task 5 is clear.**

### Task 6, round 1 (Codex gpt-5.5, prompted review of `e4787f4..7c7c421`)

One finding, reproduced before fixing:

1. **A host with whitespace or a quote breaks the `HostKeyAlias` option — confirmed, fixed in
   `65c25ad`.** `hostKeyAlias` copied `record.host` raw, so `host: "bad host"` gave
   `-o HostKeyAlias=taskflow-bad host-22`. `ssh -F /dev/null -G` exits on the option (`keyword
   hostkeyalias extra arguments at end of line`; tab and newline the same, `"`/`'` give `invalid
   quotes`) before it reaches its own `hostname contains invalid characters`, so
   `classifyTunnelFailure` returned `unknown` instead of `bad-destination`. A newline does not
   inject a second config line. Fix: the alias percent-encodes space, ASCII control chars, `"`, `'`,
   `\` and `%` (always two hex digits, so distinct hosts keep distinct aliases); ordinary hosts are
   unchanged (`taskflow-desktop.local-22`). An IPv6 zone host `fe80::1%en0` now aliases as
   `taskflow-fe80::1%25en0-22`. Tests: "a host with whitespace is reported as an invalid host name"
   (runs the real `ssh -G`, skipped without ssh), "the alias is a single token ssh can parse,
   whatever the host holds", "encoding the alias keeps distinct hosts apart" (first two red on
   `7c7c421`). Codex otherwise checked option precedence, forwarding, IPv6, leading dash and the
   known-host options with `ssh -G`, Task 7 consumer names, tests and typecheck.

My own suspicion, not filed: `UserKnownHostsFile` accepts whitespace-separated files and `%` tokens,
so a home directory containing a space or `%` could break `KNOWN_HOSTS_FILE`. `ssh -G` cannot show
the split, and a macOS short user name (hence home dir) cannot contain either.

### Task 6, round 2 (Codex gpt-5.5, prompted review of `e4787f4..65c25ad`)

Two findings, both reproduced with failing tests (red on `65c25ad`: 2 fail / 21 pass), fixed in `f126113`:

1. **A macOS connect timeout is classified `unknown` — confirmed, fixed.** A real
   `ssh -o ConnectTimeout=2 -- 10.255.255.1` on this Mac prints
   `ssh: connect to host 10.255.255.1 port 22: Operation timed out` (Darwin's ETIMEDOUT text), which
   matched none of the `no-route` substrings. That is what a sleeping or off-LAN machine gives. The
   branch now also matches `Operation timed out` and `Network is unreachable` (ENETUNREACH; not
   observed live, `2001:db8::1` and `0.0.0.1` both gave `No route to host`). Test: "no route, in the
   operating system's own words".
2. **The alias can carry known_hosts pattern syntax — confirmed at function level, fixed as
   hardening.** The alias is the first field of the line Task 7's `trustHostKey` writes, where `*`/`?`
   are wildcards, `!` negates and `,` separates. `ssh-keygen -F taskflow-192.168.1.20-22` against a file
   holding `taskflow-*-22 <key>` finds that line. Not reachable today: `ssh-keyscan` and `dns.lookup` fail
   on `*`, `localhost*`, `127.0.0.?`, `local?ost`, so no key line can be scanned for such a host, and ssh
   rejects `a,b` as an invalid host name. Fixed anyway because the fix is one character set in
   `encodeAliasChar` and ordinary hosts (IPs, DNS names, IPv6) are unchanged. Test: "the alias holds no
   known_hosts pattern syntax".

My own probes of the round-1 fix with `ssh -F /dev/null -G`: `#`, `=`, `[a]` and `%h` in the alias parse as
one token with no `%` expansion; NBSP and U+3000 give `hostname contains invalid characters`, which
classifies as `bad-destination`. Codex otherwise checked the spec + delta, consumer names, exports, `as any`,
IPv6, leading dash and classifier ordering; it reran the tests (21 pass) and typecheck.

### Task 6, round 3 (Codex gpt-5.5, prompted review of `e4787f4..f126113`)

One finding, rejected after an end-to-end repro attempt:

1. **Mixed-case host breaks the host key lookup — rejected.** Codex: `ssh -G` lowercases
   `HostKeyAlias` (`taskflow-Desktop.local-22` → `taskflow-desktop.local-22`, confirmed), so a line
   Task 7 writes under the mixed-case alias would never match. It does match: OpenSSH compares
   known_hosts host patterns case-insensitively. `ssh-keygen -F taskflow-desktop.local-22` finds a
   `taskflow-Desktop.local-22` line, and against a throwaway `/usr/sbin/sshd` on 127.0.0.1:2299 (OpenSSH
   10.3p1) the real tunnel options with `HostKeyAlias=taskflow-Localhost-2299` and that key filed under the
   mixed-case alias reached `Permission denied (publickey)`, i.e. past host-key checking. Control: the
   same line with a different key gave the full `REMOTE HOST IDENTIFICATION HAS CHANGED` banner +
   `Host key verification failed.`, which `classifyTunnelFailure` returns as `changed-host-key`.

Codex otherwise checked the base spec + delta, Task 7/9 consumer names, exports, `as any`, `--` for ssh and
keyscan, IPv6 argv, leading-dash hosts and classifier ordering; it reran the tests and typecheck. My own read
of the full diff found nothing either. **Task 6 is clear.**

### Task 7, round 1 (Codex gpt-5.5, prompted review of `6467088..d040521`)

Clean: no findings. Codex checked same-id concurrent opens (dedupe on `pendingOpens`, resolve only after
readiness), `closeTunnel` during a pending or probing open (context cancelled, registered child killed, newer
entries untouched), `rekeyTunnel` moving live and pending entries and closing whatever held the target id, exit
reporting under the current id, the quit flag set before the sweep, the host-key options in `readRemotePort`,
`trustHostKey` (alias rewrite, comments dropped, `0o700` dir), `as any` usage, and names/signatures against Task 9
and Task 20. It reran the tunnel tests (26 pass) and `bun run typecheck` (pass). My own read of the full diff and
Task 9's `attachBackend`/`confirmBackend` consumers found nothing substantive.

Suspicions, not filed:
- `readRemotePort` takes `Number.parseInt(stdout)`, so `"123abc"` reads as 123 and `70000` passes, where the
  shared `isValidPort` would refuse them. Not reachable: the only writer of that file is the backend, which writes
  a valid port via temp file + rename (Task 1). The worst case is an ssh forwarding error.
- The open dedupe ignores `backendPort`: an established tunnel for an id is handed back even when a later
  `openTunnel` names a different backend port. That matters only if a caller re-attaches without detaching after
  the remote backend changes port. Task 9's `detachBackend` closes the tunnel first; whoever implements Task 9/10
  retry should keep it that way (detach, then attach). **Task 7 is clear.**

### Task 8, round 1 (Codex gpt-5.5, prompted review of `17aebdd..dff8dc2`)

Three findings, all plan-faithful (the plan's own code has each), each reproduced with a failing test
before fixing in `4f32c14`:

1. **The renderer crashes at every launch — own finding, confirmed, fixed.** The shim's `sendRequest`
   and `sendFireAndForget` threw `No primary backend` synchronously. React runs child effects before
   `WebSocketProvider`'s, and the provider only names primary after an IPC await, so any non-async
   `sendRequest(...).then(...)` in a mount effect threw inside the effect. `CommandPaletteDialog` (always
   mounted) → `useActiveWorkspace` → `useHomedir`'s effect does exactly that, and `App` has no error
   boundary. The old module returned a rejected promise / dropped the message. Now: reject / drop when no
   primary. Tests in new `packages/ui/src/hooks/useWebSocket.test.ts`: "a request before any backend is
   primary rejects instead of throwing" (runs the real shim in a child `bun -e`, because other files'
   `mock.module("@/hooks/useWebSocket")` leak into later files) and "a component fetching the home
   directory on mount does not crash before connect" (render of a `useHomedir` probe; meaningful when run
   alone, passes vacuously under the leak). Both red with the `dff8dc2` shim, green after.
2. **An in-flight `openConnection` hangs forever when closed — Codex, confirmed, fixed.** `close()` bumped
   the epoch, so the connecting socket's handlers returned early and the `open()` promise never settled;
   Task 10's `attach` awaits it, so a detach during connect would hang the attach. `Connection` now holds
   `rejectOpen`: `close(reason)` rejects the open with the reason, a current-epoch `onclose` before open
   rejects too, and a reopen rejects the superseded one. Test: "closing a connection that is still opening
   rejects the open" (red: `still pending` after 1 s).
3. **`rekeyConnection` dropped status listeners already under the new id — Codex, confirmed, fixed.** It
   `set(toId, fromListeners)` over an existing set, so a `toId` subscriber never saw the rekeyed connection's
   status. Now merged. Test: "a rekey keeps the status subscribers already waiting under the new id" (red
   only with listeners under both ids; my first version subscribed under `toId` alone and passed on the old
   code). Reachability today is low: Task 10's merged path closes rather than rekeys.

Suspicion, not filed: an `onStatusChange` unsubscribe registered under the provisional id looks the handler
up under that id, so after a rekey it no longer finds it (the moved/merged handler stays). The plan's
move-only code has the same gap; the shim re-subscribes on primary change and Task 10's `statusUnsubs` are
dropped before open, so no current caller leaks. Revisit if Task 10 subscribes before rekeying.

### Task 8, round 2 (Codex gpt-5.5, prompted review of `17aebdd..4f32c14`, packages/ui)

One finding, found independently by Codex and by my own read, reproduced with a failing test before fixing:

1. **Subscribers already waiting under the rekey target stay "disconnected" — confirmed, fixed in `b34625a`.**
   R1's merge kept them subscribed but never told them the moved connection's status, so
   `onStatusChange("a-uid")` → `openConnection("a")` → `rekeyConnection("a","a-uid")` left that subscriber at
   `connected: false` while requests to `a-uid` succeeded (the R1 test even asserted `[false, false]`). Now
   `rekeyConnection` sends `connection.getStatus()` to the listeners that were under the target id (after any
   close of a connection previously filed there), then merges. Test "a rekey keeps the status subscribers
   already waiting under the new id" now expects `[false, true, false]` (red on `4f32c14`: 1 fail / 5 pass).
   Not reachable via the plan today: Task 10's `followSocket(liveId)` subscribes after the rekey, and the
   shim re-follows on the primary change, which replays the current status.

My own checks that found nothing: `rejectOpen` settles once (onerror + onclose both call `fail`, second is a
no-op; onclose after open rejects an already-resolved promise); reconnect-timer opens swallow their rejection;
`close()` rejects the open before bumping the epoch; the shim's re-follow on rekey re-adds the same handler to a
`Set` (no duplicate); a first connect that closes before opening now rejects, which the provider already handles
like the old onerror path. Codex reran the registry and shim tests and typecheck (pass).

### Task 8, round 3 (Codex gpt-5.5, prompted review of `17aebdd..b34625a`, packages/ui)

Two findings, both reproduced with failing tests before fixing in `22dbeb9`:

1. **The shim's `onEvent` delivers every attached backend's events — confirmed, fixed.** Plan-faithful (the
   plan's shim forwards all). Not reachable at Task 8 (one backend), but from Task 10 on, a store still on the
   shim (they migrate across Tasks 11–14) would apply another machine's `TASK_UPDATED` as if primary sent it.
   Now the shim passes an event on only when `backendId === getPrimary()`. Test in `useWebSocket.test.ts`
   (child `bun -e`, same mock.module leak reason): "an event subscribed through the shim comes only from
   primary" (red: received `["B","A"]`, expected `["A"]`). No behaviour change today: every event comes from
   `local`, which `connectWebSocket` names primary before opening.
2. **A status unsubscribe stops working after a rekey — confirmed, fixed.** This was the R1 "suspicion, not
   filed". `onStatusChange("a", h)` → `rekeyConnection("a","a-uid")` → `off()` → `closeConnection("a-uid")` still
   called `h` with the close status. Status listeners are now `StatusSubscription` objects (`{ handler }`), and
   the unsubscribe deletes that object from whichever set holds it, so one handler subscribed under two ids keeps
   its other subscription. Test: "unsubscribing after a rekey stops the status updates" (red: `[true, false]`,
   expected `[true]`).

Also checked, nothing found: the app has no React StrictMode, so `WebSocketProvider` connects once and
`openConnection` never closes its own first connection with `BackendDetachedError`.

### Task 8, round 4 (Codex gpt-5.5, prompted review of `17aebdd..22dbeb9`, packages/ui)

Clean: no findings. Codex checked the Task 8 contract against Task 10's consumers, `Connection` open/close/reopen,
epochs, pending rejection and reconnect-timer clearing, registry routing, rekey (primary move, event tagging, status
subscription move/merge/unsubscribe), the shim's pre-primary sends, status following and primary-only events, the
`rawFileUrl` signature change and its one caller, `as any` and unused exports. It reran `connection-registry.test.ts`
(7 pass), `useWebSocket.test.ts` (3 pass), the ui typecheck and build (pass). My own read of `connection.ts`,
`connection-registry.ts`, the shim, `backend-url.ts` and the `MarkdownPaneImpl` change found nothing either: `fail`
settles the open once and is a no-op after `onopen`; a rekey that closes a connection filed under the target id tells
the waiting listeners "disconnected" and then replays the moved socket's status. **Task 8 is clear.**

### Task 9, round 1 (Codex gpt-5.5, prompted review of `6baa200..a0ad09d`)

One finding, reproduced with failing tests before fixing in `3591f54`:

1. **A detach or removal sent under a provisional id while its confirm runs does nothing — confirmed, fixed.** Plan
   Task 10's `attach` keeps the row under its old id until `confirmBackend` resolves, and `detach` sends
   `detachBackend(id)` with whatever id the row has. That call queued behind the confirm on the old id, and by the time
   it ran the record, origin and tunnel were under the uid: it returned success while `attached()` still listed
   `abc123`, `attachedRecordIds()` still `["abc123"]` (redialled next launch); `removeBackend` left the record saved.
   Fix: `confirmBackend` records `aliases.set(id, uid)`; `canonicalId(id)` follows aliases only while no record exists
   under the id (so a host re-added under the same provisional id names the new record); `serializeCanonical` runs work
   under the requested id's queue and re-queues it under the canonical id when a confirm moved it. Used by attach,
   detach, confirm, update, remove; `getHostFingerprint`/`trustBackendHost` resolve with `canonicalId`. Aliases always
   run provisional (`host:instance`) → uid (no `:`), so no cycles; the loop guards anyway. Tests: "a detach sent under
   the id a confirm is moving detaches the confirmed record" and "a removal sent under …" (both red against
   `a0ad09d`'s registry, 2 fail / 20 pass; green after), plus "an id saved again after its record was confirmed away
   names the new record" (guard against over-redirecting).

Codex otherwise found nothing; it reran the registry tests (19 pass) and typecheck.

Suspicion, not filed (own read): `confirmBackend` runs on the old id's queue but mutates the uid's tunnel. If an
`attachBackend(uid)` for a *saved, detached* record of the same machine is probing when a rename lands on that uid,
`rekeyTunnel` closes the probing child and that attach answers "The tunnel was closed." while the renamed connection is
live under the uid. Needs both a provisional and a canonical record of one machine dialled at once (both persisted
`attached`, i.e. a quit between an attach's persist and its confirm). Serializing on both ids was not tried; revisit if
Task 10's launch redial shows it.

### Task 9, round 2 (Codex gpt-5.5, prompted review of `6baa200..3591f54`)

One finding, rejected:

1. **`confirm-backend` does not check the renderer-supplied `protocolVersion` — rejected.** Codex:
   `confirmBackend("desktop.local:main", { backendUid: "abc123", protocolVersion: 2 })` rekeys and persists. True,
   but main has no socket, so the version is only the renderer's word: a compromised renderer can send the current
   `PROTOCOL_VERSION` anyway, so a check in main defends nothing. An honest renderer never gets there, because plan
   Task 10's `attach` (plan lines 3051-3055) closes the connection and marks the row `incompatible` before calling
   `confirmBackend`. Task 10 must keep that order.

Codex otherwise checked serialization and the alias logic, persistence, startup/quit ordering, preload listener
cleanup and type alignment, and reran the registry tests (22 pass) and typecheck (pass). My own read of the registry,
IPC, preload, main and `env.d.ts` diffs against Task 10's `attach`/`detach`/`refresh`/push handlers found nothing
substantive. One race I traced was ruled out: a tunnel exit queued behind an attach that removes the *new* tunnel's
origin. That would need a live child while an attach awaits before `openTunnel`, but a live child means
`lastKnownPort` is set, so the candidates come back without an await and `openTunnel` hands back the established
tunnel. **Task 9 is clear.**

### Task 10, round 1 (Codex gpt-5.5, prompted review of `76a0746..4abc696`, packages/ui)

One finding, raised by Codex and suspected independently in my own read, reproduced with a failing test before fixing
in `f1b70e0`:

1. **An alias that merges into a machine this renderer holds no socket for reports success — confirmed, fixed.**
   Main's `confirmBackend` answers `merged: true` whenever `origins.has(uid)`, i.e. main holds the canonical tunnel. The
   renderer's attach of that record may have failed after the tunnel opened (socket refused, handshake failed — the row
   goes offline but main's tunnel stays) or still be running. The merged branch dropped the alias socket and returned the
   uid anyway, so `attach("desktop.local:main")` resolved `"abc123"` while `sendRequest("abc123", …)` rejected and the row
   stayed offline. Fix: the merged branch (now also requiring `confirmed.id !== id`) returns the canonical id as is only
   when that row is `attached`; otherwise it removes the alias row (or renames it onto the uid when no canonical row exists
   yet) and returns `attach(confirmed.id)`, which gets the existing tunnel back from main. Test: "an alias of a machine this
   renderer holds no socket for dials the canonical id" (red on `4abc696`: 1 fail / 7 pass; green after). The existing
   merge test now seeds the canonical row attached and asserts no second dial.

Codex otherwise checked the rename, refresh races, confirm rejection, changed-uid rehandshake, push drops and provider
startup, and reran the store tests and typecheck (pass). Own checks that found nothing: `attach("local")` never reaches the
registry (the IPC handler answers `{ id: "local", merged: false }`); the attempt counter's `delete` after a rename or merge
could in principle let a stale attach match a restarted count, but only via a third attach under the provisional id, whose
row is gone by then.

### Task 10, round 2 (Codex gpt-5.5, prompted review of `76a0746..f1b70e0`, packages/ui)

Codex: clean (checked plan contract, handoff decisions, R1 fix, pushes, provider startup, store reset, `as any`, exports;
reran store tests and typecheck). My own read found two, each reproduced with a failing test before fixing in `4b40bbf`:

1. **An attach superseded mid-handshake kills the newer attach — confirmed, fixed.** `handshake()` dropped the connection
   and marked the row offline on any request failure, without checking the attempt counter. A second `attach(id)` (e.g.
   the R1 merged branch dialling a canonical id whose own attach is still handshaking, or a launch redial of both a
   provisional and a canonical record) replaces the socket, which rejects the first attach's `SYSTEM_INFO`; its catch then
   closed the second attach's opening socket, so that attach resolved null with "Socket refused" while the backend was
   healthy. `handshake(id, current)` now leaves socket and row alone when the caller is stale (attach passes `current`,
   rehandshake its attempt check). Test: "an attach whose handshake a newer attach cut off leaves the newer one alone"
   (red: second attach Received null).
2. **A beacon re-attaches a machine the user detached — confirmed, fixed.** Plan-faithful (plan line 3274). Main's
   listener fires `backend-seen` for every saved record whose beacon newly appears (`backend-registry.ts:188-191`),
   including at every launch, and a detached row is `offline` like a dropped one, so `retry` → `attach` dialled it and
   main re-persisted `attached`. The spec's beacon signal resets the backoff of machines in the attached set. The handler
   now asks `listBackends()` and retries only when the entry's persisted `attached` is true. Tests: "a beacon from a
   machine the user detached does not dial it" (red: 1 dial) and "a beacon from an attached machine that went offline
   dials it again" (guards over-restriction).

### Task 10, round 3 (Codex gpt-5.5, prompted review of `76a0746..4b40bbf`, packages/ui)

One finding, reproduced with a failing test before fixing in `4c6b03b`:

1. **A tunnel that drops while main confirms still reports the attach as successful — confirmed, fixed.** The
   `backend-dropped` handler dropped the socket and marked the row offline with the failure, but did not bump the
   attempt counter. An `attach` suspended in `confirmBackend` then passed `current()`, patched the row `attached` (clearing
   the drop's failure), followed a missing connection (whose replayed "disconnected" set it offline with no reason) and
   resolved the id. Fix: the handler calls `nextAttempt(id)` before `drop(id)`, so any attach or rehandshake awaiting over
   that tunnel goes stale. Test: "a tunnel that drops while main confirms fails the attach and keeps the drop's reason"
   (red on `4b40bbf`: attach Received "abc123"; green after).

Own checks that found nothing: a deliberate `closeTunnel` (retry, detach) never emits `backend-dropped` — it removes the
child's `close` listener before killing it (`electron/src/tunnel-manager.ts:449`) — so a retry's own close cannot cut off
its new attach; `WebSocketProvider` startup order (primary, refresh, local attach, then persisted records) matches the plan.

### Task 10, round 4 (Codex gpt-5.5, prompted review of `76a0746..4c6b03b`, packages/ui)

One finding, reproduced with a failing test before fixing in `c1ea517`:

1. **A detach while the beacon handler awaits `listBackends()` is undone — confirmed, fixed.** The R2 gate read the
   persisted intent, but a detach landing between the request and its answer left that answer stale
   (`attached: true`); the row was still `offline`, so the handler called `retry` and main re-persisted `attached`.
   Fix: the handler captures the attempt counter before `listBackends()` and returns if it moved (detach, retry and
   drop all bump it). Test: "a detach while the beacon checks the persisted intent does not dial" (red on `4c6b03b`:
   Expected 0 dials, Received 1; green after).

Own checks that found nothing: every exported symbol in `store-reset.ts` and `backend-store.ts` has a consumer;
`rekeyConnection`'s close of an existing uid connection cannot orphan a `followSocket` subscription on the rename branch
(main answers `merged: false` only when no other record holds the uid); a `detach` racing a fresh `attach` of the same id
only flickers the row (IPC answers arrive in order, so the attach's later awaits patch it last).

### Task 10, round 5 (Codex gpt-5.5, prompted review of `76a0746..c1ea517`, packages/ui)

Codex: clean. It checked plan lines 2810-3330, the Task 10 decisions and the R1-R4 fixes, the IPC/preload contracts
(`listBackends`, `getAttached`, `attachBackend`, `detachBackend`, `confirmBackend`, pushes, `attachedRecordIds`), provider
startup order, the dev renderer path, the reset registry, removed `connectWebSocket` usages, `as any` and exports; it reran
the store tests, `useWebSocket.test.ts` and typecheck (pass). My own reread of `backend-store.ts`, the provider, the shim
and `store-reset.ts` found nothing new. **Task 10 is clear.**

### Task 11, round 1 (Codex gpt-5.5, prompted review of `d4b6004..2856082`, packages/ui + `task-order.ts`)

Three findings; one confirmed and fixed in `702378f`, two rejected:

1. **An event during a machine's list request loses the list — confirmed (Codex + own read), fixed.** Plan-faithful: the
   plan's `replace` discards a response whenever the revision moved, and every `apply` bumps it, even a
   `PROJECT_UPDATED`/`TASK_UPDATED` matching no record. Nothing refetches, so a machine broadcasting updates while its
   bootstrap `PROJECT_LIST`/`TASK_LIST` is in flight (any machine with a running agent) showed no projects or tasks until
   the next attach; the same for reconnect refetches, unarchive and remove refetches. Test in `aggregation.test.ts`: "an
   event landing while a machine's first list is in flight does not lose the list" (the server broadcasts
   `PROJECT_UPDATED` before answering; red on `2856082`: timed out with 0 projects; green after). A first fix (re-request
   up to 5 times) stayed red, since a server that broadcasts before every answer starves it. The fix is a rebase:
   `begin()` starts a `pending` write log, `apply` appends to it, and a stale `replace` replays those writes over the
   response; the newest generation still wins, a landed or failed `load` stops the log. New `slices.load(backendId,
   request)` wraps begin/request/replace (used by `fetchProjects`, `reorderProjects`, `fetchTasks`,
   `fetchArchivedTasks`); `replace` no longer recreates a dropped machine's slice. Unit tests: "a list overtaken by
   writes lands with those writes replayed over it", "writes after a list landed are not replayed over the next one",
   "a load superseded by a later request does not ask again", "a response landing after its machine was dropped brings
   nothing back".
2. **Sidebar groups tasks by bare `projectId` across machines — rejected.** Needs two machines with the same project
   id. Project and task ids are `randomUUID()` (`packages/backend/src/services/task-store.ts:517,859`), and the plan
   builds on "ids are UUIDs and cannot collide" (plan lines 3688, 3717). Sidebar rows per machine are Task 16/18.
3. **Id-only lookups in `TaskInfoPanel`/`LinkedProjectsSection` saves can hit another machine's record — rejected.**
   Same premise as #2; `activeTaskId`/`activeProjectId` are id-only by the plan's design, so the lookups match it.
   Caveat, not filed: two machines sharing one synced data dir (e.g. Dropbox) would hold identical ids and break this
   premise plan-wide, not only here.

### Task 11, round 2 (Codex gpt-5.5, prompted review of `d4b6004..702378f`, packages/ui + `task-order.ts`)

Codex: clean (checked `backend-scope.ts`, both stores, `bootstrapBackend`, component call sites, session-store deferrals and
the tests; reran scope, aggregation and backend-store tests and typecheck). My own read found one, reproduced with a failing
test before fixing in `92c91a9`:

1. **A task created while a machine's task list is in flight is listed twice — confirmed, fixed.** Introduced by R1's rebase.
   The `TASK_CREATED` handler checked for the task with `live.read()` and then applied a plain append. A machine that creates
   a task, broadcasts `TASK_CREATED`, then answers a `TASK_LIST` already holding it had the append replayed over that
   response, giving `["t1","t1"]` (a duplicate sidebar card). The duplicate check now sits inside the write (`insertTask`,
   shared with `createTask`), and `backend-scope.ts`'s `replace` doc says writes must be safe to repeat. Test in
   `aggregation.test.ts`: "a task created while the task list is in flight is listed once" (red: Received `["t1","t1"]`;
   green after). Every other write was checked for the same problem: project `upsert`, `replaceExisting`, the filters,
   `orderProjectsByIds`, `applyTaskUpdate` and `createTask` each give the same result when replayed over a response that
   already holds their effect.

Not filed: `loading` in both stores is one flag across machines, so the first of two concurrent fetches to settle clears it.
Same as before Task 11 in effect (single flag); no visible symptom found.

### Task 11, round 3 (Codex gpt-5.5, prompted review of `d4b6004..92c91a9`, packages/ui + `task-order.ts`)

Two findings, both reproduced with failing tests before fixing in `cfc5960`:

1. **A detach leaves the active task pointing at the dropped machine's task — confirmed for the task, deferred for the
   project.** Select task `ta` on machine a, detach a: `activeTaskId` stayed `"ta"` (red: Received `"ta"`, expected null).
   `fetchTasks` already clears the active task when it vanishes from its machine's list; a detach is the same vanishing,
   and the task-store reset is Task 11's. The reset now clears `activeTaskId` only when it was among the dropped machine's
   task ids. Test in `aggregation.test.ts`: "detaching a machine clears the active task only when it was that machine's"
   (also checks a detach of b leaves a's active task, and a's own detach does not clear b's). The project half
   (`useUIStore.activeProjectId`) is **not** fixed here: plan Task 14 (plan line ~4197) explicitly gives `ui-store` its own
   reset for `activeProjectId`, `sidebarFocusedItem`, `collapsedProjectIds`, `splitByWorkspace`.
2. **A request begun before a drop can land on the slice recreated after it — confirmed at function level, fixed as
   hardening.** `begin("a")` → `drop("a")` → `begin("a")` gave both tokens generation 1, so the old response replaced the
   fresh one (and a failed old `load`'s `finally` would null the fresh load's pending log). Not reachable in the app today:
   `detach` calls `closeConnection` (rejecting pending requests synchronously in `Connection.close`) before `resetBackend`,
   and the old load's `finally` runs in a microtask before any re-attach can `begin`. Generations now come from one
   scope-wide counter that is never reset. Test in `backend-scope.test.ts`: "a request begun before its machine was
   dropped cannot land on the slice that replaced it" (red: Received true).

Codex otherwise ran the scope and aggregation tests and typecheck (pass). My own read before the report checked the replay
of `orderProjectsByIds` (keeps ids missing from `orderedIds`, so a replayed reorder over a response with a new project keeps
it), `PROJECT_CREATED`'s outside-the-write check (harmless: `upsert` replaces by id), the optimistic reorder (applied before
its own `begin`, so never replayed) and ordering on one socket (an event and a list answer from one machine arrive in send
order, so a replayed update is never older than the snapshot it lands on).

### Task 11, round 4 (Codex gpt-5.5, prompted review of `d4b6004..cfc5960`, packages/ui + `task-order.ts`)

Two findings; one confirmed and fixed in `550558d`, one rejected:

1. **Archive mode misses the archived tasks of a machine attached after the toggle — confirmed, fixed.** Turn the archive
   on with machine a attached, then attach b: `setShowArchive(true)` had fetched archived slices only for the machines
   holding a live slice then, and nothing fetched b's later, so b's archived tasks stayed missing until the archive was
   toggled off and on. New since Task 11 (one machine before). `fetchTasks` now fetches a machine's archived tasks when
   its list lands while the archive is shown and the archived slices hold nothing for it yet (a detach drops that slice,
   so a re-attach fetches again). Test in `aggregation.test.ts`: "a machine attached while the archive is shown lists its
   archived tasks" (red: timed out with 0 archived tasks; green after).
2. **`TASK_UPDATED` with a status change does not move the task between the live and archived lists — rejected for Task
   11 (pre-existing).** At the base `d4b6004`, `applyTaskUpdate` also only mapped `tasks`; the store never moved a task
   on an archive/unarchive broadcast from another client. Task 11 kept that behaviour per machine. Not filed as a
   regression; a candidate for a separate fix outside this plan.

Codex ran the scope, aggregation and backend-store tests (31 pass) and typecheck (clean).

### Task 11, round 5 (Codex gpt-5.5, prompted review of `d4b6004..550558d`, packages/ui + `task-order.ts`)

One finding, confirmed and fixed in `993805f`:

1. **"Add subtask" on another machine's task goes to the wrong machine — confirmed, fixed.** Machine a holds the active
   task or project, machine b a task; right-click b's task → Add subtask. `requestNewSubtask` clears
   `preferredProjectId`, so the dialog's `projectId` defaults to a's project; `TaskCreationDialogHost.handleCreateTask`
   routed by that project and sent `TASK_CREATE` with b's `parentId` to a, which rejects "Parent task not found" (no
   subtask). New in Task 11: the backend takes a subtask's project from its parent (`packages/backend/src/handlers/task.ts`
   ~86-97) and ignores the dialog's, so at `d4b6004` it could not misroute. The same routing also threw "Unknown project"
   for a subtask whose dialog `projectId` was empty. The machine choice is now `taskCreationBackend` in
   `task-creation-store.ts` (a subtask goes to its parent task's `backendId`, a task to its project's), used by the host.
   Test in `task-creation-store.test.ts`: "is the parent task's machine for a subtask, whatever project is selected"
   (red with the host's previous logic in the helper: Received "a", expected "b"; green after).

Codex otherwise checked `backend-scope.ts`, both stores, `backend-store.ts`, the changed call sites and the R1-R4
exclusions; it reran scope, aggregation and backend-store tests (32 pass) and typecheck (clean). My own reread of
`backend-scope.ts`, `task-store.ts` and `project-store.ts` found nothing new.

### Task 11, round 6 (Codex gpt-5.5, prompted review of `d4b6004..993805f`, packages/ui + `task-order.ts`)

Clean: no findings. Codex swept the changed component call sites and unchanged callers of the changed store methods for
the R5 pattern (routing by a dialog/UI-selected id instead of the acted-on record's `backendId`) and found every
project/task mutation routed by the `Scoped` record, task creation via `taskCreationBackend`. It reran scope,
aggregation, task-creation-store and backend-store tests (40 pass) and typecheck (pass). My own read agreed:
`project-store.ts`, `task-store.ts`, `TaskCreationDialogHost`, `TaskSidebar`'s reorder and the `TaskCard`/`TaskHeader`/
`Workspace`/`MissingLocationDialog`/`useSidebarData` hunks. Checked and rejected: `taskCreationBackend` looks a subtask's
parent up only in live tasks, but "Add subtask" is offered only for non-archived tasks (`TaskCard.tsx:198`,
`TaskHeader.tsx:142`). The remaining primary-routed shim calls in those components (`GIT_PULL` in `TaskHeader`,
`FILE_STAT` in `Workspace`) are unchanged lines, owned by Tasks 14/18. **Task 11 is clear.**

### Task 12, round 1 (Codex gpt-5.5, prompted review of `c4d1729..fb0f041`, packages/ui)

Two findings, both the same class (a picker lists merged definitions, the result goes to one machine that resolves ids
locally), both confirmed and fixed in `21bfdc8`. Both are new in Task 12: before it, flows and actions were primary-only.

1. **New Task offers another machine's flows — confirmed, fixed.** Machine a has global flow `global-a`; open New Task on
   b's project, Start with → Flow lists `global-a`; submit → `TaskCreationDialogHost` sends `FLOW_START` to b (the task's
   machine), which cannot find the id. The dialog listed `useFlowStore.flows` unfiltered (not even by project). New
   `taskCreationFlows(request, projects, tasks, flows)` in `task-creation-store.ts` (next to `taskCreationBackend`; a
   subtask uses its parent's machine and project) = `filterByProject` for the target; the host passes `flowsFor(projectId)`
   and `NewTaskDialog` derives its list per selected project, dropping a flow choice (or the "flow" start choice) the
   project change put out of reach. Tests in `task-creation-store.test.ts`: "offers a task only its machine's flows for its
   project", "offers a subtask its parent's machine and project flows…", "offers no flows before a project is chosen"
   (red first: export missing; mutation check — the helper filtering by project but not machine turns the first two red).
2. **Flow editor library offers another machine's actions — confirmed, fixed.** Flow manager → b's flow → the action
   library listed a's global actions; adding one saves an `actionId` into b's flow that b cannot resolve. `FlowEditor` now
   takes `backendId` (the flow's machine; primary for a new flow, where `definitionBackend` saves it) and filters its
   library with `filterByProject`. Test: `FlowEditor.library.test.tsx` "a flow's action library offers only its own
   machine's actions" (red on `fb0f041`: received `global-a`, `global-b`).

Codex also reran `aggregation.test.ts` (14 pass) and typecheck (clean).

### Task 12, round 2 (Codex gpt-5.5, prompted review of `c4d1729..21bfdc8`, packages/ui)

One finding, confirmed and fixed in `5d8b515`; it was the Task 12 "suspicion, not verified" below.

1. **Another machine's master flow run shows in primary's master workspace — confirmed, fixed.** `activeRuns` is keyed by
   owner id and `MASTER_OWNER_ID` is the same constant on every machine. The backend broadcasts `FLOW_RUN_UPDATED` to all
   its clients (`flow-runner.ts` `broadcastUpdate`), and since Task 12 the store listens on every machine, so b's master
   run landed in `activeRuns["__master__"]`, which primary's master workspace reads (`useSessionSync`). New in Task 12
   (flows were primary-only before). Fix: `applyRunUpdate` ignores `{ master: true }` runs from any machine but primary.
   Test in `aggregation.test.ts`: "another machine's master run does not show in primary's master workspace" (red on
   `21bfdc8`: received b's master run; green after).

Codex found the R1 class otherwise clean: `useRunMenu`, `ScheduleForm`/`ScheduleManagementDialog`, `FlowPanel`,
`Workspace` flow start, `NotificationPopover`, `CommandPaletteDialog`, `AgentOptionsPanel`, New Task flows, FlowEditor
library. My own check: an edited schedule cannot change project (`ScheduleForm` renders the picker only on create), so
updates cannot carry another machine's `projectId`.

### Task 12, round 3 (Codex gpt-5.5, prompted review of `c4d1729..5d8b515`, packages/ui)

One finding, checked and rejected; round is clean.

1. **Schedules dialog resolves a row by bare id — rejected.** `ScheduleManagementDialog` passes `s.id` to
   `handleTrigger`/`setPendingDeleteId` and finds the record with `schedules.find((sc) => sc.id === id)` (~115, 129,
   149, 163), so Codex's scenario was two machines each holding a schedule with id `"nightly"`, where Run now on b's row
   reaches a. Schedule ids are `randomUUID()` (`packages/backend/src/handlers/schedule.ts:68`), and the spec makes
   UUID uniqueness across machines the design's identity rule (spec lines 38-45; "No compound keys", line 126). The
   only way to see one UUID under two `backendId`s is one machine attached twice, which `backendUid` dedup prevents
   (spec lines 201-218). Same reasoning as `diff-store`'s flat maps and R2's decision (only the non-UUID
   `MASTER_OWNER_ID` collided). Not a repro, so not fixed.

Codex's R2-class sweep (non-UUID keys in the notification, schedule, diff, flow and settings stores) found nothing else,
and it judged the slice detach and late-response guards through `createSlices` correct; it reran `aggregation`,
`backend-store`, `task-creation-store`, `FlowEditor.library` (pass) and typecheck (clean). My own check: a settings
reply cannot land after its machine's reset: `Connection.close` rejects pending requests (`connection.ts` ~197-207),
so the unguarded `fetchSettings` write is safe. **Task 12 is clear.**

### Task 13, round 1 (Codex gpt-5.5, prompted review of `92b43e2..2995b40`, packages/ui)

Two findings, each shown by Codex with a store-level call sequence, both rejected as unreachable; round is clean.

1. **A task moving to another machine loses its tabs — rejected.** `syncWithTasks("b", [t])` then
   `syncWithTasks("a", [])` drops `task:t`, because a's held keys still claim it. True of the functions, but
   no feature moves a task or project between machines (no move message in `packages/shared`, `ui` or
   `backend`). The only way one UUID appears under two `backendId`s is one machine attached twice, which
   `backendUid` dedup prevents. That is the same identity premise as Task 11 R1 #2 and Task 12 R3. The
   renderer loads records only after a rename (`attach` calls `bootstrapBackend(liveId)` after
   `rekeyConnection`/`renameRow`, `backend-store.ts:238-248`), so a provisional id never owns keys the uid
   later needs.
2. **Master tabs survive a detach after primary's id is rekeyed — rejected.** `syncWithMasterSessions("local", …)`
   then `resetBackend("abc123")` leaves `master`. That needs primary to be a provisional id that is later renamed.
   Primary is only ever `"local"`: `setPrimaryBackend` has two callers, both
   `WebSocketProvider.tsx` passing `LOCAL_BACKEND_ID` (lines 20, 28). Main's `confirm-backend` answers
   `{ id: "local", merged: false }` for local (`electron/src/ipc-handlers.ts:341`), so the local row and
   connection are never rekeyed. Resetting `local` does match `masterBackendId`. Revisit if a later task lets
   primary be a remote machine.

Codex reran both session-sync test files and typecheck (pass). My own read of the diff found nothing either.
Tabs are not restored from saved state (no persistence or hydration of `tabsByWorkspace`), so keys no sync
ever claimed only come from live `addTab` calls. The session-activity reset runs before the session-store reset
(import order) and leaves owner entries for it to read. `resetBackend`'s only caller, `detach`, closes the
connection first, so no late event can re-note a session. **Task 13 is clear.**

### Task 14, round 1 (Codex gpt-5.5, prompted review of `f03c740..fba0011`, packages/ui)

Three findings; two reproduced with failing tests (4 red on `fba0011`) and fixed in `5bae8ff`, one rejected:

1. **A replace in results still shown while another machine's search runs hits that other machine — confirmed,
   fixed.** `search()` set `searchBackendId` when it started, and the replace methods took `rootPath` from the
   open workspace. Search machine a at `/repo-a`, start a search on b (answer held), click replace-in-file on a's
   result: `SEARCH_REPLACE_ALL` went to b. With one repository at one path on both machines that rewrites b's file
   at a's match positions. Now `searchBackendId` and new `searchRoot` are set together with the results; the
   replace methods lost their `rootPath` parameter and use both (`SearchResults`/`SearchPanel` updated; the result
   list shows paths relative to `searchRoot ?? workingDir`). A module `pendingSearchBackendId` lets the reset drop a
   running search's late answer while keeping another machine's shown results. Tests in `search-store.test.ts`:
   "a replace in results still shown while a search on another machine runs acts on the results' machine and
   root" (red: b received the replace) and "detaching the machine a running search asked drops its late answer"
   (red: a's results cleared).
2. **A watch that lands late stays installed on the backend — confirmed, fixed.** (My own read had noted the same
   leak and judged it pre-existing; the generation check added in Task 14 dropped the late watch locally without
   releasing it.) `watchPath(laptop)` held → `unwatchPath(laptop)` returns early (nothing recorded) →
   `watchPath(desktop, other)`; when laptop's answer lands, no `FILE_UNWATCH` was ever sent, and the backend's
   recursive watcher lives until disconnect. With only the unwatch (panel closed), the late watch was even
   recorded. Now module `requestedWatch` (newest watch asked for, not since unwatched/detached): `unwatchPath` of a
   still-pending watch bumps the generation and clears it; a stale landed watch sends `FILE_UNWATCH` unless
   `requestedWatch` names the same machine and path (the backend keeps one owner entry per client and path, so
   releasing would kill the newer one); the reset clears it for its machine. Tests in `file-store.test.ts`: "a watch
   that lands after the pane moved to another machine is released where it landed" and "a watch unwatched before
   it lands is released and not recorded" (both timed out red waiting for the unwatch). `test-ws-server.ts`'s
   `respond` may now return a promise to hold an answer.
3. **A queued `FILE_CHANGED` refresh survives a switch to another machine — rejected.** True that the 150 ms
   timer is cleared only by a reset, but it only calls `fetchDir`/`fetchGitStatus`, which fetch the directory's
   current listing (dirs not in the current tree are skipped by `isDirLoaded`/`setChildrenAtPath`). Worst case is
   one redundant listing, never wrong data; the same holds for a same-machine path switch before Task 14.

Own read of the full diff otherwise found nothing: `createPerBackendCache` drops a post-reset answer and never
caches a failure; the wiki and tsconfig in-flight identity checks hold across a reset and refetch;
`forgetRecords` gets the ids before the slices drop; `initConnectivity` has only local callers.

### Task 14, round 2 (Codex gpt-5.5, prompted review of `f03c740..5bae8ff`, packages/ui)

Three findings; two reproduced with failing tests and fixed in `a93ad4d`, one deferred:

1. **A slow unwatch forgets the watch that replaced it — confirmed, fixed.** `unwatchPath` cleared `watched`
   unconditionally after its `FILE_UNWATCH` answer. Watch desktop `/repo`, close the pane (`unwatchPath`, answer
   held), open it on laptop (`watchPath("laptop", "/repo")` lands), then desktop answers: `watched` became `null`, so
   laptop's `FILE_CHANGED` was ignored and a later switch never released laptop's watch. Reachable with the real
   backend: its `FILE_UNWATCH` handler awaits `assertWorkspacePath` and `fileWatcher.release`, so two unwatches of one
   path can finish out of order. Now it clears only while `watched` is still that watch. Test in `file-store.test.ts`:
   "an unwatch answered after the next watch landed does not forget that watch" (red: Received `null`).
2. **A late shell list offers another machine's shells — confirmed, fixed.** Introduced by Task 14 routing
   `AgentDropdownMenu`'s `SHELLS_LIST` to the workspace machine without a cancellation guard. `<Workspace />` is not
   keyed (`App.tsx:160`) and `TabBar` always renders the menu, so it stays mounted across workspace switches: desktop's
   held list landing after laptop's replaced it, and the terminal button opened `/bin/desktop-zsh` in a laptop
   workspace. Now a `cancelled` flag like `useRunMenu`'s. New `AgentDropdownMenu.shells.test.tsx` (real registry, two
   test servers; red on `5bae8ff`: Received `["/bin/desktop-zsh"]`). A first version mocked `@/components/ui/button`
   and the dropdown menu; those mocks leaked into `FlowPanel.loop.test.tsx` (3 extra fails in the full run), so the
   test uses the real components.
3. **`useSessionSync` scripts, agent commands and default shell still ask primary — deferred.** True
   (`useSessionSync.ts:133,153,170` use the shim, effects keyed on path/scope only), but not in Task 14's diff or plan
   section: run-menu routing is Task 18 (its routing test names `SCRIPTS_LIST`/`AGENT_COMMANDS_LIST`) and remaining
   shim callers are Task 19 Step 5. Recorded under Decisions so Task 18 converts `useSessionSync` alongside `useRunMenu`
   (registry `sendRequest(backendId, …)`, `backendId` in the effect deps, a cancel guard on the shell effect).

Codex reran the Task 14 store tests and typecheck (pass). My own read of `search-store.ts`, `file-store.ts`, the
wiki store, `per-backend-cache`, connectivity, theme store and `useActiveWorkspace` found nothing new. One race noted,
not filed: `unwatchPath` then an immediate `watchPath` of the *same* machine and path returns early (the watch is still
recorded) and the unwatch then clears it, leaving no watch. Pre-existing: `f03c740`'s `watchPath`/`unwatchPath` behave
the same.

### Task 14, round 3 (Codex gpt-5.5, prompted review of `f03c740..a93ad4d`, packages/ui)

Three findings; one reproduced with a failing test and fixed in `6c65295`, two rejected as already decided:

1. **File listings, git status, reads and writes still go to primary — rejected (already deferred).** True
   (`file-store.ts` uses the `useWebSocket` shim for everything but watch/unwatch), and already recorded under
   Decisions ("Task 14 `file-store` … **Not converted** … Task 19 Step 5").
2. **A move cancelled while the old watch is released leaves that watch recorded — confirmed, fixed.**
   `watched = desktop /repo`; `watchPath("laptop", "/repo")` awaits desktop's `FILE_UNWATCH`; `unwatchPath("laptop",
   "/repo")` (pane closed; `FileExplorer`'s cleanup does not await) finds laptop only in `requestedWatch`, bumps the
   generation and returns; desktop answers, `watchPath` returns on the generation mismatch before its `set({ watched:
   null })`. `watched` stays desktop although desktop holds no watch, so reopening on desktop returns early and sends
   no `FILE_WATCH`. Now `watchPath` clears `watched` before awaiting the old machine's release. Test in
   `file-store.test.ts`: "a move to another machine cancelled while the old watch is released forgets the old watch"
   (red on `a93ad4d`: Received the desktop watch).
3. **file-store tests don't prove data routing — rejected.** The mock of the shim is deliberate for the same reason
   as #1; routing tests belong to Task 19 Step 5's conversion.

Codex found nothing in the `AgentDropdownMenu` cancel fix (its test passes, with React `act` warnings). Own read of
the R2 `unwatchPath` conditional clear found nothing further; the early clear in `watchPath` keeps that fix's test
green (the slow unwatch still sees laptop recorded, not desktop).

### Task 14, round 4 (Codex gpt-5.5, prompted review of `f03c740..6c65295`, packages/ui)

Two findings, both rejected; no code change, task clear:

1. **A quick desktop → laptop → desktop switch can lose the watch — rejected (recorded same-target race, narrowed by
   R3).** `watchPath("laptop")` clears `watched` and awaits desktop's `FILE_UNWATCH`; `watchPath("desktop", "/repo")`
   then sends `FILE_WATCH`. If the backend finishes the older unwatch after the watch (both handlers in
   `backend/src/handlers/file.ts:62-77` await `assertWorkspacePath` before `watch`/`release`), desktop holds no watch
   while the UI records one. This is the recorded unwatch-then-rewatch race on one machine and path. At `a93ad4d` the
   same sequence lost the watch deterministically (`watched` still named desktop, so the switch back returned early and
   sent nothing); R3 reduced it to backend handler ordering. A real fix would serialize watch/unwatch per machine and
   path, and is not worth it for this edge.
2. **Context menu "Open External"/"Reveal" go to primary — rejected (deferred).** `file-store`'s `openExternal` /
   `revealInFinder` use the primary shim, same family as R3 finding 1 (Task 19 Step 5); Task 19 Step 2 also gates
   `openExternalFile`/`showItemInFolder` on a local workspace machine. Added to the Decisions "Not converted" list.

Codex reran the Task 14 store/lib/component tests and typecheck (pass). Own read of the R3 `watchPath` early clear:
a reset of the old machine during its release now returns early instead of calling `clearExplorerState`, which is better
— `FileExplorer`'s effect has already started the new machine's `fetchTree`, and clearing would have cancelled it.

### Task 15, round 1 (Codex gpt-5.5, prompted review of `57a78e8..065a4cc`, packages/ui)

Two findings; one reproduced with failing tests and fixed in `bdb378d`, one rejected:

1. **An editor whose workspace loses its machine goes blank, and a late read lands in the disposed editor —
   confirmed, fixed.** Reachable: `closeConnection` clears primary (`connection-registry.ts:87-90`), so a mounted
   master-workspace editor's `useWorkspaceBackend()` turns null. The effect cleanup disposed the editor, then the
   effect returned at the null guard without `setLoading(true)` (contradicting the recorded "shows Loading..."
   decision), and an in-flight `readFile` still passed the `loadRequestId` guard and called `setValue`. Now the null
   branch sets loading (and not dirty), and a local `cancelled` flag set in cleanup drops the read (a ref bump in
   cleanup tripped `react-hooks/exhaustive-deps`). Tests in `EditorPaneImpl.machine.test.tsx` (mocks `monaco-editor`,
   file-store, `useWorkspaceBackend`, import navigation): both red on `065a4cc` (loading false; `setValue` called once).
2. **`editor-navigate` window event is path-only, so a same-path editor on another machine also jumps — rejected
   (not reachable).** Only the active workspace's `SplitContainer` is mounted (`Workspace.tsx` renders one), its left
   and right panes share one workspace and so one machine, and `TabContent` keys panes by `tab.id`, so a workspace
   switch remounts them. Two mounted editors on different machines cannot coexist today. Revisit if inactive
   workspaces ever stay mounted.

Own sweep: no `Uri.file(` / `.uri.path` / `resource.path` readers left in packages/ui; the only other `createModel`
calls are `MonacoDiffViewer`'s in-memory models; no `TODO(remote-projects)` markers remain in packages/ui.

### Task 15, round 2 (Codex gpt-5.5, prompted review of `57a78e8..bdb378d`, packages/ui)

Codex: no findings. It judged the R1 fix complete, reran `editor-uri.test.ts` + `EditorPaneImpl.machine.test.tsx`
and `bun run typecheck` (all passing), and confirmed the new pane test does not cause the MarkdownPaneImpl
`mock.module` leak (it runs clean before `MarkdownPaneImpl.anchors.test.tsx`).

One own finding, fixed in `67300d3`:

1. **`modelKey` exported for its test only — confirmed, fixed.** `grep -rn "modelKey" packages` found no
   production caller of `editor-uri.ts`'s `modelKey` (the other hits are `PiModelSelect`'s unrelated local
   function), which breaks the project's "don't export until necessary" rule. It is removed; the test defines the
   same `modelUriFor(...).toString()` locally. A test comment still said the dirty-state reset parses map keys back
   into URIs (true of the plan's string keys, not the nested maps we built); it now names the real string→URI trip
   (TS worker file names). No behaviour change.

### Task 15, round 3 (Codex gpt-5.5, prompted review of `57a78e8..67300d3`, packages/ui)

Clean: no findings. Codex reran `editor-uri.test.ts` and `EditorPaneImpl.machine.test.tsx` (alone and together),
`bun run typecheck` and `git diff --check`, all passing (only React `act(...)` environment warnings). My own sweep
agreed: every caller of the dirty-state accessors (`EditorPaneImpl`, `WorkspacePane`, `open-file`) passes a machine,
and no `Uri.file(` / `uri.path` / `resource.path` readers remain outside the diff viewer's in-memory models.
**Task 15 is clear.**

### Task 16, round 1 (Codex gpt-5.5, prompted review of `39abd35..c17d813`, packages/ui)

One finding, rejected:

1. **Badge index keyed by bare project id collapses same-id projects on two machines — rejected.** Codex:
   `badgeIndexById` (`TaskSidebar.tsx:99`) is `new Map(shown.map((p, i) => [p.id, i]))`, so a local and a remote
   project both with id `"same"` would show one badge number. Same premise as Task 11 R1 #2: project ids are
   `randomUUID()` and the plan relies on them not colliding. The rest of the sidebar is id-only as well
   (`tasksByProject`, `collapsedProjectIds`, `activeProjectId`, and Cmd+N's `setActiveProject(target.id)`), so a
   machine-qualified badge key would still select by bare id.

Codex otherwise checked grouping (local, attached, detached, offline, collapsed), the per-section drag path and
`reorderProjects(backendId, …)`, `keepAttached` across attach/detach/refresh/drop/rehandshake, selector stability and
`as any`; it reran the three Task 16 test files (25 pass) and `bun run typecheck` (pass). **Task 16 is clear.**

Suspicion, not filed (own read), for **Task 17**: `attach` sets `keepAttached: true` at once, but main persists
`attached: true` only after the tunnel opens (`backend-registry.ts:311-317`). A `backends-changed` refresh landing in
between (e.g. a beacon at line 193) copies `attached: false`, so a detached machine being re-attached loses its
section while connecting; a failed attach leaves `keepAttached: true` (section with Retry) until the next refresh.
Both settle on the next refresh. Not reachable today: only Task 17's menu attaches a detached record (startup, retry
and the beacon handler only dial persisted-attached ones). Task 17 should decide whether the menu shows its own
attaching/failed state or `refresh` keeps a local `keepAttached: true` while an attach is in flight.

### Task 17, round 1 (Codex gpt-5.5, prompted review of `111a004..30a434e`, packages/ui + shared type + records)

Two findings, both reproduced with failing tests and fixed in `3884b1f`:

1. **Port fields accept non-decimal text — confirmed, fixed.** `parsePort` used `Number(trimmed)`, so `0x16`,
   `0b10110` → 22 and `1e2` → 100 passed validation and reached `addBackend`/`updateBackend` as ports the user never
   typed (`bun -e` over `parsePort` printed exactly that). Now digits only (`/^\d+$/`), then the 1–65535 range. Test:
   new `backend-fields.test.ts` (red on `30a434e`).
2. **Manage: a cleared SSH port "saves" and leaves the row dirty — confirmed, fixed.** Blank was sent as `undefined`
   ("unchanged"); main kept the port, `backends-changed` brought back `sshPort: 22` while the field stayed `""`, so
   Save stayed enabled and the row looked unsaved. Records always carry a port (`backend-records.ts:51`, registry
   default 22), so blank is now refused like a blank name/user. Test: new `ManageBackendsDialog.test.tsx` (red:
   `updateBackend` was called).

Own read before the report: a record saved without a user cannot exist (main falls back to `defaultUser`), so Manage's
"SSH user cannot be empty" never blocks a rename of a real record. Codex reran the three Task 17 test files (36 pass)
and `bun run typecheck` (pass).

### Task 17, round 2 (Codex gpt-5.5, prompted review of `111a004..3884b1f`, packages/ui + shared type + records)

One finding, rejected after tracing it:

1. **A second host-key failure for the same machine while the trust dialog is open is not rescanned, and Cancel
   dismisses the new failure — rejected (unreachable).** The dialog is keyed by machine id and scans on
   `[changed, machine.id, scan]`, so a new failure *object* replacing the old one with no render in between would reuse
   the instance. Nothing produces that: `backend-dropped` fires only for an **established** tunnel
   (`tunnel-manager.ts:314`), which already passed host-key checks, while a row showing a host-key failure has no
   established tunnel. Every other path that sets a failure is `attach` (via retry, beacon seen, trust, menu). `attach`
   patches `failure: undefined` at once (`backend-store.ts:163`) before awaiting IPC, so the dialog unmounts and a later
   failure remounts it with a fresh scan. Even if it did happen, `trustBackendHost` pins main's own last scan
   (`tunnel-manager.ts:564`), and the dialog has not rescanned, so the pinned key is the one on screen. Cancel dismissing
   the failure shown at that moment is the intended behaviour.

Codex otherwise checked attach/detach/add/remove against store, preload, IPC and registry, changed-key handling,
native vs Radix menu construction, row status and icon derivation, port validation, zustand selectors and type hygiene;
it reran six test files (60 pass) and `bun run typecheck` (pass). **Task 17 is clear.**

### Task 18, round 1 (Codex gpt-5.5, prompted review of `c586fef..ae16a8a`, packages)

Two findings, both rejected on the same premise:

1. **`sessionBackend()` falls back to a bare-id workspace lookup for synced sessions, so a session could route to
   another machine holding the same owner id — rejected.** The fallback (`session-store.ts:97`) reads the tab's
   workspace key and `workspaceBackendId` matches `task:<id>`/`project:<id>` by id. Session ids and task/project ids are
   `randomUUID()` (`backend/src/services/task-store.ts:517,859`); the spec builds on that ("UUIDs already collide-free
   across machines", spec lines 41, 126). Main and dev backends sharing one data dir share one backend uid and dedup into
   one machine. Without a collision the fallback resolves the owner's machine. Same premise as Task 11 R1 #2, Task 12
   R3 and Task 16 R1.
2. **Notification navigation matches `backendId` + id but then sets the bare active project/task id — rejected.**
   `activeProjectId`/`activeTaskId` are flat by spec design (line 41) for the same reason; matching `backendId` in
   the lookup is defensive, not a claim that ids collide.

Own read before the report: exited sessions are forgotten from `sessionBackends` but resume still resolves through the
tab; `TerminalPane` catches the new resume throw into its error line; `Workspace` run actions bail without a machine.
Reran `useRunMenu.routing` (2 pass), `AttributesSection` (19 pass), `bun run typecheck` (clean). **Task 18 is clear.**

### Task 19, round 1 (Codex gpt-5.5, prompted review of `015186c..3ce63bc`, packages/ui + shared comments)

Codex: clean. It checked the primary-only managers, `useIsLocalBackend` gating (incl. the no-rows dev case), the
data-folder gate, file dialogs, reveal/open-external, terminal drop and link paths, `file-store` machine state and stale
responses, the shim deletion via import scan, model-select threading and refetch, and markdown `FILE_CHANGED`
filtering. It ran the `ui` typecheck and the `useIsLocalBackend`, `file-store`, `store-reset`, `connection-registry`
tests (pass).

One own finding, fixed in `63c4b71`: the Radix "Reveal in Finder" items in `FileContextMenu` (`:290`) and `WikiPanel`
(`:137`) were disabled for a remote workspace with only a `title`, which a disabled Radix item never shows
(`pointer-events-none`), so the user saw a greyed item with no reason. The recorded decision says Radix items carry the
visible " (not on this machine)" suffix; `Open in External Editor` and the native items did, these two did not. Both now
use a shared `LOCAL_ONLY_SUFFIX` from `hooks/useIsLocalBackend.ts`. Label text only, so no further review round (see
Decisions). **Task 19 is clear.**

### Task 20, round 1 (Codex gpt-5.5, prompted review of `5f0ec24..f7438e4`)

Three findings; one confirmed and fixed in `930a4bb`, two rejected:

1. **`save-artifact` follows redirects after its attached-origin check — confirmed, fixed.** The handler checked that
   the URL was `/api/flow/artifact/…` on an attached origin, then `fetch(url)` with the default `redirect: "follow"`.
   Scratch repro (Bun): a server on an allowed origin answering `302 Location: http://127.0.0.1:<other>/admin` made the
   fetch return the other server's body. Low impact (the bytes only go to a file the user picks on this machine), but it
   bypasses the recorded "only attached origins are fetched" contract. The check and the download moved to new
   `electron/src/artifact-download.ts` (`isArtifactUrl(value, attached)`, `fetchArtifactBytes(url)` with
   `redirect: "error"`) so they are testable without electron; `ipc-handlers.ts` uses them. Test
   `electron/src/artifact-download.test.ts`: "an attached backend redirecting elsewhere does not get the other origin
   fetched" (red with the option removed: Received "CLIENT-LOCAL"; green after), plus the accept/refuse cases (other
   port, other route, `..` normalized away, not a URL) and the non-OK body becoming the error.
2. **Notification click sets the bare project/task id — rejected.** Same premise as Task 18 R1 #2: project/task ids are
   `randomUUID()`, the active ids are flat by spec design.
3. **An in-flight poll whose origin is detached and reused by another machine's tunnel misattributes its result —
   rejected (not reproducible in practice).** Needs machine B detached and machine C's tunnel bound to the same local
   port within the poll's 2 s (notifications) / 1 s (tray) fetch timeout. Tunnel ports come from `listen(0)`
   (`tunnel-manager.ts:94`), i.e. the kernel's ephemeral range (49152-65535 here), which does not hand back a just-freed
   port in that window. The fix Codex suggests (an attachment generation carried through rename) touches the registry
   for a race with no observable repro. Same class as my own pre-report suspicion (reuse between two polls re-using an
   old watermark), also not filed.

Own read that found nothing else: `getArtifacts` in production is `latestArtifactsByType`, so the route serves what the
panel row shows; `FlowPanel`'s `backendId` is a required string; the renderer's tray state (`session-subscriptions.ts`)
already aggregates every session status, so main's background aggregate only matters with no synced window.

### Task 20, round 2 (Codex gpt-5.5, prompted review of `5f0ec24..930a4bb`)

One finding, confirmed and fixed in `4a77b3c`:

1. **A notification raised after a machine's failed first poll is never shown — confirmed, fixed.** `pollOrigin` took
   an origin's first *successful* answer as "what it already held" and set the watermark to its newest stamp. A first
   poll that failed (2 s timeout, backend still starting), then a notification, then a successful poll → dropped. The
   pre-Task-20 code baselined at the client time polling started, so this was a regression. Test "a notification raised
   while a machine's first poll was failing still arrives" (red on `930a4bb`: Received `[]`). Fix: `failedSince`
   records the client time of an unbaselined origin's first failure; on its first success that time is moved onto the
   origin's clock (skew from the response `Date` header, `fetchBackendNotifications` now returns
   `{ notifications, serverTime }`; whole-second resolution errs early, i.e. shows rather than drops) and used as the
   watermark. An origin whose first poll succeeds keeps the old baseline. Detach clears `failedSince` with the
   watermarks. The test puts B's clock 5 min behind; mutation (skew forced to 0) turns it red.

Own read found nothing else: the renderer's local connection in Electron comes from main's `attach-backend`
(`backendOrigin`), so `isArtifactUrl`'s exact origin match holds (the `localhost` origin in `WebSocketProvider` is
the non-Electron dev renderer, which has no `saveArtifact`); relative artifact paths were refused by the old `copyFile`
guard too.

### Task 20, round 3 (Codex gpt-5.5, prompted review of `5f0ec24..4a77b3c`)

One finding, confirmed and fixed in `4509c26`; Codex reviewed R2's failed-first-poll fix and found nothing:

1. **`save-artifact` checks the attached set before the save dialog but fetches after it — confirmed, fixed.** The
   dialog can stay open indefinitely; detaching that machine meanwhile still had its old origin fetched (and, if the
   port is reused by then, another machine's bytes saved). Unlike R1's rejected 1-2 s poll race, this window is as
   long as the user leaves the dialog open. Fix: `fetchArtifactBytes(url, attached)` re-runs `isArtifactUrl` against
   the live attached set when the download starts (throws "Invalid artifact URL", shown in the error dialog);
   `ipc-handlers.ts` keeps the pre-dialog check and passes the same getter. Test "a machine detached while the save
   dialog was open does not get its origin fetched" (red on `4a77b3c`: Received "REPORT"; asserts the server was not
   hit). Codex's stronger suggestion (bind the payload to `backendId`) not taken — see Decisions.

Own read of `notification-poller.ts` found nothing: `failedSince` is set only while unbaselined, cleared on first
success and by the detach sweep; later failures keep the watermark.

### Task 20, round 4 (Codex gpt-5.5, prompted review of `5f0ec24..4509c26`)

One finding, confirmed and fixed in `6c2e364`; Codex found no poller/tray detach leak and no raw-route auth/path issue,
and reviewed R3's fetch-time recheck without objection:

1. **A saved file artifact is held whole in Electron main's memory — confirmed, fixed.** `fetchArtifactBytes` did
   `response.arrayBuffer()` and `save-artifact` wrote the `Buffer`; every file artifact (local ones too, which used to
   stream through `copyFile`) now went through that, so a multi-GB artifact spikes or crashes main. Regression from
   Task 20. Fix: `fetchArtifactBytes` → `downloadArtifact(url, attached, destination)`, which keeps the live
   attached-set check and `redirect: "error"`, then `pipeline`s the body (async generator over `body.getReader()`;
   `Readable.fromWeb` needs a cast that fails under Bun's `ReadableStream` type) into `createWriteStream`, and removes
   the partial file if the stream breaks. Test "a large artifact is written as it arrives, not held whole in memory
   first" (server holds the body open after the first chunk; red with a buffering `downloadArtifact`: Expected
   "PART-1", Received ""), plus "a body that breaks off mid-download leaves no partial file"; the redirect and 404
   tests now also assert no file is created.

Own read of the poller and tray found nothing: an in-flight tray fetch for a detached origin is filtered out by
`origins.has`, a failed poll for a detached origin leaves `failedSince` that the next sweep drops.

### Task 20, round 5 (Codex gpt-5.5, prompted review of `5f0ec24..6c2e364`)

One finding, confirmed and fixed in `0949f63`; Codex found nothing else across the Task 20 diff:

1. **A failed artifact save deletes the file the user chose to replace — confirmed, fixed.** R4's `downloadArtifact`
   streamed straight into the save-dialog path and `rm`'d that path on any error. Codex's sequence: an existing file
   picked as destination, then the body breaks off mid-download → the old file is truncated, then removed. My own
   repro, found independently in the same session: a read-only existing destination → `EACCES` on open → the `catch`
   still `rm`s it, file gone (the old `copyFile` failed without touching it). Fix: stream into
   `.<name>.<uuid>.part` beside the destination, `rename` over it on success, `rm` only the `.part` on failure. Test
   "a failed download leaves the file the user chose to replace untouched" (red on `6c2e364`). The streaming test
   now reads the in-progress `.part` file and asserts none is left afterwards.
   While writing it: R4's break-off test body errored before the response headers, so `fetch` rejected before any
   file was opened and the cleanup path was never exercised (the new test passed on `6c2e364` until
   `breakingBody` errored 100 ms after its first chunk). Both break-off tests use that body now.

### Task 20, round 6 (Codex gpt-5.5, prompted review of `5f0ec24..0949f63`)

Two findings, both confirmed with tests red on `0949f63` and fixed in `ebe46fb`; Codex found R5's `.part` cleanup
sound (pipeline and rename failures remove only the `.part`; beside the destination, so no cross-device rename):

1. **A notification raised while a machine's first poll is in flight is never shown — confirmed, fixed.** The first
   successful answer seeded the watermark with the newest stamp it returned, so a notification created after the
   request left but before the answer counted as "already held". Pre-Task-20 code baselined at polling start, so this
   is a regression (window = request latency, up to the 2 s timeout). Test "a notification raised while a machine's
   first poll is under way still arrives". Fix: an unbaselined origin's cutoff is `failedSince ?? startedAt` moved onto
   the origin's clock via the `Date` header (the R2 path, now shared); only with no `Date` header does the old
   seed-with-newest remain. First version of the test was wrong: A's fake fetch advanced the shared clock before B's
   poll took `startedAt` (both polled in one `Promise.all`).
2. **A destination name near NAME_MAX cannot be saved — confirmed, fixed.** `.<name>.<uuid>.part` adds 43 bytes; a
   250-char name failed with `ENAMETOOLONG`. The partial is now `.taskflow-<uuid>.part`. Test "a destination name as
   long as the filesystem allows can be saved".

### Task 20, round 7 (Codex gpt-5.5, prompted review of `5f0ec24..ebe46fb`)

One finding, confirmed at unit level and fixed in `40aecede`; Codex found nothing else across the diff and confirmed
the ISO string compare is sound (backend stamps `createdAt` with `new Date().toISOString()`, `notification-store.ts:65`):

1. **A machine whose first poll failed and whose answers have no `Date` header gets a watermark on this machine's
   clock — confirmed, fixed.** `failedSince` (client time) was used with skew 0 when `serverTime` was null, so a
   machine with a clock 5 min behind dropped even notifications raised after its first successful answer. Test "a
   machine with a clock behind, no Date header and a failed first poll still gets its notification shown" (red on
   `ebe46fb`: Received `[]`). Fix: with no `Date` header the first answer seeds the watermark (the existing no-clock
   rule), and `failedSince` is dropped either way. Reachability: none with the real backend — a scratch `Bun.serve`
   check showed Bun always sends `Date`, and the SSH tunnel forwards bytes unchanged; this only makes the fallback
   branch coherent.

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
- Task 6: only the `tunnel-args.ts` half of the delta lands here. The `readRemotePort` argv and
  `trustHostKey` (write `KNOWN_HOSTS_FILE`, `~/.taskflow` mode `0o700`, rewrite the scanned line's
  first field to the alias) live in the tunnel manager, so Task 7 must apply them.
- Task 6: the superseded plan's test fixture predates Task 5's `BackendRecord` (`hostSource`,
  `manualPort`); the fixture uses the current shape (`backendUid`, `attached`). The old
  bracket-form `knownHostsKey` test was replaced by alias tests, so the suite is 18 tests, not 14.
- Task 6: `buildKeyscanArgs`, `knownHostsKey`, `KNOWN_HOSTS_FILE` and `hostKeyAlias` are exported as
  the plan's interface says, with no consumer until Task 7. The long `buildTunnelArgs` comment dropped
  the superseded spec's line reference.
- Task 6: the delta's claim was checked before implementing: `ssh -G` with a config setting
  `UserKnownHostsFile`, `GlobalKnownHostsFile`, `HostKeyAlias` and `StrictHostKeyChecking no` reports
  the command-line `-o` values for all four.
- Task 7: `pendingOpens` holds `{ ctx, promise }` rather than a bare promise. `ctx.id` is what the
  open files its child under (moved by `rekeyTunnel`, so a retry after a mid-open rekey registers
  under the new id), and the `finally` deletes by `pendingOpens.get(ctx.id) === pending`, the
  identity delete the delta asks for. `closeTunnel` sets `ctx.cancelled`, so a closed open spawns no
  retry, and `waitForBackend` takes a stop predicate (cancelled or quitting) instead of waiting out
  the 10 s on a killed child. The "not running" shape became `stoppedResult()` ("Taskflow is
  quitting." / "The tunnel was closed.").
- Task 7: `rekeyTunnel` also moves a pending open when no child is registered yet (between retry
  attempts), and closes whatever is already filed under `toId` first; otherwise that child would be
  unreachable and never killed. Task 9's merge path (two records, one uid) should expect this.
- Task 7: exit reports and `deregister` look the child up by identity (`idOf(entry)`), so after a
  rekey the exit is reported under the uid, as the delta says.
- Task 7: new `hostKeyOptions(record)` in `tunnel-args.ts` (StrictHostKeyChecking + the three pinning
  options) is shared by `buildTunnelArgs` and `readRemotePort`, not duplicated. argv unchanged.
- Task 7: `trustHostKey` drops keyscan comment lines and rewrites the first field of each key line to
  `knownHostsKey(record)` (= `hostKeyAlias`). `~/.taskflow` is created with `0o700` only when missing; an
  existing dir's mode is not changed. `trustHostKey` has no test: `KNOWN_HOSTS_FILE` derives from
  `os.homedir()`, which the test preload cannot redirect, so a test would write the real file. Smoke
  instead: an aliased line is found by `ssh-keygen -F taskflow-192.168.1.20-2222`.
- Task 7: the delta's tests run against a real child, not a mock: a fake `ssh` script on `PATH` reads
  `-L`, then answers "Taskflow backend" on the local port after 500 ms. A third test checks a rekeyed
  child's exit is reported under the new id. The concurrency test was red against the plan's "WRONG"
  `existing?.localPort` shortcut.
- Task 8: `ConnectionHooks` is not exported, and the shim does not keep `getBackendOrigin()`: nothing
  outside their modules uses either (project rule: do not export until needed). `getBackendPort()` is
  gone from the shim as the plan says; the test `mock.module` factories that still list it are harmless.
- Task 8: the plan's `await expect(pending).rejects.toThrow(/detach/i)` fails eslint
  `await-thenable` (bun types `rejects.toThrow` as void). The test awaits the rejection and asserts
  `toBeInstanceOf(BackendDetachedError)`, which is stricter.
- Task 8: the only `rawFileUrl` caller is `MarkdownPaneImpl.tsx` (image `src`); it passes `getPrimary()`
  with the `TODO(remote-projects)` comment and falls back to the no-src `<img>` when there is no primary.
- Task 8: a real test of the shim (status subscriber registered before any primary, then
  `connectWebSocket`, sees `connected: true` and a request resolves) passed alone but failed in
  `bun test packages/ui`: other files' global `mock.module("@/hooks/useWebSocket")` replaced the shim
  (`onStatusChange: () => () => {}`). Not committed, to keep the baseline failure list at ten; the shim
  is gone by Task 10/19. The plan-review repro `plan-review/shim-status-before-primary.test.ts` covers the
  plan text, not this code.
- Task 9 carry-overs (Task 5 R1 #4, R3): `confirmBackend` **refuses by rejecting**, touching no tunnel,
  origin or record, when the uid fails `isSafeLabel`, when no record sits under the id (removed mid-handshake),
  and when the record is already confirmed under a different uid (a different backend on that host/port). The
  plan's return type has no failure branch, so rejection is the signal; a note was added to plan Task 10's
  `attach` (at the `confirmBackend` call) to catch it, close the connection and mark the row offline. Tests:
  the three "refuse/refused" tests (mutation check: all three red with the guards removed, green with them).
- Task 9: `MenuEntry` moved from `electron/src/backend-records.ts` to `packages/shared/src/types/backend.ts`,
  because `packages/ui/src/env.d.ts` must type `listBackends()` and cannot import from electron.
- Task 9: the registry takes three more deps than the plan — `fetchHostKeyFingerprint`, `trustHostKey`,
  `forgetScannedHostKey` — and owns `getHostFingerprint(id)`/`trustBackendHost(id)` (look up the record, report
  a thrown error as `reason`). `updateBackend` and `removeBackend` call `forgetScannedHostKey`, as the tunnel
  manager's comment expects; so does a confirm (the scan is filed under the old id).
- Task 9: added `registry.attached()` (live origins, feeds `getAttached`) and `registry.tunnelExited(id)`
  (serialized; drops the origin, keeps the persisted `attached` intent). The IPC layer wires the tunnel
  manager's single `onTunnelExit` to both `tunnelExited` and the `backend-dropped` push.
- Task 9 hardening beyond the plan: `addBackend` and `addDiscoveredBackend` are serialized per id and return the
  existing record when that id is already saved (the plan's unserialized upsert would clobber a record, e.g. its
  `attached` flag, while its attach was in flight); `addBackend` trims the host and rejects an empty host, an
  `instanceId` outside `isSafeLabel`, and ports failing `isValidPort`; `updateBackend` copies only the three named
  fields (an IPC patch spread whole could rewrite `id`/`backendUid`) and refuses an invalid `sshPort`;
  `persist()` writes `backends.json.tmp` then renames (a torn file loads as no machines, and the next write makes
  that permanent).
- Task 9: the registry is created at module level in `main.ts` (so `registerIpcHandlers` can take it) and
  `init()` runs in `whenReady` after `setBackendPort`, before `createWindow`. `app.getPath("userData")` is final
  there (dev mode sets it earlier). The listener's `start()` never rejects, so awaiting `init()` cannot fail
  startup. `registry.stop()` + `closeAllTunnels()` run before `killBackendProcess()` on both quit paths, after
  the confirm dialog.
- Task 9: IPC channel names follow the file's kebab style (`list-backends`, `get-attached-backends`,
  `attach-backend`, …; pushes `backends-changed`, `backend-dropped` `{id, failure}`, `backend-seen` `{id}`).
  `getAttached` omits local while the local backend port is still null, and `attachBackend("local")` then answers
  a `no-backend` failure. `confirmBackend` with a reported uid of `"local"` is rejected in the IPC layer, so a
  remote backend cannot be refiled onto the renderer's local row.
- Task 9: the plan's test file is taken as written except `await expect(...).rejects.toThrow` (eslint
  `await-thenable`, same as Task 8) → a `rejectionOf` helper; 8 tests added (19 total).
- Task 10: the enumeration test is written but `test.todo` (plan says so); Task 19 turns it on. Its scan roots are
  relative to `packages/ui/src` (`import.meta.dir/..`), not the plan's `join(UI_SRC, "..", "src/stores")`.
- Task 10: `attach` wraps `confirmBackend` (carry-over): a rejection drops the connection, marks the row offline with
  main's error message, returns null. The protocol check stays before `confirmBackend` (Task 9 R2) — both live in one
  `handshake(id)` helper shared by `attach` and `rehandshake` (the plan's "extract the tail").
- Task 10 beyond the plan: a per-id attempt counter (`attempts`), bumped by `attach`, `detach`, `retry`. `attach`
  gives up (no side effects) after any await once it moved, so unticking a machine mid-attach cannot resurrect an
  "attached" row. Test: "a detach while the tunnel is opening wins over the attach".
- Task 10: `retry` (carry-over "detach then attach", Task 7 R1) closes the renderer connection, then calls main's
  `detachBackend` **only when `getAttached()` still lists a live non-local tunnel for the id**, then `attach`. Reason:
  main's detach also clears the persisted `attached` intent, so detaching unconditionally would make a machine whose
  tunnel already died (the common retry and `onBackendSeen` case) stop redialling at next launch if the retry fails.
  Residual: when a live tunnel is detached and the re-attach then fails, that intent is lost. Not tested (needs the
  tunnel-alive-socket-dead case).
- Task 10: `onBackendDropped` also drops the renderer connection (stops the socket reconnecting to a dead forwarded
  port); `rehandshake` on a changed uid runs `detach` then records "A different backend answered on this port".
- Task 10: a first-handshake rename removes a row already listed under the uid (a `backends-changed` refresh can land
  before `confirmBackend` resolves) and does nothing when the provisional row is already gone. `refresh` keeps a
  previous `isLocal` row that `getAttached()` omits (local port momentarily null) and carries `backendUid` forward —
  `rehandshake` reads it.
- Task 10: the shim's `connectWebSocket` (and `primaryOrThrow`, `openConnection`/`setPrimary` imports) were removed —
  the provider no longer calls it. Test `mock.module` factories listing it are harmless. The dev (non-Electron)
  renderer opens `local` directly and seeds no machine row, as the plan says. A local attach failure surfaces as the
  provider's `error` with the row's failure message. The local id is a provider-local constant (`"local"`), mirroring
  `electron/src/ipc-handlers.ts`; no shared constant exists.
- Task 10: added `packages/ui/src/stores/backend-store.test.ts` (7 tests: rename, refused confirm, protocol mismatch,
  merge, detach-during-attach, rehandshake uid change, refresh's local row) with a fake bridge and a real `Bun.serve`
  WS backend. Not run: launching the Electron app.
- Task 10 R3: `backend-dropped` bumps the attempt counter. Accepted residual: if the user starts an attach in the instant
  between a tunnel dying in main and the drop push reaching the renderer, main may open a fresh tunnel that this push then
  invalidates; the row ends offline with the drop's reason and the next beacon or retry dials again. No false "attached".
- Task 11: `FetchToken` is not exported (nothing outside `backend-scope.ts` names it). `replace` returns whether the response
  landed, so a store skips publishing and active-id clearing for a discarded one. The plan's scope test pushes `{ id }`
  through `apply`, which cannot typecheck against `Scoped<T>`; those items carry `backendId`.
- Task 11: `lib/test-ws-server.ts` exports `startTestServer(label, respond?)` (default answer `{ from: label }`), records
  `received` requests, and `broadcast(type, payload?)`. `backend-store.test.ts` keeps its own `startBackend` (it holds
  SYSTEM_INFO answers, a different shape); its non-info answers now include empty project and task lists, plus an
  `answerLists` switch for the new bootstrap-failure test.
- Task 11: `aggregation.test.ts` does what `detach` does to renderer state (`closeConnection` + `resetBackend`) instead of
  importing `backend-store`: a second file importing it under its own fake bridge would register the store's module-level
  bridge listeners against that fake, breaking `backend-store.test.ts` when both run in one process.
- Task 11: `fetchProjects`/`fetchTasks` now reject on failure (bootstrap needs the signal); every other caller catches. The
  active project/task is cleared only when it sat in that backend's previous slice and the response lacks it, so one
  machine's list cannot clear another machine's active record.
- Task 11 store interfaces: record-taking `updateProject`/`archiveProject`/`unarchiveProject`/`removeProject`/`forkProject`
  and `updateTask`/`archiveTask`/`unarchiveTask`/`deleteTask`/`fetchTaskLog`; `addProject(backendId, path)`,
  `createTask(backendId, payload)`, `reorderProjects(backendId, ids)`. `applyTaskUpdate` left the public interface (no
  callers). Archived tasks are a second slice set; `setShowArchive(true)` fetches every backend holding a live slice.
  `TASK_LOG_ADDED` is registry-routed (task ids are UUIDs); the task reset also drops that machine's task logs.
- Task 11 `bootstrapBackend`: both legs via `allSettled`; skips if the attempt counter moved; a rejected leg marks the row
  offline with "Could not load this machine's projects and tasks". The socket stays open and `attach` still resolves
  the id (a dev renderer or a missing row must not turn a live attach into null).
- Task 11 call sites with no record to hand go to primary until their task: session-store's post-session refetches
  (`refetchPrimaryRecords`; sessions are shim-routed until Task 13), `useSidebarData`'s fetch on `connected` (the dev
  renderer attaches nothing, and primary reconnects; in Electron it duplicates the bootstrap, settled by the generation
  token — Task 18 reworks this hook), and Add Project via new `requirePrimary()` in `backend-store.ts` (Task 19 gates it).
- Task 11: id-only save paths look the record up when they run (`TaskInfoPanel` drafts and task log, `LinkedProjectsSection`)
  rather than depending on the record, which would re-arm their unmount flushes on every update.
- Task 11 beyond the plan: `useSidebarData`'s PR poll sends `GIT_CHECK_PR` to `task.backendId` — the merged list now holds
  remote worktree tasks, and asking primary could attach a same-path local checkout's PR to them. A project drag reorders
  only within one machine (a drop onto another machine's project does nothing).
- Task 11: `packages/shared/src/utils/task-order.ts` already failed `prettier --check` at HEAD; only the signature changed.
- Task 11 R1: a stale list response is **rebased, not discarded** (departs from the plan's "the response is discarded
  instead"). Relies on every store write being a function of the items it is given; Tasks 12-13 must write through
  `apply` with such functions and fetch through `slices.load`. The plan's "a stale list response is discarded rather than
  overwriting newer state" test still passes unchanged (the replayed write keeps `created`).
- Task 11 R3: clearing `activeProjectId` on detach is left to Task 14's `ui-store` reset (plan-assigned); Task 11's task-store
  reset clears only `activeTaskId`. Until Task 14, detaching the machine of the open project leaves the workspace blank
  (`useActiveWorkspace` scope null) with the stale id, restored if that machine is re-attached.
- Task 12: the settings store keeps `settings` as **primary's** settings, derived from `byBackend` on every write,
  instead of the plan's `primarySettings()`. About 30 app-level consumers (fonts, layout, editor, terminal) read it
  and follow this app's primary, so it stays; nothing in later tasks names `primarySettings`. `settingsFor(backendId)` is
  exported. Only primary's fetch hydrates layout and sends window state. `fetchDataDir`/`updateDataDir` go to primary.
- Task 12: bootstrap fans out notifications, schedules, flows, actions and settings for the machine **without awaiting
  them**; only the project and task legs can mark it offline (the machine's projects and tasks still work without them).
- Task 12 beyond the plan: a notification clear-all (`{ all: true }` event) removes the ids that machine held when the
  event landed, not `() => []`. Replayed over a list answered after the clear, `() => []` would also erase notifications
  created since. Test: "a clear replayed over a list answered after it keeps the notifications created since".
- Task 12 schedule store: `fetchSchedules(backendId)` lost its optional `projectId` (no caller passed one, and a filtered
  list would replace the machine's whole slice); `updateSchedule(schedule, changes)`, `deleteSchedule(schedule)`,
  `triggerSchedule(schedule)`, `createSchedule(backendId, payload)`. The Schedules dialog routes creation by the chosen
  project's machine and fetches primary's schedules and actions on open (other machines' come from their bootstrap and
  `SCHEDULE_UPDATED`). `ScheduleForm` offers only the selected project's machine's actions (none with no project).
- Task 12 flow store: `saveFlow`/`saveAction(backendId, definition)` with new exported `definitionBackend(items, id)`
  (the machine already holding the id, else primary), used by `FlowManagementDialog` and its `.backup.tsx` (which is in
  the ui tsconfig `include`, so it had to compile); `deleteFlow`/`deleteAction` take the record. `applyRunUpdate` left the
  public interface (only the listener used it). `fetchFlowRuns(backendId, ownerId)` clears an owner's run only when the
  held run is on the answering machine. The flow manager fetches primary's definitions on open.
- Task 12 launch defaults, beyond the plan's `AgentOptionsPanel` mention: `AgentOptionsPanel` takes an optional
  `backendId` (omitted = primary's `settings`, for save-side editors), passed by `NewTaskDialog` (selected project's
  machine; its `projects` prop is now `Scoped<Project>[]`), `ScheduleForm` (project's machine) and `TaskCard`'s options
  dialog (task's machine, via new `AgentOptionsDialog.backendId`). Shell and runtime defaults read the target machine in
  `Workspace`, `useSessionSync` and `useRunMenu`. `useRunMenu` takes a required `backendId` (rows pass their record's;
  the command palette passes the active project's, `""` without one, which offers no flows). `useSessionSync` returns the
  workspace's `backendId` (master → primary), used by `Workspace` for `startFlow`, whose flow-input state keeps the
  machine it was opened for. **Not converted** (Task 14's `useWorkspaceBackend` / Task 18): `AgentDropdownMenu` shell and
  its options dialog, `FileContextMenu` shell, `CommitDialog` and `useWorkspaceTabOps` `defaultAgent` plus CommitDialog's
  options panel; a subtask in `NewTaskDialog` with no project selected still gets primary's defaults.
- Task 12: `diff-store` now listens on the registry (it was on the primary-only shim), so every machine's change stats land.
  `TaskSidebar`'s native notification click finds the record by id (UUID) before `markAsRead`; Task 20 reworks the poller.
- Task 12: `backend-store.test.ts`'s fake bridge gained a no-op `sendTrayState`: the bootstrap now imports the flow store,
  which pulls in `session-store`, whose subscriptions report the tray at import.
- Task 12 R2 (was a suspicion, confirmed): master runs from non-primary machines are dropped in `applyRunUpdate` rather than
  re-keying `activeRuns` by (machine, owner). The master workspace addresses primary, and task/project owner ids are
  UUIDs, so only the master key collided; re-keying would touch `App.tsx`, `useSessionSync`, `useRunMenu` and `FlowPanel`.
  If primary changes while a master run is live, the old primary's run stays in the map until a fetch replaces it.
- Task 12 R1: `NewTaskDialog`'s `flows` prop became `flowsFor(projectId)` (the dialog's project is internal state; a subtask
  needs the parent task, which only the host has). The dialog is not component-tested for this: Radix `Select` options do
  not render under happy-dom without opening, and no test in the repo drives one; the pure helper carries the test.
- Task 12 R1, not fixed (Task 19 Step 4 owns the manager): `FlowEditor`'s project picker still offers every machine's
  projects, so a new flow (saved to primary) could be given another machine's `projectId`. Not reproduced; Task 19 points
  the manager at primary's data.
- Task 13: a sync's `ownedWorkspaceKeys` is **the keys that machine's previous sync held plus its current ones**
  (`claimWorkspaceKeys` in `session-store.ts`, module map `workspaceKeysByBackend`), not the plan's "built from that
  backend's own records". With current keys only, a task deleted on its machine is never in the owned set, so its tabs
  are carried over forever. Test: "a machine's list prunes its own vanished task and keeps the other machine's" (red
  with the plan's current-keys-only set). A `:right` key is owned when its base key is (`baseWorkspaceKey`, new in
  `session-helpers.ts`, shared by the sync and the reset); the plan's carry-over snippet would otherwise keep a dead right
  pane. Test: "an owned workspace whose session is gone loses its right pane too".
- Task 13 `useSidebarData`: the per-backend sync effects cover machine rows ∪ `primaryId` ∪ every `backendId` in the
  records (the dev renderer has no machine rows; a machine whose last task is gone still needs its tabs pruned). The
  `connected` effect now calls `bootstrapBackend(primary)` (projects, tasks, flows, actions, notifications, schedules,
  settings), which also replaces the separate notifications effect. Primary's settings are still awaited before
  `fetchThemes` there (themes read `appearance.theme`), so settings are fetched twice on connect. Master sessions are
  requested from primary through the registry.
- Task 13: `syncWithMasterSessions(backendId, sessions)` gained the id so the reset knows whose master tabs they are
  (`masterBackendId`). `MASTER_SESSIONS_LIST` and a `master` `BROWSER_OPEN` apply only from primary; task/project
  `BROWSER_OPEN` from any machine (UUID keys).
- Task 13 session ownership: `session-activity.ts` notes each session's machine from `TERMINAL_OUTPUT`/`SESSION_STATUS`
  (the only sources of status) and exports `sessionsOwnedBy`, `noteSessionBackend`, `forgetSession` (timer + interaction +
  owner; used on `SESSION_EXITED`). `clearInteraction` is no longer exported. The `session-store` reset drops the machine's
  workspace keys (+ right panes, + master when it held it), `sessionStatus` for sessions it owned or had tabs for, and
  calls `forgetSession` for them, so timer clearing is done by both resets (mutation: removing either alone stays green,
  removing both turns the debounce test red).
- Task 13, **not converted, and no later task names it**: session requests in `session-store.ts` (`SESSION_CREATE`,
  `SESSION_CLOSE`, `SESSION_RESUME`, `SESSION_INPUT`, `TERMINAL_RESIZE`, `SESSION_RENAME`) still go through the shim to
  primary, and `refetchPrimaryRecords` stays. The plan's Task 13 steps cover only sync, reset, activity and subscriptions.
  Until routed, a remote machine's terminal tab shows its output and status but input and new sessions go to primary.
  Task 19 Step 5 (delete the shim, resolve each remaining call site with the record's own backend) is where it must land
  at the latest; Task 18's implementer should check first.

- Task 14: the store-reset enumeration test is **on now** (plan Task 14 Step 6c), not in Task 19 as Task 10's note said;
  Task 19 Step 6 is then already done. `STATELESS` holds the three machinery files the plan names plus, each with its
  reason in the diff: the `useWebSocket` shim, `attribute-api`, `run-in-shell`, `wiki/open-in-obsidian`,
  `useRemoteAgentStatus`, `useRunMenu`, `session-subscriptions`.
- Task 14: no `run-menu-cache`. `useRunMenu` holds no module cache (scripts and agent commands are component state); its
  two requests now go to the row's machine and the file is listed as stateless.
- Task 14: per-machine maps are **nested** (`Map<backendId, Map<path, …>>`, `indexByBackend[backendId][root]`) instead of
  the plan's `${backendId}:${path}` string keys. Provisional ids contain `:`, so a reset matching a string prefix could
  drop another machine's keys. Applies to the stat cache (`file-stat-cache`), the tsconfig cache (`tsconfig-cache`) and
  the wiki store.
- Task 14: `createPerBackendCache` does not cache a fetch that lands after its machine's reset (it still returns it), and
  never caches a failure. Tests for both beside the plan's three.
- Task 14: `useWorkspaceBackend` reads primary from the connection registry (`useSyncExternalStore(onPrimaryChange,
  getPrimary)`), not `useBackendStore` as the plan's snippet does. Same value; keeps backend-store's store graph out of
  pane components and their `mock.module` tests. `useActiveWorkspace` does the same for master's homedir.
- Task 14: new exported `workspaceBackendId(workspaceKey)` in `useActiveWorkspace.ts`, for code holding a key rather than a
  record (`open-file`, `MarkdownPane`, the terminal link provider); a `:right` key resolves to its base.
- Task 14 `open-file`: `ensureEditorsCached` is gone; `getInternalEditorId(backendId, internalEditor)` is async. The
  `internalEditor` setting itself is still primary's `settings`.
- Task 14 `ui-store`: **no reset named `ui-store`.** `forgetRecords({ projectIds, taskIds })` is called from the
  project-store and task-store resets, which still hold the dropped ids. Resets run in registration order, so a separate
  reset could run after those drops and no longer tell which ids were the machine's. It clears `activeProjectId`,
  `sidebarFocusedItem`, `collapsedProjectIds` and `task:`/`project:` split keys (master kept). A detached machine's
  collapsed ids therefore leave the persisted layout at its next save, as the plan directs.
- Task 14 `file-store`: `watched: { backendId, path }`; `FILE_CHANGED` comes through the registry and is filtered by
  machine; the previous machine's `FILE_UNWATCH` is `.catch`-ed so an unreachable old machine cannot block the new watch;
  `watchGeneration` drops a watch that lands after a newer watch, unwatch or detach; the reset clears the watch and the
  explorer state. **Not converted:** tree, listing, git status, read/write/rename, open-external/reveal requests still go through the shim to
  primary (Task 19 Step 5), so a watched remote change refreshes the tree from primary until then.
- Task 14 `search-store`: `searchBackendId` is set when a search starts; cancel and every replace go to that machine, and
  the replace signatures did not change. The plan's "refuse a cancel that does not match" became "a cancel can only
  address the search's own machine". A generation counter drops late answers; the reset keeps query and options.
- Task 14 `theme-store`: remembers the primary that answered `THEMES_LIST`; when that machine detaches its reset restores
  the bundled list and clears `scannedApps`, keeping the applied theme until the next fetch. Not tested.
- Task 14 connectivity: one `online` for primary; status answers and events from other machines are ignored;
  `initConnectivity(backendId)` guards per machine.
- Task 14 Monaco: `syncCompilerOptions(backendId, filePath)` (EditorPaneImpl passes `useWorkspaceBackend` through a ref so
  a machine change does not recreate the editor). `TS_RESOLVE_IMPORT` in the definition provider still uses the shim,
  with a `TODO(remote-projects)` for Task 15's machine-scoped URIs.
- Task 14: `CodexModelSelect` takes `backendId`, threaded through `CodexOptions` (`CodexSection`: primary;
  `AgentOptionsPanel`: its `backendId` ?? primary, which also drives its agent availability).
- Task 14 carry-overs done: `AgentDropdownMenu` (agents, shell list, configured shell, options dialog), `FileContextMenu`'s
  shell, `CommitDialog` (default agent, agents, options panel) and `useWorkspaceTabOps`' default agent read the workspace's
  machine, falling back to primary's `settings` with no workspace machine; `Workspace`'s worktree `FILE_STAT` goes to the
  task's machine; `NewTaskDialog`'s agents follow the selected project's machine; `SettingsModal`'s are primary's.
  Session creation is still primary-routed (Task 13 note), so for a remote workspace the shell path comes from the remote
  while the session lands on primary until sessions are routed.
- Task 14: `useAgentAvailability`'s `onStatusChange` cache clearing is deleted (plan). A backend that restarts with a newly
  installed agent is not re-detected until a detach and re-attach.
- Task 14: repros `file-backend-collision.repro.test.ts` and `wiki-backend-collision.repro.test.ts` deleted (plan notes), so
  the known baseline failures are nine now. The three `MarkdownPaneImpl` test mocks of `useActiveWorkspace` gained
  `workspaceBackendId`.
- Task 14 R1: search results carry their machine **and root** (`searchBackendId`, `searchRoot`, set when results
  land); `replaceMatch(filePath, match)`, `replaceInFile(filePath)`, `replaceAll(filePath?)` no longer take a root.
  This supersedes "`searchBackendId` is set when a search starts" above. Opening a result still uses the open
  workspace's key (pre-existing; a remote result opens from primary until Task 15/19 anyway).
- Task 14 R1: a file watch that lands stale is released on its machine unless the newest request is the same
  watch. Not fixed (pre-existing, same-machine too): `watchPath` returns early when `watched` already equals the
  target even if a newer watch for another target is still in flight.
- Task 14 R2: `unwatchPath` clears `watched` only if it still names the unwatched machine and path after the answer.
  `AgentDropdownMenu`'s shell-list effect drops a late answer (cancel flag).
- Task 14 R2 deferral → **Task 18**: convert `useSessionSync`'s `SCRIPTS_LIST`, `AGENT_COMMANDS_LIST` and
  `SHELLS_LIST` (`useSessionSync.ts:133,153,170`) to the registry with the workspace `backendId`, add `backendId` to
  those effects' deps, and guard the shell effect against late answers. Until then a remote workspace's run menu shows
  primary's scripts/commands.
- Task 15: the model URI's authority is the backend id **hex-encoded** (UTF-8 bytes), not the raw id. Probed:
  `Uri.toString()` lowercases an authority (`Laptop` and `laptop` → one model key, and `parse` returns `laptop`) and
  treats text after the last `:` as a port. Monaco's registry keys models by `toString()`. Extra tests: case-only ids
  stay distinct, a provisional `host:instance` id round-trips; mutation (raw authority) turns 3 tests red.
- Task 15: `backendFromModelUri` returns `string | null` (null for any URI this module did not build, e.g. the diff
  viewer's in-memory models); the opener returns `false` and the definition provider `null` for those.
- Task 15 `editor-dirty-state`: maps are **nested** `Map<backendId, Map<path, …>>` with accessors
  (`isEditorDirty`, `setEditorDirty`, `clearEditorDirty`, `getViewState`, `saveViewState`, `setPendingLine`,
  `consumePendingLine`, all backend-first), not `modelKey` string keys. The module is reached from the main bundle
  (`open-file`, `WorkspacePane`), so it keeps monaco type-only; parsing keys needs runtime monaco. Its reset is
  `editor-dirty-state`. Model disposal is a separate `editor-models` reset in `editor-uri.ts` (lazy editor chunk) that
  disposes **every** model with that machine's authority, including import-navigation placeholders the plan's
  dirty-keys loop would miss. The pane's unmount skips `dispose` when the reset already disposed the model.
- Task 15 `EditorPaneImpl`: `backendId` is now an effect dep (the Task 14 ref is gone): the model identity depends on
  it. With no workspace machine (`null`) the pane shows "Loading..." and creates no model. A record's id is rekeyed at
  handshake, before bootstrap loads projects, so an open workspace's machine does not change under a dirty model.
- Task 15 import navigation: the placeholder model is created with `getLanguage(path)`; a model URI has no extension
  to infer it from, and the pane reuses the placeholder as it finds it (would have opened a `.ts` file as plaintext).
  The Cmd-click callback takes `(backendId, filePath)` and does nothing when the active workspace's machine differs.
  Same-file definitions compare machine and fragment path. `TS_RESOLVE_IMPORT` goes to the model's machine.
- Task 15, behaviour change not reproduced: the TS worker's file names are now `taskflow-file://…/#<encoded path>`,
  so its own relative-import resolution between open models (hover types from another open file) no longer finds
  them. Semantic validation is off and import navigation uses the backend, so only hover/quick-info across files is
  affected. Not re-checked in the Electron app; Task 22.
- Task 15: `WorkspacePane` close and `open-file`'s pending line use `workspaceBackendId(workspaceKey)`; with no
  machine the tab closes without the unsaved-changes prompt (nothing can be dirty without a machine). `MarkdownPaneImpl`
  images use the pane's `useWorkspaceBackend()` (was primary). **Still primary:** `readFile`/`writeFile` in the editor
  pane go through `file-store`'s shim (Task 14 note; Task 19 Step 5), so a remote workspace's editor has a
  per-machine buffer but reads and saves primary's file until then.
- Task 15: repro `editor-uri-opener.repro.test.ts` deleted (plan notes).
- Task 15 R1: `EditorPaneImpl.machine.test.tsx` mocks `monaco-editor` with `mock.module`; it passes in the full
  `bun test packages/ui` run without breaking `editor-uri.test.ts`, but if a leak shows up, run it per file (see the
  bun mock.module gotcha).

- Task 16: `MachineState` gained a required **`keepAttached`** (main's persisted intent: `refresh` copies
  `MenuEntry.attached`, local rows `true`, `attach` sets `true`, `detach` sets `false`). `state` alone cannot tell a
  machine the user detached from one whose tunnel died (both `offline`, failure often undefined after a socket
  drop), and only the second keeps its section. Consequence: `rehandshake`'s uid-mismatch path calls `detach`, so
  that section disappears with its "different backend" message; Task 17's menu is where that message is visible.
  Task 17 should read `keepAttached` for its checkboxes.
- Task 16: `MachineSection` props are `{ machine, projects, open, onOpenChange, renderProjects }`, not the plan's
  `{ machine, projects }`. The sidebar passes its project-list renderer (badges, handlers, drop zones), so every
  machine's rows are `ProjectGroup`s wired exactly like local's. Section collapse is `TaskSidebar` state
  (`collapsedMachineIds`), not persisted. Local renders through `renderProjectList` directly (and
  `MachineSection` renders no header for an `isLocal` row, as the plan's test asks).
- Task 16: new `components/sidebar/machine-groups.ts` (`groupProjectsByMachine`, `shownProjects`). A project whose
  machine has no row (dev renderer) groups as local; a detached remote machine's projects are not shown.
  Beyond the plan: number badges and `useSidebarNavigation` (now takes `shownProjects`) follow the sections'
  top-to-bottom order; before, they used the store's slice load order, which a remote machine loading first would
  reorder. Navigation also now walks the sidebar's archive-filtered list rather than re-filtering the store.
- Task 16: the empty state ("No projects yet") shows only when there are no local projects **and** no remote
  sections.
- Task 16 `OfflineIndicator`: the plan says it "reflects one global connection"; it actually showed primary's
  internet connectivity. That icon is kept; beside it, a new button names the open workspace's machine when that
  machine is `offline` ("<name> offline", tooltip = failure message) or `incompatible` ("<name> needs update"),
  and clicking it calls `retry`. Another machine being down shows only in its section. Not component-tested.
- Task 16 not run: the Electron app (no second machine; Task 22). The "pixel-identical when nothing else is
  attached" claim holds by construction (local list is the same markup, same badge numbers), not by screenshot.

- Task 17: the menu follows `AgentDropdownMenu`'s two branches — a native menu when `supportsNativeMenus()`, Radix
  otherwise — from one `buildRows`. Native items fold the status into the label (`Laptop — attached`). Radix checkbox
  rows keep the menu open (`preventDefault`) so several machines can be ticked at once. The Monitor button now opens
  the menu; Master Workspace is its first (checkbox) item. `aria-label` is "Machines".
- Task 17: checkboxes read `keepAttached` (Task 16 decision). **Primary's row is disabled**: detaching primary would
  leave the app-level surfaces addressing nothing; leaving it is Task 21's hard switch.
- Task 17: "Work as…" is a submenu listing every non-primary machine, **all items disabled** with a
  `TODO(remote-projects)` for Task 21 (no `workAs` exists yet). Task 21 enables them.
- Task 17: instance shown in labels when `instanceId !== "main"` (`Desktop · dev-x`), not MachineSection's
  "host runs another instance" rule; the menu also lists unsaved entries that rule does not see.
- Task 17: row statuses: local none; `connecting`, `attached`, `needs update`; offline shows the failure message,
  else `offline` when kept attached, else `seen` / `saved, not seen` (from `listBackends()`'s `seen`). An unsaved
  discovered entry is an "Add <name>" item: `addDiscoveredBackend(entry.id)` → `refresh()` → `attach(record.id)`.
  Bridge errors from menu actions show as a destructive label at the top of the menu (cleared by the next action).
- Task 17: opening the menu calls `probeBackends()`, `listBackends()` and the store's `refresh()`; a
  `backends-changed` subscription keeps the entry list fresh while mounted. Icon: spinner while any kept-attached
  machine is attaching; `text-destructive` when a kept-attached remote machine is offline/incompatible (wins over
  master's accent); a `bg-success` corner dot while any remote machine is attached.
- Task 17 trust: no `pendingTrust` state. `MachinesMenu` mounts `TrustHostKeyDialog` (keyed by machine id) for the first
  machine whose `failure.kind` is `unknown-host-key` or `changed-host-key` and whose failure object was not dismissed
  (a set of dismissed `TunnelFailure` objects; a new failure is a new object, so it opens again). So a persisted-attached
  machine failing on its host key at launch opens the dialog unprompted. The unknown-key dialog scans on mount
  (`getHostFingerprint`), parses `ssh-keygen -lf` lines into type + fingerprint, enables "Trust and connect" only with
  keys shown, then `trustBackendHost` → `attach`; a refusal clears the keys and offers "Check again". The changed-key
  dialog shows `failure.message` and the stderr lines starting `Offending`, with only Close.
- Task 17: `MenuEntry` gained optional `user` and `sshPort` (set by `mergeForMenu` for saved rows) so Manage can prefill
  the fields. Manage: blank name/user/ssh port refused (R1: blank port no longer means unchanged); Save disabled until a field changes;
  Remove disabled on primary's row and runs the store's `detach` first (closes the socket, resets the machine's
  slices) when the machine has a row, then `removeBackend`. Refreshes come from `backends-changed`.
- Task 17: Connect: host, ssh user, ssh port, backend port (blank = resolved over ssh); `addBackend` → `refresh()` →
  close → `void attach(record.id)`. Port parsing and the Electron "Error invoking remote method" prefix stripping live in
  new `components/sidebar/backend-fields.ts` (`parsePort`, `ipcErrorMessage`), shared by the three dialogs/menu.
  `isValidPort` from `@taskflow/shared/discovery` was not reused: that barrel pulls in the dgram sockets.
- Task 17, Task 16 R1 suspicion **fixed**: `refresh` keeps `keepAttached: true` for a row whose state is `attaching`,
  so a `backends-changed` landing before main persists `attached: true` no longer drops the section. Test: "a refresh
  while the user's attach opens the tunnel keeps the machine wanted" (red with the line reverted). Not changed: a
  **failed** attach of a detached machine keeps `keepAttached: true` (section with the failure and Retry) until the next
  refresh copies main's `false`; the menu row still shows the failure message.
- Task 17 not run: the Electron app (native menu branch, dialogs against a real ssh host; Task 22). Native menu items
  use `type: "label"` and `type: "submenu"` from `NativeMenuItem`; not exercised in a test.

- Task 18: `useRunMenu`'s `SCRIPTS_LIST`/`AGENT_COMMANDS_LIST`, `ProjectGroup`/`TaskCard` passing the record's
  `backendId`, the per-task PR poll and primary-only `MASTER_SESSIONS_LIST` were **already done** (Tasks 11-14), so
  `useSidebarData.ts`, `ProjectGroup.tsx` and `TaskCard.tsx` are unchanged. The plan's first routing assertion is
  green on the base commit; the file's second test (a script run from the menu) is the red one.
- Task 18 test is `useRunMenu.routing.test.tsx` (not `.ts`: it renders a probe component). `test-ws-server` now
  records fire-and-forget messages in `received` too (needed to see `SESSION_INPUT`); no existing test counted them.
- Task 18 **beyond the plan, the Task 13 carry-over**: session requests are routed. `createSession`'s owner takes an
  optional `backendId` (stripped from the payload); without it the machine comes from `workspaceBackendId` of the
  owner's workspace key (master → primary), and no machine throws instead of falling back to primary. The new id is
  noted with `noteSessionBackend`. Close/resume/input/resize/rename use `sessionBackend(id)`: the noted machine, else
  the machine of the workspace whose tab holds it; input/resize/rename with no machine are dropped, close/resume throw.
  `refetchPrimaryRecords` → `refetchRecords(backendId, …)`. `session-activity` exports `sessionBackendOf`.
- Task 18: `runInShell` takes a required `backendId` (its `SHELLS_LIST` and the session go there); `useRunMenu` passes
  the row's, `Workspace` its `useSessionSync` machine (does nothing without one).
- Task 18: Task 14 R2 deferral done — `useSessionSync`'s scripts, agent commands and shells go to the workspace's
  machine with `backendId` in deps; the shell effect drops late answers.
- Task 18: `attribute-api` functions take `backendId` first; `AttributesSection` has a required `backendId` prop
  (captured in each debounced save, part of `ownerKey`); `TaskInfoPanel` passes the record's.
- Task 18 notifications: `handleNotificationNavigate` and `NotificationPopover`'s project name match
  `backendId` + id. The native click (`onNotificationClicked`) still finds the record by UUID; its payload
  `backendId` is Task 20.
- Task 18 **still primary (Task 19 Step 5)**: `terminal-lifecycle`'s `SESSION_SNAPSHOT`/`SESSION_HISTORY`, and the other
  shim callers listed above. Not component-tested: `AttributesSection` routing, notification navigation.

- Task 19: Step 6 was already done in Task 14. `STATELESS` lost the shim and gained `hooks/useWorkspaceRequest.ts`.
- Task 19 `useIsLocalBackend`: with **no machine rows at all** (the dev renderer) the backend is local; with rows, an id
  with no row is not local. Pure `isLocalBackend(machines, id)` is exported for non-React code
  (`terminal-link-provider`); `useLocalOnlyHint(id)` returns the tooltip naming the machine, or null.
- Task 19 "disabled, visible, tooltip" mechanics: a disabled button takes no pointer events, so the `title` sits on a
  wrapper `span`/`div`. Radix menu items (also `pointer-events-none` when disabled) get the `title` plus a visible
  " (not on this machine)" label suffix; native menu items `enabled: false` plus the suffix. The data-folder section
  also shows its reason as text.
- Task 19 gating predicates: **workspace machine** — `FileContextMenu` open-external/reveal (backend-side
  `FILE_OPEN_EXTERNAL`/`FILE_REVEAL`), `WikiPanel` reveal, `TerminalPane` native file drops (the drag is refused; no
  tooltip is possible on a drop), terminal Cmd-click (a remote path opens in the app instead of Finder/external editor).
  **Record's machine** — `MissingLocationDialog` (project), `FlowInputDialog` (new required `backendId` prop: `TaskCard`
  task's, `ProjectGroup` project's, `Workspace` `flowInputState.backendId`). **Primary** — `NewProjectDialog` (Add Project
  goes to primary via `requirePrimary`), `ImportTab` "From File…" (themes import into primary), `SettingsModal` data
  folder (Change and Reset both disabled). Plan's `Workspace.tsx:251,391` (`runInShell`) **not gated**: Task 18 routes it to
  the workspace's machine, so it is not a local-path affordance. `openExternalUrl` untouched.
- Task 19 beyond the plan: Obsidian opens on this machine, so for a remote workspace `WikiPanel`/`MarkdownPane` do not
  fetch Obsidian state and show no Obsidian item (as if not installed). `fetchObsidianState(backendId, root)`.
- Task 19 managers: `FlowManagementDialog` and `ScheduleManagementDialog` filter flows, actions, projects and schedules to
  `backendId === primary` (new `hooks/usePrimaryBackend.ts`, also used by `useWorkspaceBackend`); flow/action saves go to
  primary (`definitionBackend` is now only used by `.backup.tsx`). `FlowEditor` filters its project picker by its
  `backendId`; `ActionEditor` gained a required `backendId` and does the same — closes the Task 12 R1 note.
- Task 19 shim callers: `file-store` ops all take `backendId` first; new `treeBackendId` state (set by `fetchTree`, used
  by `fetchDir`, a listing answered after the tree moved machines is dropped); git status remembers its machine;
  `writeFile` refreshes git status only for the watched machine. The four file dialogs and `FileExplorer` use the
  workspace machine; `EditorPaneImpl`/`MarkdownPaneImpl` the pane's (markdown `FILE_CHANGED` filtered by machine; no
  machine → keeps loading). `terminal-lifecycle` `SESSION_SNAPSHOT`/`SESSION_HISTORY` go to `sessionBackend(sessionId)`
  (now exported from `session-store`). `theme-store` via local `sendToPrimary`. Kimi/Pi/OpenCode model selects take
  `backendId` threaded like Codex (settings sections: primary; `AgentOptionsPanel`: `agentBackendId`) and refetch on a
  machine change. `SettingsModal` shells/runtimes/system info → primary; `useRemoteAgentStatus(backendId)` filters its
  event by machine. `TaskHeader` pull → record's machine. `CommitDialog`, `ChangesPane`, `HistoryPane` via new
  `useWorkspaceRequest()` (rejects with no machine). `useWorkspaceTabOps` shells → workspace. `WebSocketProvider` uses new
  registry `onPrimaryStatusChange` (the shim's follow-primary logic, moved; tested).
- Task 19 tests: `useWebSocket.test.ts` deleted with the shim; its mount-crash test moved to
  `hooks/useActiveWorkspace.mount.test.ts` (the other two tested shim-only behaviour). `file-store.test.ts` no longer mocks
  anything: listings are asserted per test server; new "expanding a directory lists it on the machine that listed the
  tree" (mutation: `fetchDir` using the watched machine turns exactly it red). `CommitDialog.test.tsx` mocks
  `useWorkspaceRequest` (pre-existing, unchanged: a failed git status leaves `ahead` null and the Commit button loading).
  The three `MarkdownPaneImpl` tests' mocked project gained `backendId`. New `useIsLocalBackend.test.ts` (pure helper).
- Task 19 not component-tested: every gating UI (disabled + tooltip), the managers' primary filter, terminal drop and
  Cmd-click gating, model-select routing. `backend-host.ts`/`.test.ts` comments named the deleted file; updated
  (`backend-host.test.ts` already failed `prettier --check` at HEAD).

- Task 19 R1: the own fix (`63c4b71`) only changes two menu labels and adds a string constant, so it skips review per
  the flow's trivial-change rule; Task 19 is marked clear after R1.

- Task 20: new `electron/src/attached-backends.ts` (`LOCAL_BACKEND_ID`, moved from `ipc-handlers.ts`, and
  `listAttachedBackends(localPort, registry.attached())`) is the one list of reachable backends, used by
  `get-attached-backends`, the poller, the tray and the `save-artifact` origin check.
- Task 20 poller: `notification-poller.ts` no longer imports electron (so its test imports it without mocks):
  `createNotificationPoller({ getAttachedBackends, fetchNotifications, notify })` returns `poll/start/stop`; `main.ts`
  builds the Electron `Notification` in `notify`. Watermarks are keyed by origin. **An origin's first answer only
  seeds its watermark** (newest `createdAt` it holds, `null` if none) instead of the old "app start time on this
  machine's clock": a remote clock may differ, so a local timestamp says nothing about its stamps. Origins no longer
  attached are dropped (a tunnel port can later be reused by another machine); a re-attached machine reseeds, so
  notifications raised while it was detached are not shown natively (the in-app list still has them). A poll is
  skipped while the previous one runs. `notify` gets `backendId: () => string | null`, looked up from the origin at
  click time; `main.ts` sends `notification-clicked` (now with `backendId`) only when it resolves, and still
  shows/focuses the window when it does not. `TaskSidebar` matches `backendId` + id.
- Task 20 tray: per-origin last state (a failed fetch keeps that origin's previous state), pruned like the
  watermarks; the icon shows `attention` over `working` over none. `startTrayStatePolling` no longer needs the local
  port up front. Not tested (the module imports electron).
- Task 20 artifacts: `save-artifact` takes `{ url?, text?, defaultName? }` (the `path` + `copyFile` branch is gone).
  Main refuses a `url` whose origin is not attached or whose path is outside `/api/flow/artifact/`, **before** the save
  dialog; after it, main fetches the URL and writes the bytes (a non-OK answer's body becomes the error dialog text).
  `FlowPanel` builds the URL from `originFor(backendId)` + encoded `ownerId/flowId/type` (does nothing without an
  origin). The route decodes its params (the router matches them raw), serves the **newest artifact of that type**
  (what the panel row shows; a newer save between render and click downloads the newer one), and answers 404 for no
  run / no artifact / text artifact / relative path / missing file / directory. Relative paths were already refused
  by the old client (`Invalid source path`). Response: `application/octet-stream`, `Content-Disposition: attachment`,
  `nosniff`, `no-cache`. Test: `packages/backend/tests/api/flow-artifact-raw.test.ts` (4 tests; the plan names no
  route test).
- Task 20 not run: the Electron app (native notifications, tray, save dialog against a remote machine; Task 22).
- Task 20 R3: the artifact download re-checks the origin against the attached set at fetch time, not the backend id.
  Binding the IPC payload to `backendId` would also catch another machine attached on the reused port while the
  dialog is open, but needs preload/renderer changes for a case that again rests on ephemeral-port reuse (R1 #3).
- Task 20 R4: artifact saves stream to disk; the non-OK error body is still read whole (backend error strings are
  short), and the partial-file cleanup was not mutation-checked.
- Task 20 R5: artifact saves write `.<name>.<uuid>.part` beside the destination and `rename` over it when complete,
  so a failure never touches the chosen path. Consequence taken: replacing an existing read-only file now succeeds
  (rename needs only a writable directory, and the user confirmed the replace in the dialog), and the replaced file's
  permissions are not carried over.
- Task 20 R6: the partial file is `.taskflow-<uuid>.part` (not named after the destination). A machine's first
  successful poll baselines at the time that poll left (on the machine's clock). Consequence taken: since `Date` is
  whole-second and latency pushes the cutoff earlier, a notification raised up to ~1 s before the first poll can be
  shown natively at start/attach (shows rather than drops, like R2).
- Task 20 R7: with no `Date` header, an origin's first successful answer always seeds its watermark with the newest
  `createdAt` it holds, even after failed polls; notifications raised during those failures are then not shown
  natively (in-app list still has them). Client time is never compared with a machine's stamps.

## Validation baseline

After Task 20 R7 fix (`40aecede`): `bun test electron/src` 82 pass (3 runs); new poller test red on `ebe46fb`;
`bun run typecheck` clean; eslint and prettier clean on the two touched files.

After Task 20 R6 fix (`ebe46fb`): `bun test electron/src` 81 pass (3 runs); both new tests red against `0949f63`'s
modules (scratch copies); `bun run typecheck` clean; eslint and prettier clean on the four touched files; `electron`
`bun run build` ok.

After Task 20 R5 fix (`0949f63`): `artifact-download.test.ts` 7 pass (3 runs; new replace test and updated streaming
test red on `6c2e364`); `bun test electron/src` 79 pass (7 files); `bun run typecheck` clean; eslint and prettier
clean on the two touched files; `electron` `bun run build` ok; scratch read-only-destination repro now saves.
After Task 20 R4 fix (`6c2e364`): `artifact-download.test.ts` 6 pass (3 runs; streaming test red with a buffering
implementation); `bun test electron/src` 78 pass; `bun run typecheck` clean; eslint and prettier clean on the three
touched files; `electron` `bun run build` ok.
After Task 20 R3 fix (`4509c26`): `bun test electron/src` 76 pass (7 files); `artifact-download.test.ts` 4 pass (new
test red on `4a77b3c`); `bun run typecheck` clean; eslint and prettier clean on the three touched files.
After Task 20 R1 fix (`930a4bb`): `bun test electron/src` 74 pass (7 files); `artifact-download.test.ts` 3 pass, red
(1 fail) with `redirect: "error"` removed; `bun run typecheck` clean (all packages); eslint and prettier clean on the
three changed files.

After Task 20 (`f7438e4`): `notification-poller.test.ts` 4 pass; mutation check (one watermark shared by every origin, run
on a scratch copy) turns exactly "a machine's notification older than another machine's newest still arrives" red.
`flow-artifact-raw.test.ts` 4 + `routes.test.ts` = 21 pass; `FlowPanel.artifacts` 2 pass. Suites run one after another:
`bun test electron/src` 71 pass; `bun test packages/backend` 676 pass, 2 skip, 0 fail; `bun test packages/ui` 297 pass,
9 fail (the known nine). `bun run typecheck` clean (incl. electron's Bun-less `tsconfig.src.json`); eslint and prettier
clean on the twelve changed files; `electron` `bun run build` ok. Not run: the Electron app (Task 22).

After Task 19 R1 fix (`63c4b71`): `bun run typecheck` clean; eslint and prettier clean on the three changed files;
`useIsLocalBackend` 4 pass.

After Task 19 (`3ce63bc`): `bun run typecheck` clean; eslint clean on the 64 changed files; prettier clean on them except
the pre-existing `backend-host.test.ts`. Each alone: `file-store` 12, `useIsLocalBackend` 4, `store-reset` 4,
`CommitDialog` 2, `MarkdownPaneImpl` anchors 3 / checkbox 5 / rerender 1, `EditorPaneImpl.machine` 2,
`useActiveWorkspace.mount` 1, `useRunMenu.routing` 2, `backend-store` 15, `connection-registry` 8, `backend-host` 18 pass.
`bun test packages/ui` 297 pass, 9 fail (the known nine). Not run: the Electron app (Task 22).

After Task 18 (`ae16a8a`): `useRunMenu.routing.test.tsx` 2 pass (3 runs; on `c586fef` the list test passed and the
script-run test timed out: nothing reached `b`); `AttributesSection` 19, `session-sync.backend` 6, `session-sync` 9,
`store-reset` 4, `AgentDropdownMenu.shells` 1, `aggregation` 16, `file-store` 11 pass (each alone); `bun test
packages/ui` 293 pass, 9 fail (the known nine); `bun run typecheck` clean; eslint and prettier clean on the fifteen
changed files. Not run: the Electron app (Task 22).

After Task 17 R2 (clean, no code change): `MachinesMenu.test.tsx` + `ManageBackendsDialog.test.tsx` +
`backend-fields.test.ts` 8 pass.

After Task 17 R1 fix (`3884b1f`): `backend-fields.test.ts` 1 + `ManageBackendsDialog.test.tsx` 1 (both red on
`30a434e` first) + `MachinesMenu.test.tsx` 6 = 8 pass; `bun test packages/ui` 291 pass, 9 fail (the known nine);
`bun run typecheck` clean; eslint and prettier clean on the four changed files.

After Task 17 (`30a434e`): `MachinesMenu.test.tsx` 6 pass (checkbox state + primary disabled, attach/detach toggles,
discovered "Add" without a checkbox, "Work as…" a submenu trigger, fingerprint → trust → attach, changed key never
trusted); `MachineSection`, `machine-groups`, `backend-store` (+1 refresh test), `backend-records` (+1 `mergeForMenu`
test): 47 pass across the five files. `bun test packages/ui` 289 pass, 9 fail (the known nine). `bun run typecheck`
clean; eslint and prettier clean on the twelve changed files.

After Task 16 R1 (clean, no code change): `MachineSection.test.tsx` + `machine-groups.test.ts` + `backend-store.test.ts`
25 pass.

After Task 16 (`c17d813`): `MachineSection.test.tsx` 6 pass (red first: module missing) + `machine-groups.test.ts`
5 pass; `backend-store.test.ts` 14 pass; mutation checks, each restored: offline/incompatible/attaching
sections rendering projects (3 tests red), grouping ignoring `keepAttached` (detached test red); `bun test
packages/ui` 282 pass, 9 fail (the known MarkdownPaneImpl nine); `bun run typecheck` clean; eslint and prettier
clean on the nine changed files; `bun run build:ui` ok.


After Task 15 R2 fix (`67300d3`): `editor-uri.test.ts` + `EditorPaneImpl.machine.test.tsx` 10 pass; `bun run
typecheck` clean; eslint and prettier clean on the two changed files. Full `bun test packages/ui` not rerun
(test-only export removal).

After Task 15 R1 fix (`bdb378d`): `EditorPaneImpl.machine.test.tsx` 2 pass (both red on `065a4cc` first) +
`editor-uri` 8 pass; `bun test packages/ui` 271 pass, 9 fail (the known MarkdownPaneImpl nine); `bun run typecheck`
clean; eslint and prettier clean on the two changed files.

After Task 15 (`065a4cc`): `editor-uri.test.ts` 8 pass (red first: module missing; mutation above); `store-reset` +
`editor-uri` 12 pass; `bun test packages/ui` 269 pass, 9 fail (the known MarkdownPaneImpl nine; anchors 3, checkbox 5,
rerender 1 each pass alone); `bun run typecheck` clean; eslint and prettier clean on the eight changed files;
`bun run build:ui` ok. Not run: the Electron app (no second machine; Task 22).

After Task 14 R3 fix (`6c65295`): `file-store` 11 pass (alone, 3 runs; new test red on `a93ad4d` first); `bun test
packages/ui` 262 pass, 9 fail (the known MarkdownPaneImpl nine); `bun run typecheck` clean; eslint and prettier clean on
the two changed files.

After Task 14 R2 fix (`a93ad4d`): `file-store` 10 pass and `AgentDropdownMenu.shells` 1 pass (each alone, 3 runs; both
new tests red first, the shells test also red with only the component fix reverted); `bun test packages/ui` 261 pass,
9 fail (the known MarkdownPaneImpl nine); `bun run typecheck` clean; eslint and prettier clean on the four changed files.

After Task 14 R1 fix (`5bae8ff`): `search-store` 5 pass, `file-store` 9 pass (each alone, 3 runs; the four new tests
red on `fba0011` first); `bun test packages/ui` 259 pass, 9 fail (the known MarkdownPaneImpl nine); `bun run
typecheck` clean; eslint and prettier clean on the seven changed files.

After Task 14 (`fba0011`): new/changed tests pass — `per-backend-cache` 5, `wiki-store` 4, `file-store` 7 (alone),
`search-store` 3, `ui-store.forget` 3, `aggregation` 16, `store-reset` 3 (enumeration on), `backend-store` + `useWebSocket` +
`task-creation-store` + `session-sync.backend` pass, `CommitDialog` 2 and the `MarkdownPaneImpl` anchors 3 / checkbox 5 /
rerender 1 each alone. Mutation checks, each restored by checksum: wiki push applied to every machine (push test red);
file-change filter ignoring the machine (cross-machine test red); cache late-landing guard removed (its test red);
project-store reset not calling `forgetRecords` (aggregation ui test red); search start not recording its machine (search
tests red). `bun test packages/ui` 255 pass, 9 fail — the known MarkdownPaneImpl mock-leak nine; `bun run typecheck` clean;
eslint and prettier clean on every changed file; `bun run build:ui` ok. Not run: the Electron app.

After Task 13 R1 (clean, no code change): `session-sync.backend.test.ts` 6 pass, `session-sync.test.ts` 9 pass;
`bun run typecheck` clean.

After Task 13 (`2995b40`): `session-sync.backend.test.ts` 6 pass (the plan's test red first: desktop's entry
`undefined`); `session-sync.test.ts` 9 pass. Mutation checks, each restored by checksum: owned set = current keys only
(prune test red); no `session-store` reset (detach + debounce tests red); no timer clearing in either reset (debounce test
red: status came back); master guard removed (master test red — the first version of that test stayed green because a's
later list overwrote b's; it now waits on a probe from b). `bun test packages/ui` 237 pass, 1 todo, 10 fail (the known
ten); `bun run typecheck` clean; eslint and prettier clean on the eight changed files. Run UI tests from the repo root:
from `packages/ui/src/stores` the root `bunfig.toml` preload is skipped and session-store import fails with
`window is not defined`. Not run: the Electron app.

After Task 12 R3 (clean, no code change): `aggregation.test.ts` 15 pass.

After Task 12 R2 fix (`5d8b515`): `aggregation.test.ts` 15 pass (3 runs; new test red first); `bun test packages/ui`
232 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 12 R1 fix (`21bfdc8`): `FlowEditor.library` 1, `task-creation-store` 11, `FlowEditor.loop` 5,
`NewTaskDialog.prefill` 4, `aggregation` 14 pass (each file alone; new tests red first, mutation check above); `bun test
packages/ui` 231 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the ten
changed files.

After Task 12 (`fb0f041`): `aggregation.test.ts` 14 pass (6 new). Mutation checks, each turning exactly its test red and
restored by checksum: the notification clear written as `() => []`; the diff-store reset unregistered; `filterByProject`
ignoring the machine; `startFlow` filing the run under a fixed machine. `backend-store.test.ts` 14 pass (3 runs, alone);
`FlowPanel.artifacts` 2, `FlowPanel.loop` 6, `NewTaskDialog.prefill` 4, `store-reset` 3 pass; `bun test packages/ui`
227 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean (all packages); eslint and prettier clean on every
changed file. Not run: the Electron app.

After Task 11 R5 fix (`993805f`): `task-creation-store.test.ts` 8 pass (3 runs; new test red first); `bun test
packages/ui` 221 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the three
changed files.

After Task 11 R4 fix (`550558d`): aggregation + scope tests 18 pass (3 runs; new test red first); backend-store +
store-reset + task-creation-store 23 pass, 1 todo; `bun test packages/ui` 219 pass, 1 todo, 10 fail (the known ten);
`bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 11 R3 fixes (`cfc5960`): scope + aggregation + backend-store + store-reset + task-creation-store tests 40 pass,
1 todo (3 runs; both new tests red first); `bun test packages/ui` 218 pass, 1 todo, 10 fail (the known ten); `bun run
typecheck` clean; eslint and prettier clean on the four changed files.

After Task 11 R2 fix (`92c91a9`): `aggregation.test.ts` + `backend-scope.test.ts` 15 pass (new test red first);
`bun test packages/ui` 216 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on
the three changed files.

After Task 20 R2 fix (`4a77b3c`): `notification-poller` + `artifact-download` tests 8 pass (3 runs; new test red
first, and red again under the skew-to-0 mutation); `flow-artifact-raw` 4 pass; `bun run typecheck` clean (all
packages); eslint and prettier clean on the two changed files.

After Task 11 R1 fix (`702378f`): scope + aggregation + backend-store + task-creation-store + store-reset tests 37 pass,
1 todo (3 runs; the aggregation race test red on `2856082` first); `bun test packages/ui` 215 pass, 1 todo, 10 fail (the
known ten); `bun run typecheck` clean; eslint and prettier clean on the five changed files.

After Task 11 (`2856082`): `backend-scope` + `connection-registry` + `aggregation` + `backend-store` + `store-reset` +
`task-creation-store` tests pass (`backend-store.test.ts` 14 pass, 3 runs). Mutation checks, each turning exactly its
test red and green again after restoring: PROJECT_UPDATED applied to every backend; `updateProject` sent to a fixed
backend; the project reset dropping every backend; `bootstrapBackend` ignoring a failed leg (the Task 10 stub
behaviour). `bun test packages/ui` 210 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint clean
and prettier clean on the changed files except the pre-existing `task-order.ts`; `bun run build:ui` ok. Not run: the
Electron app; the shared suite (its change is a type-only generic widening).

After Task 10 R5 (clean, no code change): `backend-store.test.ts` + `store-reset.test.ts` 16 pass, 1 todo.

After Task 10 R4 fix (`c1ea517`): `backend-store.test.ts` 13 pass (3 runs; new test red first); `bun test packages/ui`
200 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 10 R3 fix (`4c6b03b`): `backend-store.test.ts` 12 pass (3 runs; new test red first); `bun test packages/ui`
199 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 10 R2 fixes (`4b40bbf`): `backend-store.test.ts` 11 pass (3 runs; the race and detached-beacon tests red
first); `bun test packages/ui` 198 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier
clean on the two changed files.

After Task 10 R1 fix (`f1b70e0`): `backend-store.test.ts` 8 pass (3 runs; new test red first); `bun test packages/ui`
195 pass, 1 todo, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 10 (`4abc696`): `store-reset.test.ts` + `backend-store.test.ts` 10 pass, 1 todo (red first: modules
missing); mutation check — removing the post-tunnel attempt check turns "a detach while the tunnel is opening" red,
rethrowing in the confirm catch turns "a refused confirm" red; `bun test packages/ui` 194 pass, 1 todo, 10 fail (the
known ten); `bun run typecheck` clean (all packages); eslint and prettier clean on the six changed files;
`bun run build:ui` ok.

After Task 9 R1 fix (`3591f54`): `bun test electron/src/backend-registry.test.ts` 22 pass (the two race tests red
against `a0ad09d`'s registry); `bun run typecheck` clean; eslint and prettier clean on the two changed files.

After Task 9 (`a0ad09d`): `bun test electron/src/backend-registry.test.ts` 19 pass (3 runs; red first: module
missing); `bun test electron/src packages/shared` 198 pass, 0 fail; `bun run typecheck` clean (all packages, incl.
electron's Bun-less `tsconfig.src.json`); eslint and prettier clean on the eight changed files; `electron`
`bun run build` ok (`dist/preload.js` requires only `electron`). UI and backend changes are type-only
(`env.d.ts`, the moved `MenuEntry`), so their test suites were not rerun. Not run: launching the Electron app.

After Task 8 R3 fix (`22dbeb9`): registry + shim tests 10 pass (3 runs; both new tests red first);
`bun test packages/ui` 184 pass, 10 fail (the known ten); `bun run typecheck` clean; eslint and prettier clean
on the four changed files.

After Task 8 R2 fix (`b34625a`): `bun test packages/ui/src/lib/connection-registry.test.ts` 6 pass (3 runs);
`useWebSocket.test.ts` 2 pass; `bun test packages/ui` 182 pass, 10 fail (the known ten); `bun run typecheck`
clean; eslint and prettier clean on the two changed files.

After Task 8 R1 fix (`4f32c14`): `bun test packages/ui/src/lib/connection-registry.test.ts` 6 pass (3 runs);
`bun test packages/ui/src/hooks/useWebSocket.test.ts` 2 pass; `bun test packages/ui` 182 pass, 10 fail (the
known ten); `bun run typecheck` clean; eslint and prettier clean on the five changed files.

After Task 8 (`dff8dc2`): `bun test packages/ui/src/lib/connection-registry.test.ts` 4 pass (3 runs; red
first: module missing). `bun test packages/ui` 178 pass, 10 fail — the known ten (wiki-backend-collision 1,
MarkdownPaneImpl anchors 3 / checkbox 5 / rerender 1); each of those files, plus `file-store`, `wiki-store`
and `CommitDialog` tests (which mock `useWebSocket`), passes run alone. `bun run typecheck` clean;
`bun run build:ui` ok; eslint and prettier clean on the changed files. The backend and electron are
untouched, so their suites were not rerun.

After Task 7 R1 (clean, no code change): tunnel tests rerun, 26 pass.

After Task 7 (`d040521`): `bun test electron/src/tunnel-manager.test.ts electron/src/tunnel-args.test.ts`
26 pass (3 runs); `bun run typecheck` clean (all packages); eslint and prettier clean on the three files.
New module with no consumers yet, so the full suite was not rerun.

After Task 6 R2 fix (`f126113`): `bun test electron/src/tunnel-args.test.ts` 23 pass (both new tests red
first); `bun run typecheck` clean; eslint and prettier clean on both files.

After Task 6 R1 fix (`65c25ad`): `bun test electron/src/tunnel-args.test.ts` 21 pass (2 of the 3 new
tests red first); `bun run typecheck` clean; eslint and prettier clean on both files (control-char
regexes replaced by char-code checks to satisfy `no-control-regex`).

After Task 6 (`7c7c421`): `bun test electron/src/tunnel-args.test.ts` 18 pass (red first: module
missing); `bun run typecheck` clean; eslint and prettier clean on both files. New pure module with no
consumers yet, so the full suite was not rerun.

After Task 5 R4 fix (`a25f3b5`): `bun test electron/src/backend-records.test.ts
packages/shared/src/discovery/beacon.test.ts` 29 pass (records 14); `bun run typecheck` clean;
eslint and prettier clean on the two changed files.

After Task 5 R3 fix (`39447ae`): `bun test electron/src/backend-records.test.ts
packages/shared/src/discovery/beacon.test.ts` 28 pass (records 13); `bun run typecheck` clean;
eslint and prettier clean on the changed files.

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

Next step: Task 20 review round 8 — Codex gpt-5.5 prompted review of `5f0ec24..40aecede` (same file set as R7:
electron/src incl. `artifact-download.ts` and `notification-poller.ts`, the `flow-routes.ts` raw-artifact route and
its test, `FlowPanel.tsx`, `TaskSidebar.tsx`, `env.d.ts`). Tell Codex the R1–R7 history (R1 rejected bare-id
activation and tunnel-port reuse; R2 failed-first-poll baseline; R3 fetch-time attached-set recheck, backend-id
binding not taken; R4 streaming; R5 `.part` + rename; R6 first-poll cutoff at `startedAt` on the origin's clock and
`.taskflow-<uuid>.part`; R7 (`40aecede`) no-`Date` answers always seed, never compare client time) and ask it to
confirm R7's branch and report only defects reachable with the real Bun backend. Round 8 of the 10 cap; R4–R7 found
only narrow edge cases (R7 unreachable in practice), so any R8 finding that is not reachable with the real backend
should be recorded and rejected, and Task 20 marked clear; Task 21 (the hard switch) is next.

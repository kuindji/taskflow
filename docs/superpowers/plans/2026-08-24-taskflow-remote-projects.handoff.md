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
| 10 | The renderer's attached set — backend-store, handshake, detach | in-review round 4 | `76a0746` | `4abc696`, `f1b70e0`, `4b40bbf`, `4c6b03b`, `c1ea517` | R1: 1 fixed (Codex + own); R2: Codex clean, 2 own findings fixed; R3: 1 fixed (Codex); R4: 1 fixed (Codex) |
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

## Validation baseline

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

Next step: Task 10 review round 5 — standard gpt-5.5 review via codex-review over `76a0746..c1ea517`
(packages/ui: `stores/backend-store.ts`, `stores/store-reset.ts`, their tests, `providers/WebSocketProvider.tsx`,
`hooks/useWebSocket.ts`). Point the reviewer at the Task 10 decisions above, the R1 merged-branch fix, the R2 fixes
(`handshake(id, current)` staleness guard; `onBackendSeen` gated on the persisted `attached` intent), the R3 fix
(`backend-dropped` bumps the attempt counter), the R4 fix (`onBackendSeen` bails when the attempt counter moved while
`listBackends()` was pending) and plan Task 10 (plan lines 2810-3330). Round 5 of 10: each of R3 and R4 found one
narrow async race; if R5 finds only similar edge races, weigh accepting them as residuals.

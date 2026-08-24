# Handoff — Taskflow TUI Stage 1

Plan: `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.md`

Status legend: pending / implemented / in-review round N / clear / review-skipped

## Tasks

| # | Task | Status | Base commit | Notes |
|---|---|---|---|---|
| 1 | Package scaffold and WebSocket client | clear | `49b7967` | commits `22b9b7d`, `6e5e6f4`, `8bdedf8`; clear after round 3 |
| 2 | Backend lifecycle | clear | `ee98048` | commits `f27a5aa`, `f156640`, `88f5dce`, `b55e5c6`, `1a16bf1`, `b4ac6a0`; clear after round 6 |
| 3 | Cell model and SGR encoding | clear | `ebf7354` | commits `93d23c0`, `0379d71`, `5ab47fb`, `8e6d9fb`; clear after round 3 |
| 4 | Screen diffing and flush | clear | `7ff1b11` | commits `cc48d84`, `ecab7a5`; clear after round 2 |
| 5 | TTY control and restoration | clear | `cef9dcb` | commits `4b6d4b7`, `db65873`, `af9bc46`; clear after round 3 |
| 6 | Legacy key decoder | clear | `f7f072b` | commits `cfde4b3`, `74af2bd`, `6bccf51`, `d045f40`; clear after round 4 |
| 7 | Kitty key decoder and protocol negotiation | clear | `11af111` | commit `846de64`; clear after round 1 |
| 8 | Per-child key encoding | clear | `7932626` | commits `4a8ac77`, `7e38b14`, `603c444`, `2eec4c1`, `207cdd3`; clear after round 5 |
| 9 | Session terminal — attach, resync and mode tracking | clear | `4572b1f` | commits `f693314`, `b2de3c4`, `6261aea`, `a5ae10d`, `e3c7c91`, `60ee4f2`, `7d943d9`, `1f221be`; clear after round 8 |
| 10 | Blit a terminal buffer into the screen | clear | `ad82029` | commits `75f0f23`, `9d6e970`, `4ff75be`; clear after round 3 |
| 11 | State store | clear | `9420a4b` | commits `21040e4`, `3cb8118`, `cad685b`, `57ad359`, `32d6267`; clear after round 5 |
| 12 | Focus and key routing | clear | `b44a56f` | commits `cc41d6f`, `ebe33ab`, `4c819f4`; clear after round 3 |
| 13 | Sidebar rendering | clear | `e64f1f0` | commits `85871fc`, `33fbe44`, `bbb7a98`, `66b4357`, `9816700`, `ce2d6e8`, `b9461ff`, `78fc4fd`, `3f1511d`, `39d9e43`, `da3006a`, `382b33f`; clear after round 12 |
| 14 | Session pane and tab strip | clear | `beeecf8` | commit `b825ded`; clear after round 1 |
| 15 | Application shell and entry point | clear | `43df638` | commits `8c01132`, `584f615`, `8045ed4`, `1873c41`, `28ac654`, `bdbfe2b`, `93f37a6`, `98d3d0c`, `3bc5ee8`; clear after round 8 — round 8's one finding accepted as out of scope, see Task 20 |
| 16 | Backend — bind to loopback and report connected clients | clear | `2684302` | commits `2c0a633`, `eb6fd75`, `9286b46`, `74a1f88`, `d6f0b9a`; rounds 1 and 2 found 2 real defects each, round 3 found 3, round 4 found 2 — all fixed; round 5 found nothing — clear after round 5 |
| 17 | Reconnection and session resync | clear | `6f62137` | commits `550331f`, `0951096`, `1123c80`; round 1 found 2 substantiated defects, round 2 found 2 more — all fixed; round 3 found nothing — clear after round 3 |
| 18 | Remote mode | clear | `3e31dd2` | commits `f6cc308`, `684ffa6`, `b98ca3b`, `74b5d0f`, `90a161f`, `a0e3904`, `b53e0e7` (plan Steps 1–6 and 8); rounds 1–5 found 5, 1, 1, 2 and 1 substantiated defects — all fixed; round 6 found no defect in the diff, only a pre-existing unused export — clear after round 6; **Step 7 is a manual smoke test over SSH — split out as Task 18.1** |
| 18.1 | Remote mode — manual smoke test over an SSH tunnel | pending | — | **user gate** |
| 19 | Mouse support | plan clear after round 2 — ready to implement | `5caaa3a` | **added after the Task 15 smoke test — not in the original plan.** Plan written: `docs/superpowers/plans/2026-08-23-taskflow-tui-mouse.md`, commit `333c04a`; revised `47d9c29` (round 1), `fd307a3` (round 2). Splits into 19.1–19.6 below |
| 19.1 | Mouse — report decoding | clear | `e00cd13` | commits `18ad1e9`, `39299ff`, `cbfde10`, `436313f`, `3770749`, `ee518be`, `012049f`, `2911a80`, `176d5af`, `f828057`, `4554556`, `984ac93`; clear after round 12 |
| 19.2 | Mouse — outer tracking on/off | clear | `3829f83` | commit `5345824`; round 1 fixed in `a7af6dd`; round 2 found nothing — clear after two rounds |
| 19.3 | Mouse — layout hoist and hit testing | clear | `db844f4` | commit `ec39171`; round 1 found only test gaps, fixed in `10e7b0f`; round 2 found nothing — clear after two rounds |
| 19.4 | Mouse — app wiring | clear | `4e89f26` | commit `adf7c5a`; round 1 found nothing — clear after round 1 |
| 19.5 | Mouse — forward to the child | clear | `1288c64` | commits `f377413`, `1a9179f`, `08b23d8`; rounds 1 and 2 each found one substantiated defect, both fixed; round 3 found nothing — clear after round 3 |
| 19.6 | Mouse — manual smoke test | pending | — | **user gate** |
| 20 | Backend-side orphan shutdown | pending | — | **added after Task 15 round 8 — outside `packages/tui`, not in this plan.** Pass the parent pid to `taskflow-backend` and have it shut itself down when orphaned, so a `kill -9` of the TUI (or of Electron) cannot leak it. Fixes `electron/src/backend-manager.ts` at the same time. Needs its own plan first |
| 21 | Bound the incomplete-CSI carry | pending | — | **added after Task 19.1 round 12 — pre-existing, not introduced by the mouse work.** `decodeLegacy` holds an incomplete CSI whole, and `feed` cancels the 25ms idle timer on every read, so a stream of parameter bytes arriving faster than 25ms apart grows `carry` without bound and re-scans it from the start each read. Present at `e00cd13`. Needs a cap on any held CSI, not just the mouse forms |
| 22 | Full-suite-only failures in `packages/ui` pane tests | pending | — | **pre-existing, found during Task 16.** Eight tests in `MarkdownPaneImpl.checkbox.test.tsx` and the markdown link tests fail under `bun test` (whole repo) with `'useSessionStore.setState' is undefined` / `root.unmount` undefined, but pass under `bun test packages/ui/src/components/panes/`. Confirmed present at `2684302` before any Task 16 edit, so it is cross-file test pollution, not a product defect. Needs its own investigation |
| 23 | Flaky `backend startup` test under load | pending | — | **observed during Task 16 round 5, pre-existing.** `packages/backend/tests/index.test.ts` — `backend startup > exits non-zero when startup fails after the server starts` failed twice with `backend process did not exit after startup failure` on runs where the whole suite took 90s+ instead of ~40s, and passed on every unloaded run. A fixed timeout racing machine load, not a product defect |

## Review rounds

- **Task 1, round 1** (gpt-5.5 via codex-review, Mode B over `49b7967..22b9b7d`):
  one finding, substantiated and fixed in `6e5e6f4`.
  - `handleMessage` called `JSON.parse` with no `try/catch`, so a frame that is
    not valid JSON threw straight out of the socket's `onmessage` handler.
    Reproduced independently before the report landed. Regression test:
    `WsClient > ignores a frame that is not JSON and still resolves the request`
    in `packages/tui/src/net/client.test.ts` — red on `22b9b7d`, green on
    `6e5e6f4`. Run with `bun test packages/tui`.
  - Codex also noted the timeout and status-change branches are uncovered.
    Not treated as a defect: `onStatusChange` reconnection behaviour is Task 17,
    which the plan gives its own `reconnect.test.ts`.
  - Fix rule chosen: a malformed frame carries no correlation id, so it is
    dropped rather than used to fail a pending request; the pending request
    still times out normally.

- **Task 1, round 2** (gpt-5.5 via codex-review, Mode B over `49b7967..f2af28b`
  restricted to `packages/tui` and `eslint.config.js`): four findings, two
  substantiated and fixed in `8bdedf8`, one not reproducible, one accepted as
  test hygiene. Run the repros with `bun test packages/tui`.
  - **Substantiated — superseded socket still dispatched events.** A second
    `connect()` overwrote `this.ws` without closing the old socket, and
    `onmessage` had no current-socket guard, so a frame arriving on the stale
    socket was still delivered to event subscribers. Its pending requests were
    also left to the 30s timeout rather than failed. Regression test:
    `WsClient > a socket superseded by a new connect() no longer delivers events`
    — red on `f2af28b` (received `[{stale: true}]`), green on `8bdedf8`.
  - **Substantiated — `close()` never reported the disconnect.** `close()` nulled
    `this.ws` before calling `ws.close()`, so the `onclose` guard treated the
    socket as stale and `notifyStatus(false)` never ran. A `onStatusChange`
    subscriber stayed on `{ connected: true }` forever after an explicit close.
    Regression test: `WsClient > close() reports the disconnect to status
    listeners` — red on `f2af28b` (`[true]`), green on `8bdedf8` (`[true, false]`).
  - **Not reproducible — `connect()` hanging when `close()` precedes `onopen`.**
    Codex claimed the promise never settles. On Bun it does: closing a
    `CONNECTING` socket fires `onerror` (then `onclose`), which rejects the
    connect promise. Verified with a standalone probe and with the test
    `WsClient > connect() settles when close() happens before the socket opens`,
    which passes on `f2af28b` unmodified. The test was kept, and the restructure
    now settles the connect promise explicitly rather than depending on Bun
    firing `onerror`.
  - **Test hygiene — clients leaked on assertion failure.** Each test called
    `client.close()` as its last line, so a failing assertion skipped it and left
    a socket and a 30s timer alive. Tests now register clients in a module-level
    list that `afterEach` closes. Low severity; fixed because it is one line.
  - Fix shape: both substantiated defects now route through a single private
    `disconnect(reason)` that detaches the socket handlers, closes the socket,
    settles any in-flight `connect()`, fails pending requests and reports the
    status transition. `setStatus` deduplicates so repeated closes stay quiet.

- **Task 1, round 3** (gpt-5.5 via codex-review, Mode B over `49b7967..cbd0dfd`
  restricted to `packages/tui` and `eslint.config.js`): one finding, not
  substantiated. **Task 1 is clear — no code changed this round.**
  - Codex reported that `packages/tui/package.json`'s `dev` and `build:bin`
    scripts point at `src/index.ts`, which does not exist, so `bun run dev` fails
    with `Module not found "src/index.ts"`. The observation is accurate but it is
    not a defect: that manifest is reproduced verbatim from the plan (plan lines
    172-192), and `src/index.ts` is created by Task 15 (plan line 3771). The
    dangling script references resolve then. No change made.
  - Codex explicitly reported no remaining substantive defects in `WsClient` for
    the interleavings it was asked to probe, and verified with
    `bun test packages/tui/src/net/client.test.ts --repeat-each 20`,
    `bun run typecheck` and `bun run lint`.
  - Independently probed two paths the earlier rounds had not covered, both
    healthy: reconnect after a server-side close (`onStatusChange` sees
    `[true, false, true]` and a request on the new socket resolves), and a
    request in flight when the server goes away (rejects with `Connection lost`).
    Throwaway probe, not kept in the suite — Task 17 owns reconnection tests and
    the plan gives it its own `reconnect.test.ts`.
  - Validation at `cbd0dfd`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 7 pass / 0 fail.

- **Task 2, round 1** (gpt-5.5 via codex-review, Mode B over `ee98048..07fdfac`
  restricted to `packages/tui/src/backend/`): four findings, three substantiated
  and fixed in `f156640`, one reproducible only against a contrived child.
  Run the repros with `bun test packages/tui/src/backend/manager.test.ts`.
  - **Substantiated — the stderr pipe was never drained.** `stdio` set stderr to
    `"pipe"` but nothing read it, so once the child had written more than the pipe
    buffer it blocked in `write()` and never ran again. Observable symptom: the
    backend goes permanently unresponsive after logging a few hundred KB, and the
    TUI freezes with no error. Found independently before the report landed.
    Two regression tests: `keeps a chatty backend running instead of wedging its
    stderr pipe` (4MB of stderr before the port write — red as
    `Backend startup timeout after 4000ms`, green with the drain) and `reports the
    backend's stderr when it exits before startup`, which makes the drained tail
    observable. `electron/src/backend-manager.ts:126` already drains it the same way;
    the plan's sketch dropped that.
  - **Substantiated — a backend that wrote a port and then died still resolved.**
    The poll loop read the port file before checking `outcome.exitCode`, so
    `startBackend` handed back a handle for a dead process instead of rejecting.
    Regression test: `rejects when the backend writes a port and then dies` — red
    (resolved with port 4321), green (rejects with `exited before startup (code 7)`).
    Fix: the spawn-error and exit branches now run before the port read, matching
    electron's `Promise.race`, which also treats an early exit as failure.
  - **Substantiated — `readPort` parsed leniently.** `Number.parseInt` accepted
    trailing junk, so a file holding `43x` yielded port 43. Regression test:
    `ignores port-file contents that are not a bare port number` — red (43), green
    (waits and returns 4327). Now requires `/^\d+$/` and 1..65535.
  - **Not reachable — truncated port read.** Codex's headline finding was that a
    child caught mid-write can publish a prefix (`printf 43` then `printf 21` a
    second later yields port 43). Reproduced exactly as described, but only against
    a child that writes the port in two syscalls. The real backend writes it with a
    single `await writeFile(config.portFile, String(port))` of at most five bytes
    (`packages/backend/src/index.ts:470`), which a reader sees whole or not at all.
    A stability check across consecutive polls was considered and rejected: the
    poll interval is 50ms and Codex's own repro spaces the writes a second apart,
    so it would not have caught it either. The strict-format fix above is the part
    that is worth having; the two-syscall window stays open by design, and the
    contract is now stated in a comment on `readPort`.
  - **Hardening, not a defect — port-file name collision.** Codex reported that
    `pid + Date.now()` collides for two starts in the same millisecond. Could not
    reproduce without stubbing `Date.now`: two genuinely concurrent `startBackend`
    calls got distinct files and distinct ports (4321 / 4322). Changed the suffix to
    `randomUUID()` anyway — one line, removes the window. The accompanying test
    `gives concurrent starts their own port file` passes on the pre-fix code too and
    is kept as a guard, not as a repro.
  - **Test hygiene — orphaned `sleep` processes.** Every fake backend ended in
    `sleep 30` as a child of `/bin/sh`, so `stop()`'s SIGTERM killed the shell and
    reparented the sleep to init: a full `bun test packages/tui` left five stray
    processes alive for 30s. The fake backends now `exec sleep 30`. Verified: zero
    strays after a run (`ps -ax -o command | grep -c '^sleep 30'`).
  - Validation at `f156640`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 20 pass / 0 fail, full `bun test` is 836 pass / 8 fail
    with the 8 being the known pre-existing `MarkdownPaneImpl` failures.

- **Task 2, round 2** (gpt-5.5 via codex-review, Mode B over `ee98048..740dc22`
  restricted to `packages/tui/src/backend/`): three findings, **all three
  substantiated and fixed in `88f5dce`**. Each was reproduced independently before
  the fix. Run the repros with `bun test packages/tui/src/backend/manager.test.ts`.
  - **Substantiated — `stop()` left the port file behind if the caller exited
    immediately.** `stop()` called `rm()` fire-and-forget, so the removal was still
    pending when it returned. Observable symptom: a TUI that shuts the backend down
    and exits leaves a `taskflow-tui-port-*` file in `/tmp` on every run. Regression
    test: `stop() removes the port file before it returns` — the fake backend echoes
    the `TASKFLOW_PORT_FILE` path it was given into a side file so the test can watch
    it; red (`existsSync` still `true` right after `stop()`), green with `rmSync`.
  - **Substantiated — a port published after the deadline was still accepted.** The
    loop read the port file before checking the deadline, so the last poll could land
    up to one full `POLL_INTERVAL_MS` (50ms) past `timeoutMs` and resolve. Regression
    test: `does not accept a port that only appears after the deadline` — the fake
    backend never writes a port; the test writes it 25ms after the deadline. Red
    (resolved with port 4330), green (rejects with `timeout`). Fix: the wait is
    clamped to `deadline - Date.now()`, so the final poll lands on the deadline rather
    than past it, and a backend that *did* publish in time is still accepted.
    Codex's own repro numbers (`timeoutMs: 75`, `sleep 0.09`) do not reproduce on this
    machine — child startup here is ~300ms, so the write lands far past the deadline
    and the old code timed out correctly. The bug is real; the window is one poll
    interval wide, which is why the kept test controls the write time itself instead
    of relying on a `sleep` in the child. Stable over `--repeat-each 15`.
  - **Substantiated — a startup death by signal was reported as `code 0`.** The exit
    handler stored `code ?? 0`, and a signal-killed child reports `code === null`.
    Observable symptom: the backend is SIGKILLed (or OOM-killed) during startup and
    the TUI says `Backend exited before startup (code 0)`, which reads like a clean
    exit. Regression test: `names the signal when the backend is killed before
    startup` — red (`code 0`), green (`signal SIGTERM`). Fix: the exit is recorded as
    `{ code, signal }`. This also closes a latent hole — with `code ?? 0` the
    `exitCode !== null` sentinel could never distinguish "not exited yet" from a real
    exit, so a signal death was detected only by coincidence of the coercion.
  - Codex explicitly cleared the retained stderr listener: keeping it attached is what
    continues draining the pipe for the life of the handle.
  - Independently probed three things Codex did not raise, all healthy: `stop()` is
    idempotent and does kill the child (verified by pid, `ps` shows it gone after a
    double `stop()`); multi-byte UTF-8 split across stderr chunk boundaries does *not*
    corrupt the tail (364KB of 3-byte characters through the drain produced zero
    replacement characters — the one replacement character an earlier probe showed came
    from `head -c` truncating the source data, not from the decode); and the success
    path's remaining listeners leak nothing at this task's scope, since the handle's
    contract is `{ port, stop }` and post-startup crash notification belongs to the
    app shell (Task 15) / reconnection (Task 17).
  - Validation at `88f5dce`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 23 pass / 0 fail, full `bun test` is 839 pass / 8 fail
    with the 8 being the known pre-existing `MarkdownPaneImpl` failures. Zero stray
    `sleep 30` processes after the run.

- **Task 2, round 3** (gpt-5.5 via codex-review, Mode B over `ee98048..dd501ff`
  restricted to `packages/tui/src/backend/`): two findings, **both substantiated and
  fixed in `b55e5c6`**. Each was reproduced independently before the fix. Run the repros
  with `bun test packages/tui/src/backend/manager.test.ts`.
  - **Substantiated — a startup timeout threw away the backend's own error message.**
    The drain collects a stderr tail and the early-exit branch appends it, but the
    timeout branch threw only `Backend startup timeout after Nms`. Observable symptom:
    the port is already taken, the backend prints `bind: address already in use` and
    then sits there, and the TUI tells the user nothing but "timeout". Regression test:
    `reports the backend's stderr when startup times out` — red (message was exactly
    `Backend startup timeout after 1500ms`), green (the tail is appended). Fix: both
    branches now go through a shared `stderrSuffix()`.
  - **Substantiated — a backend that ignores SIGTERM survived a startup timeout.**
    `stop()` sends SIGTERM, ignores the return value and never escalates, so the timeout
    path rejected while leaving the child alive holding the port. Observable symptom: a
    wedged backend makes the *next* start fail too, because the port it never released is
    still bound. Regression test: `kills a backend that ignores SIGTERM when startup times
    out` — the fake backend does `trap '' TERM` and records its pid; red (pid still alive
    2s after the rejection), green (gone). Fix: the startup paths call a new async
    `terminate()` that sends SIGTERM, polls for the exit for `KILL_GRACE_MS` (1000ms) and
    then sends SIGKILL, and the timeout branch awaits it before rejecting.
    The test polls for the pid to disappear rather than checking once: SIGKILL delivery
    and reaping are asynchronous and a checked-once assertion saw a zombie as alive.
  - Codex also suggested making the handle's `stop()` async or exposing completion so the
    caller can know the kill worked. Not done — see "Decisions taken".
  - How much of this reaches the *real* backend: the message loss is unconditional. The
    survival case needs a backend whose SIGTERM handling is broken or blocked; the real
    backend registers its SIGTERM handler at `packages/backend/src/index.ts:517`, *after*
    the port write at line 470, so during the startup window it has no handler and dies on
    the default action. The escalation matters for a backend wedged after registering it,
    for a wrapper script that traps, and as a guarantee the timeout path leaves nothing
    behind. Kept because it is cheap and the failure it prevents (every retry failing) is
    the expensive kind.
  - Codex ran `bun test packages/tui/src/backend/manager.test.ts`, `bun run typecheck` and
    `bun run lint`, all passing, but could not execute its own proposed repros — the
    read-only sandbox denied the temp writes. Both were re-derived and run here.
  - Validation at `b55e5c6`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 25 pass / 0 fail, the manager file alone is 18 pass / 0 fail
    and stable across three consecutive runs, full `bun test` is 841 pass / 8 fail with the
    8 being the known pre-existing `MarkdownPaneImpl` failures. No stray fake-backend or
    `sleep 30` processes attributable to the run.

- **Task 2, round 4** (gpt-5.5 via codex-review, Mode B over `ee98048..34b2174`
  restricted to `packages/tui/src/backend/`): two findings, **both substantiated and
  fixed in `1a16bf1`**. Each was reproduced independently before the fix. Run the repros
  with `bun test packages/tui/src/backend/manager.test.ts`.
  - **Substantiated — `devBranch: null` still inherited a `TASKFLOW_DEV_BRANCH` from the
    TUI's own environment.** `safeEnv` spread `process.env` wholesale and only the
    non-null branch touched the variable, so the option could not turn dev mode *off*.
    Observable symptom: a TUI launched from a shell that exports `TASKFLOW_DEV_BRANCH`
    (the dev launcher at plan line 4156 does exactly that) spawns its backend on that dev
    instance even when the caller asked for none, so the TUI shows a different instance's
    projects and tasks than expected. Regression test: `does not let a
    TASKFLOW_DEV_BRANCH in its own env reach a devBranch-null child` — red (port 9999,
    i.e. the child saw the variable), green (4332). The pre-existing null test passed only
    because the ambient env happened to be clean. Fix: strip `TASKFLOW_DEV_BRANCH` in the
    same destructure as the Claude Code markers, leaving `opts.devBranch` as the only
    thing that sets it.
    Reachability note: the plan's own callers derive `devBranch` from
    `process.env.TASKFLOW_DEV_BRANCH ?? null` (plan lines 4074, 4689), so they cannot hit
    the mismatch today. Fixed anyway because the option's contract should hold for any
    caller, and because it makes the existing test test what its name claims.
  - **Substantiated — port-file cleanup could throw and mask the real startup error.**
    All three failure branches called `rmSync(portFile, { force: true })`; `force` does not
    make a non-recursive `rmSync` remove a directory. A child that leaves a directory at
    `TASKFLOW_PORT_FILE` makes cleanup throw `EISDIR`, and that error propagates in place
    of the backend's own. Observable symptom: the user is told
    `Path is a directory: rm returned EISDIR /tmp/taskflow-tui-port-...` instead of
    `Backend exited before startup (code 3): bind: address already in use`, and the
    directory is left behind. Regression test: `does not let port-file cleanup mask the
    backend's own startup error` — red (message was the EISDIR text), green (both the exit
    code and the stderr tail). Fix: a `removePortFile()` helper that removes recursively
    inside a `try/catch`, used by all three branches and by `stop()`.
    Trigger is contrived — the real backend writes a file — but the guarantee that cleanup
    never replaces the error being reported is worth having unconditionally.
  - Codex found no fresh `terminate()` spin/hang issue and no type looseness, and could not
    run its own repros (read-only sandbox). Both were re-derived and run here.
  - Independently probed one thing Codex did not raise, and did **not** find a defect: the
    loop checks `outcome.exit` *before* `await readPort()`, so in principle an exit event
    delivered during that await could let a dead backend resolve. Stress-tested with 400
    consecutive starts of `echo 4321 > $PORT; exit 7`: 0 resolved, 400 rejected. The exit
    event is always delivered before the next poll's read completes, so the window is not
    reachable in practice. Not fixed, not reported as a finding.
  - Validation at `1a16bf1`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 27 pass / 0 fail, full `bun test` is 843 pass / 8 fail with
    the 8 being the known pre-existing `MarkdownPaneImpl` failures. Zero stray `sleep 30`
    processes after the run.

- **Task 2, round 5** (gpt-5.5 via codex-review, Mode B over `ee98048..84efb0e`
  restricted to `packages/tui/src/backend/`): two findings, **both substantiated and
  fixed in `b4ac6a0`**. Each was reproduced independently before the fix. Run the repros
  with `bun test packages/tui/src/backend/manager.test.ts`.
  - **Substantiated — `TASKFLOW_DEV` still reached the child, so `devBranch: null` could
    still be a dev instance.** Round 4 stripped `TASKFLOW_DEV_BRANCH`, but that is only one
    of the two selectors: `getDevBranch()` at `packages/backend/src/config.ts:44-61` falls
    back to `TASKFLOW_DEV` and derives the branch from `git rev-parse HEAD`, which becomes
    `instanceId = dev-<branch>`. Observable symptom: the TUI shows a different instance's
    projects and tasks than the caller asked for. **Reachable through the plan's own
    tooling** — `packages/tui/package.json:7` is
    `"dev": "TASKFLOW_DEV=1 bun run src/index.ts"`, and the plan's callers compute
    `devBranch = process.env.TASKFLOW_DEV_BRANCH ?? null` (plan lines 4074, 4689), so
    `bun run dev` in `packages/tui` asks for no dev branch and gets one anyway. Regression
    test: `does not let a TASKFLOW_DEV in its own env make a devBranch-null child dev` —
    red (port 9999, i.e. the child saw the variable), green (4333). Fix: `TASKFLOW_DEV`
    joins the same destructure.
  - **Substantiated — a failure that landed during the port read was reported as a
    timeout.** The loop checked `spawnError`/`exit` at the top, then `await readPort()`,
    then went straight to the deadline branch, so a failure delivered during that await
    was overwritten by `Backend startup timeout after Nms`. Observable symptom: the user is
    told the backend hung when it never started — e.g. a missing binary reported as a
    timeout rather than ENOENT. Regression test: `reports a spawn failure that lands while
    the port file is being read` — red (message was exactly
    `Backend startup timeout after 1ms`), green (`Backend failed to start: ... ENOENT`).
    Fix: the two failure branches moved into a `failure()` helper called both before the
    read and after it, ahead of the port check and the deadline. Checking it before the
    port check preserves round 1's rule that a backend which wrote a port and then died
    must not resolve.
    Reachability with the default 10s budget is low — ENOENT arrives in milliseconds — but
    the same window is open for any failure that lands in the final poll, and the fix is
    contained.
  - Codex explicitly cleared success-path listener lifetime, `stop()` staying synchronous
    and SIGTERM-only, the `TASKFLOW_PORT_FILE` override ordering, and the existing child
    cleanup tests.
  - Considered and deliberately not changed: `TASKFLOW_DEV_PORT` is also inherited, and it
    pins the child to a fixed port. Left alone — it does not change which instance the
    backend serves, the TUI always discovers the port from the port file, and the only
    failure it can cause (the port already being bound) is now reported loudly with the
    backend's own `address already in use` on it. Silent wrong-instance is the class worth
    stripping; a loud bind failure is not.
  - Validation at `b4ac6a0`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui/src/backend/manager.test.ts` is 22 pass / 0 fail, full
    `bun test` is 845 pass / 8 fail with the 8 being the known pre-existing
    `MarkdownPaneImpl` failures. Zero stray `sleep 30` processes after the run.

- **Task 2, round 6** (gpt-5.5 via codex-review, Mode B over `ee98048..4643cb4`
  restricted to `packages/tui/src/backend/`): one finding, **not substantiated as a
  defect. Task 2 is clear — no code changed this round.**
  - Codex reported that the poll loop reads the port file before checking the deadline
    (`manager.ts:157`/`:166` vs `:169`), so if the event loop is blocked past the
    deadline the loop resumes, finds a port that was written after it, and resolves
    instead of timing out.
  - **The mechanism is real and was reproduced.** Throwaway probe: a fake backend that
    writes its port from a background subshell 300ms in, `timeoutMs: 400`, and the test
    busy-spins the event loop to +1500ms. `startBackend` resolved with port 4340 at
    t=1555ms — 1.15s past its own budget. The same probe with a shorter spin (to +955ms,
    before the write landed) rejected with `Backend startup timeout after 400ms`, so the
    probe is measuring the described window and not something else.
  - **Not fixed, deliberately.** Enforcing "reject any port found by a poll that began
    after the deadline" would reject backends that came up *in time*. Measured the final
    poll's start relative to the deadline over 20 runs of the clamped-sleep loop:
    `0,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2,3` ms *past* the deadline. Bun's timer wakes
    late by 1-3ms as a matter of course, so the strict rule would turn 19 of those 20
    in-time startups into spurious `startup timeout` failures — exactly the case round 2
    went out of its way to keep working. A tolerance wide enough to absorb the jitter
    (one `POLL_INTERVAL_MS`) would just reopen the window round 2 closed.
  - The decisive argument is that the strict rule buys no timing guarantee at all: the
    timeout branch is subject to the same scheduler delay as the resolve branch. A
    blocked loop delivers the rejection just as late as it delivers the resolution, so
    the change would only convert a successful start into a failure at the same late
    moment. What the timeout is for — not hanging forever — is unaffected.
  - Codex also called the existing test at `manager.test.ts:243` "false-green for this
    case". It is not false-green: it goes red on the round-2 code (documented there) and
    green on the fix. It covers a systematically-late poll, not a blocked event loop.
    That is a coverage gap for a behaviour deliberately left as-is, not a broken test.
  - Independently probed the one success-path question earlier rounds left open, and
    found it healthy: the retained stderr listener **does** keep draining after the
    handle is returned. Probe: a backend that writes its port, then 8MB of stderr, then a
    marker file. The marker appeared, so the child never blocked in `write()` — a TUI
    that runs a chatty backend for hours will not wedge it. Throwaway probe, not kept.
  - Operational note for future rounds: `nohup codex ... &` launched through a
    backgrounded Bash call reports "completed, exit 0" as soon as the launching shell
    exits, while codex keeps running for another ten minutes. Two runs were started on
    that false signal and both wrote to the same `-o` path. Poll for the report file (or
    the codex pid), do not trust the task-completion notification.
  - Validation at `4643cb4`: `bun run lint` and `bun run typecheck` exit 0,
    `bun test packages/tui` is 29 pass / 0 fail, full `bun test` is 845 pass / 8 fail with
    the 8 being the known pre-existing `MarkdownPaneImpl` failures. Zero stray `sleep 30`
    processes after the run.

- **Task 3, round 1** (gpt-5.5 via codex-review, Mode B over `ebf7354..HEAD`):
  two findings, both substantiated and fixed in `0379d71`. Both were reproduced
  independently before the report landed, and gpt-5.5 raised the same two.
  - `ScreenBuffer.get` flattened `(x, y)` into `y * cols + x` with no bounds
    check, so an `x` outside `[0, cols)` wrapped into a neighbouring row and
    returned a real cell instead of throwing. On a 3x2 buffer, `get(3, 0)`
    returned the cell at `(0, 1)` and `get(-1, 1)` returned `(2, 0)`. The
    `RangeError` branch was unreachable for any wrapped `x`. This would have
    silently corrupted Task 10's offset blit rather than failing loudly.
    Fixed by mirroring `set`'s bounds check before indexing. Regression tests:
    `ScreenBuffer > get throws instead of wrapping when x runs past the right edge`
    and `... when x is negative` in `src/render/cells.test.ts`.
  - `sgrDiff` used `cellsEqual({ ...from, ch: to.ch }, to)` for its no-change
    fast path, which compares `width`. A wide glyph followed by a narrow cell
    with identical attributes returned `"\x1b[0m"` instead of `""`, so every
    CJK continuation cell in a session pane would emit a redundant reset on
    each Task 4 flush. Fixed by splitting `stylesEqual` (attrs, fg, bg only)
    out of `cellsEqual` and using it for the fast path. Regression test:
    `sgrDiff — glyph metrics are not attribute state > emits nothing when only
    the width differs` in `src/render/sgr.test.ts`.

  Verified red-before/green-after by reverting just the two source changes with
  the new tests in place: 3 fail / 15 pass before, 0 fail / 47 pass after.
  Full check green — `bun run lint` clean, `bun run typecheck` clean,
  `bun test packages/tui` 47 pass / 0 fail, full `bun test` 863 pass / 8 fail
  with the 8 being the known pre-existing `MarkdownPaneImpl` failures.

- **Task 3, round 2** (gpt-5.5 via codex-review, Mode B over `ebf7354..HEAD`):
  one finding, substantiated and fixed in `5ab47fb`.
  - `DEFAULT_COLOR` was a shared mutable singleton: `blankCell()` hands the same
    object to every cell's `fg` *and* `bg`, so a single in-place edit recoloured
    every default-coloured cell in the process. Reproduced before accepting the
    report — `Object.assign(a.fg, { kind: "palette", index: 2 })` on one blank
    cell turned an untouched second cell's `sgrDiff(null, b)` from `"\x1b[0m"`
    into `"\x1b[0;38;5;2;48;5;2m"`. The trace is TypeScript-legal:
    `Object.assign`'s `<T, U>(target: T, source: U): T & U` signature accepts it
    even though direct property writes on the `Color` union do not typecheck.
    Fixed with `Object.freeze`, which turns silent global corruption into an
    immediate `TypeError`. Regression test: `blankCell > the shared default
    color cannot be mutated in place` in `src/render/cells.test.ts`.

  Verified red-before/green-after by stashing just the source change with the
  new test in place: 2 fail / 17 pass before, 0 fail / 48 pass after. The red
  run also took down the unrelated `stylesEqual > still distinguishes
  attributes and colors`, which is the cross-contamination the fix prevents.
  Full check green — `bun run lint` clean, `bun run typecheck` clean,
  `bun test packages/tui` 48 pass / 0 fail, full `bun test` 864 pass / 8 fail
  with the 8 being the known pre-existing `MarkdownPaneImpl` failures.

  gpt-5.5 raised no other Task 3 defects.

- **Task 3, round 3** (gpt-5.5 via codex-review, Mode B over `ebf7354..HEAD`):
  two findings, **neither substantiated**. Task 3 is clear.
  - *"Invisible/hidden SGR state is dropped"* — rejected. The trace is
    conditional on a caller that does not exist: *"if a caller represents hidden
    with the next bit, e.g. `attrs: 64`"*. There is no `ATTR_HIDDEN` constant to
    reach for, and the plan's own Task 10 mapping (plan lines 2808-2817,
    `function attributes(cell: IBufferCell)`) enumerates exactly the six
    supported bits and never calls `isInvisible()`. No input reaching `sgrDiff`
    can set bit 64, so there is no failure to reproduce. The `28` in the review
    prompt was mine, not the plan's — the finding is an artifact of my own
    brief. Adding `ATTR_HIDDEN` now would also be an unused export until Task 10,
    which the plan's global constraints forbid outright. Recorded as a Task 10
    note instead (see Decisions taken).
  - *"`sgrDiff` is not minimal for known-to-known transitions"* — rejected. This
    is the documented design, stated in the function's own doc comment: *"Always
    emits a full reset before setting, which keeps the encoder stateless at the
    cost of a few bytes per changed run."* gpt-5.5 concedes in the same report
    that "the reset-plus-restate path reaches the right final state", so there is
    no wrong output, only extra bytes on a changed run — and unchanged runs, the
    ones that dominate a 60fps loop, already emit nothing via the `stylesEqual`
    fast path. The proposed incremental encoder (22/23/24/27/29, 39/49, plus the
    bold-dim interaction) is a stateful rewrite of a function the plan pins, with
    a much larger bug surface, bought for bytes on a local pipe.

  gpt-5.5 raised no other Task 3 defects and explicitly cleared
  `ScreenBuffer.get/set/clear`, `cellsEqual` and `stylesEqual`.

  Independent coverage work this round (test-only, commit `8e6d9fb`): reading
  `ATTR_CODES` by hand showed only bold and underline were asserted, and the
  `48;5;n` / `48;2;r;g;b` background forms had no test at all — a transposed
  number in any of those would have produced wrong colours in every session pane
  with nothing to catch it. Verified the encoder's actual output first by
  running it directly, then locked all six attribute codes, their combined
  bit order, both background forms and the fg-before-bg ordering into
  `sgr.test.ts`. Confirmed the tests bite by mutating `sgr.ts`
  (`ATTR_INVERSE`→`"5"`, `ATTR_DIM`→`"8"`, background base forced to 38):
  3 fail / 12 pass mutated, 0 fail / 15 pass restored. No source change, so no
  further review round is due.

  Full check green — `bun run lint` clean, `bun run typecheck` clean,
  `bun test packages/tui` 53 pass / 0 fail, full `bun test` 869 pass / 8 fail
  with the 8 being the known pre-existing `MarkdownPaneImpl` failures.

- **Task 12, implementation** (commit `cc41d6f`, base `b44a56f`):
  `packages/tui/src/ui/routing.ts` plus `routing.test.ts`, 18 tests. The plan's
  10 tests are verbatim apart from one added assertion (`q` -> `close-pane`,
  which the plan maps but never asserts); 8 more cover releases, key repeats,
  the ctrl/alt guard on sidebar chars, the 1-9 tab range and its `0` boundary,
  ctrl+escape in legacy mode, and a held Escape meeting a sidebar command.
  Validation: `bun run lint` clean, `bun run typecheck` clean across all five
  packages, `bun test` 1054 pass / 8 fail with the 8 being the known
  pre-existing `MarkdownPaneImpl` failures. Run this task's tests with
  `bun test packages/tui/src/ui/routing.test.ts`.

## Decisions taken

- **`to-child` carries `events: KeyEvent[]`, not the plan's `ev: KeyEvent`.** The
  Task 12 "Interfaces" bullet declares `{ kind: "to-child"; ev: KeyEvent }`, but
  the plan's own implementation, its tests, and the Task 15 consumer
  (`for (const ev of action.events)`) all use an array. The array is the shape
  that works: legacy mode has to release a held Escape *and* the key that
  followed it in one action, which a single-event field cannot express. The
  bullet is a stale line in the plan.

- **`SIDEBAR_CHARS` is typed `Record<string, Action | undefined>`.** The plan
  writes `Record<string, Action>`, which lies about a lookup on an arbitrary
  char — the repo does not enable `noUncheckedIndexedAccess`, so `mapped` would
  type as `Action` and the `if (mapped)` guard would look dead. The
  `| undefined` form is what `decode-legacy.ts`, `decode-kitty.ts` and
  `encode.ts` already use for the same reason.


- **The task comparator moved to `@taskflow/shared` and all three clients now
  share it.** Round 4's ordering fix needed the backend's sort in the TUI. That
  comparator already existed twice — `packages/backend/src/services/
  task-store-helpers.ts` and `packages/ui/src/stores/task-store.ts`, byte-identical
  in logic — and copying it a third time is how round 1 of Task 9 got two mirrors
  of the same bug. `sortTasksByCreatedAtDesc` in
  `packages/shared/src/utils/task-order.ts` is now the only implementation, sitting
  beside the `orderProjectsByIds` this store already imports for the same reason.
  The mechanical rewiring of `backend` and `ui` is beyond the plan's
  "every file is under `packages/tui/`" scope; it is covered by typecheck and the
  full suite, and the alternative was leaving three copies behind.

- **The store may issue its own `load()`.** Round 4's unarchive finding is not
  mirrorable: the restored subtasks are records `TASK_LIST` never served, so no
  amount of local cascade logic can produce them. A background reload is the only
  correct response, so `Store` now calls its own `load()` from an event handler.
  This widens Task 11's contract slightly beyond the plan's `load()`-on-demand
  shape, but stays inside the class, and the round-2 `loadToken` work already makes
  a self-triggered load safe against overlapping ones.

- **A defect Claude finds during a clean review round still counts as that
  round's finding.** Round 6 came back clean from gpt-5.5, but Claude found a
  real gap in round 5's own fix while reading the diff. Recording the round as
  "clear" and moving to Task 10 would have shipped a known, reproducible defect
  in exactly the code the round was meant to check. The round is therefore
  logged as "one finding, fixed", which keeps the loop's own rule intact —
  findings fixed means another review round — and gets the fix re-reviewed. The
  finding's source is attributed explicitly so the rounds still show what
  gpt-5.5 did and did not catch.

- **The kitty tracking lives in `@taskflow/shared`, not twice.** Round 2's fix
  needed the same stack logic on both sides, and round 1 had already shown what
  duplicating it costs: the backend mirror was written by copying the TUI's
  single-value tracker, so it inherited the same defect. `KittyKeyboardStack` in
  `packages/shared/src/utils/kitty-keyboard.ts` is now the one implementation,
  imported by `SessionTerminal` and `PtyManager`. This widens Task 9's footprint
  into a third package, on the same reasoning already recorded below for the
  round-1 fix crossing into `backend`.

- **`SessionSnapshotResponse.kittyFlags` was replaced, not extended.** The field
  was added in round 1 and has exactly two touch points (`PtyManager.getSnapshot`
  and `SessionTerminal.attach`), both changed in the same commit, so there was no
  reason to keep a top-of-stack field alongside a stack field. It is now
  `kittyStack: (number | null)[]`. No persisted data and no other client reads it.

- **Task 9's kitty resync fix crosses into `shared` and `backend`.** The plan
  scopes Task 9 to `packages/tui/src/term/session-terminal.ts`, but the state the
  round-1 finding is about does not exist anywhere in the TUI — `SerializeAddon`
  never emitted it and `SessionSnapshotResponse` had no field for it. A
  TUI-only change would have been dead code, so `PtyManager` gained the two CSI
  handlers and `SessionSnapshotResponse` gained `kittyFlags: number | null`
  (~25 lines, additive, no existing caller broken). The alternative — deferring
  to Task 16/17 — would have left Task 9 clear with a known defect in the
  behaviour the task is named for.

- **Task 8 deviates from the plan's sample encoder in four places.** The plan
  inlines the full `encode.ts` body, and round 1 showed four of its behaviours to
  be wrong against the Task 6 decoder and the kitty spec: Shift+Tab, non-letter
  ctrl chords, dropped key repeats, and legacy-encoded releases under flag 2.
  Fixed rather than kept, since the plan's own goal is a faithful round-trip; the
  plan's 17 tests all still pass unchanged, with 5 added.

- **Task 7 extracts the CSI scanner into `src/input/csi.ts`.** The plan gives
  `decode-kitty.ts` and `negotiate.ts` their own regexes for the same grammar
  `decode-legacy.ts` already scans by hand, and those regexes cannot be written
  under `no-control-regex`. Rather than hand-roll the scan three times, `scanCsi`
  (plus `inRange` and a new `isDigits`) moved to `csi.ts` and all three modules
  import it. Pure move — no behaviour change, and `decode-legacy.test.ts` still
  covers it in full.

- **`decodeKitty` reports space as a char event, not as `name: "space"`.** The
  plan's `CODEPOINT_TO_NAME` maps codepoint 32 to `"space"`, but `decodeLegacy`
  reports the same key as `{ name: "char", char: " " }`. Both decoders feed one
  router and one encoder (Task 8), so two shapes for one key would mean every
  consumer handling both or silently missing one. Kitty now matches legacy.
  Test: `reports space the same way the legacy decoder does`, which asserts the
  two decoders return equal events.

- **An out-of-range codepoint is dropped instead of crashing.** The plan's
  `String.fromCodePoint(codepoint)` throws `RangeError` above U+10FFFF, so a
  single malformed sequence — `\x1b[99999999u` — would take down the input
  pipeline that every keystroke passes through. `kittyEvent` range-checks first
  and returns `undefined`. Test: `drops a sequence whose codepoint is out of
  range`.

- **Only the first sub-field of the key parameter is the codepoint.** Kitty
  encodes `unicode-key-code : shifted-key : base-layout-key`; the plan parsed the
  field with `Number.parseInt`, which happens to stop at the `:` and get the
  right answer, but only by accident. `subField` splits explicitly, and the same
  helper reads the event type out of the modifier field. Test: `keeps the
  shifted-key alternate out of the codepoint`.

- **A legacy carry stranded before a kitty sequence is released, not dropped.**
  The plan's loop delegates the run before a kitty sequence to `decodeLegacy` and
  then discards that call's carry. For input like `ESC` + `CSI 13;2 u` the lone
  ESC vanished. Since a kitty sequence follows in the same read, nothing can ever
  complete that carry, so it is passed through `flushCarry` — the same reading the
  idle timer gives it. Test: `releases an escape stranded before a kitty
  sequence`.

- **`negotiateKitty` searches the reply instead of matching it whole.** The reply
  can arrive with real keystrokes around it; the plan's `REPLY.test` already
  allowed that, and `isFlagsReply` keeps it by scanning every CSI in the string.
  Test: `finds the reply among other pending input`.

- **Task 6 widens CSI parsing to the full ECMA-48 shape instead of the plan's
  `/^\x1b\[([0-9;]*)([A-Za-z~])/`.** The plan's regex only matches numeric
  parameters, and on no match it returns the whole tail as the carry. Any CSI
  sequence with a private-parameter prefix (`?`, `<`, `>`, `=`) or an
  intermediate byte therefore becomes a permanent carry: it never matches, so
  every later read is prepended to it and every key typed afterwards is
  swallowed. Probed against a verbatim copy of the plan's implementation —
  after `ESC [ ? 1 u` (a late kitty-protocol reply, the exact sequence Task 7's
  `negotiateKitty` provokes and can miss when its 150ms timeout fires first),
  typing `a`, `b`, Enter produced **zero** events and a carry that grew to
  `"\x1b[?1uab\r"`. The decoder now scans parameters (0x30-0x3f), intermediates
  (0x20-0x2f) and one final byte (0x40-0x7e), consumes any complete sequence, and
  drops the ones it does not recognise — private parameters and intermediates
  included — rather than carrying them. Regression tests: `consumes a private CSI
  reply instead of stalling on it`, `keeps decoding keys typed after an
  unrecognized CSI sequence`, `carries a private CSI sequence that is still
  incomplete`.

- **A tail that can never complete a CSI sequence is no longer carried.** Same
  wedge, second door: the plan carried `ESC [ CR` forever too (probe: events
  `[]`, carry `"\x1b[\r"`). `scanCsi` now distinguishes *incomplete* (could still
  grow into a sequence — carried, as before) from *invalid* (the next byte is in
  none of the three CSI ranges). On invalid the ESC is emitted as a real Escape
  press and decoding resumes one byte later, so `ESC [ CR` reads back as Escape,
  literal `[`, Enter. Only the wedge is fixed; the plan's carry semantics for
  genuinely incomplete sequences are unchanged, and `flushCarry` still drops a
  stale partial. Test: `does not carry a tail that can never complete a CSI
  sequence`.

- **Astral characters are decoded as one key event, not two surrogates.** The
  plan stepped the buffer one UTF-16 code unit at a time, so a pasted emoji
  emitted two `char` events holding lone surrogates (probe: `\u{1F680}` →
  `["\ud83d","\ude80"]`). Task 8 re-encodes `char` on the way to the child, where
  a lone surrogate becomes U+FFFD, so pasted emoji and less common CJK would
  reach the agent corrupted. The non-ESC branch now reads a whole code point via
  `codePointAt` and advances by its length. A pair split across two reads is
  still emitted as lone surrogates — carrying a trailing high surrogate would
  only move the loss into `flushCarry`, which drops non-ESC carries. Test:
  `keeps an astral character whole`.

- **`modsFromParam` floors its bitmask at zero.** The plan computed
  `param - 1` unguarded, so a malformed `CSI 1;0 C` gives `bits === -1` and every
  modifier reads as held (verified: `{shift,alt,ctrl,super}` all `true`), and a
  parameter that failed to parse would do the same via `NaN`. `param >= 1` also
  rejects `NaN`, so both cases now mean no modifiers. Task 7 calls this function
  too, with its own `|| 1` fallback, so the guard is belt-and-braces there.
  Test: `treats an out-of-range modifier parameter as no modifiers`.

- **`FINAL_TO_NAME` / `TILDE_TO_NAME` are typed `Record<K, KeyName | undefined>`.**
  The plan's `Record<string, KeyName>` claims every lookup succeeds, which made
  the plan's own `if (name)` guards look redundant. The honest type lets the
  guards be `name !== undefined` and keeps the "unknown final byte is dropped"
  branch visible to the type checker.

- **Task 6 test file has 20 tests, not the plan's 12.** The plan's twelve are
  kept verbatim; the extra eight cover the four deviations above plus the
  tilde-final navigation keys (`CSI 3 ~`, `CSI 5;2 ~`), which the plan
  implements but never exercises.

- **`leaveSequence()` emits an explicit `\x1b[0m` even though the leak it guards
  against is not reachable.** Task 5 round 1 reported an SGR leak into the shell
  prompt; a `@xterm/headless` probe showed `\x1b[?1049l` already restores the
  saved character attributes, so no leak occurs on a compliant terminal. The
  reset was added anyway: it is one escape sequence with no behavioural risk, it
  covers terminals that ignore 1049, and it closes the trailing-reset thread that
  Task 4 round 2 explicitly deferred to this task. Recorded as hardening so a
  later reader does not mistake it for evidence of a real defect.

- **Hidden/invisible text is out of scope for Stage 1, and Task 10 should say so.**
  Round 3 surfaced that `IBufferCell.isInvisible()` has no home in the six-bit
  attribute set, so an agent that emits `ESC[8m` will have that text rendered
  visibly in the session pane. That is a real fidelity gap, but it lives in
  Task 10's `attributes()` mapping, not in Task 3 — and the fix cannot land here
  without creating an export nothing imports, which the plan's global constraints
  forbid. Carrying it forward: when Task 10 is implemented, either add
  `ATTR_HIDDEN = 64` plus `[ATTR_HIDDEN, "8"]` and map `isInvisible()` in the same
  commit, or record that hidden text is deliberately rendered visible.

- **`sgrDiff` stays a stateless reset-and-restate encoder.** Round 3 proposed an
  incremental encoder emitting only changed parameters. Declined: output is already
  correct, the unchanged-run fast path already emits nothing, and the incremental
  form needs the 22/23/24/27/29 and 39/49 reset codes plus the bold-dim coupling
  (clearing one without the other needs `22` then a restate) — materially more
  logic and more ways to leave a terminal in the wrong state, in exchange for
  bytes written to a local pipe.

- **`ScreenBuffer.set` keeps storing the caller's `Cell` by reference.** Round 2's
  finding also noted that `set(0, 0, c); set(1, 0, c)` aliases one object into two
  coordinates. Left as-is: copying in `set` would allocate on every blitted cell of
  every frame (Task 10 blits the whole viewport per frame at 60fps), and the plan
  already copies at the one place the invariant matters — Task 4's `cloneFront` does
  `{ ...cell }` precisely so the front and back buffers never share objects. Documented
  the ownership contract on `set` instead: the buffer takes the cell, the caller must
  not reuse or keep mutating it.

- **`stylesEqual` is a new export, `cellsEqual` keeps its meaning.** Round 1's
  `sgrDiff` fix needed an attribute-only comparison, and the plan's `cellsEqual`
  compares the whole cell including `ch` and `width`. Task 4 still needs the
  whole-cell form for its dirty-cell diff, so rather than narrowing `cellsEqual`
  (which would make Task 4's diff skip cells whose character changed), split
  `stylesEqual` out and have `cellsEqual` delegate to it. Both are imported —
  `stylesEqual` by `sgr.ts` and the tests, `cellsEqual` by the tests and Task 4 —
  so neither is an unused export.
- **`get` bounds-checks, `set` still clips silently.** The asymmetry is now
  deliberate rather than accidental: Task 10 blits a terminal buffer at an
  offset and wants writes past the edge dropped, while a read past the edge is
  always a caller bug and should fail loudly. Kept the redundant `if (!cell)`
  guard after the bounds check because `noUncheckedIndexedAccess` types the
  lookup as `Cell | undefined`.
- **ScreenBuffer tests live in `cells.test.ts`.** The plan only specifies
  `sgr.test.ts`, which left `ScreenBuffer` with no direct coverage at all —
  that is how the `get` wrap-around survived implementation. Added a colocated
  `cells.test.ts` per the plan's own "tests colocated as `<name>.test.ts`
  beside the file under test" rule.

- **Task 2 strips `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` from the backend's env.**
  The plan's `manager.ts` inherits `process.env` wholesale; `electron/src/backend-manager.ts:114`
  strips these two before spawning because agents the backend later spawns refuse to
  launch when they see them ("cannot be launched inside another Claude Code session").
  A TUI started from inside a Claude Code session would hit exactly that. Added the
  same destructure plus a regression test — `startBackend > strips the Claude Code
  session markers from the child environment`, red without the strip (port 9999
  instead of 4324), green with it.
- **Task 2 test file has 8 tests, not the plan's 4.** Kept the plan's four verbatim
  (modulo the shared `afterEach` cleanup and the try/catch rejection assertion the
  lint config forces, same as Task 1) and added four: env stripping, `args`
  pass-through, ENOENT on a missing binary, and the startup timeout. The last two
  cover the two error branches the plan's implementation has but never exercises.
- **`portFile` is removed on the exit branch too.** The plan's implementation cleans
  up the port file on spawn-error and timeout but not when the child exits early,
  leaking a tmp file per failed start. Added the same `rm` there.

- **`BackendHandle.stop()` stays `(): void`, SIGTERM-only.** Round 3 raised making it
  async or having it escalate to SIGKILL. Both plan call sites run
  `backend.stop(); process.exit(0)` on consecutive lines (plan lines 4131 and 4705), so a
  `setTimeout`-based escalation scheduled inside `stop()` could never fire, and widening
  the return type is a change to the interface the plan pins at line 490 and to Task 15's
  shutdown path. The escalation lives on the startup paths instead, which are already
  async and can await it. If Task 15 later wants a guaranteed-dead backend at exit, that
  is a change to the handle's contract and belongs there, not here.

- **The startup timeout is a liveness bound, not a strict "no port after N ms" rule.**
  Round 6 reproduced a case where a blocked event loop lets a port written after the
  deadline be accepted. Left as-is: the timeout branch is delayed by exactly the same
  scheduler stall as the resolve branch, so enforcing the strict rule would not make
  `startBackend` return any sooner — it would only turn a successful start into a
  failure. Measured Bun timer jitter puts the final poll 1-3ms past the deadline even on
  an idle machine, so the strict rule would also fail startups that were in time. The
  guarantee kept is "never hangs forever"; "never resolves after `timeoutMs` of wall
  clock" is not offered and cannot be, given the loop can be preempted.

- **Pre-existing test failures.** `bun test` reports 8 failures in
  `packages/ui/src/components/panes/MarkdownPaneImpl.*` when the whole suite runs
  (they pass in isolation — suite-ordering flakiness). Verified identical at base
  commit `49b7967`, so they are pre-existing and not a gate on TUI work. Treat the
  TUI check as green when lint, typecheck and the tui tests pass and the UI failure
  count stays at 8.
- **Test server typing.** Refactoring `client.test.ts` to keep a list of servers
  lost the contextual `Server<unknown>` typing the old single `let server` binding
  provided, and `Bun.serve` then inferred the upgrade data type as `undefined`.
  Annotated each local as `const server: Server<unknown> = Bun.serve({...})` rather
  than casting.
- **Task 1 test file adjusted for lint.** The plan's `client.test.ts` tripped
  `no-floating-promises` on `server?.stop(true)` and `await-thenable` on
  `expect(...).rejects.toThrow(...)`. Rewrote the `afterEach` as async/await and the
  rejection assertion as try/catch on the error message. Behaviour is unchanged; no
  eslint-disable was added.

- **Task 4, round 1** (gpt-5.5 via codex-review, Mode A over `--commit cc48d84`):
  three findings, all substantiated and fixed in `ecab7a5`. One came from Codex,
  two from independent reading of the diff. Each has a regression test in
  `screen.test.ts`; all three are red on `cc48d84` and green after the fix
  (verified by checking the two source files back out at `cc48d84` and re-running
  `bun test packages/tui/src/render/screen.test.ts` — 10 pass / 3 fail before,
  13 pass after).
  - **The cursor drifted after any frame that painted.** `cursorSequence()` only
    re-emitted when the logical position changed, but painting a run leaves the
    real cursor at the end of that run. Frame 2 of `setCursor({x:4,y:2})` then
    painting at `(7,0)` emitted `\x1b[1;8H\x1b[0mZ` and nothing else, so the visible
    cursor sat at row 1 col 9. Now a frame that painted re-states a visible cursor;
    a hidden one is skipped, since where it sits is not observable. Test:
    `re-states the cursor after a frame that painted elsewhere`, plus
    `stays silent on an unchanged frame with a visible cursor` guarding the
    still-nothing-on-an-idle-frame property that the force could have broken.
  - **`lastCursor` aliased the caller's object.** `this.lastCursor = cursor` stored
    the reference, so a caller holding one cursor object, mutating `pos.x` and
    re-calling `setCursor(pos)` compared it against itself and emitted no move at
    all. Now stores `{ ...cursor }`. Test:
    `tracks a cursor object the caller keeps mutating`.
  - **Codex: `cloneFront()`'s shallow spread shared `fg`/`bg`.** `{ ...cell }`
    copies the cell but not its colour objects, so front and back kept pointing at
    the same `Color`; an in-place edit through `back.get(x,y).fg` compared equal on
    both sides and never repainted. This is the same in-place-mutation path the
    plan's own `does not share cell objects between frames` test blesses for `ch`.
    Added `copyCell()` in `cells.ts` (next to the frozen-default rationale it has
    to respect) which deep-copies colours and canonicalises `kind: "default"` back
    to the shared frozen `DEFAULT_COLOR` — so blank cells, the overwhelming
    majority, still clone without allocating a colour. Test:
    `does not share colour objects between frames`.


- **Task 4, round 2** (gpt-5.5 via codex-review, Mode A over `--base 7ff1b11`):
  zero findings. Codex reported "No material defects were found in the changed
  screen diffing/cell-copy code or its tests." Independent reading of
  `screen.ts`, `cells.ts` and `screen.test.ts` raised four candidates and none
  survived:
  - *A run starting on a wide char's continuation cell would position the cursor
    mid-glyph.* Not reachable: reaching that state needs the width-2 lead cell to
    compare equal while its width-0 continuation differs, which a consistent
    blitter cannot produce. Both realistic directions (narrow run overwritten by a
    wide char, wide char overwritten by narrow cells) were traced by hand and emit
    correct sequences.
  - *SGR state leaks past the end of a frame.* Real, but harmless within Task 4:
    every frame's first painted cell goes through `sgrDiff(null, cell)`, which
    always prefixes a full `0` reset, so the next frame self-corrects. Emitting a
    trailing reset belongs to Task 5's TTY restore path, not here.
  - *`sink.write` throwing leaves `front` describing content the terminal never
    got.* Self-correcting: the throw propagates before `forceRepaint = false`, so
    the next flush is a full repaint.
  - *Reassigning the public `back` each flush strands a cached reference.* A usage
    contract, not a defect; every planned consumer reads `screen.back` fresh.
  Validation: `bun run lint` clean, `bun run typecheck` clean across all five
  packages, `bun test` 882 pass / 8 fail (the recorded pre-existing
  `MarkdownPaneImpl` suite-ordering failures, unchanged). No code change was
  needed, so this round produced no commit.

- **Task 12: `Action` and `Focus` stay exported even though nothing imports them yet.**
  The plan's Task 12 interface names both as the module's produced surface and Tasks
  13-15 consume them; `route` is in the same position, imported only by its own test.
  Un-exporting to satisfy the "no unused exports" rule would make `routing.ts` dead
  code and force a re-export two tasks later. Raised by Codex in round 2, resolved as
  a decision rather than a fix.

## Task 7 implementation

- **Base commit:** `11af111`. **Commit:** `846de64`
  (`feat(tui): add kitty key decoder and protocol negotiation`).
- Added `packages/tui/src/input/decode-kitty.ts`, `negotiate.ts` and their
  colocated tests, plus `packages/tui/src/input/csi.ts` (see the decisions
  below). `decode-legacy.ts` lost its private CSI scanner to that new module and
  is otherwise unchanged.
- Written test-first: both suites were red with `Cannot find module
  './decode-kitty'` / `'./negotiate'` before either source file existed.
- As the Task 6 note predicted, every regex the plan specified for this task
  (`KITTY_SEQUENCE`, `INCOMPLETE_CSI`, `REPLY`) contains `\x1b` and would trip
  `no-control-regex`. All three are character-code scans instead, sharing the
  scanner Task 6 already wrote.
- Validation at `846de64`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 934 pass / 8 fail — the 8 are the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass count rose
  from 915 by exactly the 19 new tests (14 decoder, 5 negotiation).
- Review needed: yes. New parsing logic on the keystroke path, and it deviates
  from the plan in five places.

## Task 6 implementation

- Commit `cfde4b3` — `feat(tui): add legacy key decoder`. Files created:
  `packages/tui/src/input/keys.ts`, `packages/tui/src/input/decode-legacy.ts`,
  `packages/tui/src/input/decode-legacy.test.ts`.
- Written test-first: the suite was red with `Cannot find module './decode-legacy'`
  before either source file existed.
- No regex anywhere in the decoder. `eslint.configs.recommended` enables
  `no-control-regex`, which flags `\x1b` inside a regex literal, and the plan
  forbids `eslint-disable`. The CSI scanner is a hand-rolled character-code scan
  instead, which also made the incomplete/invalid distinction natural to express.
  **Task 7 will hit the same rule** — its planned `KITTY_SEQUENCE`,
  `INCOMPLETE_CSI` and `REPLY` regexes all contain `\x1b`, so they need the same
  treatment.
- Validation at `cfde4b3`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 911 pass / 8 fail — the 8 are the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass count rose
  from 891 by exactly the 20 new decoder tests.
- Review needed: yes. This is new parsing logic that every keystroke in the TUI
  will pass through, and it deviates from the plan in four places.

## Task 5 implementation

- **Base commit:** `cef9dcb`. **Commit:** `4b6d4b7`
  (`feat(tui): add tty setup with guaranteed restoration`).
- Added `packages/tui/src/term/tty.ts` and `packages/tui/src/term/tty.test.ts`
  exactly as the plan's Task 5 specifies: `enterSequence`/`leaveSequence` string
  builders, and a `Tty` class that guards `enter`/`leave` with an `entered` flag,
  toggles raw mode only when `process.stdin.isTTY`, and installs `exit`,
  `SIGINT`/`SIGTERM`/`SIGHUP` and `uncaughtException` handlers behind a
  `handlersInstalled` guard.
- TDD order followed: the test file was written first and failed with
  `Cannot find module './tty'`, then went 6 pass / 0 fail after the
  implementation landed.
- Validation before the commit: `bun run lint` clean, `bun run typecheck` clean
  across all five packages, `bun test` 888 pass / 8 fail — the 8 failures are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass
  count rose from the previously recorded 882 by exactly the 6 new tty tests.
- Review needed: yes. The module owns terminal restoration and process-level
  signal handlers, so a defect leaves the user's shell in raw mode with a hidden
  cursor — the worst failure the plan names for this task.


## Task 5 review rounds

- **Task 5, round 1** (gpt-5.5 via codex-review, Mode A over `--base cef9dcb`):
  two findings. One substantiated and fixed in `db65873`; one not reproducible.

  - **Substantiated — raw mode survived a failing leave write.** `leave()` set
    `entered = false`, then wrote the leave sequence, then cleared raw mode. A
    sink whose `write` throws therefore propagated out before
    `setRawMode(false)` ran, and because `entered` was already cleared the
    installed `exit`/signal handlers could not retry — the shell was left in raw
    mode, which is precisely the failure the plan names as the worst one for
    this task. Repro: the new test
    `Tty > clears raw mode even when the leave write throws` in
    `packages/tui/src/term/tty.test.ts` — red on `4b6d4b7`
    (`modes` is `[true]`, the `false` never arrives), green after the fix.
    Command: `bun test packages/tui/src/term/tty.test.ts`. Fix: the write moved
    into a `try` with the raw-mode reset in `finally`. The test stubs
    `process.stdin.isTTY`/`setRawMode` (stdin is not a TTY under `bun test`) and
    restores the original property descriptors afterwards, deleting the stub
    where no own property existed before.

  - **Not substantiated — "styled output leaks SGR back to the shell".** Codex
    argued `leaveSequence()` never resets SGR, so a prompt could inherit bold or
    colour. Checked against a real terminal implementation rather than by
    reading: a `@xterm/headless` probe fed alt-screen entry, `\x1b[1;31mX`, the
    actual `leaveSequence({ kitty: false })`, then `"$ "`, and read the cell
    attributes at the cursor. The prompt cell came back unstyled — `\x1b[?1049l`
    performs the DECRC half of 1049 and restores the saved character attributes.
    The probe is discriminating: dropping `\x1b[?1049l` from the exit sequence
    made the same assertion fail with `bold: 134217728, fgDefault: false`. So the
    leak is not reachable on a compliant terminal.

    Decision: an explicit `\x1b[0m` was still added to `leaveSequence()` — one
    escape sequence, no behavioural risk, covering terminals that ignore 1049
    and closing the thread Task 4 round 2 deferred here. Recorded as hardening,
    not as a confirmed-defect fix.

- Validation before `db65873`: `bun run lint` clean, `bun run typecheck` clean
  across all five packages, `bun test` 889 pass / 8 fail — the 8 are the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass count rose
  from 888 by exactly the one new tty test.

- **Task 5, round 2** (gpt-5.5 via codex-review, Mode A over `--base cef9dcb`):
  one finding, substantiated and fixed in `af9bc46`.

  - **Substantiated — raw mode survived a failing *enter* write.** Round 1 fixed
    the leave path; the same hole was still open on the way in. `enter()` set
    `entered = true`, enabled raw mode, then wrote the entry sequence with no
    guard, so a sink whose `write` throws propagated out with raw mode still on.

    Verification went further than Codex's claim, because the claim as stated is
    not the whole story. Two probes:

    1. With `installExitHandlers()` called *before* `enter()`, the failure is
       already covered — the uncaught throw reaches the installed
       `uncaughtException`/`exit` handlers, `entered` is still `true`, so
       `leave()` runs and clears raw mode. Recorded `setRawMode` calls:
       `[true, false]`. This is the asymmetry with round 1's finding, where
       `entered` had already been cleared and no retry was possible.
    2. With `enter()` called *before* `installExitHandlers()`, nothing clears it.
       Recorded calls: `[true]` — the process exits with the shell in raw mode.

    Probe 2 is the real defect, and the module cannot rely on the caller's
    ordering (the app shell that fixes it is Task 15, not yet written). Repro:
    the new test `Tty > clears raw mode even when the enter write throws` in
    `packages/tui/src/term/tty.test.ts` — red on `282bf73` (`modes` is `[true]`,
    the `false` never arrives), green after the fix. Command:
    `bun test packages/tui/src/term/tty.test.ts`.

    Fix: the entry write moved into a `try` that clears raw mode and rethrows.

  - **Codex's suggested fix was not taken as written.** It asked to roll back
    *both* raw mode and `entered` before rethrowing. Clearing `entered` would
    make the exit-path `leave()` a no-op, so a partially-landed entry sequence
    (alt screen entered, then the write failed) would never be reversed —
    trading a raw-mode leak for a stuck alt screen. `entered` stays set instead,
    and the guard test
    `Tty > still emits the leave sequence after a failed enter write` pins that
    choice. That test passes both before and after the fix by design; it exists
    to fail if someone later adopts Codex's version.

- Test-file refactor in the same commit: the stdin stub/restore dance used by
  the round-1 test was extracted into `withStubbedTtyStdin`, now shared by all
  three failing-write tests.

- Validation before `af9bc46`: `bun run lint` clean, `bun run typecheck` clean
  across all five packages, `bun test` 891 pass / 8 fail — the 8 are the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass count rose
  from 889 by exactly the two new tty tests.

- **Task 6, round 1** (gpt-5.5 via codex-review, Mode A over `--base f7f072b`):
  two findings, both substantiated and fixed in `74af2bd`.

  1. **Shift+Tab never reaches anything.** A legacy terminal reports Shift+Tab
     as `CSI Z`. `scanCsi` parsed it fine, but the final byte `Z` was in neither
     `TILDE_TO_NAME` nor `FINAL_TO_NAME`, so the sequence was consumed and no
     event was emitted — the key was silently swallowed in the TUI and in every
     child session the events get forwarded to. Repro: the new test
     `decodeLegacy > decodes back-tab as shift plus tab` in
     `packages/tui/src/input/decode-legacy.test.ts` — red on `cfde4b3` (the
     event array is empty), green after the fix. Command:
     `bun test packages/tui/src/input/decode-legacy.test.ts`.

     Fix: a `scan.final === "Z"` branch emitting `tab` with `shift` forced on,
     merged over any modifier parameter that happened to be present.

  2. **NUL decoded as Ctrl+backtick.** `decodeControl` mapped every remaining C0
     byte with `code + 96`, which is only correct for `0x01`–`0x1a`. NUL — what
     Ctrl+Space and Ctrl+@ send — came out as Ctrl+`` ` ``, a chord that cannot
     round-trip back to the byte the terminal actually sent.

     **Codex only flagged NUL; the same arithmetic is wrong for `0x1c`–`0x1f`
     too**, which came out as Ctrl+`|`, Ctrl+`}`, Ctrl+`~` and Ctrl+DEL instead
     of Ctrl+`\`, Ctrl+`]`, Ctrl+`^` and Ctrl+`_` — the last one emitting a raw
     DEL as a printable `char`. Verified by probe before fixing, and fixed as
     one class rather than the single case reported. Repro: the new test
     `decodeLegacy > decodes the non-letter control characters by their real key`
     — red on `cfde4b3` (`"@"` received as `` "`" ``, and `\]^_` received as
     `|}~` plus DEL), green after the fix.

     Fix: `code + 64` (the actual C0-to-ASCII rule), lowercased for the
     `A`–`Z` range so `\x01` still reports `a` as the existing test requires.

- Validation before `74af2bd`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 913 pass / 8 fail — the 8 are the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass count rose
  from 911 by exactly the two new decoder tests.

- **Task 5, round 3** (gpt-5.5 via codex-review, Mode A over `--base cef9dcb`,
  covering the full task diff including `af9bc46`): **zero findings.** Codex
  reported no material defects in the TTY control/restoration changes or their
  tests.

  Independent read of the diff alongside the report agreed. One cosmetic
  asymmetry was noticed and deliberately left alone: in the signal handler,
  a `leave()` that throws skips `process.exit(130)` and instead surfaces through
  the `uncaughtException` handler, which exits 1. Raw mode is still cleared on
  that path (the `finally` in `leave()`), so the terminal-restoration guarantee
  — the only thing this module owes — holds; only the exit code differs. Not a
  defect, not worth a guard.

- Validation at `fd531dc` (no code changed this round): `bun run lint` clean,
  `bun run typecheck` clean across all five packages, `bun test` 891 pass /
  8 fail — the 8 are the recorded pre-existing `MarkdownPaneImpl` suite-ordering
  failures, unchanged from the previous round.

**Task 5 is clear.**

- **Task 6, round 2** (gpt-5.5 via codex-review, Mode A over `--base f7f072b`,
  covering the whole task diff including the round-1 fixes): **one finding,
  substantiated and fixed in `6bccf51`.**

  **Home and End do nothing on rxvt and the Linux console.** Those terminals
  report Home as `CSI 7~` and End as `CSI 8~`, not the `CSI 1~` / `CSI 4~` that
  xterm sends. `scanCsi` recognized them as well-formed tilde sequences and
  consumed them, but `TILDE_TO_NAME` had no entry for `7` or `8`, so no key
  event came out — the press vanished in the TUI and in every child session the
  events are forwarded to.

  Repro: the new test `decodeLegacy > decodes the rxvt home and end tilde
  sequences` in `packages/tui/src/input/decode-legacy.test.ts` — red on
  `74af2bd` (`events[0]` is `undefined` for both), green after the fix.
  Command: `bun test packages/tui/src/input/decode-legacy.test.ts`.

  Fix: `7 -> home` and `8 -> end` added to `TILDE_TO_NAME`. Modifier handling
  needed no change; the test also covers `CSI 8;5~` (Ctrl+End) to prove it.

  One thing deliberately left alone: `decodeControl`'s `code === 32` branch is
  unreachable, because the only caller guards on `code < 32 || code === 127`.
  It is dead but harmless and correct if the function is ever called directly,
  so it was not touched during a review round.

- Validation before `6bccf51`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 914 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass
  count rose from 913 by exactly the one new decoder test.

- **Task 6, round 3** (gpt-5.5 via codex-review, Mode A over `--base f7f072b`,
  covering the whole task diff including the round-2 fix): **one finding,
  substantiated and fixed in `d045f40`.**

  **Alt+[ and Alt+O do nothing.** Those two chords send exactly `ESC [` and
  `ESC O` — byte for byte the opening of a CSI and an SS3 sequence. The decoder
  cannot tell them apart from a real sequence whose tail is still in flight, so
  it correctly parks them in the carry. But `flushCarry`, which the idle timer
  calls to release a stale carry, only ever converted a lone `ESC` back into a
  key; every longer carry was dropped. So the press vanished — nothing reached
  the TUI or any child session, no matter how long the user waited.

  Repro: the new test `decodeLegacy > flushCarry releases an ambiguous alt
  prefix as an alt chord` in `packages/tui/src/input/decode-legacy.test.ts` —
  red on `6bccf51` (`flushCarry("\x1b[")` returns `[]`), green after the fix.
  Command: `bun test packages/tui/src/input/decode-legacy.test.ts`.

  Fix: `flushCarry` now releases a two-byte `ESC` + printable carry as the
  matching Alt+char event, which is the same reading `decodeLegacy` already
  gives `ESC` + any other printable byte. By construction those are the only
  two-byte carries the decoder emits (the CSI-incomplete and SS3-short paths),
  so the new branch cannot swallow a partial sequence of three bytes or more —
  those still drop, as before.

- Validation before `d045f40`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 915 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, and the pass
  count rose from 914 by exactly the one new decoder test.

- **Task 6, round 4** (gpt-5.5 via codex-review, Mode A over `--base f7f072b`,
  covering the whole task diff including the round-3 fix): **zero findings.**

  Codex reported no material defects in the legacy key decoder changes. Its own
  checks — the focused decoder test, the TUI typecheck, and lint over the
  changed input files — all passed.

  Independent read of `decode-legacy.ts` and `keys.ts` this round found nothing
  substantiated either. Two things were considered and deliberately left alone:

  - A carry of three bytes or more that opens with `ESC [` — for example
    Alt+`[` followed by a digit — is still dropped by `flushCarry`. Releasing
    the prefix and re-decoding the tail would recover it, but the ambiguity is
    genuine and the current behaviour is documented in the function's comment.
    Not a defect in what the task specifies.
  - A surrogate pair split across two reads would emit two lone surrogates,
    because `carry` only ever holds escape-sequence tails. Whether this can
    happen at all depends on how stdin is decoded, and no caller exists yet —
    Task 12 wires the decoder to the terminal. Re-check it there; if stdin is
    read with a UTF-8 string decoder the split cannot reach `decodeLegacy`.

- Validation at `8b62efd` (no code changed this round): `bun run lint` exit 0,
  `bun run typecheck` exit 0 across all five packages, `bun test` 915 pass /
  8 fail — the 8 are the recorded pre-existing `MarkdownPaneImpl`
  suite-ordering failures, unchanged from the previous round.

**Task 6 is clear.**

- **Task 7, round 1** (gpt-5.5 via codex-review, Mode A over `--base 11af111`,
  covering the whole task diff: `csi.ts` extraction, `decode-kitty.ts`,
  `negotiate.ts` and the `decode-legacy.ts` move): **zero findings.**

  Codex reported no material defects in the kitty decoder, the CSI scanner, the
  negotiation helper, or the legacy-decoder paths the extraction touched. It
  could not run the test suite itself — the read-only sandbox blocks the test
  preload from creating its temp home — so its confidence rests on diff
  inspection; the suite was run here instead and passes (below).

  Independent read of `decode-kitty.ts`, `negotiate.ts` and `csi.ts` this round
  found nothing substantiated either. Cases walked through by hand, all correct:
  a split `CSI … u` across two reads; a non-kitty CSI that is still in flight at
  the end of a read; a stranded lone ESC before a kitty sequence; `CSI ? 1 u`
  (the negotiation reply) arriving as input, dropped by both decoders; an
  out-of-range codepoint and an empty parameter list, both dropped rather than
  thrown; a shifted-key alternate sub-parameter, ignored in favour of the base
  codepoint. `chunk` in the mixed-input branch is always non-empty, so the loop
  cannot spin.

  Two things were considered and deliberately left alone:

  - `negotiateKitty` waits the full 150 ms on a terminal that does not speak the
    protocol, because silence is the only negative answer it looks for. Sending
    a Primary DA (`CSI c`) chaser after the query would turn that into a
    definitive fast negative. It is not what the plan specifies, and the cost is
    a one-off 150 ms at startup. Revisit when Task 15 wires the real terminal.
  - A `decodeKitty` carry of three bytes or more is still dropped by
    `flushCarry`, the same known behaviour recorded for Task 6 round 4. Not a
    regression introduced here.

- Validation at `846de64` (no code changed this round): `bun run lint` exit 0,
  `bun run typecheck` exit 0 across all five packages, `bun test` 934 pass /
  8 fail — the 8 are the recorded pre-existing `MarkdownPaneImpl`
  suite-ordering failures, unchanged; the pass count rose from 915 by the
  Task 7 input tests.

**Task 7 is clear.**

- **Task 8 implementation** (base `7932626`, commit `4a8ac77`): added
  `packages/tui/src/input/encode.ts` and its test, exactly as the plan
  specifies. `encodeForChild` picks between a legacy encoder (CSI/SS3 arrows
  honouring application-cursor-keys mode, tilde sequences, control bytes for
  Ctrl+letter, ESC-prefix for Alt) and a kitty CSI u encoder used only when the
  child itself pushed the protocol. Flag 1 moves Esc, Alt+key, Ctrl+key and
  shifted Enter/Tab/Backspace to CSI u while leaving plain text and unmodified
  Enter/Tab/Backspace legacy; flag 8 forces every key to CSI u; flag 2 gates
  release and repeat events, which are dropped otherwise. `encodePaste` wraps
  in bracketed-paste markers when the child enabled the mode.

  TDD order followed: test written first, run and confirmed failing with
  "Cannot find module ./encode", then the implementation; the file's 17 tests
  pass, matching the count the plan predicts.

- Validation at `4a8ac77`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 951 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 934 by the 17 Task 8 tests.

- **Task 8, round 1** (gpt-5.5 via codex-review, Mode A over `--commit 4a8ac77`):
  two findings, both substantiated against the Task 6 decoder, both fixed in
  `7e38b14`.
  - *"Preserve legacy Shift+Tab when forwarding"* — real. `decodeLegacy` turns
    `CSI Z` into `{name:"tab", shift:true}` (`decode-legacy.ts:124`), and
    `encodeLegacy` hit the `SIMPLE` table before looking at shift, so a legacy
    child received a plain `\t`. Fixed: shifted tab encodes back to `ESC [ Z`.
  - *"Round-trip non-letter Ctrl chords"* — real. `decodeControl` reports NUL as
    Ctrl+@ and 0x1c-0x1f as Ctrl+\ ] ^ _ (`decode-legacy.ts:44-51`), but the
    encoder only mapped Ctrl+A..Ctrl+Z and fell through to the printable
    character, so Ctrl+Space reached the child as `@`. Fixed by encoding the
    whole `@`..`_` range as `upper - 64`, mirroring the decoder.

  Two further issues found while verifying, in the same event-kind logic and
  fixed in the same commit — both checked against the kitty spec
  (`sw.kovidgoyal.net/kitty/keyboard-protocol/`):
  - Key **repeats were dropped** whenever the child did not report event types.
    The spec says "key repeat events are treated as key press events" there, so
    holding a key would have sent one character. Now encoded as presses, for
    legacy children and for kitty children without flag 2.
  - Under flag 2, a **release of a text key was re-sent as its legacy bytes** —
    it would read to the child as a second keypress. The spec only reports
    releases for keys that have an escape code, so text keys now encode to
    nothing, and arrows/tilde keys carry the `:2`/`:3` event subparameter
    (`ESC [ 1;1:3 A`) instead of a bare, press-shaped sequence.

  Not reachable end-to-end today — `tty.ts` pushes only flag 1 to the outer
  terminal, so no release or repeat events are produced yet — but the encoder's
  own contract covers them and Task 12 routes whatever the decoders emit.

- Validation at `7e38b14`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 956 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 951 by the 5 new regression tests.

- **Task 8, round 2** (gpt-5.5 via codex-review, Mode A over `--base 7932626`):
  one finding, substantiated, fixed in `603c444` along with a second issue found
  while verifying it.
  - *"Gate CSI u encoding on flag 1"* — real. `encodeKitty` treated any non-null
    `kittyFlags` as permission to move ctrl/alt/escape keys to CSI u, so a child
    that pushed only event types (`CSI > 2 u`) got Ctrl+C as `ESC [ 99;5u`
    instead of `\x03` and would never see SIGINT. Flag 1 is what negotiates
    disambiguated escape codes, so the switch now requires it; flag 8 still
    forces every key to CSI u on its own.
  - Found while verifying, same commit: under flags 1|2 a **repeat of any
    legacy-encoded key encoded to nothing** — `encodeLegacy` bailed out on any
    non-empty event tag. Holding a letter, Enter or Backspace in such a child
    typed once. Flag 2 is ignored for keys with no escape code to carry the
    `:2`/`:3` subparameter, so those repeats now encode as presses, exactly as
    on the no-flag-2 path; releases still encode to nothing, and arrows and
    tilde keys keep carrying the tag.

  Both were confirmed with tests written first and observed red (`Expected:
  "\x03" / Received: "[99;5u"` and `Expected: "a" / Received: ""`) before the
  fix: `bun test packages/tui/src/input/encode.test.ts`.

- Validation at `603c444`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 958 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 956 by the 2 new regression tests.

- **Task 8, round 3** (gpt-5.5 via codex-review, Mode A over `--base 7932626`):
  one finding, substantiated, fixed in `2eec4c1`.
  - *"Preserve Ctrl+Space when forwarding to legacy children"* — real. Kitty
    sends Ctrl+Space as `CSI 32;5u`; `CODEPOINT_TO_NAME` in `decode-kitty.ts`
    deliberately omits 32, so the decoder reports `{name:"char", char:" ",
    ctrl:true}`. The encoder's C0 mapping only covered `@`..`_` (64..95), so a
    space (32) fell through to the literal character and a legacy child got an
    ordinary space instead of NUL. The C0 mapping moved into a `controlByte`
    helper that special-cases space, and the ctrl branch now runs ahead of the
    `SIMPLE` table — which would otherwise have spelled a `space`-named event as
    a bare space too. Ctrl+Enter, Ctrl+Tab, Ctrl+Backspace and Ctrl+Escape are
    unchanged: they carry no `char`, so `controlByte` returns undefined and they
    fall through to `SIMPLE` exactly as before.

  Confirmed with a test written first and observed red (`Expected: "\x00" /
  Received: " "`) before the fix: `bun test packages/tui/src/input/encode.test.ts`.

- Validation at `2eec4c1`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 959 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 958 by the 1 new regression test.

- **Task 8, round 4** (gpt-5.5 via codex-review, Mode A over `--base 7932626`):
  one finding, substantiated, fixed in `207cdd3`.
  - *"Map Ctrl+number chords before falling back to literals"* — real. A kitty
    terminal reports the physical key, so Ctrl+6 arrives as `CSI 54;5u` and
    `decodeKitty` hands the encoder `{name:"char", char:"6", ctrl:true}`.
    `controlByte` covered only space and ASCII 64..95, so the chord fell through
    to the literal branch and a legacy child was typed a `6` — in vim, Ctrl+6
    ("switch to the alternate buffer") inserted a digit instead. The digit row
    now goes through a `CTRL_ALIASES` table carrying the xterm convention
    (Ctrl+2..Ctrl+8 as NUL, ESC, 0x1c, 0x1d, 0x1e, 0x1f, DEL) plus `/` and `?`,
    the other two conventional spellings of 0x1f and DEL. Space moved into the
    same table. Unmodified digits are untouched — the branch only runs under
    ctrl — and the kitty-out path is unchanged, since Ctrl+6 for a kitty child
    still encodes as `CSI 54;5u`.

  Confirmed with a test written first and observed red (`Expected: "\x1e" /
  Received: "6"`) before the fix: `bun test ./packages/tui/src/input/encode.test.ts`.

- Validation at `207cdd3`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 960 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 959 by the 1 new regression test.

- **Task 8, round 5** (gpt-5.5 via codex-review, Mode A over `--base 7932626`):
  zero findings. Codex reported "no blocking defects in the Task 8 encoder
  changes" and independently ran root lint, the full workspace typecheck and the
  `packages/tui` suite (144 pass / 0 fail) as part of the review. No code
  changed this round, so HEAD stays at the `207cdd3` validation. **Task 8 is
  clear.**

- **Task 9 implemented** in `f693314` (base `4572b1f`). New
  `packages/tui/src/term/session-terminal.ts` plus its 12-test suite, following
  the plan's listing. Test written first and observed red (`Cannot find module
  './session-terminal'`) before the implementation existed.

  Two deviations from the plan's listing, both small and local:
  - `attach()` now also clears `hiddenCursor` when it calls `terminal.reset()`
    on a re-attach. `reset()` restores DECTCEM to visible but emits nothing
    through the parser, so without this the tracked flag would stay stuck on
    `true` after a reconnect of a session whose child had hidden the cursor,
    and the renderer would keep the cursor hidden forever.
  - `finishLoad` takes the pending list before replaying it rather than after,
    so a chunk arriving synchronously during the replay is not dropped by the
    subsequent `this.pending = []`.

- Validation at `f693314`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 972 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 960 by the 12 new tests.

- **Task 9, round 1** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`):
  two findings reported, both substantiated. A third defect was found
  independently while verifying them. All three fixed in `b2de3c4`, each with a
  test written first and observed red.

  - *"Buffer exit markers until history is loaded"* (codex) — real. If the child
    exits while `attach()` is still waiting on `SESSION_SNAPSHOT`, the
    `SESSION_EXITED` handler wrote `[Process exited with code N]` straight into
    the write queue, ahead of the snapshot that had not arrived yet. A session
    that dies right after you open it showed the exit line first and its own
    output underneath. `PendingChunk.sequence` is now `number | null`; the
    marker queues as `null`, which `finishLoad` always replays and never treats
    as stale. Red before the fix (`Expected: "WORK" / Received: ""`):
    `bun test ./packages/tui/src/term/session-terminal.test.ts -t "holds the exit marker"`.

  - *"Preserve kitty flags across snapshot attach"* (codex) — real.
    `SerializeAddon` emits the screen, not the kitty keyboard stack, so a client
    attaching fresh to a session whose child had pushed `CSI > flags u` came up
    with `modes.kittyFlags === null` and the Task 8 encoder sent legacy bytes to
    a kitty-negotiated child — the enhanced-only chords silently stopped
    working. Fixed on both sides: `PtyManager` registers the same two CSI
    handlers on its headless terminal (before `initialOutput` is written, so a
    restored session re-derives the state) and reports `kittyFlags` in
    `SessionSnapshotResponse`; `attach()` adopts it on the snapshot path. Red
    before the fix (`Expected: 5 / Received: undefined`):
    `bun test ./packages/backend/tests/services/pty-manager-snapshot.test.ts -t "kitty keyboard flags"`.

  - *"Re-attach resets ahead of queued output"* (found while verifying, not
    reported by codex) — real. `terminal.reset()` ran synchronously while
    earlier `terminal.write` calls were still sitting in `writeQueue`, so the
    clear happened first and the stale chunk was drawn onto the fresh grid
    afterwards. After a reconnect the pane showed a line of pre-drop output
    stuck in front of the restored prompt. Reading `this.modes` before the same
    drain had the mirror problem: modes carried by still-queued output were lost
    across the reconnect. The reset is now a queued step (`enqueueAction`) and
    the modes are captured inside it. Red before the fix
    (`Expected: "PROMPT>" / Received: "OLDOLDOLDPROMPT>"`):
    `bun test ./packages/tui/src/term/session-terminal.test.ts -t "re-attaching clears output"`.

- Validation at `b2de3c4`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 977 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 972 by the 4 new TUI tests and 1 new backend test.

- **Task 9, round 2** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`):
  **the codex pass is void — it reviewed a moving target.** The fix below was
  being written into the working tree while codex was still running, so the only
  thing it reported was that `packages/shared/src/utils/kitty-keyboard.ts` was
  untracked and the patch therefore would not build from a clean checkout. That
  is an artefact of the concurrent edit, not a defect in the Task 9 diff. Codex
  raised nothing about the code itself, and it cannot be read as a clean round.
  Process note for later rounds: leave the tree alone until the report lands.

  One real defect was found independently while the review ran, and is fixed in
  `6261aea` with the test written first and observed red.

  - *"A kitty pop drops straight to legacy instead of restoring the outer
    flags"* — real, and reachable in Task 9's own scope without any reconnect.
    The kitty keyboard protocol keeps a **stack**: `CSI > flags u` pushes the
    current flags and installs new ones, `CSI < number u` pops that many back
    (spec: `https://sw.kovidgoyal.net/kitty/keyboard-protocol/`). Both the TUI
    tracker and the backend mirror added in round 1 stored a single
    `number | null` and set it to `null` on any pop. A shell that speaks the
    protocol (fish, and zsh under a kitty-aware setup) pushes once; an editor
    started inside it (neovim 0.10+) pushes again and pops on exit — at which
    point the real child is back on the shell's flags while our tracker says
    "no protocol", so the Task 8 encoder sends legacy bytes and the shell's
    enhanced chords silently stop working. Red before the fix
    (`Expected: 1 / Received: null`):
    `bun test ./packages/tui/src/term/session-terminal.test.ts -t "nested push"`
    and
    `bun test ./packages/backend/tests/services/pty-manager-snapshot.test.ts -t "nested push"`.
  - Same defect on the snapshot path, confirmed by a standalone probe before it
    was fixed: `SessionSnapshotResponse.kittyFlags` reported only the top of the
    stack, so a client attaching to an already-nested session adopted `5`, and
    the editor's pop took it to `null` rather than the shell's `1`. This needs no
    reconnection — a first attach to a session that is already nested hits it.
    The field is now `kittyStack: (number | null)[]`, outermost first with the
    flags in force last, and empty when the child is outside the protocol.
    Covered by `restores the kitty stack the snapshot reports`.
  - Fix shape: the two copies of the tracking are now one `KittyKeyboardStack`
    in `@taskflow/shared` (`src/utils/kitty-keyboard.ts`, 11 unit tests). Keeping
    one implementation is the point — round 1 introduced the backend copy by
    mirroring the TUI copy, so both carried the same flaw. It follows the spec on
    all four edges: omitted push flags default to **zero** (verified against the
    spec text — the previous `: 1` fallback was also dead, since xterm hands a
    missing param through as `0`), a pop defaults to one entry, a pop that
    empties the stack resets the flags, and a full stack (16 entries, kitty's own
    limit) evicts its oldest entry so a child spamming pushes cannot grow it.
  - Checked and **not** changed: the spec also requires the main and alternate
    screens to keep independent stacks. Neither side models that. Left alone —
    it needs alt-screen tracking that does not exist yet, and no finding was
    produced for it.

- Validation at `6261aea`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 990 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged;
  the pass count rose from 977 by 11 new shared tests, 1 new TUI test and 1 new
  backend test.

- **Task 9, round 3** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched until the report landed): two findings,
  **both substantiated and both reproduced red**. The fixes are not written yet
  — the session was stopped after the repro step. Process note: the first codex
  launch was backgrounded with `nohup ... &` inside a Bash call and was killed
  with exit 130 when that call returned; use the harness's own
  `run_in_background` instead.

  - **Substantiated — the backend snapshot claims a sequence it has not parsed.**
    `packages/backend/src/services/pty-manager.ts:354`. `lastSequence` is bumped
    synchronously in the `DataBatcher` callback, but `headless.write(...)` on the
    line above parses on a later tick. `getSnapshot()` reads `snapshot`,
    `cursorHidden` and the new `kittyStack` off the headless terminal while
    reporting the *issued* sequence, so a client attaching in that window gets
    state that predates the sequence it is told the state covers. The client's
    `finishLoad` then drops every buffered chunk with `sequence <= lastSequence`
    — including the one carrying `CSI > flags u` — and stays on legacy key
    encoding until the child renegotiates. Two red repros in
    `packages/backend/tests/services/pty-manager-snapshot.test.ts`:
    `does not claim a sequence the restored log has not been parsed into yet`
    (`claimsRestoredSequence` received `true`, expected `false`) and
    `does not claim a live batch the headless terminal has not parsed`
    (`reported` `1`, expected `< 1`). Run with
    `bun test packages/backend/tests/services/pty-manager-snapshot.test.ts`.
    Note the staleness is not kitty-specific — the serialized screen and
    `cursorHidden` ride the same race — but `kittyStack` is what round 2 added.
    Intended fix: track a `parsedSequence` set from the `headless.write(data, cb)`
    completion callback (and initialised to `0` while a restored `initialOutput`
    is still being parsed, settling to `startSequence` when it completes), and
    have `getSnapshot` report that instead of `lastSequence`. `getHistory` keeps
    `lastSequence` — scrollback is pushed synchronously, so it is already right.

  - **Substantiated — re-attach re-enables modes the child has since turned off.**
    `packages/tui/src/term/session-terminal.ts:165-166`. On a second `attach()`
    the pre-drop `applicationCursorKeys` / `bracketedPaste` are written back
    after `terminal.reset()` and *before* the fresh snapshot. Verified against
    the installed addon source
    (`packages/backend/node_modules/@xterm/addon-serialize/lib/addon-serialize.js`,
    `_serializeModes`): it emits `\x1b[?1h` / `\x1b[?2004h` only when the mode is
    on and emits **nothing** when it is off. So the snapshot cannot switch a
    restored mode back off, and the client keeps encoding `\x1bOA` for arrows the
    child no longer wants. Red repro:
    `bun test packages/tui/src/term/session-terminal.test.ts -t "takes its modes from the snapshot"`
    — `Expected: false / Received: true`.
    Intended fix: the snapshot is authoritative, so the saved modes must only be
    replayed on the **no-snapshot fallback** path (history is trimmed raw
    scrollback and may have lost the sequences that set them). Move the `restore`
    write out of the reset branch and emit it just before the history request.
    The two existing re-attach mode tests were rescoped onto the history path
    (`snapshot: null` plus a `SESSION_HISTORY` stub) because they encoded the
    wrong contract for the snapshot path.

- **Task 9, round 3 fixes** — both findings applied in `a5ae10d`, together with
  the three repro tests the previous session left uncommitted. Each was
  re-confirmed red at `c2be0a1` before the source was touched.

  - *Backend snapshot claimed an unparsed sequence* — fixed as the report
    intended. `Session` gained `parsedSequence`, set from the completion
    callback of every `headless.write`: `startSequence` when a restored
    `initialOutput` finishes parsing (and `0` until then), and the batch's own
    sequence for live output. `getSnapshot` reports that instead of
    `lastSequence`, so the sequence a client is told the snapshot covers now
    matches the state actually on the grid — everything `getSnapshot` reads
    (serialized screen, `cursorHidden`, `kittyStack`) comes off the headless
    terminal, so they all move together. Reporting a *lower* sequence cannot
    duplicate output: the client replays chunks with `sequence > reported`,
    which is now exactly the set not yet parsed. `getScrollback` still reports
    `lastSequence` — scrollback is pushed synchronously in the same callback, so
    it was already accurate. Red before the fix
    (`claimsRestoredSequence: true`, and `reported` `1` where `< 1` was
    expected): `bun test packages/backend/tests/services/pty-manager-snapshot.test.ts`.
    While editing, `options.onData` was also switched to pass the captured
    per-batch `sequence` rather than re-reading the mutable `lastSequence`
    closure — same value today, but it no longer depends on nothing else
    incrementing between the two lines.

  - *Re-attach re-enabled modes the child had turned off* — fixed as the report
    intended. `restore` is now built in the reset branch but written only after
    the snapshot attempt falls through, immediately before the history request.
    On the snapshot path the snapshot is authoritative and nothing is replayed
    over it; on the history path the pre-drop modes still stand in, because raw
    scrollback may have been trimmed past the sequences that set them. Red
    before the fix (`Expected: false / Received: true`):
    `bun test packages/tui/src/term/session-terminal.test.ts -t "takes its modes from the snapshot"`.

- Validation at `a5ae10d`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 994 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged
  and verified by name; the pass count rose from 990 by the 3 new backend tests
  and 1 new TUI test. Working tree clean.

- **Task 9, round 4** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched until the report landed, and the codex run
  was backgrounded with the harness's own `run_in_background`): one finding,
  substantiated, reproduced red and fixed in `e3c7c91`.

  - **Substantiated — re-attach without a snapshot stacked a second copy of the
    child's kitty push.** `packages/tui/src/term/session-terminal.ts`, the reset
    branch of `attach()`. `terminal.reset()` clears xterm's own modes, but the
    kitty stack is this client's own state and survived it. On the history
    fallback path the raw scrollback still carries the child's original
    `CSI > flags u`, so replaying it pushed a second copy on top of the
    surviving stack: one child push, two client entries. The child's next
    `CSI < u` then popped to the duplicate instead of leaving the protocol, and
    the Task 8 encoder kept sending kitty-encoded keys to a child back on
    legacy. Red repro (`Expected: null / Received: 5`):
    `bun test ./packages/tui/src/term/session-terminal.test.ts -t "rebuilds the kitty stack from history"`.
  - Fix: `savedKitty = this.kitty.toArray()` is captured in the reset action and
    the stack is cleared alongside the reset, so the replay rebuilds it from the
    child's own sequences. A new `recoverKittyStack(saved)` runs on the history
    path only, after the history data has been parsed: if the stack came back
    empty the saved one stands in. That keeps the round 3 rule intact — the
    snapshot path is authoritative and nothing is replayed over it — while still
    honouring the reason the DEC modes are replayed on the history path, that
    trimmed scrollback may have lost the sequences that set them. History that
    *does* carry the pushes rebuilds the stack itself and the saved copy is
    never used.
  - Note the DEC modes needed no such care: `\x1b[?1h` is idempotent, so
    replaying it over history that also sets it is harmless. A kitty push is
    not — that asymmetry is what the round 3 fix did not account for.

- Validation at `e3c7c91`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 995 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged
  and verified by name; the pass count rose from 994 by the one new TUI test.
  Working tree clean.

- **Task 9, round 5** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched until the report landed, and the codex run
  was backgrounded — the run took ~45 minutes at the default `high` effort):
  one finding, substantiated, reproduced red and fixed in `60ee4f2`.

  - **Substantiated — re-attach dropped live output the snapshot did not cover.**
    `packages/tui/src/term/session-terminal.ts`, the `TERMINAL_OUTPUT` handler.
    While attached, an arriving chunk was written straight to the grid and its
    sequence thrown away; only chunks that arrived *while detached* were kept in
    `pending`. Round 3 made `getSnapshot` report `parsedSequence`, which trails
    the sequence the backend has already sent, so a snapshot can legitimately
    exclude a batch this client has already drawn. On re-attach `terminal.reset()`
    wiped that batch off the grid and `finishLoad` had nothing to replay it from,
    so the output was lost outright. This is the gap in round 3's own argument
    that "reporting a lower sequence cannot duplicate output, the client replays
    chunks with sequence > reported" — the client only had those chunks if they
    arrived while it was detached. Red repro (`Expected: "PROMPT>LIVE" /
    Received: "PROMPT>"`):
    `bun test ./packages/tui/src/term/session-terminal.test.ts -t "replays live output the snapshot does not cover"`.
  - Fix: a bounded `recent` buffer holds every chunk written to the grid along
    with its sequence, and `attach()`'s reset branch seeds `pending` from it
    instead of clearing, so `finishLoad` applies the usual `sequence > covered`
    filter and drops exactly what the snapshot turns out to include. The buffer
    covers the backend's parse lag, not the session's lifetime, so it is capped
    at 128 KB and drops the oldest — `bun test ./packages/tui/src/term/session-terminal.test.ts -t "bounds the output"`
    was confirmed to go red (screen full of `A`s) with the cap raised to 64 MB.
    The exit marker rides the same path; its `sequence: null` still means
    "always replay".
  - The existing test `re-attaching clears output that was still queued when the
    drop happened` was the thing masking this: it stubbed the snapshot at
    `lastSequence: 0` while the chunk carried sequence 1, so it asserted that
    output the snapshot did *not* cover must be discarded. Renamed to
    `re-attaching clears output the snapshot already accounts for` and rescoped
    to `lastSequence: 1`, which is what "the snapshot already contains it" means;
    it now genuinely tests staleness-based dropping.

- Validation at `60ee4f2`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 997 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged
  and verified by name; the pass count rose from 995 by the two new TUI tests.
  Working tree clean.

- **Task 9, round 6** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched until the report landed, and the codex run
  was backgrounded with the harness's own `run_in_background`): **gpt-5.5
  reported zero findings** — "I found no Level 1 blocking defects in the
  changes." The report file was non-empty and the log showed a completed turn,
  so this is a real clean pass, not a failed run.

  Reading the diff while that run was in flight, Claude found one defect of its
  own that gpt-5.5 missed. It is a gap in round 5's own fix, so it is recorded
  and fixed here rather than deferred; both repros were confirmed red at
  `cf33974` before the source was touched.

  - **Substantiated (Claude, not gpt-5.5) — replayed output survived exactly one
    re-attach.** `packages/tui/src/term/session-terminal.ts`, `finishLoad()`.
    Round 5 added the `recent` hold-back buffer and had `attach()` seed `pending`
    from it, but `finishLoad` only ever `enqueue`d a replayed chunk — it never
    `remember`ed it. So after a re-attach the buffer was empty again even though
    the chunks it had just replayed were still outside every snapshot taken so
    far. Two user-visible symptoms, one root cause:
    - A second drop inside the backend's parse lag loses the batch outright —
      the new snapshot still reports `parsedSequence` below it, and there is
      nothing left to replay from. This is round 5's bug recurring one reconnect
      later. Red repro (`Expected: "PROMPT>LIVE" / Received: "PROMPT>"`):
      `bun test ./packages/tui/src/term/session-terminal.test.ts -t "keeps replayed output available"`.
    - The `[Process exited with code N]` marker vanishes for good on the second
      re-attach. This one needs no race at all: the marker is client-generated,
      so no snapshot ever contains it and only the hold-back buffer can bring it
      back. Red repro:
      `bun test ./packages/tui/src/term/session-terminal.test.ts -t "keeps the exit marker"`.
  - Fix in `7d943d9`: `finishLoad` calls `this.remember(chunk)` beside the
    `enqueue`, mirroring the live `TERMINAL_OUTPUT` path exactly. A replayed
    chunk is on the grid and outside every snapshot so far — the same state a
    live chunk is in — so it belongs in the buffer on the same terms. The
    `RECENT_LIMIT` cap still bounds it, and `sequence: null` markers still mean
    "always replay". Both repros were re-confirmed red by removing just the one
    `remember` line, then green with it back.

- Validation at `7d943d9`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 999 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged
  and verified by name; the pass count rose from 997 by the two new TUI tests.
  Working tree clean.

- **Task 9, round 7** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched until the report landed, and the codex run
  was backgrounded with the harness's own `run_in_background`): two findings,
  both substantiated, both reproduced red and fixed in `1f221be`.

  - **Substantiated — a resumed session served a blank screen for its first
    tick.** `packages/backend/src/services/pty-manager.ts`, `spawn()` and
    `getSnapshot()`. A session spawned with `initialOutput` writes the restored
    log through `headless.write`, which parses on a later tick. Until that
    callback ran, `serializer.serialize()` returned `""` — an empty *string*,
    not `null` — so `getSnapshot` handed a client a snapshot of a blank grid.
    The client's `attach()` tests `snapshot.snapshot !== null`, so it took the
    snapshot path, skipped `SESSION_HISTORY` and drew nothing. Unlike the
    ordinary parse-lag case that round 3 handled, there is no replay to recover
    from: the restored log predates the client's connection and exists only in
    the scrollback that history serves. What the user would see is a resumed
    session opening empty instead of showing its log. Red repro
    (`Expected: null / Received: ""`):
    `bun test packages/backend/tests/services/pty-manager-snapshot.test.ts -t "offers no snapshot until the restored log has parsed"`.
  - Fix: `Session` gains `restorePending`, set while the `initialOutput` write is
    in flight and cleared in its callback beside `markParsed`. `getSnapshot`
    returns the same "no snapshot" shape it already returns for an unknown
    session while the flag is set, which routes the client to history. The local
    `restorePending` is mirrored onto `sessionEntry` the same way `parsedSequence`
    is, so it is correct whether the callback fires before or after the `Session`
    object is built.

  - **Substantiated — re-attach dragged the child back into kitty mode after it
    had left.** `packages/tui/src/term/session-terminal.ts`, `recoverKittyStack()`.
    Round 4 added the rule "history replayed, stack still empty ⇒ scrollback was
    trimmed past the child's push, so stand in the pre-drop stack". That reads a
    null result as *absence of evidence*, but it is equally the evidence that the
    child pushed and then popped while the client was disconnected — raw
    scrollback carries both sequences, the replay rebuilds the stack and then
    empties it correctly, and the fallback overwrote that with the stale
    pre-drop stack. The Task 8 encoder then kept sending kitty-encoded keys to a
    child back on legacy, so keystrokes arrive as garbage. Red repro
    (`Expected: null / Received: 5`):
    `bun test packages/tui/src/term/session-terminal.test.ts -t "honours a kitty pop"`.
  - Fix: a `kittyEvents` counter is bumped in both CSI handlers. `attach()`
    samples it before the history replay and passes `historyCarriedNoKitty` into
    `recoverKittyStack`, which now returns early when the replay carried any push
    or pop — that stack is authoritative, empty included. Only a replay with no
    kitty sequence at all falls back to the saved stack, which is the case round 4
    was actually reasoning about. The counter cannot be moved by live output:
    while `attach()` is loading, `TERMINAL_OUTPUT` chunks go to `pending` rather
    than through the parser. Round 4's own scenario is now pinned by
    `-t "keeps the pre-drop kitty stack when history carries none"`, which had no
    coverage before.

- Validation at `1f221be`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 1002 pass / 8 fail — the 8 are the
  recorded pre-existing `MarkdownPaneImpl` suite-ordering failures, unchanged and
  verified by name; the pass count rose from 999 by the three new tests. Working
  tree clean.

- **Task 9, round 8** (gpt-5.5 via codex-review, Mode A over `--base 4572b1f`;
  the working tree was left untouched for the whole run, which was backgrounded
  with the harness's own `run_in_background`): **gpt-5.5 reported zero
  findings** — "No material defects were identified in the changed code." The
  log's last lines show a completed turn ("Completed Level 1 review; no blocking
  findings identified in the changed code.") and the report file is non-empty,
  so this is a real clean pass, not a failed run. Codex ran the three touched
  test files and the workspace typecheck itself and attributed the full-suite
  failures to code outside the diff, which matches the recorded baseline.

  Claude read the whole diff independently while the run was in flight — the
  round 7 fixes in particular, since round 6 was also a clean gpt-5.5 pass that
  Claude found a real defect behind. Nothing substantiated came out of it:
  - The backend's `restorePending` / `parsedSequence` / `kitty` state is all
    updated from `headless.write` callbacks, which xterm runs in write order, so
    a restored session's `markParsed(startSequence)` can never land after a live
    batch's `markParsed(sequence)`. Each is also mirrored onto `sessionEntry`
    the same way, so it is correct whichever side of the `Session` construction
    the callback falls on.
  - `getSnapshot` reports `snapshot`, `cursorHidden`, `kittyStack` and
    `lastSequence` all off the parsed state, so the four are mutually
    consistent; `getHistory` still reports the issued `lastSequence` and its
    `scrollback` is appended synchronously with it, so the history path cannot
    duplicate a chunk the client also holds in `recent`.
  - `kittyEvents` cannot be moved by live output between `attach()`'s sample and
    the history replay: while `historyLoaded` is false every `TERMINAL_OUTPUT`
    goes to `pending` rather than through the parser. On a first-ever attach
    `savedKitty` is empty, so `recoverKittyStack` is a no-op there.
  - `attach()`'s `historyLoaded = false` and `this.pending = this.takeRecent()`
    have no await between them, so no event can slip in and be discarded.

- Validation at `e557135` (no source change this round): `bun run lint` exit 0,
  `bun run typecheck` exit 0 across all five packages, `bun test` 1002 pass /
  8 fail — the 8 are the recorded pre-existing `MarkdownPaneImpl` suite-ordering
  failures, unchanged and verified by name. Working tree clean.

Task 9 is clear after two gpt-5.5 rounds (6 and 8) with no findings and the
round 7 fixes pinned by tests.

## Task 10 — implementation

Base commit `ad82029`. Implemented in `75f0f23` following the plan verbatim
(plan line 2639): new `packages/tui/src/term/blit.ts` exporting `blitTerminal`,
plus the plan's nine-test `packages/tui/src/term/blit.test.ts`.

- TDD order held: the test file went in first and failed with
  `Cannot find module './blit'`, then went green (9 pass) once `blit.ts` landed.
- Palette colours are carried through as `{ kind: "palette", index }` rather
  than resolved to RGB — the plan calls this out because resolving here would
  break Omarchy theme switching, and it has its own test.
- The cursor is reported in screen coordinates and suppressed (`null`) both when
  DECTCEM has hidden it and when `cursorX`/`cursorY` sits outside the pane rect
  — `IBuffer.cursorX` may equal `cols` after the last cell of a row, and parking
  the real cursor there would bleed into the neighbouring pane.

Validation at `75f0f23`: `bun run lint` exit 0, `bun run typecheck` exit 0
across all five packages, `bun test` 1011 pass / 8 fail — 1002 + the 9 new
tests, and the 8 are the recorded pre-existing `MarkdownPaneImpl` suite-ordering
failures, verified unchanged by name. Working tree clean.

Review needed: yes. It is new rendering code on the hot path with colour,
width and cursor edge cases.

- **Task 10, round 1** (gpt-5.5 via codex-review, Mode B over `ad82029..64b4bdc`
  restricted to `packages/tui/src/term/blit.ts` and `blit.test.ts`): one
  finding, substantiated and fixed in `9d6e970`. Run the repros with
  `bun test packages/tui/src/term/blit.test.ts`.
  - **Substantiated — the cursor was reported in buffer coordinates.**
    `blitTerminal` copies rows starting at `active.viewportY` but returned
    `active.cursorY`, which xterm counts from `baseY`, not from the viewport.
    Whenever the two differ — a scrolled-back viewport — the cursor was drawn on
    whichever scrollback line happened to share that index, or shown at all when
    it had scrolled out of sight entirely. Claude confirmed the xterm semantics
    independently with a standalone probe before the report landed: after
    `scrollLines(-2)` on a 10x3 terminal, `cursorY` stayed `2` while `viewportY`
    dropped to `0` and `baseY` stayed `2`. The typings say so outright
    (`@xterm/headless` 5.5 `IBuffer.cursorY`: "ranges between 0 (when the cursor
    is at baseY) and Terminal.rows - 1").
    Two regression tests, both red on `64b4bdc` and green on `9d6e970`:
    `blitTerminal > hides the cursor when scrollback has pushed it below the
    viewport` (returned `{x:1,y:4}` instead of `null`) and `blitTerminal > keeps
    the cursor on its own row when a scrolled viewport still shows it`
    (returned `y:2` instead of `y:3`). The second exists so the fix cannot be a
    blanket "hide the cursor whenever scrolled".
    Fix: `const cursorRow = active.baseY + active.cursorY - active.viewportY`,
    then bound that against the rect.
  - Reachability: nothing in the TUI calls `scrollLines` yet, so the defect was
    latent. Fixed anyway — the function already reads its rows through
    `viewportY`, so returning a cursor that ignores it is internally
    inconsistent, and `SessionTerminal` is built with `scrollback: 5000`
    precisely so a later stage can scroll.
  - Claude also checked, and found nothing wrong with: the RGB unpacking
    (`getFgColor()` is documented as `0xRRGGBB`, so the three shifts are right),
    the palette/default/RGB predicate split, attribute coverage against the
    `Cell` model (`blink`, `invisible` and `overline` have no representation in
    the model, so dropping them is the model's choice, not a blit defect), the
    width-0 continuation cell against `screen.ts`'s flush (it emits no character
    for `width === 0`, so the wide glyph's own two columns stay in step), and
    aliasing — `toCell` allocates a fresh `Cell` and fresh colours per cell, and
    the shared `DEFAULT_COLOR` it reuses is frozen, so `ScreenBuffer.set`'s
    take-ownership contract is not violated. Codex reached the same conclusion
    on the colour and attribute questions from the installed 5.5.0 source.
  - Noted, not treated as defects: `line.getCell(col)` allocates a new cell
    object per call where xterm's own docs suggest passing a reusable
    `getNullCell()`, which is a hot-path allocation question for Stage 2 rather
    than a correctness one; and hiding the cursor when `cursorX === cols` is the
    plan's explicit choice (its own test pins it) even though a real terminal
    would show it parked on the last column.

- Validation at `9d6e970`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 1013 pass / 8 fail — 1011 + the 2 new
  tests, and the 8 are the recorded pre-existing `MarkdownPaneImpl`
  suite-ordering failures, verified unchanged by name. Working tree clean.

- **Task 10, round 2** (gpt-5.5 via codex-review, Mode B over `ad82029..HEAD`
  restricted to `packages/tui/src/term/blit.ts` and `blit.test.ts`): two
  findings, both substantiated and fixed in `4ff75be`. Run the repros with
  `bun test packages/tui/src/term/blit.test.ts`.
  - **The round 1 cursor fix was confirmed correct, not reopened.** Codex read
    the installed `@xterm/headless` 5.5.0 source (`cursorY` is buffer `y`,
    `baseY` is `ybase`, `viewportY` is `ydisp`) and ran its own probes across
    bottom, scrolled-up, scrolled-to-top, `baseY === 0` and the 5000-line
    scrollback cap. Claude probed the same states independently and confirmed
    the invariant that makes the translation safe: `viewportY` ranges over
    `[0, baseY]`, so `baseY + cursorY - viewportY` is never negative. At the cap
    it reported `baseY: 5000, viewportY: 0, cursorY: 4` → row `5004`, correctly
    out of the viewport. The `cursorRow < 0` branch is therefore unreachable;
    kept as a cheap statement of the bound rather than removed.
  - **Substantiated — a wide glyph at the last copied column overflowed the
    rect.** `toCell` emitted the leading width-2 cell whenever xterm reported
    one, even when its width-0 continuation fell outside the rect. `screen.ts`
    suppresses only `width === 0`, so the glyph was written and the real
    terminal advanced two columns, painting over the first column of whatever
    is drawn to the right — and because the front buffer still recorded the
    neighbour's own cell as unchanged, the corruption would never be repainted.
    Claude reproduced this independently before the report landed (blit a
    10-col terminal holding `abcd你` through a 5-col rect: column 4 came back
    `{ch: "你", width: 2}` while column 5 held an unrelated width-1 cell).
    Regression test: `blitTerminal > clips a wide glyph that starts at the
    rect's last column` — red on `9d6e970`, green on `4ff75be`.
  - **Substantiated — the rect's `cols`/`rows` were treated as the source's own
    dimensions.** Two symptoms from one cause. A rect wider than the terminal
    let `cursorX === terminal.cols` — xterm's "after last cell of the row"
    sentinel — pass the `cursorX >= cols` guard and be returned as a real
    column (`{x: 5, y: 0}` for a 5-col terminal blitted through a 10-col rect).
    A rect taller than the terminal kept calling `getLine(viewportY + row)` past
    the child's own viewport, so the extra rows showed scrollback the child is
    not displaying (a 5-row terminal scrolled to top, blitted through an 8-row
    rect, returned `abcdefgh` down column 0 instead of `abcde` plus blanks) and
    the cursor was placed on one of those scrollback rows (`{x: 1, y: 7}`).
    Two regression tests, both red on `9d6e970` and green on `4ff75be`:
    `blitTerminal > hides a cursor parked past the source terminal's last
    column` and `blitTerminal > blanks the rect below the source terminal's own
    viewport`.
  - Fix rule chosen: clamp the source read with
    `srcCols = min(cols, terminal.cols)` and `srcRows = min(rows, terminal.rows)`.
    Cells outside that are blanked rather than left stale, the wide-glyph clip
    triggers at `col === srcCols - 1` (which is the rect edge when the rect is
    narrower and unreachable when it is not, since xterm wraps rather than
    leaving a wide glyph in the last column), and the cursor bounds test against
    `srcCols`/`srcRows`. The clipped stand-in keeps the cell's colours and
    attributes so the pane edge does not tear. All 11 pre-existing tests still
    pass unchanged — when the rect matches the terminal, `srcCols === cols` and
    `srcRows === rows`, so behaviour is identical.
  - Reachability: the mismatch is not hypothetical. `SessionTerminal.resize`
    round-trips `TERMINAL_RESIZE` to the backend, so a pane that has been
    relaid out is wider or taller than its child terminal for at least a frame.
  - Codex also confirmed, and Claude agrees: `ScreenBuffer.set` already tolerates
    out-of-range destination coordinates (it returns early), so `blitTerminal`
    needs no clamp on the `x0`/`y0` side; `chars === ""` maps to a blank
    sensibly; combining sequences survive as multi-code-point `ch`; the
    `line === undefined` path fills blanks; and nothing handed to `buf.set` is
    retained or mutated afterwards.

- Validation at `4ff75be`: `bun run lint` exit 0, `bun run typecheck` exit 0
  across all five packages, `bun test` 1016 pass / 8 fail — 1013 + the 3 new
  tests, and the 8 are the recorded pre-existing `MarkdownPaneImpl`
  suite-ordering failures, verified unchanged by name. Working tree clean.

- **Task 10, round 3** (gpt-5.5 via codex-review, Mode B over `ad82029..HEAD`
  restricted to `packages/tui/src/term/blit.ts` and `blit.test.ts`): **zero
  findings — Task 10 is clear.** No code changed this round.
  - Codex reported the diff clear outright, with no lower-confidence suspicions.
    It re-derived all three prior fixes from the installed `@xterm/headless`
    5.5.0 source and confirmed each: the round 1 cursor translation
    (`cursorY` is relative to `baseY` while the copied rows start at
    `viewportY`), the round 2a wide-glyph clip (`Screen.flush` emits every
    non-zero-width cell, so a width-2 glyph at the last copied column would
    advance the real terminal into the neighbouring pane), and the round 2b
    `srcCols`/`srcRows` clamp (xterm lines outlive the current column count
    after a resize, and rows past the child's viewport are not what the child
    displays). It also re-checked width-0 continuations, scrolled-viewport
    cursor placement, larger and smaller rects, default/palette/RGB colours,
    attribute coverage, and `ScreenBuffer.set` ownership, and judged the tests
    to pin the behaviour they claim.
  - Claude's own verification, run before the report landed rather than taken
    on trust — the one open question from round 2 was whether the clip rule
    could fire *spuriously* when `srcCols === cols === terminal.cols`, i.e.
    whether xterm can leave a wide glyph sitting in a row's last column at all.
    A standalone probe says it cannot: writing `ab你好` and `abcd你` into a
    5-column terminal both wrapped the wide glyph to the next row rather than
    placing it at column 4 (`[a|1][b|1][你|2][|0][|1]` / `[a|1][b|1][c|1][d|1][|1]`
    then `[你|2][|0]...`), matching xterm's `InputHandler.print` wrap check.
    So `col === srcCols - 1` only ever clips a glyph whose continuation really
    is outside the copied region. Claude also re-read `render/screen.ts`
    (`flush` skips the character for `width === 0` only, and each changed run
    re-emits an explicit CUP, so a clipped pair cannot desynchronise the row)
    and `render/cells.ts` (`blankCell` and `copyColor` both hand back the frozen
    `DEFAULT_COLOR` singleton, and `toCell` allocates a fresh `Cell` plus fresh
    non-default colours per cell, so `ScreenBuffer.set`'s take-ownership
    contract holds).
  - Carried forward as Stage 2 notes, not defects: `line.getCell(col)` allocates
    a cell object per call where xterm's docs suggest a reusable
    `getNullCell()`; and `blink`/`invisible`/`overline` have no `Cell`
    representation, which is the model's choice rather than a blit defect.

- Validation at `4ff75be` (unchanged — round 3 committed no code): `bun run lint`
  exit 0, `bun run typecheck` exit 0 across all five packages, `bun test`
  1016 pass / 8 fail, the 8 being the recorded pre-existing `MarkdownPaneImpl`
  suite-ordering failures, verified unchanged by name. Working tree clean.

## Task 11 — implementation

- Base commit `9420a4b`, implemented in `21040e4`. Files: `packages/tui/src/state/store.ts`
  and `packages/tui/src/state/store.test.ts`. The plan's 5 tests pass unchanged;
  the test file is the plan's verbatim.

- Payload shapes were checked against the backend rather than taken from the plan:
  `project-routes.ts:78` broadcasts the project for `PROJECT_CREATED`, `:105`
  broadcasts `{ id }` for `PROJECT_REMOVED`, `:182` the project for
  `PROJECT_UPDATED`; `task-routes.ts:559` broadcasts the task for `TASK_CREATED`
  and every `TASK_UPDATED` site broadcasts the filtered task. The plan's casts
  match all five.

- Validation at `21040e4`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1021 pass / 8 fail — the 8 being the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, verified unchanged by
  name, and 1021 = the previous 1016 plus this task's 5. Working tree clean.

- Three deviations from the plan's sample body, all cosmetic or defensive:
  `Array<() => void>` written as `(() => void)[]` and the `net.on` callbacks given
  braced bodies, both to satisfy the repo's existing lint rules; and `notify()`
  iterates a copy of the listener set so a listener that unsubscribes or subscribes
  during a notification cannot change who that same notification reaches.

- Known limitation, not a Task 11 defect: the backend has no task-removed event.
  `MSG.TASK_DELETE` (`packages/backend/src/handlers/task.ts:184`) deletes the record
  and broadcasts nothing, so a deleted task stays in the store until the next
  `load()`. There is no message to subscribe to, so this belongs to Task 17
  (reconnection and resync) or to a backend change, not here.

## Task 11 — review rounds

- **Task 11, round 1** (gpt-5.5 via codex-review, Mode B over `9420a4b..21040e4`,
  prompt scoped to `packages/tui/src/state/` with the backend broadcast sites named
  as context to verify): one finding from Codex, substantiated; one further defect
  found by Claude's own verification during the same round. Both fixed in `3cb8118`.
  Run the repros with `bun test packages/tui/src/state/`.

  - **Substantiated (Codex, High) — `load()` overwrote a broadcast that arrived
    while it was in flight.** The constructor subscribes before `load()` runs, and
    `load()` assigned both lists unconditionally from the snapshot. Sequence: the
    `TASK_LIST` response resolves without `t7`; the slower `PROJECT_LIST` request is
    still pending; a `TASK_CREATED` for `t7` arrives and is applied; `Promise.all`
    then settles and `this.taskList = tasks.tasks` drops `t7`. Observable symptom: a
    task created or renamed in the moment the TUI starts shows stale, or not at all,
    until some later event touches it. Realistic because the two snapshot requests
    settle independently and `listProjects()` does per-project `stat()` work.
    Regression test: `Store > keeps an event that arrived while load() was in flight`
    — red on `21040e4`, green on `3cb8118`. Uses a `slowNet` helper whose
    `PROJECT_LIST` response is gated so the emit genuinely lands mid-load.
    Fix: a `deferred` queue, non-null only while a `load()` is in flight; event
    handlers push their mutation onto it instead of applying, and `load()`'s
    `finally` replays the queue on top of the snapshot in arrival order, then
    notifies once. Replay happens in `finally` rather than after the `await` so a
    failed snapshot request does not silently swallow the events that arrived during
    it. This is the fix Codex proposed; it was already implemented and verified
    before the report landed.

  - **Substantiated (Claude) — `PROJECT_REMOVED` left the project's tasks behind.**
    `taskStore.removeProject` (`packages/backend/src/services/task-store.ts:540`)
    deletes every task of the project, and no per-task event is broadcast for them,
    so the store dropped the project but kept its tasks forever. Observable symptom:
    `store.tasks` (and `tasksFor(<removed id>)`) keeps returning phantom tasks of a
    deleted project — anything reading the flat task list, rather than iterating
    live projects, shows them. Regression test:
    `Store > removes a project's tasks when the project is removed` — red on
    `21040e4` (`["t1","t2"]`), green on `3cb8118` (`["t2"]`). Fix: the
    `PROJECT_REMOVED` handler filters `taskList` by `projectId` as well.
    Note this is distinct from the recorded task-deletion limitation: there the
    store receives no event at all, here it receives one that implies the removal.

  - **Codex's clean areas, independently spot-checked, no action.** Payload-shape
    casts: Claude re-enumerated every broadcast site, including the ones the
    implementation note missed (`session-lifecycle.ts:207/217/599/614`,
    `title-generator.ts:54`, `git.ts:205`, `worktree-setup.ts:135/144`,
    `attribute-routes.ts:37/41`, `handlers/attribute.ts:60/66`,
    `project-routes.ts:255`) — all send a full filtered `Project`/`Task` or `{ id }`,
    so `payload as Project` / `as Task` / `as { id: string }` hold. `notify()`
    copying the listener set is sound. Getter predicates match the shared types
    (`Project.hidden?: boolean` at `packages/shared/src/types/project.ts:19`), and
    per-access allocation is not material at this scale.

  - **Test-coverage gaps Codex noted, closed in the same commit.** Two tests added
    that are green both before and after the fix, so they are coverage rather than
    repros: `Store > hides projects flagged hidden` (the `hidden !== true` filter had
    no test at all — deleting it left all five plan tests passing) and
    `Store > dispose detaches the backend event subscriptions` (asserts the `net.on`
    disposers actually run, via a `listenerCount` hook on the fake net).

- Validation at `3cb8118`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1025 pass / 8 fail — the 8 being the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures, verified unchanged by
  name, and 1025 = the previous 1021 plus this round's 4 new tests. Working tree
  clean.

- **Task 11, round 2** (gpt-5.5 via codex-review, Mode B over `9420a4b..3cb8118`
  restricted to `packages/tui`, with round 1's two fixes called out as already
  known): one finding, substantiated and fixed in `cad685b`. Run the repro with
  `bun test packages/tui/src/state/store.test.ts`.

  - **Substantiated — a superseded `load()` could overwrite a newer snapshot.**
    `load()` kept one `deferred` queue pointer but no notion of which load was
    newest, so two overlapping `load()` calls both committed their snapshots in
    whatever order they settled. Observable symptom: after two `load()` calls
    overlap (the reconnect path in Task 17 is the realistic source — a drop and
    an immediate re-drop each trigger a reload), tasks and projects that exist on
    the backend vanish from the sidebar and stay missing until the next event or
    reload, because the older request's answer landed last and won. Regression
    test: `Store > a superseded load() does not overwrite the newer snapshot` —
    red on `3cb8118` (`[]` where `["t2"]` was expected), green on `cad685b`.
    Claude reached the same finding independently before the report landed.
    Fix: a monotonic `loadToken` per `load()`; a load whose token is no longer
    the newest returns without committing, and the deferred-mutation queue became
    a single shared queue drained by whichever load does commit — so events that
    arrived during a superseded load are not lost with it. Codex's suggested
    single-flight (return the in-flight promise to a second caller) was rejected:
    a reload after a reconnect must fetch fresh data, not hand back the
    pre-reconnect snapshot.

  - **Coverage added in the same commit.** `Store > an event queued during a
    superseded load survives into the newer snapshot` is green both before and
    after, so it is coverage rather than a repro; it exists to pin the shared-queue
    behaviour the fix introduces, which a narrower fix would have broken.

  - **Codex's clean areas, spot-checked, no action.** Backend payload shapes match
    the `as Project` / `as Task` / `as { id: string }` casts (re-verified in round 1
    across every broadcast site); the round-1 `PROJECT_REMOVED` cascade fix is
    correct; the listener-set copy in `notify()` makes add/remove during a
    notification safe. Snapshot responses are trusted rather than runtime-validated,
    and both backend handlers do return `{ projects }` / `{ tasks }` — not treated
    as a defect at this layer.

  - **Not reported, out of scope.** There is still no `TASK_REMOVED` broadcast in
    the backend protocol, so a deleted task lingers until the next `load()`. This
    is the recorded backend gap, unchanged by this task.

- Validation at `cad685b`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1027 pass / 8 fail — the 8 being the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures in `packages/ui`, verified
  unchanged by name, and 1027 = the previous 1025 plus this round's 2 new tests.
  Working tree clean.

- **Task 11, round 3** (gpt-5.5 via codex-review, Mode B over `9420a4b..cad685b`
  restricted to `packages/tui`, with rounds 1-2's three fixes called out as already
  known): three findings, all three substantiated and fixed in `57ad359`. Run the
  repros with `bun test packages/tui/src/state/store.test.ts`.

  - **Substantiated — a stale project order after a reorder elsewhere.** The store
    subscribed to `PROJECT_CREATED` / `UPDATED` / `REMOVED` but not
    `MSG.PROJECT_REORDERED`. Observable symptom: drag a project to a new position in
    the Electron window and the TUI sidebar keeps showing the old order until the
    next `load()`. The backend does broadcast it, from
    `api/routes/project-routes.ts:130` and `handlers/project.ts:119`, and the
    Electron store consumes it at `packages/ui/src/stores/project-store.ts:139`.
    Regression test: `Store > applies a project reorder broadcast` — red on `cad685b`
    (`["p1","p2"]`), green on `57ad359`. Fix: subscribe and apply the shared
    `orderProjectsByIds` helper, the same one the Electron store uses.

  - **Substantiated — a parent archive left its subtasks listed as active.**
    `applyTask` was a single-record upsert, but archiving a top-level task cascades
    to its subtasks on the backend
    (`api/routes/task-routes.ts:347` archives the children,
    `:376` broadcasts the parent alone) — and unarchiving does the same at `:388`.
    Observable symptom: archive a parent task in the Electron window and its
    subtasks stay in the TUI sidebar as live rows whose parent is gone. Regression
    test: `Store > archives a parent's subtasks when only the parent archive is
    broadcast` — red on `cad685b` (`["child"]`), green on `57ad359`. Fix: a local
    cascade in `applyTask`, mirroring the round-1 `PROJECT_REMOVED` precedent —
    same situation, a silent backend cascade with no per-child event.
    Guarded on an actual status transition against the previously held record, so a
    rename or session change on the parent does not resurrect a child archived on
    its own. Two coverage tests pin those boundaries, green both before and after:
    `Store > restores a parent's subtasks when the parent is unarchived` and
    `Store > leaves subtasks alone when a parent update does not change its status`.
    The WS handler path (`handlers/task.ts:139`) broadcasts nothing at all for an
    archive, so via that path even the parent lingers — a backend gap of the same
    family as the missing `TASK_REMOVED`, recorded below, not fixable in the store.

  - **Substantiated — a replayed event could put an older value back over a newer
    snapshot.** Round 2's shared deferred queue was drained in full by whichever
    load committed, including mutations queued before that load had even issued its
    requests. Those are, by ordering, already reflected in its snapshot, so
    replaying them reverts any change made in between. Observable symptom: after two
    overlapping reloads (the double-reconnect path Task 17 owns), a task's title or
    status reverts to a value the backend no longer holds, and stays wrong until the
    next event or reload. Reproduced independently before the report landed, then
    confirmed by Codex. Regression test: `Store > does not replay an event the newer
    snapshot already covers` — red on `cad685b` (`"Old"`), green on `57ad359`
    (`"New"`). Fix: each `load()` records the queue length at the moment it issues
    its requests and replays only from that mark. The failure path is the exception —
    a load that never committed a snapshot has superseded nothing, so it still
    replays the whole queue; `Store > keeps a queued event when the load that would
    cover it fails` pins that and was written after noticing the naive slice would
    have dropped the event.

  - **Round 2's decision reversed, deliberately.** The round-2 test `an event queued
    during a superseded load survives into the newer snapshot` encoded the opposite
    rule. Its premise does not occur: its staged net returns a snapshot that omits a
    task whose creation was broadcast *before* that snapshot was requested, which a
    single backend over a single socket cannot do. The test was rewritten as
    `Store > an event that arrives after the newest load was issued survives its
    snapshot`, which pins the part of the shared-queue behaviour that is real.

  - **Codex's non-blocking observations, checked and left alone.** A failed `load()`
    notifies listeners once even though no state changed — redraw noise, and the
    store's contract does not promise change-only notifications. `dispose()` does not
    stop an in-flight `load()` from committing afterwards; the listeners are already
    cleared by then and the store is unreachable, so nothing observes it. Both
    verified by probe, neither treated as a defect.

  - **Independently probed, healthy.** A rejected `load()` does not wedge `deferred`
    or `loadToken` for later loads; three overlapping loads leave the newest winner
    regardless of settle order; an event arriving after the newest load commits is
    applied immediately rather than lost.

- Validation at `57ad359`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1033 pass / 8 fail — the 8 being the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures in `packages/ui`, verified
  unchanged by name, and 1033 = the previous 1027 plus this round's 6 new tests.
  Working tree clean. One lint fix along the way: `expect(...).rejects.toThrow()` is
  typed as non-thenable here, so the rejection assertion is a `try`/`catch` on the
  message instead — no `eslint-disable`, and unlike the repo's unawaited
  `expect(p).rejects` calls it actually waits for the assertion.

- **Task 11, round 4** (gpt-5.5 via codex-review, Mode B over `9420a4b..57ad359`
  restricted to `packages/tui`, with rounds 1-3's fixes called out as already known):
  two findings, both substantiated and fixed in `32d6267`. Run the repros with
  `bun test packages/tui/src/state/store.test.ts`.

  - **Substantiated — new and newly pinned tasks landed in the wrong sidebar slot.**
    `applyTask` upserted in place and appended unknown ids, but the backend serves
    tasks pinned-first then newest-first then by id
    (`services/task-store.ts:397` via `readTasksFromDir`), and the Electron store
    re-sorts on every broadcast (`packages/ui/src/stores/task-store.ts`, both
    `applyTaskUpdate` and the `TASK_CREATED` handler). Observable symptom: create a
    task in the Electron window and it appears at the *bottom* of the TUI's list for
    that project instead of the top, then jumps to the top on the next reload; pin a
    task and it does not move at all. Regression tests: `Store > orders a newly
    created task by creation time, not arrival` (red on `57ad359` with
    `["t-old","t-new"]`) and `Store > floats a task to the top when it is pinned`
    (red with `["t1","t2"]`); both green on `32d6267`. Claude found this
    independently from the backend comparator before the report landed.
    Fix: sort on every task upsert. The comparator existed three times over
    (backend `task-store-helpers.ts`, Electron `task-store.ts`, and now the TUI), so
    it moved to `@taskflow/shared` as `sortTasksByCreatedAtDesc` — the sibling of the
    existing `orderProjectsByIds` — and all three consumers now call it. The
    backend's private `compareTasksByCreatedAtDesc` and its `getCreatedAtTimestamp`
    helper were deleted with it; `getCreatedAtTimestamp` was an export nothing outside
    that file imported.

  - **Substantiated — unarchiving a parent left its subtasks missing.**
    The round-3 cascade mirror only touched children already in `taskList`, but
    `TASK_LIST` serves active tasks only (`readTasksFromDir` reads `tasksDir`;
    archived records live under `archivePath`), so a client that loaded while a
    family was archived holds none of it. The backend unarchives every archived
    subtask (`api/routes/task-routes.ts:389-393`) and broadcasts the parent alone
    (`:400`). Observable symptom: unarchive a task in the Electron window and it
    appears in the TUI sidebar with all of its subtasks missing until the next
    reload — and the same for a subtask archived on its own and restored with its
    parent. Regression test: `Store > refetches subtasks the backend restores with an
    unarchived parent` — red on `57ad359` (`["parent"]`), green on `32d6267`.
    Fix: no local mirror is possible, since the records were never held, so a
    top-level task transitioning to `active` (including one arriving with no previous
    record, which means it was archived) triggers a background `load()`. The
    `loadToken` machinery from round 2 already makes a self-triggered reload safe
    against overlaps, and the refresh is fired only from the `TASK_UPDATED` path, so
    an ordinary `TASK_CREATED` does not cause one. A failed refresh is swallowed:
    the store has no error channel and reconnect is the app's job.

  - **Two round-3 tests changed expectations, not behaviour.** `restores a parent's
    subtasks when the parent is unarchived` and `leaves subtasks alone when a parent
    update does not change its status` asserted `["parent","child"]`; with the sort
    in place a subtask created after its parent now sorts above it. Their fixtures
    grew explicit `createdAt` values so the expected order is derivable from the
    fixture rather than from id-tiebreak accident.

  - **Codex's clean areas, and Claude's own probes, no action.** Codex found no new
    defect in the `loadToken` / shared-queue arithmetic, and independent probing of
    three-way overlaps, a rejecting newest load, a never-settling load (bounded by
    `WsClient`'s per-request timeout and its reject-on-close, `net/client.ts:80`),
    and `dispose()` racing a load agreed. `parentId?: string` in `@taskflow/shared`
    confirms `undefined` is the right absent-parent test. `TASK_LIST` and the
    `TASK_CREATED`/`TASK_UPDATED` broadcasts both pass through
    `filterTaskSessions`, so session fields cannot flicker between snapshot and
    event. Project order needs no equivalent sort: the Electron store appends on
    `PROJECT_CREATED` too, and explicit order arrives via `PROJECT_REORDERED`.

  - **Not reported, out of scope.** Unchanged backend gaps: no `TASK_REMOVED`
    broadcast, and the WS `handlers/task.ts` archive path broadcasts nothing. The
    archive cascade also clears subtask `sessions` on the backend, which the local
    mirror does not copy — invisible while archived rows are not rendered.

- Validation at `32d6267`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1036 pass / 8 fail — the 8 being the recorded
  pre-existing `MarkdownPaneImpl` suite-ordering failures in `packages/ui`, verified
  unchanged by name, and 1036 = the previous 1033 plus this round's 3 new tests.
  Working tree clean.

- **Task 11, round 5** (gpt-5.5 via codex-review, Mode B over `9420a4b..32d6267`
  restricted to `packages/tui`, `packages/shared`, `packages/ui`, `packages/backend`,
  with rounds 1-4's fixes called out as already known): two findings, **neither a defect
  in Task 11's scope**, so Task 11 is clear with no code change this round.

  - **Out of scope — the store does not subscribe to `SESSION_STATUS`.** Real, and
    deliberate. Task 11's plan fixes the store's produced interface at `load()`,
    `projects`, `tasks`, `tasksFor()`, `onChange()`, `dispose()` — no session state —
    and the spec assigns `SESSION_STATUS` to the session pane
    (`docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md:240`, "Session
    pane + tabs | `SessionRef`, `SESSION_STATUS`, `onTitleChange`"), which is Task 14.
    Adding it here would widen a bounded task. Left for Task 14.

  - **Out of scope — `MSG.SESSION_RENAME` mutates the owner record and broadcasts
    nothing.** Verified: `packages/backend/src/handlers/session.ts:80-112` updates the
    owning task, project or master session and returns `{success: true}`; the file
    contains no `broadcast` call at all (`grep -n broadcast` on it is empty), so a
    second client's label stays stale until its next reload. Pre-existing backend gap,
    untouched by this diff — `git diff 9420a4b..32d6267 -- packages/backend/src/handlers/`
    is empty — and the same family as the already-recorded missing `TASK_REMOVED`
    broadcast and the silent WS archive path. Not a TUI-store bug; recorded here as a
    known backend gap rather than fixed inside this task.

  - **Codex found nothing in the areas round 5 targeted.** It reported the
    `loadToken`/deferred-queue replay, the cascade mirrors, the unarchive refetch path
    and subscriber notification all clean, and confirmed the shared comparator is
    semantically identical to the three implementations it replaced (pinned first,
    newest valid `createdAt`, invalid date as `0`, `id.localeCompare` tie-break).

  - **Claude's own probes this round, all healthy.** Two throwaway probes against the
    live store (written, run, then deleted): the unarchive refetch converges at exactly
    one extra `TASK_LIST` (`taskListCalls` 1 → 2) and restores the family, with no
    reload storm; and a second top-level `TASK_UPDATED` arriving *during* the refetch is
    queued, drained after the commit, and triggers no further reload, because the
    snapshot it lands on already carries that task as active. Also checked by hand: the
    dead helpers really are gone — `grep -rn "compareTasksByCreatedAtDesc"` across
    `packages/` has no hits, and `getCreatedAtTimestamp` survives only as a private
    function inside `packages/shared/src/utils/task-order.ts`.

- Validation at `32d6267` (re-run for round 5, no code change): `bun run lint` exit 0,
  `bun run typecheck` exit 0 across all five packages, `bun test` 1036 pass / 8 fail
  (1044 across 101 files, 57s) — the 8 being the pre-existing `MarkdownPaneImpl`
  suite-ordering failures, verified unchanged by name. Cross-checked per package as well:
  tui 203, shared 97, backend 600, ui 136 pass / 8 fail; `packages/cli` has no test files.
  One flake worth knowing about for later rounds: the first whole-repo `bun test` produced
  no output for 20+ minutes and had to be killed, while per-package runs and a second
  whole-repo run both finished normally — so treat a silent `bun test` as worth retrying
  rather than as a broken environment. Working tree clean.

- **Task 12, round 1** (gpt-5.5 via codex-review, Mode B over `b44a56f..cc41d6f`
  restricted to `packages/tui/src/ui`): five findings reported, two substantiated
  and fixed in `ebe33ab`, plus one contract-hardening change taken alongside them.
  Three findings were not reproducible. Run the repros with
  `bun test packages/tui/src/ui/routing.test.ts`.

  **The fact that decided most of this round.** `packages/tui/src/term/tty.ts:12`
  pushes `\x1b[>1u` — kitty flag 1 (disambiguate escape codes) and nothing else.
  Flag 1 does not report event types (that is flag 2) and does not report alternate
  keys (that is flag 4). Under flag 1 a text-producing key held with Shift alone is
  sent as its text, and `decodeKitty` delegates plain text to `decodeLegacy`. Three
  of Codex's five findings assume shapes only flags 2 or 4 can produce, so they are
  unreachable as the app negotiates today. Worth re-checking if the pushed flags
  ever change.

  - **Substantiated — a `super`-modified sidebar char ran the bare command.** The
    sidebar gate excluded `ctrl` and `alt` but not `super`, so `Super+j` moved the
    selection, `Super+Q` quit and `Super+3` selected a tab. Reachable: `super` is a
    non-Shift modifier, so under flag 1 the terminal encodes it as `CSI 106;9u`, and
    `modsFromParam` maps bit 8 to `super`. Contradicted the file's own intent — the
    pre-existing test `a modified sidebar char is not a command` already pinned
    `ctrl` and `alt`. Regression test: `route edge cases > a super-modified sidebar
    char is not a command` — red on `cc41d6f`, green on `ebe33ab`.

  - **Substantiated (same class, found by Claude, not Codex) — chorded `Enter`
    opened.** The `enter` branch ran before the modifier gate and ignored modifiers
    entirely, so `Ctrl+Enter`, `Alt+Enter` and `Super+Enter` in the sidebar all
    produced `{kind:"open"}`. Reachable in kitty mode as `CSI 13;5u` and friends.
    Regression test: `route edge cases > a chorded enter does not open` — red on
    `cc41d6f`, green on `ebe33ab`. `Shift+Enter` deliberately still opens, which the
    same test pins.

  - **Hardening, not a reachable bug — a held Escape passed in under kitty.** The
    doc comment claims `pendingEscape` is always false when the kitty protocol is
    available, but the code did not enforce it: `route("session", ev, true, true)`
    prepended a phantom Escape to the child's input, and a release returned the
    stale `true` straight back. Not reachable today — `kittyAvailable` is fixed once
    at startup by `negotiateKitty`, so no caller can cross a mode boundary holding
    an Escape. Taken anyway because it makes the documented invariant self-enforcing
    for Tasks 14 and 15, which are not written yet, and because in kitty mode
    dropping a held Escape is unambiguously the right reading. Implemented as a
    single `const held = kittyAvailable ? false : pendingEscape` at the top of
    `route`, used everywhere `pendingEscape` was read. Tests: `route edge cases >
    kitty mode never injects a held escape into the child` and `... clears a held
    escape rather than carrying it` — both red on `cc41d6f`, green on `ebe33ab`.

  - **Not reproducible — "session release events are dropped."** Codex wanted
    `kind: "release"` forwarded to the child. Under flag 1 the outer terminal never
    reports releases at all, so the input is unreachable; and the existing test `a
    release is ignored and leaves a held escape held` pins the opposite deliberately
    — a release must not consume a pending Escape. Codex's suggested fix would have
    broken that. Rejected.

  - **Not reproducible — "shifted kitty sidebar keys hit the wrong command."**
    Codex's claim was that `Shift+Q` arrives as `{char:"q", shift:true}` and so maps
    to `close-pane` instead of `quit`. That shape needs the alternate-key sub-field
    (`CSI 97:65;2u`), which a terminal only sends under flag 4. `decode-kitty.test.ts`
    exercises that shape, which is what Codex saw, but the app never asks for it.
    Under flag 1, `Shift+Q` is the byte `Q` and reaches `SIDEBAR_CHARS["Q"]` → quit,
    correctly. Same for `?` = `Shift+/`. Verified by reading the pushed sequence in
    `tty.ts` and the text-delegation path in `decodeKitty`.

  - **Not reproducible — "sidebar character lookup is prototype-unsafe."** Codex's
    input was `char: "__proto__"`. Both decoders build `char` from exactly one code
    point (`String.fromCodePoint` in `decode-kitty.ts:87`, `codePointAt` in
    `decode-legacy.ts:85`), so a multi-character `char` is unreachable, and
    `Object.prototype` has no single-code-point property names. The record is also
    already typed `Record<string, Action | undefined>`, so the type is honest.
    No change.

- Validation at `ebe33ab`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1058 pass / 8 fail (1066 across 102 files, 60s) — the
  8 being the same pre-existing `MarkdownPaneImpl` suite-ordering failures, verified
  unchanged by name against the round-5 list. `bun test packages/tui` alone: 225 pass
  / 0 fail across 14 files. Working tree clean.

- **Task 12 — review round 2** (`b44a56f..ebe33ab`, scoped to `packages/tui/src/ui`,
  Mode B prompted review so the flag-1 facts from round 1 could be stated up front).
  Codex raised two findings; one substantiated, one a judgement call resolved as a
  decision. Fix commit `4c819f4`.

  - **Substantiated — `Ctrl+Alt+Escape` was swallowed as the focus switch.** What you
    would see: in kitty mode, pressing `Ctrl+Alt+Escape` inside an attached agent
    session flipped focus to the sidebar instead of reaching the program in the
    session, and the same chord in the sidebar toggled focus rather than doing
    nothing. `isSwitcher` tested only `ev.mods.ctrl`, so every `Ctrl+<anything>+
    Escape` chord matched. Reachable end to end: the outer terminal sends
    `CSI 27;7u`, and running that through the real decoder plus `route` on `ebe33ab`
    printed `decoded: {"name":"escape","mods":{"shift":false,"alt":true,"ctrl":true,
    "super":false},"kind":"press"}` then `route session:
    {"action":{"kind":"toggle-focus"}, ...}`. Fix: the switcher is now exactly
    `Ctrl+Escape` — `ctrl && !alt && !super && !shift`. Regression test: `route edge
    cases > ctrl+escape with an extra modifier is not the switcher` (covers `alt`,
    `super` and `shift`, from both focuses) — red on `ebe33ab`, green on `4c819f4`.

  - **Hardening, not a reachable bug — a modified Escape started a legacy double-Esc.**
    The legacy branch gated on `!ctrl && !alt` only, so a `Super+Escape` or
    `Shift+Escape` would have been held as the first half of the double-Esc instead of
    going to the child. Not reachable today: `decodeLegacy` builds every Escape with
    `noMods()`, so a modified Escape cannot exist in legacy mode. Taken anyway so the
    two mode branches state the same rule — extracted as `isBareEscape`, mirroring
    `isSwitcher`. Shift counts as a modifier on Escape (unlike on a printable, where
    `isChorded` ignores it) because Escape has no shifted character to arrive as.
    Regression test: `route edge cases > a modified escape does not start a legacy
    double-esc` — red on `ebe33ab` for `super` and `shift`, green on `4c819f4`.

  - **Not a defect — "unused exported type symbols."** Codex noted that `Action` and
    `Focus` are exported but nothing imports them, against the project rule banning
    unused exports. True today and expected: the plan's Task 12 interface specifies
    both as the module's produced surface, and Tasks 13-15 consume them. `route`
    itself is in the same position (only the test imports it). Un-exporting would make
    the whole module dead code and force a re-export two tasks later. See "Decisions
    taken". No change.

- Validation at `4c819f4`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1060 pass / 8 fail (1068 across 102 files, 59s) — the 8
  being the same pre-existing `MarkdownPaneImpl` suite-ordering failures, verified
  unchanged by name against the round-1 list. `bun test packages/tui/src/ui/routing.test.ts`:
  24 pass / 0 fail. Working tree clean.

- **Task 12 — review round 3** (gpt-5.5 via codex-review, Mode B over `b44a56f..HEAD`,
  scoped to `packages/tui/src/ui`). The prompt carried the round-1 flag-1 facts (no key
  releases, no alternate keys, single-code-point `char`) and the round-2 decision that
  `Action`/`Focus` stay exported for Tasks 13-15, so none of those were re-reported.

  **Zero findings. Verdict `Clear`.** Codex traced `pendingEscape` through both the
  legacy and kitty branches — held Escape plus release, held Escape plus a non-Escape in
  each focus, legacy session forwarding order, the sidebar drop, the `Ctrl+Escape` mode
  difference, and `1`-`9` tab selection — and found no contradiction between the returned
  `action` and `pendingEscape`, and no reachable keymap shadowing. It independently ran
  `bun test packages/tui/src/ui/routing.test.ts` (24 pass), the package typecheck and
  eslint over both files, all green.

  - Note on the run: the prompt referenced a `task12.diff` written next to the prompt in
    the temp artifact directory, but Codex ran with `-C` at the repo root and did not
    find it there. It regenerated the same diff itself with
    `git diff b44a56f..HEAD -- packages/tui/src/ui` and reviewed the files on disk, so
    the scope was unaffected. Future rounds should inline the diff path as an absolute
    path or place the diff inside the repo.
  - No code changed this round, so there is no fix commit for it.

- Validation at `4c819f4` (unchanged HEAD for `packages/tui`, re-run this session):
  `bun run lint` exit 0, `bun run typecheck` exit 0 across all five packages, `bun test`
  1060 pass / 8 fail (59s) — the 8 being the same pre-existing `MarkdownPaneImpl`
  suite-ordering failures, verified unchanged by name against the round-2 list. Working
  tree clean.

## Task 13 — Sidebar rendering

- Base commit: `e64f1f0`. Implementation commit: `85871fc`.
- Implemented exactly as plan Task 13 specifies: `packages/tui/src/ui/sidebar.ts` with
  `SidebarRow`, `buildRows(store)` (projects from `store.projects`, each followed by
  `store.tasksFor(project.id)`) and `drawSidebar(buf, rows, selected, width, height)`
  (row index maps 1:1 to `y`, `ATTR_INVERSE` on the selected row, `ATTR_BOLD` on project
  rows, two-space indent on task rows, a ` N` session-count badge, label truncated to the
  space the prefix and badge leave, every column written so stale cells are cleared).
- Tests: `packages/tui/src/ui/sidebar.test.ts`, 6 tests, from the plan verbatim.
  Red before the implementation (`Cannot find module './sidebar'`), green after.
  Run with `bun test packages/tui/src/ui/sidebar.test.ts`.
- Validation at `85871fc`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1066 pass / 8 fail (1074 across 103 files, 57s) — the 8 being
  the same pre-existing `MarkdownPaneImpl` suite-ordering failures, verified unchanged by
  name against the Task 12 list. Working tree clean.
- Review: needed. New rendering code with index arithmetic and truncation.

- **Task 13, round 1** (gpt-5.5 via codex-review, Mode B over `e64f1f0..85871fc`
  scoped to `packages/tui/src/ui/sidebar.ts` and `sidebar.test.ts`, diff inlined in the
  prompt so the earlier relative-path problem could not recur): four findings, three
  substantiated and fixed in `33fbe44`, one refuted. Run the repros with
  `bun test packages/tui/src/ui/sidebar.test.ts packages/tui/src/render/text.test.ts`.

  - **Substantiated — wide and astral glyphs corrupted the row.** `drawSidebar` wrote
    one cell per UTF-16 code unit with `blankCell()`'s `width: 1`. A CJK label put `你`
    in a width-1 cell, so `Screen.flush` emitted a glyph the terminal draws two columns
    wide and everything after it sheared past the sidebar edge; an emoji was split into
    two cells holding the lone surrogates `\ud83d` and `\ude80`, which render as
    mojibake. Verified by running `drawSidebar` directly before the fix: `你A` produced
    `"你"/w1 "A"/w1`, and `🚀x` produced cells `"\ud83d" "\ude80" "x"`. Regression
    tests: `drawSidebar > keeps a wide label glyph in one cell with a width-zero
    continuation`, `> does not split an astral glyph across two cells`, and
    `> truncates by display width so the badge always fits` (that last one showed
    `"  你你你 4"` — ten display columns written into an eight-column pane — before the
    fix).
  - **Substantiated — a selection past the end of the list highlighted a blank row.**
    `drawSidebar(buf, [], 0, 4, 2)` set `ATTR_INVERSE` (16) on row 0 even though no row
    exists there. Attributes are now computed only when a row exists. Regression test:
    `drawSidebar > does not select a row past the end of the list`.
  - **Substantiated — the tests did not pin the specified rendering.** The plan's tests
    used `toContain` and a length bound, so an implementation with no task indentation,
    a misplaced badge, or no stale-cell clearing passed. Added exact-text, per-cell
    attribute, and prefilled-buffer clearing tests: `> indents task rows and puts the
    badge after the label`, `> bolds project rows and leaves task rows unbolded`,
    `> carries the selection attribute across the whole row, padding included`, and
    `> clears every cell left over from a previous frame`.
  - **Refuted — `export type { SidebarRow }` has no importer.** Codex read the
    no-unused-exports constraint as violated. Plan Task 15 (application shell) imports
    it explicitly: `import { buildRows, drawSidebar, type SidebarRow } from "./sidebar"`
    at plan line 3923. Export kept; removing and re-adding it two tasks later is churn.

- Fix commit `33fbe44`. New module `packages/tui/src/render/text.ts` exports
  `fitToWidth(text, cols)` (longest grapheme prefix fitting `cols` display columns) and
  `layoutText(text, cols, attrs)` (exactly `cols` cells: width-2 glyph plus width-0
  continuation, control characters blanked, a wide glyph straddling the last column
  clipped to a space, remainder padded). Both are imported by `sidebar.ts`; nothing else
  is exported. Tests: `packages/tui/src/render/text.test.ts`, 16 tests.
- Validation at `33fbe44`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1088 pass / 8 fail (1096 across 104 files, 60s) — the 8 being
  the same pre-existing `MarkdownPaneImpl` failures, verified unchanged by name against
  the Task 12 list. Working tree clean.

## Decisions taken (Task 13 round 1)

- Wide-character support is implemented with a local range table in `render/text.ts`
  rather than xterm's unicode service, which `@xterm/headless` does not expose publicly.
  Session panes keep taking their widths from xterm via `term/blit.ts`; the table only
  covers chrome the TUI draws itself.
- Grapheme segmentation uses `Intl.Segmenter`, which Bun provides. Combining marks ride
  in their base character's cell; a leading lone mark is dropped.
- Control characters in a label are drawn as a blank. Not a review finding, but the same
  frame-corruption class the fix addresses, and one branch in `layoutText`.

- **Task 13, round 2** (gpt-5.5 via codex-review, Mode B over `e64f1f0..bf998d3`
  scoped to `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`,
  `packages/tui/src/render/text.ts` and `text.test.ts`, diff inlined in the prompt):
  one finding, substantiated and fixed in `bbb7a98`, plus one point explicitly filed
  as speculative by Codex and not fixed. Run the repro with
  `bun test packages/tui/src/render/text.test.ts`.

  - **Substantiated — a CRLF in a label was written to the terminal raw.**
    `CONTROL` was `/^[\p{Cc}]$/u`, anchored around a single code point, but
    `Intl.Segmenter` keeps `"\r\n"` as one grapheme, so the cluster failed the
    control test and was stored as a printable width-1 cell. `Screen.flush`
    (`packages/tui/src/render/screen.ts:68`) emits `cell.ch` for every cell whose
    width is not zero, so the raw sequence carried the cursor to column 0 of the
    next line in the middle of a frame and everything after it landed in the wrong
    place. Verified before the fix by calling the functions directly:
    `layoutText("a\r\nb", 4, 0)` gave cells `"a" "\r\n" "b" " "`, and
    `drawSidebar` with label `"A\r\nB"` left `buf.get(1, 0).ch === "\r\n"`.
    Fix: `CONTROL` is now unanchored (`/\p{Cc}/u`), so any cluster carrying a
    control code point is blanked. Regression test:
    `layoutText > blanks a control sequence the segmenter kept as one grapheme`
    — red on `bf998d3`, green on `bbb7a98`.
  - **Speculative, not fixed — emoji-cluster width for flags, keycaps and
    variation-selector emoji.** Codex filed this itself as terminal-policy
    dependent rather than a defect. Independently reproduced: `layoutText` gives
    width 1 to `🇺🇸`, `❤️`, `1️⃣` and `🏳️‍🌈` while giving width 2 to `👨‍👩‍👧`, `👍🏽`
    and `你`. See the decision below for why it stays as is.
  - Independent checks that found nothing: `WIDE_RANGES` verified sorted,
    non-overlapping and `lo <= hi` across all 85 entries (so the linear
    short-circuit scan in `isWide` is sound); every code point `U+0020..U+2FFFF`
    cross-checked against the repo's `eastasianwidth` data, with the only
    under-counts being 89 Hangul-jamo code points that package's Unicode-8 tables
    call Wide and that terminals draw as combining; `drawSidebar` budget
    arithmetic probed at `width` 0/1/2 and with a four-digit `sessionCount`, which
    stays within the pane (a badge that cannot fit is dropped, never overflowed).

- Validation at `bbb7a98`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1089 pass / 8 fail (1097 across 104 files, 59s) —
  the 8 being the same pre-existing `MarkdownPaneImpl` failures, verified unchanged
  by name against the round-1 list. Working tree clean.

## Decisions taken (Task 13 round 2)

- Emoji-presentation clusters (regional-indicator flags, keycaps, VS16 sequences)
  keep width 1. That matches what `@xterm/headless` reports for the same clusters,
  and session panes already take their widths from xterm via `term/blit.ts`; making
  the chrome disagree with the panes would trade one shear for another. Revisit only
  if the TUI adopts a full grapheme-width service for both paths.

- **Task 13, round 3** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD`
  scoped to `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`,
  `packages/tui/src/render/text.ts` and `text.test.ts`, diff inlined in the prompt):
  two findings, one substantiated and fixed in `66b4357`, one refuted. Run the repro
  with `bun test packages/tui/src/render/text.test.ts`.

  - **Substantiated — an unpaired surrogate was drawn as mojibake.** `layoutText`
    blanked only `\p{Cc}`, so a lone high or low surrogate in a label passed the
    printable branch and was stored as a width-1 cell holding half a pair.
    `Screen.flush` (`packages/tui/src/render/screen.ts:68`) writes `cell.ch` for
    every cell whose width is not zero, and UTF-8 encoding a half pair on the way
    to the stream yields `ef bf bd` — U+FFFD — so the frame shows a replacement
    glyph where a blank belongs. Verified before the fix by calling the function
    directly: `layoutText("a\uD83Db", 4, 0)` gave cells `"a" "\ud83d" "b" " "`, and
    `Buffer.from("\uD83D", "utf8").toString("hex")` gave `efbfbd`. This is the same
    class round 1 fixed for split astral glyphs; the split is gone, but a label that
    already contains a lone surrogate (JSON can carry one through a `\ud83d` escape)
    still reached a cell. Fix: `CONTROL` became `UNPRINTABLE = /[\p{Cc}\p{Cs}]/u`.
    Under the `u` flag `\p{Cs}` matches only unpaired surrogates — a well-formed
    pair is a single astral code point and does not match — verified directly
    against `"\ud83d"`, `"\ude80"`, `"🚀"`, `"你"`, `"❤️"` and `"\r\n"`. Regression
    tests: `layoutText > blanks an unpaired surrogate` (red on `7b68091`, green on
    `66b4357`) and `layoutText > keeps a well-formed surrogate pair as one wide
    glyph`, which pins that the new rule does not over-blank.
  - **Refuted — project rows get a session badge.** Codex reported that the badge
    condition ignores `row.kind`, so a project with sessions renders `"Alpha 2"`.
    Reproduced (`drawSidebar` with a project row and `sessionCount: 2` gives
    `"Alpha 2     "`), but this is the specified behaviour, not a defect: the plan's
    own reference implementation at line 3562 is
    `const badge = row && row.sessionCount > 0 ? ...`, kind-agnostic, and `buildRows`
    deliberately fills `sessionCount` from `project.sessions.length` for project
    rows. Projects carry their own sessions in the Taskflow model, so the badge is
    meaningful there. Codex flagged it only because the review prompt paraphrased
    the behaviour as "a task row with sessions gets a badge" — that paraphrase was
    wrong, the code is right. No change.
  - Codex independently ran `bun test packages/tui/src/render/text.test.ts
    packages/tui/src/ui/sidebar.test.ts` (29 pass at `7b68091`).

- Validation at `66b4357`: `bun run lint` exit 0, `bun run typecheck` exit 0 across
  all five packages, `bun test` 1091 pass / 8 fail (1099 across 104 files, 59s) —
  the 8 being the same pre-existing `MarkdownPaneImpl` failures, verified unchanged
  by name against the round-2 list. Working tree clean.

## Decisions taken (Task 13 round 3)

- The review prompt for round 4 must describe the badge rule as the plan states it
  (any row with `sessionCount > 0`), not "task rows only". The wrong paraphrase in
  the round-3 prompt manufactured a finding.

- **Task 13, round 4** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD`
  scoped to `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`,
  `packages/tui/src/render/text.ts` and `text.test.ts`, diff inlined in the prompt,
  with the badge rule stated as the plan states it and rounds 1-3 listed as already
  fixed): one finding, substantiated and fixed in `9816700`. Run the repros with
  `bun test packages/tui/src/render/text.test.ts packages/tui/src/ui/sidebar.test.ts`.

  - **Substantiated — a label's leading combining mark repainted the indent space.**
    `fitToWidth` kept a standalone zero-width cluster because `used + 0 > cols` is
    false even when `cols` is 0, so `fitToWidth("\u0301A", 0)` returned `"\u0301"`.
    `drawSidebar` concatenates that result after the two-space task indent, and
    `Intl.Segmenter` then re-attaches the mark to the second indent space, so
    `layoutText` stored `" \u0301"` as one printable width-1 cell.
    `Screen.flush` (`packages/tui/src/render/screen.ts:68`) writes `cell.ch` for every
    cell whose width is not zero, so the sidebar drew an accent over its own
    indentation for a label that had no display budget at all. Verified before the fix
    by calling both functions directly: `fitToWidth("\u0301A", 0)` gave `"\u0301"`,
    and `drawSidebar` at `width` 4 with label `"\u0301A"` and `sessionCount` 1 gave
    the row `"  \u0301 1"` instead of `"   1"`. Not limited to `cols === 0`: at
    `cols` 1, `fitToWidth("\u0301A", 1)` returned `"\u0301A"`, which shifts the same
    accent onto the indent.
    Fix: `fitToWidth` now skips any grapheme of width 0, which is exactly what
    `layoutText` already did (`if (width === 0) continue`), so the string `fitToWidth`
    returns lays out to the width it counted and carries no mark that could bind to a
    caller's prefix. Regression tests: `fitToWidth > drops a standalone zero-width
    cluster with no base to ride on` and `drawSidebar > does not let a leading
    combining mark ride on the task indentation` — both red on `92ab831`, green on
    `9816700`.
  - Codex reported no other defects in scope, and independently ran
    `bun test packages/tui/src/render/text.test.ts packages/tui/src/ui/sidebar.test.ts`
    (31 pass at `92ab831`), `bun run typecheck` in `packages/tui`, and `eslint` over
    the four files, all clean.
  - Independent checks that found nothing: `layoutText` probed at `cols` 0 and -1, with
    a ZWJ family cluster, a wide glyph exactly filling the row, a wide glyph straddling
    the last column, a tab, and non-zero `attrs` propagation — all correct.
    `drawSidebar` probed at `width` 0/1/2/3/4, with a negative `selected`, with a wide
    label plus badge, and with a project row — all within the pane. `WIDE_RANGES`
    re-verified sorted, non-overlapping and `lo <= hi` across all 85 entries.
  - Considered and not filed: a `sessionCount` of six or more digits at `width` 8 leaves
    `available` negative, and the badge is then clipped mid-number (`123456` draws as
    `12345`). The plan's own reference implementation clips the same way
    (`buf.set(x, y, styled(text[x] ?? " ", attrs))` over `x < width`, plan line 3566),
    so this is specified behaviour at a width no real sidebar uses, not a defect.

- Validation at `9816700`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1093 pass / 8 fail (1101 across 104 files, 59s) — the 8 being
  the same pre-existing `MarkdownPaneImpl` failures, verified unchanged by name against
  the round-3 list, and the pass count up by exactly the two new tests. Working tree clean.

## Decisions taken (Task 13 round 4)

- `fitToWidth` and `layoutText` now share one rule for standalone zero-width clusters:
  both drop them. The alternative — having `drawSidebar` lay out the prefix, label and
  badge as separate segment runs instead of concatenating them — would stop the
  segmenter from binding across the seams generally, but it is a larger change to a
  module three other tasks will consume, and no other seam in the current code can carry
  a baseless mark. Revisit if a future caller concatenates user text on both sides of a
  fitted string.

## Task 13 — review round 5

- Reviewer: gpt-5.5 via the codex-review skill (Mode B, prompted), diff `e64f1f0..HEAD`
  scoped to `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`,
  `packages/tui/src/render/text.ts` and `text.test.ts`, with rounds 1-4 listed as
  already fixed. Two findings, both against `WIDE_RANGES`; both substantiated.

- **Substantiated — the wide table missed 208 East Asian Wide code points.**
  `WIDE_RANGES` was hand-written and had no entry for U+2630..U+2637 (trigrams),
  U+268A..U+268F (monograms and digrams), U+4DC0..U+4DFF (hexagrams), U+16FF0..U+16FF1,
  U+1AFF0..U+1AFFE (Kana Extended-B), U+1D300..U+1D356 (Tai Xuan Jing), U+1D360..U+1D376
  (counting rods), U+1F6DC..U+1F6DF or U+1F7F0. `isWide` returned false for all of them,
  so `graphemeWidth` counted one column where the terminal advances two: the sidebar drew
  a width-1 cell, every glyph after it landed one column left of where the layout thought
  it was, and the row ran one column past the pane into the session area. Verified before
  the fix: `fitToWidth("\u2630x", 2)` returned `"\u2630x"` (two graphemes budgeted into
  two columns when the first alone needs two), and `drawSidebar` at `width` 6 with label
  `"\u2630A"` put `"\u2630"` in cell 0 with `width` 1 and `"A"` in cell 1 instead of
  cell 2.
- **Substantiated — the table forced eight ambiguous-width code points wide.**
  The broad `[0x3041, 0x33ff]` entry swallowed U+3248..U+324F (CIRCLED NUMBER TEN ON
  BLACK SQUARE and its seven neighbours), which are East Asian *Ambiguous*, not Wide; a
  terminal draws them in one column unless told the text is East Asian. Verified before
  the fix: `fitToWidth("\u3248x", 2)` returned `"\u3248"`, dropping a character that
  fits, and `layoutText("\u3248x", 3, 0)` emitted a width-2 cell plus a width-0
  continuation, so the row was laid out one column short of what the terminal renders.
- Fix for both: `WIDE_RANGES` regenerated from `unicodedata.east_asian_width` for
  Unicode 16.0 as exactly the `W` and `F` code points — 122 ranges replacing 85. Verified
  after the fix by re-running the comparison against the generated Unicode 16 range list:
  0 code points wide in Unicode but narrow in the table, 0 wide in the table but not
  `W`/`F` in Unicode, and the sorted / non-overlapping / `lo <= hi` invariants `isWide`
  depends on still hold across all 122 entries.
  U+3099 and U+309A are `Mn` with East Asian Width `W` and are now inside
  `[0x3099, 0x30ff]`, but `graphemeWidth` tests `ZERO_WIDTH` before `isWide`, so they
  still measure zero.
  Regression tests: `fitToWidth > counts every East Asian Wide character as two columns,
  not just the CJK blocks` (one sample per newly-added range outside the ideograph
  blocks), `fitToWidth > leaves an ambiguous-width character narrow`, and
  `drawSidebar > reserves two cells for a wide symbol outside the CJK blocks` — all three
  red on `00db2d7`, green on `ce2d6e8`.
- Codex independently re-ran `bun test packages/tui/src/ui/sidebar.test.ts
  packages/tui/src/render/text.test.ts` (33 pass at `00db2d7`) and `git diff --check`,
  and reported no other defects: it checked `drawSidebar` row selection, padding, badges,
  small widths and heights, `buildRows`, `Screen.flush` width-0 behaviour, table ordering
  and overlap, and the banned-pattern rules.
- Independent checks that found nothing: laid-out cell count and width sum equal `cols`
  for CJK text, a regional-indicator flag, a ZWJ family, a leading combining mark, a tab
  and an astral emoji at `cols` 0/1/2/3/5/8; `fitToWidth` output never exceeds its budget
  for the same inputs; `drawSidebar` probed at `width` 0 through 6 with a wide label and a
  two-digit badge, with `selected` negative, and with a project row carrying a badge
  (project badges render, as the plan specifies). `store.tasksFor` confirmed to filter on
  `status === "active"`, matching the plan's wording.
- Noted, not filed: `drawSidebar` has no test for a badge on a *project* row even though
  the plan specifies badges on any row with `sessionCount > 0`. Behaviour verified correct
  by hand (`"Alpha 2"` at `width` 20), so this is a coverage gap rather than a defect.

- Validation at `ce2d6e8`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1096 pass / 8 fail (1104 across 104 files, 59s) — the 8 being
  the same pre-existing `MarkdownPaneImpl` failures, verified unchanged by name against
  the round-4 list, and the pass count up by exactly the three new tests. Working tree
  clean.

## Decisions taken (Task 13 round 5)

- `WIDE_RANGES` is now generated rather than curated, and its doc comment says so. Codex
  filed two entries; hand-patching them would have left the other 200 missing code points
  in place, and the module's stated intent was already "the East Asian Wide and Fullwidth
  blocks", so regenerating from the Unicode 16 data makes the table correct by
  construction instead of correct by inspection.
- The regenerated table drops 419 *unassigned* code points that the old block-shaped
  ranges covered (inside Tangut, Nushu and Kana Supplement). Unicode's own default for
  those is Narrow, and the five blocks whose default *is* Wide — U+3400..U+4DBF,
  U+4E00..U+9FFF, U+F900..U+FAFF, U+20000..U+2FFFD, U+30000..U+3FFFD — are still covered
  whole. Nothing renders at an unassigned code point, so this is not observable.

## Task 13 — review round 6

- Reviewer: gpt-5.5 via the codex-review skill (Mode B, prompted), current files at
  `d1ab541` — `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`,
  `packages/tui/src/render/text.ts` and `text.test.ts` — with the cumulative diff
  `e64f1f0..d1ab541` available and rounds 1-5 listed as already fixed, including that
  `WIDE_RANGES` is generated from Unicode 16.0 East Asian Width `W`/`F`. Two findings,
  both substantiated and fixed in `b9461ff`.

- **Substantiated — a cluster wider than its base measured one column.**
  `graphemeWidth` took the whole grapheme's width from `codePointAt(0)`, so three shapes
  that a terminal advances two columns for measured one: an emoji presentation sequence
  (U+26A0 U+FE0F and friends, whose base is East Asian Neutral until U+FE0F promotes it),
  a keycap (U+0031 U+FE0F U+20E3), and a flag (a pair of regional indicators, neither of
  which is `W`/`F` on its own). The sidebar drew a width-1 cell, every glyph after it
  landed a column left of where the layout thought it was, and the row ran one column past
  the pane into the session area — the same symptom as round 5, by a different mechanism.
  Verified before the fix: `layoutText("\u{1F1FA}\u{1F1F8}", 1, 0)` returned
  `[{ ch: "🇺🇸", width: 1 }]` instead of clipping to a blank, and `layoutText("\u26a0\ufe0fx", 3, 0)`
  returned `["⚠️", "x", " "]` at width 1 each instead of a width-2 cell plus a
  continuation.
- **Substantiated — a clipped badge showed a smaller session count than the row had.**
  `drawSidebar` computed `available = width - prefix.length - badge.length`, built
  `prefix + fitToWidth(label) + badge`, and handed the result to `layoutText`, which clips
  from the right. So the badge — the thing the arithmetic had just reserved room for — was
  the first thing lost whenever `prefix.length + badge.length` exceeded `width`.
  Verified before the fix at `width` 3..6 for a task labelled `"A"` with `sessionCount`
  12: width 3 drew `"   "` (badge gone), width 4 drew `"   1"` — a row that reads as **one**
  session for a task with twelve — width 5 drew `"   12"`, width 6 drew `"  A 12"`.
  The truncated-count case is worse than codex's framing of a hidden badge: the row is not
  merely incomplete, it is wrong.
- Fixes: `graphemeWidth` now returns 2 for a cluster containing U+FE0F or based on a
  regional indicator, after the `ZERO_WIDTH` and `isWide` tests so a lone U+FE0F still
  measures zero; the doc comment records that an ambiguous cluster errs wide because
  guessing narrow is what spills. `drawSidebar` gives the badge its columns before the row
  indent (`badgeCols` first, then `indent` only if it still fits) and drops the badge whole
  when even that leaves no room, so a rendered count is always the real one.
- Regression tests, all red on `d1ab541` and green on `b9461ff` — run with
  `bun test packages/tui/src/ui/sidebar.test.ts packages/tui/src/render/text.test.ts`:
  `fitToWidth > counts an emoji presentation sequence as two columns` (which also pins the
  bare U+26A0 narrow), `> counts a flag as two columns`, `> counts a keycap sequence as two
  columns`, `layoutText > gives an emoji presentation sequence a width-2 cell`,
  `> clips a flag that would straddle the last column`, `drawSidebar > never draws a
  session count clipped to a smaller number`, `> drops a badge that cannot fit rather than
  drawing a wrong count`, and `> reserves two cells for an emoji presentation sequence in a
  label`.
- Independent cross-check of the new width rule against `string-width@7.2.0` (the reference
  implementation behind ora/boxen, installed in a scratch dir, never added to the repo) over
  27 samples — ASCII, CJK, fullwidth, ideographic space, astral emoji, ZWJ family, skin-tone
  modifier, tag-sequence flag 🏴󠁧󠁢󠁳󠁣󠁴󠁿, RI flag, keycap, VS16 sequences, combining marks,
  East Asian Ambiguous. Three divergences, all the same class and all deliberate: bare
  U+26A0, U+2764 and U+2611 with no variation selector, which `string-width` widens via
  `emoji-regex` regardless of presentation but Unicode 16 gives East Asian Width Neutral.
  This table is EAW-based by the round-5 decision, so those stay narrow. Everything else
  agrees.
- Codex also reported checking negative and out-of-range `selected`, `height > rows.length`,
  padding redraw, `width <= 0`, wide-glyph clipping at the last column and stale width-0
  continuations, and found no defects there.

- Validation at `b9461ff`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all five
  packages, `bun test` 1104 pass / 8 fail (1112 across 104 files, 59s). Baseline established
  by stashing the change and running the full suite at `d1ab541`: 1096 pass / 8 fail with
  the *same eight* failing test names, so the pass count is up by exactly the eight new
  tests and nothing regressed. The eight are the pre-existing `MarkdownPaneImpl` failures —
  confirmed to be a cross-file isolation problem, not a real defect in that code: running
  `bun test packages/ui/src/components/panes/` alone gives 8 pass / 0 fail. Working tree
  clean.

## Decisions taken (Task 13 round 6)

- An emoji cluster whose true width is uncertain is counted **wide**. Over-reserving costs
  a blank column inside the pane; under-reserving lets the row spill into the session pane,
  which is the failure the last two rounds have both been about.
- The badge outranks the row indent for columns, and is all-or-nothing. A task title
  truncated at a narrow width is expected; a session count truncated at a narrow width is a
  lie, and there is no width at which showing part of a number is better than showing none.
- The three bare default-text-presentation emoji where `string-width` disagrees are left
  narrow rather than chasing parity with `emoji-regex`. The table's contract, set in round 5,
  is Unicode 16 East Asian Width; adopting emoji-presentation-by-default would reopen it.

- **Task 13, round 7** (gpt-5.5 via codex-review, Mode B over the four scoped files at
  `6534c1b`, with rounds 1-6 listed as already fixed): codex's **final report said
  `Clear`**, but its own run log shows it reproducing a real defect mid-run and then
  dropping it from the write-up. Verified independently before reading the report at all;
  one substantiated finding, fixed in `78fc4fd`.
- **Substantiated — a label's leading spacing mark repainted the sidebar's indent.**
  Round 4 taught `fitToWidth` and `layoutText` to drop a baseless combining mark, but the
  `ZERO_WIDTH` regex only covered `Mn`, `Me` and `Cf`. `Mc` spacing marks — Devanagari,
  Bengali, Oriya, Balinese vowel signs — are not zero-width, so they slipped through, and
  `Mc` binds to the cluster *in front* of it. Verified before the fix: a task labelled
  `"\u093eA"` at width 8 drew cells
  `[" ", " \u093e", "A", " ", ...]` — cell **1**, the second space of the two-space task
  indent, carried the label's vowel sign. The already-fixed `Mn` case at the same width
  drew `[" ", " ", "A", ...]`, which is what this should have done.
- Fix: `ZERO_WIDTH` renamed to `NO_BASE` (accurate: `Mc` is not zero-width) and widened to
  `/^[\p{Mn}\p{Me}\p{Mc}\p{Cf}]$/u`. `graphemeWidth` only ever tests a cluster's first
  code point, so a mark reaches that test exactly when the segmenter had no base to attach
  it to; inside a normal cluster it still rides along in its base's cell, which
  `layoutText > keeps a spacing mark in the cell of the base it belongs to` pins.
- Fallout handled: exactly four East Asian Wide code points are also `Mc` — U+302E, U+302F,
  U+16FF0, U+16FF1 — enumerated by scanning every code point in `WIDE_RANGES`. All four
  re-attach to a preceding space, so all four are now dropped when baseless. That broke the
  round-5 per-wide-range sample test, whose only sample for `0x16ff0..0x16ff1` was
  baseless; `0x16ff0..0x16ff1` is the one wide range with no non-mark member, so the sample
  list drops it and a dedicated test covers those four instead.
- Regression tests, all red on `6534c1b` and green on `78fc4fd` — run with
  `bun test packages/tui/src/render/text.test.ts packages/tui/src/ui/sidebar.test.ts`:
  `fitToWidth > drops a standalone spacing mark, which also has no base to ride on`,
  `> drops a baseless spacing mark even where the width table calls it wide`,
  `layoutText > drops a baseless spacing mark instead of giving it a cell`,
  `> keeps a spacing mark in the cell of the base it belongs to` (green both before and
  after — it pins the behaviour the fix must not change), and
  `drawSidebar > does not let a leading spacing mark ride on the task indentation`.
- Known limit recorded in `graphemeWidth`'s doc rather than fixed: those same four wide
  `Mc` code points, when they *do* have a base, make the cluster advance three columns
  where `graphemeWidth` returns 2. A cell holds at most two columns, so counting it
  honestly is not expressible in the current cell model. Left as-is deliberately.
- Codex also probed and found nothing in: negative and tiny widths, badge/indent
  allocation arithmetic, wide-glyph clipping, segmenter seams before the badge, the
  `WIDE_RANGES` ordering assumption, and `layoutText`'s length invariant. Independently
  confirmed here too — `WIDE_RANGES` is sorted and non-overlapping across all 122 entries,
  and `layoutText` returns exactly `cols` cells for every sample tried at `cols` 0..6.

- Validation at `78fc4fd`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all
  five packages, `bun test` 1109 pass / 8 fail (1117 across 104 files, 61s). The eight are
  the same pre-existing `MarkdownPaneImpl` cross-file isolation failures as every prior
  round, by name; the pass count is up by exactly the five new tests. Working tree clean.

## Decisions taken (Task 13 round 7)

- A baseless mark is dropped **regardless of its width**. The four wide `Mc` code points
  are no exception: being wide does not stop them binding to the caller's padding, which is
  the whole failure. Consistency with the round-4 rule beats preserving two columns for a
  Vietnamese tone mark that had nothing to sit on.
- `ZERO_WIDTH` renamed to `NO_BASE`. The regex is tested against a cluster's base, not the
  cluster, so its real job was always "cannot begin a visible cluster"; keeping the old name
  after adding `Mc` would have made it a lie.
- A cluster whose *mark* is wide is left under-counted rather than restructuring the cell
  model to hold three columns. Recorded as a known limit in the code, not silently ignored.
- Codex's `Clear` verdict was overridden on the strength of an independent repro. The round
  counts as findings-fixed, so another round is due.

- **Task 13, round 8** (gpt-5.5 via codex-review, Mode B over the four scoped files at
  `c8a8158`, with rounds 1-7 listed as already-settled rules the reviewer was told not to
  re-report): one finding, substantiated and fixed in `3f1511d`. Found here independently
  from codex's run log before its report landed, and reproduced before reading the write-up;
  codex's final report names the same defect and nothing else.
- **Substantiated — a title beginning with a forward-binding format character lost its
  text.** `graphemeWidth` read only `grapheme.codePointAt(0)` and dropped the whole cluster
  when that code point matched `NO_BASE`. The round-4/7 justification for that — "a mark
  reaches this test exactly when the segmenter had no base to attach it to" — is false for
  `Cf` characters whose grapheme-cluster break is `Prepend`: U+0600..U+0605, U+06DD, U+070F,
  U+0890..U+0891, U+08E2, U+110BD, U+110CD and the rest bind to what *follows* them, so the
  segmenter hands them back leading a cluster whose real base sits behind them.
  Verified before the fix, at `c8a8158`: a task titled `"\u0600\u0661\u0662\u0663"`
  (Arabic number sign + ١٢٣) drew the row `"  \u0662\u0663"` — the first digit gone;
  `"\u0600A"` drew an entirely blank row; `fitToWidth("\u0600A", 6)` returned `""`, and
  `layoutText("\u0600A", 6, 0)` returned six blanks. Same for U+06DD and U+070F.
- Fix: a new `baseCodePoint` helper scans the cluster for the first code point that is not
  `NO_BASE` and returns it; `graphemeWidth` drops the cluster only when there is none.
  The baseless rule is untouched — `Mn`/`Me`/`Mc` bind backwards, so a mark can only lead a
  cluster the segmenter had nothing to attach it to, and such a cluster has no non-`NO_BASE`
  code point for the scan to find. Confirmed by segmenting the round-7 cases: `"\u093eA"`
  is still two clusters, and `"  \u0600A"` still segments as `[" ", " ", "\u0600A"]`, so the
  kept prepend cannot bleed onto a caller's padding either.
- Regression tests, all red on `c8a8158` and green on `3f1511d` — run with
  `bun test packages/tui/src/render/text.test.ts packages/tui/src/ui/sidebar.test.ts`:
  `fitToWidth > keeps the printable base behind a format character that binds forwards`,
  `layoutText > gives the base behind a forward-binding format character its own cell`,
  `> measures a forward-binding format character by the base behind it` (pins that the base,
  not the prepend, decides the width — `"\u0600\u6f22"` still costs two columns), and
  `drawSidebar > draws a title that begins with a format character binding forwards`.
  A fifth test, `fitToWidth > still drops a cluster that is only marks and format
  characters`, is green both before and after: it pins the baseless rule the fix must not
  reopen.
- Probed independently here and found nothing: `layoutText`'s exactly-`cols` invariant and
  its width-sum invariant over 26 hostile cluster shapes at `cols` 0..8 (0 failures);
  `drawSidebar` spilling past `width` into a sentinel-filled pane, over every combination of
  those 26 labels x session counts 0/1/9/10/100/1000 x project/task x `width` 0..12 (0
  spills, 0 truncated badges); `available` going negative (it cannot — `indent` is only kept
  when `indent.length + badgeCols <= width`, and `badgeCols` is 0 or `<= width`); indent
  bleed from `fitToWidth`'s result being concatenated behind two spaces (0 cases).
- Codex also probed and found nothing in: badge/indent arithmetic at widths 0-2, multi-digit
  counts, out-of-range `selected`, padding-row attributes, the `cells[x] !== undefined`
  guard, and the two test files' assertion strength. It ran the two scoped test files itself
  (49 pass / 0 fail at `c8a8158`).

- Validation at `3f1511d`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all five
  packages, `bun test` 1114 pass / 8 fail (1122 across 104 files, 59s). The eight are the
  same pre-existing `MarkdownPaneImpl` cross-file isolation failures as every prior round,
  by name; the pass count is up by exactly the five new tests. Working tree clean.

## Decisions taken (Task 13 round 8)

- A cluster is dropped for having no base, not for *starting* with a mark. `NO_BASE` keeps
  its name and its member set; what changed is that it is now applied to every code point in
  the cluster until one fails to match, rather than to the first alone. That is the smallest
  change that fixes `Prepend` without touching any round-4/7 behaviour.
- A kept prepend stays in the cell with its base (`ch` is `"\u0600A"`, width 1) rather than
  being stripped. It is invisible, the terminal ignores it, and keeping the label's bytes
  intact means a copy out of the frame still round-trips.
- The width is taken from the base behind the prepend, not from the prepend. Prepend `Cf`
  characters are all East Asian Neutral, so this only matters for a wide base — where taking
  the prepend's width would under-reserve and let the row spill, the exact failure mode
  rounds 5-7 were about.

- **Task 13, round 9** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD` scoped to the
  four files, with rounds 1-8's settled rules given as do-not-relitigate and the round steered
  at `sidebar.ts`/`buildRows`/test strength): codex reported **no blocking code findings** and
  two non-blocking test weaknesses. Verifying the first of those uncovered a real defect in
  `drawSidebar`, which then uncovered a second in `fitToWidth`. All fixed in `39d9e43`.
  Run the repros with `bun test packages/tui/src/ui/sidebar.test.ts packages/tui/src/render/text.test.ts`.
  - **Substantiated (found while verifying) — the indent starved the label.** `indent` was
    kept whenever `prefix.length + badgeCols <= width`, which let it take every column the
    label had left. Observable symptom: a task row showed *less* as the pane grew — traced
    with a task labelled `A` and 12 sessions, width 4 drew `A 12` and width 5 drew `   12`;
    a task labelled `Ab` with no badge drew `A` at width 1 and a blank row at width 2. Fixed
    by ranking the indent below the label and dropping it whenever keeping it would leave the
    label nothing to show. Regression tests: `drawSidebar > never spends the last column on
    indentation instead of the label`, `> keeps a task label rather than a bare indent in a
    two-column pane`.
  - **Substantiated — the first fix was partial.** `prefix.length + badgeCols < width` still
    starved a wide first glyph: one column survived the indent and `漢字` needs two, so width 3
    drew `   ` where width 2 drew `漢`. Fixed by deciding the indent on whether the label
    actually fits, not on a column count. Regression test: `drawSidebar > drops the indent when
    the column it leaves cannot hold a wide glyph`.
  - **Substantiated — `fitToWidth` spent a column on a cluster that renders blank.**
    `layoutText` draws an unprintable cluster as a space, but `fitToWidth` counted it as a
    column, so a non-empty fit result was not a promise that anything would show. A task
    labelled `"\r\nA"` with one session drew `    1` at width 5 — the `A` displaced by the
    blanked CRLF — while width 4 drew ` A 1`. Fixed by dropping unprintable clusters at fit
    time, exactly as baseless ones already are. Regression tests: `fitToWidth > drops an
    unprintable cluster instead of spending a column on it`, `drawSidebar > does not spend the
    label's columns on a control character`.
  - **Substantiated (codex, test-strength) — a dropped badge was asserted only as an absence.**
    `drawSidebar > drops a badge that cannot fit` asserted `not.toContain("1")`, which a
    mutation blanking the whole row also passes. Verified by applying that mutation: 21 pass /
    0 fail. Strengthened to assert the row whole.
  - **Substantiated (codex, test-strength) — project session counts were untested.** Mutating
    `buildRows` to set project `sessionCount: 0` kept the suite green (21 pass / 0 fail), so
    project rows could have lost their badge silently. Added `buildRows > carries the session
    count on project rows too` and `drawSidebar > draws the session count badge on a project row`.
  - The old round-4 test `drawSidebar > does not let a leading combining mark ride on the task
    indentation` was written around width 4, where the indent plus badge left the label a
    zero budget — a coincidence the fix removes. Rewritten at width 6 to assert the indent
    cell directly, the same shape as its `Mc` sibling, so it now guards the invariant rather
    than the arithmetic that happened to expose it.
  - Probed independently here and found nothing further: no spill past `width` and every row
    measuring exactly `width`, over 22 hostile labels x project/task x session counts
    0/1/9/10/100/1000 x `width` 0..14 (0 failures); badge truthfulness over the same grid;
    and "a label is never blanked while the pane has room for it" over 22 labels x 2 kinds x
    4 counts x `width` 0..20, which is what caught the wide-glyph and control-character cases
    above and is clean after the fix.
  - Mutation-tested both suites before the fixes: 6 mutations of `sidebar.ts` (badge never
    dropped, indent always kept, badge always shown, padding rows selectable, no task indent,
    no bold) and 8 of `text.ts` (ignore U+FE0F, flags narrow, pre-round-8 first-code-point
    base, baseless cluster kept, no unprintable blanking, `Mc`/`Cf` out of `NO_BASE`, wide
    glyph allowed to straddle) — all 14 caught. The only gaps were the two codex named.

- Validation at `39d9e43`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all five
  packages, `bun test` 1121 pass / 8 fail (1129 across 104 files, 72s). The eight are the same
  pre-existing `MarkdownPaneImpl` cross-file isolation failures as every prior round, by name;
  the pass count is up by exactly the seven new tests. Working tree clean apart from an
  unrelated edit to `docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md` that predates
  this session.

## Decisions taken (Task 13 round 9)

- Precedence inside a sidebar row is badge > label > indent. The badge was already first
  (round 6: a clipped count lies). The label now outranks the indent because the indent is
  decoration and the label is the content — without that ordering a wider pane could show
  less, which is the defect this round fixed.
- The indent is decided by whether the label actually fits beside it, not by a column count.
  `drawSidebar` fits the label both ways and keeps the indent only when the indented fit is
  non-empty, or when the label would be empty either way. Two extra `fitToWidth` calls per row
  is cheap next to a rule that cannot predict a wide first glyph.
- `fitToWidth` now drops unprintable clusters; `layoutText` still blanks them. That is not a
  contradiction: dropping at fit time keeps the fit result an honest promise of what will
  show, and `layoutText`'s blanking stays as the safety net for callers that do not pre-fit,
  which is what preserves its exactly-`cols` contract for arbitrary input.
- A test-only weakness with no matching code defect would not by itself have justified a
  round 10. It did not come to that: verifying the first weakness turned up real defects, so
  round 10 is due on the ordinary rule that findings were fixed.

- **Task 13, round 10** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD` scoped to the
  four files, with rounds 1-9's settled rules given as do-not-relitigate and the round steered
  at the round-9 indent decision and at `fitToWidth` dropping unprintable clusters): codex
  reported **one blocking finding** and two test-strength gaps. Probing around the indent
  decision here — which codex cleared — turned up a second real defect it missed. Both fixed
  in `da3006a`. Run the repros with
  `bun test packages/tui/src/ui/sidebar.test.ts packages/tui/src/render/text.test.ts`.
  - **Substantiated (codex) — `fitToWidth` reserved columns for a pair that joins.** It
    measured each cluster as it read it, but dropping a cluster leaves the two around it
    adjacent and the segmenter can read that pair as one. The two halves of a flag measure two
    columns each while a control byte sits between them and two columns once it is gone, so
    the fit spent four columns on a two-column glyph and hid what followed. Observable symptom:
    a project labelled `U+1F1FA <BEL> U+1F1F8 AB` drew `<flag>` and two blanks in a four-column
    pane, where the same label without the control byte drew `<flag>AB`. Fixed by re-measuring
    the accumulated string whenever something has been dropped since the last kept cluster, so
    the running total is what the row will lay out. Regression test: `fitToWidth > does not lose
    text when dropping a cluster joins the two around it`.
  - **Substantiated (found here, codex cleared this area) — a label that fits only as blanks
    took the row.** `keepIndent` asked whether `fitToWidth` returned characters, not whether
    those characters show. A title that starts with a space fits in one column *as* a space —
    a non-empty string that draws as nothing — so the indent was kept and the row went blank.
    Observable symptom: a task titled ` A` with no sessions read ` A` in a two-column pane and
    drew an empty row in a three-column one; with one session it read ` A 1` at width 4 and
    `    1` at width 5. Fixed with a `shows()` helper that ranks the indent below what the label
    will actually display. Regression tests: `drawSidebar > drops the indent when the label fits
    beside it as nothing but blanks`, `> keeps a blank-fitting label visible beside its badge too`.
  - **Substantiated (codex, test-strength) — the badge's exact-fit boundary was untested.**
    Mutating `badge.length <= width` to `badge.length < width` kept both suites green. Added
    `drawSidebar > draws the whole badge when it exactly fills the pane` (label `A`, task, 12
    sessions, width 3, expecting ` 12`); the mutation now fails 1.
  - **Substantiated (codex, test-strength) — only leading unprintables were covered.** Mutating
    `fitToWidth` to drop an unprintable cluster only while the output is still empty kept both
    suites green. Added a mid-string case to `fitToWidth > drops an unprintable cluster instead
    of spending a column on it`; the mutation now fails 2.
  - **Found while mutation-testing the fix — the re-measure was not pinned to columns.**
    Replacing `textWidth`'s body with a code-point count survived, because every tested rejoin
    happened to have as many code points as columns. Added the wide-character case
    (`U+6F22 <BEL> U+6F22` fitting to one glyph at width 3, two at width 4), which is the
    spill direction and is what the re-measure exists to hold. The mutation now fails 1.
  - Probed independently here and found nothing further. Over 36 hostile labels x project/task
    x session counts 0/1/9/10/100/1000 x `width` 0..20: no row spilling past `width`, no row
    measuring fewer than `width` columns, and no clipped badge (0 failures each). Re-ran after
    the fix: still 0. Separately checked "a row never goes blank at a width where a narrower
    pane showed the label" — 71 violations before the fix, and after it every remaining case is
    the settled round-6 badge-outranks-label precedence (0 unexplained).
  - Mutation-tested both suites: six mutations run (badge boundary, my `keepIndent` fix reverted,
    `shows()` forced true, codex's rejoin fix reverted, leading-only unprintable drop,
    `textWidth` as a code-point count) — all six caught after the additions.

- **Known limitation, accepted (not a defect this round).** A task row can still show one fewer
  label column at the width where the indent first becomes affordable: `Ab` draws `Ab` at width
  2 and `  A` at width 3. Buying strict monotonicity would mean dropping the indent from every
  truncated row — which is the common case for a real title — and the indent is how a task is
  told from a project. The stronger guarantee round 9 stated ("a wider pane never shows less")
  holds for everything except this one transition, and that is the trade taken deliberately.

- Validation at `da3006a`: `bun run lint` exit 0, `bun run typecheck` exit 0 across all five
  packages, `bun test` 1125 pass / 8 fail (1133 across 104 files, 88s). The eight are the same
  pre-existing `MarkdownPaneImpl` cross-file isolation failures as every prior round, verified
  by name; the pass count is up by exactly the four new tests. Working tree clean.

- **Task 13, round 11** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD` scoped to
  `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`, `packages/tui/src/render/text.ts` and
  `text.test.ts`): two findings, both substantiated and both fixed in `382b33f`. Run the repros
  with `bun test packages/tui`.
  - **Substantiated — `fitToWidth` resumed its running total after a rejoin and stopped a
    cluster short.** Round 10 made the re-measure fire only for the cluster immediately after a
    drop, then cleared the flag. But a rejoin shifts every *later* boundary as well: in
    `"\u{1f1fa}\u0007\u{1f1f8}\u{1f1e8}\u{1f1e6}"` the control byte rejoins the first two
    indicators into one flag, which leaves the third and fourth offset by one, and the resumed
    additive total read the fourth as its own two-column cluster. At `cols` 4 the row laid out
    `"\u{1f1fa}\u{1f1f8}\u{1f1e8}"` — four columns of ink with the last flag half-drawn —
    where all four indicators lay out as two flags in exactly four columns. Fix: `dropped` is
    now sticky, so every admission after the first drop is measured by layout. Regression test:
    `fitToWidth > keeps counting by layout for every cluster after a rejoin, not just the first`
    in `packages/tui/src/render/text.test.ts` — red on `8f92af6`, green on `382b33f`.
  - **Substantiated — `shows()` read an invisible cluster as text and the indent starved the
    label.** `trim()` strips the blank in a cluster but leaves an invisible code point riding
    on it, so the cluster reads back as visible and round 10's guard keeps the indent. Three
    inputs, all task rows: `"\u00a0\u200dA"` (NBSP + zero-width joiner) drew `A` at width 2,
    a blank row at width 3 and `A` again at width 4; `"\u0600 A"` (Arabic number sign binding
    forwards onto a space) behaved the same way; `"\u2800A"` with one session drew
    `"\u2800A 1"` at width 4, `"  \u2800 1"` at width 5 and `"  \u2800A 1"` at width 6. Found
    independently from the Cf side before the report landed, which named the U+2800 case. Fix:
    `shows` strips whitespace, `\p{Cf}`, `\p{Default_Ignorable_Code_Point}` and U+2800 before
    testing for emptiness. Regression tests: `drawSidebar > drops the indent when the label
    fits beside it as an invisible cluster`, `> drops the indent for a format character that
    binds forwards onto a blank` and `> drops the indent for a braille cell with no dots
    raised` in `packages/tui/src/ui/sidebar.test.ts` — all red on `8f92af6`, green on `382b33f`.
  - Independent probing beyond the report, over ~200k-500k random rows built from an alphabet of
    wide, astral, combining, format, control, regional-indicator and blank clusters:
    `textWidth(fitToWidth(t, c)) <= c` never violated; `fitToWidth` never lost a column when
    `cols` grew by one; the assembled `indent + label + badge` never measured more than `width`;
    the badge never came out truncated when `badgeCols > 0`; and after the fix no row that drew
    ink at one width drew none at the next width up. Before the fix that last probe found 1180
    violations, all of the two shapes above.

- **Task 13, round 12** (gpt-5.5 via codex-review, Mode B over `e64f1f0..HEAD` restricted to
  `packages/tui/src/ui/sidebar.ts`, `sidebar.test.ts`, `packages/tui/src/render/text.ts` and
  `text.test.ts`, with rounds 1-11 listed as fixed and the round 11 diff `8f92af6..HEAD`
  called out separately): **no findings**. Task 13 is clear. No code changed this round.
  - The brief pressed on exactly what round 11 rewrote: the now-sticky `dropped` flag in
    `fitToWidth` and the `INVISIBLE` predicate behind `shows()` in `drawSidebar`. Codex
    answered each of the posed questions and reported no reproducible defect:
    the `dropped && out !== ""` guard is right for leading dropped clusters (with nothing
    admitted yet there is no rejoin to re-measure); `used` does go stale once the layout path
    takes over but is never read again while it is stale; the layout path cannot return text
    wider than `cols` because it measures the exact string that will be laid out; `break`
    rather than `continue` is still what "longest prefix" means; and it found no
    invisible-but-plausible label character the predicate misses, agreeing that a space
    carrying U+0301 is correctly treated as visible.
  - Codex's one substantive note was cost: the post-drop path re-segments and re-measures the
    growing `out` on every admission. Not treated as a defect, for the reason already recorded
    under round 10 — `out` never exceeds `cols` columns, so it holds at most `cols` clusters,
    each `textWidth` call is O(cols), and the loop stops at the first cluster that does not
    fit. The whole fit is O(cols^2) plus O(n) for the clusters it drops, not O(n^2).
  - Independent probing, run before the report landed and again after it. 150,000 random
    labels of 1-6 clusters drawn from an alphabet of wide, astral, combining, format,
    control, regional-indicator, braille-blank, Hangul-filler and blank clusters, each row
    rendered at every width 0..14 as both a project and a task and with a session count of
    0 or 1-120. Four properties, all held with zero violations:
    the assembled `indent + label + badge` never needs more columns than the pane
    (`fitToWidth(text, width) === text`); the label never loses more than one column when the
    pane grows by one, badge-appearance transitions excluded; a row that shows ink at one
    width still shows ink at the next width up; and a badge shown at one width is still shown
    at the next.
  - One probe hit needed running down and turned out not to be a defect. The label
    `U+2800 U+0020 U+0020 U+0301 U+0041` on a task row draws `A` at width 4 and does not at
    width 5, where the indent comes back and the accent alone keeps `shows()` true. Plain
    ASCII does the same thing: a task titled `ABCDEF` draws `AB` at width 2 and `  A` at
    width 3. It is the one-column indent-transition trade this task already accepted, not a
    new regression, so nothing was changed for it.
  - Validation: `bun run lint` clean, `bun run typecheck` clean across all five packages,
    `bun test packages/tui` 296 pass / 0 fail, full `bun test` 1129 pass / 8 fail with the 8
    being the known pre-existing `MarkdownPaneImpl` failures (the three fragment-link tests
    and the five checkbox-click tests). Run with nothing else running, per the note below.

## Decisions taken (Task 14 implementation)

- The plan's `drawTabs` sketch wrote the label code point by code point with an implicit
  width of 1. That is exactly the class of bug Task 13 spent twelve rounds removing from the
  sidebar, so the implementation routes labels through `fitToWidth`/`layoutText` instead:
  a wide glyph gets its width-0 continuation cell, a glyph that would straddle the strip's
  last column is dropped whole rather than tearing into the cell to its right, and a control
  character never reaches the frame. The signature the plan specifies is unchanged.
- `textWidth` is now exported from `render/text.ts`. `layoutText` pads to the width it is
  given, so each tab must be laid out at its own column count — padding to the rest of the
  strip would stretch the active tab's inverse block over every column after it. Computing
  that count needs the fitted label's real width, which only `textWidth` knows.
- The strip is cleared before the tabs are drawn, attributes included. A frame with fewer
  tabs than the last would otherwise leave a stale inverse block on the row.
- A tab that has run out of room is truncated rather than dropped: `fitToWidth(label,
  room - 2)` keeps the padding columns and gives the label what is left, so the strip shows
  that another session exists even when its name does not fit. When `room` reaches zero the
  loop stops, so nothing is written past `x0 + width`.
- `drawSessionPane` is the plan's version unchanged. `blitTerminal` already blanks the part
  of the rect the source terminal does not cover, so the null-session branch is the only
  clearing this function does itself.

## Decisions taken (Task 13 round 11)

- The re-measure is made sticky rather than unconditional. Once a drop has happened every
  later admission is measured by layout, but a string with no drop keeps the additive count.
  The cost stays bounded either way: `out` never exceeds `cols` columns, so it holds at most
  `cols` clusters and each `textWidth` call is O(cols), not O(n).
- `shows()` keeps a predicate rather than a table of glyphs that happen to render blank. The
  line drawn is what Unicode itself calls invisible — whitespace, `Cf`, and the rest of
  `Default_Ignorable_Code_Point` — which also covers the Hangul fillers.
- U+2800 is the single named exception to that line. It is a graphic character, so no property
  catches it, but the braille cell with no dots raised is defined as an empty glyph and it is
  the only one. Codex raised it; taking the exception costs one code point and closes a row
  that would otherwise draw nothing where a narrower pane drew a label.
- Combining marks are deliberately not stripped in `shows()`. A space carrying an acute accent
  draws ink, so the cluster counts as visible even though `trim` would leave only the mark.

- **Task 14, round 1** (gpt-5.5 via codex-review, Mode A over `--commit b825ded`):
  zero findings. Codex reported "I did not find a concrete regression or material
  defect introduced by this commit", having read the diff, run
  `bun test packages/tui/src/ui/session-pane.test.ts` (11 pass) and the package
  typecheck itself. No code changed this round.
  - Independent verification: I read `drawTabs`, `drawSessionPane` and the
    `textWidth` export against `render/text.ts`, `render/cells.ts` and
    `term/blit.ts`, then probed the two invariants a strip can break — writing
    past `x0 + width`, and leaving a width-2 cell without its width-0
    continuation (or a continuation without its base) inside the strip. The
    probe swept every strip width 0..9 against twelve labels: empty, a lone
    space, ASCII, CJK, a flag pair, a Prepend-`Cf` label (`U+0600` + `a`), a
    precomposed accent, an emoji-presentation sequence and a baseless combining
    mark, each followed by a second tab so the overflow path ran too. All 232
    assertions held. The probe was a scratch file, deleted after the run; it
    found nothing, so there is no regression test to keep.
  - Reasoning behind the invariants: `cursor` advances one column per cell and
    `layoutText` returns exactly `cols` cells with `cols = Math.min(room, ...)`,
    so a write past the strip would require `layoutText` to over-produce. The
    narrow-strip case is the one worth probing because `room - PADDING_COLS`
    goes negative at `room === 1`, and `fitToWidth` is never called with a
    negative budget anywhere else in the package.

## Decisions taken (Task 13 round 10)

- "The label shows something" is decided by `label.trim() !== ""`, not by emptiness. Whitespace
  the fit keeps is real text but invisible, so for the purpose of ranking the indent it counts
  as nothing. `trim` also covers the Unicode blanks (NBSP, EM SPACE) that `fitToWidth` keeps as
  width-1 cells; the control characters it would otherwise catch are already dropped at fit time.
- The indent is still kept when the label is blank *either* way — a title of nothing but spaces
  draws a blank row regardless, so there is no reason to strip the hierarchy cue as well.
- `fitToWidth` re-measures only after a drop, not on every cluster. The whole-string measure is
  O(n) per call, so doing it unconditionally would make the fit O(n^2) on every row of every
  frame; a drop is rare, and with no drop the additive count is exact.
- The rejoin is not special-cased to regional indicators even though they are the only pair that
  joins today. Measuring what the string actually lays out costs the same and does not have to
  be revisited if another cluster shape starts binding across a dropped neighbour.

## Note on unrelated commits

`9d89b0f` and `40da7b0` (a multi-backend implementation plan and a docs tweak) landed on
`main` from outside this flow while round 8 was running. Both are docs-only and touch none
of the four files under review, so the `e64f1f0..HEAD` scoping is unaffected. Task 13's base
commit is still `e64f1f0`. `bdc2bd0` (a revision of that same multi-backend plan) landed the
same way during round 9 and sits under this round's two commits; it is docs-only and touches
none of the four files under review, so the scoping still holds. More docs-only revisions of
that same plan landed during round 10, most recently `028aa1e` (a renumbering of its steps).
Same reasoning, same conclusion: the scoping and the base commit both still hold. No
further unrelated commits landed during round 11: `8f92af6` was this flow's own round 10
record, and `382b33f` sits directly on it. None landed during round 12 either: `e524484`,
this flow's own round 11 record, was still HEAD when the round started and no code changed. Four more docs-only commits landed from outside this
flow during Task 15: `383c97b`, `765e069` and `9d45325` (multi-backend plan revisions) and
they sit interleaved with this flow's own records. None touch `packages/tui`, so scoping
`43df638..584f615` to `packages/tui` leaves exactly the five files of Task 15.

## Task 15 — implementation

Base commit `43df638`; implemented in `8c01132` (`packages/tui/src/ui/app.ts`,
`packages/tui/src/ui/app.test.ts`, `packages/tui/src/index.ts`).

Plan Steps 1-5 ran as written: `app.test.ts` failed with `Cannot find module './app'`,
then passed 6/6 once `app.ts` landed. `index.ts` has no test of its own — the plan gives it
none, and it is the one module that owns real process state.

Checks on `8c01132`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 313 pass / 0 fail, full `bun test` 1146 pass / 8 fail with
the 8 being the known pre-existing `MarkdownPaneImpl` failures. `prettier --check` clean on
the three new files.

## Decisions taken (Task 15 implementation)

- **One `Tty`, not two.** The plan's `index.ts` built a throwaway `Tty(sink, {kitty: false})`,
  called `installExitHandlers()` on it, then set raw mode by hand before negotiating, on the
  stated reasoning that "the handlers that undo it are installed first". Those handlers do not
  undo it: every one of them calls `leave()`, which returns immediately while `entered` is
  false, so nothing takes raw mode off. A signal landing during the ~150ms negotiation window
  would have left the shell in raw mode. Replaced with a single `Tty` created after
  negotiation, plus `armRawModeGuard()` — an exit/SIGINT/SIGTERM/SIGHUP guard that only
  restores raw mode, armed before the kitty query goes out and disarmed the moment
  `tty.enter()` returns, so the two never overlap and never leave a gap.
- `setRawMode` is a local helper guarding on `process.stdin.isTTY`, matching what `Tty` does
  internally; the plan called `process.stdin.setRawMode(true)` unguarded, which throws when
  stdin is a pipe.
- The `to-child` branch moved out of `handleKey` into a private `sendToChild`. The plan's
  version shadowed the outer `ev` parameter with the loop variable; splitting it is clearer
  than renaming, and keeps the switch a flat list of one-liners.
- `App.rows` renamed to `App.sidebarRows`. The plan had a field `rows` and a dep `rows`
  (the terminal height), and `render()` destructures `rows` from the deps — the two names
  collided in the one function that uses both.
- `SessionTerminal` is imported as a type: `App.sessions` is empty in this task and the class
  is only referenced in a type position, so a value import would be an unused runtime import.

## Task 15 — smoke test, round 1

User ran plan Step 6 and reported: the app started, the sidebar showed projects and tasks,
but "I couldn't navigate anything. Neither keyboard nor mouse worked."

Investigated by driving the real `packages/tui/src/index.ts` inside a `Bun.spawn`
`terminal:` PTY and injecting keystrokes, capturing the bytes the app wrote back. Two runs,
one per input mode — the host either ignores the `CSI ? u` query (legacy path) or answers
`CSI ? 1 u` (kitty path, what Ghostty/Kitty do). Scripts are scratch, not committed.

Result, identical in both modes:

| key sent | bytes written back | verdict |
|---|---|---|
| `j` | 84 — highlight moves from row 0 to row 1 | works |
| `k` | 84 — highlight moves back | works |
| `Q` | 50-54 — full leave sequence, exit code 0 | works |
| `CSI B` (down arrow) | **0** | does nothing |

The kitty run was confirmed to be on the kitty path: the host saw `\x1b[?u` go out, replied
`\x1b[?1u`, and the app's next write contained `\x1b[>1u`.

So the keyboard is not broken. Two things the user tried are unbound, both by design:

- **Arrow keys.** `route()` reaches its sidebar branch, checks `ev.name === "enter"`, then
  `const char = ev.char` at `packages/tui/src/ui/routing.ts:104`. An arrow event carries no
  `char`, so the guard on line 105 fails and line 116 returns `{kind: "none"}`. `SIDEBAR_CHARS`
  holds `j k z n s q Q ?` and nothing else. This matches the spec's keymap
  (`docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`, "Keymap"), which is
  deliberately vim-style and lists no arrow keys.
- **Mouse.** Nothing in `packages/tui/src` ever enables mouse tracking — no `?1000h`/`?1002h`/
  `?1006h` anywhere. `MOUSE_OFF` appears only inside `leaveSequence`. The spec mentions mouse
  once, as a child mode to forward (`mouseTrackingMode`), and once as something to switch off
  on exit. There is no UI mouse support in Stage 1 at all.

**Plan/spec contradiction found.** Plan Task 15 Step 6 check 4 says "pressing an arrow key
still moves the selection". The spec's keymap does not bind arrows and `route()` (Task 12,
clear since round 3) never did. The plan's smoke-test wording is wrong, not the code — but
whether that should be resolved by fixing the wording or by binding the arrows is a scope
call, not a defect fix.

## Task 15 — smoke test outcome and arrow keys

User's answer to both questions: they want arrow keys **and** mouse support. The concern
that mouse is a subsystem outside the Stage 1 plan was raised and they reaffirmed the ask,
so it is now in scope and gets Task 19 below. They did not say whether `j`/`k` worked; the
PTY runs say they do, and no second bug was ever substantiated, so that thread is closed.

**Arrow keys — done**, commit `584f615` (`ui/routing.ts`, `ui/routing.test.ts`,
`ui/app.test.ts`). `SIDEBAR_KEYS`, a `Partial<Record<KeyName, Action>>` checked before the
char map because an arrow carries no `char` at all, binds `down` to `move +1` and `up` to
`move -1`. Six new routing tests plus one app-level test; the two "arrows move the sidebar"
routing tests were red before the change and green after
(`bun test packages/tui/src/ui/routing.test.ts`).

End-to-end confirmation, same PTY harness as the investigation, kitty path: down arrow went
from **0 bytes written back to 82** — the highlight moves from row 2 to row 3. `j`, `k` and
`Q` unchanged.

- **Task 15, round 1** (gpt-5.5 via codex-review, Mode B over `43df638..584f615`
  restricted to `packages/tui`): three findings, all three substantiated and fixed
  in `8045ed4`. Each was reproduced before the fix was written.
  - **Substantiated — the spawned backend outlived the TUI.** `backend.stop()` and
    `net.close()` were reached only from the one clean path where the render loop
    saw `app.running` go false. A signal, an uncaught exception, or any throw
    during startup after the spawn left the backend running and its port file on
    disk. Repro before writing a test: a fake backend that records its pid, writes
    port 1 and sleeps; the TUI's connect is refused, it exits 1, and the fake
    backend is still alive. Regression tests: `tui entry point > stops the backend
    when startup fails after it was spawned` and `... when the TUI is terminated by
    a signal` in the new `packages/tui/src/index.test.ts` — both red on `584f615`,
    green on `8045ed4`. Run with `bun test packages/tui/src/index.test.ts`.
  - **Substantiated — keys typed during startup were dropped.** `readOnce` removes
    its `data` listener but leaves stdin flowing, so between the kitty negotiation
    and the decode loop — a window spanning the whole first snapshot load — bytes
    were emitted with nothing listening. Confirmed against real stream semantics
    with a standalone script before touching `index.ts`, then as a regression test:
    `tui entry point > does not lose a key typed while the first snapshot is still
    loading` (the fake backend holds its list responses back 1.2s so `Q` lands
    inside `init()`; a dropped `Q` means the TUI never exits) — red on `584f615`
    (timed out at 20s), green on `8045ed4`.
  - **Substantiated — the sidebar movement tests passed for the wrong reason.**
    Both asserted only `sink.output !== ""`, which any repainting action satisfies.
    Demonstrated by mutation: rerouting `j` to `zoom` left `App > j and k move the
    sidebar selection` green. They now read the inverse-video row off the painted
    frame (`screen.back`, `ATTR_INVERSE`) and assert the selection moved to row 1
    and back to row 0. The same mutant is red against the new assertions.
    (The arrow test happened to catch that particular mutant already, by luck of
    its second `up` press producing no frame change — it was no less weak.)
  - Codex reported no findings on terminal restoration itself, on the routing
    change, or on the project's type and export constraints.

## Decisions taken (Task 15 arrow keys)

- **Up/Down only. Left/Right stay unbound.** The spec gives `h`/`l` the job of moving between
  the sidebar and the main area, and neither `h` nor `l` is implemented, so binding the
  horizontal arrows would be binding them to nothing. They get bound when `h`/`l` do.
- Keyed by `KeyName` in its own map rather than folded into `SIDEBAR_CHARS`. The char map is
  reached through a `char !== undefined` guard that an arrow can never satisfy.
- Chorded arrows are excluded by the existing `isChorded` check, so `Ctrl+Down` stays free
  for a future binding and is not silently a move. Covered by a test.
- Shift+Arrow *does* move, matching how `Q` works — `isChorded` deliberately ignores shift.

Checks on `584f615`: `bun run lint` clean, `bun run typecheck` clean across all five packages,
`bun test packages/tui` 319 pass / 0 fail, full `bun test` 1152 pass / 8 fail (the known
`MarkdownPaneImpl` eight). `prettier --check` clean.

## Decisions taken (Task 15 round 1)

- **Release hangs off `process.on("exit")` rather than duplicating cleanup into
  each handler.** `Tty.installExitHandlers` already owns the signal and
  `uncaughtException` handlers and calls `process.exit` straight after restoring
  the terminal, so `exit` is the one hook every route out of the process passes
  through. `Tty` is Task 5 and already clear; this adds to it rather than
  rewriting it.
- **Registered per resource, as it is created**, not once at the end of `main`:
  `main` can throw between the spawn and the connect, and that gap is exactly the
  case the first finding is about.
- **The release callbacks swallow their own errors.** Exit is the last chance for
  every other resource too, so one that fails to close must not strand the rest.
- **The explicit `net.close()` / `backend.stop()` in the quit path were removed**
  rather than left as belt-and-braces — `process.exit(0)` on the next line runs
  the same handlers, and two callers make it ambiguous which one is responsible.
- **`index.test.ts` runs the real entry point as a process.** `index.ts` runs
  `main()` on import, so there is nothing importable to unit-test; the lifecycle
  is only observable from outside. It costs about 5s.
- **The strengthened tests read the frame rather than a new `selected` getter.**
  Exposing internal state purely for a test would widen the public surface for
  no behavioural reason, and the rendered inverse-video row is what the user
  actually sees.

## Task 19 — Mouse support (added post-plan, needs a plan of its own)

Requested by the user after the Task 15 smoke test. Nothing in `packages/tui/src` enables
mouse tracking today and the Stage 1 plan and spec never had it, so this is new scope, not a
defect fix. It is not a one-task change — a sketch of what it touches, for whoever plans it:

- `term/tty.ts` — `enterSequence` has to turn tracking on (`?1000h` for clicks, `?1002h` if
  drag is wanted, plus `?1006h` for SGR encoding so coordinates past column 223 survive).
  `leaveSequence` already turns all four off, so only the enter side is missing.
- A mouse decoder for `CSI < b ; x ; y M|m`. It has to run *before* the generic CSI handling
  in `decodeLegacy`, which is the single choke point — `decodeKitty` delegates everything
  that is not `CSI … u` to it.
- `DecodeResult.events` is `KeyEvent[]`. A mouse report is not a key, so this becomes a union
  and the change ripples into `route()`, `App.handleKey` and `encodeForChild`.
- Hit-testing needs the frame's layout — sidebar width and the pane rect — which `App.render()`
  computes locally today and throws away. It has to be hoisted so `handleMouse` can read it.
- Forwarding to the child has to honour that child's own `mouseTrackingMode` and encoding
  (`IModes`), the same way `encodeForChild` honours `applicationCursorKeysMode`. A child that
  never asked for mouse reports must not receive them.

Per the repo's own rule for new features, this gets a written plan reviewed by gpt-5.5 twice
before any code, appended to the Stage 1 plan as new tasks.

- **Task 15, round 2** (gpt-5.5 via codex-review, Mode B over `43df638..8045ed4`
  restricted to `packages/tui`): five findings — two substantiated defects and two
  test-harness problems, all fixed in `1873c41`; one resize finding deferred as
  out of scope. Both defects were reproduced before a line was written.
  - **Substantiated — a signal early in startup orphaned the backend.** The first
    signal handler was installed by `armRawModeGuard`, which does not run until
    after the backend is spawned and the socket is connected. Until then a
    SIGTERM killed the TUI with the signal's default disposition, which runs no
    `process.on("exit")` handler, so the `releaseOnExit` registrations never
    fired — and during `startBackend`'s poll loop, the longest window in startup,
    there was nothing registered to fire anyway. What you would see: quit the TUI
    with a signal while it is still starting and the backend keeps running with
    nothing holding a handle on it. Repro before any fix: a fake backend that
    writes its pid at once and its port file five seconds later; SIGTERM the TUI
    as soon as the pid appears; the backend is still alive. Regression test:
    `tui entry point > stops the backend when a signal lands while the port is
    still awaited` in `packages/tui/src/index.test.ts` — red on `8045ed4`, green
    on `1873c41`. Run with `bun test packages/tui/src/index.test.ts`.
  - **Substantiated — the sidebar lost its selection when rows vanished under it.**
    `render()` rebuilds `sidebarRows` from the store every frame, but `selected`
    was clamped only inside the `move` action. `drawSidebar` deliberately refuses
    to highlight a row past the end of the list, so after a `PROJECT_REMOVED`
    broadcast that dropped rows below the cursor the sidebar rendered with no
    inverse-video row at all until the user pressed a movement key. Regression
    test: `App > keeps a selection when the row list shrinks under it` in
    `packages/tui/src/ui/app.test.ts` — red on `8045ed4` (`selectedRow` returned
    `null` where 1 was expected), green on `1873c41`.
  - **Substantiated (test hygiene) — `index.test.ts` leaked on failure.** Its
    `afterEach` SIGKILLed the TUI, which runs none of the TUI's own cleanup, so a
    red test left the fake backend running; the `mkdtemp` trees were never removed
    on any path. The harness now tracks backend pids and temp dirs and clears both.
  - **Substantiated (test hygiene) — the startup-key test aimed with a fixed sleep.**
    `talkingBackend` wrote its pid before `exec bun server.ts`, so the 600ms sleep
    was measured from a point before the server process even started. On a loaded
    machine `Q` could land inside the 150ms kitty negotiation window and be
    swallowed by `readOnce`, turning a real pass into a 20s timeout. The fake
    server now writes a readiness marker as the first request arrives — which by
    construction is after connect and negotiation and inside `app.init()` — and
    the test waits for that marker instead of sleeping.
  - **Deferred — no resize handling.** `cols`/`rows` are read once at startup and
    no `SIGWINCH` handler exists, so resizing the terminal leaves the app drawing
    at the old dimensions. Verified as accurate, but neither the plan nor the spec
    (`docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`) mentions
    resize anywhere, and a fix reaches into `Screen.resize`, an `App.resize` path
    and `SessionTerminal` sizing. Recorded as a known Stage 1 limitation rather
    than folded into the shell task. See "Open limitations" below.
  - Codex reported clean on: the arrow routing (up/down before the char map,
    chorded arrows inert, Shift+Arrow live), session-pane focus routing, the
    post-negotiation input buffering order, the render loop's inability to
    overlap itself, the deliberately empty `App.sessions`, and the absence of
    `as any` / `eslint-disable` anywhere in `packages/tui/src`.

## Decisions taken (Task 15 round 2)

- **Signals route through `process.exit` from the first line of `main`**, rather
  than each resource growing its own signal handler. One handler installed before
  anything exists makes the `exit` chain reachable from every signal, and the
  chain already had the per-resource releases on it.
- **The later signal handlers are now dead and that is deliberate.** `Tty` still
  installs its own, but the earlier handler exits first so they never run. Nothing
  is lost: `Tty` restores the terminal from its `exit` handler, which the
  `process.exit` path does reach. `armRawModeGuard` was reduced to its `exit`
  restore for the same reason.
- **`startBackend` gained an `onSpawn` hook** rather than index.ts reaching for
  the child. The invariant — the child must not outlive its parent — starts at the
  spawn, not at the resolved handle, and the hook is the smallest change to Task 2
  that expresses it. `releaseOnExit(backend.stop)` after the await was dropped:
  it is the same closure, and registering it twice would only make it ambiguous
  which registration is responsible.
- **The clamp lives in a `setRows` helper** called from both `init()` and
  `render()`, so the row list and the selection can never be updated apart. The
  `move` action keeps its own clamp: it is the lower bound (`0`) that matters
  there, and folding it in would not read more clearly.
- **`activeSession` was not given the same treatment.** `sessions` is a `readonly`
  array that nothing in Stage 1 ever pushes to, so there is no shrink to guard
  against; it gets a clamp when session creation lands.

## Open limitations (Stage 1)

- **No terminal resize handling.** Dimensions are captured once in `index.ts` and
  there is no `SIGWINCH` handler. Resizing while the TUI runs leaves it drawing at
  the old size until restart. Not in the plan or the spec; raised by gpt-5.5 in
  Task 15 round 2 and deliberately deferred.
- **No sidebar scrolling.** `drawSidebar` draws `rows[0..height-1]` and `selected`
  is clamped to the list length, not the visible window, so a list longer than the
  pane cannot be reached past the fold. Also absent from the plan and the spec.

Checks on `1873c41`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 324 pass / 0 fail, full `bun test` 1157 pass / 8 fail
(the known `MarkdownPaneImpl` eight). `prettier --check` clean on the five touched files.
The +2 over the `8045ed4` baseline of 1155 is exactly the two new regression tests.

- **Task 15, round 3** (gpt-5.5 via codex-review, Mode B over `43df638..1873c41`
  restricted to `packages/tui`): two findings, both substantiated and fixed in
  `28ac654`. Both were reproduced before a line of the fix was written.
  - **Substantiated — a key pressed at startup did nothing.** The kitty
    capability query is the only thing that reads stdin before the decoder is
    installed. `readOnce` resolved with the first chunk and `negotiateKitty`
    reduced that chunk to a boolean, so whatever the user typed inside the 150ms
    window was thrown away. What you would see: launch the TUI, press `Q` (or an
    arrow) immediately, and nothing happens. A second, quieter half: a keystroke
    that lands as its own chunk *ahead* of a kitty terminal's reply made the read
    return with no reply in it, so a capable terminal was downgraded to legacy
    keys for the whole session. Regression test: `tui entry point > does not lose
    a key typed before the kitty query goes out` in
    `packages/tui/src/index.test.ts` — it writes `Q` into the pipe before the TUI
    has read a byte, which is deterministic because the pipe buffers it until the
    negotiation read resumes the stream. Red on `1873c41` (the TUI never quit and
    was SIGKILLed by the harness, exit 137), green on `28ac654`. Run with
    `bun test packages/tui/src/index.test.ts`.
  - **Substantiated — a hangup was reported as a termination.** `installSignalExit`
    mapped every non-`SIGINT` signal to 143, so `SIGHUP` exited 143 instead of the
    conventional 129 and a supervisor or shell reads it as SIGTERM. Regression
    test: `tui entry point > reports a hangup with the conventional exit code` —
    red on `1873c41` (`143`), green on `28ac654`.
  - Codex reported clean on: the signal ordering (the early `process.exit` handler
    does win, and the `exit` chain does reach `Tty`'s restore), the synchronicity
    of every `releaseOnExit` callback, the `onSpawn` hook against Task 2's error,
    timeout and double-stop paths, the sidebar clamp arithmetic at every boundary,
    arrow/chord/quit routing, and the test harness's cleanup.

## Decisions taken (Task 15 round 3)

- **`negotiateKitty` returns `{ kitty, rest }` rather than the entry point
  re-reading stdin.** The bytes are already consumed by the time `negotiateKitty`
  returns; only it knows which of them were the reply. Handing back the remainder
  is the one place the distinction exists.
- **The read loop repeats until the reply or the budget, instead of taking one
  chunk.** This is what fixes the downgrade half of the finding. It costs nothing
  on a terminal that answers (it returns as soon as the reply is complete) and
  nothing on one that stays silent (an empty chunk means the reader hit its own
  timeout, so the loop stops rather than waiting out the rest of the window).
- **The decode body was extracted into `feed(text)`** so the leftover input goes
  through exactly the same path as a live chunk — carry, escape timer and all —
  rather than a second, subtly different decode call.
- **`feed(rest)` runs before `process.stdin.resume()`**, so the keys typed during
  negotiation are handled ahead of anything the stream is about to deliver.
- **`Tty`'s signal handlers got the same exit-code fix even though they are dead
  code.** They are unreachable only because `installSignalExit` exits first; if
  that ordering is ever changed, the wrong code should not come back with it.
  `os.constants.signals` supplies the numbers rather than a hand-written table.

Checks on `28ac654`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 330 pass / 0 fail, full `bun test` 1163 pass / 8 fail
(the known `MarkdownPaneImpl` eight). `prettier --check` clean on the five touched files.
The +6 over the `1873c41` baseline of 1157 is two new entry-point tests and four net-new
negotiate tests.

- **Task 15, round 4** (gpt-5.5 via codex-review, Mode B over `43df638..28ac654`
  restricted to `packages/tui`): the run produced two reports over the same target.
  The first said "Verdict: Clear, findings: none". A second run then overwrote the
  report file with "Verdict: Changes required" and one finding — which turned out to
  be real. Recorded because it is a process lesson, not a code one: a single codex
  verdict of "clean" is weaker evidence than it reads as.
  - **Substantiated — an Escape typed at startup ate the next keypress.** What you
    would see on a terminal without the kitty protocol: launch the TUI, press
    `Escape` while it is starting, then press `Q` a second or two later while the
    sidebar is still empty — and nothing quits. Mechanism: an Escape pressed into the
    kitty negotiation window comes back as `negotiated.rest`, and a lone ESC is held
    as a carry rather than decoded, on the premise that a continuation within 25ms
    makes it an Alt chord. But the stream is paused across the whole of `app.init()`,
    so `process.stdin.resume()` releases a key pressed seconds later straight into
    that carry: `decodeLegacy` sees `ESC` `Q` adjacent and emits Alt+Q, which is bound
    to nothing. Regression test: `tui entry point > does not merge an escape from the
    negotiation window with a later key` in `packages/tui/src/index.test.ts` — it
    writes `\x1b` before the TUI has read a byte, waits for the ready marker (which
    the fake backend writes when the first request arrives, so negotiation is over and
    the snapshot is still 2s out), then writes `Q`. Red on `28ac654` (timed out at
    20s — the TUI never quit), green on `bdbfe2b`. Run with
    `bun test packages/tui/src/index.test.ts`.
  - Codex reported clean on: `negotiate.ts`'s shared deadline, split-reply handling,
    reply excision and `rest` byte order; the exit chain across startup failure,
    signals, quit and the top-level catch; `app.ts`'s selection clamp and per-frame
    row rebuild; `routing.ts`'s arrow, chord and quit handling; and `manager.ts`'s
    `onSpawn` hook across its failure, timeout and double-stop paths.

## Decisions taken (Task 15 round 4)

- **The carry is flushed rather than the resume delayed.** Waiting out the 25ms idle
  timer before `resume()` would not help: the stream is paused for the whole of it, so
  a genuine continuation could not arrive either way, and every startup would pay the
  delay. Flushing says the true thing — the negotiation window has closed, so nothing
  that follows was part of the same keypress.
- **The narrower mirror case is accepted.** A user who presses Alt+Q *during*
  negotiation, with the ESC read and the `Q` arriving after the pause, now gets Escape
  then Q — so the app quits on a chord that was not the quit binding. That is a
  strictly rarer sequence than the one fixed, and its outcome (something happens) is
  better than the one it replaces (the quit is silently swallowed).
- **`flushHeldEscape` is shared with the idle timer** rather than duplicated, so the
  two paths cannot drift on what "release the carry" means.

## Open limitations (Stage 1) — added in round 4

- **A multi-byte character split across two stdin reads is corrupted.** Both `readOnce`
  and the main data handler call `chunk.toString("utf-8")` per chunk, which decodes each
  chunk independently: `printf '\xd0' ; printf '\xbf'` delivered as two chunks comes out
  as two U+FFFD rather than `п`. Demonstrated at the language level, not at the TUI
  level, because it has no Stage-1 symptom: `App.sendToChild` returns early while
  `sessions` is empty, and Stage 1 never creates one, so non-ASCII input reaches nothing.
  It becomes user-visible the moment session creation lands (pasting non-ASCII into a
  focused pane). The fix is `process.stdin.setEncoding("utf-8")` plus the string-typed
  chunk it implies; deliberately not made here because it cannot be given a red test
  today. Pick it up with session creation.

Checks on `bdbfe2b`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 331 pass / 0 fail, full `bun test` 1164 pass / 8 fail
(the known `MarkdownPaneImpl` eight), run with nothing else on the machine. `prettier
--check` clean on the two touched files. The +1 over the `28ac654` baseline of 1163 is
the one new regression test.

- **Task 15, round 5** (gpt-5.5 via codex-review, Mode B over `43df638..bdbfe2b`
  restricted to `packages/tui`): two independent codex runs over the same prompt,
  launched in parallel — round 4's process lesson applied deliberately this time
  rather than by accident. Both returned "Verdict: Changes required" and both
  independently named the same defect; one of them raised a second finding that
  did not survive verification.
  - **Substantiated — a failed startup pops the outer terminal's keyboard stack.**
    What you would see: launch the TUI from inside another program that speaks the
    kitty keyboard protocol (another TUI, or a terminal that pushed its own entry),
    have the backend fail its first snapshot, and after the TUI exits the *parent*
    program's keys start arriving in the wrong encoding — its keyboard-protocol
    entry is gone. Mechanism: `tty.enter()` writes one `CSI > 1 u` push, but a
    rejection from `app.init()` reached `main().catch`, which wrote
    `leaveSequence({ kitty: true })` unconditionally, and then `process.exit(1)`
    ran `Tty`'s own `exit` handler, which wrote the leave sequence again — one push,
    two pops, and `CSI < u` is stack-sensitive. Regression test: `tui entry point >
    pops the kitty keyboard stack once for the push when startup fails` in
    `packages/tui/src/index.test.ts` — it drives negotiation by writing the
    `\x1b[?1u` reply into the pipe before the query goes out, points the TUI at a
    fake backend that answers the first request with `error`, and counts the pushes
    and pops on stdout. Red on `bdbfe2b` (`Expected: 1, Received: 2`), green on
    `93f37a6`. Run with `bun test packages/tui/src/index.test.ts`.
  - **Not reproducible — "stdin chunks are lost between `readOnce` calls".** One run
    argued that `readOnce` removes its only `data` listener while the stream is still
    flowing, so a chunk emitted before the next listener attaches is discarded, which
    would defeat `negotiate.ts`'s split-reply handling. It backed this with a
    synthetic `PassThrough` probe, which does not show that `process.stdin` behaves
    that way. Checked directly against the real runtime: a harness replicating
    `readOnce` plus the negotiate read loop, fed 256 KB / 1 MB / 4 MB through a pipe,
    took 2 / 3 / 9 reads and accounted for **every byte** in all three, marker
    included. Bun does not emit a second buffered chunk inside the same synchronous
    flow after the listener is removed. Dropped.
  - Both runs reported clean on: `app.ts`'s selection clamp, per-frame row rebuild
    and cursor ownership; `routing.ts`'s kitty/legacy split, double-Esc hold and
    chord handling; `negotiate.ts`'s shared deadline and reply excision;
    `manager.ts`'s `onSpawn`; and the signal/exit-code chain.

## Decisions taken (Task 15 round 5)

- **Two codex runs per round, launched in parallel, from here on.** Round 4 learned
  by accident that a single "clean" verdict is weak evidence; round 5 made it the
  procedure. Both runs converging on the same finding is what gave it its weight,
  and the disagreement is what flagged the second claim as worth checking rather
  than believing.
- **The catch restores through `Tty` rather than skipping the restore.** Simply not
  writing in the catch would have fixed the double pop, but `console.error(err)`
  would then print onto the alternate screen and be wiped by the leave that follows
  — the user would be told nothing about why the TUI would not start. `Tty.leave()`
  is idempotent, so routing through it restores exactly once, before the print.
- **The `terminalOwner === null` branch pops nothing.** It writes
  `leaveSequence({ kitty: false })`: nothing has been entered on that path, so there
  is no push of ours to match, and a pop would come off a stack this process never
  wrote to — the same defect in the other direction.

## Open limitations (Stage 1) — added in round 5

- **In kitty mode the 25 ms escape-idle timer destroys a sequence split across two
  reads.** `feed()` arms the timer for any non-empty carry, and `flushHeldEscape`
  releases it through `flushCarry`, which drops a partial CSI. Traced at the module
  level: `decodeKitty("\x1b[81")` carries `\x1b[81`; the timer fires; `flushCarry`
  returns `[]`; the late `"u"` then decodes as a plain `u` char — so a kitty-encoded
  `Q` becomes a lost keypress plus a spurious character. The timer exists only to
  disambiguate a bare ESC, which under flag 1 cannot reach the decoder as a keypress
  at all, so it has no purpose in kitty mode. Deliberately not changed: the trigger
  is a chunk boundary falling mid-sequence with a >25 ms gap, and a terminal writes a
  7-byte sequence to the pty in one atomic write, so this could not be demonstrated
  in the real runtime — only at the module level. Revisit if a split is ever observed,
  or alongside the UTF-8 chunk-split fix that session creation already owes.

Checks on `93f37a6`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 332 pass / 0 fail, full `bun test` 1165 pass / 8 fail
(the known `MarkdownPaneImpl` eight). `prettier --check` clean on the two touched files.
The +1 over the `bdbfe2b` baseline of 331 is the one new regression test.

- **Task 15, round 6** (gpt-5.5 via codex-review, Mode B over `43df638..93f37a6`
  restricted to `packages/tui`): two independent codex runs over the same prompt,
  launched in parallel, as round 5 decided. Both returned "Verdict: Changes required".
  Both independently named the same defect (the `onSpawn` leak); each raised one
  further finding of its own, one of which survived verification and one of which
  did not. Both fixes are in `98d3d0c`.
  - **Substantiated — a startup failure before entry writes a full leave sequence.**
    What you would see: start the TUI with the backend unreachable, from a program
    that had mouse tracking on or had saved a cursor position, and that program's
    modes come back wrong after the error prints — its mouse reporting is off and
    its cursor has jumped. Mechanism: nothing has been entered on that path, but
    `main().catch`'s `terminalOwner === null` branch wrote
    `leaveSequence({ kitty: false })` anyway — `CSI ? 1049 l` restores the *outer*
    program's saved cursor, and `CSI ? 1000/1002/1003/1006 l` turns its tracking
    off. Exactly the round-5 kitty-pop defect in the other direction: undoing state
    this process never set. Regression test: `tui entry point > writes no leave
    sequence when startup fails before the terminal is entered` in
    `packages/tui/src/index.test.ts` — points the TUI at a backend that never
    accepts a socket and counts the mode-undoing bytes on stdout. Red on `93f37a6`
    (`Expected: 0, Received: 1`), green on `98d3d0c`. Run with
    `bun test packages/tui/src/index.test.ts`.
  - **Substantiated — a throwing `onSpawn` hook leaks the backend.** What you would
    see: nothing, from the TUI — it reports the hook's error and exits — but the
    backend process it spawned keeps running, holding the port, with no handle left
    that can stop it. Mechanism: `opts.onSpawn?.(stop)` sat outside every guard in
    `manager.ts`, so a throw there was the one exit from `startBackend` that ran
    neither `terminate()` nor `removePortFile()`. Regression test: `startBackend >
    kills the backend when the onSpawn hook throws` in
    `packages/tui/src/backend/manager.test.ts`. Red on `93f37a6`
    (`Expected: true, Received: false` after a 3s poll), green on `98d3d0c`.
    Run with `bun test packages/tui/src/backend/manager.test.ts`.
    Not reachable from `index.ts` today — the hook there is `releaseOnExit`, which
    only calls `process.on`. Fixed anyway because it is cheap, it is a documented
    contract of `startBackend` ("cleans up after its own failures"), and it is the
    exact leak the hook exists to prevent.
  - **Not reproducible — "`readOnce` drops the kitty reply between reads".** One run
    argued that two separately-written stdin chunks (a keystroke, then the terminal's
    `CSI ? 1 u` reply) can be split such that the second is emitted while `readOnce`
    has removed its listener, downgrading a kitty-capable terminal to legacy. This is
    round 5's dropped claim in a new form: round 5 disproved the *buffered* case, this
    one asserts a *separately-arriving* chunk. Checked directly with a harness
    replicating `readOnce` plus the negotiate loop, driven by a parent that wrote `Q`,
    flushed, waited, then wrote the reply — at gaps of 0, 1, 5, 20, 50 and 100 ms. All
    six runs recovered `"Q\x1b[?1u"` intact. The window cannot open: the re-attach
    happens in the microtask that the resolved `waitForData` promise schedules, which
    drains before the event loop can reach a poll phase and read the fd again.
    Dropped.
  - Both runs reported clean on: the round-5 `terminalOwner` fix for the
    post-`enter()` case; `Tty.leave()`'s idempotence across catch→exit,
    uncaughtException→exit, signal→exit and the normal quit; the `enter()`-threw case
    leaving exactly one leave sequence; `negotiate.ts`'s shared deadline, reply
    excision and `rest` ordering; and `app.ts`'s selection clamp, per-frame row
    rebuild, cursor ownership and routing split.

## Decisions taken (Task 15 round 6)

- **The pre-entry branch writes nothing at all**, rather than a narrower subset of the
  leave sequence. The only terminal state this process changes before `tty.enter()` is
  raw mode; the kitty query is a query and sets nothing. So there is exactly one thing
  owed back, and `setRawMode(false)` is all of it.
- **`leaveSequence` stays exported.** `index.ts` no longer imports it, but `tty.test.ts`
  does, and it was already exported for that in a cleared task.
- **The `onSpawn` call moved below `terminate()`'s definition** so the catch can reach
  it. Everything between the spawn and the hook is synchronous, so the hook still gets
  the terminator before any await — the "handed it the moment it is spawned" contract
  is unchanged.
- **Process-identity in the leak test comes from the temp directory, not a pid file.**
  The first version polled a pid file and went green on broken code: the child needs
  ~500 ms to write it, so the first poll read "already gone". Matching `pgrep -f` on a
  directory that contains both the script path and the `tail -f` target identifies the
  child continuously from `spawn()` onward, across the `exec` that rewrites its command
  line — so an absent match genuinely means dead.

## Process note (round 6)

The first cut of the `onSpawn` test passed on unfixed code. It was a real false green,
not a mis-assertion: the assertion was right and the *observable* was not yet observable
when it ran. Worth repeating on any test whose red state is "something is absent" —
confirm the thing is present before the fix makes it absent, or the test proves nothing.

Checks on `98d3d0c`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 334 pass / 0 fail, full `bun test` 1167 pass / 8 fail
(the known `MarkdownPaneImpl` eight), run with nothing else on the machine — another
session's two codex runs were waited out first. `prettier --check` clean on the four
touched files. The +2 over the `93f37a6` baseline of 332 is the two new regression tests.

- **Task 15, round 7** (gpt-5.5 via codex-review, Mode B over `43df638..98d3d0c`
  restricted to `packages/tui`): two independent codex runs over the same prompt,
  launched in parallel, as rounds 5 and 6 did. They **disagreed**: run A returned
  "Verdict: Clear", run B returned "Verdict: Changes required" with one finding.
  B's finding was real. The fix is in `3bc5ee8`.
  - **Substantiated — a backend that ignores SIGTERM outlives the TUI.** What you
    would see: quit the TUI, or have it fail to start, and the backend process it
    spawned is still running afterwards with nothing left that can stop it —
    holding its data dir, its file watchers and any agent PTYs it had open, for as
    long as the machine is up. Mechanism: the only backend cleanup a
    `process.on("exit")` handler can reach is `stop()`, and `stop()` sends
    `child.kill()` (SIGTERM) and nothing else. That was deliberate — every caller
    runs `process.exit` on the next line, so an escalation timer scheduled there
    would never fire — but it means the escalating `terminate()` is reachable only
    from `startBackend`'s own startup paths, never from the exit path. The real
    backend's SIGTERM handler is `async` (`prepareForShutdown`, `ptyManager.closeAll`,
    `fileWatcher.stopAll`, `wikiIndex.stopAll`), so wedging inside it is not
    hypothetical. Verified independently before the fix was written, with a probe
    that pointed the TUI at a `trap '' TERM` fake backend: "TUI exit code: 1 /
    backend pid 19193 still alive 3s after TUI exit: true".
    Regression tests, both red on `98d3d0c` and green on `3bc5ee8`:
    - `startBackend > kills a backend that ignores SIGTERM when the caller stops it`
      in `packages/tui/src/backend/manager.test.ts` — runs the reaper on a 1s grace
      and waits for the pid to go. Red: `Expected: true, Received: false` after 5s.
    - `tui entry point > arms the escalating reaper from its exit handler` in
      `packages/tui/src/index.test.ts` — the half only an end-to-end run can show,
      that `spawn()` from inside a `process.on("exit")` handler actually creates the
      process. Red: `Expected: not ""`.
      Run both with `bun test packages/tui/src/backend/manager.test.ts packages/tui/src/index.test.ts`.
  - **Run A reported clean on everything**, including both surfaces the round-7
    prompt pointed it at, and it ran the tests, typecheck and lint itself. Run B
    reported the same "no demonstrated issue" on both of those surfaces. So the two
    round-6 changes are now clear from two independent reads; the finding came from
    older code that Task 15 wired into the exit path.
  - Both runs reported clean on: the empty pre-entry `terminalOwner === null` branch
    (the kitty query is a query and pushes no mode; the backend's stdout is `ignore`
    so it cannot write to the terminal; `setRawMode(false)` is `isTTY`-guarded and the
    double restore is harmless), and the `onSpawn` try/catch (double `kill`/port-file
    removal is harmless, the bare rethrow preserves the hook's error, and awaiting
    `terminate()` is right on that path).
  - Neither run re-raised any of the carried-forward known-and-accepted items, which
    is what the prompt's exclusion list was for.

## Decisions taken (Task 15 round 7)

- **The escalation is handed to a detached reaper rather than awaited in-process.**
  An in-process fix would have to move backend cleanup off the `exit` hook onto the
  async paths, because `process.on("exit")` cannot await — and rounds 1-3 converged
  on `exit` precisely because it is the one hook every route out of the process
  passes through. It would also cost the *common* path: the TUI would hold the
  user's shell for up to the whole grace on every quit, waiting to find out
  something that is almost always fine. The reaper costs the common path nothing.
- **The grace is 10s, not the 1s `terminate()` uses.** `terminate()` runs on startup
  paths where the child has done no work worth saving. `stop()` runs on quit, where
  the backend is persisting interrupted sessions and stopping watchers; cutting that
  short would trade a rare leak for routine data loss. `reapGraceSeconds` exists as
  an option so the test can run it at 1s — the same shape as the existing `timeoutMs`.
- **The reaper polls `kill -0` every second instead of sleeping out the window.** Two
  reasons: a healthy backend leaves a stray `sh` for about a second rather than ten,
  and exiting on the first failed check is what keeps the final `kill -9` off a
  recycled pid. `stop()` also skips arming entirely when `outcome.exit` is already set.
- **The reaper is `detached`.** A closed terminal window sends SIGHUP to the TUI's
  process group, which is one of the ways `stop()` is reached; a reaper in that group
  would die alongside the thing it was armed to outlive.
- **Two tests, at two levels, deliberately.** The manager test proves the reaper kills;
  only the end-to-end test proves `spawn()` works from inside an exit handler, which is
  the genuinely uncertain part of the design. Neither alone covers it.

## Note on the round-7 split verdict

Rounds 5 and 6 had both runs converge, and the convergence was treated as what gave a
finding its weight. Round 7 is the counter-case: one run said Clear, the other found a
real defect, and the Clear run had *also* executed the test suite, typecheck and lint.
A clean verdict — even a well-evidenced one — remains weak evidence. Keep two runs.

Checks on `3bc5ee8`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` 336 pass / 0 fail, full `bun test` 1169 pass / 8 fail
(the known `MarkdownPaneImpl` eight), run with nothing else on the machine.
`prettier --check` clean on the three touched files. The +2 over the `98d3d0c` baseline
of 334 is the two new regression tests.

- **Task 15, round 8** (gpt-5.5 via codex-review, Mode B over `43df638..3bc5ee8`
  restricted to `packages/tui`): two independent codex runs over the same prompt,
  launched in parallel, as rounds 5-7 did. Both returned "Verdict: Changes required"
  and both named the **same single finding**, independently. Nothing else was raised
  by either run. **No code change was made — the finding is real but its fix is
  outside the plan's scope, so it is a user gate.**
  - **Substantiated — `kill -9` on the TUI leaves the backend running forever.**
    What you would see: a TUI that has stopped responding, so you `kill -9` it (or
    your session manager does) — and `taskflow-backend` is still running afterwards,
    holding its data dir, its file watchers and any agent PTYs it had open, with
    nothing left that can stop it. Mechanism: every route that releases the backend
    is rooted in `process.on("exit")` (`releaseOnExit` in `index.ts:69`, handed to
    `startBackend` as `onSpawn`), and SIGKILL runs neither JS signal handlers nor
    `exit` handlers. So neither `child.kill()` nor round 7's `armReaper()` runs at
    all. Independently reproduced before writing this up.
    Repro (one command from the repo root), saved at
    `/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/320e390a-3d80-4f3f-9f39-2d4ed7fbd082/scratchpad/r8/repro-sigkill-leak.sh`
    and copied to `/tmp/repro-sigkill-leak.sh`:

        sh /tmp/repro-sigkill-leak.sh

    It points the TUI at a fake backend that records its pid, `kill -9`s the TUI,
    and checks the backend two seconds later. Output on `3bc5ee8`:
    `RESULT: backend LEAKED (still alive 2s after the TUI was SIGKILLed)`.
    The script is self-contained and cleans up after itself.
  - **Why no fix was committed.** This is not a defect the task introduced. It is
    inherent to the spawn-a-child design the plan gave Task 2, which the plan
    explicitly scopes as mirroring `electron/src/backend-manager.ts` — and the
    shipping Electron app has the *same* leak, in a worse form (`killBackendProcess`
    at `electron/src/backend-manager.ts:161` sends a bare SIGTERM with no escalation
    at all, and there is no orphan detection anywhere in `packages/backend`). Both
    reviewers' suggested fix is a **backend-side** parent-death contract — pass the
    TUI pid down and have the backend shut itself down when orphaned — which lives
    outside `packages/tui` and changes shipping Electron behaviour too. Every
    TUI-side alternative is an architectural addition the plan did not ask for, and
    each carries its own new risk (see the options below). That is a plan-scope
    decision, not a review fix.
  - **Both runs otherwise reported clean**, including every surface the round-8
    prompt pointed them at: the generated reaper script's portability and quoting,
    `spawn()` from inside a `process.on("exit")` handler, `detached: true` +
    `unref()` survival, the pid-reuse window between polls, whether 10s can cut short
    the real backend's shutdown (both traced `packages/backend/src/index.ts`'s
    SIGTERM handler through `sessionLifecycle.prepareForShutdown`,
    `ptyManager.closeAll`, `fileWatcher.stopAll` and `wikiIndex.stopAll`), and
    reaper accumulation across `stop()` call sites. Run A additionally executed
    `bun test packages/tui/src` (336 pass), the typecheck and the lint itself, and
    re-ran the two round-7 regression tests specifically.
  - **Unverified, carried forward:** run B restated the pid-reuse window between the
    reaper's last poll and its `kill -9` as theoretical and explicitly declined to
    treat it as blocking. Not reproduced by either run or by me.
  - Neither run re-raised any carried-forward known-and-accepted item.

## Decisions taken (Task 15 round 8)

- **`reapGraceSeconds` is left unvalidated.** Probed directly: a fractional, zero or
  negative value makes `[ $i -lt 0.5 ]` fail with `integer expression expected`, the
  loop falls through and `kill -9` fires immediately. Only the test passes the option
  (`manager.test.ts:454`, value `1`); no production path can reach it. Run A found the
  same and likewise found no caller that can feed it. Recorded as a latent trap rather
  than fixed, so that round 9 does not re-derive it.

Checks: no code changed this round, so `3bc5ee8`'s recorded checks stand — `bun run lint`
clean, `bun run typecheck` clean across all five packages, `bun test packages/tui` 336 pass
/ 0 fail. Run A re-ran the tui suite itself and reported the same 336.

## User decision (Task 15 round 8)

Asked which of (a) accept for Stage 1, (b) TUI-side guardian, (c) backend-side orphan
shutdown. **User chose (a) + (c)**, the recommendation: accept the leak for Stage 1 so
Task 15 can close, and do the backend-side fix as its own task rather than smuggling it
into a review round. Task 15 is therefore **clear** after round 8, and Task 20 is the
new pending follow-up. (b) is dropped — it carried regression risk in an eight-round
task and would not have fixed the Electron path.

## Known and accepted — carry into every later round's exclusion list

- *`kill -9` on the TUI leaks the backend.* Every route that releases the backend hangs
  off `process.on("exit")`, and SIGKILL runs no JS at all, so neither `child.kill()` nor
  `armReaper()` runs. Reproduced, not disputed — accepted for Stage 1 as parity with the
  shipping Electron app, which leaks the same way and worse. The real fix is Task 20,
  backend-side. Do not re-raise it against `packages/tui`.
- *`reapGraceSeconds` is unvalidated.* A fractional, zero or negative value makes
  `[ $i -lt 0.5 ]` fail with `integer expression expected`, the loop falls through and
  `kill -9` fires immediately. Only `manager.test.ts:454` passes the option, with `1`;
  no production path can reach it. Latent trap, deliberately not fixed.

## Task 19 — plan written

The mouse plan is `docs/superpowers/plans/2026-08-23-taskflow-tui-mouse.md`, commit
`333c04a`. It splits Task 19 into 19.1–19.6 (rows added to the table above) and is
written against the code as it stands at `5caaa3a`, which was read before drafting:
`input/csi.ts`, `input/decode-legacy.ts`, `input/decode-kitty.ts`, `input/keys.ts`,
`input/encode.ts`, `term/tty.ts`, `term/session-terminal.ts`, `term/blit.ts`,
`ui/app.ts`, `ui/routing.ts`, `ui/sidebar.ts`, `ui/session-pane.ts` and `index.ts`.

Decisions the plan takes, so a review round argues with them rather than re-deriving them:

- **`?1000h` + `?1002h` + `?1006h` on the outer terminal; never `?1003h`.** Bare motion
  reporting has no hover UI to serve and would put a packet on the wire per pointer
  move. A child in `any` tracking still gets press, release and drag.
- **The X10 wire form (`CSI M` + three bytes) is decoded even though the TUI never asks
  for it.** `scanCsi` already matches `ESC [ M` as a complete 3-char sequence and leaves
  the three payload bytes in the buffer, where they decode as ordinary characters — a
  click in column 49 sends byte 81, which is `Q`, which is the quit binding. Consuming
  the payload is the fix; parsing it is two more lines. (Unreachable today because
  nothing enables tracking; reachable the moment 19.2 lands.)
- **`InputEvent = KeyEvent | MouseReport`, discriminated on the existing `kind` field**
  (`MouseReport.kind = "mouse"`). Keeps every existing decoder-test assertion compiling
  and green; the wrapper alternative rewrites ~300 lines of passing tests.
- **`MouseReport`, not `MouseEvent`** — the latter is a DOM global.
- **Layout is recomputed per mouse report, not stored from the last render**, so a click
  can never be tested against a stale frame's geometry.
- **`tabSpans` is extracted from `drawTabs` and consumed by it**, so the strip that is
  drawn and the strip that is clicked cannot disagree.
- **`routeMouse` stays pure and knows nothing about sessions.** Whether a report is
  forwarded depends on the child's own `mouseTrackingMode`, which lives in `App`.
- **Tracking gates which events reach the child; encoding decides the bytes.** They are
  orthogonal on the wire. `IModes` has no member for the encoding, so 1005/1006/1015 are
  tracked in `SessionTerminal` by the same `?h`/`?l` handlers that track DECTCEM.
- **The X10 decode path is capped near column 95** by `chunk.toString("utf-8")` in
  `index.ts`. Recorded as a limitation, not fixed: the TUI always requests `?1006h`, and
  the X10 path exists to stop garbage keystrokes, not to be a supported encoding.
- **A mouse report does not drain a held Escape** in legacy mode, so a click inside the
  25ms window is delivered before the Escape it followed.
- **19.6 is a user gate** — a manual smoke test at a real terminal.
- **The child-forwarding half (19.5) cannot be exercised end to end in Stage 1**, because
  `App.sessions` is empty until Stage 2's `SESSION_CREATE`. It is unit-tested here and
  first used in Stage 2, exactly as `encodeForChild` was built in Task 8 and first used
  in Task 15.

Checks: documentation only, no code changed, so `5caaa3a`'s recorded checks stand.

## Task 19 — mouse plan, review round 1

**gpt-5.5 via the `codex-review` skill, Mode B** (`codex exec -m gpt-5.5 -s read-only`),
over `docs/superpowers/plans/2026-08-23-taskflow-tui-mouse.md` at `333c04a` plus the
Stage 1 spec, the parent plan and the thirteen source files the plan modifies. The
prompt named the plan's own decisions and told it to attack them with a concrete
failure rather than restate them. **Eight findings, all eight substantiated and fixed
in `47d9c29`.** No code changed — the plan is a document, so the checks recorded at
`5caaa3a` still stand; `bun run typecheck` was run anyway and is clean at `47d9c29`.

Verified findings, in the order they matter:

1. **The union widening breaks 23 sites, not zero.** The plan claimed discriminating
   `InputEvent` on `kind` "leaves every existing assertion in `decode-legacy.test.ts`
   and `decode-kitty.test.ts` compiling and green untouched". That is false: an
   unnarrowed property read on a union is a type error whatever the discriminant is.
   Measured, not argued — `DecodeResult.events` was widened locally at `98d801c` and
   `bun run typecheck` reported **23 errors**: 12 in `decode-legacy.test.ts`, 9 in
   `decode-kitty.test.ts` (all `result.events[0]?.name` / `?.char`), one in
   `decode-kitty.ts:116` and one in `index.ts:177` (`app.handleKey(ev)` on an
   `InputEvent`). Task 19.1 would have left the tree red through 19.2 and 19.3.
   Fix: 19.1 now owns all of them — a `keyAt(events, i)` narrowing helper for the 21
   test reads, and the `ev.kind === "mouse"` dispatch in `index.ts` moved forward from
   19.4 (dropping reports until 19.4 gives them somewhere to go). Its Verify step ran
   `bun test packages/tui/src/input` and now runs the whole package.
2. **Extra mouse buttons decoded as left clicks.** xterm encodes buttons 8-11 (thumb,
   back, forward) as `128 + (n - 8)`. The plan's `buttonOf` tests bit 64 and then
   `b & 3`, so `CSI < 128 ; 6 ; 8 M` came out as `button: "left"`, 129 as `"middle"`,
   130 as `"right"`. Reproduced by running the plan's own snippet verbatim: it printed
   `left`, `middle`, `right`, `none` for 128-131. A back-button click in the sidebar
   would have moved the selection; in the pane it would have reached the child as a
   left click. Fix: bit 128 is tested first and decodes as `"none"`, with a
   `mouse.test.ts` case for 128/129/130 and a matching `encodeMouseForChild` drop rule.
3. **`routeMouse` could not hit-test tabs.** Its signature took `counts: { tabs: number }`
   while `drawTabs` sizes every tab from its own label (`fitToWidth`/`textWidth` plus
   two padding columns, `session-pane.ts:46-60`). A count cannot say which tab column 34
   is in, so the plan's stated guarantee — "the strip that is drawn and the strip that
   is clicked cannot disagree" — was not implementable as written. Fix: the parameter
   is `ctx: { rows: number; tabs: TabSpec[] }`, `routeMouse` calls
   `tabSpans(layout.paneWidth, ctx.tabs)` itself, the routing tests build real
   `TabSpec[]`, and a new case clicks the second of two unequal-width tabs — the case a
   uniform-width guess gets wrong. Checked for an import cycle: none
   (`session-pane.ts` imports only `render/` and `term/`).
4. **Nothing ever called `encodeMouseForChild`.** 19.5 added the encoder and widened
   `App.sendToChild`, but `routeMouse` returns only UI actions and 19.4's `handleMouse`
   switch had no forwarding branch. A child with `mouseTracking: "vt200"` would have
   received no `SESSION_INPUT` at all, and 19.5's own `app.test.ts` case would have
   failed. Fix: the pane-and-tracking guard is written out in 19.4 as the shape and in
   19.5 as the code, ahead of `routeMouse`.
5. **Wheel double-movement.** Following from 4: with no precedence rule, a wheel notch
   over a pane whose child tracks the mouse would scroll the client's scrollback *and*
   forward the notch, moving the view twice. The interaction-model table already said
   otherwise; 19.4 now states the ordering that makes it true.
6. **`?1016` (SGR-Pixels) was untracked.** The plan tracked 1005/1006/1015 only. A child
   writing `?1002h ?1016h` would have been handed `CSI <0;12;5M` for a click on cell
   (11, 4) and read 12 and 5 as pixels, landing it in its top-left cell. Fix:
   `mouseEncoding` gains `"sgr-pixels"`, tracked by the same `?h`/`?l` handlers, and
   `encodeMouseForChild` returns `""` for it — this client has no pixel geometry and
   guessing a cell size is worse than silence.
7. **A re-attach via history lost the child's mouse modes.** `attach()` already saves
   `applicationCursorKeys` and `bracketedPaste` across `terminal.reset()` and replays
   them on the history fallback (`session-terminal.ts:198-224`, `:248-254`), precisely
   because trimmed scrollback may not contain the sequences that set them. The plan
   said to reset the mouse encoding and nothing about restoring it, so a reconnected
   child came back as `mouseTracking: "none"` and every later click was dropped. Fix:
   both mouse fields join the saved `restore` string, with the mode-to-sequence table
   spelled out, plus a `session-terminal.test.ts` case.
8. **"Append-only" tests that would not compile.** `TtyOptions.mouse` and the two
   `ChildModes` fields are required, which breaks ten existing literals in
   `tty.test.ts` (lines 43, 49, 50, 56, 64, 71, 84, 94, 116, 143), `index.ts:140`, and
   the `legacy: ChildModes` fixture at `encode.test.ts:5` — all marked "(append)" in the
   plan. Fix: the file lists say what has to be edited, and the choice of required over
   optional-with-a-default is recorded (a mode the leave sequence must undo should not
   be enabled by a field someone forgot to pass).

**Insertion-point precision (also raised, also fixed).** The plan said to put the X10
branch "before the existing `isNumericParams` filter"; at HEAD `i += scan.length` runs
*before* that filter (`decode-legacy.ts:107`). Inserted literally where the plan said,
`i` advances twice: reproduced by patching a scratch copy of `decode-legacy.ts` at the
stated line — `decodeLegacy("a\x1b[<0;1;1Mb", "")` returned `["press", "mouse"]`, the
trailing `b` swallowed, against the plan's own expected `["press", "mouse", "press"]`.
The plan now names line 107 explicitly.

Codex's non-findings, spot-checked and agreed: the SGR/X10 coordinate math, the `+32`
legacy offset, `M`/`m` release discrimination, modifier bits 4/8/16, motion bit 32 and
wheel base 64/65 are all correct as written, and both split-report carry paths work
against the real `scanCsi`.

Two claims in the plan that this round checked and left alone, because they hold:
`ScreenBuffer.get` returns a non-nullable `Cell`, so the `?.attrs ?? 0` in 19.3's
session-pane test is redundant but not a lint error —
`@typescript-eslint/no-unnecessary-condition` is off at `eslint.config.js:65`. And
`blitTerminal` reads `active.viewportY` and corrects `cursorRow` for it
(`blit.ts:82`, `:98`), so 19.4's `SessionTerminal.scroll` will be visible.

## Decisions taken (Task 19 mouse plan, round 1)

- **Extra mouse buttons (8-11) decode as `"none"` and are never forwarded**, rather than
  gaining four members of `MouseButton`. Nothing binds them and nothing would.
- **`?1016` SGR-Pixels is tracked in order to be refused.** The client has cell geometry
  and no pixel geometry; a dropped report beats a guessed cell size.
- **`TtyOptions.mouse` and the two `ChildModes` mouse fields are required, not optional
  with a default.** A mode that `leaveSequence` must undo should never be switched on by
  a field someone forgot to pass. The cost is editing eleven existing literals.
- **`routeMouse` takes `TabSpec[]`, not a tab count**, and calls `tabSpans` itself. That
  is the only way the drawn strip and the clicked strip cannot disagree.
- **Task 19.1 owns the whole type-widening blast radius**, including `index.ts` and the
  two decoder test files, rather than letting the tree stay red until 19.4.
- **Mouse reports are decoded and dropped between 19.1 and 19.4.** That is the correct
  intermediate behaviour, not a placeholder: tracking is not enabled until 19.2, and a
  dropped click beats an X10 payload leaking through as keystrokes.

## Task 19 mouse plan — review round 2

**gpt-5.5 via codex-review, Mode B** over the revised plan at `47d9c29`
(a plan has no diff). Prompt at
`.../scratchpad/mouse-r2/prompt.md`; it listed round 1's eight findings and the
nine standing decisions as do-not-restate. Three findings, all reproduced
independently. Fixed in `fd307a3`.

1. **Substantiated, significant — the outbound X10 cap was wrong, and wrong in the
   direction that corrupts input.** The plan said an X10 report is dropped above
   coordinate 223. But `SESSION_INPUT` carries a JavaScript *string*: `App.sendToChild`
   builds it (`ui/app.ts:105`), `packages/backend/src/handlers/session.ts:62` takes it
   as a string, and `packages/backend/src/services/pty-manager.ts:344` hands it to
   `session.pty.write(data)`, which UTF-8-encodes. Repro (a plan has no test to fail,
   so this is the trace):

   ```
   bun -e 'const s = "\x1b[M\x20" + String.fromCharCode(128) + String.fromCharCode(33);
           console.log([...Buffer.from(s, "utf-8")])'
   → [ 27, 91, 77, 32, 194, 128, 33 ]
   ```

   Byte 128 arrives as `194, 128`. The child reads payload `32, 194, 128` — column 162,
   row 96 instead of column 95, row 0 — and the third real byte, `33`, falls out of the
   report as an `!` keystroke. So a click anywhere past column 94 is a wrong click *plus*
   a spurious keypress, and the plan's only test used `col: 300`, which would have passed
   over the whole broken range. Fix: the cap is a zero-based coordinate of 94 (one-based
   95, plus the 32 offset, is 127 — the last single byte), the rule is stated as "any
   emitted byte above 127, button byte included", and the test now pins 94 as deliverable
   and 95 as dropped on both axes. `utf8` (`?1005`) is untouched and correct: that mode
   asks for UTF-8, so `pty.write`'s encoding is what the child wants. `sgr` and `urxvt`
   are decimal ASCII.

2. **Substantiated, significant — 19.4 told the implementer to write code that does not
   compile.** It said the mouse dispatch goes "in both `feed` and `flushHeldEscape`
   (`flushCarry` returns keys only, but its return type widens with `DecodeResult`)".
   `flushCarry` has its own declared return type, `KeyEvent[]`
   (`input/decode-legacy.ts:161`), and does not widen. Reproduced by patching
   `index.ts:166` at HEAD to add the guard and running the real check:

   ```
   $ bun run typecheck
   @taskflow/tui typecheck: src/index.ts(167,17): error TS2367: This comparison appears
   to be unintentional because the types '"repeat" | "press" | "release"' and '"mouse"'
   have no overlap.
   @taskflow/tui typecheck: Exited with code 2
   ```

   Fix: the plan now says only the `feed` loop changes, quotes the exact error, and states
   that `flushHeldEscape` keeps calling `app.handleKey(ev)` unguarded.

3. **Substantiated but downgraded to minor — 19.5's app tests had no stated way to install
   an open session.** `App.sessions` is `private readonly sessions: OpenSession[] = []`
   (`ui/app.ts:35`) with no constructor input and no adder, and no existing `app.test.ts`
   case has ever needed one. Codex called the tests unwritable; that part did not hold.
   Probed it: a test file doing `app["sessions"]` passes `bun run typecheck` and
   `bun run lint` clean at HEAD — TypeScript permits element access to a private member
   and no lint rule here objects. What survives is that the plan left the choice open
   between three different seams. Fix: the plan now names one — element access, no
   production surface added — records why (`AppDeps.initialSessions` would ship a
   constructor parameter whose only caller is a test), and notes that the third case
   ("never reaches a child that did not") needs no seam at all.

**Found by Claude, not by Codex, while verifying:** the plan cited `tty.test.ts` literals
at "lines 43, 49, 50, 56, 64, 71, 84, 94, 116 and 143". Two are wrong — the real lines are
100 and 122, at HEAD and at `98d801c` alike (`git show 98d801c:packages/tui/src/term/tty.test.ts | grep -n "kitty:"`).
The count of ten is right. Corrected in the plan.

Codex's non-findings, spot-checked and agreed: the `decode-legacy.ts` insertion point at
line 107 is right for the current loop; the `ChildModes` blast radius is complete
(`encode.test.ts:5` fixture and `session-terminal.ts:180`); `computeLayout`'s arithmetic
matches `App.render()` (`app.ts:121-139`) including the `Math.min(30, floor(cols/3))`
clamp and `rows - 1`; `xterm-headless.d.ts:1323` really is `mouseTrackingMode`; and
`drawSidebar` maps list index to screen row one-to-one (`ui/sidebar.ts:58-59`), so a
click's row *is* the list index.

## Decisions taken (Task 19 mouse plan, round 2)

- **Outbound X10 is capped at zero-based coordinate 94**, not made to work. Carrying the
  full 223 columns would mean a binary `SESSION_INPUT` path across the whole backend, for
  an encoding the TUI never requests. It is the outbound mirror of the inbound cap already
  accepted in 19.1.
- **The 19.5 app-forwarding tests install their session by element access into `App`'s
  private `sessions` array**, rather than by adding an `AppDeps.initialSessions`
  parameter. Verified clean under typecheck and lint. Stage 2's `SESSION_CREATE` replaces
  the seam.

## Decisions taken (Task 19.1)

- **`MouseButton` is not exported from `input/mouse.ts` yet.** The plan's "Interfaces —
  Produces" list names it, but the plan's own global constraint ("do not export a symbol
  unless another module imports it") wins: nothing imports the name in 19.1, and
  `MouseReport.button` carries the type structurally. 19.5 exports it when
  `encodeMouseForChild` needs to name it in a signature.
- **`build` rejects a negative button byte**, not just a zero coordinate. An X10 payload
  byte below the 32 bias makes `b` negative, and JavaScript's bitwise operators on a
  negative number would still produce a plausible-looking button and modifier set
  (`-1 & 3 === 3`). Covered by `parseX10Mouse > a payload byte below the 32 bias is dropped`.
- **The decoder test files gained `keysOf` alongside the plan's `keyAt`.** The plan
  measured only `events[N]?.name` sites; six of the 21 are `events.map((e) => e.name)`
  over the whole stream, which `keyAt` cannot narrow. `keysOf(events)` asserts every
  element is a key and returns `KeyEvent[]`, so those assertions read unchanged.
- **The widening blast radius measured 21 test sites + `index.ts` at `e00cd13`**, and
  `decode-kitty.ts`'s local array — exactly the plan's count. `flushCarry` still returns
  `KeyEvent[]`, so `decode-legacy.test.ts:58` needed no narrowing.

## Task 19.1 — implementation notes

Base commit `e00cd13`, implemented in `18ad1e9`.

- `packages/tui/src/input/mouse.ts` (new): `MouseButton`, `MouseReport`, `parseSgrMouse`,
  `parseX10Mouse`. Bit 128 is tested before bit 64 and before `b & 3`, so an extra button
  (8-11) decodes as `"none"` rather than left/middle/right. `isDigits` is reused from
  `csi.ts` for the SGR field check, which is what makes `CSI < ; ; M` fail rather than
  decode as 0,0,0.
- `decode-legacy.ts`: `InputEvent = KeyEvent | MouseReport`, `DecodeResult.events`
  widened, and the two branches inserted after the `scan.kind === "invalid"` branch and
  before the existing `i += scan.length` — the placement the plan called out.
- `decode-kitty.ts`: local `events` array type only.
- `index.ts`: the feed loop skips mouse reports with a `continue` until 19.4.
- Tests added beyond the plan's list: `parseSgrMouse` rejects a parameter list with no
  leading `<`; `parseX10Mouse` keeps a wheel direction on `b = 67` (where `b & 3 === 3`
  would otherwise read as the release value); a malformed SGR report is consumed with no
  keystrokes emitted and no carry left behind.

Verification at `18ad1e9`: `bun test packages/tui` → 356 pass, 0 fail;
`bun run lint` and `bun run typecheck` both clean across the workspace.

## Task 19.1 — review round 1

gpt-5.5 via the codex-review skill (Mode B, prompted) over `e00cd13..18ad1e9` restricted
to `packages/tui`. Two findings, both reproduced independently. One fixed in `39299ff`,
one verified but re-accepted as an already-recorded plan decision.

- **Substantiated and fixed — an X10 extra button decoded as a release.** xterm encodes
  mouse buttons 8-11 as `128 + (n - 8)`, so button 11 is `b = 131`, whose low two bits
  are the X10 release value by coincidence. `parseX10Mouse` tested only
  `(b & 3) === 3 && (b & 64) === 0`, so a *press* of that button reported
  `action: "release"`. `buttonOf` already tested bit 128 before the low bits for exactly
  this reason; the release test did not.
  Regression test: `parseX10Mouse > an extra button is a press, not the release sentinel`
  in `packages/tui/src/input/mouse.test.ts` — red on `18ad1e9`
  (`Expected: "press" / Received: "release"`), green on `39299ff`.
  Run with `bun test packages/tui/src/input/mouse.test.ts`.

- **Verified but not a defect — X10 payload bytes are parsed after UTF-8 decoding.**
  Real, and reproduced both ways: `1b 5b 4d 20 c8 21` yields one report at
  `col: 65500` (U+FFFD's code unit minus the 32 bias), and `1b 5b 4d 20 c2 a0 71`
  yields a report at `col: 127, row: 80` with the trailing `q` keystroke eaten as the
  third payload byte. This is the limitation the mouse plan already records and accepts
  under "Known limitation" in Task 19.1's Step 2; the fix Codex proposed — carrying raw
  bytes through the CSI scan — is a change to the whole input pipeline and is what the
  plan explicitly declined. No code change. The plan's paragraph was extended with both
  measured outputs and with why a partial `charCodeAt <= 127` guard is worse than
  nothing, so round 2 does not derive this a third time.

Verification at `39299ff`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 357 pass, 0 fail.

## Decisions taken (Task 19.1, round 1)

- **`parseX10Mouse` stays a faithful X10 decoder.** No payload-byte guard was added for
  the UTF-8 problem. A guard would drop the garbage coordinate but still lose the
  swallowed keystroke, and 19.5 needs the same bit semantics for the outbound direction,
  so a transport-shaped restriction does not belong in the parser.

## Task 19.1 — review round 2

gpt-5.5 via the codex-review skill (Mode B, prompted) over `e00cd13..40a3701` restricted
to `packages/tui`, with round 1's two findings declared settled in the prompt.
**Codex returned "Clear" — zero findings.** It validated the bit decoding, coordinate
handling, carry behaviour for split reads, the kitty delegation and the `InputEvent`
guard in the feed loop, and ran the tui input tests, the tui typecheck and lint.

Reading the diff independently turned up one defect Codex did not, now fixed in
`cbfde10`.

- **Substantiated and fixed — a click split by the escape idle timer quits the TUI.**
  An X10 report is six characters. `decodeLegacy` correctly carries a `CSI M` header
  whose three payload characters have not arrived yet, but `index.ts` arms a 25 ms
  (`ESCAPE_IDLE_MS`) timer on any non-empty carry. When it fires, `flushHeldEscape`
  hands the header to `flushCarry`, which has no event to make of it and returns `[]` —
  and then **clears `carry` anyway**. The payload then arrives bare and decodes as
  ordinary characters. Column 49 encodes as `\x51` = `Q`, which is
  `{ kind: "quit" }` in `routing.ts` and sets `app.alive = false` with no confirmation.
  So a single mouse click, on a terminal using the X10 fallback, whose bytes straddle a
  read boundary, exits the application.

  Fix: `isPartialX10(carry)` in `decode-legacy.ts`; `flushHeldEscape` returns early for
  such a carry instead of clearing it. The payload then completes the report on the next
  read. A header that never receives one swallows the next three characters, which is
  already exactly what the same bytes do when they arrive in a single read — so the
  fallback behaviour is now consistent across the read boundary rather than newly wrong.

  Regression test (behavioural, end-to-end over the real entry point):
  `does not quit on the payload of a click split by the escape timeout` in
  `packages/tui/src/index.test.ts`. It starts the TUI against the fake talking backend,
  writes `\x1b[M\x20`, sleeps 200 ms so the idle timer fires, writes `\x51\x21`, and
  asserts the process is still running. Red on `40a3701`
  (`expect(received).toBeNull() / Received: 0` — the TUI had quit), green on `cbfde10`.
  Run with `bun test packages/tui/src/index.test.ts -t "does not quit on the payload"`.
  Two unit tests in `decode-legacy.test.ts` cover `isPartialX10`'s boundaries and show
  the stranded payload decoding as `["Q", "!"]`.

## Decisions taken (Task 19.1, round 2)

- **The stale-carry timer now has one exception, not a general redesign.** Dropping a
  stale partial CSI is still right for every other shape (`\x1b[1;5` must not merge with
  the next typed key). Only the X10 header is exempt, because it is the one carry whose
  continuation is arbitrary printable characters rather than sequence bytes.
- **No change to `flushCarry`'s signature.** Making it return a retained carry would
  have forced `decode-kitty.ts`'s mid-buffer call site to ignore a value that is
  meaningless there. A predicate at the one call site that owns the timer is smaller and
  reads more plainly.

Verification at `cbfde10`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 360 pass, 0 fail.

## Task 19.1 — review round 3

gpt-5.5 via the codex-review skill (Mode B, prompted) over `e00cd13..f48451a` restricted
to `packages/tui`, with rounds 1 and 2's findings declared settled in the prompt.
**One finding, substantiated and fixed in `436313f`.** Codex also confirmed there are no
`as any`, no `eslint-disable` and no unused exports in the new code, and ran
`bun test packages/tui`, `bun run typecheck` and `bun run lint`.

- **Substantiated and fixed — an out-of-range SGR button became a left click.** JS
  bitwise operators coerce through `ToInt32`, so `parseSgrMouse` reading a button
  parameter of `256` computed `256 & 3 === 0` and reported a plain **left press** at the
  cell the frame named. `build` already refused a negative button and zero coordinates
  precisely so a corrupt frame could not invent a click on the sidebar; it had no upper
  bound, so the guard was defeated by any value above 255.

  Independently reproduced, and the hole is wider than the report said — the existing
  `Number.isInteger` test does not catch large values either:

  ```
  decodeLegacy("\x1b[<256;1;1M", "")                  → press left at (0,0)
  decodeLegacy("\x1b[<4294967296;12;5M", "")          → press left at (11,4)
  decodeLegacy("\x1b[<1000000000000000000000;12;5M", "") → press left at (11,4)
  ```

  Fix: `MAX_BUTTON = 0xff` in `mouse.ts`; `build` rejects `b > MAX_BUTTON`. One byte is
  what the button field is in every encoding this decoder reads, and X10 already tops out
  at 223, so the X10 path is unaffected.

  Regression tests: `parseSgrMouse > a button value outside one byte is dropped, not
  truncated` in `packages/tui/src/input/mouse.test.ts` (covers 256, 2**32 and 1e21, and
  pins 255 as still valid), and the behavioural `decodeLegacy > an out-of-range SGR button
  does not become a left click` in `decode-legacy.test.ts`. Both red on `f48451a`
  (`Received: [{ action: "press", button: "left", … }]`), green on `436313f`. Run with
  `bun test packages/tui/src/input/mouse.test.ts packages/tui/src/input/decode-legacy.test.ts`.

Reviewing the diff independently alongside Codex turned up nothing further. Checked and
found sound: the X10 payload boundary against `scanCsi`'s `length`/`params`/
`intermediates` contract (a payload byte of `0x20` cannot be mistaken for an intermediate
because `scanCsi` stops at the `M` final before the payload begins); `decodeKitty`
delegating a partial X10 carry to `flushCarry` when a kitty sequence follows in the same
read (reachable only from a genuinely truncated report, and dropping is the safe outcome
there); wheel and modifier bit extraction under bit 64 and bit 128; and the idle-timer
hold added in round 2, which is rearmed on every read and cannot leak a timer.

## Decisions taken (Task 19.1, round 3)

- **The bound is one byte, not the set of defined button values.** The largest value any
  encoding actually produces is 191 (`128 + 3 + 4 + 8 + 16 + 32`), but rejecting the
  191–255 gap would encode a table of xterm's current button assignments into a parser
  whose job is the wire format. `0xff` is the field width and does not go stale.
- **Coordinates keep their lower bound only.** SGR names no maximum column, so an upper
  bound there would be inventing a limit; an out-of-range coordinate simply hit-tests to
  no pane in 19.3/19.4, whereas an out-of-range *button* changes the identity of the
  event. Deliberately not widened.

Verification at `436313f`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 362 pass, 0 fail.

## Task 19.1 — review round 4

gpt-5.5 via the codex-review skill (Mode B, prompted) over `e00cd13..e39587d` restricted
to `packages/tui`, with rounds 1-3's findings declared settled in the prompt.
**One finding, substantiated and fixed in `3770749`.** Codex also confirmed there are no
`as any`, no `eslint-disable` and no unused exports in the new code, and ran
`bun test packages/tui`, `bun run typecheck` and `bun run lint`.

- **Substantiated and fixed — a click whose tail was lost ate the next keys typed.** The
  fix from round 2 held a partial X10 header (`ESC [ M` plus 0-2 payload characters)
  instead of flushing it, but `flushHeldEscape` returned on `isPartialX10(carry)` without
  clearing the carry or arming another timer. So the header was held *forever*. A report
  whose payload never arrived — a dropped tail on a slow link — stayed live until the
  next three characters were typed, and those became its payload: a fabricated press at
  whatever cell they encode, with the keystrokes swallowed. Once 19.4 wires mouse events
  through, that is a phantom click on the sidebar.

  Independently reproduced. `bun repl`-equivalent trace against `decode-legacy.ts` at
  `e39587d`:

  ```
  decodeLegacy("\x1b[M\x20", "")   → { events: [], carry: "\x1b[M " }
  isPartialX10("\x1b[M ")          → true   (so flushHeldEscape returns, carry kept)
  decodeLegacy("Q!", "\x1b[M ")     → press left at (48,0), carry ""
  ```

  Typed a minute later, `Q!` should be two key presses; instead they vanish into a click.

  Fix: `MOUSE_PAYLOAD_IDLE_MS = 1000` in `index.ts`. `flushHeldEscape` now arms
  `dropStrandedMousePayload` for a partial X10 carry rather than returning bare, and that
  callback clears the carry without emitting anything — the header is not a key and its
  payload is gone, so there is no event to make of it. The window restarts on every read
  that leaves the carry still partial, so it measures idleness rather than age.

  Regression test: `tui entry point > drops a click header whose payload never arrives` in
  `packages/tui/src/index.test.ts` — sends `ESC [ M SP`, waits 1400 ms, then types `Q` and
  asserts the TUI quits. Red at `e39587d` (`the TUI never quit on a key typed after a dead
  click`), green at `3770749`. Run with `bun test packages/tui/src/index.test.ts`. The
  round-2 test (`does not quit on the payload of a click split by the escape timeout`,
  200 ms split) still passes, which is the point of the 1000 ms window.

Reviewing the diff independently alongside Codex turned up nothing further. Checked and
found sound: byte-at-a-time delivery of a whole X10 report (carry grows one character per
read and the report lands on the sixth); an astral payload character (two code units, so
the sliced payload starts with a lone surrogate whose value exceeds `MAX_BUTTON` and is
rejected); a payload byte below 32 (a negative coordinate, rejected); `CSI SP M`, where
the intermediate keeps `scanCsi` out of the X10 branch; and `decodeKitty` slicing a chunk
around an X10 report, which cannot split the payload at an ESC because every payload byte
is at least 32.

## Decisions taken (Task 19.1, round 4)

- **Discard the stranded header rather than replay it as keys.** `flushCarry` has no
  event to make of `ESC [ M`, and synthesizing Escape / `[` / `M` presses would invent
  three keystrokes the user never typed. Dropping loses a click that was already lost.
- **1000 ms, not `ESCAPE_IDLE_MS`.** The payload is the rest of a write the terminal has
  already begun, so at 25 ms it is usually still in flight; the round-2 test deliberately
  splits it by 200 ms. A second, longer window keeps that case working and still bounds
  how long a dead header can live.
- **The two-byte `ESC [` boundary is left alone.** A read that ends at `ESC [` and then
  idles is flushed as Alt+`[`, so a mouse report split *there* still leaks `M` and its
  payload as keys. Not fixed: `ESC [` is genuinely also a chord, holding it would break
  Alt+`[`, and the ambiguity is the ordinary ESC-timeout tradeoff rather than something
  this task introduced.

Verification at `3770749`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 363 pass, 0 fail.

Note for later: `startBackend > does not accept a port that only appears after the
deadline` in `packages/tui/src/backend/manager.test.ts` is deadline-sensitive and times
out when the machine is loaded (it failed while a Codex review ran concurrently, and
passes on its own and on an idle full run). Pre-existing, unrelated to 19.1.

## Task 19.1 — review round 5 (`ee518be`)

gpt-5.5 via the `codex-review` skill (Mode B, prompted) over `e00cd13..HEAD`,
`packages/tui` only. **Codex returned Clear — zero findings.** It traced the X10 payload
consumption, the incomplete-carry hold, the `App.handleKey` mouse filter and the kitty
delegation path, and ran `bun test` on the five input/entry test files plus
`bun run typecheck`, all green.

Reviewing the diff independently alongside Codex found one thing Codex missed.

- **Substantiated and fixed — a click split mid-report leaked its tail as keystrokes.**
  Rounds 2-4 hardened the X10 form, which is only the *fallback* encoding. The SGR form,
  which is the one the TUI actually asks for, had no protection at all. `flushCarry` has
  no key to make of an incomplete `CSI <` sequence, so it returned `[]` — and
  `flushHeldEscape` then cleared the carry. The tail of the report arrived on the next
  read with no `CSI <` in front of it, so the parameter digits and the final decoded as
  ordinary typed characters. In the sidebar `1` through `9` select a session tab; under
  session focus the whole run is forwarded to the focused agent as if the user had typed
  it.

  Independently reproduced. Trace against `decode-legacy.ts` at `9374b8e`:

  ```
  decodeLegacy("\x1b[<0;50;10", "")  → { events: [], carry: "\x1b[<0;50;10" }
  flushCarry("\x1b[<0;50;10")        → []            (so the carry is cleared)
  decodeLegacy("0;10M", "")          → chars "0" ";" "1" "0" "M"
  ```

  Fix: `isPartialX10` becomes `isPartialMouseReport` and now also returns true for a
  carry that starts `CSI <` and that `scanCsi` calls incomplete. `CSI <` is a
  private-parameter prefix that no key sequence uses, so holding it cannot delay a
  keystroke — unlike an ordinary partial CSI such as `CSI 1;5`, which really can be the
  head of a chord and stays flushable. `MOUSE_PAYLOAD_IDLE_MS` /
  `dropStrandedMousePayload` become `MOUSE_REPORT_IDLE_MS` / `dropStrandedMouseReport`
  and now bound both shapes.

  Regression tests, both in `packages/tui`:
  - `decodeLegacy > a half-written SGR report is held rather than orphaned by the idle
    flush` in `src/input/decode-legacy.test.ts` — red at `9374b8e`
    (`expect(isPartialMouseReport(first.carry)).toBe(true)` received `false`, with the
    assertions above it showing the tail decoding as `0 ; 1 0 M`), green at `ee518be`.
  - `tui entry point > drops a half-written SGR report whose tail never arrives` in
    `src/index.test.ts` — the wedge guard, same shape as the round-4 one. Confirmed
    meaningful by neutering the body of `dropStrandedMouseReport`, which makes it fail
    with `the TUI never quit on a key typed after a dead SGR click`.

  Run with `bun test packages/tui/src/input/decode-legacy.test.ts packages/tui/src/index.test.ts`.

## Decisions taken (Task 19.1, round 5)

- **Hold `CSI <` but not partial CSIs in general.** Extending the hold to every
  incomplete CSI would fix arrows and function keys the same way, but it costs a real
  keystroke: a stranded `CSI 1;5` plus a typed `h` scans as one complete `CSI 1;5h`, so
  the `h` is eaten as the sequence's final byte. `CSI <` has no such ambiguity, so it is
  the only prefix that earns the longer window. This is why the existing
  `isPartialMouseReport("\x1b[1;5") === false` assertion stays.
- **Not a re-litigation of the settled `ESC [` boundary.** That one is a two-byte carry
  `flushCarry` turns into Alt+`[`, a genuine chord. This is a three-or-more-byte carry
  `flushCarry` turns into nothing at all, so clearing it was pure loss.
- **The rename is part of the fix, not tidying.** `isPartialX10` no longer describes what
  the predicate tests, and a stale name on a security-shaped guard is how the next round
  misreads it.

Verification at `ee518be`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 365 pass, 0 fail (363 before, plus the two new
regression tests).

Still standing: `startBackend > does not accept a port that only appears after the
deadline` in `packages/tui/src/backend/manager.test.ts` is deadline-sensitive under load.
Pre-existing, unrelated to 19.1, and it passed on this run.

- **Task 19.1, round 6** (gpt-5.5 via codex-review, Mode B over `e00cd13..4a2318a`
  restricted to `packages/tui`): two findings, both substantiated and fixed in `012049f`.
  Run the repros with
  `bun test packages/tui/src/input/decode-legacy.test.ts packages/tui/src/index.test.ts`.

- **Substantiated and fixed — a stranded report spilled onto the keymap the moment an
  ESC followed it.** Rounds 4 and 5 protected the held run against the *idle timer*.
  Nothing protected it against the next byte. A `CSI <` run followed by ESC scans as an
  `invalid` CSI, and `decodeLegacy`'s recovery for that emits a real Escape press and
  advances one character — so the whole dead report walks out as `[`, `<`, digits and
  `;` before the live input is decoded. It does not need a typed key to trigger: the
  common case is a click whose tail was lost and the *next mouse report* arriving inside
  the drop window, because that starts with ESC too.

  Independently reproduced at `4a2318a`, in both decoders (`decodeKitty` delegates the
  run to `decodeLegacy`, and a following SGR report is not a kitty sequence so
  `nextKittyStart` does not split it away):

  ```
  decodeLegacy("\x1b[<0;50;10", "")            → { events: [], carry: "\x1b[<0;50;10" }
  decodeLegacy("\x1b[<0;1;1M", carry)          → escape, "[", "<", "0", ";", "5", "0",
                                                  ";", "1", "0", then the real click
  ```

  In the sidebar `1` through `9` select a session tab; under session focus the run is
  forwarded to the focused agent as typed input.

  Fix: `scanCsi`'s `invalid` variant now reports `length` — the offset of the byte that
  ruled the sequence out — and `decodeLegacy` discards a `CSI <` run wholesale and
  resumes on that byte. `CSI <` is a private-parameter prefix no key sequence uses, so
  nothing else can be lost with it. Every other invalid CSI keeps the Escape recovery.

  Regression tests in `src/input/decode-legacy.test.ts`, both red at `4a2318a` and green
  at `012049f`: `a stranded SGR prefix is discarded when the next byte rules it out`
  (received 109 lines of key events where none were expected) and `a stranded SGR prefix
  does not swallow the key that follows it` (the same, for a Ctrl+C ending the run).
  `an ordinary invalid CSI still reports a real Escape press` is the non-regression guard
  and passes either way.

- **Substantiated and fixed — typing kept a dead report alive and was swallowed doing
  it.** `MOUSE_REPORT_IDLE_MS` was a duration restarted on every read. A byte typed after
  a stranded `CSI <` is a valid parameter byte, so it joins the carry, decodes to
  nothing, and resets the window — so the keystrokes themselves held the report open
  indefinitely and every one of them was eaten. Round 4 bounded the wedge at one second
  of *silence*; it was never bounded in wall time.

  Regression test: `tui entry point > a dead SGR report cannot be kept alive by what is
  typed after it` in `src/index.test.ts` — writes a headless `\x1b[<0;50;10`, a `1` at
  600ms, then `Q` at 1200ms. Red at `4a2318a` (`the TUI never quit on a key
  typed after a padded dead click`), green at `012049f`.

  Fix: `mouseCarryDeadline`, an absolute deadline set when a partial report is first
  held. `flushHeldEscape` arms the drop timer for whatever is left of it, and drops
  immediately if it has already passed. Only a read that actually decoded an event
  refreshes it.

## Decisions taken (Task 19.1, round 6)

- **Refresh the deadline on decoded events, not on bytes arriving.** A sustained drag
  over a slow link ends most reads mid-report, so an unrefreshable deadline would drop a
  live drag after a second. Every such read also *completes* the previous report, so
  `result.events.length > 0` separates "reports are flowing" from "a dead run is being
  padded" exactly. The one keystroke typed inside the window is still lost — it is
  genuinely ambiguous with the report's own tail, and no rule can recover it.
- **Discard only `CSI <` on an invalid CSI, not every private-parameter run.** Same
  reasoning as the round-5 hold decision: `<` is the only prefix known to be a mouse
  report and nothing else. Widening it would start eating real sequences.
- **`scanCsi` gained a field rather than decode-legacy recomputing the offset.** The scan
  already knows where it stopped; recomputing it from `params.length +
  intermediates.length` in the caller duplicates the scanner's own boundary rules.

Verification at `012049f`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 369 pass, 0 fail (365 before, plus four new
tests).

Independent of Codex: fuzzed 8000 randomized read-splits of mixed key/mouse streams
through both decoders plus the `index.ts` idle-flush rule — no payload byte reached the
keymap, no event lost or duplicated, before or after the fix. Two cosmetic oddities were
noted and left alone, neither with a reachable symptom: `decodeLegacy`'s SGR branch does
not reject intermediate bytes the way its X10 branch does, and SGR coordinates have no
upper bound (only the button does). No terminal emits either shape.

- **Task 19.1, round 7** (gpt-5.5 via codex-review, Mode B over `e00cd13..468dea9`
  restricted to `packages/tui`): two findings. One substantiated and fixed in `2911a80`;
  one already settled by the mouse plan and reverted rather than fixed. Run the repro
  with `bun test packages/tui/src/index.test.ts -t "faster than the idle timer"`.

- **Substantiated and fixed — typing steadily kept a dead report alive after all.**
  Round 6 gave a stranded report an absolute one-second deadline, but nothing reads that
  deadline except the drop timer, and `feed` clears the timer on every read before it can
  fire. Keys arriving closer together than `ESCAPE_IDLE_MS` (25ms) therefore cancel the
  drop over and over, each one buying the dead run another 25ms, and each one is eaten as
  a parameter byte. Round 6 bounded the wedge at one second of silence; it was never
  bounded against sustained input.

  Independently reproduced at `468dea9`: write `\x1b[<0;50;10` (an SGR click whose `M`
  never arrives), then `1` every 8ms for 1100ms, then `Q`. The TUI never quits — every
  digit and the `Q` join the held run instead of reaching the keymap. Under session focus
  the same run is forwarded to the focused agent as typed input.

  Fix: `feed` retires the report itself when a read arrives at or past
  `mouseCarryDeadline`, before decoding, instead of leaving that to a timer the same read
  just cancelled.

  Regression test: `tui entry point > a dead SGR report cannot be kept alive by typing
  faster than the idle timer` in `src/index.test.ts`. Red at `468dea9` on three
  consecutive runs, green at `2911a80` on three.

- **Not a finding — the folded X10 payload is a recorded plan decision.** Codex also
  reported that bytes `1b 5b 4d 20 c2 a1` are a *plain* X10 report (column 163, row 130)
  whose two coordinate bytes are valid UTF-8, so `chunk.toString("utf-8")` folds them
  into one character, the payload reads a byte short, and the next key is taken as its
  third byte. The mechanism is real and I reproduced it — but
  `docs/superpowers/plans/2026-08-23-taskflow-tui-mouse.md` (Task 19.1, "Known
  limitation") already states exactly this case, byte-for-byte, and decides against a
  decoder-side guard: it would turn a wrong click into a dropped click *and still lose
  the keystroke*, and a later binary-stdin change would have to unwind it. I wrote the
  fix and both tests, then reverted them on finding that. What Codex adds is the
  observation that this is not the `?1005` extension — it is reachable in ordinary X10
  mode — so the settled entry below is reworded to say so.

## Decisions taken (Task 19.1, round 7)

- **Check the deadline where the timer was cancelled, not somewhere new.** `feed` already
  clears `carryTimer` as its first act; the deadline check belongs on the next line,
  because that is precisely the moment the only mechanism that could retire the report
  was taken away. Re-arming a drop timer instead would leave the same hole one read later.
- **Reverted the X10 payload guard rather than arguing the plan is wrong.** The plan's
  reasoning holds: the guard is a half-fix, and the real fix is byte-level stdin, which
  is a change to the whole input pipeline and not a review-round patch. If X10 is ever
  promoted from "keep a non-compliant terminal from injecting garbage" to a supported
  encoding, that is the task that fixes it.

Verification at `2911a80`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 370 pass, 0 fail (369 before, plus the new
regression test).

- **Task 19.1, round 8** (gpt-5.5 via codex-review, Mode B over `e00cd13..c49a5bf`
  restricted to `packages/tui`): two findings, both substantiated and both fixed in
  `176d5af`. Run the repros with `bun test packages/tui/src/index.test.ts -t "gets its
  own window"` and `bun test packages/tui/src/input/decode-legacy.test.ts -t
  "intermediate bytes is not read"`.

- **A second click landing while the first is stranded inherited the dead one's
  deadline.** A report whose tail never arrives is held for a second. If another click
  starts inside that second and is itself split across a read, the dead prefix is
  discarded as an invalid CSI and the fresh report takes its place in the carry — but
  that read decoded no events, so the round-6 rule left the deadline where the dead
  report had put it. The fresh report was retired early, and its tail then decoded as
  typed characters: digits pick a session tab, and under session focus the whole run is
  forwarded to the agent as if typed.

  Independently reproduced at `c49a5bf`: write `\x1b[<0;50;10`, wait 900ms, write
  `\x1b[<0;1`, wait 400ms, then write `Q`. Correctly held, that `Q` lands inside a live
  report and is eaten as a parameter byte; on the old code the fresh report had already
  been dropped at the first one's deadline and the TUI quit.

  Fix: `feed` remembers the carry it held going in and refreshes the deadline when the
  new carry is not an extension of it. Only a carry the previous one is a prefix of is
  the same report grown by a few bytes; anything else is a different report, as new as
  one held from an empty carry.

  Regression test: `tui entry point > a mouse report that starts while a dead one is
  held gets its own window` in `src/index.test.ts`. Red at `c49a5bf` on three
  consecutive runs, green at `176d5af` on three. The test sleeps 500ms after the ready
  marker before its first write, because the marker is written from inside `app.init()`
  while stdin is still paused, and an unsettled start would move the deadline the test
  aims between.

- **A CSI with an intermediate byte decoded as an SGR mouse report.** The SGR branch
  matched on `params.startsWith("<")` and a final of `M`/`m` and nothing else, so
  `CSI <0;1;1 M` — parameters, an intermediate `0x20`, then `M` — came out as a left
  click on the origin. The X10 branch two lines above already refuses a sequence with
  intermediates. Round 6 noticed this asymmetry and left it alone as having no reachable
  symptom, which was true only because `feed` still discards every mouse event; at 19.4
  it becomes a fabricated click that moves the sidebar selection.

  Reproduced at `c49a5bf` at decoder level: `decodeLegacy("\x1b[<0;1;1\x20M", "")`
  returns a `press`/`left`/`col 0`/`row 0` mouse event instead of nothing.

  Fix: `scan.intermediates === ""` added to the SGR branch condition.

  Regression test: `decodeLegacy > a CSI carrying intermediate bytes is not read as an
  SGR mouse report` in `src/input/decode-legacy.test.ts`.

## Decisions taken (Task 19.1, round 8)

- **Prefix containment, not a report counter or a carry generation.** The question the
  deadline logic needs answered is "is this the same run I was already holding?", and
  string containment answers it exactly: a partial CSI only ever grows by appending, so
  a carry that does not start with the previous one is necessarily a different sequence.
  A counter bumped in the decoder would put the same fact in two places and have to be
  kept in step with every path that clears the carry.
- **The round-6 rule is narrowed, not reversed.** Refreshing on decoded events is still
  what separates a live drag from a dead run being padded; this adds one more way a read
  can prove it is not padding. Padding a dead run appends parameter bytes to it, which
  always leaves the old carry as a prefix, so the padding case is untouched.
- **Fixed the intermediate-byte asymmetry despite round 6 filing it as cosmetic.** The
  round-6 note was right that nothing observes it today and wrong that this makes it
  safe: `feed`'s mouse-event discard is scaffolding with a removal date on it (19.4), and
  the fix is one condition that makes the two branches agree. Cheaper to close now than
  to rediscover as a phantom click later.

Verification at `176d5af`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 372 pass, 0 fail (370 before, plus the two new
regression tests).

- **Task 19.1, round 9** (gpt-5.5 via codex-review, Mode B over `e00cd13..04c5327`
  restricted to `packages/tui`): one finding, substantiated and fixed in `f828057`. Run
  the repros with `bun test packages/tui/src/input/decode-legacy.test.ts -t "stranded X10
  header"` and `bun test packages/tui/src/index.test.ts -t "stranded is not eaten"`.

- **Substantiated and fixed — a dead X10 header ate the click that arrived next.** The
  X10 branch sliced the three characters after `CSI M` as payload without looking at
  them. An X10 payload character is `32 + value`, so nothing below 32 can be one — and
  ESC is exactly what opens the next report. A header whose payload was lost is held for
  a second; a second click landing inside that second had its own `CSI M` swallowed as
  the dead header's payload (which then failed to parse and was dropped), leaving the
  fresh report's three payload characters to decode as typed characters. A click in the
  49th column sends `Q`, the quit binding.

  This is the X10 twin of the round-8 SGR finding, and the SGR side already had its
  guard: an ESC makes a held `CSI <` run an invalid CSI, which round 6 taught the decoder
  to discard. `CSI M` is a *complete* sequence, so it never reaches that path.

  Independently reproduced at `04c5327`, both at decoder level and end to end.
  Decoder: `decodeLegacy("\x1b[M", "")` then `decodeLegacy("\x1b[M\x20\x51\x21", carry)`
  returns three char events (space, `Q`, `!`) and no mouse event, instead of one left
  press at col 48. End to end: write `\x1b[M`, wait 200ms, write `\x1b[M\x20\x51\x21` —
  the TUI exits 0 rather than staying up. A key rather than a report shows it too:
  `decodeLegacy("\x03", "\x1b[M\x20")` returned nothing, swallowing Ctrl+C.

  Fix: `impossibleX10Byte` scans the collected payload for a character below the 32 bias.
  One found means the report is never completing, so the header is discarded and decoding
  resumes on the offending byte rather than consuming it.

  Regression tests: `decodeLegacy > a stranded X10 header does not eat the report that
  follows it` and `> a stranded X10 header does not swallow the key that follows it` in
  `src/input/decode-legacy.test.ts`, plus `tui entry point > a click that lands while an
  X10 header is stranded is not eaten by it` in `src/index.test.ts`. All red at `04c5327`,
  green at `f828057`; the integration test was run three times on each side.

## Decisions taken (Task 19.1, round 9)

- **Validate the payload, not the carry.** The check goes where the bytes are first
  claimed, so a bad byte is never consumed and never reaches the carry. Teaching
  `isPartialMouseReport` to reject such a carry instead would be a second place holding
  the same rule, and would still leave the same-read case (both reports in one chunk)
  wrong.
- **Discard the valid payload bytes ahead of the bad one too.** They belong to a report
  that provably cannot complete, so they are not keys and emitting them would be the leak
  this fix exists to close. Only the byte that ruled the report out is real input.
- **The whole payload is checked, not just the first byte.** A header can be stranded with
  one or two payload characters already in the carry, and the ESC then lands at index 1 or
  2; checking only index 0 would leave those two cases open.
- **`parseX10Mouse`'s own below-bias rejection is kept.** It is now unreachable from
  `decodeLegacy`, but it is a unit-tested standalone parser and 19.5 reuses this module;
  a parser that trusts its caller is a worse parser.

Verification at `f828057`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 375 pass, 0 fail (372 before, plus the three new
regression tests).

- **Task 19.1, round 10** (gpt-5.5 via codex-review, Mode B over `e00cd13..HEAD`
  restricted to `packages/tui`): Codex reported **no substantive findings**. One finding
  was raised independently by me while reading the code, substantiated and fixed in
  `4554556`. Run the repro with
  `bun test packages/tui/src/index.test.ts -t "an X10 report that starts"`.

- **Substantiated and fixed — a fresh X10 report inherited a dead header's deadline.**
  Round 8 gave a report that starts while another is stranded its own one-second window,
  and tested "is this the same run grown?" by prefix containment: a carry the previous
  one is a prefix of is the same report with more bytes appended. That is exact for SGR,
  where a dead run carries its own parameter digits, so a different run cannot start with
  it. It is wrong for X10, where the dead header and the fresh one are both exactly
  `CSI M`: the fresh report's carry `CSI M` + one payload character starts with the dead
  header, so it was read as the dead one grown by a byte and kept its deadline. It was
  then retired early and its own payload characters decoded as typed input. An X10
  payload character is `32 + value`, so a click in column 49 sends `Q`, the quit binding.

  This is the X10 twin of the round-8 SGR finding, the way round 9 was the twin of
  round 8's other one. Independently reproduced at `c7310b7`: write `\x1b[M` (header,
  payload lost), wait 900ms, write `\x1b[M\x20` (a second click, split), wait 400ms,
  then write `\x51\x21`. Held correctly those two characters complete the second report
  and are consumed; on the old code it had already been dropped at the first header's
  deadline and the TUI quit.

  Fix: the "same run grown" test is now that the read consumed nothing —
  `carry.length === heldLength + text.length`. Both decoders return a suffix of
  `carry + text`, so a carry exactly `text.length` longer is the held run with the new
  bytes appended and the decoder still sitting on its first byte; any other length means
  it moved past the start of what was held, and what it holds now is a different run.

  Regression test: `tui entry point > an X10 report that starts while a dead header is
  held gets its own window` in `src/index.test.ts`. Red at `c7310b7` on three consecutive
  runs, green at `4554556` on three. It sleeps 500ms after the ready marker for the same
  reason the round-8 test does — the marker is written while stdin is still paused.

## Decisions taken (Task 19.1, round 10)

- **"Consumed nothing" replaces prefix containment rather than joining it.** It is
  strictly stronger: a read that consumed nothing always leaves the old carry as a
  prefix, so every case containment caught is still caught, and the X10 case it could not
  express is caught too. Keeping both would be one rule stated twice.
- **The test stays in `feed`, not in the decoders.** `carry.length - heldLength ===
  text.length` is exactly "the decoder returned `buf.slice(0)`", and both decoders
  already guarantee the carry is a suffix of `carry + input`. Adding an offset field to
  `DecodeResult` would put the same fact on the wire for one caller to read.
- **The round-6 rule is untouched.** Padding a dead run appends parameter or payload
  bytes and consumes nothing, so it still fails the refresh test exactly as before.

Verification at `4554556`: `bun run lint` clean, `bun run typecheck` clean across all
five packages, `bun test packages/tui` → 376 pass, 0 fail (375 before, plus the new
regression test). Codex independently ran `bun test packages/tui/src/input` (105),
`bun test packages/tui/src/index.test.ts` (18), typecheck and eslint, all clean — note it
read the working tree, which already carried this fix and its test.

## Task 19.1, round 11

**gpt-5.5 via codex-review, Mode B over `e00cd13..HEAD`** (`packages/tui` only), with the
ten settled decisions listed in the prompt so the round could not re-tread them. One
finding, substantiated and fixed in `984ac93`.

Before the report landed, two independent probes over `decodeLegacy` and `decodeKitty`
found nothing: 20 000 random byte streams built from mouse reports, escape sequences and
ordinary keys, each decoded whole and again at random split points, agreed exactly
(0 mismatches); and over inputs with no kitty `u` sequences, `decodeKitty` agreed exactly
with `decodeLegacy` (0 mismatches). Throwaway probes, not kept — the property they check
is already covered piecewise by the suite.

- **Substantiated and fixed — an intermediate byte did not end the mouse hold.**
  `isPartialMouseReport` gave the second-long mouse drop window to any incomplete
  `CSI <` run, testing only that `scanCsi` came back `incomplete`. A run that has already
  taken an intermediate byte (0x20-0x2f) also scans as incomplete, but it can never be an
  SGR report: the finals `M` and `m` come straight after the parameters. So a dead run
  went on absorbing input for a full second instead of being discarded by the 25ms idle
  flush, and the next printable key landed on it as the sequence's final byte and was
  consumed.

  What the user would see: a mouse report loses its tail over a slow link, the user types
  a space, and the very next letter vanishes — or, if that letter is `Q`, quit is silently
  swallowed.

  The space is what makes this reachable without corrupt input: space is 0x20, an
  intermediate byte, and users type it constantly. Codex's own trigger was the synthetic
  `\x1b[<0;1;1 ` then `Q`.

  Independently reproduced at `d945675` before fixing. Regression tests:
  `decodeLegacy > an intermediate byte ends the SGR hold, so the next key is not
  swallowed` in `src/input/decode-legacy.test.ts` (red: `isPartialMouseReport` returned
  `true` for `\x1b[<0;5;5 `), and `tui entry point > a space typed into a dead SGR report
  ends its hold instead of extending it` in `src/index.test.ts` (red: the TUI never quit
  on the `Q` typed 300ms after the space). Both green at `984ac93`. Run with
  `bun test packages/tui`.

  Fix: the SGR arm of `isPartialMouseReport` now tests that everything after the `CSI` is
  still a parameter byte (`isParamBytes`, 0x30-0x3f), which is all a half-written report
  can be made of.

## Decisions taken (Task 19.1, round 11)

- **`isParamBytes` replaces the `scanCsi` call rather than joining it.** A run of nothing
  but parameter bytes always scans as `incomplete` — the parameter loop runs to the end of
  the buffer and there is no byte left to be a final — so the new test accepts a strict
  subset of what the old one did. Keeping both would state the same fact twice.
- **A new predicate rather than reusing `isNumericParams`.** That one allows only digits
  and `;`, so it would reject the leading `<` of every SGR report. The full ECMA-48
  parameter range is what the hold needs.
- **Nothing is emitted from the dropped run.** `flushCarry` already returns `[]` for it, so
  ending the hold sooner discards the dead sequence rather than fabricating keys from it —
  the same treatment any other stranded partial CSI gets.
- **The one keystroke consumed inside a single read stays consumed.** With the carry
  `\x1b[<0;5;5 ` and `h` arriving in the same read, `h` is still the sequence's final byte
  and still disappears; only the *window* is shortened, so everything after it survives.
  Making a completed-but-nonsense CSI give its final byte back to the keymap is a different
  change and not one this task's plan asks for.

Verification at `984ac93`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 378 pass, 0 fail (376 before, plus the two new
regression tests). One full-suite run showed `startBackend > rejects when the backend
writes a port and then dies` failing; it is an unrelated Task 2 spawn-timing flake —
`packages/tui/src/backend/manager.test.ts` passes in isolation on both the pre-fix and the
post-fix tree, the next full-suite run was 378/0, and nothing in this commit touches
`src/backend`. Codex independently ran `bun test packages/tui/src/input`,
`bun test packages/tui`, typecheck and lint, all clean — it read the tree before the fix,
so its clean runs are of the defective code, not of the fix.

## Task 19.1, round 12

**gpt-5.5 via codex-review, Mode B over `e00cd13..HEAD`** (`packages/tui` only), with the
seventeen settled decisions listed in the prompt and the round-11 split-invariance property
called out as already covered. Codex returned **one finding, not substantiated as a defect
of this diff**. Nothing found independently either. **Task 19.1 is clear — no code changed
this round.**

Independent work before and alongside the report, all clean, all throwaway probes:

- **`feed`'s state machine over a virtual clock, well-behaved input.** 20 000 runs of
  complete SGR reports and printable keys, split at arbitrary offsets from `CSI <` onward
  and delivered with 30-230ms gaps, compared against feeding each token whole:
  0 mismatches.
- **`feed` over stranded reports.** 20 000 runs: a truncated SGR or X10 head, then more
  than a second of idle, then 1-4 keys in one or two reads. Every key survived, no mouse
  event was fabricated: 0 failures.
- **`feed` under continuous fast typing across the deadline.** 20 000 runs of 200 keys at
  1-20ms gaps into a stranded head. Exactly one key is lost per run, and it is the
  round-11 case: a typed space is an intermediate byte, so the run stops being a partial
  report, and the next printable key within `ESCAPE_IDLE_MS` lands on it as the CSI's
  final byte. That is the round-11 decision verbatim, only reached across a read boundary
  rather than inside one read — same rule, same cause, so it stays settled.

- **Not substantiated — "the SGR mouse carry has no byte-length cap inside the
  one-second hold window."** Codex called this an arbitrary memory spike or OOM reachable
  from a paste or a hostile stdin. The retention is real; attributing it to the mouse work
  is not. Two measurements:

  `decodeLegacy("1".repeat(1_000_000), "\x1b[<")` returns a carry of 1 000 003, and
  `decodeLegacy("1".repeat(1_000_000), "\x1b[")` — no `<`, so `isPartialMouseReport` is
  `false` and nothing this task added is involved — returns 1 000 002. The bytes are held
  by `decodeLegacy`'s incomplete-CSI carry, which predates Task 19.1.

  Modelling base `feed` (`e00cd13`) against current `feed` over a drip of parameter bytes,
  peak carry in bytes:

  | drip gap | `CSI <` prefix | `CSI ` prefix |
  |---|---|---|
  | 10ms (faster than the idle flush) | base 500 003 **and still growing**, current 99 003 | base 500 002, current 500 002 — **still unbounded** |
  | 40ms (slower than the idle flush) | base 3, current 24 003 | base 2, current 2 |

  So the mouse hold is what *bounds* the fast-drip case — `feed` cancels the idle timer on
  every read, so at base a stream arriving faster than 25ms apart is held forever, and the
  one-second deadline is the only thing that ever retires it. The TUI's worst case is
  unchanged by this diff and is reached with no `<` at all, on the path the mouse work does
  not touch. Capping only the held mouse run would leave that path open — an adversary
  drops the `<`.

  The one place the mouse hold is worse than base is the slow drip: at a 40ms gap the idle
  flush used to clear the carry every read, and now up to one second of input accumulates
  first. Bounded by one second of stdin throughput, and the price of the hold the task
  exists to add.

## Decisions taken (Task 19.1, round 12)

- **The finding is recorded as new Task 21 rather than fixed here.** It is pre-existing, it
  is not specific to mouse input, and the only fix that closes it is a cap on any held CSI —
  which changes non-mouse key handling and belongs outside Task 19.1's scope. Same treatment
  Task 15 round 8's out-of-scope finding got as Task 20.
- **The cross-read form of the round-11 intermediate-byte case stays settled.** The probe
  reaches it through a read boundary inside the 25ms window rather than inside one read, but
  the mechanism and the rule are identical, and round 11 already decided a nonsense CSI keeps
  the one final byte it consumed.

Verification at `7cc4e54`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 378 pass, 0 fail. Codex independently ran the same three
and reported them clean. No code changed this round, so the tree is `7cc4e54` unmodified.

## Task 19.2 — implemented

Base commit `3829f83`, implementation commit `5345824`.

`TtyOptions` gains a required `mouse: boolean`; `enterSequence` appends
`\x1b[?1000h\x1b[?1002h\x1b[?1006h` after the kitty push when it is set. `index.ts` reads
the flag as `process.env.TASKFLOW_TUI_NO_MOUSE === undefined`. `leaveSequence` is untouched
and still emits the full mouse-off run unconditionally. The ten existing `TtyOptions`
literals in `tty.test.ts` were given an explicit `mouse: false`, so nothing they already
pinned moved.

Tests added (all in `packages/tui`, run with `bun test packages/tui`):

- `enterSequence > the enter sequence turns mouse tracking on in SGR encoding` — the three
  modes are present and `?1006h` comes after `?1000h`.
- `enterSequence > mouse: false enables no tracking at all`.
- `leaveSequence > turns tracking off even when it was never enabled`.
- `leaveSequence > everything the enter sequence enables, the leave sequence disables` — the
  invariant test: it splits the enter sequence on `CSI ?`, and for every `<digits>h` it finds
  requires the matching `<digits>l` in the leave sequence. Adding a mode to the enter side
  without a restore fails it.
- `tui entry point > enables mouse tracking on entry, and TASKFLOW_TUI_NO_MOUSE turns it off`
  — end to end against `erroringBackend`, which enters the terminal before failing. Verified
  red by pinning `mouse` to `false` in `index.ts`: `Expected to contain "\x1b[?1000h"`,
  received a capture with only the alt-screen and leave bytes.

`runTui` in `index.test.ts` gained an optional env-overrides argument, defaulting to `{}`,
so the existing call sites are unchanged.

## Decisions taken (Task 19.2)

- **`mouse` is required, not optional-with-a-default.** The plan's reasoning stands: a mode
  the leave sequence has to undo should never be switched on by a field someone forgot to
  pass. The cost is the ten literals, all mechanical.
- **The opt-out is an env var, not a flag.** `index.ts` has no argument parser, and
  `TASKFLOW_TUI_NO_MOUSE` costs one line. Any value opts out — the test uses `1`, but the
  check is `=== undefined`, so `TASKFLOW_TUI_NO_MOUSE=` (empty) also opts out. That is the
  friendlier reading for a variable whose only job is to be present.

Verification at `5345824`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 383 pass, 0 fail (378 before, plus the five new tests).

## Task 19.2, round 1

**gpt-5.5 via codex-review, Mode B over `3829f83..HEAD`** (`packages/tui` only), with the two
Task 19.2 decisions and the unconditional `MOUSE_OFF` called out as settled. Codex returned
**one finding, substantiated and fixed**. Fix commit `a7af6dd`.

- **Confirmed — `runTui` let an ambient `TASKFLOW_TUI_NO_MOUSE` decide the mouse tests.**
  `runTui` spread the whole of `process.env` into the child, and the entry point reads the
  opt-out from its own environment, so a developer or CI job that happens to have the
  variable set saw the new default-on assertion fail against correct code.

  Repro, red before the fix:
  `TASKFLOW_TUI_NO_MOUSE=1 bun test packages/tui/src/index.test.ts -t "enables mouse tracking"`
  → `Expected to contain: "\u001B[?1000h"`, received a capture with only the alt-screen and
  leave bytes. Green after. Codex could not run this itself — its read-only sandbox hit
  `EPERM` in the repo-root test preload before reaching the assertion — so it was reproduced
  here independently.

  Fixed by destructuring `TASKFLOW_TUI_NO_MOUSE` out of the inherited copy, so only what a
  case passes explicitly reaches the entry point. The opt-out branch is untouched, and a
  later case wanting the empty-string form can still pass it.

Independent work alongside the report:

- **The invariant test really is red-able.** Temporarily extending `MOUSE_ON` with
  `\x1b[?1003h\x1b[?2004h` failed `everything the enter sequence enables, the leave sequence
  disables` with `Expected to contain: "\u001B[?2004l"`, and correctly ignored the `1003h`
  the leave sequence already restores. Tree restored afterwards.
- **Mouse reports cannot leak to a child or to the keymap.** `decodeKitty` delegates every
  non-`u` sequence to `decodeLegacy`, so SGR and X10 reports become `kind: "mouse"` events
  under both decoders and hit the `continue` in `feed`. The one path that could release a
  half-report as keys — `decodeKitty` calling `flushCarry` on a legacy carry when a kitty
  sequence follows it in the same read — cannot: `flushCarry` drops a partial CSI and only
  ever emits Escape or the two-byte Alt chords.
- **Nothing else resets the modes.** No `RIS`, soft reset, or second `?1049h` anywhere in
  `packages/tui/src`, so tracking cannot be silently switched off after entry.
- **Found independently: the `feed` comment was stale.** It still claimed "19.2 is what turns
  tracking on, so no report can reach here yet", which this task makes false. Corrected in
  the same commit.

## Decisions taken (Task 19.2, round 1)

- **The env strip goes in `runTui`, not in each mouse case.** Every case that spawns the entry
  point wants a known environment, not just the two new ones, and one destructure covers all
  of them.
- **Wheel and native selection stop working until 19.4, and that is accepted.** With `?1000h`
  and `?1002h` on, the terminal reports wheel and drag instead of handling them, and `feed`
  drops those reports. It is the staged cost the plan chose, and `TASKFLOW_TUI_NO_MOUSE` is
  the way out until 19.4 routes them.

Verification at `a7af6dd`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 383 pass, 0 fail. Codex independently ran the same three
and reported them clean.


## Task 19.2, round 2

**gpt-5.5 via codex-review, Mode B over `3829f83..HEAD`** (`packages/tui` only), with the four
Task 19.2 decisions and round 1's env-inheritance fix called out as settled. Codex returned
**zero findings** — verdict "Clear". It checked the mode numbers against xterm `ctlseqs`
(`1000`, `1002`, `1003`, `1006` set/reset entries and button-event tracking), confirmed the
enable set is covered by the disable set, and traced the legacy and kitty decoder paths to
confirm that neither a complete nor a partial report can become a key event. It ran no tests
(read-only sandbox), so all validation below is local.

**Task 19.2 is clear.** No code changed this round; nothing to commit but this record.

Independent verification done here rather than taken on trust:

- **Both new negative assertions are red-able**, so neither passes vacuously.
  - Making `MOUSE_ON` unconditional in `enterSequence` failed `mouse: false enables no tracking
    at all` with `Expected to not contain: "ESC[?100"`, received
    `ESC[?1049h ESC[?25l ESC[?1000h ESC[?1002h ESC[?1006h`.
  - Dropping the `?1002l` reset from `MOUSE_OFF` failed the invariant test `everything the
    enter sequence enables, the leave sequence disables` with
    `Expected to contain: "ESC[?1002l"`.
  - Command for both: `bun test packages/tui/src/term/tty.test.ts`. Tree restored after each.
- **No construction site can drift.** `grep` for `new Tty(`, `enterSequence(`, `leaveSequence(`
  across `packages/tui/src` finds one production site (`index.ts:151`) and the test literals,
  every one passing `mouse` explicitly — the required-field decision holds with no hole.
- **Re-read the carry path for leaks.** `isPartialMouseReport` recognizes both the `CSI M`
  X10 header and the `CSI <` SGR head, and `flushCarry` drops a partial CSI rather than
  emitting it, so a half-arrived report cannot reach the keymap by either route.

Verification at `16d9aeb` (code unchanged since `a7af6dd`): `bun run lint` clean, `bun run
typecheck` clean across all five packages, `bun test packages/tui` → 383 pass, 0 fail.


## Task 19.3 — implementation

Base commit `db844f4`, implemented in `ec39171`. Built exactly what the plan specifies.

- **`ui/layout.ts` — `computeLayout(cols, rows, zoomed): Layout`.** `SIDEBAR_WIDTH` and the
  geometry moved out of `App.render` verbatim, with `paneHeight` clamped at zero so a
  one-row terminal gives the blitter a rect rather than a negative height. `App.render` now
  draws from `layout` — the same numbers a click will be tested against.
- **`tabSpans(width, tabs)` extracted from `drawTabs`.** The shared cursor loop lives in a
  private `layoutTabs`, which returns each fitting tab's `{start, end, label, active}`;
  `drawTabs` paints those spans and `tabSpans` is the positions-only public view. Sharing
  one loop is what makes it impossible for the strip that is drawn and the strip that is
  clicked to disagree.
- **`routeMouse(report, layout, ctx)` in `routing.ts`.** Pure, region-then-button, sidebar
  tested first. `Action` gains `select`, `open-tab`, `scroll` and `focus`; `App.handleKey`'s
  switch has a `default`, so the new kinds are inert until 19.4 wires them.

Decisions taken:

- **`tabSpans` drops the label rather than typing it away.** `layoutTabs` needs the label
  and the active flag; returning that object under a narrower declared type would leave the
  extra fields present at runtime for a caller to start depending on. It maps to
  `{start, end}` instead — one small allocation per tab strip, on mouse reports only.
- **`drawTabs` reads `active` off the span, not `tabs[i]`.** Indexing back into the input
  needed a `?.active === true` that `no-unnecessary-boolean-literal-compare` rejects, and
  carrying the flag through `layoutTabs` removes the index correspondence entirely.
- **A tab opens on press only; the sidebar also selects on drag.** The plan gives the
  sidebar press-or-drag so a held drag keeps moving the selection, and gives the tab strip
  a plain left press. A drag across the strip therefore opens nothing.

Independent verification that the new tests are not vacuous:

- **The drawn strip and the hit-tested strip really are pinned together.** Replacing
  `tabSpans` with a uniform 10-column guess reddened four tests, including
  `tabSpans > matches the columns drawTabs actually paints` and
  `the second tab is where drawTabs paints its highlight, whatever the first is called`.
- **`routeMouse` really consults the spans.** Replacing its `findIndex` over `tabSpans` with
  `Math.floor(x / 10)` reddened
  `routeMouse > a click on the second tab opens the second tab, whatever the first one's width`.
- Command for both: `bun test packages/tui/src/ui`. Tree restored after each; `git diff`
  confirmed clean before committing.

Verification at `ec39171`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 409 pass, 0 fail (383 before, plus 26 new).

## Task 19.3, round 1

**gpt-5.5 via codex-review, Mode B over `db844f4..HEAD`** (`packages/tui` only), with the
three Task 19.3 decisions called out as settled and the coordinate-frame / off-by-one /
region-boundary / drift questions named explicitly. Codex returned **zero findings** —
verdict "Clear". It compared `computeLayout` number for number against the removed inline
`App.render` arithmetic (zoomed case and clamp included), checked the `end`-exclusive span
convention against both consumers, and confirmed the sidebar-before-tab-strip ordering and
the unbound buttons. It ran no tests (read-only sandbox).

**Findings raised here instead, both substantiated by surviving mutations.** Codex's report
was clean, so these came out of a mutation pass run locally: every invariant the task claims
was broken one at a time to see whether a test noticed.

1. **The `paneHeight` clamp was untested.** `layout.test.ts`'s "a one-row terminal leaves the
   pane no height rather than a negative one" is vacuous for the thing it names: at
   `rows = 1`, `rows - 1` is already 0, so it passes with the clamp and without it. Replacing
   `Math.max(0, rows - 1)` with `rows - 1` left all 107 tests green.
2. **The sidebar/pane boundary column was untested.** Nothing asserted which side owns
   `col === sidebarWidth`. Widening the sidebar test to `col <= layout.sidebarWidth` — which
   hands the pane's first column to the sidebar, exactly the off-by-one this task exists to
   prevent — also left all 107 green.

Neither is a behaviour bug: the shipped code is correct on both. They are holes in the net,
and this task's whole point is that the net catches this class of error.

**Fixed in `10e7b0f`** by adding the two missing tests. Both were confirmed red-able against
the mutations that motivated them, in both directions:

- `computeLayout > a zero-row terminal leaves the pane no height either` fails with
  `Expected: 0, Received: -1` when the clamp is dropped.
- `routeMouse > the sidebar owns its last column and the pane owns the first` fails under
  `col <= layout.sidebarWidth` **and** under `col < layout.sidebarWidth - 1`, so it pins the
  boundary from both sides rather than only one.
- Command for both: `bun test packages/tui/src/ui`. Tree restored after each mutation;
  `git status` confirmed clean before committing.

Decisions taken:

- **The zero-row test's comment says the clamp is defensive, not currently reachable.** The
  first draft claimed `process.stdout.rows` can report 0 during a resize; `index.ts:159` is
  `process.stdout.rows || 24`, which turns a zero into 24, and there is no SIGWINCH handler
  yet — so the claim was false and was rewritten rather than left as a plausible-sounding
  comment. The test still earns its place: it guards the clamp for the resize path that will
  call `computeLayout` directly.

Other things checked here that produced no finding:

- **The remaining mutations were caught.** `paneY: 1 → 0` reddens "the tab strip owns row 0
  and the pane the rest"; dropping `"drag"` from the sidebar's `pressed` reddens "a left drag
  in the sidebar keeps selecting"; `x < span.end → x <= span.end` reddens "a click on the
  second tab opens the second tab, whatever the first one's width" with `index: 0` for
  `index: 1`.
- **Boundary sweep by direct probe**, not by reading. `col = sidebarWidth - 1` → `select`,
  `col = sidebarWidth` → `focus`, `col = cols - 1` at the last pane row → `focus`,
  `col = cols` → `none`, `row = -1` → `none`, a click at each span's `start`, `end - 1` and
  `end` → the tab painted there and then `none` past the last.
- **`drawTabs` and `tabSpans` do not drift on the hard inputs.** Swept `width` 1-8 for two
  ASCII tabs and 5-10 for a wide-glyph label (`日本語`), comparing spans against the painted
  cell widths: every span matches the columns painted, a wide glyph keeps its width-2 cell
  plus width-0 continuation, and a tab squeezed to 1-2 columns is drawn as the padding it has
  room for and hit-tests to exactly those columns. The two can disagree only if `layoutTabs`
  is bypassed, and nothing bypasses it.
- **The negative-column case is unreachable, so it is not a finding.** `routeMouse` would
  treat `col = -1` as a sidebar click, but `build` in `input/mouse.ts` rejects any report with
  `x < 1` or `y < 1` before a `MouseReport` exists, so no parser can produce one.

Verification at `10e7b0f`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 411 pass, 0 fail (409 before, plus the 2 new).

## Task 19.3, round 2

**gpt-5.5 via codex-review, Mode B over `db844f4..HEAD`** (`packages/tui` only), with the
three Task 19.3 decisions and round 1's zero-row-comment decision called out as settled, and
round 1's outcome stated so the round would not repeat it — the brief pointed the effort at
the two new tests in `10e7b0f`, at whether the `drawTabs` extraction is behaviour-preserving
against `db844f4`, at the `App.render` hoist, and at the edges round 1's probe did not sweep.
Codex returned **zero findings** — verdict "Clear". It ran no tests (read-only sandbox).

**No findings raised here either.** Everything Codex asserted was re-checked locally rather
than taken on its word, and each check is below with what was actually run. No code changed
this round; the only commit is this handoff entry.

Verified independently:

1. **The `drawTabs` extraction is behaviour-preserving — by differential sweep, not by
   reading.** `drawTabs` as it stood at `db844f4` was copied verbatim into a throwaway test
   beside the current one, and both were run against the same `ScreenBuffer` over the cross
   product of `x0` ∈ {0, 5, 30}, `width` 0-24, two tabs drawn from a 12-label set (empty,
   ASCII, over-long, `日本語`, `日本語テスト`, a combining-mark-only cluster, `⚠️ warn`, a
   regional-indicator flag, a tab/newline label, 60 `x`s), each of the three active-tab
   positions, plus zero-, three- and twelve-tab strips at `width` 0-40. **32,564 cases, every
   one cell-for-cell identical**, comparing the full 120-column row so a write past the strip
   would show. The harness was confirmed non-vacuous: perturbing the copied implementation's
   `cols` by one turned it red immediately. The file was deleted afterwards — it duplicates a
   deleted implementation and has no place in the tree; `git status` clean before committing.
2. **`layoutText` returns exactly `cols` cells for every input**, which is what makes the
   extraction sound rather than coincidental. It breaks at `cells.length >= cols`, refuses a
   wide glyph that would overrun (`cells.length + 2 > cols`) and pads the remainder — so the
   old `cursor`, which advanced once per emitted cell across the whole strip, lands exactly on
   `span.end` for every tab. That is the invariant the hoist depends on: had `layoutText` ever
   under-filled, the next tab's `room` would differ between the two versions.
   `packages/tui/src/render/text.ts:319-339`.
3. **Both round-1 tests go red under the mutations that motivated them**, re-run here rather
   than trusted from round 1's record: dropping `Math.max(0, rows - 1)` reddens
   `computeLayout > a zero-row terminal leaves the pane no height either`, and
   `col < layout.sidebarWidth → col <=` reddens
   `routeMouse > the sidebar owns its last column and the pane owns the first`. One failure
   each, 108 passing alongside. Command: `bun test packages/tui/src/ui`. Tree restored with
   `git checkout` after each; `git status` clean.

Codex's one observation that was not a finding: `App.render`'s inline arithmetic and
`computeLayout` differ at `rows = 0` (`-1` against `0`) with no drawn-output difference. That
is the clamp this task added on purpose, and round 1 already settled that `index.ts` cannot
pass a zero today — it is the reason the zero-row test exists, not a defect.

Verification at `130d365`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 411 pass, 0 fail (unchanged — no code moved this round).

## Task 19.4 — implementation

Base commit `4e89f26`. Commit `adf7c5a` — "feat(tui): bind mouse clicks and the wheel to the UI".

What landed, exactly as the plan scoped it:

- **`App.handleMouse(report)`** (`packages/tui/src/ui/app.ts`). Recomputes the layout from
  `deps.cols`/`deps.rows`/`zoomed`, asks `routeMouse` with `{ rows: this.sidebarRows.length,
  tabs: this.tabSpecs() }`, and applies the action: `select` sets the row *and* pulls focus
  back to the sidebar, `move` steps the selection, `open-tab` sets `activeSession` and focuses
  the session (only when the tab exists), `focus` sets the target, `scroll` calls
  `SessionTerminal.scroll` on the active session if there is one.
- **Two clamps extracted, per the plan's Step 2.** `selectRow(index)` and `selectTab(index)`
  are now the only ways the selection and the active tab move, and `handleKey` was rewritten
  to go through them — so a click and a keypress cannot disagree about the bounds. `setRows`
  shares the same `clampIndex` free function. `selectTab` returns a boolean so a click on a
  strip with no such tab does not move focus into a pane that did not change.
- **`tabSpecs()`** hoists the label list out of `render`, so the strip that is hit-tested is
  the strip that was painted rather than a second guess at it.
- **`SessionTerminal.scroll(lines)`** — `this.terminal.scrollLines(lines)`, a method rather
  than a reach through the public `terminal` from the UI layer, as the plan requires.
- **`index.ts`'s `feed` loop** — 19.1's `if (ev.kind === "mouse") continue;` became
  `if (ev.kind === "mouse") app.handleMouse(ev); else app.handleKey(ev);`. `flushHeldEscape`
  was left untouched, for the `TS2367` reason the plan records.

Not done here, on purpose: the child-first-refusal guard ahead of `routeMouse` belongs to
19.5, and `App.sessions` is empty for the whole of Stage 1 anyway.

**Every new test was mutation-checked rather than merely written.** Each was run against a
deliberately broken implementation and confirmed red, then the tree was restored from a
scratchpad copy (`git checkout` is not safe here — it reverts to HEAD, which is the base
commit, silently discarding uncommitted work; that happened once mid-task and the
implementation had to be reapplied).

| Mutation | Test that went red |
|---|---|
| `select` no longer sets `focusTarget` | `a click on a sidebar row also takes focus back from the session` |
| `focus` action ignored | `a click in the pane focuses the session` |
| `move` action ignored | `the wheel over the sidebar moves the selection`, `the wheel stops at the ends of the row list` |
| `selectRow` drops its clamp | `the wheel stops at the ends of the row list` |
| `?.` → `!` on the `scroll` branch | `the wheel over an empty pane is harmless` |
| `scroll` made a no-op | `scroll moves the viewport back over the scrollback and returns to it` |
| `feed` loop back to `continue` | `a click reaches the app rather than being dropped by the feed loop` |

Two things that check produced, worth keeping:

1. **The clamp test only bites without an intervening `render()`.** `render` calls `setRows`,
   which re-clamps every frame, so eight wheel-downs followed by a render hide an unclamped
   `selectRow` completely. The test now runs the overshoot and the notch back in one go and
   renders after both — that is the only arrangement that distinguishes clamped-per-step from
   clamped-at-frame. The comment in the test says so, so a later edit does not "tidy" the
   render back in and quietly gut it.
2. **The `index.ts` wiring is pinned end-to-end, not just by the unit tests.** `feed` has no
   unit seam, so `a click reaches the app rather than being dropped by the feed loop` spawns
   the real TUI, sends `CSI <0;41;6M` (column 40, row 5 — inside the pane at the 80x24 pipe
   fallback, sidebar 26 wide), then sends `Q`. With the wiring in place focus is on the session
   and `Q` goes to a child that does not exist, so the process stays up; with 19.1's `continue`
   restored it quits. Confirmed red against the reverted loop.

Coverage gap, recorded so a review round does not re-derive it: the `open-tab` and the
non-empty `scroll` branches of `handleMouse` cannot be reached from a test today. `sessions`
is private and nothing in Stage 1 fills it, which is the same position the pre-existing
`select-tab` key path is already in. Both are covered at the `routeMouse` level in
`routing.test.ts`; the `App` half waits for Stage 2.

Verification at `adf7c5a`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 420 pass, 0 fail (411 → 420: eight new `App` tests, one
new `SessionTerminal` test, one new entry-point test, and one pre-existing count unchanged).

Next step: review Task 19.4, round 1.
One standard gpt-5.5 review via the codex-review skill over `4e89f26..adf7c5a`, restricted to
`packages/tui`. Points worth putting in the brief so the round is not spent re-deriving them:
the child-first-refusal guard is 19.5's, not a gap here; `flushHeldEscape` is deliberately
left calling `app.handleKey` unguarded (`TS2367`); mouse reports deliberately do not drain
`pendingEscape`; and the `open-tab`/`scroll` coverage gap above is structural until Stage 2.
After 19.4 is clear: 19.5, 19.6 (**user gate — manual smoke test**), then Tasks 16-18, then
Tasks 20 and 21 (each needs its own plan).

## Task 19.4 — review round 1

Base `4e89f26`, head `adf7c5a` (code) / `822682f` (docs). One standard gpt-5.5 review via
the codex-review skill, Mode B (the brief carries the plan's requirements and the four
deliberate decisions, so the round was not spent re-deriving them). Codex read the repo,
ran `bun test` over the four touched suites (108 pass, 0 fail) and returned **zero
findings** — verdict "Clear".

**No findings raised here either. Task 19.4 is clear.** Codex's clean verdict was not
taken on its word: the one thing in this task that could regress silently is the
`handleKey` rewrite through the new helpers, and that was checked differentially rather
than by reading.

Verified independently:

1. **`handleKey` is behaviour-identical to the pre-19.4 implementation — by differential
   sweep.** `app.ts` at `4e89f26` was snapshotted as an oracle class beside the current
   one, and both were driven by the *same* key sequences with their frames compared after
   every single key (not just at the end, so a divergence a later clamp would hide still
   shows). Domain: all 18 keys the sidebar keymap can observe (arrows, `j`/`k`, `z`,
   `1`/`2`/`9`, `n`/`s`/`q`/`?`, Enter, Ctrl+Esc, bare Esc, a chorded `j`, a release, a
   repeat) × 4 store shapes (0, 1, 4, 9 projects with their tasks) × 3 geometries
   (60x10, 12x3, 200x40) × kitty on and off × 200 deterministic pseudo-random sequences
   each (LCG-seeded, so a red run is repeatable). Compared: the full painted frame
   cell-by-cell (char, attrs, fg, bg), `focus` and `running`. **31,037 cases, every one
   identical.** Non-vacuity confirmed: perturbing `clampIndex` to `Math.min(index, length)`
   turned it red within 15,546 assertions.
2. **The one behaviour the extraction *did* change is unobservable, which is why the
   sweep stayed green.** `selectTab` added an `index < 0` guard the old inline
   `if (action.index < this.sessions.length)` did not have. Reverting just that guard and
   re-running the sweep passed all 31,037 cases — `route` only ever emits tab indices 0-8
   (from chars `1`-`9`, `routing.ts:122-128`), so no keymap input can reach it. A strict
   safety addition, not a behaviour change.
3. **Mouse hit-testing agrees with the painted frame, swept exhaustively.** Every
   clickable cell of 6 geometries (60x10, 12x3, 24x6, 200x40, 3x2, 1x1) × 4 list lengths
   (0, 1, 4, 12 rows) × zoomed and not: **70,296 cells clicked**, each followed by a
   render. Asserted that a click which moved the selection moved it to *the row it landed
   on*, was inside the sidebar's columns, named a row that exists, and that the frame
   never highlights a row past the end of the list. All held. Non-vacuous: making
   `routeMouse` return `index: row + 1` reddens it.
4. **The sidebar/pane boundary column is a blind spot of that sweep, and is covered
   elsewhere.** Widening the sidebar branch to `col <= layout.sidebarWidth` does *not*
   redden the cell sweep — by the time the scan reaches the boundary column the selection
   is already on that row, so nothing moves and the assertion is skipped. The same
   mutation reddens the in-tree `routeMouse > the sidebar owns its last column and the
   pane owns the first` (45 pass, 1 fail), which is exactly what Task 19.3 round 1 added
   it for. Recorded so a later round does not mistake the gap for missing coverage.

Both throwaway harnesses were deleted afterwards — the differential one duplicates a
superseded implementation and has no place in the tree, and the cell sweep is 27s of
runtime for a property the existing targeted tests already pin. `git status` clean before
committing; `routing.ts` and `app.ts` restored from scratchpad copies after every
mutation and confirmed clean with `git diff --stat`.

Verification at `822682f`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 420 pass, 0 fail (unchanged — no code changed this
round).

Next step: implement Task 19.5 — forward reports to a child that asked for them
(`docs/superpowers/plans/2026-08-23-taskflow-tui-mouse.md:1028`). It is the largest of the
19.x tasks and touches three files plus a non-append-only test: `ChildModes` gains required
`mouseTracking`/`mouseEncoding` (so `encode.test.ts:5`'s `legacy` fixture and
`SessionTerminal.modes` both stop compiling until filled in), `SessionTerminal` tracks the
encoding by hand off the `?h`/`?l` handlers and replays both modes across `attach()`'s
history path, `encodeMouseForChild` maps tracking→which events and encoding→which bytes
(dropping `sgr-pixels` and any X10 byte above 127), and `App.handleMouse` finally gains the
child-first-refusal guard ahead of `routeMouse`. After 19.5: 19.6 (**user gate — manual
smoke test**), then Tasks 16-18, then Tasks 20 and 21 (each needs its own plan).

## Task 19.5 — implementation

Base `1288c64`, head `f377413`. Status: **implemented**.

`ChildModes` gained required `mouseTracking` (xterm's own `IModes.mouseTrackingMode` union) and
`mouseEncoding`; `encodeMouseForChild` gates on the first and spells the bytes per the second;
`SessionTerminal` tracks the encoding by hand and replays both across `attach()`'s history path;
`App.handleMouse` gained the child-first-refusal branch ahead of `routeMouse` and `sendToChild`
widened from `KeyEvent[]` to `InputEvent[]`.

**Decisions taken** (all safe and reversible, recorded rather than escalated):

1. **`insidePane(col, row, layout)` was extracted into `layout.ts` and `routeMouse`'s inline
   copy replaced with it.** The plan names `insidePane` in `App` but does not say where it
   lives. Two copies of the pane rectangle is exactly what `layout.ts`'s own doc comment argues
   against, and the extraction is character-identical to what `routeMouse` had. Mutation M15
   below pins that the two really are one rectangle now.
2. **`MouseTracking`/`MouseEncoding` are not exported as named aliases.** They are inline unions
   inside `ChildModes`, and `SessionTerminal`'s private field is typed
   `ChildModes["mouseEncoding"]`. A named export whose only consumer is one private field is the
   unused-surface the package rule forbids.
3. **The two `?h`/`?l` handlers were merged into one `decPrivateMode(set)` factory** rather than
   registering a second pair. `registerCsiHandler` with the same id chains, so a second pair
   would work — but DECTCEM and the mouse encodings are the same "modes xterm does not expose"
   case and reading them in one loop is where a reader will look for them.
4. **`MouseButton` is now exported from `mouse.ts`**, as the comment there anticipated
   ("19.5 exports it when `encodeMouseForChild` needs to name it"). `BUTTON_VALUES` is
   `Record<MouseButton, number | undefined>`, so a button added later fails to compile rather
   than silently spelling itself as a left click.

**Three plan-sketch tests were wrong as written and were corrected** — the sketches would have
passed vacuously, or not at all, because of `SessionTerminal`'s recent-output replay:

- `attach()` sets `this.pending = this.takeRecent()`, so output that arrived over
  `TERMINAL_OUTPUT` before a drop is *replayed* on the next attach unless the reply's
  `lastSequence` covers it. The plan's "a re-attach does not carry the old encoding onto a fresh
  grid" would therefore have gone red against a correct implementation (the replay puts the
  modes straight back), and "a re-attach that falls back to history puts the mouse modes back"
  would have gone **green without any `restore` code at all** — the replay alone restores them.
  The first now sets the modes through the snapshot's own content (mirroring the existing
  "re-attaching takes its modes from the snapshot, not the pre-drop state"); the second and the
  history-override case use `lastSequence: 1` so the held-back chunk is dropped and `restore`
  is the only thing that can put the modes back. Mutation M9 confirms it.

**Every new test was mutation-checked.** Files were restored from a scratchpad snapshot after
each (`git checkout` reverts to HEAD, which was the base commit — it would have discarded the
whole uncommitted task).

| Mutation | Result |
|---|---|
| M1 X10 transport cap removed | 2 red |
| M2 `sgr-pixels` answered in cells instead of refused | 1 red |
| M3 tracking gate reduced to `=== "none"` | 2 red |
| M4 `x10` tracking sends modifier bits | 1 red |
| M5 SGR release forced to button 3 | 4 red |
| M6 `?1005/6/15/16 h` no longer sets the encoding | 9 red |
| M7 an `l` clears whichever encoding is active | 1 red |
| M8 encoding survives `terminal.reset()` | 1 red |
| M9 `restore` omits the mouse modes | 2 red |
| M10 the child-forwarding branch is never taken | 3 red |
| M11 the child-grid bounds check removed | 1 red |
| M12 screen-absolute coordinates forwarded | 3 red |
| M13 forwards even when the child tracks nothing | 1 red *(after fix)* |
| M14 mouse events dropped inside `sendToChild` | 3 red |
| M15 `insidePane` widened by one column | 1 red *(after fix)* |

**M13 and M15 initially survived, and two tests were strengthened to catch them.**

- **M13.** The plan's "a click in the pane never reaches a child that did not [ask]" cannot see
  the guard: with `mouseTracking: "none"` the encoder returns `""` anyway, so `net.sent` is empty
  either way. The guard's only observable effect is on the **wheel** — without it a notch over a
  non-tracking child's pane is swallowed instead of scrolling its scrollback. The test now opens
  a child with 20 lines of output, wheels over the pane, and asserts `viewportY` moved by three
  lines and focus stayed on the sidebar.
- **M15.** The boundary column is invisible through `routeMouse` (the sidebar branch returns
  first) but *is* reachable in `App`, because the forwarding guard runs **before** `routeMouse`.
  A pane rect one column too wide hands the sidebar's last column to the child. The test now
  clicks column 19 at 60 columns (sidebar 20 wide) and asserts the row moved.

Verification at `f377413`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 449 pass, 0 fail (420 → 449: 15 new `encodeMouseForChild`
cases, 6 new `SessionTerminal` cases, 6 new `App` cases, and two pre-existing `App` cases
rewritten in place).

## Task 19.5 — review round 1

Base `1288c64`, head `f377413` (code) / `eaf8e2c` (docs); fixed in `1a9179f`. One standard
gpt-5.5 review via the codex-review skill, Mode B (the brief carried the plan's requirements
and the seven deliberate decisions, so the round was not spent re-deriving them). Codex read
the repo, ran `bun test packages/tui` (449 pass), `bun run lint` and `bun run typecheck`, and
returned **one finding** — verdict "Changes required".

**One finding, substantiated and fixed in `1a9179f`.** It was found independently while
reading the diff, before the report landed, and both accounts agree on the mechanism.

### Substantiated — a snapshot re-attach stranded the child's mouse encoding

**What a user would see.** Reconnect to a session running any modern mouse-aware TUI (vim,
tmux, htop, fzf — anything that sends `?1002h ?1006h`), and from then on clicking in the
right-hand two-thirds of a wide pane does nothing at all, while clicks near the left edge may
land wrong or not at all depending on how forgiving the child's parser is. Before the
reconnect the same clicks worked.

**Evidence.** Regression test
`SessionTerminal > a snapshot re-attach keeps the encoding the snapshot cannot carry` in
`packages/tui/src/term/session-terminal.test.ts` — red on `f377413`
(`Expected: "sgr" / Received: "x10"`), green on `1a9179f`. Run with
`bun test packages/tui/src/term/session-terminal.test.ts`.

**Mechanism.** `attach()` reset `mouseEncoding` to `"x10"` after `terminal.reset()` and
replayed the saved value only on the history-fallback path. But the snapshot path is the
*primary* reconnect path, and the snapshot cannot carry the encoding: it is
`SerializeAddon.serialize()` output, and `_serializeModes` writes
`applicationCursorKeysMode`, `applicationKeypadMode`, `bracketedPasteMode`, `insertMode`,
`originMode`, `reverseWraparoundMode`, `sendFocusMode`, `wraparoundMode` and
`mouseTrackingMode` — and nothing for `?1005`/`?1006`/`?1015`/`?1016`, because `IModes` has
no member for them, which is the same reason `SessionTerminal` has to hand-track it in the
first place. Verified directly against the installed
`node_modules/.bun/@xterm+addon-serialize@0.13.0` bundle, not from memory. So tracking came
back correct (`drag`) and the encoding came back `"x10"`, and `encodeMouseForChild` then
spelled every report in legacy bytes — which, past zero-based column or row 94, the outbound
transport cap drops outright.

**Fix.** The encoding now survives `terminal.reset()` rather than being reset and replayed.
Neither path can restore it, so the pre-drop value is the only thing that knows what the
child is parsing, and output replayed after the reset still overrides it. `MOUSE_ENCODING_SET`
became dead and was deleted; `MOUSE_TRACKING_SET` stays, because tracking *is* xterm's own,
the reset really does clear it, and the history path really does have to put it back.

**One existing test encoded the wrong premise and was corrected.**
`a re-attach does not carry the old encoding onto a fresh grid` asserted that an empty
snapshot leaves `mouseEncoding` at `"x10"`, with a comment claiming "the snapshot ... carries
the child's modes with it". That is true of the tracking mode and false of the encoding. It
is now `a re-attach does not carry the old tracking mode onto a fresh grid` and keeps only
the half the snapshot can actually speak about; the other half is pinned by the new test.

**Mutation-checked.** Restoring `this.mouseEncoding = "x10"` reddens the new test (that is
the pre-fix run). Deleting `restore += MOUSE_TRACKING_SET[previous.mouseTracking]` still
reddens two tests (`a re-attach that falls back to history puts the mouse modes back` and
`history that carries a later mouse mode overrides the replayed one`), so removing the
encoding half of the replay did not leave the tracking half uncovered.

**Codex found nothing else** — it explicitly cleared the button arithmetic, the gating
matrix, the pane coordinate translation and the child-grid bounds check. Independently
re-derived the same four: button base values and the +32 drag / +64 wheel / 4-8-16 modifier
bits match xterm's ctlseqs; `tracks()` matches the plan's gating table row for row; the SGR
`M`/`m` split and the one-based conversion are right; the non-SGR release value of 3 carries
modifiers as real terminals do; and the `x10` cap fires at exactly the byte the plan derived
(one-based 96 + 32 = 128).

**Noted, not raised as a finding.** A child in `?1016` (SGR-Pixels) makes its whole pane
inert: `App.handleMouse`'s guard fires on `mouseTracking !== "none"` and returns before
`routeMouse`, so the report is neither forwarded (the encoder refuses pixel coordinates) nor
used to scroll the pane. That follows from the plan's own guard condition and its decision to
refuse `?1016` rather than guess a cell size, and no real child enables `?1016` without a
prior `?1006`-style negotiation this client answers. Recorded so a later round does not
rediscover it as a defect.

Verification at `1a9179f`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 450 pass, 0 fail (449 → 450: one new test, one renamed
and narrowed in place).

## Task 19.5 — review round 2

Base `1288c64` → HEAD `fead00e`, restricted to `packages/tui`. One standard gpt-5.5 review via
the codex-review skill (Mode B — the brief carried round 1's seven deliberate decisions plus
round 1's own two). Codex returned **one** finding, substantiated. Verified independently
before fixing.

### Substantiated — a child's full reset stranded the modes xterm does not expose

**What a user would see.** Two symptoms, both after a child issues `ESC c` — which is what
`reset` and `tput reset` send, and what some TUIs send on their way out.

1. Run something that turns on the mouse (vim, htop, claude), quit it, run `reset`, then run an
   older mouse app that asks for tracking without asking for SGR (`mc`, `less -X`, anything on
   `?1000h` alone). Every click now types visible junk into it — `[<0;12;5M` — instead of
   clicking.
2. Run anything that hides the cursor, then `reset`. The cursor is back on the child's own
   screen but stays invisible in the pane for the rest of the session.

**Evidence.** Two regression tests in `packages/tui/src/term/session-terminal.test.ts`:
`a child's full reset puts the mouse encoding back to legacy` (red on `fead00e`:
`Expected: "x10" / Received: "sgr"`) and `a child's full reset shows the cursor again`
(red on `fead00e`: `Expected: false / Received: true`). Both green on `08b23d8`. Run with
`bun test packages/tui/src/term/session-terminal.test.ts`.

**Mechanism.** `SessionTerminal` hand-tracks exactly two modes xterm.js does not expose —
`mouseEncoding` (`IModes` has no member for `?1005`/`?1006`/`?1015`/`?1016`) and `hiddenCursor`
(`IBuffer` has none for DECTCEM). Both were only ever written from the `CSI ? … h` / `CSI ? … l`
handlers. RIS is neither, so xterm reset its own state — verified directly: after
`\x1b[?1002h\x1b[?1006h\x1b[?25l\x1bc`, `terminal.modes.mouseTrackingMode` is `none`,
`applicationCursorKeysMode` and `bracketedPasteMode` are `false`, and the grid's cursor is
visible — while our two copies still read `sgr` and `hidden`.

**Fix.** A `parser.registerEscHandler({ final: "c" })` that puts both back to their power-on
values and returns `false`, so xterm still runs RIS itself. Deliberately an *RIS* hook and not
a `terminal.reset()` hook: `attach()` calls that API directly, and round 1 established that the
encoding must survive that one, because neither re-attach path can restore it. The two resets
are different events and now behave differently on purpose.

**Mutation-checked.** Dropping `this.mouseEncoding = "x10"` reddens the first test; dropping
`this.hiddenCursor = false` reddens the second; returning `true` instead of `false` reddens the
first test's `mouseTracking` assertions, which is why that test writes the RIS and the
re-enable as two separate emissions rather than one string.

**DECSTR checked and cleared.** `CSI ! p` leaves `mouseTrackingMode` at `drag` in xterm.js and
does not touch the encoding — which matches DEC's soft reset, whose scope is DECCKM, DECOM,
DECAWM and friends, not mouse tracking. No handler needed, and adding one would diverge from
real terminals.

**Codex found nothing else** — it explicitly cleared the outbound button/modifier/drag/wheel
arithmetic, the SGR `M`/`m` split, the X10 transport cap, the `?1000`/`?1002`/`?1003` gating,
the pane-local coordinate conversion, the sidebar/pane edge ownership, the child-grid bounds
drop, and round 1's attach/reset encoding fix.

**Independently checked and cleared, not raised.**
- `?1016l` dropping the encoding to `x10` rather than back to a still-set `?1006` is what xterm
  itself does: `set_mouse_extension()` keeps one `extend_coords` value and its disable path is
  `if (extend_coords == mode) extend_coords = 0`.
- A scrolled-back viewport does not shift the forwarded row. Confirmed against
  `@xterm/headless` that `viewportY` stays behind `baseY` across new output, so a click in a
  scrolled-back pane reaches the child as a viewport-relative row. That is also what xterm
  does — `EditorButton` never adds `ydisp` — so the client is faithful, not wrong. Alt-screen
  apps are unaffected anyway (`ybase` and `ydisp` are both 0 there).

Verification at `08b23d8`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 452 pass, 0 fail (450 → 452: two new tests).

## Task 19.5 — review round 3

Base `1288c64` → HEAD `3e0030c`, restricted to `packages/tui`. One standard gpt-5.5 review via
the codex-review skill (Mode B — the brief carried all thirteen deliberate decisions: the
plan's seven, round 1's two, and round 2's four). **Codex returned no findings.** No commit
was needed this round; HEAD is unchanged at `3e0030c`.

**What Codex reported clearing.** The full touched files rather than the diff alone
(`encode.ts`, `encode.test.ts`, `mouse.ts`, `session-terminal.ts`, `session-terminal.test.ts`,
`app.ts`, `app.test.ts`, `layout.ts`, `routing.ts`); the cross-references for `ChildModes`,
`mouseTracking`, `mouseEncoding`, `SESSION_INPUT`, the decode paths and the tty mouse setup;
and a re-derivation of the forwarding gates, the pane-relative one-based coordinates, the
child-grid bounds drop, the non-SGR release handling, the SGR release final, the X10 transport
cap and the mode reset / re-attach behaviour.

**The one new edge it raised, checked independently.** Codex stopped to verify grouped DECSET
— real apps emit `CSI ? 1002 ; 1006 h` as one control sequence, and a handler that read only
the first parameter would track the tracking mode and silently miss the encoding. Confirmed by
hand against the installed `@xterm/headless`, not from the report:

```
cd packages/tui && bun -e 'import { Terminal } from "@xterm/headless";
  const t = new Terminal({allowProposedApi:true});
  t.parser.registerCsiHandler({prefix:"?", final:"h"}, (p)=>{ console.log("params", JSON.stringify(p)); return false; });
  t.write("\x1b[?1002;1006h", ()=>{ console.log("tracking", t.modes.mouseTrackingMode); });'
→ params [1002,1006]
→ tracking drag
```

Both parameters reach a registered handler and xterm's own built-in handler applies both, so
`decPrivateMode`'s `for (const param of params)` loop is right and the grouped form is not a
defect. Recorded so a later round does not re-derive it.

**Independently re-read this round, beyond the report.** `BUTTON_VALUES` (wheel at 64-67, the
partial map that makes `none` `undefined` rather than a left click); `tracks()` against the
plan's gating table; `buttonValue`'s x10-tracking early return that drops the modifier bits
while keeping the drag bit; the x10 cap arithmetic re-derived from the one-based field
(`x + 32 > 127` ⇒ `x >= 96` ⇒ zero-based col >= 95, so zero-based 94 is the last one kept —
which is what the plan derived); the `sgr-pixels` refusal ahead of `buttonValue`; the RIS
handler and the deliberately-different `attach()` reset; and `App.handleMouse`'s guard,
including that it claims focus and returns even for the reports it then drops (decisions 4 and
9, both intentional).

Verification at `3e0030c`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/tui` → 452 pass, 0 fail. Codex ran the same suite and saw the
same 452/0.

**Task 19.5 is clear.** With it, Task 19 (mouse support) is fully implemented and reviewed:
19.1–19.5 all clear, only the manual smoke test 19.6 remains.

Superseded — the loop was restarted rather than answered, so 19.6 was deferred (a safe,
reversible choice: it stays `pending` as a standing manual check the user can run at any
terminal) and the loop moved on to Task 16. See below.

## Task 16 — implementation

Base `2684302`, commit `2c0a633`.

`packages/backend/src/ws/server.ts` now binds `Bun.serve` to
`process.env.TASKFLOW_HOST ?? "127.0.0.1"` and broadcasts `MSG.SYSTEM_CLIENTS`
(`"system:clients"`) with `{ count: clients.size }` from both the `open` and `close`
websocket handlers. `SYSTEM_CLIENTS` added to `packages/shared/src/constants.ts` and
`SystemClientsEvent` to `packages/shared/src/types/ws.ts`. New test file
`packages/backend/src/ws/server.test.ts` (2 tests) written first and confirmed red before
the implementation — the count test reported `Received: []`.

**Step 6 (verify the exposure is closed) was done here, not deferred.** The plan's version
starts the whole backend; instead the changed code path was exercised directly on a scratch
port, which avoids touching the host Taskflow's running backend and its real data dir:

```
bun -e 'import {Router} from "./packages/backend/src/ws/router";
        import {createServer} from "./packages/backend/src/ws/server";
        const s = await createServer(new Router(), 45999).start(); ...'
lsof -nP -iTCP:45999 -sTCP:LISTEN
→ bun 3995 kuindji 4u IPv4 TCP 127.0.0.1:45999 (LISTEN)
```

`127.0.0.1:45999`, not `*:45999` — the wildcard bind is gone. The plan's stated risk (the
IPv4-only socket stranding a client that resolves `localhost` to `::1`) was then checked on
this machine rather than assumed: against the same loopback-bound server,
`fetch("http://localhost:45999/")` returned `200 Taskflow backend` and
`new WebSocket("ws://localhost:45999")` opened. Those are the two mechanisms the plan's
manual half of Step 6 exercises (`useWebSocket.ts` and `TASKFLOW_API_URL` both address the
backend by name), so the Electron / `taskflow-cli` half is redundant for this change and was
not run — the running host backend predates the rebuild anyway and would not have tested it.

**Deviation from the plan, deliberate.** The plan has `broadcastClientCount` inline the
payload object literal, which would leave the newly added `SystemClientsEvent` exported and
unused — the repo's CLAUDE.md forbids that. The helper instead annotates the payload
(`const payload: SystemClientsEvent = { count: clients.size }`), which both uses the export
and type-checks the wire shape at the send site.

Verification at `2c0a633`: `bun run lint` clean, `bun run typecheck` clean across all five
packages, `bun test packages/backend/src/ws/server.test.ts` → 2 pass, 0 fail.
Full `bun test` → 1287 pass, 8 fail. **The 8 failures are pre-existing and unrelated**:
the same 8 fail on a full run of the stashed base tree at `2684302` (1285 pass, 8 fail), and
all 8 pass when their own directory is run alone on either tree. Logged as Task 22.

## Decisions taken (Task 16 implementation)

1. **Task 19.6 deferred, not answered.** The previous run stopped at the 19.6 user gate; the
   user restarted the flow instead of replying. Deferring a human-only smoke test is safe and
   fully reversible — 19.6 stays `pending` — so under the anti-stall rule the loop continued
   with Task 16 rather than re-asking the same blocking question.
2. **`broadcastClientCount` annotates its payload** with `SystemClientsEvent` instead of the
   plan's inline literal, so the new export has a consumer (CLAUDE.md forbids unused exports)
   and the wire shape is checked at the send site.
3. **Step 6 run against a scratch server on port 45999**, not against a full backend start.
   Same code path, and it avoids the running host Taskflow and its real data dir.
4. **The Electron / `taskflow-cli` half of Step 6 was skipped**, with the name-resolution risk
   it exists to catch verified directly instead (`http://localhost` and `ws://localhost` both
   reach the loopback-bound socket on this machine).
5. **The 8 full-suite `packages/ui` failures were left alone** — reproduced on the untouched
   base tree, so out of scope for Task 16. Logged as Task 22 for its own investigation.

## Task 16 — review round 1

Base `2684302` → `2c0a633`. One standard gpt-5.5 review via the codex-review skill (Mode B —
the brief carried the four deliberate decisions so they would not be re-raised). Codex
returned **one confirmed defect and one test gap**; an independent pass found **a second,
worse test defect Codex missed**. Both were fixed in `eb6fd75`.

### Finding 1 (Codex, confirmed) — `TASKFLOW_HOST=::1` did not restore Electron service

The plan justified the escape hatch as restoring service on a host that resolves `localhost`
to `::1` only. It only half did. The UI websocket (`ws://localhost`) and `taskflow-cli`
(`curl http://localhost`) address the backend by name and do follow the bind, but four
Electron **main-process** fetches hardcoded the IPv4 literal:

- `electron/src/window-manager.ts:31` and `:135` — `/api/settings` (saved window geometry)
- `electron/src/tray-manager.ts:165` — `/api/tray-state`
- `electron/src/notification-poller.ts:31` — `/api/notifications`

Observable symptom under `TASKFLOW_HOST=::1`: window position and size are neither restored
nor saved, the tray stops reflecting background state, and desktop notifications never fire —
all silently, because each call site swallows the error in a bare `catch`.

Reproduced directly rather than taken from the report:

```
bun -e 'const s = Bun.serve({port:45997, hostname:"::1", fetch:()=>new Response("ok")});
  try { const r = await fetch("http://127.0.0.1:45997/api/settings");
        console.log("IPv4", r.status); }
  catch (e) { console.log("IPv4 FAILED:", e.message); }
  const r2 = await fetch("http://localhost:45997/api/settings");
  console.log("localhost", r2.status); s.stop(true);'
→ IPv4 FAILED: Unable to connect. Is the computer able to access the url?
→ localhost 200
```

**Fix.** New `electron/src/backend-url.ts` exporting `backendOrigin(port)`, which reads
`process.env.TASKFLOW_HOST ?? "127.0.0.1"` — the same variable the backend binds, and visible
to main because `startBackend` passes its own environment through to the child — and brackets
a bare IPv6 literal so the URL authority stays legal. All four call sites now use it.
The default path is byte-identical to before (literal `127.0.0.1`), so this cannot regress the
normal case. `electron/src/backend-url.test.ts` (3 tests) pins the default, the override and
the bracketing.

Deliberately **not** fixed by switching the four sites to `localhost`: that would have made
the default path depend on whether Electron's `fetch` does happy-eyeballs fallback, trading a
latent bug in a rare escape hatch for a possible regression in the common one.

### Finding 2 (found independently, Codex missed it) — the close-count assertion was vacuous

Codex explicitly cleared this test, stating "after the second closes, it observes `1`". That
is wrong. The first client is counted on its own `open`, so `counts` already held `[1]` before
the second client ever connected, and the trailing `expect(counts).toContain(1)` was satisfied
by that stale entry — never by the close broadcast.

Probed first (15/15 runs, `counts` = `[1]` before any second client), then proved by deleting
`broadcastClientCount()` from the `close` handler in `server.ts` and re-running the test as
committed:

```
=== close broadcast REMOVED ===
 2 pass  0 fail
```

Half the feature — the count going back down on disconnect — was protected by nothing.

**Fix.** The test drains `counts` between phases and asserts the exact broadcast for each
transition (`toEqual([2])` on join, `toEqual([1])` on leave). Re-verified against the same
mutation: now `1 pass, 1 fail` with the close broadcast removed, `2 pass, 0 fail` with it
restored. Run 10× consecutively with no flake.

### Finding 3 (Codex, non-blocking) — the bind itself is still untested

`accepts connections on loopback` would also pass under a wildcard bind, so nothing in the
suite protects the security half of Task 16; a future edit dropping the `hostname` line would
go unnoticed. **Left as-is, deliberately** — see decision 4 below.

### Cleared by Codex and re-checked here

`clients` is mutated only in `open` and `close`; failed upgrades never enter the set; `open`
adds before broadcasting and `close` deletes before broadcasting, so the just-closed socket is
never sent the close event. `WsEvent` is loose (`type: string; payload: T`), which is exactly
why the `SystemClientsEvent` annotation at the send site is the only real payload check —
decision 2 of the implementation round earns its keep. The Electron renderer's `onmessage`
(`packages/ui/src/hooks/useWebSocket.ts`) ignores event types with no registered listener, so
the currently-unconsumed `system:clients` is inert there. `packages/backend/src/ws/server.ts`
is the only production `Bun.serve` in the repo, so no second wildcard bind was missed.

Additionally verified here, beyond both the report and the implementation round: the
`taskflow-cli` transport is `curl`, not `fetch`, and was not covered by the implementation
round's checks. Against a `127.0.0.1`-bound server, `curl -v http://localhost:<port>` resolves
both families, is refused on `[::1]`, falls back to `127.0.0.1` and succeeds — so agent
sessions keep working under the default bind.

### Supporting change

`electron/tsconfig.json` gains `"types": ["bun"]`. Electron has no test files today and TS's
automatic `@types` inclusion was not reaching the root `@types/bun` from the `electron/`
workspace, so `bun:test` failed to resolve. Confirmed additive: the electron typecheck passed
before and after, and `bun run build:electron` still produces a bundle with no `bun:test` in
it (the build has explicit entrypoints, so `*.test.ts` under `src` is never bundled).

Verification at `eb6fd75`: `bun run lint` clean, `bun run typecheck` clean across all five
packages plus electron, `bun test packages/backend/src/ws/server.test.ts electron/src/backend-url.test.ts`
→ 5 pass, 0 fail. Full `bun test` → 1290 pass, 8 fail; the 8 are the same pre-existing
`packages/ui` `MarkdownPaneImpl` failures already logged as Task 22 (the count rose 1287 → 1290
purely from the 3 new tests).

**Findings were fixed, so Task 16 needs another review round.**

## Decisions taken (Task 16 review round 1)

1. **Fixed the Electron origin rather than documenting the limitation.** The escape hatch is
   part of Task 16; shipping one that half works is a trap for whoever reaches for it.
2. **`backendOrigin` is a standalone module, not a `backend-manager` export.** `window-manager`,
   `tray-manager` and `notification-poller` all take their backend port through injected deps
   specifically to avoid importing `backend-manager`; a tiny env-only module keeps that shape.
3. **Kept the default as the literal `127.0.0.1` instead of `localhost`.** Rewriting the four
   sites to `localhost` would have made the common path depend on Electron's happy-eyeballs
   behaviour — an unverified risk in exchange for fixing a rare one.
4. **Left the bind itself untested (Codex's finding 3).** The two options are asserting on
   injected `Bun.serve` options, which tests the call rather than the socket, or connecting to
   a non-loopback interface address, which is environment-dependent and would be skipped in
   most sandboxes anyway. The bind was verified by `lsof` in the implementation round and is a
   one-line, highly visible property. Safe and reversible either way, so under the anti-stall
   rule the loop continued rather than asking.

## Task 16 — review round 2

One gpt-5.5 review via the codex-review skill (Mode B, prompted, over `2684302..dd5caac`
with the handoff excluded). Codex reported exactly one finding, and it holds up; a second
defect of the same class as round 1's was found here independently. Both fixed in `9286b46`.

### Finding 1 (Codex, high) — `TASKFLOW_HOST` was an unguarded way back onto the network

What an operator would see: they set `TASKFLOW_HOST=0.0.0.0` (or a LAN address) expecting to
reach Taskflow from another machine, and it works — the unauthenticated backend, with full
filesystem and process-spawning reach, is now listening on every interface. The whole point of
Task 16 was to close that, and the plan says the hatch exists "without reopening the socket to
the network". The variable was passed verbatim to `Bun.serve`, so it honoured anything.

Regression test: `createServer > refuses to start on a host that is not loopback` in
`packages/backend/src/ws/server.test.ts`. Red on `dd5caac` — the server started happily and
`message` stayed `null`:

```
error: expect(received).rejects.toThrow(expected)
Expected promise that rejects / Received promise that resolved
(fail) createServer > refuses to start on a host that is not loopback
```

Green on `9286b46`. Run with `bun test packages/backend/src/ws/server.test.ts`.

**Fix.** `resolveBackendHost()` accepts `127.x.x.x`, `::1`, `0:0:0:0:0:0:0:1` and `localhost`,
treats unset and empty as the `127.0.0.1` default, and throws for anything else with a message
naming the variable and pointing at the SSH tunnel. `TASKFLOW_HOST` was introduced by this very
task, so there is no existing user whose non-loopback value this breaks.

### Finding 2 (found independently, Codex missed it) — the TUI could not follow its own hatch

Exactly the defect round 1 fixed for the four Electron main-process fetches, one package over:
`packages/tui/src/net/client.ts:40` dialled a hardcoded `ws://127.0.0.1:<port>`. The TUI's
`startBackend` spreads `process.env` into the backend child (`manager.ts:123-127`), so under
`TASKFLOW_HOST=::1` the backend binds `::1` and the TUI that spawned it cannot connect at all —
it dies on startup with `WebSocket connection error`. Round 1 fixed the desktop app's four call
sites and left the terminal client, which this plan is building, unable to start.

Probed before writing the test, against a real `::1`-bound server:

```
bun run probe.ts   # WsClient(port).connect() with TASKFLOW_HOST=::1
→ FAILED: WebSocket connection error
```

Regression test: `WsClient > dials the host the backend bound, not a hardcoded IPv4 literal`
in `packages/tui/src/net/client.test.ts` — red on `dd5caac` (throws at `client.ts:49`), green
on `9286b46`. Run with `bun test packages/tui/src/net/client.test.ts`.

### Supporting change

Both call sites now go through `packages/shared/src/utils/backend-host.ts`
(`resolveBackendHost`, `hostForUrl`), exported from the shared barrel, so the server's bind and
the client's dial cannot drift apart. `packages/shared/src/utils/backend-host.test.ts` (14
tests) pins the default, the empty value, each accepted loopback spelling, each rejected
non-loopback form, and the IPv6 bracketing.

Checked that this does not leak a Node-only `process.env` read into the browser: the read sits
inside a function body, and `bun run build` tree-shakes `resolveBackendHost` out of the UI
bundle entirely (`grep -c resolveBackendHost packages/ui/dist/assets/index-*.js` → `0`).

Verification at `9286b46`: `bun run lint` clean, `bun run typecheck` clean across all five
packages plus electron, `bun run build` (UI + electron) clean. Targeted:
`bun test packages/tui/src/net/client.test.ts packages/backend/src/ws/server.test.ts
packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts` → 28 pass,
0 fail. Full `bun test` → 1306 pass, 8 fail; the 8 are the same pre-existing `packages/ui`
`MarkdownPaneImpl` failures logged as Task 22 (1290 → 1306 is the 16 new tests).

**Findings were fixed, so Task 16 needs another review round.**

## Decisions taken (Task 16 review round 2)

1. **A non-loopback `TASKFLOW_HOST` throws rather than warning and falling back.** A silent
   fallback would leave an operator who deliberately set `0.0.0.0` believing they had remote
   access while the socket stayed on loopback — the confusing failure. Throwing at bind names
   the variable and the supported alternative immediately. Safe to reverse: the variable is new
   in this task, so nothing depends on the old permissive behaviour.
2. **`localhost` is accepted alongside the literals.** It resolves to loopback on every host,
   costs nothing to allow, and is what someone reaches for first.
3. **Exotic IPv6 loopback spellings are not accepted** — only `::1` and `0:0:0:0:0:0:0:1`.
   Parsing every legal abbreviation to prove it is loopback is far more code than the hatch
   deserves, and the error message names the spelling to use.
4. **The helper lives in `@taskflow/shared`, not duplicated per package.** Backend and TUI both
   depend on shared, so one module keeps the bind and the dial in step.
5. **`electron/src/backend-url.ts` keeps its own copy and gains no validation.** Electron main
   does not depend on `@taskflow/shared`, and importing the barrel would pull the themes and
   YAML deps into the main bundle — round 1's decision 2 stands. Validation there is redundant
   anyway: the backend refuses to start on a rejected value, so an origin built from one is
   never reachable. The duplication is now called out in that file's doc comment.

- **Task 16, round 3** (gpt-5.5 via codex-review, Mode B over `2684302..9286b46`, docs
  excluded): three findings, all three substantiated and fixed in `74a1f88`. Codex explicitly
  reported no loopback-gate bypass and nothing unconfirmed. Run the repros with
  `bun test packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts`.

  All three are the same defect class: the bind host and the address a client dials drifting
  apart. Round 1 fixed it for Electron's HTTP origin, round 2 for the TUI's WebSocket dial;
  round 3 found the three call sites those rounds missed.

  - **Substantiated — an accepted `TASKFLOW_HOST` the renderer cannot reach.**
    `resolveBackendHost` accepted all of 127/8, but `packages/ui/src/hooks/useWebSocket.ts:67`
    dials `ws://localhost:<port>` and `packages/ui/src/lib/backend-url.ts:5` builds
    `http://localhost:<port>`, neither of which reaches `127.0.0.2`. Set
    `TASKFLOW_HOST=127.0.0.2` on Linux (where 127/8 is bound) and the backend comes up but the
    desktop UI never connects.
    Fixed by narrowing rather than by plumbing the host into the renderer — see decision 1.
    Regression test: `resolveBackendHost > refuses to bind the unauthenticated backend to
    "127.0.0.2"` (and `"127.255.255.254"`) — those two hosts were in the *accepts* list at
    `9286b46`, so the pair is red there and green on `74a1f88`.
    Reproducing the runtime half on macOS needs a `sudo ifconfig lo0 alias 127.0.0.2` first:
    unaliased, `Bun.serve({hostname: "127.0.0.2"})` dies with a misleading `EADDRINUSE`
    (verified at `9286b46`), which is its own bad outcome for an accepted value.
  - **Substantiated — spawned agents were handed `http://localhost:<port>`.**
    `session-lifecycle.ts:454` hardcoded the name, so with the backend on `::1` an agent's
    `taskflow-cli` call resolves `localhost` to IPv4 first and cannot reach it — which is
    exactly the host the escape hatch exists for. Now built from
    `backendHttpOrigin(getPort())`.
    Regression test: `backendHttpOrigin > follows the host the backend bound` — the symbol did
    not exist at `9286b46`, so the file does not compile there; green on `74a1f88`.
  - **Substantiated — `TASKFLOW_HOST=""` produced an unparseable Electron origin.**
    `electron/src/backend-url.ts:13` used `?? "127.0.0.1"`, which does not catch the empty
    string, while `resolveBackendHost` treats `""` as unset. So the backend bound `127.0.0.1`
    and Electron main built `http://:7100` — `new URL()` throws `Invalid URL`, breaking the
    notification poller, tray state and window-bounds fetches.
    Verified independently before writing the fix. Regression test: `backendOrigin > treats an
    empty TASKFLOW_HOST as unset, exactly as the backend does` — red on `9286b46`
    (`http://:7100`), green on `74a1f88`.

Verification at `74a1f88`: `bun run lint` clean, `bun run typecheck` clean across all five
packages plus electron, `bun run build` (UI + electron) clean, and
`grep -c 'resolveBackendHost\|backendHttpOrigin' packages/ui/dist/assets/index-*.js` → `0`, so
the new helper is still tree-shaken out of the browser bundle. Targeted:
`bun test packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts
packages/backend/src/ws/server.test.ts packages/tui/src/net/client.test.ts` → 31 pass, 0 fail.
Full `bun test` → 1309 pass, 8 fail; the 8 are the same pre-existing `packages/ui`
`MarkdownPaneImpl` failures logged as Task 22 (1306 → 1309 is the net 3 new tests).

**Findings were fixed, so Task 16 needs another review round.**

## Decisions taken (Task 16 review round 3)

1. **The accepted `TASKFLOW_HOST` set is narrowed to `127.0.0.1`, `::1`, `0:0:0:0:0:0:0:1` and
   `localhost`** — the addresses `localhost` itself resolves to — rather than teaching the
   renderer the bind host over Electron IPC, which is what Codex suggested. The hatch exists
   for exactly one scenario (a host that resolves `localhost` to `::1` alone); no use case
   wants `127.0.0.2`, and a new preload/IPC channel is a materially larger surface than this
   task's scope. It is also consistent with round 2's decision 3, which narrowed the IPv6
   spellings on the same reasoning. Safe to reverse: the variable is new in this task.
2. **`backendHttpOrigin` lives in `@taskflow/shared` beside the other two helpers.** The
   backend already depends on shared, and putting the composition behind a named function is
   what makes the agent-facing URL testable — it is the one URL handed to an external process.
3. **`electron/src/backend-url.ts` still gets no validation, only the empty-string fix.**
   Round 1 decision 2 and round 2 decision 5 stand; the bug was a divergence in the *default*,
   not a missing check.
4. **The error message keeps the word "loopback"** and now names the exact three accepted
   spellings, so an operator who set `0.0.0.0` reads both why it was refused and what to use.

## Task 16 — review round 4

One gpt-5.5 review via the codex-review skill (Mode B, prompted, over `2684302..74a1f88` with
the handoff excluded; the brief carried all of rounds 1–3's settled decisions so they would not
be re-raised). **Codex returned a clear verdict on the production change** — no substantive
defect, and it explicitly confirmed the two things prior rounds kept finding: every listener in
the repo goes through `resolveBackendHost`, and every backend-URL surface reduces to the
already-handled classes (Electron main fetches, the TUI `WsClient`, the renderer's `localhost`
dial and raw-file URL, and both `taskflow-cli` implementations consuming `TASKFLOW_API_URL`).
It also cleared the client-count broadcast: sockets enter the `Set` only in `open`, leave only
in `close`, failed upgrades never reach `open`, and `Set` membership rules out double-counting.

Two findings survived verification — one raised here independently, one raised by Codex as a
non-blocking test gap. Both are holes in the safety net rather than user-visible defects, and
both were fixed in `d6f0b9a`. First round on this task where nothing in the shipped behaviour
was wrong.

### Finding 1 (found independently, Codex agreed it was possible but found no instance) — round 1's `types: ["bun"]` silently disarmed the Electron typecheck

What it costs: the Electron **main** process runs on Node, not Bun, so `Bun` does not exist
there at runtime. Round 1 added `"types": ["bun"]` to `electron/tsconfig.json` so the new
`backend-url.test.ts` could resolve `bun:test`. That setting is package-wide, so it also put
the `Bun` global in scope for every shipped source in `electron/src`. From `74a1f88` onward, a
future edit reaching for `Bun.file()` or `Bun.spawn()` in Electron main typechecks clean,
builds clean, and then throws `ReferenceError: Bun is not defined` the moment that code path
runs. Codex flagged the same masking risk but stopped at "no current production `Bun` usage";
the point is that the guard against introducing one was gone.

Repro — drop a probe into the Electron sources and typecheck at each commit:

```
cat > electron/src/__probe.ts <<'EOF'
export async function probe(): Promise<string> {
    return await Bun.file("/etc/hosts").text();
}
EOF
cd electron && bunx tsc --noEmit
```

- At `2684302` (before the task): `error TS2868: Cannot find name 'Bun'.` — the mistake is caught.
- At `74a1f88`: exits 0, silently. — the mistake ships.
- At `d6f0b9a`: `error TS2868` again, from the `tsconfig.src.json` pass.

**Fix.** `electron/tsconfig.json` is left exactly as it was, and a new
`electron/tsconfig.src.json` extends it with `"types": []` and
`"exclude": ["src/**/*.test.ts"]`, rechecking only the shipped sources with the Bun types off.
`electron`'s `typecheck` script now runs both projects.

The obvious inversion — excluding the tests from `tsconfig.json` and giving them their own
project — was tried first and **rejected because it breaks lint**: `eslint.config.js` uses
`projectService: true`, which needs every linted file to belong to the nearest `tsconfig.json`,
so the excluded test file failed with `was not found by the project service. Consider either
including it in the tsconfig.json or including it in allowDefaultProject`. Extending in the
other direction keeps ESLint's view identical to today's.

### Finding 2 (Codex, substantiated) — no URL assertion exercised the full IPv6 spelling

`resolveBackendHost` accepts `0:0:0:0:0:0:0:1` as well as `::1`, and both `hostForUrl` and
Electron's `backendOrigin` bracket any host containing `:` — so production is correct today.
But every URL assertion in both test files used `::1` only, so a narrowing edit to either
helper would go unnoticed while breaking the long spelling.

Mutation repro — narrow both helpers to `host === "::1" ? ...`:

- At `74a1f88`: `bun test packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts`
  → **17 pass, 0 fail.** The break is invisible.
- The break is real: with that mutation, `TASKFLOW_HOST=0:0:0:0:0:0:0:1` makes
  `backendHttpOrigin(7100)` return `http://0:0:0:0:0:0:0:1:7100`, and `new URL()` on it throws
  `Invalid URL` — the same failure round 3's empty-string bug caused, which broke the
  notification poller, tray state and window-bounds fetches.
- At `d6f0b9a` with the same mutation: **19 pass, 3 fail**, in both packages.

**Fix.** The `hostForUrl` and `backendOrigin` bracketing tests became `test.each` over both
spellings, and `backendHttpOrigin > is a parseable URL for every accepted host` gained
`0:0:0:0:0:0:0:1` to its loop.

### Checked here and found sound

- **The bind is protected by a test after all.** Round 1's decision 4 recorded that "a future
  edit dropping the `hostname` line would go unnoticed". Round 2's `refuses to start on a host
  that is not loopback` closed that without anyone noticing: deleting `hostname:
  resolveBackendHost(),` from `server.ts` makes it fail (`Received value must be a string:
  null`), because that line is the only caller of the throwing resolver. Verified by mutation
  at `74a1f88` — **2 pass, 1 fail**. Decision 4 is now obsolete rather than accepted; no action
  needed.
- **The close-half of the count broadcast is still protected.** Deleting `broadcastClientCount()`
  from the `close` handler → **2 pass, 1 fail**. Round 1's vacuity fix holds.
- **`TASKFLOW_HOST` is inherited by every backend child.** Electron's `backend-manager.ts:114`
  spreads `process.env` into `safeEnv`, and the TUI's `manager.ts:113-119` does the same
  (stripping only `TASKFLOW_DEV`/`TASKFLOW_DEV_BRANCH`), so the bind host and the parent's
  `backendOrigin`/`WsClient` reads can never disagree.
- **A rejected `TASKFLOW_HOST` produces a legible failure, not a hang.** `resolveBackendHost`
  throws inside `server.start()`, `index.ts` ends in `main().catch(...)` which prints the error
  and exits 1, and both parents surface that: Electron races the port-file wait against the
  child's `exit` and keeps `backendStderrBuffer`, the TUI captures stderr the same way.
  Round 2's decision 1 rests on this and it holds.
- **`getPort()` is typed `() => number`** (`session-lifecycle.ts:89`), so
  `backendHttpOrigin(getPort())` cannot produce a `null` authority.
- **`packages/backend/src/ws/server.ts:47` is still the only `Bun.serve`/`listen` in the repo**,
  and `electron/src` has no `fetch` call left that does not go through `backendOrigin`.

Verification at `d6f0b9a`: `bun run lint` clean, `bun run typecheck` clean across all five
packages plus electron (electron now runs two projects), `bun run build` (UI + electron) clean.
Targeted: `bun test packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts
packages/backend/src/ws/server.test.ts packages/tui/src/net/client.test.ts` → 33 pass, 0 fail.
Full `bun test` → 1311 pass, 8 fail; the 8 are the same pre-existing `packages/ui`
`MarkdownPaneImpl` failures logged as Task 22 (1309 → 1311 is the 2 new `test.each` cases).
Re-confirmed they are pre-existing by stashing this round's changes and running
`bun test packages/ui/src/components/panes/` → 8 pass, 0 fail.

**Findings were fixed, so Task 16 needs another review round.**

## Decisions taken (Task 16 review round 4)

1. **The Bun-global guard is a second tsconfig, not a rearrangement of the first.**
   `electron/tsconfig.json` stays byte-identical so ESLint's `projectService` keeps resolving
   every file; `tsconfig.src.json` extends it and turns the Bun types back off for the shipped
   sources only. The inverse split was implemented, failed lint, and was reverted.
2. **`"types": []` rather than `"types": ["node"]`** in `tsconfig.src.json` — `@types/node` is
   not installed in this repo, and the pre-task state (no `types` field at all) typechecked the
   Electron sources fine, so an empty list restores exactly that.
3. **Codex's IPv6 gap was fixed by widening the tests, not by narrowing the accepted host set.**
   Dropping `0:0:0:0:0:0:0:1` would have been the smaller diff, but round 2's decision 3 chose
   to accept that spelling deliberately, and the helpers already handle it correctly.
4. **Round 1's decision 4 is recorded as obsolete rather than revisited.** The bind gained test
   coverage as a side effect of round 2's fix; nothing to change.

## Task 16 — review round 5

One gpt-5.5 review via the codex-review skill (Mode B, prompted, over `2684302..d6f0b9a` with
docs excluded; the brief carried all of rounds 1–4's settled decisions so they would not be
re-raised, and explicitly asked for the backpressure interaction, the bind/dial divergence
sweep, teardown, and test vacuity).

**Codex returned a clear verdict: no confident findings and no speculative ones.** It reported
checking the whole diff and the current tree, the single production `Bun.serve`, the host gate
and IPv6 bracketing, all four dial paths (TUI `WsClient`, Electron `backendOrigin`, the spawned
agent's `TASKFLOW_API_URL`, the settled renderer `localhost` path), the add/delete ordering of
the client-count broadcast, and the port-file consumers and env inheritance in both launchers.
It ran the targeted tests, every package typecheck including both Electron projects, and lint.

**Nothing substantiated on my side either, so Task 16 is clear after round 5.** No commit this
round — the tree is unchanged from `d6f0b9a`.

### Checked independently here and found sound

- **No hardcoded local host survives outside the accepted set.**
  `grep -rn -e localhost -e 127\.0\.0\.1` over `packages`, `electron`, `scripts` and `bin`
  (excluding `node_modules`, `dist` and tests) returns only: the renderer's three `localhost`
  sites (settled decision 1), the two doc comments, `DEFAULT_BACKEND_HOST`, the error string,
  and Electron's deliberate duplicate. Nothing else builds a backend address.
- **Every Electron main `fetch` goes through `backendOrigin`.** Four call sites
  (`notification-poller.ts:32`, `tray-manager.ts:166`, `window-manager.ts:32` and `:136`), and
  `grep -rn "fetch(" electron/src` finds no fifth.
- **The bracketed IPv6 origin survives the `taskflow-cli` shell script.**
  `packages/backend/src/services/taskflow-cli.sh` — the implementation that actually runs on
  macOS/Linux — only ever concatenates `"$TASKFLOW_API_URL/api/..."` into `curl`, never parses
  the authority apart, so `http://[::1]:7100/api/...` reaches curl intact. This was the
  remaining place a bracketed host could have been split on `:`.
- **`SystemClientsEvent` reaching the desktop app is silent, not noisy.**
  `packages/ui/src/hooks/useWebSocket.ts` dispatches through a `Map` of event listeners with no
  `default:` branch and no warn, so the new broadcast to an unsubscribed renderer logs nothing.
- **The count broadcast cannot send to the socket that is leaving.** `close` deletes from
  `clients` before `broadcastClientCount()` iterates it. `broadcastClientCount` deliberately
  omits `dropOnBackpressure` so the count is never silently skipped; with Bun's
  `closeOnBackpressureLimit` left at its `false` default, an over-buffered `ws.send` fails
  silently rather than throwing or dropping the connection.
- **No unused export.** All three new shared symbols have a consumer: `resolveBackendHost`
  (backend `server.ts`, TUI `client.ts`), `hostForUrl` (TUI `client.ts`), `backendHttpOrigin`
  (`session-lifecycle.ts`).
- **Test files never ship.** `electron/build.ts` bundles from three explicit entrypoints
  (`src/main.ts`, `src/preload.ts`, `src/browser-preload.ts`), so `backend-url.test.ts` and its
  `bun:test` import are unreachable from the packaged main bundle, and `typecheck` is
  `--noEmit` on both projects.
- **A rejected value is refused, not trimmed into acceptance.** `resolveBackendHost` matches on
  `host.toLowerCase()` against the exact set, so `" 127.0.0.1"` (leading space) throws rather
  than binding. It returns the raw value, so a case variant like `LOCALHOST` is passed through
  to both `Bun.serve` and Electron's origin identically — DNS and URL authorities are
  case-insensitive, so the two cannot disagree.

### Accepted, not fixed — the `session-lifecycle` call site has no test

Round 3 changed `packages/backend/src/services/session-lifecycle.ts:456` from a hardcoded
`http://localhost:${port}` to `backendHttpOrigin(getPort())`. That is the highest-consequence
line in the task for the scenario the escape hatch exists for — with the backend on `::1`, a
spawned agent's `taskflow-cli` cannot reach a `localhost` URL — and **no test asserts it**.

Mutation evidence: reverting that one line to `` `http://localhost:${String(getPort())}` `` and
running `bun test packages/backend` gives **603 pass, 0 fail** — identical to the unmutated
baseline. The break is invisible to the suite. (`grep -rn TASKFLOW_API_URL` over the backend
tests finds only two *fixtures* that feed the CLI a URL, never an assertion on what
`session-lifecycle` builds.)

**Not fixed, deliberately.** `createSessionLifecycle` takes seven injected deps — `PtyManager`,
`TaskStore`, `SettingsStore`, `TrayStateTracker`, a broadcast fn, `getPort` and
`detectedEditors` — and `createSession` loads settings, resolves linked projects, builds the
system prompt and writes the agent skill file before it ever reaches line 456. There is no
existing `session-lifecycle` test to extend (the module has none). Standing up that scaffolding
without `as any` is a task-sized piece of work, not a review-round fix, and it is
disproportionate to the residual risk: the line already carries an explicit
`// Not localhost:` comment explaining why, and the only way to regress it is to delete
that comment and re-hardcode the literal it warns against. Recorded here so the gap is known
rather than silently accepted. If `session-lifecycle` ever gains a test harness, this
assertion should be the first thing added to it.

Verification at `d6f0b9a` (tree unchanged, no new commit): `bun run lint` clean,
`bun run typecheck` clean across all five packages plus both Electron projects. Targeted:
`bun test packages/shared/src/utils/backend-host.test.ts electron/src/backend-url.test.ts
packages/backend/src/ws/server.test.ts packages/tui/src/net/client.test.ts` → 33 pass, 0 fail.
`bun test packages/backend` → 603 pass, 0 fail. Full `bun test` → **1311 pass, 8 fail**, the
same pre-existing `packages/ui` `MarkdownPaneImpl` failures logged as Task 22, and the same
counts round 4 recorded.

One earlier full run in this session reported 1310 pass / 9 fail / 1 error, with the extra
failure being `backend startup > exits non-zero when startup fails after the server starts`.
It did not reproduce: that run took 90s against a ~40s baseline, and the test passes in
isolation and on an unloaded full run. Logged as Task 23 rather than treated as a regression.

## Decisions taken (Task 16 review round 5)

1. **Task 16 is closed after five rounds on a clear verdict from both reviewers.** Rounds 3 and
   4 each narrowed the search (round 4 was already clear on shipped behaviour and found only
   safety-net holes); round 5 found nothing in either category.
2. **The uncovered `session-lifecycle` call site is recorded as a known gap, not fixed.** See
   above — the test scaffolding it needs is out of proportion to a review round, and inventing
   a grep-over-source assertion instead would be a brittle guard that tests the text rather
   than the behaviour.
3. **The flaky `backend startup` test is logged as Task 23, not fixed here.** It is
   pre-existing, unrelated to this task's files, and a fixed timeout racing machine load needs
   its own look.

## Task 17 — implementation (base `6f62137`, commit `550331f`)

Plan section: `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.md` Task 17. Only
`packages/tui/src/net/client.ts` changed, plus the new `packages/tui/src/net/reconnect.test.ts`.

**What it does.** `WsClient` now dials again after an unexpected close, with exponential backoff
from 250ms to a 5s ceiling, and stops for good once `close()` is called. The constructor gained
an optional second `host` argument for Task 18's remote mode; left unset, the existing
`hostForUrl(resolveBackendHost())` rule from Task 16 still applies, so local behaviour is
unchanged.

**Where the retry is armed.** Only in `ws.onclose`. `disconnect()` detaches `onopen`/`onerror`/
`onclose`/`onmessage` before calling `ws.close()`, so neither an intentional `close()` nor a
superseding `connect()` can reach that handler — the loop starts only when the socket dropped on
its own. The timer callback also rearms from `connect().catch()`, because a dial that fails
through `onerror` alone never reaches `onclose`; the `reconnectTimer !== null` guard keeps the
two paths from stacking two timers when both fire.

**Session resync needs no wiring in Stage 1.** `SessionTerminal.attach()` already handles a
second attach (Task 9: it replays `takeRecent()`, resets the grid through the write queue and
restores DEC modes). Nothing in Stage 1 opens a session — `App.sessions` is only ever read, and
the plan puts `SESSION_CREATE` and attaching to a task's sessions in Stage 2 (plan lines
4799–4818). So there is no open session for a reconnect to resync yet, and the recovery hook
belongs with the code that opens one.

### Decisions taken (Task 17)

1. **`connect()` clears `closed`.** The plan leaves `closed` sticky once `close()` has run. That
   would make a later `connect()` return a live socket with the retry loop silently dead. Since
   dialling again is an explicit statement that the caller wants a connection, `connect()` resets
   the flag. Nothing in the tree calls `connect()` after `close()` today, so this changes no
   shipped behaviour; it removes a trap. `close()` still sets the flag before clearing the timer,
   so a close racing an armed timer cannot be undone.
2. **`host` is `string | null`, not a `"127.0.0.1"` default.** The plan predates Task 16. A
   literal default would throw away the `TASKFLOW_HOST` resolution Task 16 added; a null default
   keeps the local rule and lets Task 18 pass a remote host through the same `hostForUrl`
   bracketing that an IPv6 literal needs.
3. **The third test was added beyond the plan's two.** The plan's "stops reconnecting after
   close" only asserts that `request()` rejects, which already passed before this task existed.
   `does not dial again after close, even once the server is back` counts upgrades on a
   server restarted after `close()`, which is the behaviour that would actually regress.

### Verification at `550331f`

- Red before the fix: `bun test packages/tui/src/net/reconnect.test.ts` at `6f62137` with only
  the test file present → `reports disconnect and reconnects when the server returns` fails with
  `Expected to contain: true / Received: [ false ]`. Green at `550331f`.
- `bun test packages/tui/src/net/` → 11 pass, 0 fail.
- `bun test packages/tui` → 456 pass, 0 fail.
- `bun run lint` clean, `bun run typecheck` clean across all five packages plus both Electron
  projects.
- Full `bun test` → **1314 pass, 8 fail** — the same pre-existing `packages/ui`
  `MarkdownPaneImpl` failures logged as Task 22 (1311 + the 3 new tests here).

## Task 17 — review round 1

- **Task 17, round 1** (gpt-5.5 via codex-review, Mode A `codex exec review --commit 550331f`):
  two findings, both substantiated and fixed in `0951096`.

  1. **A manual `connect()` did not disarm the retry it superseded.** After a drop, `onclose`
     arms a reconnect timer. A caller who dialled again by hand before that timer fired got a
     working socket — and then, at the scheduled delay, the stale timer called `connect()` a
     second time, whose `disconnect(new Error("Connection replaced"))` tore the *live* socket
     down: every in-flight request rejected and `onStatusChange` reported `false` then `true`
     for an outage that never happened.
     Regression test: `WsClient reconnection > a manual connect cancels the armed retry instead
     of being replaced by it` in `packages/tui/src/net/reconnect.test.ts`. Red at `550331f`
     (`expect(states).toEqual([])` receives `[false, true]`), green at `0951096`.
     Run with `bun test packages/tui/src/net/reconnect.test.ts`.
     Fix: `connect()` calls `cancelReconnect()`, extracted so `close()` and `connect()` disarm
     the loop through one path.

  2. **A reconnect left the sidebar stale.** `Store.load()` runs once, from `App.init()`;
     everything after it arrives as a live broadcast, and the backend replays nothing to a
     client that was disconnected. So any project or task created, renamed or archived by
     another client (Electron, the CLI) during an outage never reached the store, and the
     sidebar went on showing pre-outage rows for the rest of the process.
     Regression test: `App > reloads the store on reconnect so the sidebar is not left stale`
     in `packages/tui/src/ui/app.test.ts`. Red at `550331f` (the frame repaints nothing —
     received `""`), green at `0951096`. Run with `bun test packages/tui/src/ui/app.test.ts`.
     Fix: `App.init()` subscribes to `onStatusChange` and re-runs `store.load()` on
     `connected: true`. The subscription is made before the first load but does not double it —
     the socket is already open when `init()` runs, so `setStatus` emits nothing further until
     a real outage. The reload swallows its own failure, matching `Store.refresh()`'s existing
     rule that "the store has no error channel of its own and reconnect is the app's job".

  Codex's framing of finding 2 mentioned session resync as well; that half stands as already
  handled — `SessionTerminal.attach()` restores from the snapshot, and nothing in Stage 1 opens
  a session. Only the `Store` half was a live defect, and only that was fixed.

### Decisions taken (Task 17 round 1)

4. **The `App` status subscription's disposer is dropped.** `App` has no teardown path — the
   process exits from `index.ts` when `app.running` goes false — so storing an unsubscribe that
   nothing can call would be dead state.
5. **The app-test stub now returns copies from `PROJECT_LIST`/`TASK_LIST`.** It handed back the
   test's own fixture arrays, which left `Store.taskList` aliasing them, so a test that pushed a
   task mutated the store directly and could not tell a reload from no reload. A real snapshot
   arrives over the socket as fresh data; the stub now matches. All 21 pre-existing app tests
   still pass under the change.

### Verification at `0951096`

- `bun test packages/tui/src/net/` → 12 pass, 0 fail.
- `bun test packages/tui/src/ui/app.test.ts` → 22 pass, 0 fail.
- `bun test packages/tui` → 458 pass, 0 fail.
- `bun run lint` clean, `bun run typecheck` clean across all five packages plus both Electron
  projects.
- Full `bun test` → **1316 pass, 8 fail** — the same pre-existing `packages/ui`
  `MarkdownPaneImpl` failures logged as Task 22 (1314 + the 2 new tests here).

## Task 17 — review round 2

- **Task 17, round 2** (gpt-5.5 via codex-review, Mode B over `6f62137..0951096` restricted to
  `packages/tui`): one finding, substantiated. Verifying it surfaced a second defect of the same
  class on a different path. Both fixed in `1123c80`.

  1. **A redial made from inside the disconnect notification was replaced by the retry it
     could not cancel** (codex's finding). `onclose` ran `setStatus(false)` *before*
     `scheduleReconnect()`, and `setStatus` calls its listeners synchronously. A listener that
     dials again on being told the link is down therefore ran `connect()` — and its
     `cancelReconnect()` — at a moment when no retry was armed yet; `onclose` then resumed and
     armed one behind the new socket. 250ms later that retry called `connect()`, tore the live
     socket down as `"Connection replaced"`, reported `false` then `true` for an outage that
     never happened, and rejected everything in flight.
     Regression test: `WsClient reconnection > a connect() made from inside the disconnect
     notification is not replaced by the retry` in `packages/tui/src/net/reconnect.test.ts`.
     Red at `0951096` (`expect(states).toEqual([])` receives `[false, true]`), green at
     `1123c80`. Run with `bun test packages/tui/src/net/reconnect.test.ts`.
     Fix: arm the retry before notifying — `failPending`, `scheduleReconnect`, then
     `setStatus(false)` — so a listener's `connect()` has something to cancel.
     Test support: `serveOn`'s `open` handler now records the accepted `ServerWebSocket` in
     `accepted`, so a test can drop one client without stopping the server (the server has to
     stay up for the redial to succeed).

  2. **The retry loop rearmed itself after a dial that a later `connect()` had superseded**
     (found while verifying finding 1, not reported by codex). `scheduleReconnect`'s
     `void this.connect().catch(() => this.scheduleReconnect())` rearmed on *any* rejection.
     `connect()` rejects a dial it supersedes with `"Connection replaced"`, so a manual dial
     landing on top of an in-flight retry dial left a retry armed behind itself, which then
     fired mid-handshake and rejected the manual caller's own `connect()` promise with
     `"Connection replaced"` — nothing had replaced it, and the server was reachable
     throughout. `index.ts` does `await net.connect()`, so this shape rejects a startup dial.
     Regression test: `WsClient reconnection > a retry armed by a superseded dial does not
     replace the dial that superseded it`. Red at `0951096` (`expect(errors).toEqual([])`
     receives `["Connection replaced"]`), green at `1123c80`.
     Test support: `serveOn` now awaits `upgradeDelayMs` before upgrading, so a dial can be
     caught while still CONNECTING.
     Fix: rearm only while `this.ws === null`. The failure the rearm exists for — a dial that
     never opens — always ends in `onclose`, which clears `ws` first, so it still gets through.
     Verified against Bun directly: a refused dial fires `onerror` *then* `onclose`
     (`["error","close"]`), so the old comment's "never reaches onclose" does not hold for that
     case; the guard leaves the rearm in place regardless, rather than removing it.

### Decisions taken (Task 17 round 2)

6. **`onclose` now orders itself bookkeeping-first, notification-last.** `settle`, `failPending`
   and `scheduleReconnect` all run before `setStatus(false)`, so a re-entrant listener sees the
   client fully in its post-close state. Only `setStatus` re-enters synchronously —
   `failPending`'s rejections are microtasks — so this is the one ordering that matters.
7. **The `.catch` rearm was guarded, not deleted.** Bun always follows `onerror` with `onclose`
   on a refused dial, which would make the rearm redundant, but that was only measured for one
   failure shape. The guard closes the hazard without betting on the others.

### Verification at `1123c80`

- Red before the fix: `bun test packages/tui/src/net/reconnect.test.ts` with `client.ts` stashed
  back to `0951096` → both new tests fail, 4 pass.
- `bun test packages/tui/src/net/` → 14 pass, 0 fail.
- `bun test packages/tui` → 460 pass, 0 fail.
- `bun run lint` clean, `bun run typecheck` clean across all five packages plus both Electron
  projects.
- Full `bun test` → **1318 pass, 8 fail** — the same pre-existing `packages/ui`
  `MarkdownPaneImpl` failures logged as Task 22 (1316 + the 2 new tests here).

## Task 17 — review round 3

**Round 3** (gpt-5.5 via codex-review, Mode B over `6f62137..1123c80` restricted to
`packages/tui`): **no findings.** Verdict "Clear" — no remaining race, retry fan-out,
pending-request leak or reload defect in scope. Codex independently ran
`bun test packages/tui/src/net/reconnect.test.ts packages/tui/src/ui/app.test.ts` (28 pass),
`bun run --cwd packages/tui typecheck` and `bunx eslint` over the four touched files, all clean.

No code changed this round. **Task 17 is clear.**

### Independent pass alongside the review

Two things were checked by hand before accepting the verdict, and neither is a defect:

- **"Session resync" is store reload only, and that is correct here.** `SessionTerminal.attach()`
  is written for re-attach after a drop, but nothing in production calls it — `App.sessions` is
  never populated, because the plan defers session creation and attach to Stage 2 under
  "What this stage does not do" (plan line ~4796). So there is no open session for a reconnect to
  resync, and the reload-on-reconnect listener in `app.ts` is the whole of the task's resync
  surface at this stage. **When Stage 2 adds `SESSION_CREATE`, that same status listener must also
  re-run `attach()` on every open session** — the comment in `client.ts` already promises it.
- **`store.load()` overlap on rapid reconnects is already handled.** `Store.load` takes a
  `loadToken` per call and refuses to commit a snapshot a later load has superseded, and the
  deferred-mutation queue drains from each load's own mark, so overlapping reloads cannot put an
  older snapshot back over a newer one.

### Unverified suspicions (not findings, recorded so they are not re-derived)

- **A dial that hangs in CONNECTING has no timeout of its own.** While a dial is in flight,
  `reconnectTimer` is null and `this.ws` is set, so nothing is armed behind it; recovery depends
  entirely on the OS surfacing the failure as `onerror`/`onclose`. For a refused connection that
  is immediate, and for a blackholed SYN it is the ~75s kernel connect timeout, so the loop does
  resume — just slowly. Could not construct a case where it stalls permanently. If remote mode
  (Task 18) turns out to hang over a half-open tunnel, this is the first place to look.

### Verification at `1123c80` (unchanged this round)

- `bun test packages/tui/src/net/` → 14 pass, 0 fail.

## Task 18 — implementation (base `3e31dd2`, commit `f6cc308`)

Plan Steps 1–6 and 8. **Step 7 was not run** — it is a manual smoke test over an SSH tunnel
between two machines, which needs the user. It is now Task 18.1 in the table.

### What was built

- **`packages/tui/src/cli.ts`** (new) — `parseArgs(argv)` returning
  `{ connect: { host, port } | null }`, and `parseTarget`, private to the module. Verbatim from
  the plan apart from a comment noting that `lastIndexOf(":")` is what makes a bracketed IPv6
  literal parse. Pure, so the whole option surface is testable without spawning anything.
- **`packages/tui/src/cli.test.ts`** (new) — the plan's eight cases: local default, `--connect
  host:port`, `--connect=host:port`, and rejection of a missing port, a non-numeric port, a port
  with trailing garbage (`123abc`, which `parseInt` alone would take as 123), an out-of-range
  port, and an unknown flag.
- **`packages/tui/src/index.ts`** — `main()` now parses argv first and branches: local mode spawns
  the backend and dials its port as before; remote mode constructs `new WsClient(port, host)` and
  spawns nothing. Parsing happens before `startBackend` and before raw mode, so a usage error
  cannot leave a backend behind or the terminal in raw mode. No change was needed to the shutdown
  path — the existing code releases the backend from an `exit` handler registered by
  `startBackend`'s `onSpawn`, so remote mode simply registers no such handler (the plan's
  `backend?.stop()` presumed the older shutdown shape and would have been a second, redundant
  stop). The comment on the exit path was updated to say so.
- **`packages/tui/src/ui/app.ts`** — the `onStatusChange` listener added in Task 17 now also calls
  `session.term.attach()` for every open session on reconnect, each with its own `.catch`. A new
  `MSG.SYSTEM_CLIENTS` subscription keeps `otherClients = max(0, count - 1)`, and a new private
  `drawClientWarning(layout)` paints ` N other client(s) attached ` in inverse video at the right
  of the tab row, after `drawTabs`, clamped left to `layout.paneX`.

### Verification

- `bun test packages/tui/src/cli.test.ts` → 8 pass (red before `cli.ts` existed: "Cannot find
  module './cli'").
- Seven tests added to `packages/tui/src/ui/app.test.ts`. Five were confirmed red against the
  pre-change `app.ts` and green after — `re-attaches every open session on reconnect`,
  `a reconnect survives a session whose attach rejects`, `warns when another client is attached to
  the same backend`, `the warning is drawn in inverse video at the right of the tab row`, and
  `the warning clears once the other client leaves`. The two negative-assertion tests (`says
  nothing when this client is the only one`, `a count of zero does not render a negative client
  count`) pass either way by construction and are there to pin the clamp and the zero case.
- `bun run lint` clean, `bun run typecheck` clean across all packages.
- `bun test packages/tui` → 475 pass, 0 fail.
- `bun test` (whole repo) → 1333 pass, 8 fail. The eight are exactly the known Task 22 set
  (`MarkdownPaneImpl.checkbox.test.tsx` and the markdown link tests, `'useSessionStore.setState'
  is undefined` / `root.unmount` undefined). Pre-existing and unrelated.

## Decisions taken (Task 18)

- **No `disposers` array on `App`.** The plan wrapped the `SYSTEM_CLIENTS` subscription in
  `this.disposers.push(...)` backed by a new `private readonly disposers` field. Nothing in Stage 1
  ever drains it — `App` has no teardown path and lives for the whole process — and the
  `onStatusChange` subscription right above it already discards its unsubscribe. An array nothing
  reads implies a lifecycle that does not exist, so the subscription is made the same way the
  status one is. Safe and reversible: when Stage 2 gives `App` a teardown, both subscriptions get
  their disposers back together.
- **The banner uses `layout.tabRow` and `layout.cols`, not literal `0` and the `cols` dep.** Same
  reason `computeLayout` exists at all: what is drawn and what a mouse report is hit-tested
  against must come from one rectangle. It also moves the banner automatically if `tabRow` ever
  stops being row 0.
- **`drawClientWarning` is a private method rather than inline in `render()`.** `render()` was
  already at the length where another nested loop hurts; the method keeps `render()` a list of
  draw calls.
- **The plan's `startX + i < cols` loop guard was dropped.** `ScreenBuffer.set` already
  bounds-checks and silently drops out-of-range writes, so the guard was a second copy of the same
  rule. `startX` is still clamped to `paneX` on the left, which is the guard that does work.

## Task 18 — review round 1

Base `3e31dd2` → `f6cc308`. One standard gpt-5.5 review via the codex-review skill (Mode B — the
brief carried the four deliberate Task 18 decisions so they would not be re-raised, and named the
areas to press on). Codex reported four findings; a fifth was found independently while verifying
them. All five substantiated and fixed in `684ffa6`.

### Findings, all confirmed

1. **`--connect [::1]:7777` cannot connect at all** (Codex, high). `parseTarget` kept the brackets
   in the host, and `hostForUrl` (`packages/shared/src/utils/backend-host.ts`) brackets any host
   containing a colon — so the URL came out `ws://[[::1]]:7777` and `new WebSocket` threw
   `TypeError: Invalid URL` before anything was drawn. The bracketed form is the one `cli.ts`'s own
   comment says the `lastIndexOf(":")` split exists to support, and it was the only form that did
   not work. Reproduced directly: `parseArgs(["--connect","[::1]:7777"])` →
   `{host:"[::1]",port:7777}` → `new URL("ws://[[::1]]:7777")` throws.
2. **A bare IPv6 target parsed as a host and a port instead of being rejected** (Codex, medium).
   `--connect ::1` gave `{host:":",port:1}`; `--connect 2001:db8::1` gave
   `{host:"2001:db8:",port:1}`. A silent mis-parse of an invalid target, which then failed much
   later as an unopenable URL rather than as a usage error.
3. **A host with whitespace in it was accepted** (Codex, low). `--connect " desktop:7777"` and
   `--connect "desk top:7777"` both parsed. `parseArgs` owns usage validation, and `WebSocket`
   rejects those URLs later anyway.
4. **`CliOptions` was exported with no importer** (Codex, low) — CLAUDE.md forbids that.
5. **The client-count warning never fired for the case it exists for** (found here, not by Codex).
   The backend broadcasts `system:clients` from the websocket `open` handler, so the frame that
   announces this client's own arrival is delivered in the same event-loop turn as the open —
   before the `await net.connect()` continuation, and therefore before `App.init()` subscribes.
   Confirmed with a scratch backend on port 45997: a listener registered immediately after
   `connect()` resolved saw nothing, while a second raw client saw both `{count:1}` and
   `{count:2}`, and a listener registered *before* `connect()` did see `{count:2}`. So starting
   the TUI while Electron was already open showed no warning until some third client happened to
   connect or disconnect — which is exactly the scenario the warning is for.

### Fixes

- **`packages/tui/src/cli.ts`** — `parseTarget` now branches on a leading `[`. The bracketed form
  requires a closing `]` immediately followed by `:`, validates the inner literal against
  `IPV6_HOST` (hex, dots, colons, optional `%zone`) and returns the host *unbracketed*, so
  `hostForUrl` is the single place brackets are applied. The unbracketed form splits on the first
  colon and validates the host against `PLAIN_HOST` (`[A-Za-z0-9._~%+-]+`), which rejects both a
  bare IPv6 address and a host with a space in it. `USAGE` now says IPv6 must be bracketed. The
  repeated inline `throw new Error(...)` became `throw usageError()`. `export type { CliOptions }`
  removed.
- **`packages/backend/src/ws/server.ts`** — `createServer` returns a new `clientCount()`.
- **`packages/backend/src/index.ts`** — `MSG.SYSTEM_CLIENTS` registered as a *request* as well,
  answering `{ count: server.clientCount() }`.
- **`packages/tui/src/ui/app.ts`** — `init()` fetches the count once alongside `store.load()` and
  keeps following the broadcasts. A new `clientsBroadcast` flag makes a broadcast that lands during
  the fetch win over the fetch's older value. The fetch is `.catch`ed: an older backend does not
  answer it, and the count is a warning rather than something the UI needs to run.

### Verification

- `packages/tui/src/cli.test.ts` — 12 tests added (20 total). Against the pre-fix `cli.ts`, 7 of
  them fail; all 20 pass after. Includes `a bracketed IPv6 target produces a URL a WebSocket can
  open`, which composes `parseArgs` with `hostForUrl` so it fails on the actual defect rather than
  on the intermediate shape.
- `packages/tui/src/ui/app.test.ts` — `warns about a client that was already attached before the
  TUI started` is red against the pre-fix `app.ts` and green after. `a broadcast that lands during
  init outranks the fetched count` passes either way by construction and is there to pin the
  precedence rule.
- `packages/backend/src/ws/server.test.ts` — `reports the live client count to anything that asks`.
- End-to-end: a scratch backend on port 45993 with the new request handler, a raw client already
  attached, and a `WsClient` that waits out the 150ms negotiation window before asking →
  `count: 2 → otherClients = 1`.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- `bun test packages/tui packages/backend` → 1093 pass, 0 fail. Full `bun test` → 1348 pass,
  8 fail — exactly the known Task 22 set.

## Decisions taken (Task 18, review round 1)

- **A bare IPv6 target is now a usage error rather than a best guess.** `::1:7777` used to parse as
  host `::1`; it now throws and asks for `[::1]:7777`. The two readings of `::1:7777` — an address
  with a port and an address without one — cannot be told apart, and the URL authority grammar
  settles it the same way. Nothing depends on the old behaviour: Task 18.1, the smoke test, has not
  been run yet.
- **The unbracketed branch splits on the *first* colon, not the last.** A `PLAIN_HOST` host has no
  colon in it, so the two differ only on input that is rejected either way, and `indexOf` reads as
  the same rule the validation states.
- **The initial count is fetched rather than latched in `index.ts`.** Registering a listener before
  `connect()` would also catch the frame, but the handler belongs to `App`, which does not exist
  until after negotiation — so that shape needs a latch in `index.ts` and a new `App` dep to carry
  it. Fetch-then-follow is what `store.load()` plus the store's broadcast subscriptions already do
  for projects and tasks, and it does not depend on the socket delivering a frame at exactly the
  right moment.
- **`clientCount()` is exposed on the server rather than the router closing over `clients`.**
  `packages/backend/src/index.ts` already holds `server` and uses `server.broadcast`, so this adds
  one accessor instead of a second reference to the client set.
- **The backend change was made rather than deferred.** It is outside `packages/tui`, but Task 16
  already established that backend work serving the TUI belongs to this plan, and the defect is in
  a Task 18 feature.

## Task 18, review round 2

One gpt-5.5 review via codex-review (Mode B, self-contained prompt over
`git diff 3e31dd2..684ffa6 -- packages/`, i.e. the whole Task 18 change including the round-1
fixes). Codex returned two findings. One is confirmed and fixed in `b98ca3b`; the other rests on a
premise that does not hold for this backend and was dropped.

### Confirmed and fixed

1. **`--connect [fe80::1%en0]:7777` cannot connect at all** (Codex, medium; verified here).
   Symptom: the TUI prints `SyntaxError: Invalid url for WebSocket ws://[fe80::1%en0]:7777` and
   exits, instead of a usage error. `parseTarget`'s `IPV6_HOST` regex *deliberately* supported a
   zone id — round 1 added `(?:%[A-Za-z0-9._~-]+)?` to it and a test, `keeps an IPv6 zone id`,
   pinning the acceptance — but the WHATWG URL parser rejects a zone id outright, in either
   spelling: `new URL("ws://[fe80::1%en0]:7777")` and `new URL("ws://[fe80::1%25en0]:7777")` both
   throw `Invalid URL`. So the one form the regex went out of its way to allow was the one form
   that could never be dialled. This is the same defect class as round 1's finding 1, one layer in:
   the host passed the shape check and then failed the grammar.

   The same loose shape accepted `[:]:7777`, `[1:2:3:4:5:6:7:8:9]:7777` and `[::g]:7777`, and
   `PLAIN_HOST`'s `%` accepted `%:7777`, `%zz:7777` and `a%2Fb:7777` — all of them unopenable.

   Evidence, end to end:
   - Before: `bun run packages/tui/src/index.ts --connect '[fe80::1%en0]:7777'` →
     `SyntaxError: Invalid url for WebSocket ws://[fe80::1%en0]:7777`.
   - After: the same command →
     `error: --connect expects host:port. usage: taskflow-tui [--connect <host:port>] (IPv6 must be bracketed: [::1]:7777)`.
   - Regression tests in `packages/tui/src/cli.test.ts`: `rejects an IPv6 zone id, which no URL
     parser will take`, `rejects a bracketed literal that is not a valid IPv6 address`, `rejects a
     host whose percent sequence is not one a URL accepts` — all three red against `684ffa6`'s
     `cli.ts`, green after. Run with `bun test packages/tui/src/cli.test.ts`.

### Dropped — premise disproven

2. **"`await clients` can stall startup for 30s against a backend that never answers"**
   (Codex, medium). Not reachable. `Router.handle` throws `No handler for message type: <type>`
   for anything unregistered, and `server.ts`'s `message` handler turns that throw into an error
   response, which `WsClient` uses to reject the pending request immediately. Measured against a
   faithful stand-in for an older backend — the real `Router` and `createServer` from this repo
   with no `SYSTEM_CLIENTS` handler registered, a real `WsClient` dialling it:
   `REJECTED in 0ms: No handler for message type: system:clients`. Codex's repro used a fabricated
   `NetLike` whose request never settles, which demonstrates the shape of the code rather than a
   reachable defect. `init()` is left as it is.

### Fixes

- **`packages/tui/src/net/client.ts`** — new `backendUrl(host, port)`, exported and used by
  `connect()`, so the string that is validated and the string that is dialled are the same one.
- **`packages/tui/src/cli.ts`** — `PLAIN_HOST` and `IPV6_HOST` are gone. `parseTarget` keeps the
  structural split (bracketed vs. first colon) and the port checks, then validates the host with
  `URL.canParse(backendUrl(host, port))`. A `hasControlOrSpace` scan runs first, because the URL
  parser *deletes* tab, CR and LF from an authority rather than refusing it — `desk<TAB>top:7777`
  would otherwise parse cleanly and dial `desktop`. It is a scan and not a regex because a
  character class holding literal controls fails `no-control-regex`, and CLAUDE.md forbids
  disabling the rule.

### Verification

- `packages/tui/src/cli.test.ts` — 5 tests added (25 total). Three are red against `684ffa6`;
  the other two are guards: `every accepted target produces a URL a WebSocket can open` builds a
  real `WebSocket` for every accepted form, and `rejects a control character in the host rather
  than letting it be stripped` pins the behaviour the removed `PLAIN_HOST` used to provide.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- `bun test packages/tui packages/backend` → 1098 pass, 0 fail. Full `bun test` → 1353 pass,
  8 fail — exactly the known Task 22 set.

## Decisions taken (Task 18, review round 2)

- **The host is validated by construction, not by description.** Every hand-written host regex is a
  second, worse copy of the URL grammar, and round 1 and round 2 each found it wrong in a different
  place. `URL.canParse` on the exact dialled string cannot be wrong about what will parse.
- **An IPv6 zone id is now a usage error rather than dead support.** There is no encoding of one
  that WHATWG URL accepts, so the choice was between rejecting it clearly and failing later with a
  `SyntaxError`. Reaching a link-local peer through the tunnel this feature is built around is not
  a case anyone loses.
- **`backendUrl` lives in `net/client.ts` rather than being spelled twice.** The defect was two
  descriptions of one URL disagreeing; a second literal in `cli.ts` would have reintroduced exactly
  that.
- **`init()`'s `await clients` is left alone.** See finding 2 above — the stall it is accused of
  needs a backend that answers some requests and silently drops others, which no build of this
  backend does.

## Task 18, review round 3

One gpt-5.5 review via codex-review (Mode B, self-contained prompt over `git diff 3e31dd2..b98ca3b
-- packages/`, with the round 1 and 2 findings and decisions listed so they would not be re-raised,
and the untouched areas — `index.ts`'s local/remote branch, the `clientsBroadcast` precedence rule,
the banner's bounds, `clientCount()` — named as where to press). Codex returned one finding. It was
already found here independently, before the report landed, and is confirmed and fixed in `74b5d0f`.

### Confirmed and fixed

1. **`--connect desktop/path:7777` silently dials `desktop:80`** (found here and by Codex,
   medium). Symptom: the TUI accepts the target without complaint and then fails to connect — to a
   machine and a port the user never typed. No usage error, and nothing on screen says the port was
   dropped.

   `URL.canParse` answers whether *some* URL comes out of the string, not whether the target
   survived as an authority. `ws://desktop/path:7777` parses fine — as the host `desktop` with the
   path `/path:7777` — so the check passed and `new WebSocket` then opened the default ws port.
   `/`, `\`, `?`, `#` and `@` all end the authority the same way, and each can only reach the host
   slice, because everything after the first colon is already required to be digits.

   This is round 1's finding 1 and round 2's finding 1 a third layer in: the target passed the
   check and was then re-read as something else. Rounds 1 and 2 moved from a shape regex to the
   parser; the parser was consulted for the wrong thing.

   Evidence, end to end:
   - Before, at `b98ca3b`: `parseArgs(["--connect","desktop/path:7777"])` →
     `{host:"desktop/path",port:7777}`; `new URL(backendUrl("desktop/path",7777))` →
     `hostname "desktop"`, `port ""`, `pathname "/path:7777"`.
   - After: `bun run packages/tui/src/index.ts --connect 'desktop/path:7777'` →
     `error: --connect expects host:port. usage: taskflow-tui [--connect <host:port>] (IPv6 must be bracketed: [::1]:7777)`.
   - Regression tests in `packages/tui/src/cli.test.ts`: `rejects a host a URL parser would read as
     something other than a host` (7 forms: `/`, `\`, `?`, `#`, `@`, `user:pw@`, and an IPv4 with a
     path) is red against `b98ca3b`'s `cli.ts`, green after. Run with
     `bun test packages/tui/src/cli.test.ts`.

Codex found nothing in `index.ts`, `app.ts`, `server.ts` or `index.ts`'s handler registration, and
nothing wrong with the new tests.

### Fixes

- **`packages/tui/src/cli.ts`** — `URL.canParse(...)` became `URL.parse(...)` plus a check that the
  result is authority-only: `username`, `password`, `search` and `hash` empty and `pathname === "/"`.
  A `null` parse is the old rejection. One parse, not two.

### Verification

- `packages/tui/src/cli.test.ts` — 2 tests added (27 total). `rejects a host a URL parser would
  read as something other than a host` is red against `b98ca3b`; `every accepted target is dialled
  at the host and port that were typed` is a guard, asserting `url.hostname` and `url.port` rather
  than only that the URL opens — including `desktop:80`, where `url.port` is `""` because 80 is
  ws's default and not because a port went missing.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- Full `bun test` → 1355 pass, 8 fail in 98s — exactly the known Task 22 set.

## Decisions taken (Task 18, review round 3)

- **The parser is asked what the target parsed *to*, not just whether it parsed.** Every round of
  this defect has been the same mistake at a different depth: a check that says the string is
  plausible rather than that it means what was typed. Reading back the parsed URL's own fields is
  the end of that regress — there is nothing further in to be wrong about.
- **The authority-only check is spelled as five field comparisons rather than a delimiter scan.**
  A scan for `/ \ ? # @` would be a sixth hand-written description of URL syntax, which is the
  thing rounds 1 and 2 removed. The fields are what the parser actually decided.
- **`user@desktop:7777` is a usage error rather than a host with the credentials dropped.** It
  would have dialled `desktop:7777` correctly, so this is stricter than it has to be — but an
  ssh-style target that quietly loses half of itself is the class of surprise this whole thread of
  findings is about, and nothing needs userinfo against a backend with no authentication.

## Task 18, review round 4

One gpt-5.5 review via codex-review (Mode B, self-contained prompt over `git diff 3e31dd2..HEAD
-- packages/`). The brief listed all seven findings from rounds 1–3 and the three deliberate
rejections, said explicitly that `cli.ts`'s host validation was exhausted and not to press there
again, and named the six least-scrutinised areas instead — the `init()` client-count race, the
reconnect re-attach, the banner's drawing, the local/remote branch in `index.ts`, the backend's
`clientCount()`, and the new tests. Codex returned two findings. Both are confirmed and fixed in
`90a161f`.

### Confirmed and fixed

1. **A flaky reconnect blanks the session pane** (Codex, medium; verified here). What you would
   see: the tunnel drops, comes back, and drops again a moment later — and the session pane goes
   empty. The child's output is still on the backend and the child is still running, but nothing on
   this side redraws it until some later reconnect happens to succeed.

   `App`'s reconnect listener (`packages/tui/src/ui/app.ts:76`, added by Task 18) calls
   `session.term.attach()`. `SessionTerminal.attach()` cleared the grid up front — `terminal.reset()`
   through the write queue — because a snapshot is a whole screen and would otherwise render twice.
   But the clear happened *before* the fetch, so when both `SESSION_SNAPSHOT` and `SESSION_HISTORY`
   reject, `finishLoad(-1)` replays only `pending`, which is empty in the steady state (the previous
   successful attach drained it). Reset, nothing to put back.

   The comment Task 18 added on the reconnect loop asserted the opposite — "an attach that fails
   leaves that stale screen up" — so this was a promise the code did not keep.

   Evidence: `SessionTerminal > a re-attach that fetches nothing leaves the screen it had` in
   `packages/tui/src/term/session-terminal.test.ts` — attach once against a snapshot of `"HELLO"`,
   take the net offline, attach again. Red against `74b5d0f` (row 0 reads `""`), green after. Run
   with `bun test packages/tui/src/term/session-terminal.test.ts`.

2. **Clicking the client banner switches to a tab hidden under it** (Codex, low; verified here).
   What you would see: several sessions open and another client attached, so the tab strip runs
   under the ` N other client(s) attached ` banner. Clicking on the words "attached" opens whichever
   session's tab is buried there — the pane switches to a session the user cannot see they clicked.

   `drawClientWarning` paints over the right of the tab row, but `routeMouse`
   (`packages/tui/src/ui/routing.ts:169`) still resolved that whole row through `tabSpans`. The
   banner's start column existed in exactly one place — inside the draw method — so the hit-test
   had no way to know about it. This is the `computeLayout` rule (what is drawn and what is
   hit-tested come from one source) not applied to the banner.

   Evidence: `App > a click on the client warning does not reach the tab under it` in
   `packages/tui/src/ui/app.test.ts` — three sessions, one other client, click the column showing
   `"attached"`; red against `74b5d0f` (`activeSession` becomes 2), green after. Pinned at the unit
   level too by `routeMouse > a click on the client warning is not a click on the tab under it` in
   `packages/tui/src/ui/routing.test.ts`, which asserts the same column both ways.

Nothing was reported against `index.ts`'s local/remote branch, the `clientsBroadcast` precedence
rule, `clientCount()`, the `SYSTEM_CLIENTS` request registration, or the new tests, and — as asked
— nothing further against `cli.ts`.

### Fixes

- **`packages/tui/src/term/session-terminal.ts`** — the reset moved from the top of `attach()` into
  a `clearGrid()` closure called only once a snapshot or a history reply is in hand. It is
  idempotent and a no-op on a first attach, and it is what now sets `historyLoaded = false` and
  takes `recent` into `pending`, so output arriving while the fetch is in flight keeps updating the
  live screen and is still replayed after the clear. The history path's `enqueue(restore)` moved
  inside the same `try`, after `clearGrid()`, because `restore` is filled in by the reset. The
  total-failure path is byte-for-byte the old one minus the reset: `savedKitty` is empty because
  the reset never ran, so `recoverKittyStack` is a no-op, and `finishLoad(-1)` only puts
  `historyLoaded` back where it was.
- **`packages/tui/src/ui/app.ts`** — new module-level `clientWarning(otherClients, layout)`
  returning `{ text, startX }` or null. `drawClientWarning` draws from it and `handleMouse` passes
  its `startX` to `routeMouse`.
- **`packages/tui/src/ui/routing.ts`** — `routeMouse`'s ctx gains a required
  `warningStart: number | null`; a left press on the tab row at or past it returns `none`.

### Verification

- 3 tests added. All three red against `74b5d0f` and green after — confirmed by stashing only the
  three source files and re-running: `112 pass, 3 fail`.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- `bun test packages/tui packages/backend` → 1103 pass, 0 fail. Full `bun test` → 1358 pass, 8 fail
  — exactly the known Task 22 set.

## Decisions taken (Task 18, review round 4)

- **The clear is deferred rather than the failure path being taught to restore.** Once
  `terminal.reset()` has run the old screen is gone and there is nothing left to restore from — the
  only fix that can work is not clearing until there is a replacement. Deferring also means the
  pane keeps showing live output through the fetch window instead of freezing, which is strictly
  better than what it did before.
- **`historyLoaded` moved into `clearGrid()` rather than staying at the top of `attach()`.** It is
  the flag that decides whether incoming output goes to the grid or into the replay queue, so it
  has to flip at the same moment the grid is wiped, not earlier. Left at the top it would hold
  output back for the whole fetch and then need it re-derived on the failure path.
- **`warningStart` is a required field on `routeMouse`'s ctx, not an optional one.** There is one
  production call site and an optional field would let a future one silently opt out of the rule.
  The 22 test call sites were updated mechanically.
- **The banner still overlays the tabs rather than shortening the strip.** Shortening would move
  every tab boundary whenever a client comes or goes, which is a worse surprise than a few
  unclickable columns; the tab under the banner is still reachable by its number key.

## Task 18, review round 5

One gpt-5.5 review via codex-review (Mode B, self-contained prompt over `git diff 3e31dd2..HEAD
-- packages/`). The brief listed all nine findings from rounds 1–4 and the deliberate rejections,
declared `cli.ts`'s host validation closed, and named the restructured `attach()` as the place to
press — specifically the ordering of `clearGrid()` against the write queue, output arriving during
the fetch window, **two overlapping `attach()` calls**, and whether the kitty/DEC recovery still
holds now the reset runs later. Codex returned one finding, at exactly that spot. It was also found
here independently, before the report landed, and is confirmed and fixed in `a0e3904`.

### Confirmed and fixed

1. **Two reconnects in quick succession leave the session pane showing two screens at once, the
   stale one on top** (found here and by Codex, high). What you would see on a flaky SSH tunnel:
   the connection drops, comes back, and drops and comes back again a moment later — and the pane
   ends up with the reconnected screen followed by the screen from the *previous* reconnect
   appended after it, so the visible content is duplicated and the newest output is buried.

   `App`'s reconnect listener (`packages/tui/src/ui/app.ts:90`) fires
   `void session.term.attach()` per open session on every `connected: true`, and nothing serialized
   `attach()` against itself. Two of them share `historyLoaded`, `pending` and the write queue:

   - Attach A's snapshot resolves, so it enters `clearGrid()`, sets `historyLoaded = false`, moves
     `recent` into `pending`, and parks on `await this.enqueueAction(...)` behind whatever is
     already in the write queue.
   - Attach B starts inside that window, reads `reattaching = this.historyLoaded` as `false`,
     concludes it is a *first* attach and skips the clear entirely.
   - B's snapshot is enqueued onto the uncleared grid; A then resumes and enqueues its older
     snapshot behind it.

   The double render is the exact thing the reset exists to prevent, and round 4's deferral of the
   reset is what opened the window — before it, `historyLoaded` was flipped in the first
   synchronous statements of `attach()`, so there was no awaited gap for a second attach to read
   the flag in.

   Evidence: `SessionTerminal > a second attach cannot start inside the first one's clear` in
   `packages/tui/src/term/session-terminal.test.ts`. It attaches once against a snapshot of
   `"FIRST"`, holds every `terminal.write` callback so the queued reset cannot complete, starts
   attach A and answers it with `"OLD"`, starts attach B inside A's clear and answers it with
   `"NEW"`, then releases the writes. Red against `90a161f` — row 0 reads `"NEWOLD"` — and green
   after, reading `"NEW"`. Run with `bun test packages/tui/src/term/session-terminal.test.ts`.
   (Independently reproduced here before the report arrived with a throwaway probe that stalled the
   queue with a large SGR chunk instead of holding the write callbacks; it showed the same
   interleaving as a doubled snapshot, `"XYZXYZ"`.)

Codex explicitly reported the client-warning routing (first banner column, `paneX` clamp, zoomed
layout, tiny buffers), the local/remote startup branch, and the backend `clientCount()` and
`SYSTEM_CLIENTS` registration as clean, and skipped `cli.ts` as asked. It found no `as any` and no
`eslint-disable` in the touched files.

### Fixes

- **`packages/tui/src/term/session-terminal.ts`** — `attach()` became a thin queueing wrapper over
  a new private `attachOnce()` holding the old body verbatim. A new `attachQueue: Promise<void>`
  chains each call behind the last, and the chain is advanced with `run.catch(() => undefined)` so
  one failed attach cannot make every later one reject without running. A second attach now starts
  from a settled terminal, so it sees `historyLoaded === true`, clears properly, and its snapshot
  is the last thing written.

### Verification

- 1 test added. Red against `90a161f` (`"NEWOLD"`), green after (`"NEW"`) — confirmed by stashing
  only `session-terminal.ts` and re-running: `36 pass, 1 fail`.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- `bun test packages/tui packages/backend` → 1104 pass, 0 fail. Full `bun test` → 1359 pass, 8 fail
  — exactly the known Task 22 set.

## Decisions taken (Task 18, review round 5)

- **Attaches are serialized rather than coalesced.** Collapsing a queued attach into the in-flight
  one would save a redundant fetch, but the in-flight one may be fetching over the socket that has
  just died — a reconnect genuinely wants a fresh snapshot. Serializing also costs no more requests
  than the old code already made; it only stops them overlapping.
- **The queue swallows rejections rather than propagating them.** `attach()` barely rejects today
  (its own `try`/`catch` covers both fetches), but a chain that carries a rejection forward would
  turn one bad attach into a permanently dead terminal. Callers still see their own rejection.
- **`attachOnce()` holds the old body unchanged.** The round-4 restructure is the least-reviewed
  code in the diff and is correct in isolation; the defect was that two copies of it could run at
  once. Wrapping is the smallest change that fixes it and leaves the reviewed logic byte-identical.
- **No guard was added inside `clearGrid()` instead.** A re-entrancy flag there would fix the
  double render but leave the two attaches still racing over `pending` and the write queue.
  Serializing at the entry point is the one place that makes all of that shared state single-writer.

## Task 18, review round 6

One gpt-5.5 review via codex-review (Mode B, self-contained prompt over `git diff 3e31dd2..HEAD
-- packages/`). The brief carried all ten findings from rounds 1–5 and the deliberate rejections,
repeated that `cli.ts`'s host validation is closed and that round 5 cleared the client-warning
routing, the local/remote branch and the backend client count, and named the new
`attach()`/`attachOnce()` split as the place to press — queue deadlock and starvation, reconnect
storms, `dispose()` racing a queued attach, `writeQueue` poisoning, and any remaining shared mutable
state across calls.

**Codex found no substantiated defect in the diff.** It reported checking `attachQueue`, the request
timeout and disconnect settlement, the reconnect fan-out, dispose-after-queued-attach, write-queue
rejection risk, the `pending`/`recent` replay, the client-count broadcast and removal, and the
`SYSTEM_CLIENTS` request path, and named none of them as broken. The same ground was covered
independently here before the report landed, with the same result — see the notes below.

### The one finding — real, but pre-existing and outside the diff

1. **`SessionOwner` was exported from `packages/tui/src/term/session-terminal.ts` with no importer**
   (Codex, low). CLAUDE.md forbids that, and round 1 of this same task fixed the identical thing for
   `CliOptions`. Verified here: `grep -rn "SessionOwner" packages/ --include="*.ts" --include="*.tsx"`
   returns only the declaration in that file plus two unrelated local declarations of the same name
   in `packages/backend/src/services/session-lifecycle.ts` and
   `packages/ui/src/components/workspace/CommitDialog.tsx`. Neither imports the TUI one.

   Not introduced by Task 18: `git log -S "export type { SessionOwner };" -- packages/tui/src/term/session-terminal.ts`
   points at `f693314` (Task 9), and `git merge-base --is-ancestor f693314 3e31dd2` confirms it
   predates this task's base. Fixed anyway — deleting an unimported type export cannot change
   behaviour, and leaving a known constraint violation in place to preserve a review round would be
   the wrong trade.

### Verified independently here

Everything the brief pressed on was traced here as well, before the report arrived. None of it
produced a defect:

- **The attach chain cannot wedge.** `WsClient.request` arms a `REQUEST_TIMEOUT_MS = 30_000` timer
  per request (`packages/tui/src/net/client.ts:230`) and `failPending` rejects every in-flight
  request on a socket drop, so `attachOnce()` is bounded at roughly two timeouts even against a
  backend that never answers. `attachQueue` is only ever `run.catch(() => undefined)`, which settles
  whenever `attachOnce()` settles.
- **`dispose()` racing a queued attach is unreachable.** `SessionTerminal.dispose()` has no
  production caller — `grep -rn "\.dispose()" packages/tui/src --include="*.ts"` outside tests hits
  only the two calls inside the class itself. The hazard it would create (a queued `terminal.reset()`
  on a disposed terminal poisoning `writeQueue`) cannot be reached from the shipped code.
- **`writeQueue` poisoning needs a throw that nothing can produce.** `enqueue`/`enqueueAction` chain
  with no `.catch`, so a rejection there would be permanent and would surface as an unhandled
  rejection from `void this.enqueue(...)` in the output listener. But the only throw sites are
  `terminal.write`/`terminal.reset` on a disposed terminal, which the point above rules out.
- **The reconnect fan-out is bounded and converges.** `App`'s listener
  (`packages/tui/src/ui/app.ts:90`) fires one `void term.attach().catch(() => undefined)` per open
  session; N reconnects queue N attaches that now run one at a time, the last one wins, and each is
  bounded by the request timeout. Wasteful under a storm, deliberately so — round 5 chose
  serializing over coalescing.
- **`pending` growth during an attach is short-lived.** It only accumulates between `clearGrid()` and
  `finishLoad()`, and both fetches have already resolved by the time `clearGrid()` runs, so the
  window is a write-queue drain rather than a network round trip.
- **`finishLoad(-1)` does not duplicate `recent`.** The failure path it serves is the one where
  `clearGrid()` never ran, so `pending` is empty; where it did run, `takeRecent()` emptied `recent`
  first, so the re-`remember()` restores rather than doubles.
- **`sessions` is empty in production today.** Stage 1 ships no `SESSION_CREATE` — see the comment at
  `packages/tui/src/ui/app.test.ts:334` — so the reconnect attach loop has nothing to iterate over
  yet. That is by design and is Stage 2's seam, not a defect.

### Fixes

- **`packages/tui/src/term/session-terminal.ts`** — deleted `export type { SessionOwner };`. The
  interface stays, used by `SessionTerminalDeps` in the same file.

### Verification

- No test added: the change removes a type-only export with no importer and no runtime surface.
- `bun run lint` clean, `bun run typecheck` clean across all five packages.
- `bun test packages/tui packages/backend` → 1104 pass, 0 fail. Full `bun test` → 1359 pass, 8 fail
  — exactly the known Task 22 set.
- Commit `b53e0e7`.

## Decisions taken (Task 18, review round 6)

- **Task 18 is marked clear after round 6 rather than going to a round 7.** The loop's rule is that a
  round with fixes earns another round, but the thing being re-reviewed would be the deletion of an
  unimported type export — there is no behaviour to re-check, and the finding was not in the diff
  under review in the first place. Codex's verdict on the actual diff was zero substantiated defects
  after being pressed specifically at the newest code, and the same ground was covered independently
  here with the same result. Six rounds over one task is already well past the point of return.
- **The pre-existing export was fixed rather than filed as a separate task.** It is a one-line
  deletion that lint and typecheck both confirm is inert. Filing it would cost more than fixing it.

Next step: AWAITING USER — Task 18.1 is the manual smoke test of remote mode over an SSH tunnel
(plan Step 7), and every remaining task is either another manual smoke test or needs its own plan.
Which should this loop do: (a) you run the 18.1 smoke test and report back, (b) skip 18.1 and 19.6
for now and have the loop write the plan for Task 20 (backend-side orphan shutdown), (c) have the
loop take Task 21 (bound the incomplete-CSI carry), which is small and self-contained, or (d) have
the loop investigate Task 22 (the full-suite-only `packages/ui` pane failures)?
Task 18 itself is clear — all automated work on it is done.
After that: Tasks 19.6, 20, 21, 22 and 23. **19.6 is also a manual smoke test — a user gate**;
20, 21, 22 and 23 each need their own plan or investigation.

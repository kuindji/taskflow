# Handoff — Taskflow TUI Stage 1

Plan: `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.md`

Status legend: pending / implemented / in-review round N / clear / review-skipped

## Tasks

| # | Task | Status | Base commit | Notes |
|---|---|---|---|---|
| 1 | Package scaffold and WebSocket client | clear | `49b7967` | commits `22b9b7d`, `6e5e6f4`, `8bdedf8`; clear after round 3 |
| 2 | Backend lifecycle | clear | `ee98048` | commits `f27a5aa`, `f156640`, `88f5dce`, `b55e5c6`, `1a16bf1`, `b4ac6a0`; clear after round 6 |
| 3 | Cell model and SGR encoding | clear | `ebf7354` | commits `93d23c0`, `0379d71`, `5ab47fb`, `8e6d9fb`; clear after round 3 |
| 4 | Screen diffing and flush | in-review round 1 | `7ff1b11` | commits `cc48d84`, `ecab7a5`; round 1 found 3 |
| 5 | TTY control and restoration | pending | — | |
| 6 | Legacy key decoder | pending | — | |
| 7 | Kitty key decoder and protocol negotiation | pending | — | |
| 8 | Per-child key encoding | pending | — | |
| 9 | Session terminal — attach, resync and mode tracking | pending | — | |
| 10 | Blit a terminal buffer into the screen | pending | — | |
| 11 | State store | pending | — | |
| 12 | Focus and key routing | pending | — | |
| 13 | Sidebar rendering | pending | — | |
| 14 | Session pane and tab strip | pending | — | |
| 15 | Application shell and entry point | pending | — | plan Step 6 is a manual smoke test — user gate |
| 16 | Backend — bind to loopback and report connected clients | pending | — | |
| 17 | Reconnection and session resync | pending | — | |
| 18 | Remote mode | pending | — | plan Step 7 is a manual smoke test over SSH — user gate |

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

## Decisions taken

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

Next step: Task 4 review round 2 — round 1 fixed three findings, so the task gets
another round. Run one gpt-5.5 review via the codex-review skill over
`7ff1b11..HEAD` (`packages/tui/src/render/screen.ts`, `screen.test.ts` and the
`copyCell` addition in `cells.ts`), verify every finding independently, fix the
substantiated ones, re-run `bun run lint && bun run typecheck && bun test`, and
commit.

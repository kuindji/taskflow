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
| 12 | Focus and key routing | implemented | `b44a56f` | commit `cc41d6f`; awaiting review round 1 |
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

Next step: Task 12 review round 1 — one gpt-5.5 review via codex-review over
`b44a56f..cc41d6f`, restricted to `packages/tui/src/ui`. Verify findings, fix the
substantiated ones, validate, commit.

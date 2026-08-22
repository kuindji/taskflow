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
| 9 | Session terminal — attach, resync and mode tracking | in-review round 2 | `4572b1f` | commits `f693314`, `b2de3c4`, `6261aea`; round 2's codex pass was void, 1 defect found independently and fixed |
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

Next step: Task 9 review round 3 — one gpt-5.5 review via the codex-review
skill over `--base 4572b1f`, with the working tree left untouched until the
report lands. Verify each finding, fix the substantiated ones, validate and
commit.

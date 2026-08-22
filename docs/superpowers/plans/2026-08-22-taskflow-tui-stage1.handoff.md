# Handoff — Taskflow TUI Stage 1

Plan: `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.md`

Status legend: pending / implemented / in-review round N / clear / review-skipped

## Tasks

| # | Task | Status | Base commit | Notes |
|---|---|---|---|---|
| 1 | Package scaffold and WebSocket client | clear | `49b7967` | commits `22b9b7d`, `6e5e6f4`, `8bdedf8`; clear after round 3 |
| 2 | Backend lifecycle | in-review round 1 | `ee98048` | commits `f27a5aa`, `f156640`; round 1 found 4, 3 fixed |
| 3 | Cell model and SGR encoding | pending | — | |
| 4 | Screen diffing and flush | pending | — | |
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

## Decisions taken

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

Next step: Task 2 review round 2 — gpt-5.5 via codex-review over `ee98048..HEAD`, restricted to `packages/tui/src/backend/` (round 1 changed code, so another round is due)

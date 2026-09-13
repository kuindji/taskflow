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
| 3 | Shared discovery types and the pure beacon codec | implemented | `f32c53f` | `a0a0907` | |
| 4 | The advertiser and listener, and the backend that runs one | pending | | | |
| 5 | The backend record list, keyed by uid | pending | | | |
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

## Validation baseline

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

Next step: Task 3 review round 1 — Codex gpt-5.5 prompted review of `f32c53f..a0a0907`
(packages only), checked against the superseded plan's Task 2 plus this plan's Deltas A–C.
Review needed: the codec is the LAN-facing trust boundary.

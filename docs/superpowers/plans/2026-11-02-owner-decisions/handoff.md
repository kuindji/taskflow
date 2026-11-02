# Handoff

Next: S7. S6 done (bf94a84c; Codex fix ad56e7b5 after one round).

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.
- `bun test packages/backend` is flaky under full-suite load: one run hung
  with no CPU after task-store tests, another failed `file-watcher.test.ts`
  ("watches for file changes") and `platform.test.ts` (backend exit 143).
  Every file passes alone. If the full run misbehaves, run files one by one
  with a time cap before blaming your change. Seen again in S2:
  `wiki-index.test.ts` (watch restart) and `taskflow-cli.test.ts` "names the
  master owner…" (~4.3s alone against the 5s timeout) failed only under load.
  In S3 that test timed out even alone, on the pre-S3 commit too.
- UI component tests: do not `mock.module` a shared component (e.g.
  `SplitContainer`); the mock outlives the file in a shared bun process.
  `Workspace.flow-input.test.tsx` already does this and breaks
  `SplitContainer.test.tsx` when both run together (pre-existing).
- An archived task selected in the sidebar makes `useActiveWorkspace` return
  no workspace (`selectedArchivedTask` in `task-store.ts`);
  `ArchivedTaskView` renders it.
- `ApiRouter` does not percent-decode path params; only routes that call
  `decodeURIComponent` themselves accept encoded ids. Do not `url_encode` ids
  in the shell CLI.

- S5 added `DataDirGate` (`services/data-dir-gate.ts`): every WS message
  and API route goes through it (settings excepted); refused while a data
  folder change runs. Timer-driven work started outside a request (scheduler
  ticks, remote agent restarts, startup worktree recovery) must use
  `tryRun`/`run`; work a request starts without awaiting uses `track`.
  Changing the data folder exits the backend with `BACKEND_RESTART_EXIT_CODE`;
  Electron relaunches the app (`electron/src/backend-restart.ts`).

- S6: `createServer` takes a 6th `identity` argument (the `GET /` banner,
  `backendBanner` in `shared/src/utils/backend-banner.ts`). The registry's
  `__setDiscoveredForTest` now runs the real discovery handler (seen, re-point).

## Owner checks

- S1: in the desktop app, "Run now" on a disabled schedule starts a session
  and the schedule stays disabled with no next run shown; the theme file
  picker no longer offers `.terminal`.
- S2: none needed; both CLIs were checked against a sandboxed live backend.
- S3: Run with options (Claude, Codex) shows "Default (<value>, from
  Settings)" on each field; the Settings pages still say "Default"/"Model
  default". Save an action with untouched fields, change the Settings
  effort, run it: the session uses the new effort. A schedule with type
  "Default" runs the Settings default agent.
- S4: in the archive view, click and Cmd+Arrow on an archived task both show
  the read-only view (description, notes, attributes, archive date,
  Unarchive). Unarchive opens the task's live workspace (the sidebar stays in
  the archive view). The Task Info panel shows "Select a task or project"
  meanwhile; the view itself carries the info.
- S5: in the packaged app, change the data folder (sessions closed): the
  confirm says Taskflow restarts, the app relaunches on the new folder with
  projects, tasks, flows, actions, schedules and notifications intact, and the
  old folder is empty. Reset to default the same way. With a session open the
  change is refused with "while a session is running". "Use Existing" on a
  folder with data switches to it after the relaunch. Window size/position
  may not be saved on that relaunch (the backend has already exited).
- S6 (not driven: needs two LAN machines): give a saved discovered machine a
  new IP (DHCP). Within ~15 s of its beacon moving, the record shows the new
  address, stays a single row, and an attached one reconnects with no trust
  dialog. A machine with a different host key at that address stays on the
  old record and appears as its own menu entry. Also: with two instances on
  one remote, a record whose remembered port the other instance took
  reconnects to its own port instead of failing with "unauthorized".
- S6 decision consequence for the owner: neither connect dialog (UI, TUI)
  asks for an instance, so a manual connect defaults to `main`. A manual
  connect by explicit port to a `dev-*` backend is now refused on first
  attach ("Another Taskflow instance answers on port …"), because the
  provisional record compares instances as the decision says. After a
  handshake the uid is compared instead. Say if the dialogs should get an
  instance field, or if provisional manual records should skip the check.

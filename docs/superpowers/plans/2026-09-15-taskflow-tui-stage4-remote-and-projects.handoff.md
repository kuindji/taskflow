# Handoff — Taskflow TUI Stage 4 remote machines, projects, archived tasks

Plan: `docs/superpowers/plans/2026-09-15-taskflow-tui-stage4-remote-and-projects.md`

Spec: `docs/superpowers/specs/2026-09-15-taskflow-tui-stage4-remote-and-projects-design.md`

Status: implementation in progress. Tasks 1 (move gate), 2 (state dir/state file/registry) and 3 (`openWorkspace` extraction) DONE. Next action: Task 4.

## Plan review

### Round 1 (Codex gpt-5.5, prompted plan review, 2026-09-15)

Six findings. Claude checked each against the code; all six were real and fixed in the plan.

1. **Blocker, Task 1.** `closing` (`electron/src/tunnel-manager.ts:257`) is module-level state the factory list left out. `closeAllTunnels` sets it (`:456`) and `openTunnel` reads it (`:385`), so one manager's quit would stop every other manager from opening tunnels. **Fix:** `closing` moves into the factory, with a test that `first.closeAllTunnels()` doesn't stop `second.openTunnel`.
2. **Major, Tasks 4/6.** `confirmBackend` closes the new tunnel when it merges into a live uid (`backend-registry.ts:399-410`). Switching to an alias of the attached machine would leave the new socket on a dead tunnel. **Fix:** `connectMachine` returns `alreadyAttached` on `merged: true`, closes the new client, and doesn't detach. The switch keeps the current workspace.
3. **Major, Task 6.** Signal and fatal-error shutdown goes through `OpenTuiRuntimeOwner.shutdown()` (`packages/tui/src/opentui/runtime.ts:90-138`), which never closes TUI tunnels. **Fix:** a `setShutdownHook` wired to `MachineSession.shutdown`, with runtime tests.
4. **Major, Task 7.** Product views take keys before global dispatch (`app.ts:752-763`) and send requests directly (`flow-run.ts:93`, `git-changes.ts:122-128`), so gating offline commands at dispatch would miss them. **Fix:** `OfflineGuardNet` wraps the net and rejects requests with `MachineOfflineError` while offline, covering every store and view.
5. **Major, Task 11.** OpenSSH ignores a fake `HOME` for its config and identities. Checked live: `HOME=<fake> ssh -G <host>` still lists the account's `~/.ssh/id_*` and `/Users/kuindji/.ssh/known_hosts`. **Fix:** the smoke puts an `ssh` wrapper first on `PATH` that adds `-F`, `-i` and `IdentitiesOnly=yes`.
6. **Minor, Task 11.** Known-hosts lines are written under `HostKeyAlias` (`tunnel-args.ts:31-33`), so the entry key is `taskflow-127.0.0.1-2222`, not `[127.0.0.1]:2222`. **Fix:** the smoke asserts the alias, and that the real `~/.taskflow/known_hosts` is unchanged.

Codex also confirmed:
- the importer list for the moved modules;
- 64 passing pre-move remote tests;
- the backend payload shapes for `project:*`, `task:list-archived`, `task:unarchive`, `task:delete` and task logs.

Found by Claude while planning, before round 1: `task:unarchive` returns only the parent task, and `task:delete` removes the worktree in the background. Task 10 and the local smoke account for both.

### Round 2 (Codex gpt-5.5, prompted plan review, 2026-09-15)

Verdict: changes required. Claude checked all six findings against the code; all six were real and fixed in the plan. Round-1 fixes 1 (`closing`) and 5 (ssh wrapper, alias) were confirmed correct. Fixes 2, 3 and 4 were incomplete and are revised below.

1. **Major, Task 6.** The shutdown hook ran after `renderer.destroy()` (`runtime.ts:128-138`), but it disposes OpenTUI renderables, which need a live renderer. **Fix:** the hook runs before `renderer.destroy()`, and the test asserts `hook → renderer.destroy → exit`.
2. **Major, Tasks 4/6.** `alreadyAttached` assumed a merge can only hit the current machine. A stale origin left by a partial switch also merges (`backend-registry.ts:395-410`). **Fix:** `MachineSession` decides. Same id means no-op. A different id means detach the stale origin, reconnect once and continue the switch. It also detaches any non-current remote id it attached. Tests cover both cases.
3. **Major, Tasks 3/6.** `Workspace.dispose()` wasn't required to call `app.destroy()`, the only place renderer listeners and the root renderable are removed (`app.ts:370-380`, `:2095`+). **Fix:** the dispose order starts with `app.destroy()`, plus a same-renderer rebuild test asserting one keypress and one resize listener.
4. **Major, Task 7.** Session input and resize swallow request errors (`session-bridge.ts:198-213`), so the offline guard alone drops keystrokes silently. **Fix:** the app doesn't forward keys to a focused session while offline and shows the notice once. The test asserts no `SESSION_INPUT`.
5. **Major, Task 10.** `buildRows` always adds Master Workspace, includes every project and emits flat task rows (`app.ts:156-199`). **Fix:** a `RowSource` options object (`includeMaster`, `tasksFor`, `omitEmptyProjects`, `nestSubtasks`). Active-sidebar row tests must stay unchanged.
6. **Major, Tasks 3/7.** `openWorkspace(net: WsClient)` can't accept a test fake or `OfflineGuardNet`. **Fix:** `openWorkspace(net: NetLike)`, with `NetLike` exported from `net/client.ts`.

Found by Claude after round 2:
- The round 2 resize fix assumed `lastResize` is cleared on reattach. It never is (`session-bridge.ts:54,208-209`). **Fix:** `SessionBridge.resetResize()`, with a test.
- `ConnectOutcome`'s type omitted the `alreadyAttached` variant. **Fix:** added to the type.
- `buildRows` callers pass positional arguments (`app.ts:491`, `app.test.ts:566,570`). **Fix:** `RowSource` is an optional fourth parameter.

### Round 3 (Codex gpt-5.5, prompted plan review, 2026-09-15)

No blockers. Round-2 fixes verified OK: shutdown hook ordering, stale-origin handling, same-renderer rebuild test, `openWorkspace(net: NetLike)`. Not OK: the resize reset path and `RowSource`, both fixed below. Claude checked all four findings against the code; all four were real and fixed.

1. **Major, Task 10.** `tasksFor: store.tasksFor` passes an unbound class method, and `tasksFor` reads `this.taskList` (`state/store.ts:205-207`). **Fix:** always pass an arrow, with a test through a real `Store`.
2. **Major, Task 10.** Archived selections and detail only work for active tasks. `resolveOwner` requires `status === "active"` (`sessions/owner.ts:58-63`) and runs on every refresh (`app.ts:504`); `openTaskDetail` uses `store.taskById` (`app.ts:989-990`). **Fix:** archive mode skips `resolveOwner`, and looks tasks up and resolves parent attributes through `ArchiveStore` first. Tests cover a selection surviving refresh, Enter opening read-only detail, and inherited attributes.
3. **Major, Task 7.** Nothing gave `MachineSession` a way to call `resetResize()` on bridges inside `OpenTuiApp`/`SessionController`. **Fix:** `SessionBridgeLike.resetResize` → `SessionController.resetResizes` → `Workspace.resetSessionResizes`, called on the transition to online, with a test.
4. **Major, Task 4.** A `client.connect()` or `SYSTEM_INFO` failure after `attachBackend` (which records the origin and `attached: true`, `backend-registry.ts:323-330`) had no cleanup. **Fix:** every step after attach detaches and closes on failure, and `connectMachine` never throws. Tests cover connect and handshake rejection.

Found by Claude after round 3: `resetResize()` must resend only for the active bridge, using the size `setActive` last applied (`session-bridge.ts:215-221`), so background sessions are never resized to a stale size.

### Round 4 (Codex gpt-5.5, verification round, 2026-09-15)

All four round-3 fixes were verified OK against the code. "No new blocker or major findings."

Codex also confirmed that selecting an archived task sends no failing requests:
- `onOwnerChange` only reconciles sessions (`entry.ts:267-268`);
- `sessionsForOwner` returns `[]` for archived ids;
- flow-run lookup accepts any owner id;
- schedules are project-scoped;
- task logs are keyed by id.

Plan review is complete.

## Implementation

### Task 1 — move the remote modules into `packages/shared` (gate)

Status: DONE. Commit: `refactor(shared): move remote tunnel and registry modules out of electron`.

- `backend-records`, `tunnel-args`, `tunnel-manager` and `backend-registry` and their tests moved with `git mv` to `packages/shared/src/remote/`. `@taskflow/shared/remote` exports `createRegistry`, `BackendRegistry`, `createTunnelManager`, `TunnelManager`, `TunnelResult` and `KNOWN_HOSTS_FILE`.
- `createTunnelManager()` holds `tunnels`, `pendingOpens`, `exitHandler`, `closing` and `scannedHostKeys`, along with every function that reads them. Stateless helpers and the constants stay at module level. No logic changed: a sorted, whitespace-insensitive line diff against the old file shows only the wrapper, the return object, the exports, the import paths and one prettier line wrap.
- The registry gained `load`, `startDiscovery` and `stopDiscovery`. `init` is `load` then `startDiscovery`, and `stop` is `stopDiscovery`.
- Electron's `main.ts` creates one manager and passes its methods to `createRegistry`. `ipc-handlers.ts` takes `tunnels: TunnelManager` in its deps.

Test counts:
- Before the move: `bun test electron/src` passed 83. The four moved files passed 15 (records), 23 (args), 3 (tunnel manager) and 23 (registry), 64 in total.
- After the move: `bun test packages/shared/src/remote` passes 68. That is the 64 moved tests, plus 2 new tunnel-manager isolation tests and 2 new registry tests (Step 5). `bun test electron/src` passes 19 (83 − 64).
- `bun run typecheck`, eslint on the changed paths and `bun run build:electron` all pass.

RED evidence (run in a scratchpad copy):
- With `closing` moved back to module scope, "closing all tunnels on one manager does not stop another from opening" fails with `Expected: not "Taskflow is quitting."`.
- With HEAD's registry, both new registry tests fail with `reg.load is not a function`.

Deviations:
- The brief says "plus the two new tests". The after-count is +4, because Step 5 adds registry tests as well.
- The `backend-registry` imports `fs/promises`, `os` and `path` still have no `node:` prefix. They are Node APIs, and they were left alone to keep the move logic-free.

### Task 2 — TUI state directory, state file and registry

Status: DONE. Commit: `feat(tui): add local machine state and registry wiring`.

- `packages/tui/src/remote/state-dir.ts`: `resolveStateDir(env, homeDir)` — `TASKFLOW_TUI_STATE_DIR` (absolute, else throws), else `$XDG_CONFIG_HOME/taskflow/tui`, else `<home>/.config/taskflow/tui`. Mirrors the override pattern already used by `resolveDevLaunchConfig` in `dev.ts`.
- `packages/tui/src/remote/tui-state.ts`: `TuiState { lastMachineId, selections }`, `readTuiState` (missing or unparsable `state.json` → empty state), `writeTuiState` (creates the dir with `mkdir(dir, {recursive:true, mode:0o700})`, then temp file + rename).
- `packages/tui/src/remote/machines.ts`: `LOCAL_MACHINE_ID = "local"`, `Machines { registry, tunnels }`, `createMachines(stateDir)` — `mkdirSync(stateDir, {recursive:true, mode:0o700})`, then `createTunnelManager()` and `createRegistry({file: join(stateDir, "backends.json"), defaultUser: userInfo().username, ...tunnels methods})`, mirroring `electron/src/main.ts`. Deliberately does not call `registry.init()`/`startDiscovery()` — callers decide when to start the listener.
- `packages/tui/src/dev.ts`: added `devStateDir(configDir) => join(configDir, "tui")`, exported, and `main()` now sets `TASKFLOW_TUI_STATE_DIR` to it unless already set in the environment.

Test counts:
- New: `state-dir.test.ts` (4), `tui-state.test.ts` (4), `machines.test.ts` (1) = 9 in `packages/tui/src/remote`. Plus one new case in `dev.test.ts` for `devStateDir`. `bun test packages/tui/src/remote packages/tui/src/dev.test.ts` → 16 pass, 0 fail.
- `bun run typecheck` passes for every workspace package. `bunx eslint` on all changed/new files reports nothing.

RED evidence: before implementation, `bun test packages/tui/src/remote` failed with "Cannot find module './state-dir'" / "./tui-state'" / "./machines'" (3 errors, 0 pass).

Deviations:
- The `machines.test.ts` spec ("no listener starts (no `startDiscovery` call)") is verified by monkey-patching the *instance* method returned by the real `createRegistry` (`machines.registry.startDiscovery = mock(...)`) rather than mocking the `@taskflow/shared/remote` module. An earlier attempt with `mock.module` hit the known Bun gotcha (rewriting a live-binding import causes `createRegistry` to call itself and blow the call stack, per `project_bun_test_mock_module.md`); capturing the real function by dynamic-import value did not avoid it either, since bun re-resolves the named import binding through the mocked module. Spying on the returned instance sidesteps the whole class of bug and needed no `mock.module`, so the file has no cross-test leak risk.

#### Fix round 1

Commit: `fix(tui): validate tui state and tighten discovery test`.

Three controller-verified findings, all fixed:
1. `tui-state.ts`'s bare `catch` in `readTuiState` turned every read failure into empty state. Now `ENOENT` (via an `isErrnoException` type guard) and JSON `SyntaxError` both return empty state; any other error (`EACCES`, `EISDIR`, ...) rethrows.
2. `JSON.parse(raw) as TuiState` was an unchecked cast — a `state.json` of `null` made `readTuiState` return `null`, and `state.lastMachineId` then threw. Replaced with `parseTuiState(value: unknown): TuiState` built from type guards (`isPlainObject`, `isStringOrNull`, `isSelectionEntry`): an invalid top level falls back to empty state, invalid individual `selections` entries are dropped while valid ones survive. No `as` on unvalidated data.
3. `machines.test.ts`'s `startDiscovery` spy was installed on the registry *after* `createMachines` had already run, so it couldn't catch a `startDiscovery()` call made during construction. Added an unexported `MachineFactories` seam (`{createRegistry, createTunnelManager}`, defaulting to the real functions) and an optional second parameter on `createMachines`; the test now installs the spy inside a `createRegistry` wrapper before `createMachines` ever sees the returned registry. Verified by temporarily adding `registry.startDiscovery()` inside `createMachines` (test failed), then removing it (test passed).

Test counts: `tui-state.test.ts` +5 (JSON `null`, JSON `[]`, wrong-typed `lastMachineId`, invalid selection entries dropped, directory-at-path rejects). `machines.test.ts` reworked, same 1 test. `bun test packages/tui/src/remote` → 14 pass, 0 fail (up from 9). `bun run typecheck` and `bunx eslint` on the four changed files both clean, no new `eslint-disable` comments.

RED evidence: the 5 new `tui-state.test.ts` cases failed against the pre-fix code (bare catch / unchecked cast) with the exact symptoms in each finding. The `machines.test.ts` RED was demonstrated by temporarily adding a `startDiscovery()` call inside `createMachines`, confirming the reworked test catches it (`Expected number of calls: 0, Received number of calls: 1`), then reverting.

### Task 3 — extract `openWorkspace`

Status: DONE. Commit: `refactor(tui): build the workspace in one disposable unit`.

- `packages/tui/src/opentui/workspace.ts`: `openWorkspace(net: NetLike, context: WorkspaceContext): Promise<Workspace>` builds the stores, session controller, action runner, external editor wiring and `OpenTuiApp`, then runs `app.init()`. `dispose()` is idempotent and runs `app.destroy()` → `controller.destroy()` → every store's `dispose()`, and never touches the renderer. If `init()` throws, `openWorkspace` disposes what it built and rethrows.
- `hasOpenEditor()` counts `onEditTaskText`/`onEditRecord` work in progress (incremented before, decremented in `finally`).
- `selection()` maps `app.selectedOwner` to `{projectId, taskId}`. `restoreSelection` selects the task if the store has it, otherwise the project if the store has it, otherwise does nothing. It goes through a new public `OpenTuiApp.selectOwner(owner)`, which sets the owner and runs the existing `refreshRows(true)`.
- `entry.ts` keeps argument parsing, the runtime owner, backend start and `finish`, and calls `openWorkspace` once. Context: `--connect host:port` → `local: false`, `machineId: "connect:<host>:<port>"`, label `<host>:<port>`; otherwise `local: true`, `machineId: "local"`, label `This machine`. `onQuit` → `finish(0)`; `onSwitchMachine` is a no-op. The label isn't rendered.
- `editorActions` moved with the editor code into `workspace.ts`.
- `FakeNet`, `project`, `task` and `fullSettings` moved out of `app.test.ts` into `packages/tui/src/opentui/test-helpers.ts`, which both tests import.

Test counts:
- Before: `bun test packages/tui` → 288 pass across 50 files.
- After: 298 pass, 0 fail across 51 files. That is 288 + 5 new `workspace.test.ts` tests + 5 tests from uncommitted `packages/tui/src/remote` changes that belong to another agent and are not in this commit (`bun test packages/tui/src/remote` → 14, Task 2 recorded 9).
- `bun run typecheck` passes for every package. `bunx eslint` on the changed files reports nothing. No TUI test file uses `mock.module`.

RED evidence: `bun test packages/tui/src/opentui/workspace.test.ts` failed with `Cannot find module './workspace'` before implementation.

Deviations:
- No `resetSessionResizes()` on `Workspace` (controller ruling: Task 7 adds it).
- Added `OpenTuiApp.selectOwner` (6 lines); the app had no public way to set the selection.
- `opentui-index.test.ts` now imports `editorActions` from `workspace.ts`, and its `new SessionController` source check reads `workspace.ts`, because that code moved.
- The `hasOpenEditor` tests drive the real key path (`t`/`e`/Enter and `f`/`n`/Enter) with a system-info editor whose command is `true`, and hold the `TASK_UPDATE` / `FLOW_DEFINITION_SAVE` response open. The workspace has no test-only seam.

### Task 4 — connect service and picker model

Status: DONE. Commit: `feat(tui): connect to saved machines through the shared registry`.

- `WsClient.retarget(port, host)`: `port`/`host` are no longer readonly. A live socket is disconnected and the retry loop is armed explicitly, because `disconnect` detaches `onclose`. A closed client stays closed.
- `remote/connect.ts`: `connectMachine(machines: { registry: RegistryPort }, id, deps?)` returns `ConnectOutcome` and never throws. Once the attach succeeds, any throw (origin parse, connect, `SYSTEM_INFO`, `confirmBackend`) closes the client and detaches. A protocol mismatch closes, detaches and returns `incompatible`. A merge closes without detaching and returns `alreadyAttached` with the canonical id.
- `remote/picker-model.ts`: `PickerRow`, `buildPickerRows`, `initialIndex`, `findMachineByName`.

Test counts: `bun test packages/tui/src/remote packages/tui/src/net/client.test.ts` → 41 pass. `bun test packages/tui` → 317 pass, 0 fail across 53 files (was 298, +19). `bun run typecheck` and `bunx eslint` on the changed files are clean.

RED evidence: the new `retarget` test failed, and `connect.test.ts` / `picker-model.test.ts` failed with `Cannot find module`.

Deviations:
- `deps.createClient` and the success variant's `net` use `MachineClient` (`NetLike` plus `connect`/`retarget`/`close`), which `WsClient` satisfies, instead of `WsClient` (controller ruling: a fake can't match private fields).
- A backend whose `SYSTEM_INFO` has no `backendUid` skips `confirmBackend` and keeps the requested id, as the renderer's `backend-store.ts` does. The brief didn't cover this case.
- Extra tests for an unparsable origin and the no-uid path.

### Task 5 — machine picker and launch

Status: DONE_WITH_CONCERNS. Commit: `feat(tui): open a machine picker at launch`.

- `cli.ts`: `CliOptions` is `{ connect, machine }`. One positional sets `machine`. A second positional, or a positional together with `--connect`, is a usage error. `USAGE` is updated.
- `opentui/machine-picker.ts`: `MachinePicker`, with the rows from `buildPickerRows` preselected by `initialIndex`. Keys: `↑↓/jk`, Enter (on the add row it opens the form), `a` for the add form (host, SSH user, SSH port, backend port; host required, ports 1–65535 or empty), `R` rename and `F` forget (with `Confirm`) only on saved rows, Esc (`onCancel`; the hints say Quit in `launch` and Close in `switch`). `showFailure` stays until the next key. Launch mode draws its own key-hint footer. `askTrust(renderer, fingerprint, host)` subscribes to `keyInput` itself.
- `opentui/entry.ts`: `--connect` keeps the direct path and never touches the registry. Otherwise it resolves the state dir, then `createMachines`, `load`, `readTuiState`. An unknown name prints `Unknown machine "<name>". Saved: <names>` and exits 2. The pick and connect logic lives in `launchMachine` plus `connectRow`/`connectLocal`/`connectRemote`, ready for Task 6's `MachineSession`. Discovery runs only while the picker is shown. Quitting stops discovery and calls `tunnels.closeAllTunnels()` after the runtime shutdown.

Test counts: `bun test packages/tui` went from 317 to 340 across 54 files. This task adds 18 (3 cli + 15 picker). The other 5 are from ad4f9c8b (Task 4 fix, another agent). `bun run typecheck` and `bunx eslint` on the changed files are clean.

RED evidence: 6 cli tests failed (shape and positional), and `machine-picker.test.ts` failed with `Cannot find module './machine-picker'`.

Deviations:
- `MachinePicker.setPending(message | null)` was added, because the brief's interface has no way to show "Connecting…" or to block a second Enter while a connect runs.
- `singleLine` is now exported from `session-picker.ts` and reused rather than duplicated.
- An `alreadyAttached` result at launch shows "<name> is already connected." (controller ruling: treat it as a failure).
- The state dir, registry and state file are set up only on the non-`--connect` path, so `--connect` behaves exactly as before.
- The local backend now starts after the renderer exists (on pick), so a start failure shows in the picker.
- No automated test covers `entry.ts`, as in Task 3. It was checked by hand for the unknown-name exit (2) and the two-positional usage error.

### Task 6 — switching machines and the local backend lifecycle

Status: DONE_WITH_CONCERNS. Commit: `feat(tui): switch machines without leaving the terminal`.

- `opentui/machine-session.ts`: `MachineSession` owns the current `{workspace, net, machineId, local}`, the local backend it started, and the machine picker. `switchTo(row)` checks for an open editor, connects first, saves the old selection, disposes the old workspace, closes its net, detaches if it was remote (the local backend keeps running), then opens, restores the selection and writes `lastMachineId`. `alreadyAttached` for the current id is a no-op success. For any other id it runs `detach(stale)` and then `connect(stale)`. `openPicker()` shows the picker in `launch` mode when no workspace is open (Esc quits, keys come from `keyInput`) and in `switch` mode otherwise (Esc closes, keys go through the app overlay). Discovery starts on open and stops on close. `shutdown()` runs once: picker, workspace, net, `closeAllTunnels`, local backend stop, `stopDiscovery`. Every step runs even if an earlier one throws. All I/O comes through `MachineSessionDeps`, which `entry.ts` wires.
- `runtime.ts`: `setShutdownHook(hook)`, awaited before `renderer.destroy()`. A rejection is reported and cleanup continues.
- `keys.ts`/`help.ts`: the `machines` command (`m`, group `Machines`, placed after General in `GROUP_ORDER`).
- `app.ts`: `machineLabel` is the main panel's border title. `onSwitchMachine` handles `m` and shows the `m Machines` hint when set. `showOverlay(overlay: KeyOverlay): OverlayHandle` gives an outside dialog the keys and footer ahead of every app overlay.
- `workspace.ts`: passes `machineLabel`/`onSwitchMachine` through, and adds `showOverlay`. `WorkspaceContext.onSwitchMachine` is now optional, and `--connect` omits it.
- `entry.ts`: builds `MachineSession`, registers `session.shutdown` as the runtime hook, and no longer calls `ownSocket`/`ownBackend` for machine connections. `--connect` registers a hook that disposes its workspace.
- Carried from Task 5: rejections from `addBackend`/`updateBackend`/`removeBackend` show on the picker through `showFailure` and are never unhandled.

Test counts: `bun test packages/tui` went from 340 to 356 across 55 files (+10 machine-session, +2 runtime, +1 keys, +3 app). `bun run typecheck` and `bunx eslint` on the changed files are clean.

RED evidence: `machine-session.test.ts` failed with `Cannot find module './machine-session'`. The runtime hook tests (2), the keys `m` route and help-group tests (2) and the app label and overlay tests (2) failed.

Deviations:
- `Workspace.showOverlay`/`OpenTuiApp.showOverlay` (new `KeyOverlay`/`OverlayHandle` types) let the switch picker take keys ahead of the app through the app's own `handleKey` chain.
- Picking the row of the machine already open returns `{ok: true}` without connecting. Re-dialing it would reopen the tunnel that its live socket uses.
- A declined host-key trust now shows `Not connected: the host key of <host> was not trusted.`, because `switchTo`'s result has no "backed out" case.
- If `openWorkspace` throws after the old workspace is gone, the new connection is released and `switchTo` rejects. The picker then reports the error through `onFatal`, as launch did.
- `MachinePickerDeps` is now an exported type. Task 5's `prompting` key guard is gone: the picker is pending during every connect, and a pending picker already ignores keys.
- `entry.ts` has no automated test. The unknown-name exit (2) was re-checked by hand with a sandboxed HOME.

### Task 7 — dropped connections and quit

Status: DONE_WITH_CONCERNS. Commit: `feat(tui): show offline machines and reattach dropped tunnels`.

- `net/offline-guard.ts`: `OfflineGuardNet` (public `offline` flag) and `MachineOfflineError`. While `offline` is set, `request()` rejects without reaching the inner client. `on`/`onStatusChange` pass through. `MachineSession` hands each workspace a guard and keeps the raw client for `retarget`/`close`.
- `MachineSession`:
  - Tunnel exit: `registry.tunnelExited(id)` for every exit. For the current remote machine it also sets `offline: <failure.message>` and re-attaches with backoff 1/2/4/8/16/30 s (capped). `no-backend` sets `stopped` and stops. On success, `retarget(port, 127.0.0.1)`, and the status goes online on the client's connected status.
  - Raw socket status: a disconnect while online sets `offline: Connection lost`. Connected sets online, which opens the guard and calls `resetSessionResizes` once.
  - A switch or shutdown cancels the pending timer or in-flight attempt, and a late successful attach is detached or closed.
  - The new optional `schedule` dep defaults to `setTimeout`.
- Carried from Task 6: `shutdown()` saves the current selection and awaits `writeState` before disposing. A failed write still runs all cleanup, and `shutdown()` then rejects.
- `app.ts`: `setMachineStatus` (title `<label> offline: <reason>`), the exported `MachineStatus` type, and a footer notice `<label> is offline.` raised through `errorMessage` (every view's request-error path) plus `noticeOffline` for the FlowRun/Schedules callbacks. Keys bound for a focused session are consumed while not online.
- Resize reset layers: `SessionBridge.resetResize()` resends the size `setActive` applied, but only when active. Then `SessionController.resetResizes()`, then `Workspace.resetSessionResizes()`. `Workspace.setMachineStatus` was added too.
- `remote/connect.ts`: `parseOrigin` is exported and reused.

Test counts: `bun test packages/tui` went from 356 to 376 across 56 files (+2 offline-guard, +2 session-bridge, +11 machine-session, +4 app, +1 controller). `bun run typecheck` and `bunx eslint` on the changed files are clean.

RED evidence: offline-guard, machine-session and app tests failed with `Cannot find module`, and 2 session-bridge resize tests failed.

Deviations: `resetResize` uses the tracked applied size, because `renderable.width` is layout-computed. `tunnelExited` runs for any id. The retry failure reason doesn't replace the exit reason. `stopped` uses the offline title format. The status listener subscribes before `openWorkspace`, so the guard opens before the app's reconnect reloads. Concerns (status events during `openWorkspace` are ignored; mouse and paste input dropped silently while offline) are in the task-7 report.

### Task 8 — local-only gating and the Confirm toggle

Status: DONE. Commit: `feat(tui): gate this-machine-only commands`.

- `keys.ts`: `CommandMetadata.localOnly?: boolean`. No existing command is marked, and a keys test guards that.
- `app.ts`:
  - `OpenTuiAppDeps.local: boolean` (required), which `openWorkspace` fills from `context.local`.
  - `canRun(kind)` is the only check. `applyCommand` refuses a gated command and shows the footer notice `Only available on this machine.`, which the next command clears. The main footer skips hints that `canRun` refuses.
  - The offline and local-only notices share one prefix, and the offline text is unchanged.
- `help.ts`: `localOnly` commands get the ` (this machine only)` suffix.
- `confirm.ts`:
  - `ConfirmDeps.toggle?: { label; initial }`. `Space`/`t` flip it, it renders `[x] label` or `[ ] label`, and a `Space/t Toggle` hint is shown.
  - `onConfirm(toggleValue: boolean)`. Without a toggle, `false` is passed and behaviour is unchanged. `messageFor` is left to Task 9.

Test counts: `bun test packages/tui` went from 376 to 385 across 56 files (+2 confirm, +1 help, +1 keys, +2 app). The before-run also had 3 failures from another agent's in-progress `machine-session` tests, fixed in `684b0617`. `bun run typecheck` and `bunx eslint` on the changed files are clean.

RED evidence: 2 confirm toggle tests, the help suffix test and the remote app gating test failed.

Deviations: the app tests mark the `git` metadata entry `localOnly` for the duration of the test and delete the flag in cleanup, since no real localOnly command exists. The 11 existing app-test constructions got `local: true`. Prettier reformatted a few existing lines in `help.test.ts`.

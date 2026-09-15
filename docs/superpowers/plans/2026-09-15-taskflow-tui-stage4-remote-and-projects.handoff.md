# Handoff — Taskflow TUI Stage 4 remote machines, projects, archived tasks

Plan: `docs/superpowers/plans/2026-09-15-taskflow-tui-stage4-remote-and-projects.md`

Spec: `docs/superpowers/specs/2026-09-15-taskflow-tui-stage4-remote-and-projects-design.md`

Status: plan review DONE after round 4 (clean). No implementation code written. Next action: execute Task 1, the move gate.

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

# Handoff — Taskflow TUI Stage 4 remote machines, projects, archived tasks

Plan: `docs/superpowers/plans/2026-09-15-taskflow-tui-stage4-remote-and-projects.md`

Spec: `docs/superpowers/specs/2026-09-15-taskflow-tui-stage4-remote-and-projects-design.md`

Status: plan in review. No implementation code written.

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

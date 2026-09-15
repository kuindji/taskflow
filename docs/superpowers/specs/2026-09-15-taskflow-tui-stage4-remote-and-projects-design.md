# Taskflow TUI Stage 4 — remote machines, projects, archived tasks

Date: 2026-09-15

Status: design approved section by section in conversation; awaiting spec review.

## Purpose

The TUI mainly exists to reach a Taskflow backend on another device. The
desktop app stays the main client. The expected setup is the TUI running on a
Linux machine and attaching to a backend on a Mac on the same LAN.

Stage 3 finished local daily work. Stage 4 adds:

1. Attaching to one remote machine at a time, with discovery, ssh tunnels and
   host-key trust reused from the desktop's remote-projects feature (v0.15.0).
2. Project management (add, hide/remove, reorder, linked projects), only on the
   machine the TUI runs on.
3. Archived tasks: browse and unarchive on any machine, permanent delete only
   on the machine the TUI runs on.

## Decisions

| Question | Decision |
|---|---|
| Machines at once | One. A switcher reconnects to a different machine. No combined sidebar. |
| Launch | Open the machine picker with the last-used machine preselected. `taskflow-tui <name>` and `--connect host:port` skip it. |
| Remote code | Move the Electron-free remote modules into `packages/shared` and use them from both clients. No copies. |
| Saved machines | TUI-owned file on the TUI's own device. Not shared with the desktop app, which will usually be on a different OS and machine. |
| Host-key trust | Shared `~/.taskflow/known_hosts`. |
| Project management | Only when attached to "This machine". Remote project lists are read-only; changes there go through an agent on that machine. |
| Archived tasks | Browse and unarchive anywhere. Permanent delete only on "This machine". |

## Out of scope

- Several machines attached at once, machine badges, per-backend store
  namespacing.
- Adding projects on a remote machine, or any remote-path completion or folder
  browsing.
- Relocating a project whose folder is missing.
- A browser for hidden projects. Adding the same path again un-hides it.
- Project fork.
- Deleting active tasks directly. They are archived first.
- Sharing `backends.json` with the desktop app.
- Wiki, file explorer, search, browser panes, editor, diff viewer and further
  Git features. Users run terminal apps inside sessions for those.
- Changing desktop remote-projects behaviour. The move is a refactor only.

## 1. Shared remote code

Move from `electron/src` to `packages/shared/src/remote/`, exported as
`@taskflow/shared/remote`:

- `backend-records.ts`: unchanged.
- `tunnel-args.ts`: unchanged, including `KNOWN_HOSTS_FILE`.
- `tunnel-manager.ts`: the module-level child map and state become a
  `createTunnelManager()` factory, so each process owns its own ssh children.
  The exported operations keep their names and behaviour.
- `backend-registry.ts`: `createRegistry(deps)` is unchanged. Its deps come
  from a tunnel manager instance.
- Tests for these modules move with them.

`electron/src/main.ts` builds the registry from the shared modules. The IPC
handlers and preload stay in Electron.

The shared package must not import Electron, React or DOM APIs. The discovery
listener already fits this rule.

## 2. TUI local storage

The TUI's runtime settings live on the backend. Machine records and the
last-used machine must stay on the TUI's own device, so they get a local
directory:

- Base: `TASKFLOW_TUI_STATE_DIR` if set, otherwise
  `$XDG_CONFIG_HOME/taskflow/tui`, otherwise `~/.config/taskflow/tui`.
- `backends.json`: `BackendRecord[]`, read through `normalizeRecords` and
  written atomically, as the desktop registry does.
- `state.json`: the last-used machine id, and the last selected project and
  task per machine id.

The dev launcher sets the state dir inside its disposable config root, so dev
runs and smoke fixtures never touch real records.

## 3. Launch and the machine picker

`taskflow-tui` with no arguments opens the picker full-screen before any
backend starts.

Rows:

- **This machine**: starts the TUI-owned local backend exactly as today.
- Saved machines, marked as seen or not seen on the network.
- Discovered machines that are not saved yet. Picking one saves it first.
- **Add machine…**: a form for host, ssh user, ssh port and an optional
  backend port, for machines discovery can't see (VPN, another subnet).

Behaviour:

- The last-used machine is preselected. Enter connects.
- Saved machines can be renamed and forgotten from the picker.
- Failures return to the picker with the classified reason
  (`TunnelFailure.message`).
- The discovery listener runs only while the picker is open.
- The TUI's own beacon is filtered out once the local backend's handshake has
  reported its `backendUid`.

Arguments:

- `taskflow-tui <name>` connects directly to the saved machine whose display
  name or id matches, and fails with the list of saved names if none does.
- `--connect host:port` stays for a tunnel the user opened by hand. That
  target counts as remote for the local-only rules.

## 4. Connecting

1. The picker calls `registry.attachBackend(id)`. As in the desktop app, it
   resolves the backend port from the beacon or reads it over ssh, opens
   `ssh -N -L`, and returns a local origin.
2. `WsClient` connects to that origin.
3. Handshake: `SYSTEM_INFO` checks `protocolVersion` and passes `backendUid`
   to the registry so it can adopt the uid into the record.

Host keys:

- `unknown-host-key`: show the fingerprint from
  `fetchHostKeyFingerprint` and ask to trust it. On yes, `trustBackendHost`,
  then retry the attach.
- `changed-host-key`: refuse, show the reason, never offer trust.

## 5. Switching machines

A global key `m` opens the picker over the running app. Picking a different
machine runs a full switch:

1. Refuse if an external editor is open, naming it.
2. Detach every session bridge. Sessions keep running on their backend.
3. Dispose every store and the app view.
4. Close the WebSocket and the previous tunnel.
5. Connect to the new machine (section 4).
6. Rebuild the stores and app on the existing renderer, so the terminal does
   not leave the alternate screen.

The store and app wiring that is inline in `opentui/entry.ts` moves into one
`openWorkspace(net, context)` function that returns a disposable workspace.
Launch and switch both use it.

After a switch, the TUI restores the last selected project and task for that
machine from `state.json` when they still exist.

## 6. Local backend lifecycle

- A backend the TUI started for "This machine" keeps running while the TUI is
  attached elsewhere, so its sessions survive and switching back does not
  restart it.
- It is stopped on quit, as today.
- The TUI never starts or stops a remote backend.

## 7. Dropped connections

When the attached machine's tunnel exits (`onTunnelExit`) or the WebSocket
closes:

- The header shows the machine offline with the classified reason. The app
  stays readable on its last snapshot. Commands that send requests report that
  the machine is offline.
- The TUI re-attaches with backoff. If the new tunnel uses a different local
  port, `WsClient` is pointed at the new origin, and the existing reconnect
  path reloads the stores and reattaches sessions.
- A `no-backend` failure stops the retries. The user can press `m` to pick
  another machine.

For "This machine", the existing reconnect behaviour stays unchanged.

## 8. Quit

Close every tunnel the TUI opened and stop only the backend the TUI started.
Remote sessions are never stopped.

## 9. Project management (This machine only)

### Gating

A workspace carries `local: boolean`. It is true only when the TUI is attached
to the backend it started for "This machine". When it is false:

- project commands and archived-task delete are left out of the footer;
- help lists them with the note "this machine only";
- pressing their keys shows a notice and sends nothing.

Commands in a new help group, Projects.

### Add project (`p`)

- A form with a path field and an optional name field.
- Tab completes directory names by reading the local filesystem directly.
  `~` expands. Completion never contacts the backend.
- Sends `project:add {path, name?}`. Backend rules apply: default name,
  directory check, un-hiding a hidden project with the same path.

### Remove project (`X` on a project row)

- `Confirm` with a toggle, **Keep project data**, on by default.
- On: `project:update {id, hidden: true}`. The project disappears from the
  sidebar.
- Off: `project:remove {id}`, with the desktop wording: permanently remove the
  project and delete all of its tasks; cannot be undone.
- `Confirm` gains one optional labelled boolean toggle. The same toggle is used
  in section 10.

### Reorder (`J` / `K` on a project row)

Move the project down or up, send `project:reorder {orderedIds}` with the full
order, apply the change immediately, and roll it back if the request fails.

### Linked projects (`L` on a project row)

- Lists the current links with their notes.
- Add a link: a picker of other projects that are not hidden and not already
  linked, then an optional note.
- Edit a link's note, or remove the link.
- Every change sends `project:update {id, linkedProjects}`.

### Store updates

Over WebSocket, `project:add`, `project:remove` and `project:update` do not
broadcast, so the TUI applies each response to its own store. Reorder already
arrives as `project:reordered`.

### Missing folders

A project with `locationValid === false` gets a marker in the sidebar. There is
no relocate action.

## 10. Archived tasks

### Browse (any machine)

- `A` toggles archive mode in the sidebar.
- Entering archive mode loads `task:list-archived`, grouped by project and by
  parent task. Projects with no archived tasks are left out.
- The header shows **Archive**. The name and owner filters still apply.
- Handlers don't broadcast archive changes, so the list reloads on entering
  archive mode and after a reconnect.
- Enter opens the Stage 3 task detail read-only: description, notes,
  attributes and logs. Edit, session, Git and pin commands are hidden. The
  header shows the archive date and that archives are purged after 30 days.

### Unarchive (any machine)

`u` sends `task:unarchive {id}`. The backend restores subtasks and worktree
tracking. The TUI moves the task and its subtasks back to the active list from
the response, leaves archive mode, and selects the restored task.

### Permanent delete (This machine only)

- `D` in archive mode opens `Confirm`: "Permanently delete this task [and its
  N subtasks], their sessions, and all logs. This cannot be undone."
- For a top-level task with a worktree, the toggle **Also delete worktree and
  branch (`<branch>`)**, off by default.
- Sends `task:delete {id, deleteWorktree}` and removes the task from the
  archive list.
- Active tasks can't be deleted directly.

### Verify during planning

Confirm that the task detail requests (logs, attributes) resolve archived task
ids. If a handler only reads active tasks, the plan records it as a concrete
missing backend capability and adds the smallest change that fixes it.

## 11. Keys

New global keys: `m` (machines), `p` (add project), `A` (archive mode).
Contextual keys: `X`, `J`, `K`, `L` on project rows; `u`, `D` in archive mode.

None of these is bound as a global command in `keys.ts` today. The plan must
also check the overlay and product-view key handlers for conflicts, and
register every command in `COMMAND_METADATA` so help and footer are generated
from it.

## 12. Testing and verification

### Move gate

The shared-code move is the first task and a gate:

- the moved remote tests pass with import-path and factory-call changes only;
- `bun run typecheck`, lint, and the desktop build pass.

No TUI feature work starts before this gate is green.

### Unit tests

Each task adds tests that fail before the change and pass after it:

- picker model: rows, own-beacon filtering, preselection, failure display;
- argument parsing: none, a saved name, `--connect`;
- `openWorkspace` switching: each store disposed exactly once, bridges
  detached, no session stop requests, refusal while an external editor is
  open;
- dropped tunnel: offline state, re-attach, `WsClient` retargeted;
- local-only gating for every project command and archive delete;
- `Confirm` toggle; local path completion against a temporary directory;
- project add, hide, remove, reorder with rollback, link editing;
- archive mode loading, unarchive with subtasks, delete with and without
  `deleteWorktree`.

### Automated end-to-end smoke (no second machine)

Fixture: a throwaway `sshd` on `127.0.0.1:2222` with a generated host key and
an empty known_hosts, in front of a sandboxed backend (fake `HOME`,
`TASKFLOW_DEV_PORT`, disposable config root and TUI state dir).

Remote run, through the real picker:

- unknown host key prompt, trust, connect;
- project list read-only; project commands and delete refused;
- archive browse and unarchive;
- tunnel killed, offline indicator, reconnect;
- switch to "This machine" and back, remote sessions still running;
- after quit, no `ssh -N -L` child left and the local backend stopped.

Local run on "This machine":

- add with Tab completion, hide, remove, reorder, linked projects;
- archive delete with the worktree toggle on a disposable repository.

Fixtures are moved to Trash afterwards. No AI provider runs.

### Human gates

Stay open until the user reports them, never inferred:

- TUI on the Linux machine attaching to the Mac through discovery and through
  **Add machine…**;
- sleeping the Mac, then waking it;
- a real remote session attached and resized.

### Review

- The implementation plan gets at least two Codex gpt-5.5 review rounds before
  implementation.
- Level 0 validation per task.
- One Level 1 review over the full diff, including the moved desktop code.
- A verification-only pass after fixes.

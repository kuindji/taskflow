# Taskflow Remote Projects — Design

Date: 2026-08-24
Status: Approved for planning
Supersedes: `docs/superpowers/specs/2026-08-23-taskflow-multi-backend-design.md`

## Problem

The multi-backend design solves "I am on the laptop and I want to look at the
desktop" by making the client render exactly one backend at a time. Working
across two machines then means switching the whole app back and forth, and the
machine you are not looking at is invisible: no activity, no notifications, no
project list.

That is not how the machines are actually used. The same repository is checked
out on more than one machine and configured as a project on each. Some tasks
should run on the desktop because that is where the compute is; some should run
on the laptop because that is where the work is. An old laptop is only ever a
client, never a runner. What is wanted is both machines' projects in one
sidebar, and a task opening against whichever machine owns it.

The multi-backend design named this shape and rejected it — "Aggregating every
connected backend into one sidebar" under *Rejected alternatives* — on the
grounds that it "gives every project, task, session and store entry a backend
identity, which is a change to all ~196 `sendRequest` / `onEvent` call sites and
every record type, for a workflow the user does not have."

Two of those three premises turned out to be wrong.

The call-site count is 66, not 196 — 40 `sendRequest` and 26 `onEvent`, across
20 files, all in `packages/ui`; `backend`, `shared` and `tui` have none. Ten
files hold 50 of them.

```
grep -rn 'sendRequest(\|onEvent(' packages --include='*.ts' --include='*.tsx' | wc -l
```

And "every record type" is not needed at all, because every record id is a UUID
(`packages/backend/src/services/task-store.ts:426`,
`services/session-lifecycle.ts:314`, `services/notification-store.ts:60`).
Records from two machines cannot collide, so `activeTaskId`, `sessionStatus[id]`
and `workspaceKey = task:<id>` stay single strings. A backend identity is needed
for **routing** a request, never for **identifying** a record. That is the
difference between tagging records at ingest and rewriting every type and every
store into `Map<backendId, State>`.

The third premise — "a workflow the user does not have" — is the one that
actually changed. It is now the primary workflow.

## Scope

In scope: attaching several backends at once; projects and tasks from every
attached machine in one sidebar; a workspace that routes to its own machine;
notifications and activity from all attached machines; and the hard switch,
which turns the app into a full client of one remote backend.

Out of scope, deliberately: creating or repairing projects on a remote host
(unchanged from the superseded design — a remote backend is operated, not set
up); two tasks from two machines open in panes side by side; caching a machine's
records locally so an offline machine still lists its projects.

## Relationship to the superseded design

Most of the transport half carries over unedited and is not restated here. Read
the superseded document for the details of:

- The three required backend changes: loopback bind, the stable instance port
  file, and `PROTOCOL_VERSION`.
- The beacon: multicast group `239.255.42.98`, port `47654`, TTL 1, the payload
  shape, the probe reply, the `network.discoverable` setting, per-interface
  membership, rebinding, `reuseAddr`, and the macOS local-network permission.
- The port-file fallback over ssh for hosts multicast cannot reach.
- `BackendRecord` and its persistence to `userData/backends.json`.
- Tunnel argv, `BatchMode`/`ExitOnForwardFailure`/keepalives, the HTTP readiness
  probe, local port allocation and its retry.
- Failure classification and the table of classes.
- Host key trust, `ssh-keygen -F`, `ssh-keyscan`, and why a changed key is never
  auto-fixed.
- The flow-artifact endpoint and why `/api/file/raw` cannot serve it.

What this document changes is everything above the transport: how many backends
are connected, how the client addresses them, and what the UI does with more
than one.

Three additions to what carries over:

- `tunnel-manager` supervises a map of ssh children keyed by backend id rather
  than a single child.
- `BackendRecord` gains `attached: boolean`, persisted, so the set is restored
  at launch.
- A machine's beacon reappearing resets that machine's reconnect backoff. In the
  superseded design discovery only populated a menu; here it is also the signal
  that a sleeping machine woke up.

## Decisions

| Question | Decision |
|---|---|
| Topology | An attached **set** of backends. The client renders all of them at once |
| Modes | Aggregate (`{local, …remotes}`, primary = local) and hard switch (`{one remote}`, primary = that remote). One mechanism, two configurations |
| Record identity | UUIDs already collide-free across machines. No compound keys, no per-backend store maps |
| Routing | Explicit `backendId` argument on `sendRequest`; `onEvent` handlers receive the origin |
| Which stores aggregate | project, task, notification, schedule, session-activity. The workspace-scoped stores stay single-backend |
| Backend-derived caches | Keyed by `backendId`. Correctness, not hygiene |
| Attach timing | Every attached machine is dialled in the background at launch. Launch never waits |
| Offline machines | Section header with state and retry, no projects. No local record cache |
| Primary backend | Owns appearance, master workspace, connectivity, and the only **editable** settings. `layout.window` stays local always |
| Settings | Every attached machine's settings are mirrored read-only, so payloads built for a target machine use that machine's defaults. Only primary's are editable |
| Flow/action definitions | Always the owning machine's, globals included. A project's run menu never offers another machine's flows |
| Backend identity | A persistent `backendUid` minted by the backend, not the user-entered host. Two aliases of one backend cannot both attach |
| Remote setup | Out of scope. Local-path affordances stay disabled for remote targets |
| Sidebar shape | Local projects unheaded at top; one collapsible section per attached machine below |
| Project order | Per machine, unchanged. `PROJECT_REORDER` is untouched |
| Dirty editors | Keyed by `backendId` + path. Blocks nothing in aggregate mode; still blocks a hard switch |
| Version mismatch | Marks one machine "needs update". Does not block anything else |

### Rejected alternatives

**Keeping the superseded design's single active backend and only merging the
menu.** Cheapest by a wide margin and reuses Tasks 7–14 as written. Rejected
because you only see a machine's state while you are standing on it: no
cross-machine notifications and no activity badges, which is most of the value.

**Two tasks from two machines open side by side.** The most capable shape.
Rejected because the split view already stays within one task, so the panes,
terminals and per-task stores would gain a backend identity to serve a layout
that does not exist. Nothing here forecloses it; the connection registry is the
prerequisite either way.

**Caching each machine's project and task list locally so a sleeping machine
still shows its tree, greyed.** Nicer at launch and for a machine that is
usually asleep. Rejected for v1 because it needs a merge path when live data
arrives and a real answer for a cached task that no longer exists remotely. It
layers on later without redesign, since the aggregating stores already hold
records tagged by origin.

**A connection object threaded through React context** — the superseded
design's "approach B". Rejected again, for a new reason: the stores are zustand
modules outside React, so the connection has to be injected into them regardless,
and a context would only serve the pane layer. A required `backendId` argument
makes an unrouted call a type error at all 66 sites instead of a runtime
surprise at the ones that were missed.

**Two separate codepaths for aggregate mode and hard switch.** Rejected because
per-backend detach is required by aggregate mode anyway — a machine drops off
the network, or is unchecked in the menu — and a hard switch is that same detach
applied to everything, followed by one attach. Two codepaths would mean two
places for teardown to be incomplete.

**A machine picker inside the settings modal.** Would let the desktop's default
agent be changed without leaving aggregate mode. Rejected for v1: settings
belong to primary, and the hard switch is how you go and edit another machine's.
Revisit if hard-switching purely to flip an agent default proves annoying in
practice.

## Architecture

Six units. Three carry over from the superseded design with a widening; three
are new.

| Unit | Lives in | Responsibility | Knows nothing about |
|---|---|---|---|
| `discovery/` | `@taskflow/shared` | Unchanged from the superseded design | Taskflow records, Electron, React |
| `tunnel-manager` | `electron/src/` | A map of ssh children, one per attached remote | Taskflow records, persistence |
| `backend-registry` | `electron/src/` | The attached set, per-backend state, persistence, resolution to origins | SSH mechanics, React |
| `connection-registry` | `packages/ui/src/lib/` | `Map<backendId, Connection>`; per-connection socket, pending requests, reconnect | Taskflow records, stores |
| `backend-store` | `packages/ui/src/stores/` | Renderer mirror of the registry over IPC; drives attach, detach and the hard switch | Transport details |
| `store-reset` | `packages/ui/src/stores/` | Per-backend reset callbacks, invoked on detach | Any individual store's shape |

`store-reset` differs from the superseded design in one important way: a reset
callback takes a `backendId` and must drop only that machine's state. A reset
that clears everything is a bug in aggregate mode, and it is a bug that looks
like a working app until a second machine is attached.

### Backend identity

The superseded design keys a `BackendRecord` by `${host}:${instanceId}`, where
`host` is whatever the user typed or the beacon advertised. Under one active
backend an alias was a cosmetic annoyance. Under an attached set it corrupts the
sidebar: attach `192.168.1.20:main` manually and `desktop.local:main` from
discovery, and two records tunnel to one backend, hold two connections to it,
and deliver the same UUID records twice under two different `backendId`s.
Duplicate projects, duplicate tasks, doubled events.

Host strings therefore cannot be identity. The backend mints a persistent
`backendUid` once per data directory and reports it in both the beacon payload
and `SYSTEM_INFO`. The registry learns it at handshake and deduplicates on it: an
attach that resolves to an already-attached `backendUid` merges into the existing
record — updating its host if the new one is more reachable — rather than
becoming a second member. Host and `instanceId` stay on the record as the way to
*reach* a backend and as what the menu displays; they stop being what identifies
it.

This is the one addition to the carried-over transport half that is not a
widening: `backendUid` is a new field in the beacon and in `SYSTEM_INFO`, and it
lands alongside `protocolVersion` in the existing Task 1.

### The attached set

`backend-registry` in Electron main owns the set. The local backend is always a
member in aggregate mode, is always spawned as it is today, and is reached
directly on its port with no tunnel. Every remote member has a tunnel and an
origin of the form `http://127.0.0.1:<local forward port>`.

Exactly one member is **primary**. In aggregate mode primary is local. In
hard-switch mode the set has one member and it is primary.

### Connections and routing

`packages/ui/src/hooks/useWebSocket.ts` is today a set of module globals: one
`ws`, one `wsPort`, and shared `pendingRequests` / `eventListeners` /
`statusListeners` maps. Everything except `eventListeners` moves into a
`Connection` object:

```
Connection {
  backendId
  origin
  socket
  pendingRequests   // per connection; no generation tagging needed
  reconnectTimer
  reconnectAttempt
  status            // connected | reconnecting | offline
}
```

The connection registry holds `Map<backendId, Connection>`. Two connections to
*different* machines are separate objects, so no cross-backend generation
tagging is needed — the superseded design's counter existed to tell two sockets
to one logical backend apart during a swap, and that case is gone.

The *same-backend* case is not gone. A reconnect replaces the socket inside one
`Connection`, and the old socket can still deliver a late message, close or
error. Today that is handled by nulling `ws.onclose` before closing
(`useWebSocket.ts`), which does not cover a late `onmessage` resolving a pending
request on the replacement socket. So each `Connection` carries a socket
**epoch**: every socket captures the epoch it was created with, pending requests
are tagged with it, and `onmessage`, `onclose` and `onerror` return immediately
when their epoch is not current. Only the current socket may flip that
connection's status or schedule its reconnect.

The public surface becomes:

- `sendRequest(backendId, type, payload)` — required first argument.
- `sendFireAndForget(backendId, type, payload)`.
- `onEvent(type, handler)` where `handler(payload, backendId)`.
- `onStatusChange(backendId, handler)`.

`eventListeners` stays a single global map keyed by message type, as today.
Listeners are registered against types, not sockets, and every handler now
learns which machine an event came from. That second argument is the whole
correctness story for events: without it a `TASK_UPDATED` from the desktop
would overwrite a laptop task with the same store shape.

`packages/ui/src/lib/backend-url.ts` takes a `backendId` and resolves that
machine's origin, replacing `getBackendPort()`.

### Record origin

Records are stamped at ingest with the connection that delivered them, using a
client-only wrapper:

```ts
type Scoped<T> = T & { backendId: string };
```

declared in `packages/ui/src`. The protocol is untouched and no backend ever
sends a `backendId`. Stamping happens in exactly two places per aggregating
store — the fetch that fans out, and the event handler — so the origin cannot be
forgotten anywhere a record enters the client.

Mutations route by the record's own origin: `updateProject(project, …)` sends to
`project.backendId`. A store action that takes only an id must look the record
up first, which is why the stamp lives on the record rather than in a side map.

### Aggregating stores and workspace stores

The rule is **not** "stores that sound global aggregate". It is: **a store
aggregates if anything reads it from outside the active workspace.** The sidebar
is the reason — it renders every project and every task from every attached
machine, so any store the sidebar reads has to hold all machines' data at once.

**Aggregating** — flat maps and arrays holding records from every attached
machine:

- `project-store`, `task-store`, `notification-store`, `schedule-store`.
- `session-store`. The sidebar's `SessionBadge` reads session status and tabs
  for remote tasks, not only the open one.
- `diff-store`. It is populated entirely by the `GIT_CHANGE_STATS` broadcast
  (`stores/diff-store.ts:31`) and drives the diff badge and behind-count on
  every project and task row (`TaskSidebar.tsx:358-361`). Left single-backend,
  remote rows would silently show no badges at all.
- `flow-store`'s `flows` and `actions`. These are flat definition lists read by
  `hooks/useRunMenu.ts` and the management dialogs; a remote task's run menu has
  to offer that machine's flows. `activeRuns` is keyed by owner id and is
  collision-free.

**Workspace-scoped** — single-backend at any moment, taking their `backendId`
from the active workspace: `file-store`, `search-store`, `wiki-store`, and the
diff *content* fetches in `ChangesPane` (as distinct from `diff-store`, which
holds only stats).

`useActiveWorkspace()` gains the workspace's `backendId`, derived from the
project the active task belongs to, or from primary for master workspace. It is
the single place the pane layer reads its target from.

One key in the aggregating set is not a UUID. `MASTER_WORKSPACE_KEY` is the
fixed string `"master"` (`hooks/useActiveWorkspace.ts`), so master-workspace tab
state is a singleton. That is safe only because master workspace belongs to
primary and primary is unique. If per-machine master workspaces are ever wanted,
this key has to be scoped first.

### Per-backend slices and stale responses

Aggregating stores keep their records in **per-backend slices** internally, even
where selectors expose a flat array. This is not an optimisation; two mechanisms
depend on it.

Today `fetchProjects` does `set({ projects })` (`stores/project-store.ts:44`)
and `fetchTasks` does the equivalent (`stores/task-store.ts:47`) — each replaces
the whole array. Under a fan-out that is a lost update:

1. A fan-out fetch for `{local}` starts.
2. The desktop attaches; a fetch for `{local, desktop}` starts and resolves.
3. The first fetch resolves and overwrites the array, erasing the desktop.

So a fetch response replaces **only its own backend's slice**, and only if that
backend is still attached and the response belongs to the current attach
generation for it. Each attach increments a per-backend generation; a response
carrying a stale generation is dropped. A leg that fails leaves its slice as it
was and marks that machine offline; it never empties another machine's slice.

The attach generation is necessary but not sufficient — it only catches a slice
whose *connection* changed. Within one healthy connection, a list response is
still a snapshot that can be older than events already applied:

1. `TASK_LIST` for the desktop is sent.
2. `TASK_CREATED` arrives from the desktop and is applied to its slice.
3. The list response resolves and replaces the slice with a snapshot taken
   before that task existed.

The new task vanishes until something refetches. So each slice also carries a
**revision**, bumped by every event that mutates it. A list request records the
revision it was issued at, and its response is discarded if the slice has moved
on. Discarding is correct rather than wasteful: the events that bumped the
revision are themselves the newer state.

### Session sync is per backend

`syncWithTasks` and `syncWithProjects` reconcile session tabs against the owner
list they are handed. `syncOwnerTabs` (`stores/session-sync.ts:81-92`) rebuilds
the entire `task:` or `project:` namespace, keeping only the keys outside that
prefix, so **any workspace whose owner is absent from the list is dropped along
with its tabs**. With one backend that is correct. With an aggregated array, a
partial or in-flight fan-out result closes another machine's live terminals.

Session sync therefore takes a `backendId` and reconciles only that machine's
workspace keys against that machine's records. This is a contract of the design,
not implementer discipline, and it has a named test.

### Per-machine caches

Every module-level value derived from backend data becomes keyed by
`backendId`:

- `cachedAgents` in `packages/ui/src/hooks/useAgentAvailability.ts:8`
- `cachedHomedir` in `packages/ui/src/hooks/useActiveWorkspace.ts:19`
- `cachedEditors` in `packages/ui/src/lib/open-file.ts:10`
- `cachedModels` in `packages/ui/src/components/settings/CodexModelSelect.tsx:16`
- `dirTsconfigCache` and `activeTsconfigPath` in
  `packages/ui/src/lib/monaco-import-navigation.ts:9-12`
- the `initialized` guard and state in `packages/ui/src/hooks/useConnectivity.ts:32-34`
- the script and agent-command lists fetched by `hooks/useRunMenu.ts:92,100`
- `fileStatCache` in `components/panes/terminal/terminal-link-provider.ts:76`,
  keyed by absolute path only
- `pendingLines` in `components/panes/editor-dirty-state.ts:22`, also keyed by
  absolute path only

The last two are the shape to watch for: not every cross-machine collision is a
*record* cache. Any module-level map keyed by an absolute path is a collision
between two machines holding the same repository, and the path caches are easier
to miss than the record ones.

In the superseded design these were leaks to be cleaned on switch. Here they are
correctness: the New Task dialog for a desktop project must offer the desktop's
installed agents and runtimes, and the external-editor menu for a desktop file
must offer the desktop's editors. A global cache silently answers with whichever
machine replied first.

The rule for the implementer, applied rather than worked from this list: any
module-level value derived from backend data is keyed by `backendId` and
registers a per-backend reset.

### Editor identity across machines

Two machines very often hold the same repository at the same absolute path, and
the editor layer identifies files by that path alone at three levels.

`monaco.Uri.file(filePath)` is the model's identity
(`components/panes/EditorPaneImpl.tsx:107-108`): the pane looks the URI up with
`monaco.editor.getModel(uri)` and reuses whatever model it finds. Monaco's model
registry is global and keyed by URI, so the desktop's `/Users/me/foo/src/a.ts`
and the laptop's are **one model**, sharing text and undo history, whatever the
surrounding maps are keyed by.

Above that, `dirtyModels` and `viewStates` (`editor-dirty-state.ts:4,7`) are
path-keyed, and `EditorPaneImpl.tsx:205-207` deliberately keeps a dirty model
alive across unmount, skipping the disk read on the next mount
(`EditorPaneImpl.tsx:109,150`). `pendingLines` (`editor-dirty-state.ts:22`), the
go-to-line hand-off, is path-keyed too.

So the fix is at the model, not only at the maps: the editor's URI becomes
backend-scoped — `taskflow-file://<backendId>/<encoded path>` — and
`dirtyModels`, `viewStates` and `pendingLines` key off that same identity.
Everything that derives from the URI follows it: the raw-file fetch, import
navigation (`lib/monaco-import-navigation.ts`), and the external-editor opener,
which still needs the plain filesystem path and now gets it by decoding rather
than by assuming the URI is a file path.

Keying only the maps and leaving `monaco.Uri.file` alone would look correct and
still share one buffer between machines. That is the same silent-data-loss case
the superseded design refused a switch to avoid, and in aggregate mode there is
no switch to refuse: a dirty desktop buffer and a laptop file at the same path
are one click apart.

The dirty refusal survives for the hard switch only, where local is detached too
and unsaved local buffers would go with it.

## Lifecycle

### States

Per backend: `attaching` (tunnel up, handshake in flight), `attached`, `offline`
carrying the classified `TunnelFailure`, `incompatible` on a `PROTOCOL_VERSION`
mismatch. Only `attached` contributes records.

### Attach at launch

`BackendRecord.attached` is persisted. At start, local comes up as it does
today and every attached remote is dialled in the background. Launch time does
not depend on whether a remote machine is awake, asleep or on another network.

This reverses the superseded design's "startup always begins on the local
backend, `activeId` is persisted for menu ordering only". That rule existed
because auto-reconnecting made launch wait on ssh. Attaching in the background
removes the reason: a machine that never answers is a section header with a
retry, not a blocked startup.

### Retry, and the beacon as a wake signal

Per-backend exponential backoff with a ceiling of 60 seconds, plus a manual
retry on the section header. When a machine's beacon reappears, its backoff
resets and the next dial happens immediately. A sleeping machine is polled
rarely; a machine that just woke is picked up within one announce interval.

### Detach

Detach is the only teardown primitive. It kills the tunnel if there is one,
closes the connection, rejects that connection's in-flight requests with a
distinct error, drops that machine's slice from every aggregating store,
disposes the workspace and its panes if the open workspace belonged to that
machine, and clears that machine's cache entries.

Because aggregate mode has no remount to hide behind, the cleanup list is
explicit rather than left to "every store registers a reset":

- Aggregating store slices, keyed by origin.
- `diff-store` entries whose `targetId` is one of the dropped records.
- Session tabs, active-tab entries and session status for that machine's
  workspace keys — via the per-backend session sync, not a global rebuild.
- Monaco models, dirty state, view states and pending lines under that
  machine's URI scheme.
- xterm instances and their terminal caches, including the path-keyed
  `fileStatCache` in `components/panes/terminal/terminal-link-provider.ts:76`.
- Per-backend cache entries: agents, homedir, editors, Codex models, tsconfig
  map, connectivity, scripts and agent commands.
- Pending timers and debounces owned by that machine's panes, including
  file-store debounce state and debounced attribute saves.
- The session-activity module maps and their timers
  (`stores/session-activity.ts:12-15`). A working-to-attention debounce that
  fires after its backend is gone calls `setSessionStatus` for a session that no
  longer exists, resurrecting an `attention` badge and lighting the tray for a
  machine that is not attached.

Event subscriptions are **not** touched. They are registered against message
types and shared by every connection; unsubscribing on detach would silently
stop delivery for the machines that remain.

Offline-detach, unchecking a machine in the menu, removing a saved record, and
the hard switch all call it.

### A backend dropping

A tunnel or socket dying is local to its backend. The workspace stays rendered,
its panes show disconnected, and a banner names the machine. Everything
belonging to other machines is untouched. Today's global `OfflineIndicator`
becomes per-backend for this to read correctly.

A machine that vanishes from discovery while attached is not detached. The
tunnel is what matters, and the beacon can be lost independently.

Before the socket closes on a *deliberate* detach, a `FILE_UNWATCH` is sent for
whatever path that machine was watching. `FileWatcher` keeps a `Map` of chokidar
watchers keyed by path (`packages/backend/src/services/file-watcher.ts:34`) and
drops one only on an explicit `FILE_UNWATCH`
(`packages/backend/src/handlers/file.ts:72`), so closing first strands a
recursive watcher on that host for as long as its backend runs.

### The hard switch

The ordering matters, and the obvious ordering is wrong. "Validate the target,
detach everything, attach the target" destroys the current set before the target
is usable, and if the target was *already attached* — the common case, since you
would hard-switch to a machine you are already looking at — the detach kills the
very connection that was just validated.

So the target is prepared first and never torn down:

1. Refuse if any editor is dirty, listing the files. Local is about to be
   detached, so this is the one place unsaved work can be lost.
2. Ensure the target is attached and healthy: tunnel up, readiness probe
   answered, `PROTOCOL_VERSION` equal. If it was already attached, reuse that
   connection as-is. Any failure ends here with the attached set untouched.
3. Detach every attached backend **except the target**.
4. Promote the target to primary.
5. Remount `AppShell` by bumping its `key`.

Nothing is destroyed until the target is already usable as primary, which is the
non-destructive property the superseded design had and which a naive
detach-all would have lost.

The remount is not insurance against a leaky detach — aggregate mode has no
remount and detach must be complete on its own. It is here because primary
changing means theme, master workspace, settings and connectivity all re-root.

While hard-switched, a persistent toolbar indicator names the machine and offers
"Return to local", which is the same sequence with local as the target.

### Version compatibility

`PROTOCOL_VERSION` is checked per backend at attach, via the `protocolVersion`
field on `SYSTEM_INFO` as the superseded design specifies. An absent field means
older than the mechanism and is incompatible.

Behaviour on mismatch changes. In the superseded design a mismatch aborted a
switch. Here the machine sits in the sidebar with "needs update" on its header,
contributes no records, and nothing else is affected. Two machines that update
days apart is the common case, and it should cost one section of the sidebar,
not the app.

## Surfaces

### Sidebar

Local projects stay at the top with no header, in their stored order, rendering
exactly as they do today when nothing else is attached. Below them, one
collapsible section per attached machine, holding that machine's projects in
that machine's own order.

Project order stays per machine, so `PROJECT_REORDER` and its `orderedIds`
payload are untouched and the order set from the laptop is the order the
desktop's own app shows. Drag-and-drop is constrained within a section.

A section header carries the machine name, its state, a retry when offline, and
its `instanceId` as a badge when a host runs more than one instance.

### The machines menu

The `Monitor` button at
`packages/ui/src/components/sidebar/TaskSidebar.tsx:383-394` opens it.

```
Master Workspace                          ✓
──────────────────────────────────
☑ This machine (local)
☑ kuindji-desktop                         ● attached
☐ kuindji-desktop  dev-feature-x          ○ seen
☐ old-laptop                              ○ saved, not seen
──────────────────────────────────
Work as…                                  ▸
Connect to backend…
Manage backends…
```

A checkbox is attachment; toggling attaches or detaches live. "Work as…" is the
hard switch and is visually distinct, because a menu where attaching and
switching look alike will have them confused for each other. Opening the menu
sends a discovery probe so the list is fresh.

The button's icon shows the aggregate state: normal when everything attached is
healthy, a spinner while any machine is attaching, and a destructive tone when
an attached machine is offline.

### Settings

Settings have two jobs here and they need different answers, which the first
draft of this document conflated.

**Editing** belongs to primary. The modal shows primary's settings; appearance
comes from primary; `layout.window` remains pinned to local in all modes, since
window geometry is a property of this screen. To change another machine's
settings, hard-switch to it.

**Reading** cannot belong to primary, because settings carry the defaults that
go into payloads sent to *other* machines. `AgentOptionsPanel.tsx:41-45` reads
`settings.claude`, `settings.codex` and the rest from a single store, and New
Task and the run controls build launch options from them. With a primary-only
store, creating a task on the desktop would prefill the laptop's default model,
permission mode and shell and send them to the desktop — routed correctly,
populated wrongly, and silently.

So `settings-store` joins the aggregating set as a **read-only mirror**: each
attached machine's settings are fetched and held in its own slice, and anything
building a payload for a machine reads that machine's slice. Only primary's
slice is writable, and `SETTINGS_UPDATE` is only ever sent to primary. The
client-scoped parts — panels, collapsed projects, window — continue to come from
primary alone, because they describe this screen rather than any machine.

### Flows and actions

A flow or action with a `projectId` (`packages/shared/src/types/flow.ts`) comes
from that project's machine and runs there, so the flow and action dropdowns
inside a remote workspace are that machine's. Global flows and actions — those with no `projectId` — are **also per machine**,
and this is the point the first draft contradicted itself on. `filterByProject`
in `stores/flow-store.ts:21-27` returns every definition without a `projectId`
for any project, so with aggregated definitions and no machine filter a desktop
project's run menu would list the laptop's global flows, which the desktop
cannot run. The filter therefore takes a `backendId` as well: a project's menu
offers that machine's globals plus that project's own definitions, never another
machine's. `MASTER_OWNER_ID` runs belong to primary, because master workspace
does. Schedules carry a
required `projectId` and therefore follow their project's machine with no extra
rule.

Master workspace is primary's, in both modes: its homedir, its sessions
(`MASTER_SESSIONS_LIST`) and its global flows all come from primary, and
sessions started there run on primary. In aggregate mode that is local. A hard
switch changes primary, so master workspace then shows the target's — which is
the intent of the mode, and is why the `"master"` singleton tab key is safe:
primary is unique, and the hard switch's detach plus remount clears it before
the new primary populates it. A machine's master sessions are never shown while
it is merely attached and not primary.

### New Task

The dialog reads agent availability, runtimes and the default shell from the
target project's machine. This is the per-machine cache work paying off; a
global cache would offer whatever this client happens to have installed.

### Sidebar row actions and background work

The "route from the active workspace" rule covers panes. It does not cover work
that starts from a sidebar row for a project that is *not* open, and that is the
most dangerous gap in the design if it is left implicit.

`ProjectGroup` builds a run menu for any project row
(`components/sidebar/ProjectGroup.tsx:94`), passing only `projectId` and
`projectPath`. `useRunMenu` then fetches package scripts and agent commands with
unrouted requests carrying that path (`hooks/useRunMenu.ts:92,100`) and can
start a shell session or a flow from the result.

Unrouted, right-clicking a desktop project row lists **this** machine's scripts
for the desktop's path, and running one runs it here. If the path does not exist
locally it errors, which is survivable. If the same repository is checked out at
the same path on both machines — the case this whole design exists for — it
succeeds against the wrong checkout, on the wrong machine, with no visible
difference. That is worse than any failure mode in the superseded design.

So every project-row and task-row operation takes the record's `backendId`
explicitly, and the script and agent-command caches are per backend. The same
applies to the rest of the work that runs outside a workspace: PR polling, the
worktree/PR refresh in `useSidebarData`, notification click-through navigation,
tray aggregation, and debounced attribute saves (`lib/attribute-api.ts`). None of
these has an "active workspace" to inherit from, so each carries its target
explicitly or it is routed wrong.

### Notifications and tray

Notifications from every attached machine land in one list, each badged with its
machine when more than one is attached. This is the "an agent finished on the
desktop" signal and the main reason aggregate mode is worth more than a merged
menu.

In Electron main, `notification-poller.ts:27` and `tray-manager.ts:161,186` move
from one origin to every attached origin. `window-manager.ts:29,132` stays on
local, unchanged.

Polling every origin is not enough on its own, because the poller keeps one
watermark: `lastNotificationCheck` at `notification-poller.ts:9`. Shared across
machines it drops notifications — the desktop emits at 10:00:01, the laptop at
10:00:10, the watermark advances to 10:00:10, and the desktop's next
notification at 10:00:05 is never shown. The watermark becomes one per backend,
advanced only by that backend's own responses. The click payload
(`notification-poller.ts:54-59`) also carries the originating `backendId`, since
`projectId`, `sessionId` and `taskId` alone no longer say which machine to
navigate on.

### Gating

`useBackendIsLocal()` becomes a function of a `backendId`, evaluated from the
active workspace's machine. The site list is unchanged from the superseded
design's degradation table: `selectProjectDirectory`, `selectThemeFile`,
`selectFile`, `openExternalFile`, `showItemInFolder`, `runInShell`, and both
native file-drop paths in `TerminalPane.tsx:457-470` and `:474-486`. Each is
disabled, visible, with a tooltip naming the machine.

Dropping from Taskflow's own file explorer (`TerminalPane.tsx:451-456`) stays
enabled — those are already backend paths. `openExternalUrl` stays enabled.
Monaco's raw-file fetch stays enabled and rides the right machine's origin.

### Artifact download

Unchanged from the superseded design: `GET
/api/flow/artifact/:ownerId/:flowId/:type/raw`, because a flow artifact's path
is an arbitrary agent-supplied string
(`packages/backend/src/services/taskflow-cli-bin.ts:565`) that
`/api/file/raw`'s workspace-root check
(`packages/backend/src/utils/path-validation.ts:50`) would reject. The client
call gains a `backendId`; the save dialog stays on the client, because that is
where the file is going.

## Non-Electron renderer

The renderer running under `VITE_BACKEND_PORT` with no `window.taskflow` keeps
working. With no IPC bridge, `backend-store` reports a single local member,
always attached and always primary; the menu shows it alone; attach, connect,
manage and "Work as…" are disabled. This path is exercised by the existing UI
dev server and must not throw.

## Testing

The pure-function suites from the superseded plan carry over intact: beacon
encode/parse/probe/staleness, `buildTunnelArgs`, `classifyTunnelFailure`,
protocol version comparison, and registry persistence.

The new centre of gravity is routing, tested in the renderer against two fake WS
servers:

- Records from A and B coexist in one store, each carrying the right origin.
- A mutation on a B record is sent on B's socket and never on A's.
- An event delivered by A updates only A's records, including when A and B hold
  records of the same shape.
- A fetch that fails for B leaves A's records intact and marks B offline.
- Detaching B removes exactly B's records, leaves A's records and A's open
  workspace untouched, and rejects B's in-flight requests with a distinct error
  rather than leaving them to the 30-second timeout.
- Per-machine caches do not cross-feed. Tested through the agent list, because
  that is the one that silently offers the wrong machine's agents.
- Dirty models for the same absolute path from two machines stay separate, and
  detaching one machine clears only its entries.
- `FILE_UNWATCH` is sent on a deliberate detach before the socket closes.
- Attaching and detaching twice registers each `MSG` listener exactly once. A
  leak here is invisible until it duplicates every terminal chunk.
- A session sync for machine A rebuilds only A's workspace keys; B's tabs and
  active-tab entries survive untouched. This is the regression that closes a
  live remote terminal, and it reproduces on today's code by handing
  `syncOwnerTabs` a partial owner list.
- A fan-out response that arrives after its backend was detached, or after a
  newer attach generation for it, is dropped rather than written.
- A stale fetch for `{A}` resolving after a fetch for `{A, B}` does not erase
  B's slice.
- A late `onmessage` from a superseded socket does not resolve a pending request
  on its replacement, and a superseded `onclose` neither flips status nor
  schedules a reconnect.
- Two machines' models for the same absolute path are distinct Monaco models —
  asserted on the URI, not only on the dirty-state map, since equal URIs are the
  actual sharing mechanism.
- A run menu opened from a remote project row issues its script and
  agent-command requests on that machine's connection, and never on local's.
- Detaching one machine leaves the other machine's open workspace, terminals and
  Monaco models alive, with no remount.
- A list response for a slice whose revision moved on — because an event landed
  while the request was in flight — is discarded, and the event's record
  survives.
- New Task and the agent-options panel, built for a remote project, carry that
  machine's defaults (model, permission mode, shell), not primary's.
- A remote project's run menu lists that machine's global flows and none of
  primary's.
- Attaching one backend twice through two host aliases yields one attached
  member, one connection and one copy of each record.
- Each backend has its own notification watermark: a notification from the older
  machine is still delivered after a newer one arrived from another machine.
- A session-activity timer that fires after its backend is detached does not
  resurrect session status or the tray badge.
- Project drag-reorder is confined to its machine's section and sends
  `PROJECT_REORDER` only to that machine.

The hard switch keeps its own tests: a dirty editor refuses it with the files
listed; a failed target resolution leaves the attached set untouched; an
incompatible target is refused before any detach runs.

`useBackendIsLocal(backendId)` gating is tested at one representative site, plus
both terminal-drop paths, since only one of them is obvious.

The flow-artifact endpoint is tested with a path outside any workspace root —
the exact case `/api/file/raw` would reject.

## Migration from the existing plan

`docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md` is replanned
against this document rather than discarded.

**Unchanged:** Tasks 1–6 — backend prerequisites, shared discovery types and the
beacon codec, the advertiser and listener, the backend record list, ssh argument
construction and failure classification, the tunnel manager. Roughly 2,800 of
the plan's 7,650 lines. The only edit is that the tunnel manager supervises a
map of children.

**Widened:** Task 7 (registry and IPC) — an attached set and per-backend state
instead of an `activeId`. Task 12 (gating) — the hook takes a `backendId`. Task
13 (artifact route) — the backend route is identical; the client call gains a
`backendId`.

**Rewritten:** Task 8 becomes the connection registry, which is simpler than the
two-socket generation handling it replaces. Task 9 becomes per-backend detach.
Task 10 shrinks to the hard switch. Task 11 gains attach checkboxes, sections
and "Work as…".

**Rewritten, continued:** Task 14 (end-to-end verification) — most of it
verifies single-active-backend switching and no longer applies. It is replaced
by aggregate-mode checks: two machines' sections populated at once, a
cross-machine notification, a sidebar run menu routed to the right machine,
detaching one machine without a remount and without disturbing the other, and
hard-switch rollback in all three target states (already attached, not attached,
dying after validation).

**New:** per-backend slices and the origin stamp in the aggregating stores, with
generation-guarded fan-out; per-backend session sync; keying the caches by
machine, path caches included; backend-scoped Monaco URIs; sidebar machine
sections; a per-backend offline indicator; explicit routing for sidebar-row and
background work; multi-origin notification polling and tray.

## Assumptions

Unchanged from the superseded design: ssh key access to every host, an OpenSSH
client locally, and multicast on the same subnet where available with the manual
dialog and port file as the path where it is not.

Two clients attached to one backend still misrender shared sessions, because the
backend holds one terminal grid per session sized by whoever resized last
(`packages/backend/src/services/pty-manager.ts:350-354`). Aggregate mode makes
this more likely to be hit, since the desktop's own app and the laptop's may now
both be attached to the desktop backend at once. This design does not fix it and
does not make it worse per attached client.

Appearance following primary means the window re-themes on a hard switch and
does not re-theme in aggregate mode.

## To verify during implementation

**Is a read-only settings mirror per machine enough, or does it want a way to
edit remote settings in place?** The mirror is what makes remote task creation
correct. Whether hard-switching purely to change a remote default is acceptable
in daily use is a question only running it answers.

**Does the backend-scoped Monaco URI break anything that assumes a file URI?**
Language services, import navigation and the external-editor opener all read the
URI today. The scheme change is the right fix, but it touches more of the editor
than any other item here and is the most likely source of surprise.

**Is per-backend detach genuinely clean?** The enumeration test proves every
store registers a reset; it cannot prove any reset is complete, and aggregate
mode has no remount to hide behind. If leaks show up, the fallback is narrower
than the superseded design's window reload: detaching everything and remounting
`AppShell` is already implemented for the hard switch, so a leaky aggregate
detach degrades to "detach forces a remount" without new machinery.

**Do four or five simultaneous ssh tunnels plus multicast behave on a real,
flaky Wi-Fi link?** Backoff, the beacon-as-wake-signal, and per-backend offline
rendering are all reasoned about here and none of them is settled on paper.

**Does `node:dgram` multicast survive `bun build --compile`?** Carried over from
the superseded design and still open.

**Does the macOS local-network prompt appear where users expect it?** Carried
over. Denial is silent from inside the process.

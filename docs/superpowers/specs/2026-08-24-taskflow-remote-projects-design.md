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
| Primary backend | Owns appearance, master workspace, global flows and actions, settings, connectivity. `layout.window` stays local always |
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
different machines are separate objects, so the superseded design's generation
counter is unnecessary — it existed only to tell two sockets to the *same*
logical backend apart during a swap.

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

**Aggregating** — flat arrays holding `Scoped<T>` from every attached machine.
`project-store`, `task-store`, `notification-store`, `schedule-store`,
`session-activity` and the subscription layer in `session-subscriptions`.
Fetches fan out across the attached set and concatenate; a fetch that fails for
one machine leaves the others' records in place and marks that machine offline.

**Workspace-scoped** — unchanged in shape, single-backend at any moment.
`file-store`, `diff-store`, `flow-store`, `search-store`, `wiki-store`, and the
pane and terminal layer. They serve the open task only, and take their
`backendId` from the active workspace. This is what keeps the change bounded:
the stores with the most call sites are the ones that do not have to aggregate.

`useActiveWorkspace()` gains the workspace's `backendId`, derived from the
project the active task belongs to, or from primary for master workspace. It is
the single place the pane layer reads its target from.

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

In the superseded design these were leaks to be cleaned on switch. Here they are
correctness: the New Task dialog for a desktop project must offer the desktop's
installed agents and runtimes, and the external-editor menu for a desktop file
must offer the desktop's editors. A global cache silently answers with whichever
machine replied first.

The rule for the implementer, applied rather than worked from this list: any
module-level value derived from backend data is keyed by `backendId` and
registers a per-backend reset.

### Dirty editor state

`packages/ui/src/components/panes/editor-dirty-state.ts:4,7` keys retained
Monaco models and view states by absolute path alone, and
`EditorPaneImpl.tsx:205-207` deliberately keeps a dirty model alive across unmount,
skipping the disk read on the next mount (`EditorPaneImpl.tsx:109,150`).

Two machines very often hold the same repository at the same absolute path. The
superseded design handled this by refusing a switch while any editor was dirty.
In aggregate mode there is no switch to refuse — a dirty desktop buffer and a
laptop file at the same path are one click apart. So both maps are keyed by
`backendId` + path. This is a prerequisite, not a cleanup: without it the first
duplicated repo shows one machine's unsaved buffer as the other's file, and
saving writes it there.

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
distinct error, drops that machine's records from every aggregating store by
filtering on the origin stamp, disposes the workspace and its panes if the open
workspace belonged to that machine, and clears that machine's cache entries.

Offline-detach, unchecking a machine in the menu, removing a saved record, and
the hard switch all call it. There is no `resetAllState()`; there is
`detach(backendId)` applied to one machine or to all of them.

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

1. Refuse if any editor is dirty, listing the files. Local is about to be
   detached, so this is the one place unsaved work can be lost.
2. Resolve the target: ensure its tunnel, probe readiness, check
   `PROTOCOL_VERSION`. Any failure ends here with the current set untouched.
3. Detach every attached backend.
4. Attach the target and make it primary.
5. Remount `AppShell` by bumping its `key`.

The remount is not insurance against a leaky detach — aggregate mode has no
remount and detach must be complete on its own. It is here because primary
changing means theme, master workspace, settings and connectivity all re-root.

While hard-switched, a persistent toolbar indicator names the machine and offers
"Return to local", which is the reverse operation: detach the remote, attach
local, primary = local, remount.

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

The modal shows primary's settings. Appearance and layout come from primary.
`layout.window` remains pinned to local in all modes — window geometry is a
property of this screen, and routing it elsewhere would have a laptop's window
position overwrite a desktop's.

To change another machine's settings — its default agent, shell, editors,
per-agent defaults — hard-switch to it.

### Flows and actions

A flow or action with a `projectId` (`packages/shared/src/types/flow.ts`) comes
from that project's machine and runs there, so the flow and action dropdowns
inside a remote workspace are that machine's. Global flows and actions — no
`projectId`, plus `MASTER_OWNER_ID` runs — come from primary. Schedules carry a
required `projectId` and therefore follow their project's machine with no extra
rule.

### New Task

The dialog reads agent availability, runtimes and the default shell from the
target project's machine. This is the per-machine cache work paying off; a
global cache would offer whatever this client happens to have installed.

### Notifications and tray

Notifications from every attached machine land in one list, each badged with its
machine when more than one is attached. This is the "an agent finished on the
desktop" signal and the main reason aggregate mode is worth more than a merged
menu.

In Electron main, `notification-poller.ts:27` and `tray-manager.ts:161,186` move
from one origin to every attached origin. `window-manager.ts:29,132` stays on
local, unchanged.

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

**New:** the origin stamp and fan-out in the five aggregating stores; keying the
caches by machine; sidebar machine sections; a per-backend offline indicator;
`editor-dirty-state` keyed by machine; multi-origin notification polling and
tray.

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

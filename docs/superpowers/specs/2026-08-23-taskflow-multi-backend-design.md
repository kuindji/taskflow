# Taskflow Multi-Backend Client — Design

Date: 2026-08-23
Status: Approved for planning

## Problem

The desktop client can only ever talk to the backend Electron spawned for it.
`packages/ui/src/hooks/useWebSocket.ts` holds one module-level socket pointed at
`ws://localhost:<port>`, where the port arrives once from Electron main
(`packages/ui/src/providers/WebSocketProvider.tsx:23`). A user running Taskflow
on more than one machine — a desktop that runs the agents and a laptop they
carry — has no way to see the desktop's projects, tasks and sessions from the
laptop's app. The only
client that will be able to is the TUI, whose `--connect` mode is being built
now.

The backend has never required Electron: it is a headless Bun server with a
typed JSON protocol, and the desktop app is one client of it. Pointing that
client at a different backend is therefore a client-side change plus a way to
find and reach the other machine.

## Scope

In scope: a backend registry in Electron main, LAN discovery, app-managed SSH
tunnels, switching the active backend, and the sidebar dropdown that drives it.

Out of scope: showing several backends' records in one view; keeping
non-active backends connected in the background; per-client session viewports;
creating or repairing projects on a remote host.

## Decisions

| Question | Decision |
|---|---|
| Topology | One active backend at a time. The client renders exactly one backend's records |
| Non-active backends | Not connected. No background sockets, no cross-backend notifications |
| Discovery | UDP multicast beacon. Every backend advertises; Electron main listens |
| Transport | App-managed SSH tunnel to `127.0.0.1:<remote port>` on the host |
| Authentication | SSH's. The app adds none and handles no credentials |
| Registry owner | Electron main — it owns the tunnel processes and outlives any one connection |
| Settings scope | Everything follows the active backend, appearance and layout included |
| Re-point mechanism | Re-point the existing singleton, then reset, re-bootstrap and remount the shell |
| Menu location | The sidebar's bottom-left `Monitor` button; Master Workspace folds into the menu |
| Local-path affordances | Disabled while a remote backend is active |
| Backend bind address | Changed to `127.0.0.1` by this spec. It is a prerequisite, not an inherited assumption |
| Protocol compatibility | A `PROTOCOL_VERSION` constant, carried in the beacon and checked before the new socket is promoted |

### Rejected alternatives

**Aggregating every connected backend into one sidebar.** The most powerful
shape — projects from both machines side by side, sessions from either in the
same workspace. Rejected because it gives every project, task, session and
store entry a backend identity, which is a change to all ~196 `sendRequest` /
`onEvent` call sites and every record type, for a workflow the user does not
have. Nothing in this design forecloses it.

**Keeping non-active backends connected for notifications and badges.**
Attractive — you would see that an agent finished on the other machine. Rejected
because it needs a connection manager, a per-backend "lite" subscription mode
and a second set of stores, and the user preferred to switch to look.

**One Electron window per backend.** Leaves today's single-connection
assumptions completely untouched; the dropdown becomes a window launcher.
Rejected because two windows of the same app showing different machines is
harder to keep straight than one window with an explicit active backend, and
window-scoped backend state would have to be threaded through main anyway.

**A connection object threaded through React context** (approach B). The
architecturally correct refactor and the prerequisite for the aggregate view.
Rejected for now: it touches every store and most panes and produces no
user-visible difference under a one-active-backend topology.

**Reloading the `BrowserWindow` against a new target** (approach C). Guarantees
a clean slate in about fifty lines. Rejected for the white flash, for
re-initialising Monaco and xterm on every switch, and because it does not work
for the browser-based dev renderer that has no Electron at all.

**No authentication, backend bound to a routable interface.** Considered — on a
trusted LAN with discovery it is the least work. Rejected because the backend
spawns shells: an unauthenticated listener means any device on the network can
run commands on the host. That is true of the backend as it stands today, which
is why the loopback bind is a prerequisite of this design rather than a nicety.
SSH keys the user already manages give the same one-click feel once configured.

**mDNS/Bonjour via `bonjour-service`.** Standard, inspectable with `dns-sd`,
and plays with other tooling. Rejected because a hand-rolled beacon is roughly
eighty lines over `node:dgram`, adds no dependency, and needs no verification
under `bun build --compile`. The payload we want is not a DNS-SD TXT record
shape anyway.

**Discovery in the backend rather than in Electron main.** The backend must
advertise regardless. Making it also listen and expose peers over the protocol
would let the TUI inherit discovery for free. Rejected for v1 because with only
the active backend connected, the peer list would come from whichever backend is
active — so a remote backend would report *its* network, not the user's. Main
listening always reflects the user's own LAN. The listener is shared code, so
the TUI can adopt it without a rewrite.

## Architecture

Five units, three of them new files, plus edits to existing ones.

| Unit | Lives in | Responsibility | Knows nothing about |
|---|---|---|---|
| `discovery/` | `@taskflow/shared`, new `./discovery` export | Beacon encode/parse, advertise loop, listen loop, staleness | Taskflow records, Electron, React |
| `backend-registry` | `electron/src/` | Saved backends, active backend, resolution of a record to a reachable origin | SSH mechanics, React |
| `tunnel-manager` | `electron/src/` | Spawning, watching and killing `ssh` children; classifying failures | Taskflow records, the registry's persistence |
| `backend-store` | `packages/ui/src/stores/` | Renderer mirror of the registry over IPC; drives the switch | Transport details |
| `store-reset` | `packages/ui/src/stores/` | Registry of per-store reset functions | Any individual store's shape |

The split between `backend-registry` and `tunnel-manager` matters: the registry
is pure data with a JSON file behind it and is testable without spawning
anything, while the tunnel manager is all process and stderr handling and is
tested through its pure argv builder and failure classifier.

## Required backend changes

This design does not work on today's backend. Three changes come first, and each
is worth making on its own.

**Bind to loopback.** `createServer` calls `Bun.serve({ port })` with no
`hostname` (`packages/backend/src/ws/server.ts:41`), and Bun defaults to
`0.0.0.0`. The backend spawns shells, so it is currently reachable and
unauthenticated from any device on the LAN. Passing `hostname: "127.0.0.1"` is
what makes the SSH tunnel the only route in, and it must land **before** the
beacon starts advertising the port — advertising a port that anyone can connect
to directly is strictly worse than today. The TUI design introduces the same
change; whichever lands first, the other inherits it.

**A stable port file.** Today `config.portFile` is a temp path supplied by
Electron via `TASKFLOW_PORT_FILE` (`packages/backend/src/config.ts:74`), written
after `server.start()` (`packages/backend/src/index.ts:469`) and never removed by
the backend — Electron cleans up its own artifact instead
(`electron/src/backend-manager.ts:101`). A new `config.instancePortFile` at
`<BASE_DIR>/<instanceId>.port` is written alongside it and, unlike the existing
one, removed in the backend's `shutdown` handler
(`packages/backend/src/index.ts:499`). Both the manual-connect fallback and the
TUI need a path that does not depend on who spawned the process.

**A protocol version.** There is no version anywhere in the protocol today —
`SYSTEM_INFO` returns editors and homedir (`packages/backend/src/index.ts:416`)
and `packages/shared/src/utils/version.ts` only parses semver strings for agent
CLIs. A `PROTOCOL_VERSION` constant is added to
`packages/shared/src/constants.ts`, bumped when the message set changes
incompatibly. See Version compatibility.

## Discovery

### Beacon

Every backend advertises on start unless disabled. Multicast group
`239.255.42.98`, port `47654`, TTL 1 so it never leaves the subnet.

Payload, JSON, under 512 bytes:

```
{ v: 1, protocolVersion, instanceId, hostname, displayName, port, appVersion, os }
```

`instanceId` is `config.instanceId` — `main`, or `dev-<branch>` under
`TASKFLOW_DEV_BRANCH` (`config.ts:67`). `port` is the live WS port, which is
allocated per start and therefore cannot be assumed stable. `displayName` is the
machine's hostname unless overridden in settings.

Announce every 5 seconds, and immediately in reply to a probe datagram
(`{ v: 1, probe: true }`) so a client that just opened the menu does not wait.
A new settings field `network.discoverable`, default `true`, gates the advertise
loop. Disabling it stops the beacon; it does not change the bind address, which
is loopback either way.

### Listening

Electron main joins the same group, keeps a map keyed by `hostname:instanceId`,
and marks an entry stale after 15 seconds without an announcement. The renderer
subscribes over IPC and re-renders the menu as entries appear and go stale.

Multicast is not one decision, it is several per-platform ones:

- **Interfaces.** `addMembership(group)` joins one interface the OS picks. On a
  laptop with Wi-Fi, Ethernet, a VPN and Docker bridges that is frequently the
  wrong one. Both sides enumerate `os.networkInterfaces()` and call
  `addMembership(group, address)` for every non-internal IPv4 interface, and
  send announcements out of each via `setMulticastInterface`. A join that throws
  for one interface is logged and skipped, never fatal.
- **Rebinding.** Interfaces come and go. The membership set is recomputed when
  `os.networkInterfaces()` changes, polled every 30 seconds — cheap, and simpler
  than platform-specific link-state watching.
- **`reuseAddr: true`** on both sockets, so a dev backend and a production
  backend on one machine can both bind `47654`.
- **macOS local network permission.** Multicast is local-network traffic, so
  macOS prompts on first use and silently drops datagrams if denied. The
  Electron build gains `NSLocalNetworkUsageDescription` in Info.plist. If no
  backend is ever discovered on macOS, the menu shows a hint pointing at System
  Settings rather than an empty list, because a denied permission and an empty
  network look identical from inside the process.
- **Failure is not an error state.** Many networks drop multicast entirely.
  Discovering nothing is normal; manual connect is always available.

The listener and the advertiser are the same module in `@taskflow/shared` behind
a new `"./discovery"` entry in the package's `exports` map, so that `node:dgram`
never reaches the browser bundle — `packages/shared/package.json` currently has
no `exports` map at all and is consumed as source (`"main": "src/index.ts"`), so
one is added with `"."` pointing at `./src/index.ts` to preserve today's
resolution for Vite, the backend's `bun build --compile`, the TUI build and
Electron's `Bun.build`. `src/index.ts` must never re-export the discovery module:
one stray `export *` and `node:dgram` lands in the browser bundle. A test asserts
the barrel does not reach it.

### Port file fallback

Multicast is dropped by many WLAN access points and by every VPN and Tailscale
link. For those hosts, manual "Connect to backend…" resolves a host with no
beacon by running `ssh <user>@<host> cat <BASE_DIR>/<instanceId>.port` over the
same SSH the tunnel will use, reading the stable port file described under
Required backend changes.

## Connecting

### Records

```
BackendRecord {
  id            // `${host}:${instanceId}` — stable across restarts, unlike port
  host
  instanceId
  displayName
  user          // defaults to the local $USER at add time
  sshPort       // defaults to 22; only set when the host runs sshd elsewhere
  lastKnownPort // the *backend's* port, refreshed from the beacon
  addedAt
}
```

Persisted to `userData/backends.json`. Discovered-but-never-connected backends
are not persisted; a backend is saved the first time it is connected to, or when
added by hand. The **local** backend is not a record — it is always present as
entry zero of the menu, always spawned by Electron as it is today, and is
reached directly on its port with no tunnel.

The local backend keeps running while a remote one is active. Its sessions
continue, its scheduler continues, its agents keep working. Switching away is a
change of view, not a shutdown.

### Tunnel

Main allocates a free loopback port (`net.createServer().listen(0)`, read the
port, close), then spawns:

```
ssh -N -L <local>:127.0.0.1:<remote> -p <sshPort> <user>@<host>
    -o BatchMode=yes
    -o ExitOnForwardFailure=yes
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=3
```

`BatchMode=yes` guarantees ssh never blocks on a prompt — it exits and we read
stderr instead. `ExitOnForwardFailure=yes` makes a failed forward an exit rather
than a silently dead tunnel. The keepalive options make a sleeping laptop's dead
tunnel fail fast rather than hang.

Readiness is **not** a TCP connect to the local end. `ssh -L` accepts
connections as soon as it is up, whether or not anything is listening on the
remote side, so a TCP connect proves only that ssh is running. Readiness is an
HTTP `GET /` through the forward, which the backend answers with
`Taskflow backend` and a 200 (`packages/backend/src/ws/server.ts:49`), polled for
up to 10 seconds. That proves the remote backend is actually there, and is what
separates "the machine is up but Taskflow is not running" from every other
failure.

The renderer then receives `ws://127.0.0.1:<local>` and connects to it exactly as
it connects to the local backend today; HTTP file URLs
(`packages/ui/src/lib/backend-url.ts`) go over the same forward.

**Local port allocation races.** Binding port 0, reading the port and closing it
before handing the number to ssh leaves a window in which something else takes
it. Narrow, but reachable when a retry and an activation overlap. With
`ExitOnForwardFailure=yes` this is a clean, immediate ssh exit carrying
`Address already in use` rather than a silent half-failure, so the tunnel manager
retries with a fresh port, up to three times, before reporting failure.

The ssh child is killed when the backend is switched away from, when the
connection is explicitly closed, and on app quit. If it exits on its own, main
notifies the renderer, which shows the disconnected state and offers a retry
that re-establishes the tunnel.

### Failure classification

`tunnel-manager` classifies ssh's stderr into:

| Class | Cue | Presented as |
|---|---|---|
| Unknown host key | `Host key verification failed` | Fingerprint trust dialog |
| Auth refused | `Permission denied` | "SSH key not accepted by `<host>`" plus stderr |
| Needs passphrase | `Permission denied` after a key was offered | Same, plus "run `ssh <host>` once to unlock your key" |
| No route | `Could not resolve` / `Connection refused` / timeout | "`<host>` is not reachable" |
| Local bind failed | `bind: Address already in use` / `Could not request local forwarding` | Not surfaced — retried with a fresh local port |
| Tunnel up, no backend | ssh alive but the readiness probe never answers | "Taskflow is not running on `<host>`" |
| No ssh binary | `ENOENT` on spawn | "OpenSSH client not found" |

The last two are the pair worth separating. `ExitOnForwardFailure` only reports
on the **local** end of a `-L` forward — ssh cannot know whether anything is
listening on the far side, which is exactly why readiness is an HTTP probe and
why "the host is up but Taskflow is not" gets its own message instead of being
folded into a generic tunnel error.

The classifier is a pure `(stderr, exitCode) => TunnelFailure` function and is
where the tests for this module live. Every class shows the raw stderr in a
details area — a misclassified failure must still be diagnosable.

### Host key trust

On `Host key verification failed`, main first runs `ssh-keygen -F <host>` (or
`[host]:port` for a non-default `sshPort`) to find out which case it is:

- **No entry.** First contact. Run `ssh-keyscan -T 5 -p <sshPort> <host>`, show
  the host, key type and SHA256 fingerprint, and on approval append the lines
  to `~/.ssh/known_hosts` with a leading newline guard, creating `~/.ssh` as 0700
  and `known_hosts` as 0600 if absent. A non-default `sshPort` is written in
  `[host]:port` form, which is what `ssh-keyscan -p` emits, and `ssh-keygen -F`
  is queried in the same form. Then retry once.
- **An entry exists and does not match.** The key changed. This is never
  auto-fixed and no fingerprint dialog is offered — it is exactly what an
  interception looks like. The user gets ssh's own message and the offending
  line number, and is told to resolve it themselves.

Hashed `known_hosts` files are handled by `ssh-keygen -F` rather than by parsing,
which is why detection goes through it instead of a grep.

This is the one security decision the app makes for the user, and it matters
more here than in a terminal, because the host being trusted may have arrived
from **a beacon**. Anyone on the LAN can advertise a convincing entry pointing at
a machine they control. The host key check is what stops that from being useful:
a spoofed entry either fails to authenticate, or presents an unknown key the user
is asked to look at. Beacons are hints about where to look, never grounds for
trust — the menu shows discovered entries as unverified until first connect.

## Switching

The switch is ordered so a failure is never destructive:

1. Renderer asks main to activate backend `id`.
2. Main resolves it: local → its port; remote → ensure tunnel, resolving the
   port from the live beacon, else `lastKnownPort`, else the port file over ssh.
3. Main returns the origin. Any failure up to here ends the switch with the
   current backend untouched and an error surfaced.
4. Renderer opens a **new** socket to that origin and, on `open`, performs the
   compatibility handshake described under Version compatibility. A WebSocket
   `open` proves a server is listening, not that it is a compatible Taskflow —
   an incompatible backend must be refused before anything is torn down, or a
   mistyped host destroys the current view.
5. Only after the handshake passes does the renderer promote the new socket:
   it sends `FILE_UNWATCH` on the **old, still-open** socket for whatever path
   is being watched (`packages/ui/src/stores/file-store.ts:206`), closes it,
   calls `resetAllState()` and `rebootstrap()`, and bumps the `key` on
   `AppShell`, which unmounts and remounts the whole tree — disposing every
   xterm, Monaco model and pane.

   The unwatch has to happen while the socket is still open. `FileWatcher` keeps
   a `Map` of chokidar watchers keyed by path
   (`packages/backend/src/services/file-watcher.ts:34`) and only drops one on an
   explicit `FILE_UNWATCH` (`packages/backend/src/handlers/file.ts:72`), so
   closing first strands a recursive watcher on the machine you just left, for
   as long as its backend runs.
6. Main kills the previous tunnel, if there was one, and persists the new active
   backend id.

An overlay covers steps 1 to 5 with the target's name and a cancel action.

Because the socket is opened before the old one closes, two sockets exist for
the duration of a handshake. The backend already permits concurrent clients, and
they are to different backends here, so this is harmless.

### What the WS client has to become

The current client is not a connection, it is a set of module globals: one `ws`,
one `wsPort`, and shared `pendingRequests` / `eventListeners` / `statusListeners`
maps (`packages/ui/src/hooks/useWebSocket.ts:3-25`). `connectWebSocket` closes
the old socket *before* opening the new one and nulls `onclose` to stop the stale
handler firing (`useWebSocket.ts:56-66`). Opening the new socket first, as the
switch requires, means two sockets exist at once, and every one of those globals
would be written by both.

The change is contained but it is not free. The new socket is held in a separate
`pendingSocket` binding, not in `ws`, so `sendRequest` and `sendFireAndForget`
keep addressing the old, still-open socket during the handshake instead of
failing against a `CONNECTING` one. `ws` is reassigned only when the new socket
opens. The module also gains a generation counter. Each socket captures its
generation on creation, and `onmessage`,
`onclose` and `onerror` return immediately if their generation is not the
current one. Only the current socket may flip `connected` or call
`scheduleReconnect`.

`pendingRequests` is one global map (`useWebSocket.ts:16`), so entries are
tagged with the generation that sent them. At promotion the outgoing
generation's entries are rejected explicitly with a distinct `BackendSwitched`
error, so callers can tell a switch apart from a dropped connection. Without
that explicit sweep the old socket's `close` is ignored by design and its
requests sit there until the 30-second timeout fires — a switch would look like
it worked, then throw `Request timeout` half a minute later.

`connectWebSocket(port)` becomes `connectTo(origin)`, taking a full origin rather
than a port: a tunnel port is not `localhost` in any meaningful sense, and
`packages/ui/src/lib/backend-url.ts` needs the origin anyway.

`eventListeners` deliberately stays global and is **not** cleared. Listeners are
registered against message types, not sockets, so they keep working across the
swap. That is what makes the switch survivable at all, and it is also why the
reset is more subtle than "unmount everything" — see below.

### Reset and re-bootstrap

Remounting `AppShell` disposes component state, terminals and Monaco models. It
does **not** re-run module-scope initialization, and the codebase has real
module-scope initialization:

- `initSessionSubscriptions(useSessionStore)` runs at import time
  (`packages/ui/src/stores/session-store.ts:612`) and only tears down under HMR
  (`packages/ui/src/stores/session-subscriptions.ts:262`).
- `initConnectivity()` is guarded by an `initialized` flag and never runs twice
  (`packages/ui/src/hooks/useConnectivity.ts:31`), so its one-shot
  `CONNECTIVITY_STATUS` request would never be re-issued against the new
  backend and connectivity state would silently describe the previous one.
- `cachedAgents` in `packages/ui/src/hooks/useAgentAvailability.ts:8` clears
  itself only when the connection status goes to `!connected`
  (`useAgentAvailability.ts:16`). A successful switch never goes disconnected —
  that is the whole point of promoting on `open` — so the new backend would be
  offered the *previous* machine's installed agents. This is the design's own
  seamlessness turning into a bug, and it is the pattern to watch for.
- `cachedHomedir` in `packages/ui/src/hooks/useActiveWorkspace.ts:19` is
  prefetched once at module load, so master workspace would keep the old
  machine's home directory.
- `cachedEditors` in `packages/ui/src/lib/open-file.ts:10` holds the detected
  editors of whichever machine answered `SYSTEM_INFO` first, and refetches only
  when the list is empty, so the external-editor menu would offer the wrong
  machine's editors.

The general rule, which the implementer should apply rather than work from this
list: any module-level value derived from backend data must register a reset.
Stores are the obvious ones; the hooks above are not, and they are the ones that
will actually bite.

So the switch is two distinct operations, not one:

1. `resetAllState()` clears record state and module-level caches. Every store
   and every caching hook registers its own reset via `stores/store-reset.ts`.
2. `rebootstrap()` re-runs the one-shot fetches that populated state at startup:
   connectivity status, the agent list, homedir. `initConnectivity` gains a reset
   for its guard rather than a second listener registration.

Event subscriptions are left alone in both. A test asserts that switching twice
registers each `MSG` listener exactly once, because a leak here is invisible
until it duplicates every terminal chunk.

### Electron main's own consumers

Three modules in main call `getBackendPort()` today, and they do not all want
the same answer.

`notification-poller.ts:27` and `tray-manager.ts:161,186` move to the **active**
backend's origin, so desktop notifications and the tray icon describe what the
user is looking at.

`window-manager.ts:27,131` stays on the **local** backend. It reads and writes
`layout.window` — the window's position, size and maximized state — through
`/api/settings`. Window geometry is a property of this screen, not of the machine
being viewed, and routing it to the active backend would mean a laptop's window
position overwriting a desktop's every time you switched. This is the one
deliberate exception to "settings follow the active backend", and it is invisible
to the user precisely because it is the behaviour they already have.

`backend-manager.ts` keeps `getBackendPort()` for the local backend it owns; the
registry exposes `getActiveOrigin()` alongside it.

## The menu

The `Monitor` button at
`packages/ui/src/components/sidebar/TaskSidebar.tsx:381-395` becomes the backend
menu:

```
Master Workspace                    ✓
─────────────────────────────
This machine (local)                ✓
kuindji-desktop                     ● connected / ○ stale
kuindji-desktop  dev-feature-x      ●
old-laptop                          ○ saved, not seen
─────────────────────────────
Connect to backend…
Manage backends…
```

Ordering: local, then discovered live entries, then saved entries not currently
seen. Dev instances carry their `instanceId` as a badge — without it, two
entries from one host are indistinguishable. Menu opening sends a discovery
probe so the list is fresh rather than up to 5 seconds old.

The button's icon carries connection state: the current `Monitor` when local,
a distinct icon when remote, a spinner while connecting, and a destructive-toned
icon when the active backend has dropped. Master Workspace keeps today's accent
colouring on the icon; "remote" is signalled by a small corner dot, so the two
signals do not compete for the same channel.

"Connect to backend…" opens a dialog taking host, plus optional backend port,
SSH user and SSH port, for hosts multicast cannot reach. Leaving the backend port
blank resolves it from the port file over ssh. "Manage backends…" lists saved
records with rename, edit-user, edit-ssh-port and remove.

## Remote-mode degradation

A `useBackendIsLocal()` hook gates every affordance that assumes the backend's
filesystem is this machine's. Each is disabled — visible, not hidden — with a
tooltip naming the reason:

| Affordance | Sites |
|---|---|
| `selectProjectDirectory` | `NewProjectDialog.tsx:46`, `MissingLocationDialog.tsx:40`, `SettingsModal.tsx:150` |
| `selectThemeFile` | `appearance/ImportTab.tsx:28` |
| `selectFile` | `flows/FlowInputDialog.tsx:34` |
| `openExternalFile` (external editor) | `terminal/terminal-links.ts:64`, `file-store.ts:301`, `FileContextMenu.tsx:107` |
| `showItemInFolder` | `FileContextMenu.tsx` |
| `runInShell` | `Workspace.tsx:251,391` |
| Native file drop into a terminal | `TerminalPane.tsx:457-470` and `:474-486` |

Native file drop needs explaining, and it has two code paths, not one.
Dropping a file from Finder resolves a **client-machine** path with
`webUtils.getPathForFile()` (`TerminalPane.tsx:457-470`) and types it into a
session running on the backend; the same handler also falls back to decoding
`text/uri-list` `file://` URLs, which macOS Finder sometimes sends instead
(`TerminalPane.tsx:474-486`). Both resolve client paths and both are gated.
Dropping from Taskflow's own file explorer is unaffected — those are already
backend paths (`TerminalPane.tsx:451-456`).

Artifact download is the one place where disabling is the wrong answer, and it
is fixed rather than gated. `saveArtifact` currently `copyFile`s a
backend-supplied absolute path using the client's filesystem
(`electron/src/ipc-handlers.ts:115`, triggered from
`packages/ui/src/components/flows/FlowPanel.tsx:298`) — with a remote backend
that either fails or, worse, copies an unrelated local file that happens to share
the path.

It cannot simply move to `/api/file/raw`: that endpoint is a security boundary
that requires the resolved path to sit inside a known project or worktree root
(`packages/backend/src/api/routes/file-routes.ts:33`,
`packages/backend/src/utils/path-validation.ts:50`), while a flow artifact's
`path` is an arbitrary string an agent handed to the CLI
(`packages/shared/src/types/flow.ts:73`,
`packages/backend/src/services/taskflow-cli-bin.ts:565`, unvalidated at
`packages/backend/src/api/routes/flow-routes.ts:130`). An artifact written to
`/tmp` would start returning 403 — a regression for local use.

So artifact download gets its own endpoint,
`GET /api/flow/artifact?runId=&actionEntryId=&type=`, which looks the artifact up
in the run record and serves the path **it** recorded. The authorisation is
"this path was registered as an artifact of this run", not "this path is inside a
workspace", which is the right question for this case. Local and remote take the
same path, so there is no branch that only runs on one of them. The save dialog
stays on the client, because that is where the file is going.

`openExternalUrl` stays enabled — it opens URLs, not paths. Monaco's raw-file
fetch stays enabled; it is an HTTP request to the active backend and rides the
tunnel.

Projects are therefore added and repaired on the machine that owns them. This is
the deliberate v1 boundary: a remote backend is operated, not set up.

## Version compatibility

Two machines will not update in lockstep. A newer client against an older
backend sends message types the router does not know
(`packages/backend/src/ws/router.ts`), which surfaces as per-request errors in
whichever pane happened to need them — the worst kind of failure to diagnose.

`PROTOCOL_VERSION` is a single integer in `packages/shared/src/constants.ts`,
bumped only when a change is not backward compatible. It rides in the beacon, so
the menu can label an incompatible backend before you connect.

The on-connect check is a `protocolVersion` field added to the `SYSTEM_INFO`
response (`packages/backend/src/index.ts:416`,
`packages/shared/src/types/system.ts:15`) rather than a new message type, so that
a backend too old to know about any of this still answers rather than erroring.
An absent field means "older than this mechanism" and is treated as
incompatible. `SYSTEM_INFO` is the right carrier because the client needs its
`homedir` and `editors` at bootstrap anyway, so the handshake costs no extra
round trip. It is re-checked on connect and not merely trusted from the beacon,
because a manually added backend never announced anything and because a host can
be restarted onto a different version between announcement and connect.

Equal connects; anything else refuses and names the version each side is
running. A tolerance band would be self-contradictory: the constant bumps *only*
on an incompatible change, so a mismatch is by definition incompatible.

Two backends with the same `PROTOCOL_VERSION` but different app versions are not
flagged. That is the common case after a routine release and it works, which is
what keeps the strict rule from being painful.

The app's own auto-updater is unaffected: it updates this machine's app, which
carries this machine's backend binary. Updating the app does not update a remote
host, which is exactly why the version check exists.

## Non-Electron renderer

The renderer running under `VITE_BACKEND_PORT` with no `window.taskflow` must
keep working. With no IPC bridge, `backend-store` reports a single local entry,
the menu shows it as the only backend, and connect and manage are disabled. This
path is exercised by the existing UI dev server and must not throw.

## Error handling

A dropped tunnel and a dropped socket present identically: the app keeps its
last rendered state, shows a disconnected banner naming the backend, and offers
retry. The existing WebSocket backoff (`useWebSocket.ts:44-54`) still applies
and will reconnect on its own if the tunnel survived. If the ssh child died, the
first reconnect fails and retry re-establishes the tunnel before reconnecting.

A backend that vanishes from discovery while active is not disconnected. The
tunnel is what matters, and the beacon can be lost independently.

Quitting the app with a remote backend active closes the socket and kills the
ssh child. Nothing on the remote host stops: its sessions, agents and schedules
belong to its own backend and keep running, which is the point of the feature.
Reconnecting later re-attaches to those sessions through the existing snapshot
path. The same is true in reverse — the local backend keeps running while you are
looking at a remote one. Two backends on two machines have separate data
directories, separate schedulers and separate session stores, so nothing is
shared and nothing races. The double-write concern the TUI design raises applies
to two backends on *one* machine, which this feature does not create.

## Testing

Beacon encode, parse, probe reply and staleness are pure functions over
datagrams and are tested directly, including a truncated and a
future-`v` payload.

Tunnel argv construction is a pure function and is asserted verbatim, including
the cases where a record carries a non-default user and a non-default SSH port.
Failure classification is
tested against captured stderr for each class in the table above, plus an
unrecognised stderr that must fall through to a generic failure with the raw
text preserved.

The registry's persistence — add, rename, remove, active-id round-trip through
`backends.json` — is tested without spawning anything.

Switching is tested in the renderer against two fake WS servers: records from
server A must not be present after switching to server B, the old socket must
close only after the new one opens, and a failed activation must leave the
original connection intact. The store-reset registry gets its own enumeration
test.

`useBackendIsLocal()` gating is tested at one representative site rather than at
every one.

The WS client's generation handling gets direct tests: a superseded socket's
`close` must not reject the current socket's pending requests, must not flip
connection status, and must not schedule a reconnect. This is the failure that
would present as a mysterious disconnect seconds after a successful switch.

Protocol version comparison, including a backend old enough to answer the
handshake with nothing at all, is a pure function and is tested as one. A
separate test asserts an incompatible backend is refused **before** any teardown
runs: the original connection must still be live and its records intact.

Three switch-specific leaks get their own tests, because each one produces a
plausible-looking app that is quietly wrong:

- After a switch, `AGENTS_LIST` and `SYSTEM_INFO` must have been re-requested —
  the caches in `useAgentAvailability.ts` and `useActiveWorkspace.ts` never see a
  disconnect and so never clear themselves.
- Requests in flight across a switch must reject with `BackendSwitched`, not
  hang to their timeout.
- A `FILE_UNWATCH` for the watched path must be sent on the old socket before it
  closes.

Terminal drop gating is tested for both the `getPathForFile` and the
`text/uri-list` path, since only one of them is obvious.

The flow-artifact endpoint is tested with an artifact path outside any workspace
root — the exact case `/api/file/raw` would have rejected.

## Assumptions

The user has SSH key access to every host they want to connect to, and an
OpenSSH client on the client machine. Windows 10 and later ship one; if it is
absent, remote connection fails with a named error and local operation is
unaffected.

Backends on the same subnet see each other's multicast. Where they do not, the
manual dialog plus the port file is the path, and it is not a degraded one — it
just is not automatic.

Two clients attached to one backend still misrender shared sessions, exactly as
the TUI design describes: the backend holds one terminal grid per session, sized
by whoever resized last (`pty-manager.ts:295-300`). This design does not make
that worse and does not fix it.

Appearance and layout following the active backend means the window may visibly
re-theme on a switch, and each machine's appearance is tuned separately. This
was chosen over splitting the settings object.

## To verify during implementation

**Does a switch really leave nothing behind?** The enumeration test proves every
store is *registered* for reset; it cannot prove any store's reset is
*complete*. If leaks show up, the fallback is approach C, reloading the window on
switch, which is a contained change behind the same menu action.

**Does `node:dgram` multicast survive `bun build --compile`?** It works under
`bun run` on Bun 1.4.0 — verified directly: joining `239.255.42.98:47654`,
sending, and receiving the datagram back. The backend ships as a compiled single
binary, and Bun documents `node:dgram` as implemented but not fully covered by
Node's test suite, so the compiled binary needs the same check before the beacon
is relied on. If it fails there, the advertise side moves to a probe-response
over the existing HTTP server and discovery narrows to hosts already known.

**Does the macOS local-network prompt appear where users expect it?** Denial is
silent from inside the process, so the "nothing discovered" hint is the only
feedback path and needs to be seen on a real machine, not reasoned about.

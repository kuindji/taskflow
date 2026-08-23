# Taskflow Multi-Backend Client — Design

Date: 2026-08-23
Status: Approved for planning

## Problem

The desktop client can only ever talk to the backend Electron spawned for it.
`packages/ui/src/hooks/useWebSocket.ts` holds one module-level socket pointed at
`ws://localhost:<port>`, where the port arrives once from Electron main
(`WebSocketProvider.tsx:23`). A user with Taskflow running on more than one
machine — a desktop that runs the agents and a laptop they carry — has no way to
see the desktop's projects, tasks and sessions from the laptop's app. The only
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
| Re-point mechanism | Re-point the existing singleton, then reset stores and remount the shell |
| Menu location | The sidebar's bottom-left `Monitor` button; Master Workspace folds into the menu |
| Local-path affordances | Disabled while a remote backend is active |

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
run commands on the host. It also directly contradicts the loopback bind the TUI
design introduces. SSH keys the user already manages give the same one-click
feel once configured.

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

Three new units plus edits to existing ones.

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

## Discovery

### Beacon

Every backend advertises on start unless disabled. Multicast group
`239.255.42.98`, port `47654`, TTL 1 so it never leaves the subnet.

Payload, JSON, under 512 bytes:

```
{ v: 1, instanceId, hostname, displayName, port, appVersion, os }
```

`instanceId` is `config.instanceId` — `main`, or `dev-<branch>` under
`TASKFLOW_DEV_BRANCH` (`config.ts:67`). `port` is the live WS port, which is
allocated per start and therefore cannot be assumed stable. `displayName` is the
machine's hostname unless overridden in settings.

Announce every 5 seconds, and immediately in reply to a probe datagram
(`{ v: 1, probe: true }`) so a client that just opened the menu does not wait.
Announce once more on shutdown with `{ bye: true }` so the entry disappears
promptly; a missed `bye` costs nothing because entries also expire.

A new settings field `network.discoverable`, default `true`, gates the advertise
loop. Disabling it stops the beacon; it does not change the bind address, which
is loopback either way.

### Listening

Electron main joins the same group, keeps a map keyed by `hostname:instanceId`,
and marks an entry stale after 15 seconds without an announcement. The renderer
subscribes over IPC and re-renders the menu as entries appear and go stale.

The listener and the advertiser are the same module in `@taskflow/shared` behind
a new `"./discovery"` entry in the package's `exports` map, so that `node:dgram`
never reaches the browser bundle — `packages/shared/package.json` currently has
no `exports` map at all and is consumed as source, so one is added with `"."`
pointing at `src/index.ts` to preserve today's behaviour.

### Port file fallback

Multicast is dropped by many WLAN access points and by every VPN and Tailscale
link. For those hosts the backend also writes its port to a stable path:
a new `config.instancePortFile`, resolving to `<BASE_DIR>/<instanceId>.port`,
written alongside the existing `config.portFile` (`config.ts:74`) and removed on
clean shutdown. Manual "Connect to backend…" resolves a host with no beacon by running
`ssh <user>@<host> cat <path>` over the same SSH the tunnel will use. This also
gives the TUI a stable port file it does not have today.

## Connecting

### Records

```
BackendRecord {
  id            // `${host}:${instanceId}` — stable across restarts, unlike port
  host
  instanceId
  displayName
  user          // defaults to the local $USER at add time
  lastKnownPort
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
ssh -N -L <local>:127.0.0.1:<remote> <user>@<host>
    -o BatchMode=yes
    -o ExitOnForwardFailure=yes
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=3
```

`BatchMode=yes` guarantees ssh never blocks on a prompt — it exits and we read
stderr instead. `ExitOnForwardFailure=yes` makes a failed forward an exit rather
than a silently dead tunnel. The keepalive options make a sleeping laptop's dead
tunnel fail fast rather than hang.

Readiness is a TCP connect to the local end, polled for up to 10 seconds. The
renderer then receives `ws://127.0.0.1:<local>` and connects to it exactly as it
connects to the local backend today; HTTP file URLs
(`packages/ui/src/lib/backend-url.ts`) go over the same forward.

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
| Forward failed | `remote port forwarding failed` / exit with `ExitOnForwardFailure` | "Backend is not listening on `<port>` — it may have restarted" |
| No ssh binary | `ENOENT` on spawn | "OpenSSH client not found" |

The classifier is a pure `(stderr, exitCode) => TunnelFailure` function and is
where the tests for this module live. Every class shows the raw stderr in a
details area — a misclassified failure must still be diagnosable.

### Host key trust

On `Host key verification failed`, main runs `ssh-keyscan -T 5 <host>`, and the
renderer shows a dialog with the host, key type and SHA256 fingerprint. On
approval main appends the scanned line to `~/.ssh/known_hosts` and retries the
tunnel once. On rejection the connection attempt ends.

This is deliberately the one security decision the app makes on the user's
behalf, and it is the standard first-connect prompt ssh would show in a
terminal — with the caveat, stated in the dialog, that a first-use fingerprint
is trusted rather than verified.

## Switching

The switch is ordered so a failure is never destructive:

1. Renderer asks main to activate backend `id`.
2. Main resolves it: local → its port; remote → ensure tunnel, resolving the
   port from the live beacon, else `lastKnownPort`, else the port file over ssh.
3. Main returns the origin. Any failure up to here ends the switch with the
   current backend untouched and an error surfaced.
4. Renderer opens a **new** socket to that origin. Only on `open` does it close
   the old socket, call `resetAllStores()`, and bump the `key` on `AppShell`,
   which unmounts and remounts the whole tree — disposing every xterm, Monaco
   model and pane.
5. Main kills the previous tunnel, if there was one, and persists the new active
   backend id.

An overlay covers steps 1–4 with the target's name and a cancel action.

Because the socket is opened before the old one closes, two sockets exist for
the duration of a handshake. The backend already permits concurrent clients, and
they are to different backends here, so this is harmless.

### Store reset

`stores/store-reset.ts` exports `registerStoreReset(fn)` and `resetAllStores()`.
Every store module registers its own reset at module scope. The remount handles
component state; the registry handles the module-level zustand state that a
remount does not touch. A test enumerates `stores/*.ts` and asserts each
non-test module registered a reset, so a new store cannot silently leak records
across a switch.

### Electron main's own consumers

`notification-poller.ts:27` and `tray-manager.ts:161,186` call
`getBackendPort()` today, which means the local backend. Both move to the active
backend's origin so desktop notifications and tray state describe what the user
is looking at. `backend-manager.ts` keeps `getBackendPort()` for the local
backend it owns; the registry exposes `getActiveOrigin()` separately.

## The menu

The `Monitor` button at `TaskSidebar.tsx:~380` becomes the backend menu:

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

"Connect to backend…" opens a dialog taking host, optional port and optional
user, for hosts multicast cannot reach. "Manage backends…" lists saved records
with rename, edit-user and remove.

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

`openExternalUrl` stays enabled — it opens URLs, not paths. Monaco's raw-file
fetch stays enabled; it is an HTTP request to the active backend and rides the
tunnel.

Projects are therefore added and repaired on the machine that owns them. This is
the deliberate v1 boundary: a remote backend is operated, not set up.

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

A backend that vanishes from discovery while active is not disconnected — the
tunnel is what matters, and the beacon can be lost independently.

## Testing

Beacon encode, parse, probe reply and staleness are pure functions over
datagrams and are tested directly, including a truncated and a
future-`v` payload.

Tunnel argv construction is a pure function and is asserted verbatim, including
the case where a record carries a non-default user. Failure classification is
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

`useBackendIsLocal()` gating is tested at one representative site rather than
all six.

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

Whether `resetAllStores()` plus the remount genuinely leaves nothing behind is
the one unproven assumption. The enumeration test proves every store is
*registered*; it cannot prove every store's reset is *complete*. If leaks show
up in practice, the fallback is approach C — reloading the window on switch —
which is a contained change behind the same menu action.

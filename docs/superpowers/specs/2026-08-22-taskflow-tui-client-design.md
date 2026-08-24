# Taskflow TUI Client — Design

Date: 2026-08-22
Status: Approved for planning

The renderer, input, layout, focus, mouse, and client VT decisions in this
document were superseded by
`docs/superpowers/specs/2026-08-24-taskflow-tui-opentui-design.md`. The backend,
transport, local and remote modes, state mirroring, and staged product scope
remain current.

## Problem

Taskflow is usable only through the Electron app. On a Linux tiling-WM setup
(Omarchy 4 / Hyprland) that is the wrong shape: the work already happens in a
terminal, the editor is nvim, and the desktop app brings a browser engine along
to render what is mostly text and terminal output.

The backend does not require Electron. It is a headless Bun server with a fully
typed JSON protocol, and the Electron app is one client of it. A terminal client
is therefore a client build against an existing API, not a port.

## Scope

In scope for v1: projects, tasks and task detail; terminal sessions (create,
attach, close, tab switching); flows and actions; schedules; git changes and
commit; settings; notifications.

Out of scope for v1: wiki, markdown pane, project search, file explorer, the
browser pane, and remote agent. These have no cheap terminal analogue and none
is load-bearing for the daily loop.

Out of scope permanently: rendering the Monaco editor or a diff viewer. nvim
covers both, and the backend already spawns internal editors as PTY sessions
(`editor-detector.ts:5`, `session-lifecycle.ts:347-368`).

## Decisions

| Question | Decision |
|---|---|
| Client/server topology | Two modes: local (the TUI spawns and owns a backend) and remote (the TUI attaches to an existing one) |
| Remote transport | An SSH tunnel. The backend binds to loopback; SSH provides authentication and encryption |
| Concurrent clients | Allowed and unsynchronized. The TUI warns when another client is attached; it does not negotiate geometry |
| Where the code lives | New workspace package `packages/tui`, importing `@taskflow/shared` |
| Runtime | Bun + TypeScript, shipped via `bun build --compile` |
| VT emulation | `@xterm/headless`, one `Terminal` per open session, client-side |
| Layout | Sidebar + main area, with a zoom toggle for full-screen sessions |
| Focus switcher | `Ctrl+Esc` via the Kitty keyboard protocol; double-`Esc` fallback |
| Settings editing | Native pickers, populated from backend detection endpoints |
| Action/flow/schedule editing | YAML round-trip through `$EDITOR`, kubectl-edit style |
| Dev isolation | Existing protocol only — pass `TASKFLOW_DEV_BRANCH`. No backend change |
| Theming | Indexed ANSI 0-15. No theme import, no truecolor palette |

### Rejected alternatives

**Full-screen mode switching only** (one thing on screen at a time, tmux-style).
Simplest possible renderer — sessions could be raw passthrough with no cell grid
at all. Rejected because seeing task context beside the running agent is the
thing Taskflow offers over a bare multiplexer; removing it removes the reason to
build the client.

**Control plane plus a separate `attach` binary**, tiled by Hyprland. Least code,
most idiomatic for the platform. Rejected for the same reason: the two halves
never share a screen, so there is no place to show task state next to session
output.

**Native TUI forms for every record.** Rejected because `ActionDefinition.prompt`
is a multi-line prompt (`flow.ts:10`) and `FlowDefinition.actions[]` is a nested
reference-or-inline union (`flow.ts:44`). A hand-rolled multi-line text widget
and a nested-union form builder are the two worst things to write in a TUI, and
nvim is already the user's editor.

**Everything as YAML, settings included.** Uniform and smallest, but on a fresh
machine the valid values for agents, runtimes, shells and models are exactly what
the user does not know. Settings pickers read those from the backend
(`AGENTS_LIST`, `RUNTIMES_LIST`, `SHELLS_LIST`, model lists) and show what is
actually installed.

**Go or Rust for render throughput.** Better headroom and a smaller binary, but
gives up `@taskflow/shared` — 143 typed message types — and `@xterm/headless`,
which would then have to be replaced with a third-party VT crate. Bad trade.

**A `TASKFLOW_BASE_DIR` override for true dev isolation.** Considered and
rejected by the user as unnecessary; see Assumptions.

**A token in the WebSocket handshake for remote access.** Self-contained and
needs no SSH session, but it is authentication code written from scratch, and
it leaves the traffic unencrypted unless TLS is added too — meaning prompts,
source and agent output would cross the network in clear text. An SSH tunnel
provides both properties using key material the user already manages.

**Per-client viewports on the backend.** The correct fix for two clients sharing
one session, and the prerequisite for using the desktop app and the TUI on the
same session at once. Rejected for now because the user accepted the
misrendering instead; see Remote operation.

## Architecture

A new workspace package, `packages/tui`. It owns the backend the way Electron
does today — a port of `electron/src/backend-manager.ts` minus the auto-updater
and dev-server URL handling: set `TASKFLOW_PORT_FILE`, spawn the backend binary,
poll for the port file, connect, kill the child on exit.

### Modules

| Unit | Responsibility | Knows nothing about |
|---|---|---|
| `net/` | WS connect, request/response by `correlationId`, event bus | Taskflow records, rendering |
| `state/` | Mirrors backend records; subscribes to events | Rendering |
| `term/` | One headless xterm per session; attach/resync; cell extraction | Screen layout |
| `render/` | Global screen cell buffer, frame diffing, flush to stdout | Taskflow entirely |
| `input/` | Keyboard decode and per-child re-encode | Screens |
| `edit/` | YAML round-trip through `$EDITOR` | Rendering |
| `ui/` | Screens and widgets composed from the above | — |

`render/` and `input/` contain no Taskflow concepts, which is what makes them
testable in isolation: feed bytes, assert bytes. `term/` carries the most risk.
`ui/` carries the most code and the least risk.

## Rendering core

One `@xterm/headless` `Terminal` per open session, sized to the session pane.

### Attach

A port of `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:266-308`,
which is already-debugged logic:

1. Subscribe to `TERMINAL_OUTPUT`, buffering chunks with their `sequence` while
   not yet loaded.
2. Request `SESSION_SNAPSHOT`. If `snapshot` is non-null, write it, apply
   `cursorHidden`, mark loaded, then flush buffered chunks whose
   `sequence > lastSequence`.
3. If it is null, fall back to `SESSION_HISTORY` and do the same.
4. On failure, write everything buffered.

### Render

Walk `buffer.active` from `viewportY` for `rows`; `getLine(y).getCell(x)`; blit
into the global screen buffer at the pane offset. Respect `getWidth()` so wide
glyphs do not shear.

Colors follow the cell's reported mode: `isFgPalette()` emits indexed SGR,
`isFgRGB()` emits truecolor, `isFgDefault()` emits reset. A palette index is
never translated to RGB — doing so would break live theme switching.

Frames are diffed against the previous frame, emitting only changed runs and
coalescing adjacent cells that share SGR state. Rendering is driven by a dirty
flag on a 60fps frame cap, never per output chunk. Sessions that are not visible keep
feeding their terminal but are not rendered.

### Resize

The TUI computes the pane rect, sends `TERMINAL_RESIZE`, and the backend resizes
both the PTY and its own headless grid (`pty-manager.ts:295-300`). The TUI then
resizes its local grid to match. Single-client topology is what makes this
authoritative rather than a negotiation between clients.

### Cursor

When a session pane has focus, the real cursor sits at pane origin plus
`buffer.cursorX/cursorY`, honoring `cursorHidden`. Otherwise it is parked in the
UI.

## Input

One pipeline: outer terminal → decode → `KeyEvent` → route → either a UI command
or bytes encoded for that session's PTY via `SESSION_INPUT`.

### Negotiation

On startup, enter raw mode and query the outer terminal with `CSI ? u`. A
`CSI ? <flags> u` reply within a short timeout means the Kitty keyboard protocol
is available; push flags with `CSI > 1 u` and use `Ctrl+Esc` as the focus
switcher. No reply means legacy mode and a double-`Esc` fallback. Flags are
popped with `CSI < u` on exit.

`Ctrl+Esc` is used because a legacy terminal cannot encode modifier-plus-Escape
at all — `Ctrl+Esc` and `Super+Esc` both arrive as a bare `0x1b`. The Kitty
protocol is what makes the event exist. Plain `Esc` is unusable as a switcher
because nvim and Claude Code both need it.

### Decode

Two decoders behind one interface — Kitty `CSI u` and legacy — both pure
`bytes → KeyEvent[]` functions. `KeyEvent` is
`{ key, mods: {ctrl, alt, shift, super}, kind: press | repeat | release }`.

### Encode per session

Encoding consults the target session's own terminal state:

| Child mode | Effect |
|---|---|
| `applicationCursorKeysMode` | arrows as `SS3 A` rather than `CSI A` |
| `bracketedPasteMode` | wrap pastes in `ESC[200~` … `ESC[201~` |
| `sendFocusMode` | emit `CSI I` / `CSI O` on pane focus change |
| `mouseTrackingMode` | forward mouse reports only in the requested encoding |

`IModes` (`xterm-headless.d.ts:1298-1340`) exposes all of these. It does not
expose the Kitty protocol, so that is tracked per session by registering parser
handlers (`xterm-headless.d.ts:1205`) for `{ prefix: '>', final: 'u' }` (push)
and `{ prefix: '<', final: 'u' }` (pop). When a child has pushed it, encode
`CSI u` to that child instead of legacy.

This is what allows a real `Shift+Enter` to reach Claude Code. The web UI cannot
deliver one and substitutes `\x1b\r` (`TerminalPane.tsx:183`).

### Terminal restoration

Raw mode off, Kitty flags popped, alt screen off, cursor shown, mouse tracking
off — on clean exit, on `SIGINT`/`SIGTERM`/`SIGHUP`, and on uncaught exception.
A client that dies leaving the terminal in raw mode with a hidden cursor is the
worst available failure mode, so this is a correctness requirement with its own
tests.

### Keymap

`Ctrl+Esc` is the only key the TUI reserves while a session has focus.
Everything else reaches the child. With focus in the UI, no key needs a
modifier, so plain keys carry the commands:

| Key (UI focus) | Action |
|---|---|
| `j` / `k` | move within the focused list |
| `h` / `l` | move between sidebar and main area |
| `Enter` | open / focus the session |
| `1`..`9` | select session tab |
| `z` | zoom the main area |
| `n` | new task; `s` new session |
| `f` | flows, `g` git changes, `c` schedules, `,` settings |
| `/` | filter |
| `?` | help |
| `q` | close pane; `Q` quit |

The full map lives in the help overlay. Keys are not user-rebindable in v1.

## Screens

Sidebar plus a main area holding a tab strip and one of: session pane, changes
pane, or flow run pane. A zoom key expands the main area to the full screen.

| Screen | Backed by |
|---|---|
| Sidebar | `PROJECT_LIST`, `TASK_LIST` + events |
| Session pane + tabs | `SessionRef`, `SESSION_STATUS`, `onTitleChange` |
| New session | `AGENTS_LIST`; launches with settings defaults |
| Flows | `FLOW_DEFINITIONS_LIST`, `FLOW_START`, `FLOW_RUN_UPDATED` |
| Actions | `FLOW_ACTIONS_LIST`, `FLOW_ACTION_SAVE` |
| Schedules | `SCHEDULE_LIST`, `SCHEDULE_TRIGGER`, `SCHEDULE_CREATE/UPDATE` |
| Changes + commit | `GIT_STATUS`, `GIT_DIFF_FILE`, `GIT_STAGE/UNSTAGE`, `GIT_COMMIT`, `GIT_GENERATE_COMMIT_MSG` |
| Task detail | `TASK_LOG_LIST`, `TASK_LOG_ADDED`, `ATTR_*` |
| Settings | `SETTINGS_GET/UPDATE` plus detection endpoints |

Notifications are delivered with `notify-send`, driven by
`NOTIFICATION_CREATED`.

The schedules screen must show a banner when running under a dev instance: the
scheduler is gated to `instanceId === "main"` (`index.ts:165`), so a dev
instance never fires schedules. Without the banner this is a silent no-op.

### Record editing

Settings use native pickers whose options come from `AGENTS_LIST`,
`RUNTIMES_LIST`, `SHELLS_LIST` and the per-agent model endpoints, so a fresh
machine shows what is actually installed.

Layout preferences the TUI needs to persist — sidebar width, collapsed
projects — reuse the existing `LayoutSettings.panels` fields rather than
introducing a separate config file. Preferences with no backend equivalent are
not persisted in v1.

Actions, flows and schedules are edited as YAML: serialize the record to a temp
file with the valid enum values as leading comments, open `$EDITOR`, parse and
validate on exit, then save via the record's `*_SAVE` / `*_UPDATE` message.
Validation failures reopen the buffer with the errors as comments.

## Theming

The TUI draws in indexed ANSI 0-15 and the terminal's default foreground and
background. Omarchy's active theme therefore applies with no code, and survives
`omarchy-theme-set` with no restart. The existing `theme-parsers` are not used
by this client.

## Remote operation

The TUI runs in two modes.

**Local.** `taskflow-tui` spawns its own backend, as described above, and owns
its lifetime.

**Remote.** `taskflow-tui --connect <host>:<port>` attaches to a backend that is
already running and never spawns one. The intended deployment is a desktop
running the backend and a laptop running the TUI, reached over an SSH tunnel:

```
laptop$ ssh -N -L 7777:127.0.0.1:54892 desktop &
laptop$ taskflow-tui --connect 127.0.0.1:7777
```

Authentication, encryption and key management are SSH's responsibility. The TUI
adds no auth of its own.

This requires one backend change. `Bun.serve` currently defaults to all
interfaces, so the backend listens on `*:<port>` with no authentication — a
device on the same network can already spawn a shell on the host. Binding to
`127.0.0.1` closes that and makes the tunnel the only route in. It is a
one-line change and is worth making regardless of the TUI.

**Concurrent clients are permitted and will misrender.** A session has exactly
one terminal grid on the backend, resized by whichever client resized last
(`pty-manager.ts:295-300`). With the desktop app and the TUI viewing the same
session at different window sizes, the one that did not resize last draws
incorrectly until it resizes. Fixing this properly means per-client viewports,
which is deferred. Instead the backend broadcasts its connected-client count and
the TUI shows a banner when more than one client is attached, so the
misrendering is explained rather than mysterious.

**Reconnection is expected, not exceptional.** A tunnel drops when the laptop
sleeps or changes network. The WebSocket client reconnects with backoff, and on
reconnect every open session re-runs its attach sequence, recovering the current
screen from `SESSION_SNAPSHOT`. The snapshot-and-sequence design already carries
this: the backend drops terminal output to clients that fall behind
(`ws/server.ts:33-37`, `dropOnBackpressure`) precisely because a client can
resync from a snapshot afterwards. Over a slow link this becomes the normal path
rather than an edge case.

## Dev isolation

The TUI passes `TASKFLOW_DEV_BRANCH` when spawning its backend, exactly as
`backend-manager.ts:121` does. That yields `instanceId = dev-<branch>`
(`config.ts:52-66`), which isolates sessions and session logs
(`config.ts:26-40`), namespaces flow runs, and gates the scheduler off.

## Error handling

Backend spawn failure, and the WS connection dropping, both surface as a modal
state rather than a crash; the TUI retries and keeps the last rendered frame.
Session attach failures degrade through the snapshot → history → buffered-only
chain already described. YAML validation failures return the user to the editor
rather than discarding their edit. Every exit path restores the terminal.

## Testing

`input/` decoders and encoders are pure functions over bytes and are tested
directly, including the legacy/Kitty split and each per-child mode.

`render/` is tested by driving a cell grid and asserting the emitted byte
stream, with particular attention to the diffing: an unchanged frame must emit
nothing, and wide glyphs must not shear.

`term/` attach is tested against a fake `net/` that replays recorded
snapshot/history/output sequences, covering the case where output arrives before
the snapshot resolves.

`state/` is tested against recorded protocol event streams.

Terminal restoration is tested by asserting the byte sequence emitted on each
exit path, including the signal handlers.

## Assumptions

The user accepted that dev and production instances share projects, tasks, flow
and action definitions, schedule records, notifications and settings
(`config.ts:26-40`; `settingsFile` is at `BASE_DIR/settings.json`, not under the
data dir). Only sessions, session logs and flow runs are isolated. Two backends
against the same data dir means two processes writing the same JSON files with
no locking, which is already true of dev-Electron alongside production today.

Remote mode assumes the user can open an SSH session to the backend host. No
fallback is provided for a host reachable only over plain TCP; on such a host
the backend would have to keep binding to a routable interface, which this
design explicitly removes.

Omarchy 4 is assumed to ship a terminal supporting the Kitty keyboard protocol.
Ghostty, Kitty, foot and Alacritty all do. If that turns out to be false the
double-`Esc` fallback carries the design, at the cost of `Esc` latency inside
nvim and no real `Shift+Enter`.

## To verify during implementation

Render throughput under a fast-output agent is the one unproven assumption in
this design. The frame cap, the backend's existing write batching
(`pty-manager.ts:57`) and skipping invisible sessions are the mitigations; if
they prove insufficient the fallback is a coarser dirty-region model rather than
a change of architecture.

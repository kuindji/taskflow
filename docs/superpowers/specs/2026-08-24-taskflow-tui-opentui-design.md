# Taskflow TUI OpenTUI rewrite design

Status: implemented on 2026-08-24

Implementation note: the production entry point still passes an empty session
list. `SessionBridge` and session tabs are covered through injected test
fixtures, but session creation, attaching existing sessions, close, resume, and
runtime tab population remain Stage 2 work.

This design supersedes the renderer, outer-terminal input, layout, focus, mouse,
and client-side VT-emulation decisions in
`docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`. It does not
change that document's backend ownership, WebSocket transport, local versus
remote modes, state mirroring, or staged product scope.

## Goal

Replace the custom TUI platform code with `@opentui/core` while preserving the
completed Stage 1 behavior:

- start or connect to a Taskflow backend;
- show projects and active tasks in a sidebar;
- open, attach, render, resize, and reconnect live sessions;
- keep session input mode-aware, including Kitty keyboard, bracketed paste,
  application cursor keys, child mouse modes, and focus events;
- support keyboard and mouse navigation, zoom, tabs, scrollback, the concurrent
  client warning, and safe terminal restoration.

The rewrite is a migration, not Stage 2. It does not add flows, schedules, git,
task editing, settings, or new session creation.

## Baseline

At `f329995`, `bun test packages/tui` passes 505 tests across 23 files. The
Stage 1 handoff is closed at `42c9d5f`. The following old-plan items remain out
of this rewrite:

- Task 18.1, the remote SSH-tunnel smoke test, is deferred and remote-backend
  work is still on hold.
- Task 19.6, the manual mouse smoke test, remains a human gate. The OpenTUI
  cutover smoke test can satisfy it if the same cases are exercised.
- Task 20, backend orphan shutdown, needs its own plan.
- Tasks 22 and 23 concern pre-existing full-suite test behavior.

## Decisions

| Question | Decision |
|---|---|
| OpenTUI package | `@opentui/core` is pinned to `0.5.7`; its required `web-tree-sitter` peer is pinned to `0.25.10` |
| Binding | Use the imperative Core API, not React or Solid |
| Child terminal | Use Core's `EmbeddedTerminalRenderable`, backed by Ghostty VT |
| Outer renderer | Let `CliRenderer` own the alternate screen, frame buffer, diffing, cursor, resize, mouse negotiation, Kitty negotiation, and restoration |
| Layout | Use OpenTUI renderables and Yoga layout |
| App commands | Use the renderer's global key listener and renderable mouse handlers; do not add `@opentui/keymap` for Stage 1 |
| State and transport | Keep `Store`, `WsClient`, CLI parsing, and backend management behind their existing interfaces |
| Migration | Build a side-by-side OpenTUI entry point, prove parity, then switch the default and delete the legacy platform code |

The Core API is the better fit than a framework binding. Taskflow's TUI is
already an imperative application, and the embedded terminal is a Core-only
renderable. A React or Solid wrapper would add a reconciler and a custom
catalogue adapter without removing any necessary code.

## Verified OpenTUI capabilities

The plan was checked against the OpenTUI 0.5.7 package and current official
documentation on 2026-08-24.

- `CliRenderer` owns terminal setup, input, render scheduling, focus, cursor,
  resize, mouse, and teardown.
- `EmbeddedTerminalRenderable` owns a VT parser, cell grid, cursor, scrollback,
  child-mode-aware keyboard, paste, focus, and mouse encoders.
- `@opentui/core/testing` provides an in-memory renderer, frame capture, mock
  keys, mock mouse, and resize helpers.
- Bun standalone compilation embeds OpenTUI's native assets.

A disposable probe outside the repository established four details that the
rewrite depends on:

1. Bun 1.4.0 loads `@opentui/core@0.5.7` on the current Darwin ARM64 host.
2. `EmbeddedTerminalRenderable` renders output serialized by
   `@xterm/addon-serialize@0.13.0`.
3. The serialized snapshot restores application-cursor and bracketed-paste
   modes, and OpenTUI then encodes arrows and paste accordingly.
4. The same probe compiles and runs as a single Bun executable.

Relevant upstream documentation:

- <https://opentui.com/docs/core-concepts/renderer/>
- <https://opentui.com/docs/components/embedded-terminal/>
- <https://opentui.com/docs/core-concepts/keyboard/>
- <https://opentui.com/docs/core-concepts/testing/>
- <https://opentui.com/docs/reference/standalone-executables/>

## Architecture

```text
backend process or --connect target
        |
        v
     WsClient -------- Store
        |                 |
        |                 v
        |           OpenTuiApp renderables
        |                 |
        v                 v
 SessionBridge --> EmbeddedTerminalRenderable
        ^                 |
        |                 v
        +---------- onData / onTerminalResize
```

### Kept units

The rewrite keeps these units, with only narrow integration edits:

- `src/cli.ts`
- `src/backend/manager.ts`
- `src/net/client.ts`
- `src/state/store.ts`

They contain no custom terminal rendering or input parsing.

### New units

`src/opentui/runtime.ts` creates and destroys `CliRenderer`, installs signal and
fatal-error handling, and exposes the small renderer interface the entry point
needs.

`src/opentui/session-bridge.ts` owns one
`EmbeddedTerminalRenderable`. It keeps Taskflow's attach, output-sequence,
reconnect, exit-marker, and disposal rules. OpenTUI owns VT state and input
encoding.

`src/opentui/app.ts` owns navigation state and the renderable tree. It updates
the sidebar from `Store.onChange`, manages tab visibility and focus, and shows
the client-count warning.

`src/opentui/keys.ts` contains the small pure command router and the adapter from
OpenTUI key events. It retains the Stage 1 focus-switch contract.

The exact filenames may be adjusted during implementation, but these ownership
boundaries should not move.

## Renderer lifecycle

Create `CliRenderer` with these policies:

- alternate-screen mode;
- mouse enabled unless `TASKFLOW_TUI_NO_MOUSE=1`;
- Kitty keyboard enabled;
- automatic click focus disabled where it conflicts with Taskflow's explicit
  focus model;
- `exitOnCtrlC: false`, because Ctrl+C belongs to the focused child terminal;
- no continuous 60 fps loop. Store changes and terminal writes request frames.

OpenTUI does not promise cleanup after an unconditional `process.exit`. Every
clean, signalled, startup-error, and uncaught-error path must call
`renderer.destroy()` before closing the WebSocket or owned backend and before
exiting. Preserve the existing backend reaper and conventional signal exit
codes.

## Session bridge

Each open session owns one embedded terminal. Inactive tabs remain alive and
continue parsing output, but only the active terminal is visible and focusable.

### Live output

The bridge subscribes before attaching. Each matching `TERMINAL_OUTPUT` chunk
is retained with its sequence number and passed to `terminal.write()`. A
matching `SESSION_EXITED` event appends the existing process-exit marker.

`terminal.onData` has two sources:

- `input` is key, paste, focus, or mouse input and is sent through
  `SESSION_INPUT`;
- `response` is a terminal reply such as DSR and is sent only for live child
  output, not while replaying a snapshot or history. Replaying an old query must
  not inject a stale reply into the current child.

`terminal.onTerminalResize` sends `TERMINAL_RESIZE`. Initial construction uses
the pane's current grid. A hidden terminal is explicitly resized when it becomes
active because OpenTUI does not resize hidden embedded terminals.

`maxScrollback` is 16 MiB. The implementation probe showed that OpenTUI counts
native cell storage rather than raw input bytes: 2 MiB retained only about 950
full 200-column rows. The larger cap retains the required 5,000-row fixture.

### Attach and reconnect

Keep the current sequence-bound replay rule:

1. Buffer live output until a snapshot or history has been applied.
2. Apply the backend snapshot when present.
3. Apply only buffered chunks with `sequence > lastSequence`.
4. On first attach to a session with no in-memory snapshot, fall back to
   `SESSION_HISTORY`.
5. Serialize overlapping attaches. A failed reattach leaves the last good
   screen in place.

Reset the embedded terminal with RIS only after replacement data has arrived.
Do not clear the visible terminal before the fetch succeeds.

### Snapshot fidelity

The current backend snapshot is xterm SerializeAddon output plus
`cursorHidden` and `kittyStack`. The disposable probe confirmed that the
serializer also omits the active mouse encoding, such as SGR `?1006`. The
legacy client preserves that mode from its own pre-drop parser, but a new client
attaching to an already-running mouse-aware child has no source for it.

Before the OpenTUI cutover, extend `SessionSnapshotResponse` with a shared
`mouseEncoding` value. Track it in `PtyManager` beside the existing Kitty stack
and cursor visibility. After writing the serialized snapshot, the bridge
restores, in order:

- the explicit mouse encoding;
- every entry of the Kitty keyboard stack;
- hidden cursor state.

The backend and TUI from one release are the supported pair. An older remote
backend that does not provide the required snapshot state should produce a
clear compatibility error, not silently send incorrectly encoded input.

## Input and focus

OpenTUI parses the outer input stream. Taskflow no longer negotiates Kitty,
holds incomplete CSI, parses mouse reports, or re-encodes child input itself.

The renderer's global key listener runs before the focused embedded terminal:

- exact Ctrl+Escape switches between UI and session focus when the terminal can
  report it;
- double Escape remains the legacy-terminal fallback;
- while session focus is active, every other key and paste reaches the embedded
  terminal;
- while UI focus is active, the Stage 1 sidebar, tab, zoom, and quit bindings
  remain unchanged.

Consumed UI commands call `preventDefault()` and `stopPropagation()`. Unhandled
session keys do neither. Tests must cover a real Escape sent to the child,
Shift+Enter under Kitty, Ctrl+C, key repeat and release, bracketed paste, and the
legacy double-Escape timeout.

Mouse ownership follows the render tree:

- sidebar row and tab handlers update navigation and focus;
- a child that enables mouse reporting receives pane mouse events through the
  embedded terminal;
- otherwise the embedded terminal handles local three-line wheel scrolling;
- set `selectable: false` for Stage 1 parity. Text selection was not part of the
  completed client, and selection plus child mouse reporting can act on the
  same gesture in OpenTUI.

## Layout and rendering

Use a row root with a sidebar and a main column. The sidebar remains one third
of the terminal width, capped at 30 columns. Zoom hides it. The main column has
a one-row tab strip and a flexing session pane.

OpenTUI replaces:

- `render/cells.ts`, `render/sgr.ts`, and `render/screen.ts`;
- `render/text.ts` where OpenTUI text measurement and clipping cover the same
  behavior;
- `term/tty.ts` and `term/blit.ts`;
- the legacy and Kitty decoders, CSI carry logic, mouse parser, negotiation,
  and child encoders;
- manual layout hit testing and cursor placement.

Project and task labels remain untrusted text. They must be rendered as text
content, clipped by cell width, and unable to inject terminal control
sequences. Project rows remain bold, task rows remain indented, selected rows
remain visibly selected, and session-count badges must never be clipped into a
wrong number.

## Testing and cutover

Automated parity is behavior-based. Do not port each legacy unit test to an
OpenTUI implementation detail. Use:

- pure tests for navigation and attach sequence logic;
- `createTestRenderer`, `captureCharFrame`, `captureSpans`, `mockInput`, and
  `mockMouse` for layout and interaction;
- embedded-terminal tests for snapshot replay, input modes, cursor, scrollback,
  resize, process exit, reconnect, and response suppression;
- existing tests unchanged for CLI, backend manager, WebSocket client, and
  Store;
- a standalone build test that executes the binary from a different directory.

Keep the legacy entry point available only until the OpenTUI path passes the
automated checks and a local real-terminal smoke test. Then make OpenTUI the
only entry point, remove the old package dependency and files, and run the
standard Level 1 review. Remote SSH smoke remains deferred until separately
authorized.

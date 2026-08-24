# Taskflow TUI OpenTUI rewrite implementation plan

Design: `docs/superpowers/specs/2026-08-24-taskflow-tui-opentui-design.md`

Goal: replace the completed Stage 1 client's custom renderer, outer input
stack, layout, and client VT emulator with `@opentui/core`, without adding
Stage 2 product features.

Review level: Level 0 while implementing each task, then one Level 1 review of
the complete rewrite. Do not turn each task into an independent broad review.

## Constraints

- Use Bun for dependency and script operations.
- Pin the first OpenTUI dependency to an exact version. Do not take an
  unreviewed minor update during the rewrite.
- Keep the legacy path runnable until automated parity and local smoke testing
  pass.
- Preserve unrelated work. The current checkout is ahead of `origin/main` and
  contains unrelated untracked files.
- Do not resume remote-backend work or the SSH-tunnel smoke test.
- Do not fold in Stage 1 handoff Tasks 20, 22, or 23.
- Do not add React, Solid, or `@opentui/keymap` for this stage.
- Run the narrow test first, then `bun test packages/tui`, then the repo static
  checks appropriate to the changed files.

## Stage A: establish the OpenTUI boundary

### Task 1: package pin, renderer harness, and compiled-binary proof

Files:

- modify `packages/tui/package.json`
- modify `bun.lock`
- create `packages/tui/src/opentui/runtime.ts`
- create `packages/tui/src/opentui/runtime.test.ts`
- add a temporary `dev:opentui` entry point or equivalent without changing the
  default TUI command

Work:

1. Add exact `@opentui/core@0.5.7` to the TUI package.
2. Create `CliRenderer` in alternate-screen mode with Taskflow's mouse opt-out,
   Kitty enabled, Ctrl+C reserved for the focused child, and explicit teardown.
3. Put all signal, fatal-error, renderer destruction, WebSocket closure, and
   backend-stop ordering in one owner.
4. Preserve conventional signal exit codes and the existing escalating backend
   reaper.
5. Add an in-memory test proving render, resize, and destroy behavior.
6. Compile a minimal OpenTUI TUI binary, copy it outside its build directory,
   and execute it there. This proves native assets are embedded rather than
   accidentally read from the checkout.

Acceptance:

- startup failure before and after renderer creation restores the outer
  terminal exactly once;
- signals restore the terminal before stopping the backend;
- Ctrl+C is not claimed globally by the renderer;
- the moved standalone executable starts and exits successfully on the current
  supported platform;
- the legacy entry point still runs.

### Task 2: make backend snapshots sufficient for a new terminal client

Files:

- modify `packages/shared/src/types/ws.ts`
- modify `packages/shared/src/index.ts` only if a new shared type needs export
- modify `packages/backend/src/services/pty-manager.ts`
- modify `packages/backend/tests/services/pty-manager*.test.ts` or the existing
  nearest snapshot tests
- add focused tests under `packages/tui/src/opentui/`

Work:

1. Add a shared mouse-encoding type covering x10, UTF-8, SGR, urxvt, and SGR
   pixel mode.
2. Add the active mouse encoding to `SessionSnapshotResponse`.
3. Track the mode in `PtyManager` with xterm parser hooks, including disable and
   RIS behavior. Keep the existing Kitty stack and cursor-hidden fields.
4. Confirm with a cross-emulator test that an xterm SerializeAddon snapshot plus
   the supplemental fields restores OpenTUI input behavior for:
   application cursor keys, bracketed paste, nested Kitty state, cursor
   visibility, mouse tracking, and mouse encoding.
5. Define the compatibility failure for a remote backend that cannot provide
   the required field.

Acceptance:

- a newly attached OpenTUI client sends SGR mouse input to a child that enabled
  `?1006` before the client connected;
- nested Kitty push and pop state survives attach;
- a child RIS returns supplemental modes to defaults;
- the existing Electron and legacy TUI clients tolerate the additive response
  field;
- shared, backend, and TUI focused tests pass.

## Stage B: replace the child terminal

### Task 3: build the OpenTUI session bridge

Files:

- create `packages/tui/src/opentui/session-bridge.ts`
- create `packages/tui/src/opentui/session-bridge.test.ts`
- reuse `packages/tui/src/net/client.ts` and shared protocol types

Work:

1. Wrap one `EmbeddedTerminalRenderable` per Taskflow session.
2. Subscribe before attach and preserve the current pending and recent sequence
   queues.
3. Apply snapshot, supplemental mode state, cursor state, and fresh buffered
   chunks in the existing order.
4. Keep first-attach history fallback and serialize overlapping attaches.
5. Do not clear the last good grid until replacement data is available.
6. Feed live output and process-exit markers into the embedded terminal.
7. Send `input` bytes and live `response` bytes through `SESSION_INPUT`.
   Suppress terminal responses while replaying snapshot or history.
8. Send visible layout changes through `TERMINAL_RESIZE` and resize a hidden
   terminal when it becomes active.
9. Destroy backend subscriptions and native terminal state idempotently.

Acceptance:

- port the behavioral cases from the legacy `SessionTerminal` tests: initial
  snapshot, history fallback, stale versus fresh sequence replay, repeated
  reconnect, failed reconnect, process exit, scrollback, resize, cursor, nested
  Kitty, bracketed paste, application cursor keys, and mouse modes;
- a historical DSR query does not write a stale response to the child;
- a live DSR query does write its response;
- an inactive session continues parsing output and shows the current screen
  when selected;
- no test reaches into OpenTUI private state.

### Task 4: prove child input parity through OpenTUI

Files:

- extend `packages/tui/src/opentui/session-bridge.test.ts`
- create a small pure byte/string adapter only if required by the JSON WebSocket
  protocol

Work:

Use OpenTUI's real key and paste events rather than constructing guessed escape
sequences. Test:

- plain text and control keys;
- Ctrl+C;
- Escape;
- Shift+Enter under Kitty;
- press, repeat, and release events;
- application-cursor arrows;
- bracketed and unbracketed paste;
- focus-in and focus-out reporting;
- child mouse disabled, X10, VT200, drag, any-motion, SGR, and pixel-mode
  refusal;
- Unicode text and wide glyphs.

Acceptance:

- every case sends the bytes expected by the child's current modes;
- Taskflow no longer has a second child key or mouse encoder on the OpenTUI
  path;
- invalid or empty encoded input sends no WebSocket request.

## Stage C: replace the application shell

### Task 5: sidebar, tab strip, warning, and responsive layout

Files:

- create `packages/tui/src/opentui/app.ts`
- create `packages/tui/src/opentui/app.test.ts`
- create smaller component files only where they make ownership clearer

Work:

1. Build a Yoga row with a one-third-width sidebar capped at 30 columns and a
   flexing main column.
2. Render projects followed by active tasks. Keep project bolding, task indent,
   selection, and truthful session-count badges.
3. Keep the selected record visible as the list moves or shrinks.
4. Render clickable session tabs and only one visible embedded terminal.
5. Render the connected-client warning at the right of the tab strip without
   leaving an invisible clickable tab below it.
6. Hide the sidebar in zoom mode and restore it without losing selection.
7. Subscribe to Store and client-count changes and request a frame only when
   state changes.

Acceptance:

- frame tests cover 80x24, a narrow terminal, one row, zoomed layout, overflowing
  rows, overflowing tabs, wide labels, control characters, and changing session
  counts;
- project and task labels cannot inject terminal control sequences;
- mouse clicks select sidebar rows and tabs at the cells actually rendered;
- resize updates layout and the active child grid once;
- an unchanged application state produces no app-driven render churn.

### Task 6: focus switching and UI commands

Files:

- create `packages/tui/src/opentui/keys.ts`
- create `packages/tui/src/opentui/keys.test.ts`
- modify `packages/tui/src/opentui/app.ts`

Work:

1. Adapt OpenTUI key events into a small pure navigation router.
2. Preserve Ctrl+Escape switching when Kitty reports the chord.
3. Preserve double Escape as the legacy fallback without swallowing a real
   Escape followed by another key.
4. While the embedded terminal has focus, intercept only the focus switch.
5. While UI focus is active, preserve Stage 1 commands: j/k and arrows, Enter,
   1 through 9, z, Q, and currently inert deferred commands.
6. Use `preventDefault` and `stopPropagation` only for consumed commands.
7. Replace manual mouse routing with renderable handlers and the embedded
   terminal's own mouse forwarding and local scrolling.

Acceptance:

- mock input proves UI commands do not leak into the child;
- every non-switch key reaches the focused child;
- Escape reaches the child in Kitty mode;
- the legacy double-Escape timer neither loses nor reorders the next key;
- click, drag, release, and wheel events have one owner;
- focus changes update the visible host cursor and child focus-reporting mode.

### Task 7: wire the side-by-side OpenTUI entry point

Files:

- create a temporary OpenTUI entry point under `packages/tui/src/`
- modify `packages/tui/package.json`
- add entry-point integration tests

Work:

Connect CLI parsing, backend ownership, WebSocket startup, Store, OpenTuiApp,
reconnect, resize, shutdown, and error reporting. Keep the legacy entry point as
the default during this task.

Acceptance:

- local mode starts and stops its owned backend;
- connect mode never starts or stops a backend;
- input arriving during startup and initial attach is not lost;
- reconnect reloads Store and every open live session;
- startup and runtime errors are visible after the renderer restores the outer
  terminal;
- `bun test packages/tui` passes with both entry points present.

## Stage D: cut over and remove the legacy platform

### Task 8: local real-terminal parity gate

This is a human gate. Do not treat automated frame capture as its substitute.

Run the OpenTUI entry point in a real terminal and verify:

- clean launch and exit with the shell restored;
- project and task navigation by key and mouse;
- tab switching and zoom;
- Claude, Codex, and a shell session render live output;
- Escape, Shift+Enter, Ctrl+C, paste, application arrows, and child mouse input;
- local scrollback when the child has not claimed the mouse;
- resize while focused, unfocused, zoomed, and on an inactive tab;
- backend reconnect and session resync;
- the concurrent-client warning;
- signal and startup-error restoration.

If the mouse cases match Task 19.6, record that task as satisfied. Do not run the
deferred remote SSH-tunnel smoke test.

### Task 9: switch the default and delete the old stack

Files:

- replace `packages/tui/src/index.ts` with the proven OpenTUI entry point
- remove superseded files under `packages/tui/src/render/`
- remove superseded files under `packages/tui/src/input/`
- remove `packages/tui/src/term/tty.ts` and `packages/tui/src/term/blit.ts`
- remove the legacy session terminal and manual UI drawing and hit-testing files
- remove `@xterm/headless` from `packages/tui/package.json`; it remains in the
  backend package where snapshots are produced
- remove tests that cover deleted implementation details only
- update the TUI design and handoff documents to point at the OpenTUI design

Work:

1. Switch `dev` and `build:bin` to the OpenTUI entry point.
2. Delete the old renderer, TTY owner, input parsers, input encoders, manual
   blitter, cell layout, and hit-testing code.
3. Keep behavior tests at the application and session boundaries.
4. Run dependency closure checks so no deleted module or stale package remains.

Acceptance:

- `rg` finds no imports of deleted custom platform modules;
- the TUI package has one renderer and one child-input encoder;
- the standalone binary runs after being moved away from the checkout;
- local smoke remains green after the default switch;
- no Stage 2 feature was added.

### Task 10: validation and Level 1 review

Run:

```sh
bun test packages/tui
bun test packages/backend/tests/services/pty-manager.test.ts
bun run lint
bun run typecheck
bun test
```

If the full suite encounters the already-recorded Task 22 or Task 23 failures,
reproduce them against the pre-rewrite base before attributing them to this
work. Do not fix them inside the rewrite.

Then perform one Level 1 review over the rewrite scope and directly affected
backend snapshot integration. Fix only substantiated findings, and use a
verification-only pass after fixes.

Final acceptance:

- Level 1 verdict is `Clear` or `Clear with non-blocking follow-ups`;
- changed behavior has automated evidence and local smoke evidence;
- the outer terminal is restored on every tested exit path;
- the new standalone artifact contains its native OpenTUI assets;
- remote smoke remains explicitly deferred rather than silently claimed.


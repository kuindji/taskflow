# Native macOS + libghostty — Spike Results

**Date:** 2026-06-26
**Status:** Spike complete. Both de-risking targets proven end-to-end.
**Recommendation:** **GO** on the native rewrite's *terminal & backend-bridge* foundation,
with one dependency caveat to retire (see Risks). The remaining open question is unchanged
and unrelated to the terminal: the **UI rebuild effort** (Monaco/markdown/dnd parity).
**Spike code:** `experiments/native-spike/` · **Spec:** `2026-06-26-native-macos-libghostty-viability.md`

## What the spike proved

A plain programmatic AppKit app (no `.xcodeproj`) embeds a libghostty terminal as one view
in a normal window, using the prebuilt `GhosttyKit.xcframework` from the community SwiftPM
package `libghostty-spm` **1.2.7** (Lakr233). No Zig toolchain, no building Ghostty from source.

### Goal 1 — embed libghostty + run a real agent (`.exec`) — ✅ PROVEN
- The `.exec` backend has libghostty **own the PTY and spawn the process** (matches viability
  decision D4 for live interactive sessions).
- It **GPU-renders a live, interactive `claude` session** inside the AppKit window
  (`evidence/01-exec-claude-live.png`): full Claude Code TUI — colors, box drawing, status line.
- **Keystroke input round-trips** libghostty → PTY → claude: a sent key advanced claude's UI
  (`evidence/02-exec-keystroke-input.png`).
- **Window resize reflows** the grid: enlarging the window re-laid claude's TUI to the new
  width (`evidence/03-exec-resize-reflow.png`).
- **`taskflow-cli` from inside the embedded terminal reached the backend over WS** — the marker
  `native-spike: hello from inside the libghostty .exec terminal` appeared in this task's backend
  log. The CLI contract is independent of where the PTY lives, exactly as the spec predicted.
  The spawned process inherits `TASKFLOW_API_URL` / `TASKFLOW_SESSION_ID` / `TASKFLOW_TASK_ID`
  from the app's env — the same vars `session-lifecycle.ts` injects.

### Goal 2 / Risk 3 — render a backend-owned session's stream (`.inMemory`) — ✅ PROVEN
- `libghostty-spm` exposes a **`.inMemory(InMemoryTerminalSession)`** backend — a true
  "bring-your-own-bytes" path. `session.receive(bytes)` pushes host bytes into the GPU surface
  (`ghostty_surface_write_buffer`); its `write` callback emits keystrokes and `resize` reports
  the grid. This is **exactly Taskflow's existing xterm.js stream model**.
- A ~130-line Swift `URLSessionWebSocketTask` client (`BackendWatch.swift`) connects to the
  backend (no auth — it upgrades on any path), requests `session:snapshot`, then streams
  `terminal:output`, feeding both into the `.inMemory` surface.
- It **rendered a real backend-owned session live, with full TUI fidelity**
  (`evidence/04-watch-inmemory-stream.png`) — the watch window mirrored the watched session's
  Claude Code TUI as bytes flowed backend PTY → WS → libghostty.

### The central finding: Risk 3 collapses to one render path (option "d")
The viability spec listed three awkward options for the watch case (a: vt+custom Metal renderer,
b: xterm.js island, c: static snapshot). The spike found a **fourth, better one, confirmed by
construction**:

> **(d) A single `.inMemory` libghostty surface renders both cases.** Interactive sessions feed it
> from a local PTY (or use `.exec`); watched backend sessions feed it from the WS `terminal:output`
> stream. Same renderer, same GPU path, no xterm.js island, no second renderer, no fidelity loss.

This removes the one genuinely awkward seam the assessment was worried about.

## Verified libghostty-spm API surface (1.2.7)

- Distribution: prebuilt `GhosttyKit.xcframework` (binaryTarget), macOS 13+ / iOS 15+. Products:
  `GhosttyKit` (C bindings), `GhosttyTerminal` (views/controller/in-memory), `GhosttyTheme`,
  `ShellCraftKit` (an in-process command-interpreter demo — **not** a PTY spawner; "no subprocesses
  are spawned").
- `AppTerminalView: NSView` — owns its `CAMetalLayer`; settable `delegate` / `controller` /
  `configuration`; `sendText(_:)`. SwiftUI `TerminalSurfaceView(context:)` also available.
- `TerminalSurfaceOptions(backend:fontSize:workingDirectory:context:)`.
- `TerminalSessionBackend`: `.exec` (`GHOSTTY_SURFACE_IO_BACKEND_EXEC`) or
  `.inMemory(InMemoryTerminalSession)` (`GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED`).
- `InMemoryTerminalSession(write:resize:)` with `receive(_:)`, `sendInput(_:)`, `readViewportText()`,
  `finish(exitCode:runtimeMilliseconds:)`.
- `TerminalController { $0.withCustom("command", …); $0.withFontSize(…) }` to set the spawned
  command and ghostty config keys.

## Backend contracts exercised (unchanged, no edits)

- Watch in: `session:snapshot` → `{snapshot, lastSequence, cursorHidden}`; events
  `{type:"terminal:output", payload:{sessionId, data /*UTF-8*/, sequence}}`.
- Control out: `session:input {sessionId,data}`, `terminal:resize {sessionId,cols,rows}`.
- WS server (`packages/backend/src/ws/server.ts`) upgrades on any path with **no auth/token** and
  broadcasts to all clients — trivial for a native client to consume on localhost.

## Snags hit (all minor)

- Swift 6 strict concurrency: top-level `main.swift` is nonisolated → wrap bootstrap in
  `MainActor.assumeIsolated`. `InMemoryTerminalViewport.columns/rows` are `UInt16` → cast to `Int`.
- No app-bundle / code-signing / Metal-entitlement issues: a bare SwiftPM executable
  (`swift build` does an "Applying" sign step) renders Metal and shows a window fine. The planned
  `.app`-wrapper fallback was **not needed**.

## Risks / conditions for committing

1. **Dependency is a community fork, not upstream.** The host-managed (`.inMemory`) backend —
   `GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED` + `ghostty_surface_write_buffer` — is a **patch in
   `libghostty-spm`'s vendored xcframework, not in upstream ghostty**. The whole Risk-3 win rides on
   it. Before committing: pin the version, vendor/mirror the xcframework, and budget for either
   tracking the fork or upstreaming/recreating the host-managed backend if it diverges. Upstream
   libghostty's own embedding API is also still "not stabilized."
2. **Unchanged from the assessment:** the **UI rebuild is the real cost** (Monaco, markdown,
   dnd-kit, Radix/Tailwind → SwiftUI). The spike deliberately did not touch this; it remains the
   decision driver. Terminal + backend bridge are no longer the risk.

## Bottom line

Both spike targets passed on the first real build. The terminal embeds cleanly, runs real agents,
keeps the `taskflow-cli`/WS contract intact, and — the key result — **one `.inMemory` render path
covers both interactive and watched sessions**, dissolving Risk 3. The native rewrite is
**technically de-risked on the terminal/backend axis**; the go/no-go now rests purely on appetite
for the UI rebuild, plus retiring the community-fork dependency risk.

## 1. Area summary

Taskflow runs real PTYs through Bun on Unix and a Node/node-pty bridge on Windows. Its [PTY manager](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:138) maintains an xterm headless model and serialized snapshots, including supplemental keyboard/mouse state. The [web terminal lifecycle](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:89) uses xterm with WebGL, Canvas fallback, and buffered snapshot/history attachment.

t3code also owns real PTYs, through [NodePtyAdapter.ts](t3code/apps/server/src/terminal/NodePtyAdapter.ts), but retains bounded output for replay rather than maintaining Taskflow-equivalent headless snapshots. Web and Electron use libghostty-vt WASM with a custom Canvas 2D renderer. Android uses native libghostty-vt plus Canvas; iOS uses a separate forked GhosttyKit renderer.

**Worth taking: two correctness techniques and the Ghostty implementation as a migration reference. No wholesale PTY-runtime replacement.**

## 2. Recommendations

1. **Recover immediately when terminal output is dropped. Effort M; reimplement the technique.**

   t3code’s [apps/server/src/terminal/OutputProtocol.ts](t3code/apps/server/src/terminal/OutputProtocol.ts:15) limits outstanding output, bounds subscriber queues, and resubscribes with a fresh snapshot after overflow. Its [client output buffer](t3code/packages/client-runtime/src/state/terminalOutput.ts:273) distinguishes incremental updates from replacement data.

   Taskflow’s [WebSocket broadcaster](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:43) skips terminal output above 1 MiB of backpressure, relying on the next terminal mount for recovery. Once history is loaded, [terminal-lifecycle.ts](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:240) writes incoming chunks without detecting sequence gaps. A slow remote client can therefore keep displaying an incomplete terminal until remount.

   Add an explicit resync signal or sequence-gap recovery, with bounded buffering while acquiring the replacement snapshot. Reuse Taskflow’s existing snapshot sequence machinery. This directly supports reliable PTY sessions; copying Effect RPC internals would add unnecessary cost.

2. **Suppress terminal replies during web history replay. Effort S; reuse Taskflow’s existing TUI pattern.**

   t3code temporarily detaches the PTY reply callback in [ghostty/core.ts, `resetAndWrite`](t3code/apps/web/src/terminal/ghostty/core.ts:362). Its server also strips historical query/response traffic in [terminal/Manager.ts](t3code/apps/server/src/terminal/Manager.ts:1090).

   Taskflow’s [history fallback](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:292) feeds raw history into xterm while [TerminalPane’s `onData`](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/TerminalPane.tsx:225) forwards generated data to the live PTY. A read-only headless-parser probe confirmed that replaying `CSI 6n` generates a cursor-position response. Historical queries can thus inject unsolicited replies into the current shell.

   The [TUI session bridge](/Users/kuindji/Projects/taskflow/packages/tui/src/opentui/session-bridge.ts:72) already suppresses responses during replay. Apply that invariant to web, keeping suppression active until asynchronous replay parsing finishes. This is ordinary terminal correctness and requires no agent integration.

3. **Use t3code for a bounded libghostty pilot, not an immediate migration. Effort M for pilot, L for complete replacement; selectively copy with MIT attribution.**

   The useful code is under `apps/web/src/terminal/ghostty/`: [runtime.ts](t3code/apps/web/src/terminal/ghostty/runtime.ts), [core.ts](t3code/apps/web/src/terminal/ghostty/core.ts), [renderer.ts](t3code/apps/web/src/terminal/ghostty/renderer.ts), and [surface.ts](t3code/apps/web/src/terminal/ghostty/surface.ts). These adapters avoid Effect, although the browser surface has app-specific dependencies.

   Concrete advances over the migration watch’s earlier candidate:

   - [build-libghostty-wasm.sh](t3code/apps/web/scripts/build-libghostty-wasm.sh) builds pinned upstream revision `9f62873…` with Zig 0.15.2. The checked-in WASM is 630,932 bytes, plus a 112-byte reply trampoline.
   - Rendering uses Ghostty RenderState dirty rows, addressing the expensive full-viewport extraction concern. Drawing remains Canvas 2D, with no demonstrated throughput advantage over Taskflow’s WebGL renderer.
   - Runtime struct layouts come from `ghostty_type_json`. Preserve its WebKit callback-table workaround: grow the table, then call `table.set`.
   - Vite packages WASM as assets; Electron serves those client assets and permits WASM compilation. Desktop does not use the native iOS renderer.

   I successfully loaded the artifact and replayed a small xterm serialized snapshot containing ANSI color, CJK, and emoji, preserving its text. That supports initially retaining Taskflow’s backend serializer. It does **not** establish complete state compatibility.

   The adapter is roughly 4,300 TypeScript lines and is not xterm-compatible. Porting links, shortcuts, selection, IME, sizing, and lifecycle behavior is substantial work. Its [existing regression tests](t3code/apps/web/src/terminal/ghostty/core.test.ts) are valuable acceptance-case references.

## 3. Considered and rejected

- **Wholesale Effect process/background infrastructure.** Taskflow already has PTY ownership, batching, persistence ordering, shell detection, and login-shell PATH recovery. No demonstrated benefit justifies replacing them.
- **Another bounded-history implementation.** Taskflow already performs [bounded history-tail reads](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:838).
- **Native Ghostty as an Electron renderer replacement.** [iOS custom I/O](t3code/apps/mobile/modules/t3-terminal/ios/T3TerminalView.swift:523) depends on a forked native framework. Android requires its own drawing adapter. Neither supplies Electron GPU rendering.
- **Automatically adopting smallest-viewer sizing.** t3code’s [shared grid policy](t3code/apps/server/src/terminal/Manager.ts:1741) would let a small client shrink the desktop terminal. Taskflow needs an explicit sizing-ownership decision first.

## 4. Uncertainties

Assessment covers the supplied checkout. I did not rebuild native artifacts, run GUI/device tests, or benchmark sustained output. Complete snapshot fidelity, accessibility, and agent keyboard/mouse compatibility remain unverified. No files were modified.


# native-spike

Throwaway de-risking spike for the **native macOS + libghostty** viability
assessment (`docs/superpowers/specs/2026-06-26-native-macos-libghostty-viability.md`).
Nothing here ships — it exists to prove (or disprove) two unknowns before any
implementation plan. Findings: `docs/superpowers/specs/2026-06-26-native-macos-libghostty-spike-results.md`.

## What it is

A plain programmatic AppKit app (no `.xcodeproj`, no storyboard) that embeds a
libghostty terminal surface as **one view in a normal window**, via the
prebuilt `GhosttyKit.xcframework` from the community SwiftPM package
[`libghostty-spm`](https://github.com/Lakr233/libghostty-spm) (1.2.7).

Two modes:

| Mode | Backend | Proves |
|------|---------|--------|
| **exec** (default) | `.exec` — libghostty owns the PTY & spawns the process | Goal 1: GPU render + run real `claude` + input/resize + `taskflow-cli`→backend over WS |
| **watch** | `.inMemory` — host feeds bytes | Goal 2 / Risk 3: render a backend-owned session's WS `terminal:output` stream |

## Run

Requires: Xcode 26 / Swift 6, macOS 13+, and (for the integration bits) a
running Taskflow backend whose env (`TASKFLOW_API_URL`, `TASKFLOW_SESSION_ID`,
`TASKFLOW_TASK_ID`) is present in the launching shell — i.e. launch it from a
Taskflow session.

```sh
swift build

# Phase 1+2 — interactive libghostty terminal, spawns claude, logs to backend:
./.build/debug/NativeSpike

# Phase 3 — watch a backend-owned session (defaults to $TASKFLOW_SESSION_ID):
NATIVE_SPIKE_MODE=watch ./.build/debug/NativeSpike
# or watch a specific one:
NATIVE_SPIKE_WATCH_SESSION=<session-id> NATIVE_SPIKE_MODE=watch ./.build/debug/NativeSpike
```

## Files

- `Sources/NativeSpike/main.swift` — NSApplication bootstrap.
- `Sources/NativeSpike/AppDelegate.swift` — window + embedded surface; exec & watch modes.
- `Sources/NativeSpike/BackendWatch.swift` — minimal `URLSessionWebSocketTask` client
  that feeds the backend's `session:snapshot` + `terminal:output` stream into an
  `InMemoryTerminalSession`.
- `evidence/` — screenshots captured during the spike.

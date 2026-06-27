# Phase 2 (Foundations) — Results & Acceptance Note

**Date:** 2026-06-27
**Plan:** `docs/superpowers/plans/2026-06-27-phase2-foundations.md`
**Master plan:** `docs/superpowers/specs/2026-06-26-native-rewrite-master-plan.md`
**Status:** ✅ **Phase 2 complete.** Phase 3 (structural spine) is unblocked.

This note records what each Phase 2 unit proved, the integration evidence, the test
count, and the carry-forwards that Phase 3+ must keep in mind.

---

## What each unit proved

- **2.1 Project + build (Tasks 1–2).** A SwiftPM target builds a launchable
  `Taskflow.app` on macOS 13+ under Swift 6 mode, with exact dependency pins and a
  bundling script. Evidence: `evidence/01-empty-window.png`, `evidence/02-app-bundle.png`.

- **2.2 Backend sidecar launch (Task 8).** `SidecarManager` spawns the backend
  (packaged binary, or dev `bun run packages/backend/src/index.ts` when
  `TASKFLOW_REPO_ROOT` is set), reads the port via the temp port-file handshake,
  runs a `system:info` health-check, and tears the process down on `stop()`.
  Evidence: `evidence/03-sidecar-connected.png`.

- **2.3 Type + theme codegen / D3 (Tasks 3–6).** `bun native/scripts/codegen/generate.ts`
  reads `packages/shared` and emits the **entire** surface: `MessageType` from `MSG`,
  Codable structs + string-union enums, discriminated unions (tagged + key-presence
  XOR), 14 baked themes → `AppTheme` / `ThemeStore`, and the ANSI → libghostty color
  mapping. Output is committed and reproducible (no hand edits to `Generated/`).

- **2.4 Production WS client (Task 7).** `WSClient` does typed correlationId RPC,
  broadcast subscriptions (`on`), a cancellable 30s timeout, fail-fast on socket drop,
  and exponential-backoff reconnect.

- **2.5 `ui/` primitives kit (Task 9).** Themed Button/Toggle/Badge/TextField/
  SegmentedTabs/Menu driven by `\.appTheme`, exercised by `PrimitivesGallery`.
  Evidence: `evidence/05-gallery-default.png`, `evidence/06-gallery-dracula.png`.

- **Integration / acceptance (Task 10).** `AppEnvironment` is the composition root:
  it owns the sidecar lifecycle + WS client, publishes connection `Status`, and on
  `boot()` performs a real round-trip beyond the health check (`task:list`). `TaskflowApp`
  hosts `RootView` (status bar + gallery), superseding the Task 9 temporary
  `PrimitivesGallery` root. Evidence: `evidence/07-phase2-integration.png`.

---

## Integration smoke evidence (Task 10)

- Launched: `swift build && TASKFLOW_REPO_ROOT="$(cd .. && pwd)" ./.build/debug/Taskflow &`
- Window showed the status bar **"Backend connected (port 0)"** above the themed
  primitives gallery (captured at the Catppuccin Mocha theme).
- Log line observed: `Phase2 smoke: task:list returned 0 tasks`.
- Screenshot: `native/evidence/07-phase2-integration.png`.

> **N = 0 is the pass condition here.** The sidecar is sandboxed (see below) and runs
> against a fresh, isolated data dir with ~0 tasks. The round-trip is verified by a
> clean decode of `{tasks:[...]}` (count ≥ 0) plus the NSLog line — **not** by matching
> the host app's task count. Seeding the sandbox is optional and was not done.

- Cleanup: the launched app PID was terminated; the dev sidecar (`bun run
  .../worktrees/build-native-app-experiment/packages/backend/src/index.ts`) was then
  confirmed orphaned (SIGTERM does not run SwiftUI `onDisappear`/`shutdown`) and was
  killed directly after positively confirming its worktree/dev command path. The host
  app (`/Applications/Taskflow.app`) and its processes were left untouched.

---

## Test results

- `swift test`: **24 XCTest cases, 0 failures** (MessageType, ModelDecode, UnionDecode,
  Theme, WSCodec, WSClient, SidecarSupport) + 1 swift-testing placeholder suite.
- `bun test native/scripts/codegen/generate.test.ts`: **7 pass, 0 fail.**
- `swift build`: clean (the `TreeSitter*` "unable to open object file" lines come from
  the pinned-but-unwired CodeEdit editor dependency; they are pre-existing and harmless).

---

## Carry-forwards (for Phase 3+)

- **Sandbox safety (commit 7891c3a).** `SidecarManager` spawns the backend with
  `HOME=~/.taskflow-native-dev` + `TASKFLOW_DEV=1`, so it uses an **isolated**
  `~/.taskflow-native-dev/.config/taskflow` data dir, not the user's real one. The
  Task 10 smoke therefore ran against a **fresh sandbox dir** (hence N=0).
  **Never set `TASKFLOW_NATIVE_PROD_DATA`** in dev/test.

- **`Task` → `TaskItem` name-shadow resolution (this task).** The generated model
  `Task` shadowed `_Concurrency.Task`. Resolved permanently via a **codegen reserved-name
  remap**, not a hand-edit: `RESERVED_TYPE_REMAP` in `native/scripts/codegen/lib/swift.ts`
  (`Task` → `TaskItem`), applied to both declarations (`renderInterface`,
  `renderStringUnionAlias`) and references (`swiftType` known-ref path; tagged-union
  member refs in `lib/unions.ts`), then regenerated. `TaskItem` matches the name
  Phase 1's slice used. The change touched exactly two generated lines
  (`struct TaskItem` in `TaskTypes.swift`; `let tasks: [TaskItem]` in `WsTypes.swift`).
  Concurrency `Task` usages (qualified as `Swift.Task` in `WSClient.swift`) are
  unaffected — verified by a clean build. New TS interfaces that collide with Swift
  symbols should be added to this remap rather than hand-edited.

- **Unions resolved by fallback need confirmation against `agent.ts`.** Tagged unions
  are resolved by reading each member interface's `type` discriminant literal; unions
  whose members lack a resolvable `type` field fall back to `AnyCodable` (several files
  still carry `AnyCodable` fields/aliases: Ws, Settings, Schedule, Flow, Agent types).
  Before Phase 3+ consumes agent-launch / flow unions as typed enums, confirm the
  discriminants against `packages/shared/src/types/agent.ts` (e.g. `AgentLaunchOptions`
  is resolved and unit-tested; verify the remainder).

- **`rgba(...)` CSS vars are handled.** Derived themes emit `--island-base` as
  `rgba(r, g, b, a)`. `Color(hex:)` (`Theme/AppTheme.swift`) has an explicit `rgba(...)`
  parse branch, so these are parsed correctly — **no outstanding gap** here.

- **Editor/terminal deps pinned but unwired (Phase 4).** CodeEditTextView /
  CodeEditLanguages (TreeSitter*) and the libghostty terminal are pinned in
  `Package.swift` but not yet wired into any view; they land in Phase 4. Their build
  warnings are expected noise until then.

- **Task 9 minors.** `AppMenu` uses `.menuStyle(.borderlessButton)`, which is
  deprecated on newer macOS — revisit when raising the deployment target / polishing.
  `AppMenu` also has no Popover/Sheet wrappers yet; add them when a consumer needs them.

---

## Acceptance

All Phase 2 units (2.1–2.5) plus the integration acceptance gate are green: the app
boots, spawns and connects to the sandboxed sidecar, performs a real typed WS
round-trip, and renders the themed primitives gallery. **Phase 2 is complete; Phase 3
(structural spine) is unblocked.**

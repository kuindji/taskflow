# Native macOS Rewrite — Master Plan

**Date:** 2026-06-26
**Status:** Roadmap. Phases 0 done, Phase 1 next and gated. Phases 2–6 are conditional on the Phase 1 GO/NO-GO and are **not greenlit to build**.
**Inputs (read these for detail):**
- `2026-06-26-native-macos-libghostty-viability.md` — assessment + decisions D1–D4.
- `2026-06-26-native-macos-libghostty-spike-results.md` — terminal + backend PROVEN.
- `2026-06-26-swiftui-ui-rebuild-scope.md` — UI rebuild scope (31.8k LOC / 197 files).

## Framing

- **Execution model: AI-agent-driven.** Every phase decomposes into self-contained, independently
  verifiable units, each authorable as a Taskflow task/flow. Units carry their own verification
  criteria so an agent can confirm "done" without cross-unit context.
- **Cutover: big-bang at parity.** The native app stays internal until it matches the Electron app
  feature-for-feature, then replaces it in one switch. No incremental dual-ship to end users.
- **Honest gate.** This is exploration. Phase 1 ends in a GO/NO-GO. Phases 2–6 only exist if GO.
- **End state: cutover.** The plan ends when native replaces Electron at parity. The native-feel
  payoff (rich notifications, menu-bar extras, dock/Spotlight integration, window-state restoration)
  and formal Electron retirement (removing `dist:win`, Electron deps, dual-maintenance) are
  **follow-on, out of scope here**.

### Decisions carried from the assessment (unchanged)

| # | Decision |
|---|----------|
| D1 | macOS-only; drop Windows builds. |
| D2 | Backend stays a sidecar (compiled Bun binary); Swift app talks to it over the existing WS API. No backend/CLI rewrite. |
| D3 | Preserve type integrity via codegen: Swift structs from `@taskflow/shared`; load `shared/themes/bundled/*.json`. |
| D4 | Hybrid PTY ownership: backend owns headless/scheduled PTYs; app (libghostty) owns live interactive PTYs. |

## Phase dependency graph

```
Phase 0 (DONE) ─► Phase 1 ─►[GATE]─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 6 (cutover)
                                          │          │          │
                                          └──────────┴──────────┴─► Phase 5 (breadth, parallel)
```

Phase 2 is wide (parallel units). Phase 3's two long poles unblock Phase 4 (panes) and Phase 5
(breadth). Phase 5 fans out across independent agents once the spine + primitives exist. Phase 6
gates the cutover on a parity audit against a frozen snapshot.

---

## Phase 0 — De-risking spike ✅ DONE

Baseline; recorded for completeness. Proven in `experiments/native-spike/` (commit `2ebe1f3`):

- libghostty embeds in a normal AppKit window, GPU-renders a live interactive `claude` (`.exec`),
  with working input / resize, and `taskflow-cli` inside it reaches the backend over WS.
- `.inMemory(InMemoryTerminalSession)` renders a real backend-owned session fed by a Swift
  `URLSessionWebSocketTask` → **one render path covers interactive + watched** (Risk 3 collapsed).

**Outcome:** terminal + backend axis fully de-risked. The remaining unknown is the UI rebuild.

---

## Phase 1 — UI vertical-slice spike + GO/NO-GO gate  ⟵ NEXT (gated)

Prove the *UI* integration the way the terminal was proven: one thin vertical slice through the
hardest seams, plus retiring the two open dependency risks. **No production breadth.** Output is the
commit-or-not signal for the entire rewrite.

| Unit | Work | Verify |
|---|---|---|
| 1.1 Vendor/pin libghostty fork | Vendor `libghostty-spm` 1.2.7 (or pin commit); document the `GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED` fork patch as an owned dependency. | Builds from a pinned source we control; no floating upstream ref. |
| 1.2 Pick + vendor native editor dep | Decide CodeEditSourceEditor vs STTextView+tree-sitter vs Highlightr floor; vendor/pin the choice. | A SwiftUI editor view renders a TS file with syntax highlighting + find/replace. |
| 1.3 App shell slice | `HSplitView` shell + sidebar **task list bound to real WS data**. | Live task list from the running backend; selecting a task drives the workspace. |
| 1.4 Workspace slice | One task workspace = a **tabbed split** hosting a libghostty terminal pane AND the native editor pane. | Split resizes; tabs switch; both panes live simultaneously in one window. |
| 1.5 Swift WS store layer | A real (not throwaway) store/view-model feeding the slice over WS (productionize `BackendWatch.swift`'s transport seam). | Store survives reconnect; updates flow to the views reactively. |
| 1.6 GO/NO-GO writeup | Assess: did split/tabs/drag + store→view-model + WS transport + native editor + theming hold up together? | A spec recording GO or NO-GO with evidence; if GO, confirms Phases 2–6 are greenlit. |

**This phase is the gate.** Nothing below proceeds without an explicit GO.

`════════════════════════ GO / NO-GO ════════════════════════`

---

## Phase 2 — Foundations (wide; parallelizable)

Scaffolding everything else depends on. Units are mutually independent except where noted.

| Unit | Work | Verify |
|---|---|---|
| 2.1 Project + build | Xcode/SwiftPM app target; macOS 13+; CI build. | `swift build` / archive produces a launchable `.app`. |
| 2.2 Backend sidecar launch | Bundle + spawn the compiled Bun backend (D2); health-check + lifecycle. | App boots, starts the sidecar, connects over WS; clean shutdown. |
| 2.3 Type + theme codegen (D3) | Build-time TS→Swift structs from `@taskflow/shared/types`; load `shared/themes/bundled/*.json`; map 42 CSS vars → `AppTheme`; feed ANSI colors to libghostty. | Generated Swift compiles; a bundled theme round-trips to `AppTheme`; codegen runs in the build. |
| 2.4 Production WS client | Generic client: correlationId RPC + broadcast + 30s timeout + exp-backoff reconnect (productionized from 1.5). | RPC call resolves/*times out*; broadcast subscribers fire; reconnect recovers after a backend bounce. |
| 2.5 `ui/` primitives kit | App-styled native kit (Button, Toggle, Menu, Sheet, Popover, inputs, tabs, tooltips, badges). **Do first within Phase 2** — Phases 3–5 depend on it. | A primitives gallery view renders every component themed via `AppTheme`. |

## Phase 3 — Structural spine (the two long poles)

| Unit | Work | Verify |
|---|---|---|
| 3.1 Store → view-model layer | Reimplement domain logic as `@Published` view models: session/task/project/flow/search/file/theme + helpers (~2,400 LOC portable). Mind module-level event registration + the stable-selector equivalent (Zustand reactivity gotcha). | Each store drives a smoke view from live WS data; reconnect + selector stability verified. |
| 3.2 App shell | 6-pane `AppShell` layout via native split. | Panes lay out, resize, and persist; matches the Electron pane map. |
| 3.3 Workspace split + tabs + drag | Split container (`NSSplitView`/`HSplitView` — free resize), tab bars, **draggable tabs**. The structural heart. | Tabs reorder via drag; splits persist; panes host arbitrary content. |

## Phase 4 — Panes (depends on Phase 3)

| Unit | Work | Verify |
|---|---|---|
| 4.1 Terminal pane | Productionize the spike: `.exec` interactive + `.inMemory` watched, theming, focus/key-routing. | Interactive agent runs; a watched scheduled session renders the streamed bytes. |
| 4.2 Native code editor + diff | Editor view (dep from 1.2): syntax highlight, save, go-to-line, read-only diff viewer. | Edits save; diff renders; theming applied. |
| 4.3 Cmd+click import-open | Reuse specifier regex from `monaco-import-navigation.ts`; call backend `TS_RESOLVE_IMPORT`; open file. | Cmd+click on an import opens the resolved file. Known accepted loss: same-file local go-to-definition. |
| 4.4 Browser pane | The one real `WKWebView` (genuine web content). | Loads URLs; integrates with workspace tabs. |
| 4.5 Changes + Markdown panes | Native diff (changes); plain word-wrapped `NSTextView`/`TextEditor` for markdown. | Changes pane shows git diff; markdown renders as wrapped text. |

## Phase 5 — Feature-area breadth (fan-out; depends on 2.5 + 3.x)

The ~60% of effort: individually easy, collectively the bulk. Each is an independent agent unit.

| Unit | Area | SwiftUI approach |
|---|---|---|
| 5.1 | Sidebar (task/project list, **drag-reorder**, notifications, toolbar) | `List`/`OutlineGroup` + `.draggable`/`.dropDestination` + `Menu`. |
| 5.2 | Panels (file tree + git-status colors + context menu; search/replace) | `OutlineGroup` + context menus; results list. |
| 5.3 | Flows (flow editor, management, action editor) | Forms + lists. |
| 5.4 | Settings (multi-tab modal, model selects, agent options) | `TabView`/`Form` + `Picker`s; reuse `shared/` fragments. |
| 5.5 | Schedules (form + helpers) | Forms. |
| 5.6 | Shared per-agent option fragments | Reusable views across settings/run menus. Each agent's options mirror its real CLI flags. |
| 5.7 | Appearance (theme grid/cards, fonts, import) | `LazyVGrid` of swatches. |
| 5.8 | Command palette + shortcuts dialog + dialog host | Custom fuzzy overlay; shortcuts sheet. |
| 5.9 | Icons | Asset catalog; lucide → SF Symbols (~57 icons, ~95% direct map). |

## Phase 6 — Parity hardening + cutover

| Unit | Work | Verify |
|---|---|---|
| 6.1 Freeze parity snapshot | Pin a `packages/ui` commit as the parity target; enumerate the parity checklist. | A written checklist tied to a specific Electron build. |
| 6.2 Parity audit | Keyboard shortcuts, focus rings, resize persistence, context menus, Metal↔SwiftUI key-routing + unified theming. | Every checklist item passes against the frozen snapshot. |
| 6.3 Regression dogfood | Drive the native app through real task/project/flow/schedule/session workflows. | No parity gaps blocking daily use. |
| 6.4 Cutover | Native becomes the shipped macOS app; drop `dist:win` (D1). | Native is the default macOS artifact; Windows target removed. |

> Follow-on (out of scope here): native-feel payoff (notifications, menu bar, dock/Spotlight,
> window-state restoration) and formal Electron retirement (remove Electron deps + dual-maintenance).

## Cross-cutting concerns

- **Scope freeze.** `packages/ui` keeps evolving; a long rewrite chases a live codebase. Freeze to
  the Phase 6.1 snapshot and reuse the backend so behavior stays shared.
- **Community-fork dependency posture.** `libghostty-spm` (host-managed patch, not upstream) and the
  native editor dep are both pre-production. Vendor/pin both (Phase 1.1/1.2); track upstream.
- **Two render worlds.** libghostty (Metal) + SwiftUI in one window — unify focus, theming, and
  key-routing; this is a recurring audit item, not a one-time task.

## Open risks (per phase)

1. **Phase 1 NO-GO.** The slice is explicitly allowed to kill the project; that is the point.
2. **Phase 5 breadth fatigue.** No single screen is hard; ~12 areas + dozens of dialogs. Dominant
   risk is sustained volume and parity drift — mitigated by agent fan-out + the frozen snapshot.
3. **Editor dep maturity.** Pre-production; accept vendoring/tracking, or fall back to the
   Highlightr floor. Losing same-file go-to-definition is a known minor trade.
4. **Parity is a moving target.** Mitigated by the scope freeze (6.1) and backend reuse (D2).

## Bottom line

The path is: prove the UI slice (Phase 1) → decide → if GO, lay foundations and the spine, then
fan out panes + breadth across agents → harden to parity → cut over. The hard unknowns (terminal,
backend, editor-as-island) are already retired; the remaining cost is breadth, and the remaining
decision is the Phase 1 gate.

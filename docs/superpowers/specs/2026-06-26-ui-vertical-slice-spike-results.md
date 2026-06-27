# UI Vertical-Slice Spike — Results & GO/NO-GO

**Date:** 2026-06-26 (executed 2026-06-26→27)
**Status:** Decision record. This is the **gate** for the native rewrite (master plan Phases 2–6).
**Inputs:** `2026-06-26-native-rewrite-master-plan.md` (Phase 1), `2026-06-26-phase1-ui-vertical-slice-spike.md` (the executed plan).
**Subject:** `experiments/native-slice/` — a thin native macOS SwiftUI app built to prove the *UI* integration the way the Phase 0 spike proved the terminal.

## What was built

A new SwiftPM app (`experiments/native-slice/`, leaving the Phase 0 `native-spike/` intact) executed as 9 tasks via subagent-driven development (fresh implementer + independent code review per task, fixes re-verified). Commits `1a3b79d` → `f8163f3` on `task/build-native-app-experiment`.

The slice exercises every hard Phase 1 seam end-to-end against the **live** Taskflow backend:
- **App shell** — `HSplitView` with a sidebar + workspace.
- **Live data** — a Swift WS store layer (codec → generic `WSClient` → `TaskStore`) loading real tasks over the existing backend WS API.
- **Workspace** — a tabbed split with draggable tabs hosting two panes.
- **Terminal pane** — a libghostty `.exec` GPU surface wrapped in `NSViewRepresentable`.
- **Editor pane** — `CodeEditSourceEditor` (native, tree-sitter) loading a real file.

## Evidence (all visually verified by the controller)

| Evidence | Shows |
|---|---|
| `evidence/01-live-sidebar.png` | Sidebar filled with **6 real backend tasks** (titles match a direct `task:list` WS probe), status dots, "Tasks (6)" header, resizable divider. |
| `evidence/02-workspace-tabs-split.png` | Selected task → "Terminal"/"Editor" tab strip, active pane + info pane, nested resizable splits. |
| `evidence/03-terminal-pane-live.png` | **Live GPU-rendered Claude Code session** (v2.1.193, Opus 4.8) running inside the Terminal tab — libghostty Metal surface co-existing with SwiftUI in one window. |
| `evidence/04-editor-pane.png` | `WorkspaceView.swift` in the Editor tab with **tree-sitter Swift syntax highlighting**, line-number gutter. |

The unit-testable core (WS codec, WSClient correlation/timeout/fan-out, TaskStore reducers) ships with **11 passing tests**, TDD-authored (RED→GREEN evidenced per task). UI/GPU panes were verified by build + launch + screenshot (no fabricated unit tests around AppKit/Metal).

## Per-seam verdict

| Seam | Verdict | Notes |
|---|---|---|
| **Workspace split / tabs / drag** | **Smooth** | `HSplitView` gives resizable panes free; tab reorder via `.onDrag`/`.onDrop` works. One real bug found+fixed in review: drag-drop computed `@State` indices off the main thread (`0c569b0`). |
| **Store → view-model + WS transport** | **Smooth** | `BackendWatch.swift`'s transport seam productionized into a generic `WSClient` (correlationId RPC, 30s timeout, exp-backoff reconnect, event fan-out with unsubscribe). `@MainActor` isolation makes the resolve-then-fire path race-free (no double-resume). `TaskStore` loads + live-upserts from `task:created`/`task:updated`. One idempotency guard added in review (`1ee8bde`). |
| **libghostty ↔ SwiftUI (two render worlds)** | **Smooth (with one gotcha retired)** | The `.exec` surface from Phase 0 lifted cleanly into `NSViewRepresentable`; `TerminalViewState` retained via the Coordinator (correct lifetime). **Gotcha found+fixed:** a manual `NSApplication.shared` call in `main.swift` *before* `App.main()` broke `NSHostingView` autoresizing (content pinned to the bottom); the fix was to let SwiftUI own the lifecycle (`@main`, activation policy in `init()`) — commit `0335c4d`. Worth recording for Phase 2/3. |
| **Native editor maturity** | **Friction (integrates; rough edges confirmed)** | `CodeEditSourceEditor` renders a real file with tree-sitter highlighting, but its 0.12.0 API is pre-production and undocumented in places (see below). Integrates and works; not turnkey. |

## Dependency-risk retirement

| Dep | Pin | Outcome |
|---|---|---|
| `libghostty-spm` (community fork; host-managed-backend patch not upstream) | **exact `1.2.7`** | Resolved + linked first try (prebuilt `GhosttyKit.xcframework`, no Zig). `.exec` GPU render works in the slice. Risk unchanged from Phase 0: still a community fork to vendor/pin. |
| `CodeEditSourceEditor` | **exact `0.12.0`** (+ explicit `CodeEditTextView 0.10.1` pin) | **Capped at 0.12.0 for SwiftPM CLI builds.** 0.13.0+ fail under `swift build` on an upstream `CodeEditSymbols` `Bundle.module` xcassets bug (Xcode-only resource). A transitive `CodeEditTextView` range forced an explicit `exact` pin to keep resolution stable. This is a real maturity signal — manageable, not free. |

## Friction log (the editor, specifically)

The brief's illustrative editor API was wrong against the real 0.12.0; the actual API:
- `cursorPositions` is `Binding<[CursorPosition]>` (an **array**, not a `Set`).
- `showMinimap: Bool` is a **required** (non-defaulted) parameter.
- **No `EditorTheme.standard`** — a theme must be built with all 16 explicit `Attribute` fields (token colors are light-mode-only; dark-mode contrast would need appearance-conditional colors in production).
- **`updateNSViewController` does not push text-binding changes into the controller** — text is read once at `makeNSViewController`. The slice works around this by loading the file synchronously in `EditorPane.init` so `@State` is seeded at construction. Fine for read/open; a production editor that swaps files in-place will need a deeper fix (or a different editor seam).

None of these blocked integration; all are documented rough edges of a pre-production dependency. They reinforce the master plan's standing posture: **vendor/pin the editor dep, keep the Highlightr/STTextView fallbacks in reserve.**

## What this did NOT prove (honest scope limits)

- **Panes are not task-scoped.** The Terminal pane uses a static CWD and the Editor pane a hardcoded file path — both are independent of the selected task (only the sidebar + info pane react to selection). The evidence proves the panes *render inside the workspace shell* (libghostty-in-SwiftUI, native editor, split/tabs/drag), **not** that pane content *reflects task selection*. Task-routing is deferred breadth, not a Phase 1 target — so GO must not be read as "task-scoped panes proven."
- **Swift 6 strict concurrency was not build-enforced.** `Package.swift` is `swift-tools-version:5.9` with no v6 language mode / `StrictConcurrency` flag, so the toolchain checked in Swift 5 mode. The code is `@MainActor`-consistent by construction (and the final review confirmed the WSClient→TaskStore→SwiftUI chain is genuinely race-free), but strict mode was not the gate. Decide early in Phase 2 whether to enable v6 mode or accept the gap knowingly.
- **Keystroke input / focus routing** between the libghostty Metal surface and SwiftUI was not verified end-to-end (screenshots can't show typing). Phase 0 proved input round-trips in a pure-AppKit host; re-confirming it under SwiftUI focus management is an early Phase 3/4 item.
- **Drag-reorder** correctness is by code review + logic analysis, not runtime (static screenshots can't show a drag).
- **`.inMemory` watched-session path** was not re-exercised here (Phase 0 proved it); the slice used `.exec` only.
- **Terminal session persistence across tab switches** is not handled — switching tabs tears down and re-spawns the `.exec` process. A production workspace must keep panes alive behind the tab strip (Phase 4 item).
- Breadth (the ~12 feature areas) is untouched by design — that is the known long pole, not a de-risking target.

## Decision: **GO** — confirmed by product owner (2026-06-27)

> The product owner reviewed this record and **confirmed GO on 2026-06-27**. Master-plan Phases 2–6 are
> now greenlit. The branch `task/build-native-app-experiment` is kept as-is (no merge/PR) — it remains the
> home of the planning specs + the `native-slice/` evidence.


Every hard Phase 1 seam held up together in one running native window driven by the real backend: the structural spine (split/tabs/drag), the Swift store→view-model + WS transport, the libghostty↔SwiftUI two-render-worlds boundary, and a native editor — with no blocker. The bugs found were ordinary and fixed in the review loop; the one architectural gotcha (lifecycle/autoresizing) is now understood and documented. The editor dependency is rough but integrates, and the fallbacks remain. This is the true commit-or-not signal the master plan asked for, and it points to **GO**.

**If GO is confirmed by the product owner, master-plan Phases 2–6 are greenlit**, carrying these forward:
1. SwiftUI must own the app lifecycle (no manual `NSApplication` before `App.main()`); fill frames on `HSplitView` panes.
2. Vendor/pin `libghostty-spm 1.2.7` and `CodeEditSourceEditor 0.12.0`; track the upstream `Bundle.module` fix that would lift the editor version cap.
3. Re-verify libghostty↔SwiftUI **keyboard focus/key-routing** as an early, explicit Phase 3/4 task.
4. Treat the editor's in-place file-swap limitation as a Phase 4 design item (init-seed works for open/read; swapping needs more).

The final call on GO/NO-GO is the product owner's — this record is the evidence behind the recommendation.

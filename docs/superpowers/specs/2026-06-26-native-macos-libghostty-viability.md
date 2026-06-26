# Native macOS Rewrite with libghostty — Viability Assessment

**Date:** 2026-06-26
**Status:** Exploration / decision record. No implementation plan yet.
**Next step:** De-risking spike (see "Spike plan"), to be done in a separate worktree.

## Goal

Assess viability of rewriting Taskflow as a genuinely native macOS app (Swift/AppKit/SwiftUI),
using **libghostty** as the embedded terminal.

### Motivations (in priority order, per product owner)

1. **Native feel & integration** — real AppKit/SwiftUI, macOS conventions, window/menu/notification integration.
2. **Terminal quality** — best-in-class GPU-rendered terminal.
3. **Performance / footprint** — shed Electron overhead.

Distribution/maintenance was *not* a primary driver.

These motivations rule out a WKWebView wrapper (e.g. Tauri): that wins footprint but delivers
neither native feel nor a GPU libghostty terminal. The target is a genuine Swift/AppKit app.

## Decisions taken

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Platform: macOS-only.** Drop Windows builds (`dist:win*`). | Full commitment to native; Windows is not a target audience. |
| D2 | **Backend stays as a sidecar.** Keep the existing Bun backend (compiled `build:bin`); the Swift app talks to it over the same WS API. Do **not** rewrite the backend or the `taskflow-cli` protocol. | Backend (~20.6k LOC) carries hard-won PTY/env/PATH gotchas, file watching, ripgrep, scheduler, and the CLI WS contract that spawned agents depend on. Rewriting it is large risk for a layer that already works. |
| D3 | **Preserve type integrity via codegen.** Generate Swift structs from `@taskflow/shared/types`; load `shared/themes/bundled/*.json` directly. | A Swift UI loses TS's compile-time agreement across the WS boundary. Codegen keeps a single source of truth (TS) and pays only a build step. `@taskflow/shared` is ~2k LOC and bounded. |
| D4 | **Hybrid PTY ownership.** Backend keeps owning **headless / scheduled** sessions (node-pty, unchanged). The **app** owns PTYs for **live interactive** sessions (libghostty spawns the agent CLI). | Reconciles libghostty's PTY model (see "The libghostty catch") with Taskflow's need for unattended background/scheduled runs. |

## The libghostty catch (central finding)

There are **two** libghostty libraries, and Taskflow's architecture falls in the gap between them:

| | **libghostty-vt** (becoming stable/public) | **Full libghostty** (what shipping apps use) |
|---|---|---|
| Scope | VT parsing, terminal + render *state*, input encoding | App + surface + **Metal rendering** + PTY/process mgmt |
| Rendering | **None** — you write your own renderer | **Yes** — owns NSView + CAMetalLayer, GPU draws for you |
| PTY model | **You own the PTY**, feed bytes via `ghostty_terminal_write()` | **libghostty owns the PTY**, spawns the child itself |
| C API status | Documented; C API "coming soon"; tagged release targeted; explicit "public alpha, no stability" | Exists/ships, but "not yet stabilized for general-purpose embedding; may change between releases" |

The full rendering surface (`ghostty_surface_config_s`) exposes only `command`,
`working_directory`, `env_vars`, `initial_input`, `wait_after_command`. **There is no field to
attach an external PTY fd and no raw-byte `write` into the rendered surface.** libghostty owns
the PTY lifecycle and shell integration internally.

**Why this bites Taskflow specifically:** today the backend (`node-pty`) owns *all* PTYs and
streams bytes over WS; the UI (xterm.js) is a pure renderer of that stream. That is exactly the
"bring your own bytes" model — which the *rendering* libghostty does not support. Every shipping
native libghostty terminal app (Kytos, Termini, conterm, fantastty, …) lets libghostty own the
PTY, because a terminal app *is* the thing spawning the shell. Taskflow is not.

### Current code seam (verified)

`scheduler-service.ts` and interactive launches both call `spawnSession` →
`session-lifecycle.ts` → `ptyManager.spawn`. `pty-manager.ts` keeps a `@xterm/headless` mirror
+ `SerializeAddon` for scrollback snapshots and broadcasts the stream over WS. So a scheduled
run is just a session nobody is watching, and the UI is already a pure stream renderer. This
clean seam is what makes the hybrid (D4) feasible.

## Target architecture (hybrid)

```
Swift/AppKit app                          Bun backend (sidecar, unchanged)
─────────────────                         ────────────────────────────────
• Native UI (SwiftUI/AppKit)   ──WS──►    • tasks/projects/flows/schedules
• Swift types (codegen from               • file watch, ripgrep, git
   @taskflow/shared)                       • CLI WS API  ◄──── taskflow-cli
                                           • node-pty for HEADLESS/scheduled
• Interactive sessions:                       sessions (persistence intact)
   libghostty (full) owns PTY,
   GPU/Metal render  ←── agent still calls taskflow-cli over WS (unchanged)
• Watching a backend session:
   render the WS byte stream  ← Risk 3 (second render path)
```

Note: an interactive agent spawned by libghostty in the app still calls `taskflow-cli`, which
reaches the backend over WS independently of the PTY byte stream. The CLI contract is unaffected
by where the PTY lives.

## Risks

1. **libghostty is on an unstable, self-built API.** No official xcframework; build from Zig
   source and vendor your own (community SwiftPM packages exist but wrap Ghostty's app build and
   carry its resource/terminfo assumptions). The *stable* public piece (libghostty-vt) does no
   rendering. Proven by many shipping apps, but "may change between releases." Manageable, not free.

2. **The ~32k-LOC React UI has no turnkey native equivalents for its richest parts.** Monaco
   (code editing) and react-markdown/syntax-highlight have no native drop-in; dnd-kit, Radix UI,
   and Tailwind layouts must be rebuilt in SwiftUI. Likely a Monaco-in-WKWebView island for the
   editor pane. **This is the bulk of the effort — not the terminal.**

3. **Reattaching to a backend-owned (scheduled/headless) session needs a second render path.**
   App-spawned interactive sessions use full libghostty. To *watch* a running schedule, the app
   receives a WS byte stream the full libghostty cannot ingest. Options:
   - (a) libghostty-vt + a custom Metal renderer for the watch case (most control, most work);
   - (b) a minimal embedded xterm.js island just for streamed sessions (pragmatic);
   - (c) show the serialized snapshot statically (lowest fidelity).
   This is the one genuinely awkward seam in the hybrid and the prime spike target.

## Effort shape (rough, not estimated in detail)

- Backend + CLI: **~0** (stays as sidecar binary).
- Type/theme codegen bridge: small.
- libghostty embed + app-spawned interactive terminal: medium, front-loaded risk.
- Native UI rebuild: **large** — dominated by Monaco/markdown/dnd parity.
- Second render path for streamed sessions (Risk 3): medium, option-dependent.

## Bottom line

No blocker kills this. The terminal is solvable (with caveats), backend reuse is clean, and the
hybrid is the right shape. Value-vs-cost hinges on the **UI rebuild**, and **Risk 3** is the one
design problem worth proving before committing.

## Spike plan (next session, separate worktree)

De-risk the two unknowns before any implementation plan:

1. **libghostty embed + app-spawned interactive session.** Bare Swift/AppKit app that vendors
   libghostty (from Zig source or a community SwiftPM package), embeds a terminal surface as one
   view in a normal window (not a terminal-first app), and spawns a real `claude` agent through
   it. Confirm: GPU render works, input/resize/selection work, and the agent's `taskflow-cli`
   calls still reach the backend over WS.
2. **Streamed-session render path (Risk 3).** Prototype watching a backend-owned session: pick
   between libghostty-vt+custom renderer (a), embedded xterm.js island (b), or static snapshot
   (c). Goal: pick the option, not build it fully.

Output of the spike feeds a follow-up that either commits to an implementation plan or records
why not.

## Sources

- Mitchell Hashimoto, "Libghostty Is Coming" — https://mitchellh.com/writing/libghostty-is-coming
- ghostty-org/ghostty, `include/ghostty.h` — https://github.com/ghostty-org/ghostty
- libghostty C API overview — https://mintlify.wiki/ghostty-org/ghostty/api/overview
- libghostty-vt Doxygen reference — https://libghostty.tip.ghostty.org/
- ghostling (minimal libghostty-vt example) — https://github.com/ghostty-org/ghostling
- Kytos: A Native macOS Terminal Built on Ghostty — https://jwintz.gitlabpages.inria.fr/jwintz/blog/2026-03-14-kytos-terminal-on-ghostty/
- Uzaaft/awesome-libghostty — https://github.com/Uzaaft/awesome-libghostty
- libghostty-spm (community SwiftPM) — https://swiftpackageregistry.com/Lakr233/libghostty-spm

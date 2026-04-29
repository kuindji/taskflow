# Master Plan: "Editor Feels Good" (ADE-scoped)

Starting-point document for a future session. Captures the framing, scope decisions, and a phased approach. Not a full implementation plan — the next session should turn the chosen phase(s) into one.

## Framing

Taskflow is an **agentic dev environment (ADE)**, not an IDE. The editor's job is to support the *inspect / tweak / review* loop around agent output, not to be a primary authoring environment. This framing tightens scope sharply and rules out whole categories of work.

User-visible goal, in priority order:

1. **Reading code feels right** — accurate highlighting, go-to-definition, hover types, find-references. The dominant editor activity in an ADE is reading agent diffs.
2. **Small edits don't fight you** — autocomplete, signature help, inline errors, format-on-save.
3. **You see problems before the agent does** — diagnostics on save, lint and type errors as visual markers.

Explicit non-goals: refactoring tools, debugger, test explorers, themes, keybinding parity with VSCode, vim mode, copilot integration, third-party extension support. These are IDE features. Users who want them should use their real IDE; Taskflow's job is to make the round-trip unnecessary for inspect/tweak/review, not to replace VSCode.

## Key strategic decisions (already made in discussion)

- **Use Monaco's existing infrastructure.** Monaco is already in the app. Don't rewrite.
- **Use the libraries VSCode already extracted** — `monaco-languageclient`, `vscode-languageclient`, `vscode-jsonrpc`. The hard parts (LSP lifecycle, stdio bridging, cross-platform process hygiene) are solved code we import, not problems we re-solve.
- **Bundled / detected LSP for a fixed language set.** No extension host, no Open VSX, no `.vsix` loading, no compatibility treadmill. Small stable surface we own end-to-end.
- **No VSCode extension support.** Tempting wrong turn for an ADE. Pulls the product toward IDE-shaped feature requests and an ongoing API-compatibility burden. If a specific extension-shaped capability turns out to be load-bearing (e.g. prettier), add it as a first-class Taskflow feature with a settings checkbox, not via extensions.

## Phased plan

Phases are independently shippable. Each phase delivers user-visible value; later phases are gated on whether the earlier ones aren't already enough.

### Phase 1 — Project-aware TypeScript (no LSP)

**What:** Feed Monaco's built-in TS worker the project's files and `tsconfig.json` so it does cross-file IntelliSense, go-to-def, and inline type errors for `.ts`/`.tsx`/`.js`/`.jsx`.

**Why first:** TS is the bulk of what gets edited in this codebase and many users'. Monaco's TS worker is already loaded — this is configuration, not new infrastructure. Closes a large fraction of the perceived gap before any LSP work.

**Scope:**
- Resolve `tsconfig.json` for the open file (walk up from the file's directory; respect `extends`).
- Push project files into the worker via `addExtraLib` / model registration. Lazy and scoped to the active file's project — don't index the world.
- Configure the worker's `compilerOptions` from `tsconfig`.
- Watch for file changes and update the worker.
- Memory budget: cap files loaded; evict on project switch.

**Open questions for next session:**
- Worktree implications: same logical project across N worktrees — do we share a worker or run per-tab? Per-tab is simpler and probably correct given Monaco worker isolation.
- How to surface "this file isn't part of any tsconfig" gracefully (single-file mode fallback).

**Done when:** opening a TS file in a real Taskflow task gives you cross-file completion, accurate hovers, and red squigglies on type errors.

### Phase 2 — Diagnostics on save (shellout)

**What:** On save, run language-appropriate checkers (`tsc --noEmit`, `eslint --format json`, `ruff`, `cargo check` if cheap, etc.) and render output as Monaco markers.

**Why:** Cheap, language-agnostic, useful even where LSP isn't wired up yet. Bridges the gap before Phase 3, and remains a useful fallback after.

**Scope:**
- Per-language command map; per-project override via Taskflow settings.
- Debounce, cancel previous run on new save.
- Surface output in editor gutter + a problems panel (small, scoped — not a full VSCode problems view).
- Respect project root, not file directory, for invocation.

**Open questions:**
- Where in the UI do aggregated problems live? Reuse an existing panel or add one?
- Per-project enable/disable, or always-on with smart skip when LSP is providing the same diagnostics?

### Phase 3 — Real LSP for a fixed language set

**What:** Wire `monaco-languageclient` to LSP servers for a curated set of languages. Initial set candidate: TypeScript (`typescript-language-server`), Python (`pyright`), Rust (`rust-analyzer`), Go (`gopls`). Final list driven by what users actually edit.

**Why:** Phase 1 only covers TS. Phase 2 gives diagnostics but not completion/hover/go-to-def for non-TS. LSP closes the remaining gap for languages users care about.

**Scope:**
- Server discovery: detect on PATH first; document install steps; **do not bundle** in v1 (avoids app bloat and per-platform binary management). Revisit bundling if user friction is high.
- Lifecycle: one server per (language, project root). Spin up on first file open; spin down when no editor for that project is open for N minutes.
- Worktree handling: treat each worktree as its own project root. Yes, this means N rust-analyzers across N worktrees of the same monorepo. Acceptable trade — correctness over resource sharing. Revisit if it becomes a real problem.
- Config: per-language settings file, sensible defaults, no UI in v1.
- Crash handling: auto-restart with backoff; surface persistent failures in the problems panel.

**Open questions for next session (these are real design calls, not implementation details):**
- **Worktree topology.** Confirmed: per-worktree servers. But: what happens when the same file path is open in two worktrees simultaneously? Each tab has its own LSP client bound to its worktree's server — no sharing.
- **Server install UX.** Pure PATH detection vs. "click to install" helper vs. bundling. Probably PATH-only for v1, "install" buttons later, bundling never.
- **What's the activation trigger?** Opening a file of a known language in a project where that LSP can run. Not eager.
- **Stop criteria.** This phase has a long tail of per-language polish (inlay hints, semantic tokens, code actions). Define explicitly what "done" means — probably "completion + hover + go-to-def + diagnostics work for the four chosen languages on a real repo."

### Phase 4 — Polish (gated on real usage)

Only do these if Phase 1–3 isn't already enough:

- Format-on-save (could be Phase 2 sub-feature; LSP often provides it via `textDocument/formatting`).
- Inlay hints (LSP-standard, mostly free once LSP works).
- Semantic tokens for richer highlighting.
- Find-all-references UI.
- Quick fixes from diagnostics (LSP code actions).

Each is small in isolation. Don't pre-commit to any of them; let user behavior pull them in.

## Risks and where I'll need a human in the loop

These are the places I (Claude) am unreliable and want explicit review:

- **LSP lifecycle decisions.** "When does a server die?" has no right answer; I'll pick something plausible that's wrong for some real workflow. Want explicit sign-off on the spin-up/spin-down policy.
- **Cross-platform process management.** This codebase already has `project_pty_gotchas.md` — LSP servers have the same shape of problem. Windows quirks, zombie cleanup on app quit, signal handling. Review the process supervision code carefully.
- **Worktree topology.** Confirmed direction (per-worktree servers) but the implementation will surface edge cases (symlinked deps, shared `node_modules` via pnpm/bun workspace, `.tsbuildinfo` collisions). Each one is a real decision.
- **Verification.** I can confirm "completion appears." I cannot confirm "completion is correct on a 50k-file monorepo." Plan for users-as-testers explicitly; instrument enough to notice when LSP is silently degraded.

## Out of scope (record so we don't drift)

- VSCode extension API or `.vsix` loading. (Tempting; wrong tool for ADE.)
- Open VSX integration.
- Theia / code-oss embedding. We use the extracted libraries directly, not the IDE shells.
- Themes and keybinding customization beyond what Monaco gives for free.
- Debugger / DAP.
- Multi-cursor productivity features beyond Monaco defaults.
- Settings sync, profiles, workspaces-as-files.

## Suggested next-session entry point

Pick **Phase 1** as the first concrete work. It's high-value, bounded, doesn't require any of the hard design calls (no LSP lifecycle, no worktree topology question), and ships value before any of the harder phases. The next session should:

1. Read this doc.
2. Audit the current Monaco integration in the codebase to see what's already configured.
3. Turn Phase 1 into a real implementation plan with file paths and TDD steps.
4. Defer Phases 2–4 to follow-up plans.

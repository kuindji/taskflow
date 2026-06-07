# Command Palette (Cmd+Shift+P) — Design

**Date:** 2026-06-07
**Status:** Approved
**Task:** Implement command palette for all actions (`acfc17f8`)

## Purpose

A keyboard-driven palette (Cmd+Shift+P) that lists everything runnable in the
current task context — standalone Taskflow actions and package.json scripts —
with fuzzy filtering and Enter-to-run.

## Scope & Contents

Two groups, filtered by a single fuzzy-search input:

1. **Actions** — standalone Taskflow actions (`standalone: true`), global +
   current project's, selected via the existing `filterByProject` helper.
   Non-standalone actions remain flow-only and do not appear.
2. **package.json** — scripts read from the current task's working directory
   (worktree path when the task has one, otherwise the project path), executed
   with the configured default runtime (`<runtime> run <script>`).

Out of scope (deliberately): built-in app commands, flows, `.claude` agent
commands. The palette can grow groups later; the design keeps groups as a flat
list of typed items so adding a group is additive.

## Trigger & State

- **Shortcut:** `Cmd+Shift+P`, registered the same dual way as the existing
  `Cmd+/` shortcuts dialog:
  - Electron menu item ("Command Palette…") with `CmdOrCtrl+Shift+P`
    accelerator in `electron/src/app-menu.ts`, exposed through the preload
    bridge (`electron/src/preload.ts`).
  - Native `keydown` listener on the web side so it works in browser/dev mode.
- **Open state:** boolean + setter in `ui-store` (consistent with other
  dialogs); the dialog is mounted in `App.tsx` alongside the other app-level
  dialogs (`KeyboardShortcutsDialog`, `SettingsModal`, …).

## Component & Behavior

New `CommandPaletteDialog` component built on the existing Radix `Dialog`
primitives (`packages/ui/src/components/ui/dialog.tsx`):

- Layout: borderless search input on top, grouped result list below, footer
  hint (`↑↓ navigate · ↵ run · esc close`).
- **Data + execution:** reuses `useRunMenu`
  (`packages/ui/src/hooks/useRunMenu.ts`) with `enabled = open`,
  `showAgentOptions: false`, and context derived from the active task
  (`taskId`, its `projectId`, `projectPath` = task working dir). The hook
  already fetches scripts lazily when enabled and exposes `onRunScript` /
  `onRunAction`, which navigate to the task, focus the workspace, and spawn
  the session. The palette ignores the hook's flows/agent-command data.
- Selecting an item runs the corresponding callback and closes the palette.
- **Keyboard navigation:** ArrowUp/ArrowDown move selection across the
  flattened list (wrapping), Enter runs the selected item, Esc closes. Mouse
  hover moves selection; click runs. Search input stays focused throughout.
- **Offline:** agent actions render disabled when offline (same condition the
  Run menu uses); scripts remain enabled.
- **No task selected:** the palette opens and shows a "Select a task to run
  actions" empty state instead of results.

## Fuzzy Matching

Small in-house utility in `packages/ui/src/lib/` (no new dependency):

- Subsequence match: every query char must appear in order in the candidate.
- Scoring bonuses for consecutive matches and word-start matches.
- Returns `{ score, indices }`; indices drive match highlighting in the list.
- Group order is fixed (Actions, then package.json). Empty query shows all
  items in natural order; non-empty query hides non-matching items and sorts
  by score within each group.

## Error Handling

- Script execution already no-ops gracefully when no shell resolves
  (existing `onRunScript` behavior).
- Scripts-list and actions fetch failures fall back to empty lists (existing
  hook behavior); the palette just shows fewer/no items.

## Testing

- Unit tests for the fuzzy matcher (match/no-match, ordering, scoring bonuses,
  highlight indices) if test infra exists in `packages/ui`.
- Manual verification: open via shortcut (Electron menu + web listener),
  filter, keyboard nav, run a script (terminal session opens and runs
  `<runtime> run <name>`), run an action (agent session spawns with prompt),
  no-task empty state, Esc/click-outside close.

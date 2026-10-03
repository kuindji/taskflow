# Move Session Between Owners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a live agent session to another task, project or the Master Workspace without restarting it. Moves can be made from `taskflow-cli` or by dragging a tab onto the desktop sidebar.

**Architecture:** The backend keeps a registry of each registered live session's current owner. A per-session queue serializes everything that depends on the owner: output appends, moves, exit cleanup and native-id discovery. A move swaps the `SessionRef` between owner lists, renames the session's output log and broadcasts both owners. The CLI asks the backend for the session's current owner, so a stale `TASKFLOW_TASK_ID` stops mattering. The desktop UI hit-tests the sidebar while a tab is being dragged and sends `SESSION_MOVE`.

**Tech Stack:** Bun, TypeScript, POSIX sh, React + zustand, dnd-kit, bun:test (happy-dom preload for UI tests).

**Spec:** `docs/superpowers/specs/2026-10-03-move-session-design.md`. Read it before starting any section.

**Tracking:** TaskTray `TSK-3` (`task-tray log add TSK-3 --type info "..."`).

## How this plan is laid out

Each section is a separate file in `2026-10-03-move-session/`. Each is written to be implemented in a fresh session. Before starting a section, read `2026-10-03-move-session/handoff.md` (status and facts carried between sections). Then read the section file and the spec. When a section is done, update the handoff.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Shared types + `TaskStore.moveSessionHistory` | `01-store-log-move.md` | — |
| 2 | Owner registry and per-session queue in the lifecycle | `02-owner-registry.md` | 1 |
| 3 | `moveSession`, `getSessionOwner`, WS + REST | `03-move-api.md` | 1, 2 |
| 4 | CLI: owner lookup + `session move` (sh and TS) + docs | `04-cli.md` | 3 |
| 5 | Desktop drag-to-sidebar | `05-ui-drag.md` | 3 |
| 6 | Terminal link cwd, TUI check, manual verification | `06-links-and-verify.md` | 5 |

Sections 4 and 5 are independent of each other.

## Global Constraints

- Use `bun` for everything. Never use npm or yarn. Run UI tests **from the repo root** (`bun test packages/ui/...`), because the DOM preload lives in the root `bunfig.toml`.
- No `as any`. No eslint-disable comments. Don't export anything nothing imports.
- Reuse types: `SessionOwnerRef` (added in Section 1) is the one owner shape shared by the backend, CLI and UI. The backend's `SessionOwner` becomes an alias of it.
- Commits: conventional prefix (`feat(backend):`, `feat(ui):`, `feat(cli):`, `test:`, `docs:`). **No `Co-Authored-By` trailer** (project CLAUDE.md).
- Work on `main`. Do not create branches or worktrees.
- `bun run format` rewrites the whole repo, so never run it. Use `bunx prettier --write <files>` on changed files only. `packages/tui` has pre-existing prettier drift; leave it alone.
- `taskflow-cli` has two implementations. The POSIX script is what runs on macOS/Linux. Both must change identically.
- A move must never change the session's `cwd`, PTY, `instance` or `bootId`.
- Error messages (exact strings, shown to users):
  - `Session is not running`
  - `Only agent sessions can be moved`
  - `Flow sessions cannot be moved`
  - `The remote agent session cannot be moved`
  - `Session belongs to another instance`
  - `Task not found`
  - `Project not found`
  - `Session is already there`
  - `Exactly one of taskId, projectId, or master is required`

## Review Focus

1. **Output written during a move.** The agent keeps printing while it moves. Every chunk must end up in exactly one log file: before the rename in the old one, after it in the new one. Nothing may recreate the old file after the rename. Pinned in Section 2 (queue ordering test) and Section 3 (output before and after a move test).
2. **A session that exits right after moving.** Its ref must leave the *new* owner and the new log must be deleted, with no live ref left behind. Pinned in Section 3 (exit after move test).
3. **An agent calling the CLI after it moved itself.** `taskflow-cli task` must report the new task. A session moved to project level must not keep its old task id. Pinned in Section 4 (owner lookup replaces both ids; task→project clears the task id).
4. **Dropping a tab somewhere other than a sidebar target.** Reordering and moving between panes must behave exactly as before. Pinned in Section 5 (an `onDragEnd` with no target returns `false` and the existing handlers run).
5. **Shell tabs, flow sessions and the remote agent.** Nothing in the sidebar highlights for them, and the backend refuses them anyway. Pinned in Section 3 (refusal tests) and Section 5 (`isMovableTab` / `isValidSessionDrop` tests).

## Execution notes

- After every section: `bun run typecheck`, `bunx eslint <changed files>`, `bunx prettier --check <changed files>`, the section's tests, and the full suite of the package you touched (`cd packages/backend && bun test`, or `bun test packages/ui` from the root).
- The backend suite has one known flaky test that fails occasionally and passes on rerun. Rerun once before investigating.
- When all sections are done, run a whole-change review (`codex-review` skill, gpt-6.1-sol) before marking TSK-3 done.

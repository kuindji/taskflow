# Exploratory Improvements Pass — Design

**Date:** 2026-06-07
**Status:** Approved

## Goal

Fix verified correctness, type-hygiene, and DX issues found in a multi-angle codebase audit. No new features. No behavior changes except where the current behavior is itself the bug. One branch, four independent workstreams, one commit per workstream.

## Background

A four-lens audit (backend correctness, UI quality, cross-package type drift, DX quick wins) produced ~35 findings. Each headline finding was verified against the actual code before inclusion here. Notable false positives that were **rejected** during verification — do not "re-fix" these:

- `flow-runner.ts` `skipAction` "lost state" — `advanceOrComplete` saves the same `run` object it is handed, so in-memory mutations persist correctly.
- `scheduler-service.ts` `execute` error handling — it has an internal try/catch around session spawn and records `lastError` on the schedule.
- `ProjectGroup.tsx` selector "re-render storm" — the Zustand selector returns a primitive (`SessionStatus | undefined`), compared via `Object.is`; no re-render issue.
- `ui-store.ts` `registeredPanels` Set — only consumed via `getState()`, not subscribed reactively.

## Workstream A — Backend: fire-and-forget error handling

**Problem.** Five `void somePromise()` / un-caught `.then()` sites swallow rejections. Worst case: if `removeSessionFromOwner` fails when a session exits, a ghost session reference persists in the task store across restarts — silently.

**Change.** Attach `.catch()` with a contextual `console.error` at each site, matching the codebase's existing logging idiom. No new logger abstraction (only 5 sites; YAGNI).

| Site | Fix |
| --- | --- |
| `packages/backend/src/services/session-lifecycle.ts:462` — `void removeSessionFromOwner(...)` in `onExit` | `.catch()` + log with session id |
| `packages/backend/src/services/session-lifecycle.ts:441` — `void taskStore.appendSessionOutput(...)` in hot `onData` path | `.catch()` + log, rate-limited to once per session (a boolean flag in the session's closure) so a persistent disk error doesn't emit one line per terminal chunk |
| `packages/backend/src/services/remote-agent-service.ts:159` — `settingsStore.get().then(...)` in exit handler | `.catch()` + log; a failed settings read currently means auto-restart is silently never scheduled — make it visible |
| `packages/backend/src/services/pty-manager.ts:206` — `void proc.exited.then(cleanup)` | `.catch()` + log; a throw inside `cleanup` is currently an unhandled rejection |
| `packages/backend/src/services/pty-session-win.ts:144` — `setTimeout` in `kill()` not tracked | **Verify first** (finding not yet confirmed against code). If real: store the timer handle and clear it on dispose. If not real: skip. |

## Workstream B — Type-contract cleanup (shared ↔ UI)

**Problem.** ~13 response types in `packages/shared/src/types/ws.ts` are exported with zero importers (confirmed by grep for `FileReadResponse`, `GitCommitResult`, `TaskListResponse`, `ProjectListResponse`, `SessionCreateResponse`, and others). Meanwhile, UI stores hand-write the identical shapes inline — e.g. `sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST)` — in ~9 places. This violates two CLAUDE.md rules: "keep types reusable" and "don't export unless used."

**Change.** One pass, three steps:

1. Add missing response types to `ws.ts` for endpoints the UI calls that have no type today: `ScheduleListResponse`, `FlowRunsListResponse`, `FlowDefinitionsListResponse`, `FlowActionsListResponse`.
2. Replace inline response shapes in UI stores with imports of the shared types. Known locations: `task-store.ts` (TASK_LIST, TASK_LIST_ARCHIVED), `project-store.ts` (PROJECT_LIST), `session-store.ts` (SESSION_CREATE), `notification-store.ts` (NOTIFICATION_LIST), `schedule-store.ts` (SCHEDULE_LIST), `flow-store.ts` (FLOW_DEFINITIONS_LIST, FLOW_ACTIONS_LIST, FLOW_RUNS_LIST). Sweep all `sendRequest<` call sites for any others.
3. Delete any response type in `ws.ts` that remains unimported after step 2 (candidates: `FileReadResponse`, `FileTreeResponse`, `GitCommitResult`, `GitCreatePrResult`, `GitDiffFileResponse`, `GitDiffResponse`, `GitStatusResponse`, `FileChangedEvent` — confirm each with grep before deleting).

**Result.** Every export in `ws.ts` has a real consumer; response shapes have a single source of truth.

## Workstream C — UI: reference churn + store hygiene

1. **`packages/ui/src/stores/session-store.ts` — `syncWithTasks` / `syncWithProjects`.** Verified: both rebuild every tab object (`{...tab, type, label}`) and both top-level maps (`tabsByWorkspace`, `activeTabByWorkspace`) on every call, even when nothing changed. Every task-list event therefore re-renders all tab subscribers. Fix: reference-preserving rebuild —
   - reuse the existing tab object when its computed fields are unchanged;
   - reuse the existing array when every member was reused and length is equal;
   - return `state` unchanged when both resulting maps are key-and-reference identical to the current ones.
2. **`packages/ui/src/stores/task-store.ts` — HMR disposal.** Its 3 module-level `onEvent` subscriptions lack the `import.meta.hot.dispose` cleanup that `notification-store.ts:93` and `session-subscriptions.ts:263` already have (dev-only listener leak on HMR). Add the same pattern. Audit the remaining stores with module-level `onEvent` subscriptions for the same gap and fix uniformly.
3. **`packages/ui/src/stores/diff-store.ts:81`** — remove the dead `export { _unsubChangeStats }`. The module-level `const` alone keeps the listener alive; the export has no importers.

## Workstream D — Quick wins (CLI + API observability)

1. **CLI unknown flags — `packages/backend/src/services/taskflow-cli-bin.ts:126` (`consumeFlags`).** Unknown `--flag` is silently skipped (the code comments `// Unknown flag: skip`). Worse: for `--typo value`, `value` falls through into positionals, silently changing command behavior. Fix: collect unknown flags in the parse result; callers print `Error: unknown flag "--x"` to stderr and exit 1. Implement the check once at the `consumeFlags` boundary so all commands get it.
2. **CLI unknown command — same file, command dispatch `default` branch.** Currently prints full help with no explanation. Fix: print `Error: unknown command "x"` to stderr before the help text, keep exit 1.
3. **API route error logging — `packages/backend/src/api/routes/*.ts`.** Bare `catch {}` / `catch (err)` blocks discard errors before returning 500s; the routes layer has a single `console.error` in total. Fix: in every catch that returns a 5xx, log `[api] <METHOD> <path> failed:` with the error. Expected 4xx paths (validation, not-found) stay quiet.

## Error handling

- Workstream A makes previously-silent failures visible via logs; no control-flow changes.
- The only user-visible behavior change in the whole pass: the CLI errors on unknown flags instead of silently ignoring them (D.1). This is intentional — silent misbehavior is worse than a hard error.

## Testing

- **`consumeFlags` unit test** (bun:test): unknown flag → error result; `--typo value` no longer pollutes positionals; known flags still parse.
- **`syncWithTasks` reference-stability test**: calling twice with the same input yields reference-identical `tabsByWorkspace` / `activeTabByWorkspace`; a genuinely changed session label produces a new ref only for the affected tab/array.
- Everything else: `bun run typecheck`, `bun run lint`, existing test suite must stay green.

## Risk

- **B, D:** mechanical, low risk.
- **C.1:** the only change with real regression potential (tab sync drives the workspace UI) — covered by the reference-stability test plus manual smoke (open tasks, create/close sessions, watch tabs).
- **A:** additive-only (`.catch` handlers).

## Execution

One branch off `main`. Four commits, one per workstream (A → D in any order; they are independent). Per project rules: bun only, no `as any`, no co-authored-by in commits.

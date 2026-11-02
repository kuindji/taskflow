# S1 — Run now on disabled schedules; drop Terminal.app import

## A05 R3-2: Run now on a disabled schedule

Decision: "Run now" on a disabled schedule runs it once and leaves it
disabled.

- `packages/backend/src/services/scheduler-service.ts:239` throws
  "Schedule is disabled" for `source === "manual"`; the next line returns for
  any disabled schedule. Let a manual run through when disabled.
- A manual run of a disabled schedule must not re-arm the timer and must not
  set `nextRunAt`. Check every place in the run path that writes `nextRunAt`
  or calls the re-arm, and gate it on `schedule.enabled`. A schedule that is
  enabled again later arms as it does today.
- Keep the existing "already running" admission and the offline deferral.
  Decide what offline means for a manual run of a disabled schedule: it must
  not land in `deferredSchedules` and fire later on its own (that would be a
  run nobody asked for at that time). Report the offline error instead, as
  the UI already shows "Run now (offline)" disabled.
- UI (`ScheduleManagementDialog.tsx`), TUI and CLI (`schedule run`, both
  implementations: memory `project_dual_cli_implementations`) need no
  change unless one of them blocks disabled schedules itself; check.

Tests: scheduler-service tests for: disabled + manual runs once; no
`nextRunAt`/timer change; still disabled afterwards; offline manual on a
disabled schedule is reported and not deferred.

## A08 R5-3: drop Terminal.app theme import

Decision: remove Terminal.app from theme import.

- Delete `packages/backend/src/services/theme-parsers/terminal-app.ts` and its
  exports from `theme-parsers/index.ts`.
- `theme-service.ts`: drop the Terminal.app entry in `detectTerminalApps`
  (around line 175) and the `.terminal` branch of From File (around line 227).
- UI/TUI: remove `.terminal` from any file-picker filter or list of accepted
  extensions and any "Terminal.app" label in theme import UI. Grep
  `terminal-app`, `Terminal.app`, `.terminal"`, `parseTerminalApp`.
- Keep `plist.ts` if iTerm2 still uses it.
- Delete tests for the removed parser; update any test listing the sources.

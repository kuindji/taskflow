# Handoff

Next: S2. S1 done (1d642fad), Codex review clean.

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.
- `bun test packages/backend` is flaky under full-suite load: one run hung
  with no CPU after task-store tests, another failed `file-watcher.test.ts`
  ("watches for file changes") and `platform.test.ts` (backend exit 143).
  Every file passes alone. If the full run misbehaves, run files one by one
  with a time cap before blaming your change.

## Owner checks

- S1: in the desktop app, "Run now" on a disabled schedule starts a session
  and the schedule stays disabled with no next run shown; the theme file
  picker no longer offers `.terminal`.

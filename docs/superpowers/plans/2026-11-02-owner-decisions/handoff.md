# Handoff

Next: S4. S3 done (f21c781d, 6efa2ec0; fixes 686129b6, 1198926f after two Codex rounds).

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.
- `bun test packages/backend` is flaky under full-suite load: one run hung
  with no CPU after task-store tests, another failed `file-watcher.test.ts`
  ("watches for file changes") and `platform.test.ts` (backend exit 143).
  Every file passes alone. If the full run misbehaves, run files one by one
  with a time cap before blaming your change. Seen again in S2:
  `wiki-index.test.ts` (watch restart) and `taskflow-cli.test.ts` "names the
  master owner…" (~4.3s alone against the 5s timeout) failed only under load.
  In S3 that test timed out even alone, on the pre-S3 commit too.
- `ApiRouter` does not percent-decode path params; only routes that call
  `decodeURIComponent` themselves accept encoded ids. Do not `url_encode` ids
  in the shell CLI.

## Owner checks

- S1: in the desktop app, "Run now" on a disabled schedule starts a session
  and the schedule stays disabled with no next run shown; the theme file
  picker no longer offers `.terminal`.
- S2: none needed; both CLIs were checked against a sandboxed live backend.
- S3: Run with options (Claude, Codex) shows "Default (<value>, from
  Settings)" on each field; the Settings pages still say "Default"/"Model
  default". Save an action with untouched fields, change the Settings
  effort, run it: the session uses the new effort. A schedule with type
  "Default" runs the Settings default agent.

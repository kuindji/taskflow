# Plan review round 3 — triage

Verified by Claude against the code and the handoff recipe. Codex's verdict: no blocker or major.

- R3-1 (minor) **confirmed**. `echo '…/MacOS/Electron electron' | grep -E 'node_modules/.*Electron \.'` prints nothing: the guard misses the repo-root dev launch (`electron/node_modules/.bin/electron electron`). Fixed: both guard lines in `handoff.md` use `release/mac-arm64/Taskflow.app|MacOS/Electron (electron|\.)( |$)`. Checked it matches `Electron electron`, `Electron .`, the packaged binary, and not `Electron Helper` processes. It doesn't depend on where bun puts the Electron binary.
- R3-2 (minor) **confirmed**. `taskflow-cli-bin.ts:11-14` and `taskflow-cli.sh:9-10` exit when `TASKFLOW_API_URL` is unset, so "scrub, then call the sandbox with `taskflow-cli`" can't work. No step needs that (the smoke uses `curl`/WS; the deferred owner notification check runs inside a sandbox session, whose env the sandbox backend sets at `session-lifecycle.ts:585`). Fixed: the recipe says to use `curl`/WS, and if a CLI call is ever needed, to set `TASKFLOW_API_URL`/`TASKFLOW_API_TOKEN` after the scrub.
- R3-3 (nit) **confirmed**. `update-machine.ts:63`: `no-update` is an event, and the state becomes `idle` (with `checkedAt`). An update found leads to `available`, then `downloading`/`ready`, through auto-download. Fixed: Section 2 Step 11 names those states.

## Own check

- The owner's Section 4 test-build command isn't scrubbed. Checked: the backend reads no `TASKFLOW_API_*`/session/task/project env vars (`grep process.env.TASKFLOW_ packages/backend/src`). `backend-manager.ts` overrides `TASKFLOW_PORT_FILE` and the restartable flag, and per-session env is set by the backend. No change needed.

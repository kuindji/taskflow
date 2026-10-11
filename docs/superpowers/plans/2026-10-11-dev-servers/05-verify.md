# Section 5: Manual verification, final review, close-out

Read first: the plan index, `handoff.md`, and the spec in full. Sections 1–4 must be done.

This section writes no new feature code. It runs the feature for real, has gpt-6.1-sol review the whole change, fixes what's confirmed, and closes TSK-4.

### Task 1: Manual run against a sandboxed backend

**Files:** none, unless a defect turns up. A defect fix gets a test in the package that owns it, plus its own commit.

- [ ] **Step 1: Start a sandboxed backend and the browser UI**

Follow memory `project_dev_backend_sandbox`. Keep the real `HOME` and point `TASKFLOW_CONFIG_DIR` at a scratch directory, so the real app's data and its `dev-servers-main.json` stay untouched:

```bash
SANDBOX="$(mktemp -d)/tf"
mkdir -p "$SANDBOX"
cd packages/backend && TASKFLOW_CONFIG_DIR="$SANDBOX" TASKFLOW_DEV=1 TASKFLOW_DEV_PORT=18799 bun src/index.ts
# second terminal:
cd packages/ui && VITE_BACKEND_PORT=18799 bun run dev
```

The browser renderer opens one connection to primary and creates no machine rows; Section 4's `useLiveDevServers` shows primary's rows in that case. Items 12 and 13 need machine rows, so run them from the Electron app (sandboxed the same way) if they're run at all.

Seed one project (this repo) and one task over the WS API (`project:list` first, then `project:add {path}` and `task:create {projectId, title}`). Drive the UI with Playwright.

- [ ] **Step 2: Run the checklist**

Run the CLI as the sh script, with a session's environment pointed at the sandbox. Set `TASKFLOW_API_URL=http://127.0.0.1:18799`, `TASKFLOW_PROJECT_ID`, `TASKFLOW_TASK_ID`, and a made-up `TASKFLOW_SESSION_ID`. Use `sh packages/backend/src/services/taskflow-cli.sh`. If `GET /api/sessions/<id>/owner` answers 404 for the made-up session ID, add `--task <id>` instead.

Record each item as pass or fail in `handoff.md`:

1. **No servers.** The sidebar shows no dev-server button.
2. **A real server.** Start one: `bunx serve -l 5199 . &`. Run `devserver add --pid $! --label "serve :5199"`. The button appears with count 1. The popover shows `<project> · <task>`, the label and `pid … · just now`.
3. **Stop.** Click Stop. The button reads `Stopping…`, then the row disappears. `lsof -nP -iTCP:5199 -sTCP:LISTEN` prints nothing, and the button hides after the popover closes.
4. **Wrapper tree.** Start `sh -c 'bunx serve -l 5198 .' &` and register the `sh` PID. Stop it. Port 5198 is free afterwards, and the shell that ran the command is still alive.
5. **Stale PID.** Register PID `999999`. Stop it: the row disappears and no error shows.
6. **PID reuse.** Run `sleep 300 &`. Edit the record's `registeredAt` in `$SANDBOX/dev-servers-dev-*.json` to an hour ago. The store re-reads the file on every operation, so no restart is needed. Stop it: the row disappears and `kill -0 <pid>` still succeeds. Kill the sleep by hand.
7. **Failure.** Never register PID 1 or another process with user-owned descendants. Register a root-owned daemon with no children, so the signal gets EPERM: `pgrep -x -U root syslogd` (check that `pgrep -P <pid>` prints nothing). Stop it: the error `Could not stop pid <pid>: operation not permitted` shows under the row, and the button comes back. A second click clears the error and then shows it again. The daemon is still running. Then run `devserver remove --pid <pid>`; the row disappears.
8. **CLI surface.**
   - `devserver list` shows the task's records.
   - `devserver list --all` shows everything.
   - `devserver add --pid abc --label x` prints the `devserver add` usage and exits 1, and the sandbox backend receives no `/api/dev-servers` request. The `GET /api/sessions/<id>/owner` lookup runs before dispatch and is expected.
   - `devserver add --pid 0 --label x` prints `Field 'pid' must be a positive integer` and exits non-zero.
   - `devserver remove --pid 5 --pid 6` prints the `devserver remove` usage and exits 1.
   - A label of 81 characters prints `Field 'label' must be at most 80 characters`.
   - `devserver remove <unknown id>` prints `Dev server not found`.
9. **Survives session and task lifecycle.** Register a server, then archive the task. The row is still there, grouped under the project name if the archived task can't be found. Stop works.
10. **Popover behaviour the unit tests can't reach** (Radix portals are unreliable under happy-dom):
    - clicking the icon opens the popover;
    - after you stop the last server, the popover stays open showing `No dev servers running`;
    - closing it hides the icon;
    - a stop error that was showing is gone when you reopen the popover;
    - a stop that fails after the popover closed shows no error on reopen. Register `sleep 300 &`, `kill -STOP` the sandbox backend, click Stop, close the popover, and wait out the 30 s request timeout. Reopen **while the backend is still stopped**: the row is still there, its Stop button is enabled, and no `Request timeout` error shows. Only then `kill -CONT` the backend (the client sent no cancellation, so the queued stop runs and removes the row). Kill the sleep if it is still running.
11. **Prompt.**
    - `taskflow-cli --help` and `/api/cli-help` show the `devserver` command syntax (the doc is inlined there, so look for `taskflow-cli devserver add --pid <pid> --label "<label>"`).
    - The written `SKILL.md` in the sandbox's agent-skills dir references `taskflow-cli-devserver-commands.md` by path, and `taskflow-agent-prompt.md` sits next to it with the paragraph.
    - Start a real Claude session from the sandbox UI. Its appended system prompt contains the paragraph from the plan index's Global Constraints word for word. Check it in the launch spec in the session log, or ask the agent to quote its Taskflow instructions.
12. **Offline machine.** If a second machine is attachable, register a server on it, then kill its tunnel or backend. Its rows and its share of the count disappear while it's offline, and come back after it reconnects. Otherwise record this as not run.
13. **Windows.** If a Windows machine is reachable, attach it, register a `bun run dev` style tree (a wrapper whose child holds the port), and stop it. The port is free afterwards, and so is every process in the tree, including a child that outlived its parent. Also stop a record whose PID has exited (row disappears, no error). If no Windows machine is reachable, record "Windows stop: unit-tested only, not verified on a real machine" in `handoff.md` and in the final notification.

Stop the sandbox backend and UI, and delete the sandbox directory.

### Task 2: Whole-change review

- [ ] **Step 1: Run the review**

Read the `codex-review` skill first. Then:

```bash
codex exec review --base <base commit from handoff.md> -m gpt-6.1-sol -c sandbox_mode=read-only \
  > docs/superpowers/plans/2026-10-11-dev-servers/reviews/final.md 2>&1
```

Run it in the background and wait for it in this session.

- [ ] **Step 2: Triage and fix**

Verify each finding yourself against the code. Record `confirmed` or `rejected`, plus why, in `reviews/final-triage.md`. Fix confirmed findings test-first, with one commit each. Re-run the touched packages' suites, `bun run typecheck`, and eslint and prettier on the changed files.

### Task 3: Close out

- [ ] **Step 1: Spec amendments**

Add an "Amendments (implementation, <date>)" section to the spec. It lists every deviation recorded in `handoff.md` during implementation. The plan-review refinements are already under "Amendments"; don't repeat them.

- [ ] **Step 2: Handoff and tracking**

- Set every row in `handoff.md` to done, with its commits. Set **Next step** to "None: TSK-4 is complete and ready for the user's review and push."
- `task-tray log add TSK-4 --type info "<summary>"`, plus `--type commit` for each commit not yet logged.
- `task-tray task status TSK-4 in-review`. The user moves it to done.
- `taskflow-cli notify "TSK-4: ready for review and push"`. Don't push.

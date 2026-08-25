# Taskflow TUI Stage 2 live sessions implementation plan

Date: 2026-08-24

Status: Level 1 clear; human validation complete

Baseline: `77304f6`

## Goal

Make the OpenTUI client usable for live shell and agent sessions without
touching the running production Taskflow instance during development.

At the end of this plan, the TUI can:

- show master, project, and task session owners;
- attach the selected owner's existing sessions as tabs;
- create shell and available agent sessions;
- switch, focus, resize, reconnect, and close sessions;
- show interrupted sessions and resume eligible agent sessions;
- run its development backend against a separate config and data root.

This is the session half of product Stage 2. Flows, actions, schedules, git,
settings editing, task editing, notifications, and remote-backend work remain
outside this plan.

## Baseline

The OpenTUI rewrite is complete. `OpenTuiApp` renders the sidebar, main column,
tab strip, focus routing, zoom, mouse input, client warning, and terminal-safe
shutdown. `SessionBridge` already handles snapshots, history fallback, live
output, terminal input, resize, reconnect, exit markers, mode restoration, and
scrollback.

The production entry point still passes `sessions: []`. The session tab tests
inject fake bridges, and no production code creates a `SessionBridge` from
`SessionRef` state.

The current development selector is not a full isolation boundary.
`TASKFLOW_DEV_BRANCH` separates session logs and flow runs and disables the
scheduler, but projects, tasks, settings, flows, schedules, notifications,
themes, generated CLI files, and maintenance work still use the production
config or configured data directory. The current `packages/tui` dev script sets
`TASKFLOW_DEV=1`, but the TUI backend manager strips that variable and only
passes an explicit `TASKFLOW_DEV_BRANCH`. Running that script alone can
therefore spawn a `main` backend.

## Review policy

Use Level 0 validation while implementing each task. After all automated checks
and the isolated shell smoke test pass, perform one Level 1 review over this
plan's changed code and directly affected backend integration.

After any review fix, verify only the finding and code directly affected by the
fix. Do not restart a broad review. Do not implement optional hardening without
separate authorization.

## Task 7 checkpoint, 2026-08-25

Level 1 verdict: `Clear`.

The review covered `77304f6..4f8bca5`, limited to this plan's changed TUI code
and directly affected backend integration. It found no material defect.

Completed validation:

- `bun test packages/tui/src/state packages/tui/src/sessions packages/tui/src/opentui`:
  96 pass, 0 fail.
- `bun test packages/tui`: 168 pass, 0 fail.
- The platform and session-handler test files pass when run separately as the
  plan prescribes: 7 pass and 14 pass respectively.
- `bun run lint` and `bun run typecheck` pass.
- `bun run build:backend:bin` and
  `bun run --filter @taskflow/tui build:bin` pass.
- The isolated `dev-main` smoke fixture used
  `/Users/kuindji/.config/taskflow-tui-dev/main`. It verified the master empty
  state, shell creation and input, project and task updates without restart,
  owner switching, two tabs, numeric tab selection, inactive output catch-up,
  confirmed close with deterministic fallback, zoom, Ctrl+C, bracketed paste,
  mouse sidebar selection, clean terminal restoration, and restart against the
  same isolated root. The production backend remained running throughout.

Repository-suite disposition:

- A combined run of the two focused backend files made the isolated startup
  fixture miss its 10-second port-file deadline. Both files pass separately,
  and a direct isolated-backend probe published its port in 1.8 seconds.
- `bun test` reproduced the pre-existing wiki-store order-dependent failure.
  The failing test, the preceding contaminating test, and `wiki-store.ts` have
  identical Git blobs at baseline `77304f6` and at `4f8bca5`.
- The same full-suite run later stopped making progress at
  `pty-manager.test.ts` and was terminated after more than three minutes with
  no PTY child. That test and its implementation are unchanged from the
  baseline, and the file passes alone with 9 tests in 12.7 seconds. These are
  out-of-scope full-suite coupling issues, not Stage 2 product regressions.

### User Ghostty verification, 2026-08-25

The user ran the prescribed live-session checks in Ghostty and reported that all
three passed. Resizing the outer terminal propagated new dimensions to the
child PTY, Up produced the expected application-cursor sequence, and the wheel
scrolled the attached child's terminal history in both directions. This closes
the capable-terminal shell gate. The user also created multiple sessions,
switched between them, closed sessions, and opened replacements successfully in
the same real-terminal use. The user then restarted the TUI and resumed a
provider-backed session successfully. This closes the agent restart-and-resume
gate.

## Scope

### Included

- An explicit backend config-root override.
- A safe TUI development launcher with a branch-specific non-production root.
- Master-workspace session state in the TUI store.
- Stable owner selection for master, project, and task rows.
- Dynamic `SessionBridge` creation and disposal for the selected owner.
- Existing-session attach and reconnect.
- Shell and agent session creation through existing backend messages.
- Tab selection and active-tab memory per owner.
- Confirmed session close.
- Interrupted and resuming session states.
- One isolated shell smoke test and a separately authorized agent-resume gate.

### Excluded

- Flows, actions, schedules, YAML editing, and flow-run controls.
- Git status, staging, commit, task detail, settings editing, and notifications.
- Model, reasoning, permission, sandbox, or tool overrides in the new-session
  picker. The backend applies saved defaults.
- Session rename and tab reordering.
- Split panes or persisted TUI tab layout.
- Editor sessions, file tabs, browser tabs, and markdown panes.
- Per-client backend terminal grids.
- Remote discovery, SSH tunnel changes, or the deferred remote smoke test.
- Stage 1 handoff Tasks 20, 22, and 23.

## Constraints

- Use Bun for package, test, and build commands.
- Keep `@opentui/core` pinned to the reviewed version.
- Reuse `SessionBridge`, `WsClient`, the backend session lifecycle, and existing
  shared protocol types.
- Do not duplicate Electron's Zustand session store. The TUI needs a smaller
  owner and bridge controller suited to one main pane.
- Do not change the session WebSocket protocol unless a concrete missing
  contract appears during implementation.
- Do not replace `HOME`, XDG variables, or the production data-location file to
  obtain isolation. Use the new Taskflow-specific config-root override.
- Keep production startup unchanged when the new override is absent.
- Automated tests must not launch Claude, Codex, OpenCode, Pi, or Kimi.
- A shell smoke test does not validate agent conversation resume. Record that
  result only after the separate agent gate runs.
- Preserve exact owner identity. Exactly one of `taskId`, `projectId`, or
  `master` is sent with session create and history requests.
- Preserve server truth. A failed create, close, or resume request must not
  remove or invent a local session.
- Keep destructive close behind an explicit confirmation.

## Decisions

| Question | Decision |
|---|---|
| Development isolation | Add `TASKFLOW_CONFIG_DIR`, require an absolute path, and make `bun run dev:tui` choose a branch-specific non-production directory |
| Production default | Keep the existing platform config directory when `TASKFLOW_CONFIG_DIR` is absent or empty |
| Master session cwd | Use `config.baseDir`, so an isolated backend cannot start a master session in the production config directory |
| Owner identity | Use `master`, `project:<id>`, and `task:<id>` keys in TUI state |
| Sidebar | Put `Master Workspace` first, followed by the existing project and active-task rows |
| Session population | Materialize bridges only for the selected owner; the backend snapshot and history restore a session when its owner is revisited |
| Active tab | Remember the active session ID per owner for the life of the TUI process |
| Existing sessions | Show every supported session belonging to the selected owner and attach each exactly once per bridge lifetime |
| Session creation | `s` opens a picker containing available agents and detected shells; the backend applies configured agent defaults |
| Task prompt | A task-owned agent session receives the task description; project and master sessions receive no inferred user prompt |
| Empty main panel | Render `No sessions. Press s to start one.` rather than leaving a blank pane |
| Close | `q` from UI focus asks for confirmation, then sends `SESSION_CLOSE`; keys typed with terminal focus still go to the child |
| Resume | `r` resumes only an eligible interrupted agent session and sends the current pane dimensions |
| Interrupted input | Keep transcript scrolling available, but block `SESSION_INPUT` until the session is live again |
| Exit | Follow the owner update from the backend and remove the bridge; do not retain a local ghost tab |
| Agent validation | Keep the actual agent create, shutdown, restart, and resume test as an explicit human gate |

## State and data flow

```text
PROJECT_LIST + TASK_LIST + MASTER_SESSIONS_LIST
                       |
                       v
                     Store
                       |
             selected owner sessions
                       |
                       v
              SessionController
                 |           |
                 v           v
          SessionBridge[]   active ID per owner
                 |
                 v
             OpenTuiApp
```

The store owns durable records mirrored from the backend. The controller owns
runtime bridges. The app owns layout, focus, modal state, and commands. A bridge
must never become the source of truth for whether a session exists.

## Task 1: establish a real development isolation boundary

Files:

- modify `packages/backend/src/services/platform.ts`
- modify `packages/backend/src/config.ts`
- modify `packages/backend/src/services/session-lifecycle.ts`
- modify `packages/backend/tests/services/platform.test.ts`
- modify `packages/backend/tests/handlers/session.test.ts`
- create `packages/tui/src/dev.ts`
- create `packages/tui/src/dev.test.ts`
- modify `packages/tui/package.json`
- modify root `package.json`
- update the TUI development command in `README.md`

Work:

1. Add a pure config-root resolver that accepts platform, environment, and home
   inputs for tests. `TASKFLOW_CONFIG_DIR` wins when it is a non-empty absolute
   path. Reject a non-empty relative path with an error naming the variable.
2. Keep the current Windows and Unix defaults byte-for-byte when the override is
   absent or empty.
3. Build every `BASE_DIR` path from the resolved root, including settings,
   data-location metadata, generated CLI files, agent skills, themes, sessions,
   logs, flows, schedules, and notifications.
4. Change the default master-session working directory from the hard-coded
   `~/.config/taskflow` path to `config.baseDir`. An explicit `cwd` still wins.
5. Add a TUI dev launcher that:
   - derives a sanitized current Git branch unless `TASKFLOW_DEV_BRANCH` is
     already set;
   - uses `TASKFLOW_CONFIG_DIR` when explicitly set;
   - otherwise selects a persistent branch-specific directory beside, not
     inside, the production Taskflow directory;
   - points `TASKFLOW_BACKEND_BIN` at the repository-built backend unless the
     caller already supplied one;
   - prints the chosen instance and config root before entering the alternate
     screen;
   - invokes the ordinary OpenTUI entry point after setting those values.
6. Change `packages/tui`'s `dev` script to use the safe launcher.
7. Add root `dev:tui` that builds the repository backend binary and then runs
   the safe TUI dev command.
8. Document `bun run dev:tui` as the normal command. Document the explicit
   `TASKFLOW_CONFIG_DIR=/absolute/path` override for disposable or parallel
   test roots.

Acceptance:

- `bun run dev:tui` cannot resolve `config.instanceId` to `main`.
- Its projects, tasks, settings, sessions, logs, generated files, and
  data-location metadata resolve beneath the non-production root.
- A master session launched without `cwd` starts in the isolated config root.
- An explicit absolute override reaches the backend child unchanged.
- A relative override fails before creating directories or starting a server.
- Production Electron and backend startup remain unchanged with no override.
- Tests prove the production root receives no write during an isolated backend
  startup and shutdown fixture.

Validation:

```sh
bun test packages/backend/tests/services/platform.test.ts
bun test packages/backend/tests/handlers/session.test.ts
bun test packages/tui/src/dev.test.ts packages/tui/src/backend/manager.test.ts
bun run --filter @taskflow/backend typecheck
bun run --filter @taskflow/tui typecheck
```

## Task 2: add master sessions and stable owner selection to Store

Files:

- modify `packages/tui/src/state/store.ts`
- modify `packages/tui/src/state/store.test.ts`
- create `packages/tui/src/sessions/owner.ts`
- create `packages/tui/src/sessions/owner.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`

Work:

1. Add `masterSessions` to Store. Load it with
   `MASTER_SESSIONS_LIST` in the same snapshot cycle as projects and tasks.
2. Subscribe to `MASTER_SESSIONS_LIST` broadcasts and apply them through the
   same deferred-event mechanism used during overlapping loads.
3. Include master sessions in reconnect reloads without allowing an older load
   to overwrite a newer broadcast.
4. Define a discriminated `SessionOwner` and stable owner-key helpers for
   master, project, and task owners.
5. Add `Master Workspace` as the first sidebar row. Its badge is the number of
   master sessions visible from this backend instance.
6. Store selection by owner key, not only row index. When rows reorder or a
   selected task disappears, keep the same owner when it still exists. Otherwise
   fall back to its project, then Master Workspace.
7. Expose the selected owner and its current `SessionRef[]` without allowing the
   app to mutate Store records.

Acceptance:

- Initial load cannot commit projects and tasks while leaving master sessions
  from a different load generation.
- A master broadcast racing a load is replayed on top of the committed snapshot.
- Project reorder and task insertion preserve the selected owner.
- Removing the selected task chooses its owning project.
- Hidden projects do not leave a selected invisible owner.
- Every sidebar badge remains derived from backend records.

Validation:

```sh
bun test packages/tui/src/state/store.test.ts
bun test packages/tui/src/sessions/owner.test.ts
bun test packages/tui/src/opentui/app.test.ts
```

## Task 3: reconcile existing sessions into live terminal tabs

Files:

- create `packages/tui/src/sessions/controller.ts`
- create `packages/tui/src/sessions/controller.test.ts`
- modify `packages/tui/src/opentui/session-bridge.ts`
- modify `packages/tui/src/opentui/session-bridge.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/entry.ts`
- extend `packages/tui/src/opentui-index.test.ts`

Work:

1. Add a controller keyed by session ID. It receives the selected owner and the
   owner's `SessionRef[]`, creates one bridge per supported session, and destroys
   bridges removed from that owner.
2. Keep a bridge when only its label, lifecycle state, native session ID, or
   agent options change. Update tab metadata without clearing the terminal.
3. On owner change, destroy the old owner's bridges, create the new owner's
   bridges, subscribe before attach, and attach each bridge once. Preserve the
   active session ID for each owner while the process remains alive.
4. Replace `OpenTuiApp`'s constructor-only readonly session array with a dynamic
   session update boundary. Add and remove embedded renderables without letting
   tab-strip rebuilds destroy terminal renderables.
5. Make the selected owner's first session active when no remembered session
   remains. When the active session disappears, select the nearest surviving
   tab by the old index.
6. Show session labels in backend order. Sanitize labels with the existing
   control-character rule.
7. Render the empty-state instruction when the selected owner has no sessions.
8. Implement `Enter` from sidebar focus and `l` from UI focus as focus-main when
   a live or interrupted session exists. Keep `Ctrl+Escape` and double Escape as
   the universal return path.
9. On reconnect, reattach every current bridge and reload Store. Reconcile the
   reload without duplicating bridges or requests. Keep the existing serialized
   attach queue.
10. Wire the production entry point to the controller. Remove `sessions: []`.

Acceptance:

- Existing master, project, and task sessions appear when their owner is
  selected.
- Selecting another owner cannot show or send input to the previous owner's
  terminal.
- Repeated identical Store events retain bridge and renderable identity.
- A label update changes the tab without resetting the grid.
- Session removal destroys subscriptions and native terminal state exactly
  once.
- Rapid owner changes cannot install a late attach into the wrong pane.
- Reconnect restores all current tabs without duplicate output.
- The empty pane explains how to create a session.

Validation:

```sh
bun test packages/tui/src/sessions/controller.test.ts
bun test packages/tui/src/opentui/session-bridge.test.ts
bun test packages/tui/src/opentui/app.test.ts
bun test packages/tui/src/opentui-index.test.ts
```

## Task 4: create shell and agent sessions

Files:

- create `packages/tui/src/sessions/create-model.ts`
- create `packages/tui/src/sessions/create-model.test.ts`
- create `packages/tui/src/opentui/session-picker.ts`
- create `packages/tui/src/opentui/session-picker.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/sessions/controller.ts`
- modify `packages/tui/src/sessions/controller.test.ts`

Work:

1. Make `s` open a modal picker bound to the owner selected at the moment the
   command runs. A later sidebar move must not retarget an in-flight create.
2. Load `AGENTS_LIST`, `SHELLS_LIST`, and `SETTINGS_GET` when the picker opens.
   Show only available agents. Include detected shells and identify the
   configured default shell.
3. Put the configured default agent first when it is available. Keep the
   remaining agent order from the shared agent list, then list shells.
4. Support `j`, `k`, arrows, Enter, Escape, mouse selection, and a visible loading
   and error state. Modal input must not leak to a child terminal.
5. Send exactly one owner field and the current pane dimensions through
   `SESSION_CREATE`.
6. For a task-owned agent, send the task description as `prompt` when it is not
   empty. Do not infer a prompt for project or master sessions.
7. For a shell, send the resolved full shell path. Do not send the sentinel
   `system` as an executable.
8. Omit `agentOptions`; the backend already merges persisted defaults into the
   selected agent's launch options.
9. Handle both event orderings. A `TASK_UPDATED`, `PROJECT_UPDATED`, or
   `MASTER_SESSIONS_LIST` broadcast may arrive before the create response. The
   response may also arrive first in tests. Produce one bridge and activate the
   returned session ID in either case.
10. Keep the picker open with an actionable error if creation fails. Do not add
    a speculative local tab.

Acceptance:

- An empty isolated root can create a master shell session without any project.
- Unavailable agents cannot be selected.
- The backend receives the selected owner, type, prompt rule, shell path, and
  pane size exactly.
- Repeated Enter while a create is pending sends one request.
- Broadcast-before-response and response-before-broadcast each produce one
  active tab.
- Escape closes the picker without a request.

Validation:

```sh
bun test packages/tui/src/sessions/create-model.test.ts
bun test packages/tui/src/opentui/session-picker.test.ts
bun test packages/tui/src/sessions/controller.test.ts
bun test packages/tui/src/opentui/app.test.ts
```

## Task 5: close sessions and handle process exit

Files:

- modify `packages/tui/src/sessions/controller.ts`
- modify `packages/tui/src/sessions/controller.test.ts`
- create `packages/tui/src/opentui/confirm.ts`
- create `packages/tui/src/opentui/confirm.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`

Work:

1. Route `q` from UI focus to a confirmation for the active session. State that
   closing terminates the process and removes its saved transcript.
2. Confirm with `y` or Enter and cancel with `n` or Escape. Consume all modal
   input so it cannot reach the terminal.
3. Send `SESSION_CLOSE` once. Keep the bridge and tab until backend state removes
   the session.
4. If close fails, dismiss the pending state, retain the session, and render the
   error.
5. Let `SESSION_EXITED` append the existing exit marker. Let the subsequent
   owner update remove the bridge. Do not retain a ghost tab outside Store.
6. Cancel create, close, or resume modal state when its bound owner or session
   disappears.

Acceptance:

- `q` typed with terminal focus still reaches the child.
- `q` typed with UI focus cannot close without confirmation.
- Repeated confirmation while pending sends one close request.
- A failed close leaves the terminal and transcript visible.
- Backend-driven exit removes the correct tab and selects a deterministic
  survivor.
- Closing the final session restores the empty-state instruction.

Validation:

```sh
bun test packages/tui/src/opentui/confirm.test.ts
bun test packages/tui/src/sessions/controller.test.ts
bun test packages/tui/src/opentui/app.test.ts
```

## Task 6: show and resume interrupted agent sessions

Files:

- modify `packages/tui/src/opentui/session-bridge.ts`
- modify `packages/tui/src/opentui/session-bridge.test.ts`
- modify `packages/tui/src/sessions/controller.ts`
- modify `packages/tui/src/sessions/controller.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`

Work:

1. Carry `SessionRef.state` and `nativeSessionId` into the controller's tab
   metadata. Mark interrupted and resuming tabs visibly.
2. Add an input-enabled state to `SessionBridge`. When disabled, continue
   rendering and local scrollback but drop key, paste, focus, mouse, and terminal
   response bytes before `SESSION_INPUT`.
3. Disable input for interrupted and resuming sessions. Keep resize local and do
   not require a live PTY to browse the transcript.
4. Render a concise interrupted notice with:
   - `r` to resume when the type is an agent and `nativeSessionId` exists;
   - `q` to close through the existing confirmation;
   - a reason when resume is unavailable.
5. On `r`, set a local pending state immediately and send `SESSION_RESUME` with
   the current pane columns and rows. Suppress duplicate resume requests.
6. After success, reconcile the backend owner update, retain the same bridge and
   session ID, re-enable input, and call `attach()` to replace the transcript
   with the resumed PTY's current snapshot or history.
7. After failure, return to interrupted state, keep the transcript, and show the
   backend error.
8. Preserve flow ownership by sending only the session ID and dimensions. The
   backend remains responsible for recovering flow callbacks.

Acceptance:

- An interrupted transcript is readable but cannot send backend input.
- Resume is unavailable for shell, editor, missing-native-ID, and already-live
  sessions.
- Resume sends the dimensions of the visible pane, not stale startup values.
- A second resume command while pending sends no request.
- Successful resume keeps one tab and one bridge and does not duplicate history.
- Failed resume preserves the last good transcript and permits a later retry.
- A clean TUI shutdown followed by restart in the same isolated root exposes the
  interrupted record before any resume attempt.

Validation:

```sh
bun test packages/tui/src/opentui/session-bridge.test.ts
bun test packages/tui/src/sessions/controller.test.ts
bun test packages/tui/src/opentui/app.test.ts
bun test packages/backend/tests/handlers/session.test.ts
```

## Task 7: integration validation and review

### Automated checks

Run focused checks first, then the package and repository checks:

```sh
bun test packages/tui/src/state packages/tui/src/sessions packages/tui/src/opentui
bun test packages/tui
bun test packages/backend/tests/services/platform.test.ts
bun test packages/backend/tests/handlers/session.test.ts
bun run lint
bun run typecheck
bun test
bun run build:backend:bin
bun run --filter @taskflow/tui build:bin
```

If the full suite fails outside this plan's scope, reproduce the same failure at
the baseline before attributing it to Stage 2. Do not fold an unrelated fix into
this plan.

### Isolated shell smoke test

This gate is part of implementation validation and does not use an agent.

1. Record the running production Taskflow process and leave it running.
2. Run `bun run dev:tui`. Confirm the dev launcher reports a non-production
   instance and config root.
3. Confirm the first sidebar row is `Master Workspace` and the main panel shows
   the empty-state instruction.
4. Press `s`, create a detected shell, and verify the terminal accepts input,
   paste, Ctrl+C, Escape, application arrows, mouse scrolling, zoom, and resize.
5. In that isolated master shell, create a temporary project with
   `taskflow-cli project add <temporary-project-path> --name "TUI Smoke"`.
   Confirm the sidebar updates without restart.
6. Select the project, create a shell, and run
   `taskflow-cli task create "TUI session smoke" --title "TUI smoke"`.
   Confirm the task appears and owner changes replace the tab set correctly.
7. Create two shell sessions under one owner. Verify click selection, `1` and
   `2`, focus switching, inactive output catch-up, and deterministic fallback
   after closing one session.
8. Stop and restart the isolated backend through the TUI lifecycle. Confirm the
   production process remains running and its project, task, settings, and
   session files were not used by the dev backend.
9. Keep the isolated root until review is complete so failed cases remain
   inspectable. Remove it only after the user decides the evidence is no longer
   needed.

### Agent resume gate

This is a separate human gate. Do not run it merely because the automated suite
and shell smoke test passed.

When explicitly authorized:

1. Use the same isolated config root and a temporary project.
2. Create one available agent session on a task and verify the task description
   reaches the agent as the initial prompt.
3. Interact with the agent and confirm terminal input and output.
4. Quit the TUI cleanly while the session remains open.
5. Restart with the same isolated root and dev branch. Confirm the transcript is
   present and the tab is marked interrupted.
6. Verify keys cannot reach the interrupted process.
7. Resume once. Confirm the same conversation continues, the same tab remains,
   the current pane dimensions are used, and input works after resume.
8. Close through confirmation and verify the record and transcript disappear
   from the isolated root only.

Do not describe restoreability as validated unless all eight steps complete
against a real supported agent.

### Level 1 review

Review only this plan's changed code and directly affected integrations. The
blocking standard is the repository's Level 1 policy. Fix substantiated findings
only, then run a verification-only pass.

The final verdict must be one of:

- `Clear`
- `Clear with non-blocking follow-ups`
- `Changes required`

## Completion criteria

Stage 2 live sessions are complete when:

- the development launcher has a tested full-data isolation boundary;
- existing sessions attach for master, project, and task owners;
- shell and available agent creation are wired through server truth;
- tab selection, reconnect, close, exit, interrupted display, and resume pass
  focused automated tests;
- the isolated shell smoke test passes;
- the agent resume gate is either completed or explicitly recorded as an
  outstanding human gate;
- package and repository checks have an evidence-backed disposition;
- the Level 1 verdict is recorded.

Flows and the rest of product Stage 2 remain unstarted after this plan.

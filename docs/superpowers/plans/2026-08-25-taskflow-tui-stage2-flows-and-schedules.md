# Taskflow TUI Stage 2 flows and schedules implementation plan

Date: 2026-08-25

Status: ready for implementation

Baseline: `2d09045`

Design: `docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`

Preceding plan: `docs/superpowers/plans/2026-08-24-taskflow-tui-stage2-live-sessions.md`

## Goal

Finish product Stage 2 on top of the live-session TUI. This plan adds flow and
action definitions, flow runs and controls, schedules, YAML editing through the
client's local `$EDITOR`, and live OSC 52 clipboard forwarding.

At the end of this plan, the TUI can:

- list the flows and standalone actions available to the selected owner;
- start flows, collect required inputs, and open the spawned session;
- show the current flow run, action states, loop iteration, and artifacts;
- pause, resume, stop, skip, and restart flow actions through existing backend
  messages;
- create, edit, and delete flow, action, and schedule records as YAML;
- list schedules and, on a scheduler-owning backend, enable, disable, trigger,
  and delete them;
- explain why schedules are read-only on a development backend;
- forward a live child's OSC 52 clipboard command to the terminal running the
  TUI without replaying old clipboard commands from history.

Git, settings, task detail, and notifications remain Stage 3 work.

## Entry checkpoint

The OpenTUI rewrite and the live-session implementation are complete and have a
Level 1 `Clear` verdict. The current package has a production `SessionController`,
owner-scoped tabs, reconnect, shell and agent creation, close, and resume.

The live-session plan still has two recorded human gates:

- repeat the shell smoke in a terminal where direct PTY resize, application
  cursor keys, and wheel scrolling are observable;
- run the real-agent create, restart, resume, and close gate only after explicit
  authorization.

Those gates do not block implementation of this plan. The first one does block
the final claim that all of product Stage 2 is complete. The second may remain
recorded as an outstanding human gate, but no report may describe real-agent
resume as tested until it runs.

## Current contracts

The backend already owns the product behavior this plan needs:

- definitions use `FLOW_DEFINITIONS_LIST`, `FLOW_ACTIONS_LIST`,
  `FLOW_DEFINITION_SAVE`, `FLOW_ACTION_SAVE`, and the matching delete messages;
- runs use `FLOW_START`, `FLOW_RUNS_LIST`, the five run-control messages, and
  `FLOW_RUN_UPDATED`;
- schedules use `SCHEDULE_LIST`, create, update, delete, trigger, and
  `SCHEDULE_UPDATED`;
- a flow owner is exactly one task, project, or master workspace;
- the backend permits at most one active flow per owner;
- schedule mutations are rejected unless the backend instance owns the
  scheduler.

The missing pieces are client state, screens, record codecs, editor lifecycle,
and one capability bit. `SYSTEM_INFO` does not currently tell a remote client
whether schedule mutations are enabled. The TUI must not infer that from its
local environment because `--connect` may point at a different host.

`EmbeddedTerminalRenderable` consumes child terminal output but exposes no OSC
callback. `CliRenderer` does expose `copyToClipboardOSC52` and
`clearClipboardOSC52`, so the bridge can recognize OSC 52 in live raw output and
hand the decoded value to the outer renderer.

## Review policy

Use Level 0 validation while implementing each task. After the automated checks
and isolated shell-only smoke tests pass, perform one Level 1 review over this
plan's changes and directly affected backend integration.

After a review fix, verify only the finding and code affected by it. Do not
restart a broad review. Do not add optional hardening without separate
authorization.

## Scope

### Included

- A scheduler-enabled capability in `SYSTEM_INFO`.
- TUI-local flow, action, run, and schedule state.
- Owner-aware visibility for global and project records.
- Flow and standalone-action launch from the selected owner.
- Required flow input collection with typed file paths.
- Flow run display and existing run controls.
- YAML editing in an external editor on the TUI host.
- Live-only OSC 52 clipboard forwarding with bounded buffering.
- Schedule read-only behavior on development backends.
- Safe isolated smoke fixtures that never use production Taskflow data.

### Excluded

- Git changes, staging, commit, and generated commit messages.
- Settings, task detail, attributes, task logs, and notifications.
- A graphical file picker for `filepath` flow inputs. The TUI accepts a path as
  text.
- Artifact download or file copying. The run screen shows artifact type and
  path or text summary.
- New backend flow or schedule semantics.
- Multiple active flows for one owner.
- Concurrent-record editing or compare-and-swap persistence.
- Changes to schedule ownership. A dev backend remains unable to mutate
  schedules.
- Remote discovery, SSH setup, or the deferred remote smoke test.
- Agent, model, permission, sandbox, or tool selection outside record YAML.
- Stage 3 features.

## Product decisions

### Record visibility

Master sees global flows and actions. A project or task sees global records plus
records for its project. Schedules always belong to a project. From master, the
schedule screen lists all projects; from a project or task, it starts filtered
to that project.

The client performs the same visibility filtering as the desktop UI. It does
not change or duplicate backend storage.

### YAML envelopes

YAML contains editable product fields. The client owns immutable metadata.

- Editing preserves `id` and `createdAt` and replaces `updatedAt` at save time.
- Creating assigns a UUID and both timestamps after validation.
- Flow action-entry IDs remain visible and editable because run state and
  artifacts refer to them.
- Schedule IDs and timestamps stay outside YAML. Schedule project ownership is
  editable only when creating a record, matching the desktop form.
- Unknown keys are errors. Silently dropping a misspelled key would make a save
  appear successful while losing the user's change.

Every file begins with comments that list valid enum values. Flow files also
list the visible action IDs and names. Validation errors replace one delimited
comment block at the top and reopen the same file without discarding the edit.

### External editor ownership

The editor runs on the machine that runs `taskflow-tui`, including in
`--connect` mode. Resolve `$EDITOR`, falling back to `vi` only when the variable
is empty. A configured GUI editor is responsible for its own blocking flag.

Before spawning the editor, blur the embedded terminal and call
`CliRenderer.suspend()`. Spawn with inherited stdin, stdout, and stderr. In a
`finally` block, call `resume()`, restore app focus, and request a full render.
The WebSocket remains connected while the editor runs.

Use a private temporary directory and remove it after save or cancel. A nonzero
editor exit cancels the edit and sends no save request.

### Schedule safety

Add `schedulerEnabled: boolean` to `SystemInfo`. The backend sets it from the
same `config.instanceId === "main"` condition passed to `SchedulerService`.

When the value is false, the schedule screen displays:

`Schedules are read-only here. The production Taskflow instance owns the scheduler.`

List and navigation remain available. Create, edit, enable, disable, trigger,
and delete commands stay disabled instead of sending requests that the backend
will reject.

New schedule YAML starts with `enabled: false`. Enabling or triggering a
schedule is a separate visible action. Triggering always asks for confirmation
because it starts a shell or agent session.

### OSC 52 behavior

Scan only live `TERMINAL_OUTPUT` after the bridge has attached. Never process
snapshot, history, reconnect replay, or buffered pre-attach output for
clipboard effects.

Support BEL and ST terminators, chunk boundaries, clipboard and primary
targets, and an empty payload for clear. Ignore queries, malformed base64,
unknown targets, and sequences over 1 MiB. The original bytes still go to the
embedded terminal.

## Key map

These keys apply only while UI focus is active. Session focus continues to pass
bytes to the child.

| Context | Key | Result |
|---|---|---|
| Sessions | `f` | Open the active run, or the flow library when no run is active |
| Sessions | `c` | Open schedules |
| Flow library | `Tab` | Switch between flows and actions |
| Flow library | `j` / `k` | Move selection |
| Flow library | `Enter` | Start a flow or a standalone action |
| Flow library | `n` / `e` / `d` | Create, edit, or delete through YAML and confirmation |
| Flow library | `v` | Open the selected owner's retained run |
| Flow run | `Enter` | Focus the selected action's session when present |
| Flow run | `p` | Pause a running flow or resume a paused flow |
| Flow run | `s` | Skip the running action |
| Flow run | `x` | Confirm stop or finish-loop |
| Flow run | `R` | Confirm restart from the selected completed or failed action |
| Flow run | `l` | Open the flow library |
| Schedules | `j` / `k` | Move selection |
| Schedules | `n` / `e` / `d` | Create, edit, or delete when the scheduler is enabled |
| Schedules | `Space` | Enable or disable the selected schedule |
| Schedules | `t` | Confirm an immediate trigger |
| Product screen | `Escape` / `q` | Return to sessions without closing a session |

Pending requests consume duplicate commands. Errors remain visible in the
current screen and do not exit the TUI.

Flow, action, and schedule rows also support click selection and activation.
Mouse wheel input scrolls the active list. Resizing recomputes each product
screen without changing its selected record or leaking input to a hidden
terminal.

## Task 1: expose scheduler ownership

Files:

- `packages/shared/src/types/system.ts`
- `packages/backend/src/handlers/system.ts`
- `packages/backend/src/handlers/system.test.ts`
- `packages/backend/src/index.ts`

Work:

1. Add required `schedulerEnabled: boolean` to `SystemInfo`.
2. Move the inline `SYSTEM_INFO` registration into a small system handler.
3. Pass the existing editor list, home directory, and
   `config.instanceId === "main"` into that handler.
4. Keep the response backward-compatible for existing UI consumers. They read
   `editors` and `homedir` and may ignore the new field.
5. Test both capability values through a fake router.

Acceptance:

- a main backend reports `schedulerEnabled: true`;
- a development backend reports `false`;
- no client derives schedule ownership from `TASKFLOW_DEV_BRANCH` or its own
  process environment.

Commit: `feat(backend): expose scheduler ownership`

## Task 2: add flow and schedule state

Files:

- `packages/tui/src/flows/store.ts`
- `packages/tui/src/flows/store.test.ts`
- `packages/tui/src/flows/model.ts`
- `packages/tui/src/flows/model.test.ts`
- `packages/tui/src/schedules/store.ts`
- `packages/tui/src/schedules/store.test.ts`

Work:

1. Add class-based stores using `NetLike`, matching the current TUI store style.
2. Load flow definitions and actions together. Load runs for the selected owner
   using `ownerKey` and `MASTER_OWNER_ID`.
3. Track the one running, paused, or locally retained terminal run for each
   owner. Fold `FLOW_RUN_UPDATED` into that state.
4. Load schedules with an optional project filter and fold
   `SCHEDULE_UPDATED` into the current list.
5. Add request methods for existing save, delete, start, control, and schedule
   messages. Change local state only after the request succeeds.
6. Protect snapshot loads with request tokens so an older response cannot
   overwrite a newer owner selection or event.
7. Add subscriptions and idempotent disposal. No module-level singleton
   listeners.
8. Add pure helpers for owner IDs, visible definitions, action labels, latest
   artifacts, schedule status text, and stable selection after a list change.

Acceptance:

- master, project, and task filtering matches the product decisions;
- reconnect reloads definitions, the selected owner's run, and visible
  schedules without duplicating listeners;
- a terminal run remains viewable until the user dismisses it or starts another
  run;
- failed requests leave the last confirmed state intact.

Commit: `feat(tui): add flow and schedule state`

## Task 3: add YAML record editing

Files:

- `packages/tui/package.json`
- `bun.lock`
- `packages/tui/src/editor/external-editor.ts`
- `packages/tui/src/editor/external-editor.test.ts`
- `packages/tui/src/editor/records.ts`
- `packages/tui/src/editor/records.test.ts`
- `packages/tui/src/editor/validation.ts`
- `packages/tui/src/editor/validation.test.ts`

Work:

1. Add `yaml` at the lockfile's current `2.8.2` version to the TUI package.
2. Define separate action, flow, and schedule draft types. Do not cast parsed
   YAML directly to shared protocol types.
3. Parse one YAML document with unique keys required. Reject aliases, unknown
   keys, invalid scalar types, invalid enum values, and mismatched
   `agentOptions.type`.
4. Validate flow inputs, unique input IDs, action-entry shape, unique entry IDs,
   referenced action existence, project visibility, and nonempty record names
   and prompts where required.
5. Require an explicit schedule name so the TUI never invokes backend name
   generation as a side effect of saving YAML. Validate that a schedule has
   exactly one runnable source: a standalone visible action or a nonempty
   prompt. Validate positive timeout and require a project when creating.
6. Convert validated drafts to complete shared records or schedule payloads.
   Preserve immutable metadata on edits and use full update payloads with
   explicit `null` values when a schedule field must be cleared.
7. Serialize stable, readable YAML with comments for enums and action IDs.
8. Implement the suspend, spawn, parse, reopen-on-error, save, and cleanup loop.
   Inject filesystem, clock, UUID, process spawn, and renderer controls in tests.
9. Treat a backend save error like a validation error. Put its message in the
   delimited error block and let the user edit or quit.

Acceptance:

- malformed YAML never sends a backend request;
- quitting after an error preserves no partial record;
- editor failure, parser failure, save failure, and success all resume the
  renderer and clean the temporary directory;
- tests never open a real editor or change terminal modes.

Commit: `feat(tui): edit product records as yaml`

## Task 4: forward live OSC 52 clipboard commands

Files:

- `packages/tui/src/opentui/osc52.ts`
- `packages/tui/src/opentui/osc52.test.ts`
- `packages/tui/src/opentui/session-bridge.ts`
- `packages/tui/src/opentui/session-bridge.test.ts`

Work:

1. Add an incremental OSC 52 scanner with a bounded partial buffer.
2. Recognize BEL and ST completion across arbitrary output chunks.
3. Map `c` to clipboard and `p` or `s` to the supported OpenTUI targets.
4. Decode valid base64 and call `copyToClipboardOSC52`. Use
   `clearClipboardOSC52` for an empty payload.
5. Ignore clipboard queries, invalid payloads, unknown targets, and oversized
   sequences without interrupting terminal output.
6. Feed the scanner only from the live-output path after attach. Keep all
   replay paths side-effect free.
7. Inject a clipboard sink in tests. Never mutate the test runner's clipboard.

Acceptance:

- a split live sequence produces one clipboard call;
- the same sequence in snapshot, history, or pending pre-attach output produces
  none;
- malformed or oversized data neither copies nor breaks the session bridge;
- terminal bytes and sequence bookkeeping remain unchanged.

Commit: `feat(tui): forward live osc52 clipboard commands`

## Task 5: build the flow library and input overlay

Files:

- `packages/tui/src/opentui/flow-library.ts`
- `packages/tui/src/opentui/flow-library.test.ts`
- `packages/tui/src/opentui/flow-input.ts`
- `packages/tui/src/opentui/flow-input.test.ts`
- `packages/tui/src/sessions/action-runner.ts`
- `packages/tui/src/sessions/action-runner.test.ts`

Work:

1. Build a full-main-area flow library with flow and action tabs, project scope
   labels, pending state, inline errors, row clicks, and wheel scrolling.
2. Preserve selection by record ID across reload, save, and delete.
3. Wire create and edit to the YAML editor. Confirm deletes and show backend
   reference errors without removing the record locally.
4. Start a flow for the exact selected owner. If the definition has inputs,
   collect each value in an `InputRenderable` overlay and reject blank values.
   A `filepath` input is still a typed string.
5. Run only actions marked `standalone` from the action tab.
6. For agent actions, create a session with the action's label, prompt, type,
   and options. For shell actions, resolve a shell through `SHELLS_LIST`, create
   it, then send the action prompt followed by carriage return through
   `SESSION_INPUT`.
7. Route all creation through `SessionController` so owner memory and tab
   selection stay consistent.

Acceptance:

- global and project records appear in the right owner contexts;
- a non-standalone action cannot be launched directly;
- canceling an input overlay sends no `FLOW_START`;
- a successful start returns to sessions and selects the spawned action tab
  once its owner update arrives;
- no automated test launches a shell or agent process.

Commit: `feat(tui): add flow and action library`

## Task 6: build the flow run screen

Files:

- `packages/tui/src/opentui/flow-run.ts`
- `packages/tui/src/opentui/flow-run.test.ts`
- `packages/tui/src/sessions/controller.ts`
- `packages/tui/src/sessions/controller.test.ts`

Work:

1. Render flow name, status, loop iteration, action labels and types, action
   status, and latest artifact summaries.
2. Keep action selection stable as run updates arrive.
3. Wire pause, resume, stop, skip, and jump through the existing messages.
4. Disable ordinary flow resume when the paused action still has an interrupted
   session. Tell the user to resume it from the terminal tab, matching the
   backend contract.
5. Confirm stop and jump. A loop stop is labeled `Finish loop`.
6. Add a controller method that focuses a known session and emits the new active
   tab immediately. Use it only when the flow owner is the selected owner.
7. `Enter` on an action with a session returns to sessions and focuses that tab.
8. Dismissing a completed or failed run is client-only. Do not delete backend
   run evidence.

Acceptance:

- controls are enabled only for compatible run and action states;
- repeated pending controls send one request;
- updates for another owner never steal selection or focus;
- artifact collapse matches `latestArtifactsByType`;
- session resume remains owned by the live-session UI.

Commit: `feat(tui): add flow run controls`

## Task 7: build the schedules screen

Files:

- `packages/tui/src/opentui/schedules.ts`
- `packages/tui/src/opentui/schedules.test.ts`

Work:

1. Render name, project, expression, enabled state, next and last run, running
   session, and last error. Support row clicks and wheel scrolling.
2. Filter to the selected project for project and task owners. Allow all-project
   browsing from master.
3. Read `schedulerEnabled` from loaded system info. Show the exact read-only
   banner and suppress every mutation command when false.
4. Wire YAML create and edit when enabled. New records default to disabled.
5. Confirm delete. Explain that deleting a running schedule closes its session.
6. Toggle enabled state only after confirmation from the backend.
7. Confirm trigger and keep the screen pending until the request resolves.
8. Fold `SCHEDULE_UPDATED` into details without moving selection.

Acceptance:

- a dev backend receives list requests but no mutation request from the screen;
- a main backend can create, edit, disable, enable, trigger, and delete through
  fake-network tests;
- trigger and delete errors stay visible;
- no automated test starts a scheduled session.

Commit: `feat(tui): add schedule management`

## Task 8: integrate product screens with the app

Files:

- `packages/tui/src/opentui/app.ts`
- `packages/tui/src/opentui/app.test.ts`
- `packages/tui/src/opentui/keys.ts`
- `packages/tui/src/opentui/keys.test.ts`
- `packages/tui/src/opentui/entry.ts`

Work:

1. Add an explicit main-view state for sessions, flow library, flow run, and
   schedules. Keep modal overlays separate.
2. Give each product screen its own key handler. Extend `KeyRouter` only for
   global screen-opening commands and session focus transitions.
3. Prevent product-screen keys from reaching an inactive embedded terminal.
4. Prevent product-screen mouse and wheel input from reaching a hidden embedded
   terminal.
5. Keep sidebar owner navigation available in UI focus. Changing owner reloads
   owner-dependent run and schedule state and returns stale owner screens to a
   valid view.
6. Construct and dispose the new stores in `entry.ts`. Pass narrow callbacks to
   `OpenTuiApp`; do not move backend requests into renderables.
7. On reconnect, reload system info, definitions, the selected owner's run, and
   visible schedules. Keep the current session reattach path unchanged.
8. During external editing, prevent app commands, blur sessions, and restore the
   previous screen and focus after renderer resume.
9. Recompute product-screen layout on renderer resize while preserving the
   selected record and scroll position.
10. Destroy every overlay, screen, store listener, and temporary editor owner on
   shutdown.

Acceptance:

- `f` and `c` work only in UI focus;
- `q` closes a session only in the session screen and returns from product
  screens without closing anything;
- owner deletion, reconnect, editor cancel, and shutdown leave no orphaned
  renderables or listeners;
- mouse, wheel, and resize behavior stays inside the visible product screen;
- the existing live-session tests keep their behavior.

Commit: `feat(tui): wire stage 2 product screens`

## Task 9: validate and review

### Automated checks

Run focused tests first:

```sh
bun test packages/backend/src/handlers/system.test.ts
bun test packages/tui/src/editor packages/tui/src/flows packages/tui/src/schedules
bun test packages/tui/src/sessions packages/tui/src/opentui
bun test packages/tui
bun run lint
bun run typecheck
bun run build:backend:bin
bun run --filter @taskflow/tui build:bin
```

Then run the repository suite:

```sh
bun test
```

If the full suite reaches the previously recorded wiki-store coupling failure
or PTY stall, reproduce and compare it at baseline `2d09045` before assigning it
to this plan. Do not fold unrelated fixes into Stage 2.

### Isolated development-instance smoke

Use a new absolute `TASKFLOW_CONFIG_DIR` and a unique development branch name.
Keep the production backend running to prove isolation. Do not copy production
data into the fixture.

Verify:

1. create and edit global and project action and flow YAML;
2. suspend into `$EDITOR`, save, cancel, and return with clean terminal state;
3. run a standalone shell action and observe its command in the selected tab;
4. start a one-step shell flow, view its run, skip or exit the shell, and observe
   completion;
5. collect text and filepath inputs;
6. restart the isolated backend and recover definitions and run evidence;
7. open schedules and see the read-only production-owner banner;
8. verify the production config root and records did not change.

No Claude, Codex, OpenCode, Pi, or Kimi process may start in this smoke test.

### Isolated scheduler-owner smoke

Use a second empty `TASKFLOW_CONFIG_DIR` and start the backend without
`TASKFLOW_DEV_BRANCH`, making it `main` only inside that isolated root.

Create one fixture project, then verify schedule list, create-disabled, edit,
and delete. Do not enable or trigger the schedule. Confirm the development root
and production root remain unchanged.

### Human gates

Keep these separate from the automated and shell-only result:

- OSC 52: after explicit approval, preserve the current clipboard in memory,
  emit a unique marker from an isolated shell, verify it, and restore the prior
  clipboard without printing it.
- Agent flow: after explicit approval, start one flow backed by an available
  agent, exercise pause or resume as applicable, and close it cleanly.
- Schedule trigger: after explicit approval, trigger one disabled fixture
  schedule manually and verify its session lifecycle.
- Live sessions: close the prior direct-resize, application-cursor, and
  wheel-scroll gate in a capable terminal.

An approval for one gate does not authorize another.

### Level 1 review

Review only this plan's diff and directly affected backend integration. Check:

- owner and project filtering;
- renderer suspend and resume on every editor exit;
- YAML validation before save;
- scheduler capability enforcement in the UI;
- flow control state and session focus;
- reconnect and disposal;
- live-only OSC 52 side effects;
- preservation of live-session behavior.

Record one verdict:

- `Clear`
- `Clear with non-blocking follow-ups`
- `Changes required`

## Completion criteria

This plan is complete when:

- flow, action, run, and schedule state pass focused tests;
- YAML edit, cancel, invalid edit, and backend-error paths restore the TUI;
- owner-aware flow launch and run controls pass fake-network tests;
- schedule mutations are suppressed on a dev backend and work against an
  isolated scheduler-owning fixture;
- live OSC 52 forwarding passes unit tests and its human gate is either run or
  explicitly recorded as outstanding;
- shell-only isolated smoke tests pass without touching production data;
- provider-backed flow and schedule gates are either run with authorization or
  explicitly recorded as outstanding;
- package and repository checks have an evidence-backed disposition;
- the preceding live-session terminal gate is closed before claiming all of
  product Stage 2 complete;
- the Level 1 verdict is recorded.

Stage 3 remains unstarted after this plan.

# Taskflow TUI Stage 3 workspace operations implementation plan

Date: 2026-08-25

Status: ready for implementation

Baseline: `c678ba9`

Design: `docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`

Preceding handoff: `docs/superpowers/plans/2026-08-25-taskflow-tui-stage2-flows-and-schedules.handoff.md`

## Goal

Finish the local daily-work scope of the TUI. Stage 2 can create and control
sessions, flows, actions, and schedules, but the selected task is still only a
sidebar label and repository work still requires another client. Stage 3 adds
task creation and detail, task logs and attributes, Git changes and commit,
settings needed by the TUI, notifications, and a complete help screen.

At the end of this plan, a user can select a task, inspect its working context,
start or update work, review and stage repository changes, commit them, adjust
the TUI's runtime defaults, and receive Taskflow notifications without leaving
the terminal client.

Remote discovery and SSH setup remain separate work. The existing direct-resize,
application-cursor, wheel-scroll, provider-backed resume, schedule-trigger, OSC
52, and remote smoke checks remain explicit human gates. They do not block
implementation of this plan and must not be reported as passed without their
own evidence.

## Review policy

Use Level 0 implementation validation for each task. After all Stage 3 tasks
and provider-free smoke tests pass, run one Level 1 standard review over this
plan's diff and directly affected backend integration. After fixes, use a
verification-only pass. Do not add optional hardening work without separate
authorization.

## Scope

### Included

- A task detail screen for description, notes, worktree state, inherited and
  local attributes, and chronological task logs.
- New task and subtask creation, plus bounded title, description, notes, pin,
  archive, and attribute updates.
- Repository status, staged and unstaged files, text diffs, stage and unstage,
  and commit.
- Explicit user-triggered commit-message generation through the existing
  backend message. No provider request runs on screen load.
- TUI-relevant settings for default session choices, external editor, sidebar
  width, and collapsed projects.
- Notification state, unread indication, notification navigation, and native
  desktop delivery where the host supports it.
- A help overlay generated from the actual key bindings.
- Provider-free isolated smoke fixtures under an absolute disposable
  `TASKFLOW_CONFIG_DIR`.

### Excluded

- Push, pull, fetch, pull-request creation, branch creation, history browsing,
  and file revert. These are outward-facing or destructive and need a later
  plan with explicit confirmation rules.
- A full-screen source editor or side-by-side diff viewer.
- Wiki, file explorer, project search, browser panes, and remote-agent UI.
- Project creation, removal, reordering, or linking.
- Archived-task browsing and permanent task deletion.
- Changes to backend task, Git, settings, or notification semantics unless a
  concrete missing capability is found during implementation.
- Running an AI provider merely to validate this stage.
- Closing any outstanding Stage 2 human gate by inference.

## Product decisions

### Main-screen navigation

The sidebar remains the owner selector. Sessions stay the default main view.

- `Enter` focuses the active session when one exists. When the selected task
  has no session, it opens task detail.
- `t` opens task detail for a selected task.
- `n` opens new-task input. On a project it creates a top-level task. On a
  top-level task it creates a subtask. It is disabled on master and subtasks.
- `g` opens Git changes for the selected project or task repository.
- `,` opens settings.
- `!` opens notifications.
- `?` opens help.

Product screens keep the existing `Escape` and `q` return behavior. A modal
owns input until it closes. Hidden session terminals remain attached but never
receive product-screen keys.

### Task editing

Task creation uses a native modal because title, description, worktree choice,
and optional init command are short structured fields. Long description and
notes editing uses the same renderer suspend, local `$EDITOR`, validation, and
restoration owner already used by flow YAML, with plain UTF-8 text rather than
YAML.

The detail screen shows resolved attributes grouped by scope. Edits may only
mutate the selected task's own attributes. Inherited project or parent values
remain read-only and visibly labelled. Archive always asks for confirmation
because it closes task sessions and active flows. Permanent deletion is not in
this stage.

Task-log broadcasts are folded on top of in-flight snapshots using the same
generation and deferred-event rule as the existing stores. Switching tasks
must not let an older response replace the selected task's logs.

### Git boundaries

Resolve the repository path from the selected owner:

- a task with an initialized worktree uses `task.worktree.path`;
- otherwise a task uses its project's path;
- a project uses its own path;
- master has no Git screen.

The screen shows branch, ahead and behind counts, staged files, and unstaged
files. Selecting a text file opens a unified diff pane. Binary or unavailable
diffs show a clear message instead of failing the screen.

Stage and unstage act on the selected file; uppercase variants act on all
files after confirmation. Commit requires at least one staged file and a
non-empty message. Message generation is a separate visible command and only
sends `GIT_GENERATE_COMMIT_MSG` after the user invokes it. Committing never
pushes.

Refresh after every mutation and on `GIT_CHANGE_STATS`. Use request generations
so a slow response from the previous owner cannot replace the current screen.

### Settings boundaries

Stage 3 edits only settings that affect the TUI's own daily use:

- default agent, runtime, shell, model, and agent permission options used by
  session creation;
- external editor;
- sidebar width and collapsed project IDs.

Choices come from `AGENTS_LIST`, `RUNTIMES_LIST`, `SHELLS_LIST`, `SYSTEM_INFO`,
and the existing per-agent model-list messages. Save small partial updates
through `SETTINGS_UPDATE`; never replace an unrelated settings section with a
stale snapshot. Font, Electron window geometry, Markdown, appearance, remote
agent, and data-directory settings remain outside the TUI screen.

### Notifications

Mirror `NOTIFICATION_LIST` and all three notification broadcasts. The footer
shows the unread count. The notification screen can mark one item read, mark
all read, or clear read items through existing backend messages.

Native delivery is best effort and never blocks state updates. Use an argument
array, not a shell command string. Prefer `notify-send` on Linux and
`osascript` on macOS when available; otherwise keep the in-app unread indicator
without reporting an error. Do not replay desktop notifications from the
initial list or reconnect snapshot. Deliver only new live broadcasts.

### Help as executable documentation

Keep one key-hint model for both the footer and help overlay. The help screen
groups session, task, flow, schedule, Git, settings, and notification commands.
Tests must fail when a routed global command lacks a help entry. This avoids a
second hand-maintained key map drifting from the implementation.

## Task 1: task detail state

Files:

- create `packages/tui/src/tasks/store.ts`
- create `packages/tui/src/tasks/store.test.ts`
- create `packages/tui/src/tasks/model.ts`
- create `packages/tui/src/tasks/model.test.ts`
- modify `packages/tui/src/state/store.ts`

Work:

1. Add owner-to-task and owner-to-repository-path helpers.
2. Load task logs on demand and retain per-task snapshots.
3. Fold `TASK_LOG_ADDED`, task updates, and attribute mutations without losing
   broadcasts that overlap a load.
4. Expose explicit methods for task create, update, archive, and own-attribute
   create, update, and delete.
5. Keep project and parent attributes read-only in the model.

Acceptance:

- stale task-log loads cannot replace a newer selection or broadcast;
- owner path resolution prefers an initialized worktree and otherwise falls
  back to the project;
- task mutations return the backend record and let the existing root store
  broadcast remain server truth;
- inherited attributes are labelled and cannot produce mutation payloads.

## Task 2: task detail and task creation UI

Files:

- create `packages/tui/src/opentui/task-detail.ts`
- create `packages/tui/src/opentui/task-detail.test.ts`
- create `packages/tui/src/opentui/task-create.ts`
- create `packages/tui/src/opentui/task-create.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/keys.ts`
- modify `packages/tui/src/opentui/keys.test.ts`
- modify `packages/tui/src/opentui/entry.ts`

Work:

1. Add the task-detail screen with description, notes, worktree state,
   attributes, and logs.
2. Add task and subtask creation with field validation and a submitted state
   that consumes duplicate keys.
3. Add external-editor text editing for description and notes using the
   existing suspend and restore lifecycle.
4. Add pin and archive controls, with archive confirmation.
5. Route `t` and `n`, preserve active session focus rules, and add contextual
   footer hints.

Acceptance:

- selecting a task and pressing `t` opens the right record;
- a project creates a top-level task and a top-level task creates a subtask;
- master and subtask creation attempts remain disabled and explained;
- an editor failure restores the terminal and sends no update;
- archive cannot run without confirmation and returns cleanly to a valid owner.

## Task 3: Git state and diff model

Files:

- create `packages/tui/src/git/store.ts`
- create `packages/tui/src/git/store.test.ts`
- create `packages/tui/src/git/model.ts`
- create `packages/tui/src/git/model.test.ts`

Work:

1. Load `GIT_STATUS` for one resolved repository path.
2. Load the selected file's staged and unstaged diff through the existing Git
   messages.
3. Add stage, unstage, stage-all, unstage-all, commit, and explicit generated
   message methods.
4. Refresh on mutations and matching `GIT_CHANGE_STATS` events.
5. Guard every async result with repository-path and generation identity.

Acceptance:

- late status and diff responses from a previous repository are ignored;
- rename, delete, untracked, staged, and partially staged records remain
  distinguishable;
- generation is never requested implicitly;
- commit rejects empty messages and an empty staged set before sending.

## Task 4: Git changes and commit UI

Files:

- create `packages/tui/src/opentui/git-changes.ts`
- create `packages/tui/src/opentui/git-changes.test.ts`
- create `packages/tui/src/opentui/git-commit.ts`
- create `packages/tui/src/opentui/git-commit.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/keys.ts`
- modify `packages/tui/src/opentui/keys.test.ts`
- modify `packages/tui/src/opentui/entry.ts`

Work:

1. Add a two-pane file and unified-diff screen with staged and unstaged groups.
2. Add file and all-files stage and unstage commands with confirmations for
   all-files operations.
3. Add a commit modal with editable message, explicit generation, pending
   state, and backend error display.
4. Route `g` only when the selected owner resolves to a repository.
5. Refresh the screen after mutations while preserving selection when the file
   still exists.

Acceptance:

- text diffs remain readable at narrow widths and binary files degrade cleanly;
- hidden terminals never receive Git screen input;
- no Git command runs twice from repeated keys while a request is pending;
- committing updates the status without pushing or closing the TUI.

## Task 5: TUI settings

Files:

- create `packages/tui/src/settings/store.ts`
- create `packages/tui/src/settings/store.test.ts`
- create `packages/tui/src/opentui/settings.ts`
- create `packages/tui/src/opentui/settings.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/keys.ts`
- modify `packages/tui/src/opentui/keys.test.ts`
- modify `packages/tui/src/opentui/entry.ts`

Work:

1. Load settings and installed choices in parallel.
2. Render typed pickers for the included settings only.
3. Save one minimal partial settings payload at a time.
4. Make the app layout react to sidebar width and collapsed-project changes.
5. Ensure session creation reads updated defaults without restarting the TUI.

Acceptance:

- unavailable saved choices remain visible but are labelled unavailable;
- saving one field cannot overwrite a concurrent unrelated settings change;
- collapsed projects hide their task rows without changing selected owner
  identity incorrectly;
- a new session picker uses the saved defaults immediately.

## Task 6: notifications

Files:

- create `packages/tui/src/notifications/store.ts`
- create `packages/tui/src/notifications/store.test.ts`
- create `packages/tui/src/notifications/deliver.ts`
- create `packages/tui/src/notifications/deliver.test.ts`
- create `packages/tui/src/opentui/notifications.ts`
- create `packages/tui/src/opentui/notifications.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/entry.ts`

Work:

1. Mirror notification snapshots and broadcasts with deferred-event safety.
2. Show unread count and a navigable notification list.
3. Add mark-read, mark-all-read, and clear-read controls.
4. Deliver only live created events through the host notifier adapter.
5. Keep missing host notification tools silent and non-fatal.

Acceptance:

- reconnect does not duplicate native notifications;
- a live notification updates the unread count before delivery is attempted;
- notification text is passed as process arguments and never shell-expanded;
- list selection survives updates when the selected record remains.

## Task 7: help and integration

Files:

- create `packages/tui/src/opentui/help.ts`
- create `packages/tui/src/opentui/help.test.ts`
- modify `packages/tui/src/opentui/app.ts`
- modify `packages/tui/src/opentui/app.test.ts`
- modify `packages/tui/src/opentui/keys.ts`
- modify `packages/tui/src/opentui/keys.test.ts`
- modify `README.md`

Work:

1. Define shared command metadata used by routing, footer hints, and help.
2. Add the help overlay and mouse or keyboard scrolling.
3. Check focus, resize, owner switching, reconnect, pending requests, and
   disposal across every new product screen.
4. Document the implemented TUI commands and the absolute-root development
   workflow.
5. Remove the current deferred `n` and `?` routes.

Acceptance:

- every global UI command has one help entry and contextual footer label;
- overlays restore the previous screen and focus exactly once;
- reconnect reloads visible product state without discarding the last good
  frame;
- destroy removes all subscriptions and host processes.

## Task 8: validation, smoke, and Level 1 review

Automated validation:

1. Run each new focused test file while implementing its task.
2. Run `bun test packages/tui`.
3. Run the directly affected shared and backend tests if implementation found a
   real protocol gap.
4. Run `bun run lint` and `bun run typecheck`.
5. Run `bun run --filter @taskflow/backend build:bin` and
   `bun run --filter @taskflow/tui build:bin`.
6. Run `git diff --check`.
7. Run the full repository suite once and compare any failure with the recorded
   Stage 2 baseline before attributing it to this plan.

Provider-free isolated smoke:

1. Start with a fresh absolute `TASKFLOW_CONFIG_DIR` and a unique development
   branch.
2. Create a fixture project and repository with staged and unstaged text files.
3. Create a task and subtask, edit notes, add and update a local attribute, and
   confirm task-log updates.
4. Inspect a diff, stage one file, commit it with a manually entered message,
   and verify no push occurred.
5. Change one TUI setting and verify the next session picker reflects it.
6. Inject a local notification broadcast and verify unread state without
   requiring native delivery.
7. Restart the isolated backend and confirm retained records and clean terminal
   restoration.
8. Move the disposable root to Trash after evidence is captured.

Then perform one Level 1 standard review of the complete Stage 3 diff. Fix only
substantiated findings, rerun affected checks, and use a verification-only
follow-up. Keep every outstanding human or provider-backed gate recorded in the
handoff.

## Implementation order

Implement Tasks 1 through 8 in order. Task state comes first because Git path
selection depends on it. Git comes before settings and notifications because it
completes the core terminal work loop. Help lands last so it documents the
final command set rather than chasing it during implementation.

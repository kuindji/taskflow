# S4 — Read-only archived task view in the UI (A15 R4-1)

Decision: selecting an archived task in the UI sidebar (click or keyboard)
opens a read-only view, matching the TUI.

Today: the workspace resolves only live tasks (`useActiveWorkspace` and
the workspace components); keyboard selection shows the project, a click
shows nothing. Archived tasks live in `useTaskStore` `archivedTasks`.
Archiving stops sessions; the backend rejects updates to archived records.

Reference: the TUI's read-only task detail,
`packages/tui/src/opentui/task-detail.ts` (`readOnly`): title, description,
notes, attributes, "Archived <YYYY-MM-DD>", navigation and close only.

Work:
- Make click and keyboard selection of an archived task behave the same and
  open the read-only view in the workspace area.
- The view shows title, description, notes (rendered as the live task's
  notes are), resolved attributes, archive date, and an **Unarchive** button
  (reuse the existing unarchive action from `TaskCard`). No sessions, no
  tabs, no run menu, no editing controls, no git panes.
- After Unarchive the same task opens as a normal workspace.
- Reuse existing task header / notes / attributes components in a read-only
  mode where they support one; do not fork them.
- Make sure nothing else treats the archived task as active (session
  creation, run menus, shortcuts that act on the active task, command
  palette task actions).

Tests: selection of an archived task (click and keyboard) yields the
read-only view; Unarchive switches to the live workspace; task-scoped
shortcuts do nothing while it is shown. Owner check: look at it in the app.

# S2 — `task create` subtask flags in both CLIs (A01 R2-1)

Decision: `taskflow-cli task create` creates a top-level task by default in
both implementations. `--subtask` makes a child of the current task;
`--parent <id>` makes a child of that task.

Both implementations ship (memory `project_dual_cli_implementations`): the
POSIX script `packages/backend/src/services/taskflow-cli.sh` runs on
macOS/Linux, the TS binary `packages/backend/src/services/taskflow-cli-bin.ts`
on Windows. Change both identically.

Today:
- Shell (`taskflow-cli.sh`, `task create` POSTs around line 233): no
  `--parent`, never sends `parentId`, uses `$TASKFLOW_PROJECT_ID`.
- TS (`taskflow-cli-bin.ts:202-255`): in task context always sets
  `parentId = taskId` and rejects `--parent <other>`; outside task context
  `--parent <id>` looks the parent up for its project.

Target behaviour (both):
- No flag → top-level task in the current project (as the shell does now).
- `--subtask` → requires task context (`TASKFLOW_TASK_ID`, or the
  `--task <id>` global option if the CLI supports it for this command); the
  child goes in the current task's project.
- `--parent <id>` → looks up that task, uses its project. Allowed in task
  context too (drop the TS restriction). `--subtask` and `--parent` together
  → error.
- Keep "`--worktree` is not allowed when creating a subtask".
- Check what the backend does with a `parentId` that is itself a subtask
  (nesting depth) and mirror its error; do not add new rules.
- Usage strings in both list the new flags.

Docs: `packages/backend/src/services/taskflow-cli-task-commands.md` (the
source of the agent-skill doc under `~/.config/taskflow/agent-skills/`):
add `--subtask` and `--parent <id>` examples and say the default is
top-level.

Tests: whatever covers each CLI today (grep `taskflow-cli` under
`packages/backend/tests`). Cover default, `--subtask`, `--parent`, both
flags, `--subtask` without task context, `--worktree` with a subtask flag.

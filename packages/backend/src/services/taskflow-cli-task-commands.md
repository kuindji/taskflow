## Task commands
`taskflow-cli task list` List all tasks in the current project
`taskflow-cli task list-archived` List all archived tasks
`taskflow-cli task create "Fix login timeout bug"` Create task
`taskflow-cli task create "Investigate memory leak" --title "Memory leak in auth service"`
`taskflow-cli task create "Feature branch work" --worktree` Create task with worktree enabled
`taskflow-cli task create "Feature branch work" --worktree --init "bun install"` Create task with worktree and run init command

When running in task context, the following commands work as is. When not running in task context (TASKFLOW_TASK_ID env variable is not available), the following commands require `--task <id>` before any command: `taskflow-cli --task <id> command`. This applies to agent and session commands as well.

`taskflow-cli task` Get task info
`taskflow-cli task update --title "New title"` Update task title
`taskflow-cli task update --description "New desc"` Update task description
`taskflow-cli task update --notes "Some notes"` Replace task notes
`taskflow-cli task update --pin` Pin task
`taskflow-cli task update --unpin` Unpin task
`taskflow-cli task archive` Archive the current task
`taskflow-cli task unarchive` Unarchive the current task
`taskflow-cli task delete` Delete the current task
`taskflow-cli task delete --delete-worktree` Delete task and clean up its worktree
`taskflow-cli task worktree --disable` Disable worktree mode for a task. (removes the worktree from disk, and deletes the local branch)
`taskflow-cli log info "discovered X"` Log info
`taskflow-cli log warning "potential issue with Y"` Log warning
`taskflow-cli log error "failed to do Z"` Log error
`taskflow-cli log commit "fix: resolve race condition" --hash abc123` Log commit
`taskflow-cli log file "path/to/file"` Log edited file
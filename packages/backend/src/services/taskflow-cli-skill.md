# Taskflow CLI

Taskflow puts `taskflow-cli` on your PATH, pre-configured for this session.

## Commands 
`taskflow-cli browser "https://example.com" --label "Docs"` Open internal browser on task level
`taskflow-cli browser "https://example.com" --project` Open internal browser on project level

## Task commands
`taskflow-cli task list` List all tasks in the current project
`taskflow-cli task create "Fix login timeout bug"` Create task
`taskflow-cli task create "Investigate memory leak" --title "Memory leak in auth service"`

When running in task context, the following commands work as is. When running in project context, the following commands require `--task <id>` before any command: `taskflow-cli --task <id> command`

`taskflow-cli task` Get task info
`taskflow-cli log info "discovered X"` Log info
`taskflow-cli log warning "potential issue with Y"` Log warning
`taskflow-cli log error "failed to do Z"` Log error
`taskflow-cli log commit "fix: resolve race condition" --hash abc123` Log commit
`taskflow-cli task worktree --disable` Disable worktree mode for a task. (removes the worktree from disk, and deletes the local branch)

## Agent commands (Use these commands only if asked by the user. These commands open a new tab visible to the user.)
`taskflow-cli agent list` List available agents (type, availability, version)
`taskflow-cli agent run --prompt "<prompt>"` Start default agent with prompt
`taskflow-cli agent run --task <id>` Start default agent session on a specific task (uses task description)
`taskflow-cli agent run --task <id> --prompt "<prompt>"` Start default agent session on a task with custom prompt
`taskflow-cli agent run <agent> --task? --prompt?` Start a specific agent session
All run commands also accept --label "<label>" argument that specifies tab title.
Without --task agent will be started on project level. Within task context by default pass --task.

## Flow commands (available when working in flow context)
`taskflow-cli action complete` Mark flow step/action complete
`taskflow-cli artifact list` List flow artifacts
`taskflow-cli artifact get <id>` Get artifact
`taskflow-cli artifact save <id> --path docs/plan.md` Save artifact
`taskflow-cli artifact save <id> --text "Brief summary here"` Save artifact
`taskflow-cli flow input` Get all inputs
`taskflow-cli flow input <id>` Get input


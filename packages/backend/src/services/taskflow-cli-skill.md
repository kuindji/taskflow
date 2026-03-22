# Taskflow CLI

Taskflow puts `taskflow-cli` on your PATH, pre-configured for this session.

## Commands
`taskflow-cli browser "https://example.com" --label "Docs"` Open internal browser on task level
`taskflow-cli browser "https://example.com" --project` Open internal browser on project level

## Task commands
`taskflow-cli task list` List all tasks in the current project
`taskflow-cli task list-archived` List all archived tasks
`taskflow-cli task create "Fix login timeout bug"` Create task
`taskflow-cli task create "Investigate memory leak" --title "Memory leak in auth service"`

When running in task context, the following commands work as is. When running in project context, the following commands require `--task <id>` before any command: `taskflow-cli --task <id> command`

`taskflow-cli task` Get task info
`taskflow-cli task update --title "New title"` Update task title
`taskflow-cli task update --description "New desc"` Update task description
`taskflow-cli task update --notes "Some notes"` Update task notes
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

## Project commands
`taskflow-cli project list` List all projects
`taskflow-cli project add /path/to/project` Add a project by path
`taskflow-cli project add /path/to/project --name "My Project"` Add with custom name
`taskflow-cli project remove <projectId>` Remove a project
`taskflow-cli project update <projectId> --name "New Name"` Rename project
`taskflow-cli project update <projectId> --hidden` Hide project
`taskflow-cli project update <projectId> --visible` Unhide project
`taskflow-cli project fork <projectId> <branch>` Fork project to new branch
`taskflow-cli project fork <projectId> <branch> --folder custom-name` Fork with custom folder name

## Session commands
`taskflow-cli session rename <sessionId> "New Label"` Rename a session tab
`taskflow-cli session snapshot <sessionId>` Get terminal snapshot of a session
`taskflow-cli session close <sessionId>` Close/terminate a session

## Notification commands
`taskflow-cli notify "Build completed successfully"` Send a desktop notification

## Agent commands (Use these commands only if asked by the user. These commands open a new tab visible to the user.)
`taskflow-cli agent list` List available agents (type, availability, version)
`taskflow-cli agent run --prompt "<prompt>"` Start default agent with prompt
`taskflow-cli agent run --task <id>` Start default agent session on a specific task (uses task description)
`taskflow-cli agent run --task <id> --prompt "<prompt>"` Start default agent session on a task with custom prompt
`taskflow-cli agent run <agent> --task? --prompt?` Start a specific agent session
All run commands also accept --label "<label>" argument that specifies tab title.
Without --task agent will be started on project level. Within task context by default pass --task.

## Flow commands
`taskflow-cli flow list` List all flow definitions
`taskflow-cli flow actions` List all action definitions
`taskflow-cli flow start <flowId>` Start a flow
`taskflow-cli flow start <flowId> --input key=value` Start a flow with input values
`taskflow-cli flow stop <flowId>` Stop a running flow
`taskflow-cli flow pause <flowId>` Pause a running flow
`taskflow-cli flow resume <flowId>` Resume a paused flow
`taskflow-cli flow skip <flowId>` Skip the current action in a flow
`taskflow-cli flow jump <flowId> <actionIndex>` Jump to a specific action
`taskflow-cli flow run <flowId>` Get current flow run state
`taskflow-cli flow runs` List all flow runs for current owner

### Flow commands (when working in flow context)
`taskflow-cli action complete` Mark flow step/action complete
`taskflow-cli artifact list` List flow artifacts
`taskflow-cli artifact get <id>` Get artifact
`taskflow-cli artifact save <id> --path docs/plan.md` Save artifact
`taskflow-cli artifact save <id> --text "Brief summary here"` Save artifact
`taskflow-cli flow input` Get all inputs
`taskflow-cli flow input <id>` Get input

## Schedule commands
`taskflow-cli schedule list` List schedules (filtered by current project if set)
`taskflow-cli schedule create --expression "30m" --prompt "Check status"` Create a rate-based schedule
`taskflow-cli schedule create --expression "0 9 * * *" --type cron --prompt "Morning check"` Create a cron schedule
`taskflow-cli schedule create --expression "1h" --name "Hourly check" --timeout 10` With name and timeout
`taskflow-cli schedule update <id> --enable` Enable a schedule
`taskflow-cli schedule update <id> --disable` Disable a schedule
`taskflow-cli schedule update <id> --prompt "New prompt"` Update schedule prompt
`taskflow-cli schedule delete <id>` Delete a schedule
`taskflow-cli schedule trigger <id>` Trigger a schedule immediately
`taskflow-cli schedule complete` Signal scheduled task completion (used by agents)

## Settings commands
`taskflow-cli settings get` Get current application settings

## System commands
`taskflow-cli system info` Get detected editors
`taskflow-cli system shells` List detected shells
`taskflow-cli system runtimes` List detected runtimes

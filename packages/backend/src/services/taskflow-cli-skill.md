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
`taskflow-cli session tail <sessionId>` Get last 100 lines of session output
`taskflow-cli session tail <sessionId> --lines 50` Get last N lines of session output
`taskflow-cli session status <sessionId>` Get session status (working, attention, idle)
`taskflow-cli session close <sessionId>` Close/terminate a session
`taskflow-cli session input <sessionId> "message"` Send a message to a running session
`taskflow-cli session input <sessionId> "message" --raw` Send without auto-appending newline

## Notification commands
`taskflow-cli notify "Build completed successfully"` Send a desktop notification

## Agent commands (Use these commands only if asked by the user. These commands open a new tab visible to the user.)
`taskflow-cli agent list` List available agents (type, availability, version)
`taskflow-cli agent run --prompt "<prompt>"` Start default agent with prompt
`taskflow-cli agent run --task <id>` Start default agent session on a specific task (uses task description)
`taskflow-cli agent run --task <id> --prompt "<prompt>"` Start default agent session on a task with custom prompt
`taskflow-cli agent run <agent> --task? --prompt?` Start a specific agent session
All run commands also accept --label "<label>", --full-access, --no-questions, and --model "<model>" arguments.
--full-access enables full access (dangerously skip permissions) for the agent session.
--no-questions enables autonomous mode (agent won't ask permission questions, auto-accepts all).
--model sets the model (e.g. "opus", "sonnet", "haiku" for Claude; "pro", "flash" for Gemini).
Without --task agent will be started on project level. Within task context by default pass --task.

## Action commands
`taskflow-cli action list` List all action definitions
`taskflow-cli action get <id>` Get a specific action definition
`taskflow-cli action create --name "Code Review" --prompt "Review the code" --session-type claude` Create an action
`taskflow-cli action create --name "Deploy" --prompt "Deploy to staging" --session-type shell --standalone` Create a standalone action
`taskflow-cli action update <id> --name "New name"` Update action name
`taskflow-cli action update <id> --prompt "New prompt"` Update action prompt
`taskflow-cli action update <id> --session-type codex` Update action session type
`taskflow-cli action update <id> --standalone` Mark action as standalone
`taskflow-cli action update <id> --no-standalone` Unmark action as standalone
`taskflow-cli action delete <id>` Delete an action (fails if referenced by flows)
`taskflow-cli action run <id>` Run an action (spawns a new agent session with the action's config)
`taskflow-cli action run <id> --prompt "Override prompt"` Run action with a custom prompt
`taskflow-cli action run <id> --label "My Tab"` Run action with a custom tab label

## Flow commands
`taskflow-cli flow list` List all flow definitions
`taskflow-cli flow get <id>` Get a specific flow definition
`taskflow-cli flow create --name "My Flow" --description "Does things" --action <actionId>` Create a flow with action references
`taskflow-cli flow create --name "Pipeline" --description "CI" --action <id1> --action <id2>` Create a flow with multiple actions
`taskflow-cli flow update <id> --name "New name"` Update flow name
`taskflow-cli flow update <id> --description "New desc"` Update flow description
`taskflow-cli flow delete <id>` Delete a flow
`taskflow-cli flow actions` List all action definitions (alias for action list)
`taskflow-cli flow start <flowId>` Start a flow
`taskflow-cli flow start <flowId> --input key=value` Start a flow with input values
`taskflow-cli flow stop <flowId>` Stop a running flow
`taskflow-cli flow pause <flowId>` Pause a running flow
`taskflow-cli flow resume <flowId>` Resume a paused flow
`taskflow-cli flow skip <flowId>` Skip the current action in a flow
`taskflow-cli flow jump <flowId> <actionIndex>` Jump to a specific action
`taskflow-cli flow run <flowId>` Get current flow run state
`taskflow-cli flow runs` List all flow runs for current owner

### Flow context commands (when working inside a flow action)
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

## App name command
`taskflow-cli app-name` Get the application display name (returns custom name or auto-generated hostname/IP)

## System commands
`taskflow-cli system info` Get detected editors
`taskflow-cli system shells` List detected shells
`taskflow-cli system runtimes` List detected runtimes

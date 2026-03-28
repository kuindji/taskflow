## Agent commands (Use these commands only if asked by the user. These commands open a new tab visible to the user.)
`taskflow-cli agent list` List available agents (type, availability, version).
`taskflow-cli agent run --prompt "<prompt>"` Start default agent with prompt.
`taskflow-cli agent run --task <id>` Start default agent session on a specific task (uses task description).
`taskflow-cli agent run --task <id> --prompt "<prompt>"` Start default agent session on a task with custom prompt.
`taskflow-cli agent run [<agent-type>] [--task <id>] [--prompt "<prompt>"]` Start a specific agent session. <agent-type> comes from list command (claude,codex,etc). If omitted, uses the default from settings.
All run commands also accept --label "<label>", --full-access, --no-questions, and --model "<model>" arguments.
--full-access enables full access (dangerously skip permissions) for the agent session.
--no-questions enables autonomous mode (agent won't ask permission questions, auto-accepts all).
--model sets the model (e.g. "opus", "sonnet", "haiku" for Claude; "pro", "flash" for Gemini).
Claude-specific flags: --dangerously-skip-permissions, --permission-mode "<mode>", --effort "<level>".
--dangerously-skip-permissions bypasses all permission checks for Claude.
--permission-mode sets permission mode (acceptEdits, bypassPermissions, default, dontAsk, plan, auto).
--effort sets the effort level for Claude sessions (low, medium, high, max).
Without --task agent will be started on project level. Within task context by default pass --task.
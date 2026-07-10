## Agent commands (Use these commands only if asked by the user. These commands open a new tab visible to the user.)
`taskflow-cli agent list` List available agents (type, availability, version)
`taskflow-cli agent run --prompt "<prompt>"` Start default agent with prompt
`taskflow-cli agent run --task <id>` Start default agent session on a specific task (uses task description)
`taskflow-cli agent run --task <id> --prompt "<prompt>"` Start default agent session on a task with custom prompt
`taskflow-cli agent run <agent> --task? --prompt?` Start a specific agent session
All run commands also accept --label "<label>" and --model "<model>" arguments.
--model sets the model (e.g. "fable", "opus", "sonnet", "haiku" for Claude; "pro", "flash" for Gemini).
Without --task agent will be started on project level. Within task context by default pass --task.
Claude-specific flags: --dangerously-skip-permissions, --permission-mode "<mode>", --effort "<level>".
--dangerously-skip-permissions bypasses all permission checks for Claude.
--permission-mode sets permission mode (manual, acceptEdits, bypassPermissions, dontAsk, plan, auto). The legacy default value inherits Claude's configured mode.
--effort sets the effort level for Claude sessions (low, medium, high, xhigh, max, ultracode; model and version dependent).
Codex-specific flags: --sandbox "<mode>", --approval-policy "<policy>", --reasoning-effort "<level>", --yolo.
--sandbox sets sandbox mode (read-only, workspace-write, danger-full-access).
--approval-policy sets approval policy (untrusted, on-request, never).
--reasoning-effort sets model reasoning effort (minimal, low, medium, high, xhigh, max, ultra; model-dependent).
--yolo bypasses Codex approvals and sandboxing. --dangerously-bypass-approvals-and-sandbox is the explicit alias.
OpenCode-specific flags: --variant "<variant>", --auto-approve.
--variant sets the agent variant.
--auto-approve enables auto-approval of all actions.
Gemini-specific flags: --approval-mode "<mode>", --gemini-sandbox.
--approval-mode sets approval mode (default, auto_edit, yolo, plan).
--gemini-sandbox enables sandbox mode for Gemini.
Cursor-specific flags: --yolo.
--yolo enables yolo mode (autonomous, no confirmations).

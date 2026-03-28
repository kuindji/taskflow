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

Note: `action run` spawns a session using the Action's saved config (prompt, session type, agent options).
Note: `action run` uses the action's saved agentOptions (fullAccess, model, etc.).
For ad-hoc sessions without a saved action, use `agent run`.
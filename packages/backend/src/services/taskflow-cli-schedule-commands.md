## Schedule commands
`taskflow-cli schedule list` List schedules (filtered by current project if set)
`taskflow-cli schedule create --expression "30m" --prompt "Check status"` Create a rate-based schedule (interval from last run start)
`taskflow-cli schedule create --expression "0 9 * * *" --type cron --prompt "Morning check"` Create a cron schedule
`taskflow-cli schedule create --expression "1h" --name "Hourly check" --timeout 10` With name and timeout (minutes, default: 30)
`taskflow-cli schedule create --expression "1h" --prompt "..." --foreground` Run in foreground — opens a visible session tab when fired (default: background/headless)
`taskflow-cli schedule update <id> --enable` Enable a schedule
`taskflow-cli schedule update <id> --disable` Disable a schedule
`taskflow-cli schedule update <id> --foreground` Switch schedule to foreground execution (opens a tab when fired)
`taskflow-cli schedule update <id> --background` Switch schedule to background execution (headless, default)
`taskflow-cli schedule update <id> --prompt "New prompt"` Update schedule prompt
`taskflow-cli schedule delete <id>` Delete a schedule
`taskflow-cli schedule trigger <id>` Trigger a schedule immediately
`taskflow-cli schedule complete` Signal job completion — clears timeout, closes session, schedules next run. If not called, the job times out and logs an error.
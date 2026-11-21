## Schedule commands
`taskflow-cli schedule list` List schedules (filtered by current project if set)
`taskflow-cli schedule create --expression "30m" --prompt "Check status"` Create a rate-based schedule (interval from last run start)
`taskflow-cli schedule create --expression "0 9 * * *" --type cron --prompt "Morning check"` Create a cron schedule
`taskflow-cli schedule create --expression "1h" --name "Hourly check" --timeout 10` With name and timeout (minutes, default: 30)
`taskflow-cli schedule update <id> --enable` Enable a schedule
`taskflow-cli schedule update <id> --disable` Disable a schedule
`taskflow-cli schedule update <id> --prompt "New prompt"` Update schedule prompt
`taskflow-cli schedule delete <id>` Delete a schedule
`taskflow-cli schedule trigger <id>` Trigger a schedule immediately
`taskflow-cli schedule complete` Signal job completion — clears timeout, closes session, schedules next run. If not called, the job times out and logs an error.
`taskflow-cli schedule create --expression "rate(1 minute)" --prompt "Triage inbox" --condition-script "./scripts/inbox-has-items.sh"` Check before starting a session.
`taskflow-cli schedule update <id> --condition-script "./scripts/inbox-has-items.sh"` Set a condition script.
`taskflow-cli schedule update <id> --condition-script ""` Remove the condition.

The condition runs without an agent in the project folder on the project's machine, using its default shell and Taskflow PATH. It also runs for manual triggers. Exit 0 starts the session, exit 1 skips the occurrence, and any other exit or a 30-second timeout records an error without starting a session. A skip or check failure advances the next due time and leaves lastRunAt unchanged. The script receives TASKFLOW_PROJECT_ID, TASKFLOW_SCHEDULE_ID, TASKFLOW_API_URL, and TASKFLOW_API_TOKEN, so it can use taskflow-cli. Scripts must be non-interactive. Use the shell command to invoke another runtime if needed, such as `python3 scripts/check_inbox.py`.

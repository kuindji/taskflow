## Dev server commands
`taskflow-cli devserver add --pid <pid> --label "<label>"` Register a dev server you started so the user can see and stop it in Taskflow. Registering the same pid again updates its label.
`taskflow-cli devserver list` List the dev servers registered for the current task (or project, in a project-level session).
`taskflow-cli devserver list --all` List every registered dev server.
`taskflow-cli devserver remove <id>` Forget a registered dev server. It does not stop the process.
`taskflow-cli devserver remove --pid <pid>` Forget a registered dev server by pid. It does not stop the process.

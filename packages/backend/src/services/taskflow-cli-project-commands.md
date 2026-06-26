## Project commands
`taskflow-cli project list` List all projects
`taskflow-cli project add /path/to/project` Add a project by path
`taskflow-cli project add /path/to/project --name "My Project"` Add with custom name
`taskflow-cli project remove <projectId>` Remove a project
`taskflow-cli project update <projectId> --name "New Name"` Rename project
`taskflow-cli project update <projectId> --hidden` Hide project
`taskflow-cli project update <projectId> --visible` Unhide project
`taskflow-cli project fork <projectId> <branch>` Create a local git clone of the project in a sibling directory, check out the given branch, and register it as a new project. (Not a worktree).
`taskflow-cli project fork <projectId> <branch> --folder custom-name` Use a custom folder name instead of slugified branch name.
`taskflow-cli project move <id> --to <n>`          Move project to 1-based position n
`taskflow-cli project move <id> --before <id>`     Move project before another project
`taskflow-cli project move <id> --after <id>`      Move project after another project
## Attribute commands

Attributes are name/value pairs attached to a task or a project. A value is always a plain string.

Attributes resolve in layers: **project → parent task → task**. A higher layer shadows a lower one with the same name, and the shadowed attribute does not appear in `attr list`.

Scope is inferred from the session: inside a task it is the task, inside a project session it is the project. Pass `--task-id <id>` or `--project-id <id>` on any subcommand to target a different owner explicitly.

`taskflow-cli attr list` List the resolved attributes for the current scope
`taskflow-cli attr list --own` List only this task's (or project's) own attributes
`taskflow-cli attr get <id>` Get one attribute by id, including its scope
`taskflow-cli attr create "<name>"` Create an attribute with an empty value
`taskflow-cli attr create "<name>" "<value>"` Create an attribute with a value
`taskflow-cli attr set <id> "<value>"` Replace an attribute's value
`taskflow-cli attr rename <id> "<name>"` Rename an attribute
`taskflow-cli attr delete <id>` Delete an attribute

`taskflow-cli attr list --project-id <id>` Read a specific project's attributes
`taskflow-cli attr create "env" "prod" --project-id <id>` Create a project attribute
`taskflow-cli attr set <id> "value" --task-id <id>` Edit another task's attribute

Names are trimmed and must be unique within one owner's own list. A task may reuse a project attribute's name — that is how you override it.

`get` finds an attribute in any layer, so an inherited or shadowed attribute is still readable by id. `set`, `rename` and `delete` only work on the current scope's own attributes; pass `--project-id` or `--task-id` to edit another owner's.

# Task and Project Attributes

## Summary

Tasks and projects gain a list of named string attributes. Attributes serve two audiences: agents, which read and write them through `taskflow-cli`, and people, who edit them in the task info panel.

An attribute is deliberately minimal — an id, a name, and a plain string value. There is no type system, no schema, no validation beyond name uniqueness within a list.

## Data model

New shared type in `packages/shared/src/types/attribute.ts`:

```ts
export interface Attribute {
    id: string; // uuid, stable handle
    name: string; // trimmed, non-empty, unique within its own list
    value: string; // plain string, may be empty
}
```

`Task` and `Project` each gain `attributes: Attribute[]`.

Attributes are stored inline in the existing records — `tasks/<id>.json` and `projects.json`. No new files, no new directories.

Ordering is insertion order and is preserved as authored. Nothing sorts the list.

### Back-compat

Records written before this feature have no `attributes` field. Reads normalize it, following the pattern already used for `pinned`:

- `TaskStore.readTask` adds `attributes: task.attributes ?? []`
- `TaskStore.listProjects` adds `attributes: project.attributes ?? []`

The field is therefore non-optional in the type. Consumers never handle `undefined`.

## Resolution semantics

Three layers, lowest precedence to highest:

1. **project** — the project the task belongs to
2. **parent** — the parent task, for subtasks only
3. **task** — the task itself

Name uniqueness is enforced *within* a layer only. Two layers may use the same name; the higher layer shadows the lower one.

A shadowed attribute is dropped entirely from the resolved view. It is not shown dimmed and not returned by `attr list`. The resolved list contains exactly one entry per distinct name.

What each owner resolves:

- a subtask resolves all three layers
- a top-level task resolves project → task
- a project resolves only its own list

### The resolver

One pure function in `packages/shared/src/utils/attributes.ts`:

```ts
type AttributeScope = "project" | "parent" | "task";

interface ResolvedAttribute extends Attribute {
    scope: AttributeScope;
}

interface AttributeLayer {
    scope: AttributeScope;
    attributes: Attribute[];
}

// layers are passed lowest-precedence first
function resolveAttributes(layers: AttributeLayer[]): ResolvedAttribute[];
```

Output is grouped by scope in precedence order, and each group preserves its own insertion order. An attribute appears at the position of the layer that owns the winning value — so a project attribute shadowed by a task attribute vanishes from the project group rather than being replaced in place.

Both the UI and the backend call this function. There is one implementation of the merge rule.

### Validation

A shared helper validates a name against a target list:

- the name is trimmed before storage
- an empty name after trimming is rejected
- a name that collides with another name in the *same* list is rejected

Collision is an error, never a silent overwrite. Validation runs in `TaskStore`, which is the single write path; the UI also runs it to show inline errors before dispatching, but the store is the authority.

Uniqueness is checked against the target list alone. Creating a task attribute whose name matches an inherited project or parent attribute is allowed and expected — that is how shadowing is authored.

## Backend

### Store methods

`TaskStore` gets granular methods rather than whole-array writes, so that a UI edit and a concurrent agent write cannot clobber each other:

```
createTaskAttribute(taskId, name, value): Promise<Task>
updateTaskAttribute(taskId, attrId, { name?, value? }): Promise<Task>
deleteTaskAttribute(taskId, attrId): Promise<Task>

createProjectAttribute(projectId, name, value): Promise<Project>
updateProjectAttribute(projectId, attrId, { name?, value? }): Promise<Project>
deleteProjectAttribute(projectId, attrId): Promise<Project>
```

Each is a read-modify-write. Task mutations run inside the existing `withTaskMutation` lock, keyed by task id.

Project mutations go through `updateProject`, which today is an *unlocked* read-modify-write over the whole projects file — two concurrent attribute creates would both read the same list and the second write would silently drop the first. This work therefore adds a projects-file mutation lock and wraps `updateProject`'s body in it, and uses `updateProject`'s function form so the read happens inside that lock. The fix benefits every project update, not only attributes.

`addProject` is deliberately left unlocked: the lock is not reentrant and `addProject` calls `updateProject` on its duplicate-path branch. `addProject` racing `updateProject` remains possible, as it is today.

Each returns the whole updated `Task` or `Project`, which handlers broadcast as the existing `TASK_UPDATED` / `PROJECT_UPDATED` events. No new event types are needed, and every store in the UI refreshes through the path it already uses.

### WS messages

Three new messages for the UI, each carrying an owner discriminator of `{ taskId }` or `{ projectId }`:

- `ATTR_CREATE` — `{ owner, name, value }`
- `ATTR_UPDATE` — `{ owner, attrId, name?, value? }`
- `ATTR_DELETE` — `{ owner, attrId }`

### HTTP routes

Used by `taskflow-cli`. Registered under both `/api/tasks/:taskId/attributes` and `/api/projects/:projectId/attributes`:

| Method   | Path                | Purpose                                            |
| -------- | ------------------- | -------------------------------------------------- |
| `GET`    | `/attributes`       | resolved view; `?own=1` returns this list only      |
| `GET`    | `/attributes/:attrId` | single attribute, with its scope                  |
| `POST`   | `/attributes`       | create; body `{ name, value? }`                    |
| `PATCH`  | `/attributes/:attrId` | update; body `{ name?, value? }`                 |
| `DELETE` | `/attributes/:attrId` | delete                                           |

`GET /api/projects/:projectId/attributes` has no layers below it, so `?own=1` is a no-op there and the resolved view equals the project's own list.

## CLI

```
taskflow-cli attr list                          # resolved view for the current context
taskflow-cli attr list --own                    # only this owner's own attributes
taskflow-cli attr get <id>
taskflow-cli attr create "<name>" ["<value>"]   # value optional, defaults to ""
taskflow-cli attr set <id> "<value>"
taskflow-cli attr rename <id> "<name>"
taskflow-cli attr delete <id>
```

Every command addresses an existing attribute by id. The only commands taking a name are `create` and `rename`, where the argument is unambiguously a name. Agents discover ids through `attr list`.

### Scope

Scope is inferred from the environment the agent runs in:

- `TASKFLOW_TASK_ID` is set → task scope
- otherwise `TASKFLOW_PROJECT_ID` is set → project scope
- neither → error

Every `attr` subcommand also accepts `--task-id <id>` or `--project-id <id>` to target a specific owner explicitly. These override both the environment and the pre-command global flags. This is the path for a master agent editing attributes on some other task or project — permitted, but it has to be explicit.

`--project-id` matches the name of the existing global flag. `--task-id` is new; the existing pre-command global for task context stays `--task`, unchanged.

### Reads resolve across layers, writes do not

Ids are uuids and therefore unique across layers, which makes two rules possible:

- **Reads resolve across the merge.** In task context, `attr get <id>` finds the attribute whether it lives on the task, the parent, or the project, and reports which scope owns it. A shadowed attribute is still fetchable by id — shadowing hides it from `attr list`, not from a direct read.
- **Writes are own-list only.** `set`, `rename`, and `delete` operate on the current scope's own list. Passing an id belonging to an inherited layer is an error naming the owner:

    ```
    Error: attribute <id> belongs to project "taskflow"; use --project-id <id> to edit it
    ```

This mirrors the UI, where inherited rows are read-only.

### Documentation

A new `packages/backend/src/services/taskflow-cli-attribute-commands.md`, referenced from the skill index the same way the other split command docs are — as a path the agent reads on demand, not inlined.

## UI

Both surfaces live in `TaskInfoPanel`, which already renders a project view and a task view.

### Project view

An "Attributes" section: one row per attribute with a name input, a value input, and a delete button, plus an "Add attribute" control. Saves are debounced on the same pattern as the existing project fields, but dispatch the granular WS messages rather than a whole-object update.

### Task view

The same editable section for the task's own attributes, preceded by a read-only "Inherited" block listing the resolved project and parent-task attributes that survive shadowing. Each inherited row carries a small badge naming its scope.

Adding a task attribute whose name matches an inherited one makes that inherited row disappear. This is the shadowing rule made visible, and it needs no separate explanation in the UI.

A duplicate name within the editable list shows an inline error and does not save.

Project-level attributes are never editable from the task view.

## Testing

**`packages/shared`** — unit tests for `resolveAttributes`:

- two-layer merge (project → task)
- three-layer merge (project → parent → task)
- shadowing at each level, including a name defined in all three
- order preservation within each group
- empty layers, and an empty layer list

**Backend store** — tests for:

- create / rename / set / delete round-trips on both tasks and projects
- duplicate-name rejection within a layer
- the same name accepted across two different layers
- reading a record with no `attributes` field, which must yield `[]`

**API** — a test for resolved output through `GET /api/tasks/:id/attributes`, covering the scope labels and the omission of shadowed entries.

## Out of scope

Explicitly not part of this work, and deliberately so:

- attribute substitution into action prompts or init commands
- filtering, grouping, or searching tasks by attribute
- exporting attributes as environment variables on session spawn
- injecting attribute values into agent system prompts
- typed values, enums, or any schema

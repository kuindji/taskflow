# Built-in Actions — Design

Date: 2026-09-24
Status: approved in chat, pending spec review

## Problem

Taskflow has four built-in AI behaviours. Each one hardcodes its agent, model and prompt:

| Built-in | Runs as | Today |
|---|---|---|
| Generate task title | headless | `claude -p --model haiku`, prompt via stdin — `packages/backend/src/services/title-generator.ts:24-31` |
| Generate schedule name | headless | `claude -p --model haiku`, prompt via stdin — `packages/backend/src/index.ts:360-368` |
| Generate commit message | headless | `claude -p <prompt>` (default model, prompt in argv), cwd = repo — `packages/backend/src/services/git-pr.ts:72-108` |
| Commit with agent | interactive session | prompt assembled in the UI from checkboxes; agent type and options picked in the dialog — `packages/ui/src/components/workspace/CommitDialog.tsx:181-207` |

Commit `17b4aa1c` added agent pickers to the commit dialog. The user rejected that approach. Built-ins should be configured the same way user actions are: in the **Actions and Flows** dialog.

## Goals

1. The Actions and Flows dialog's filter dropdown gets a **Built-in** entry. It lists the built-in actions.
2. Each built-in's prompt and agent (type + options) can be edited. Example: switch title generation from Claude/Haiku to Codex/`gpt-5.6-luna`.
3. **Reset to default** restores the default prompt, agent type and agent options.
4. Every supported agent (`claude`, `codex`, `opencode`, `pi`, `kimi`) can run the headless built-ins.
5. The defaults reproduce today's behaviour exactly: the same agent, the same model, and the same prompt text byte for byte.

## Non-goals

- Built-in management in the TUI (the TUI is remote-first and doesn't replicate app dialogs). The TUI's commit-message request already goes through the backend, so it honours overrides without changes.
- `taskflow-cli` commands for built-ins. `taskflow-cli action list` stays unchanged and doesn't list built-ins.
- Per-project overrides of built-ins. An override applies to the whole machine (backend).
- Using built-ins inside flows, the Run menu, or as standalone actions.
- Creating, deleting, or renaming built-ins.

## Built-in catalogue

The ids are fixed. The defaults live in `packages/shared` (both the backend and the UI need them).

| Id | Name | Mode | Default agent | Default options | Variables (all required) |
|---|---|---|---|---|---|
| `builtin:task-title` | Generate task title | `headless` | `claude` | `{ type: "claude", model: "haiku" }` | `description` |
| `builtin:schedule-name` | Generate schedule name | `headless` | `claude` | `{ type: "claude", model: "haiku" }` | `prompt` |
| `builtin:commit-message` | Generate commit message | `headless` | `claude` | none | `diff` |
| `builtin:commit` | Commit with agent | `session` | *user's default agent* | none | `instructions` |

Default templates reproduce the current strings exactly:

- `builtin:task-title`:
  `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: {{description}}`
- `builtin:schedule-name`:
  `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: {{prompt}}`
- `builtin:commit-message` (the lines currently joined with `\n`):
  `Generate a concise git commit message for the following changes.\nOutput ONLY the commit message — no explanation, no markdown, no quotes.\nUse conventional commit format (e.g. feat:, fix:, refactor:).\n\n{{diff}}`
- `builtin:commit`: `{{instructions}}`. `instructions` is the sentence list the dialog builds today (staged/all, `Commit message hint: …`, push, PR), joined with a single space. The dialog's logic for building those sentences doesn't change.

`builtin:commit` has no default agent type. An unset `sessionType` means "use `settings.general.defaultAgent` of the workspace's machine", which is how the dialog behaves today.

## Data model (`packages/shared/src/types/builtin-action.ts`)

```ts
type BuiltinActionId =
    | "builtin:task-title"
    | "builtin:schedule-name"
    | "builtin:commit-message"
    | "builtin:commit";

type BuiltinActionMode = "headless" | "session";

interface BuiltinActionVariable {
    name: string;        // placeholder name, used as {{name}}
    description: string; // shown in the editor
}

// Code-owned default. Never persisted.
interface BuiltinActionDefault {
    id: BuiltinActionId;
    name: string;
    description: string;
    mode: BuiltinActionMode;
    prompt: string;
    sessionType?: AgentType;          // undefined = user's default agent
    agentOptions?: AgentLaunchOptions;
    variables: BuiltinActionVariable[];
}

// What the user changed. Persisted. Fields are all-or-nothing: an override is a full
// snapshot of prompt + sessionType + agentOptions taken at save time.
interface BuiltinActionOverride {
    id: BuiltinActionId;
    prompt: string;
    sessionType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    updatedAt: string;
}

// Effective definition sent to the UI: default merged with override.
interface BuiltinActionDefinition extends BuiltinActionDefault {
    isModified: boolean;
    updatedAt?: string;
}
```

Shared helpers (in `packages/shared`, exported only as far as they're used):

- `BUILTIN_ACTION_DEFAULTS: Record<BuiltinActionId, BuiltinActionDefault>` and `isBuiltinActionId(value)`.
- `renderPromptTemplate(template, vars)`: replaces each `{{name}}` with `vars[name]`. It leaves unknown placeholders as they are and does **not** re-scan substituted text, so a diff that contains `{{x}}` stays literal.
- `missingPromptVariables(template, variables)`: returns the required variable names that are absent from the template.

A full-snapshot override (instead of a per-field patch) keeps reset trivial: delete the entry. It also makes `isModified` exact.

## Backend

### Storage

Persistence lives in `FlowStore` (`packages/backend/src/services/flow-store.ts`), next to `actions.json`, using the same `withMutation("definitions", …)` lock and `writeFile` pattern as `saveAction`:

- `getBuiltinActionOverrides(): BuiltinActionOverride[]` reads `builtin-actions.json`. A missing file means `[]`.
- `saveBuiltinActionOverride(override)` upserts by `id`.
- `deleteBuiltinActionOverride(id)` removes by `id`.

Merging and validation live in `packages/backend/src/services/builtin-actions.ts`, as `createBuiltinActions({ flowStore })`:

- `list(): BuiltinActionDefinition[]` returns all four in catalogue order, each merged with its override.
- `get(id): BuiltinActionDefinition` returns one merged definition.
- `save(override)` validates, then upserts. Validation:
  - `id` must be known
  - `prompt` must be non-empty and have no missing required variables
  - `sessionType` must be undefined or satisfy `isAgentType` (shell is not allowed)
  - `agentOptions.type` must equal `sessionType` when both are set
  - when `sessionType` is undefined (allowed only for `builtin:commit`), `agentOptions` must be undefined

  Validation failures throw with a user-readable message.
- `reset(id)` deletes the override.
- On read, overrides with an unknown `id` or a `sessionType` that fails `isAgentType` are ignored. They never crash `list()`, and the default is used instead.

### WS messages (`packages/shared/src/constants.ts` `MSG`, types in `ws.ts`)

- `BUILTIN_ACTIONS_LIST` → `{ actions: BuiltinActionDefinition[] }`
- `BUILTIN_ACTION_SAVE` payload `BuiltinActionOverride` (the backend overwrites `updatedAt`) → `BuiltinActionDefinition`
- `BUILTIN_ACTION_RESET` payload `{ id }` → `BuiltinActionDefinition`

These are registered in a new `packages/backend/src/handlers/builtin-action.ts` and wired in `packages/backend/src/index.ts`.

### Headless runner (`packages/backend/src/services/headless-agent.ts`)

`buildHeadlessCommand(type, options, prompt, outputFile)` is pure and returns `{ command, args, stdin?: string, outputFile?: string }`. Only options that make sense for a one-shot run are applied:

| Agent | Command | Options applied | Prompt delivery | Output |
|---|---|---|---|---|
| claude | `claude -p [--model m] [--effort e]` | model, effort | stdin | stdout |
| codex | `codex exec --ephemeral --skip-git-repo-check -s read-only [-m m] [-c model_reasoning_effort="e"] -o <file> -` | model (skip `"default"`), reasoningEffort | stdin (`-` = read stdin) | `<file>` |
| opencode | `opencode run [-m m]` | model | stdin | stdout |
| pi | `pi -p --no-session [--model m] [--thinking t] <prompt>` | model, thinking (skip `"off"`) | argv | stdout |
| kimi | `kimi -p <prompt> [-m m]` | model | argv | stdout |

Verified on 2026-09-24:
- `codex exec --help` documents `-` / stdin.
- `opencode run` answers a piped stdin prompt and prints only the answer on stdout; its decorations go to stderr.
- `kimi -p ""` fails with "Prompt cannot be empty", so Kimi needs argv.
- Pi's stdin behaviour couldn't be checked (no provider credentials on this machine), so it uses argv.

argv delivery for large commit diffs is the same exposure `claude -p <diff>` has today, so it's no regression.

Ignored options include `permissionMode`, `sandbox`, `approvalPolicy`, `dangerouslyBypassApprovalsAndSandbox`, `autoApprove`, `tools` and Kimi's `permissionMode`. A headless run is read-only text generation. Codex is forced to `-s read-only`.

`runHeadlessAgent({ type, options, prompt, cwd?, env, timeoutMs = 120_000 })`:
- spawns via `Bun.spawn` with stdout/stderr piped and the prompt written to stdin when `stdin` is set
- for codex, creates a unique temp file for `-o`, reads it after exit, and deletes it in `finally`
- kills the process on timeout and throws
- throws on a non-zero exit or empty output; otherwise returns the trimmed output

### Environment — generalise `headlessClaudeEnv`

`headlessAgentEnv(type, options, settings, project)` replaces `headlessClaudeEnv` in `agent-accounts.ts`:

- strips `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`
- sets `PATH: buildShellPath()`
- for `claude` / `codex`, resolves the account through `resolveAgentAccount(type, options, project, settings)` and adds `accountEnv(type, override)`. Precedence stays: the action's `account` option, then the project, then the global default.
- for opencode, adds nothing extra
- for pi, adds nothing extra
- for kimi, adds `KIMI_CODE_NO_AUTO_UPDATE: "1"`

`headlessClaudeEnv` has exactly three callers: `title-generator.ts:29`, `index.ts:366` and `handlers/git.ts:192`. All three move to the runner, so `headlessClaudeEnv` is deleted.

### Running a built-in — `runBuiltinAction`

`createBuiltinActionRunner({ builtinActions, settingsStore })` returns `runHeadless(id, vars, { cwd?, project })`. It:
1. loads the effective definition and asserts `mode === "headless"`
2. renders the template
3. resolves `sessionType`
4. builds the env
5. calls `runHeadlessAgent`

Call sites keep their current fallback behaviour:
- **task title** (`title-generator.ts`): failure or empty output creates the worktree from the description. Keep the quote-stripping.
- **schedule name** (`index.ts` `generateScheduleName`): failure falls back to `prompt.slice(0, 50)` / `"Unnamed schedule"`. Keep the quote-stripping.
- **commit message** (`git-pr.ts` `generateCommitMessage`): computing the diff and the "No changes to commit" error stay. The spawn is replaced by the runner with `cwd = repoPath`. Failure throws `"Failed to generate commit message"`. The `env` parameter of `GitService.generateCommitMessage` is replaced by whatever the runner needs (the project) so the git handler no longer builds a Claude env itself.

## UI

### Flow store

`packages/ui/src/stores/flow-store.ts` gets `builtinActions` (per-backend, same `backendId` tagging as `actions`), `fetchBuiltinActions(backendId)`, `saveBuiltinAction(backendId, override)` and `resetBuiltinAction(backendId, id)`. The save and reset functions replace the stored entry with the returned definition.

### Actions and Flows dialog (`FlowManagementDialog.tsx`)

- The filter gets `<SelectItem value="builtin">Built-in</SelectItem>`, placed after "Global".
- `"all"` keeps meaning user flows and actions only. Built-ins show only under "Built-in".
- Under "Built-in":
  - the Actions tab lists `builtinActions` for the primary backend. Each row shows the name, the agent type (or "Default agent"), and a "Modified" marker when `isModified`.
  - the Flows tab shows the empty state "Built-in actions can't be used in flows".
  - the ➕ (create) button is hidden.
- Selecting a built-in renders `BuiltinActionEditor`.
- `referencedProjectIds`, project-filter validation and `defaultProjectId` treat `"builtin"` like `"global"` (it isn't a project id).

### `BuiltinActionEditor` (`packages/ui/src/components/flows/BuiltinActionEditor.tsx`)

- Header: name, plus description as muted text.
- **Agent** select: `claude`, `codex`, `opencode`, `pi`, `kimi` (no shell). For `builtin:commit` it also offers "Default agent (<name>)", which maps to `sessionType: undefined`. Changing the agent clears the agent options, the same as `ActionEditor.handleSessionTypeChange`.
- **Prompt**: the same `ExpandableTextarea` as `ActionEditor`.
- **Variables**: a list of `{{name}}` with a description. Missing required variables show an inline error and disable Save.
- **Agent options**: `AgentOptionsPanel` with a new `headless` prop when `mode === "headless"`. It hides:
  - claude: permission mode
  - codex: sandbox, approval policy, bypass
  - opencode: auto-approve
  - pi: tools
  - kimi: permission mode

  When the panel is hidden, the values those fields emit must be dropped from the saved options, or the snapshot diff will flag changes that never happened. It isn't rendered when the agent is "Default agent".
- Footer:
  - **Reset to default** is enabled only when `isModified`. It opens `ConfirmDeleteDialog`-style confirmation, then calls `resetBuiltinAction`.
  - **Cancel**
  - **Save** is enabled when there are changes and the prompt is valid.
- Change detection reuses `ActionEditor`'s snapshot approach (`snapshotAgentOptions` / `normalizeAgentOptions`). Pull the shared bit into a helper instead of copying it.

### Commit dialog (`CommitDialog.tsx`)

- Remove: agent type select, `AgentOptionsPanel`, and the `agentType` / `agentOptions` / `agentOptionsOpen` / `agentOptionsKey` state and handlers added in `17b4aa1c`.
- Keep the **Use agent** switch. Beside it, add a muted hint: "Configured in Actions and Flows → Built-in".
- On submit in agent mode:
  1. build the `instructions` string exactly as today
  2. fetch `builtin:commit` fresh from the workspace's machine via `BUILTIN_ACTIONS_LIST`. If that machine has no handler for the message (it predates built-ins), use the default. Any other error is shown and no session starts.
  3. set `prompt = renderPromptTemplate(def.prompt, { instructions })`
  4. set `agent = def.sessionType ?? defaultAgent`, and pass `agentOptions` only when `def.sessionType` is set (options belong to that agent)
  5. call `createSession(sessionOwner, agent, "Commit", prompt, undefined, agentOptions)`
- Direct mode (message generation) stays as it is. The backend now honours the override.

## Error handling

- Headless failures keep the current user-visible behaviour: the title falls back to the description, the schedule name to a truncation, and the commit message shows the existing error. A missing CLI is just a spawn failure and takes the same path.
- Save validation errors come back from the backend and show in the editor's error line.
- An unknown agent type in a persisted override (removed agent) is dropped on read, and the default is used.

## Testing

- **shared**:
  - `renderPromptTemplate` covers substitution, unknown placeholders, and no re-scan of substituted text
  - `missingPromptVariables`
  - for each default, `renderPromptTemplate(default.prompt, vars)` equals the literal string today's code builds. These tests are the regression guard for "defaults unchanged".
- **backend**:
  - `buildHeadlessCommand` for every agent, including ignored options and codex `-o`/stdin
  - `createBuiltinActions` list/get/save/reset/`isModified`, rejection of missing placeholders, shell, and mismatched option types, plus tolerance of a corrupt file
  - `runHeadlessAgent` timeout and empty-output handling, with a fake command
  - the title generator, schedule-name generator and commit-message generator use the override and keep their fallbacks
  - the existing tests in `tests/handlers/git.test.ts` / `task.test.ts` that pin `claude -p` args are updated
- **ui**:
  - the dialog filter shows built-ins only under "Built-in" and hides ➕
  - the editor saves and resets, and blocks save on a missing variable
  - the `headless` prop hides the listed fields
  - `CommitDialog.test.tsx` agent tests are rewritten: agent mode uses the built-in's agent/options/prompt and falls back to the default agent

Run UI component tests one file at a time (known `mock.module` leakage).

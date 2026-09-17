# Multi-account agents (Claude, Codex)

Date: 2026-09-17
Status: design approved in chat, pending spec review

## Goal

Let one Taskflow backend run Claude and Codex sessions against different
subscriptions. The account is chosen manually at three levels: global default,
per project, and per launch (agent options).

## Non-goals

- Automatic fallback when an account hits usage limits, or balancing sessions
  across accounts. The data model must not preclude adding fallback later.
- Creating, logging in, or populating account home directories. Taskflow never
  writes inside them. Sharing config/plugins/history between accounts is the
  user's business (e.g. symlinks).
- Accounts for OpenCode, Pi, Kimi.
- Account-aware Codex model listing.

## Concept

An account is a named home directory for one agent CLI:

- Claude: launched with `CLAUDE_CONFIG_DIR=<homeDir>`
- Codex: launched with `CODEX_HOME=<homeDir>`

The built-in account id `"default"` sets no variable. The agent then uses its
normal home, or whatever the backend's inherited environment already sets.

Two values are kept separate throughout:

- **override**: the variable Taskflow adds to the env (`null` for `"default"`).
- **effective home**: the directory the CLI will actually use:
  `override ?? process.env.<VAR> ?? ~/.claude | ~/.codex`. Discovery, the
  slash-command lookup, and the saved `SessionRef.agentHomeDir` all use the
  effective home, so an inherited `CODEX_HOME` is still found.

## Pre-implementation verification (gate)

Before any code, verify manually on macOS:

1. Two different `CLAUDE_CONFIG_DIR` values hold two independent logins. On
   macOS, check that the Keychain credentials are separated per config dir.
2. `claude --resume <id>` finds a session created under a non-default
   `CLAUDE_CONFIG_DIR` when launched with the same variable.
3. Two `CODEX_HOME` values hold independent `auth.json` logins, and
   `codex resume <id>` works under the same `CODEX_HOME`.

If (1) fails, stop and redesign the Claude side.

## Data model

### Shared types (`packages/shared/src/types`)

```ts
// agent.ts
type AccountAgentType = Extract<AgentType, "claude" | "codex">;
const DEFAULT_AGENT_ACCOUNT_ID = "default";

interface AgentAccount {
    id: string;       // stable, generated; never "default"
    name: string;     // user-visible, unique per agent type
    homeDir: string;  // absolute path on the backend machine
}

interface ClaudeLaunchOptions { /* existing */ account?: string }
interface CodexLaunchOptions  { /* existing */ account?: string }

// settings.ts
interface ClaudeSettings { /* existing */ accounts: AgentAccount[]; defaultAccount: string }
interface CodexSettings  { /* existing */ accounts: AgentAccount[]; defaultAccount: string }

// project.ts
interface Project { /* existing */ agentAccounts?: Partial<Record<AccountAgentType, string>> }

// task.ts
interface SessionRef { /* existing */ agentHomeDir?: string }
```

`account` on launch options is an account id. Undefined means "inherit".
Settings defaults: `accounts: []`, `defaultAccount: "default"`. The settings
store's load path fills these in for existing settings files.

Account paths are local to each backend. Remote backends keep their own
account lists, the same way settings work today.

## Resolution

A single backend helper:

```ts
resolveAgentAccount(
    type: AccountAgentType,
    options: AgentLaunchOptions | undefined,
    project: Project | undefined,
    settings: Settings,
): { accountId: string; override: string | null; effectiveHomeDir: string }
```

Precedence: `options.account` → `project.agentAccounts[type]` →
`settings[type].defaultAccount` → `"default"`.

- `"default"` returns `override: null`.
- An id not found in `settings[type].accounts` throws an error naming the
  agent, the id, and which level it came from (options / project / default).
  The launch fails. There is no silent fallback to the default account.
- Directory existence and login state are not checked. The CLI's own error
  shows up in the terminal.

## Launch (`session-lifecycle.ts`)

After options are merged, for `claude` and `codex` only:

1. If this is a resume, skip resolution entirely (see Resume).
2. Otherwise call `resolveAgentAccount`.
3. If `override` is non-null, add `CLAUDE_CONFIG_DIR` or `CODEX_HOME` to the
   spawn env.
4. Save `effectiveHomeDir` as `agentHomeDir` on the `SessionRef`;
   `agentOptions` already carries the account id.

UI tabs, actions, flows, schedules, TUI, REST `/api/sessions`, WS
`SESSION_CREATE` and `taskflow-cli agent run` all reach `createSession`, so they
get this without their own account logic.

The **remote agent** (`remote-agent-service.ts`) launches a master session
with no project and no `account` option, so it always uses the global Claude
default account. Master-workspace sessions resolve the same way.

### Account names at the API boundary

Stored data holds ids only. The backend session-create entry points (REST
`/api/sessions`, WS `SESSION_CREATE`) and project-update entry points accept a
unique account name or an id and turn it into an id before storing or
launching. An unmatched value fails with the "unknown account" error. The CLI
passes the user's value through unchanged, so neither CLI implementation needs
to read settings.

### Resume

`createSession` receives `resumeSession`. When it is set, `resolveAgentAccount`
is not called. The env override is `session.agentHomeDir` (set only if it
differs from the backend's inherited/native home, so a default session never
gains an explicit variable). A deleted or re-pointed account, or a changed
project/global default, therefore has no effect on resume. Sessions saved before this feature have no
`agentHomeDir` and resume on the default home, which matches today's behavior.

## Home-dir-aware call sites

| Call site | Change |
|---|---|
| `native-session-discovery.ts` (Codex) | `capture`/`discover` take the effective home and read `<home>/sessions`. The launch lock is keyed per effective home dir instead of per agent type. |
| `handlers/agent-commands.ts` (Claude slash commands) | User commands come from `<effective home>/commands` of the account the project resolves to, with no launch options. The payload gains an optional `projectId`; without it, the global default is used. |
| `runtime-detector.ts` `fetchCodexModels` | Unchanged; always uses the inherited/native home. |
| `git-pr.ts` `generateCommitMessage` (`claude -p`) | Uses the project's Claude account (the caller knows the project), falling back to the global default. |
| `title-generator.ts` (`claude -p --model haiku`) | Same rule: project account if the task's project is known, else global default. |
| `index.ts` `generateScheduleName` (`claude -p --model haiku`) | Global default Claude account. |

The three `claude -p` helpers each copy the "strip `CLAUDECODE` /
`CLAUDE_CODE_ENTRYPOINT`" env code today. They switch to one shared
`headlessClaudeEnv(projectId?)` helper that builds the cleaned env plus the
account override. An unknown account makes the helper throw, and each caller
keeps its existing failure handling (e.g. the fallback title).

## UI (desktop)

- **Settings → Claude / Codex sections:** an Accounts list (add, rename, edit
  home dir with a folder picker, delete) and a Default account dropdown with
  "Default (inherited environment)" first. The delete confirmation warns that projects,
  actions, and schedules referencing the account will fail to launch until
  changed.
- **Project (TaskInfoPanel, next to LinkedProjectsSection):** an "Agent
  accounts" section with a dropdown per agent ("Use global default" + accounts).
  It only renders for an agent that has at least one account.
- **AgentOptionsPanel:** an Account dropdown for Claude/Codex with "Inherit
  (project → default)" first. This covers actions, flows, schedules, and the
  launch dialog.
- **Tabs:** sessions on a non-default account show the account name next to the
  agent name. Default-account sessions look the same as today.

Account dropdowns list names. Stored values are ids. The built-in entry is
labelled "Default (inherited environment)", because it can mean an inherited
`CLAUDE_CONFIG_DIR`/`CODEX_HOME` rather than `~/.claude`/`~/.codex`.

### Option persistence paths that must carry `account`

Today these copy only listed fields and would silently drop `account`:

- `packages/ui/src/lib/normalize-agent-options.ts` (claude and codex cases)
- `packages/ui/src/components/flows/ActionEditor.tsx`, which has its own copy of
  the normalizer. Replace it with the shared one rather than patching both
  (repo rule: no duplication).
- `packages/tui/src/editor/validation.ts` `exactKeys` lists for claude/codex
  (validate `account` as an optional string)
- any other serializer found for inline flow actions and schedules

Picking "Inherit" in the dropdown removes the field (`account` undefined). It
is not stored as a sentinel value.

### Project update contracts

`ProjectUpdatePayload` (`shared/src/types/ws.ts`), the WS handler
(`handlers/project.ts`), and the REST route (`project-routes.ts`) accept
`agentAccounts`. A per-agent value of `null` clears that agent's override.

## CLI

Both implementations (POSIX `taskflow-cli.sh` and the TS bin) and the docs:

- `taskflow-cli agent run ... --account "<name or id>"` sets
  `agentOptions.account` verbatim. The backend turns names into ids (see
  "Account names at the API boundary").
- `taskflow-cli project update <projectId> --claude-account "<name|id|default>"`
  and `--codex-account ...`. `default` clears the project override.

## TUI

Only an account picker in session-launch options (`sessions/create-model.ts`).
Account list management stays in desktop settings.

## Testing

- `resolveAgentAccount`: every precedence level; unknown id at each level
  throws with the right source; `"default"` returns null.
- Launch: env var set for a non-default account, absent for default; `agentHomeDir`
  saved on the session.
- Resume: uses the saved `agentHomeDir` after the account's `homeDir` changes and
  after the account is deleted; `resolveAgentAccount` is not called.
- Inherited env: with `CODEX_HOME` set in the backend process and the `"default"`
  account, discovery reads the inherited dir and no override is added.
- Option normalizers (UI shared, TUI validation) keep `account`; "Inherit"
  removes it.
- API boundary: names become ids; unknown names fail; project update with `null`
  clears an override.
- Headless helpers: `headlessClaudeEnv` sets the override for the project account
  and throws on an unknown account.
- Codex discovery reads `<CODEX_HOME>/sessions`; two concurrent launches on
  different homes don't share a lock.
- Settings store: loading a file without `accounts`/`defaultAccount` fills in
  defaults; partial updates to accounts keep the other fields.
- CLI: `--account` goes through both implementations.
- Manual: the pre-implementation gate above, plus one real Claude and one real
  Codex session on a second account from the desktop UI.

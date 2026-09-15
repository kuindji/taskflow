# Taskflow

A desktop application for orchestrating AI coding agents. Taskflow gives you a single workspace to launch, manage, and switch between Claude Code and Codex CLI sessions -- with just enough context around them (files, diffs, notes) to stay oriented without leaving the app.

**Not a harness.** Taskflow does not inject extensive context, prompts, or orchestration logic into the agents it runs. It provides basic task information and flow control, but the agents operate with their own capabilities -- Taskflow is a workspace around them, not a layer on top.

There is a new term - ADE (agentic development environment). It suits this application well.

## What it does

Taskflow organizes your work into **projects** and **tasks**. Each task can have multiple agent sessions (Claude Code, Codex, or plain shell) running in terminal tabs. Around those sessions, it provides lightweight supporting tools -- a file browser, a diff viewer, basic editing, and git status -- so you can see what your agents are doing without constantly switching to a separate terminal or editor.

### Core capabilities

- **Agent session management** -- Launch Claude Code or Codex sessions with model selection and full-access mode. Run multiple sessions per task, rename them, and switch between them in tabs.
- **Terminal multiplexing** -- Multiple terminal tabs with scrollback history, clickable links, and font customization.
- **Task organization** -- Group sessions under tasks, add notes and descriptions, archive completed work. AI-generated task titles from descriptions.
- **Project context** -- File browser with gitignore filtering, basic file editing, git status and diffs, commit/push support. Enough to understand what changed without leaving the app.
- **Git worktrees** -- Optionally isolate each task in its own worktree so agents don't step on each other.

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- macOS (Intel or ARM)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://github.com/openai/codex) CLI installed
- `git` and optionally `gh` CLI

## TUI development

Run `bun run dev:tui` from the repository root. The command builds the local
backend and starts the TUI with a persistent, branch-specific config root beside
the production Taskflow directory. It prints the development instance and config
root before opening the terminal interface.

Set an absolute config root to run against a disposable or parallel instance:

```sh
TASKFLOW_CONFIG_DIR=/absolute/path bun run dev:tui
```

Relative `TASKFLOW_CONFIG_DIR` values are rejected before the backend starts.
Use a fresh disposable absolute directory for mutation-heavy development and
smoke testing so the development client cannot alter the production instance.
`TASKFLOW_DEV_BRANCH` can give parallel runs distinct branch identities:

```sh
TASKFLOW_CONFIG_DIR=/absolute/disposable/taskflow-tui \
TASKFLOW_DEV_BRANCH=stage3-smoke \
bun run dev:tui
```

### TUI machines

`taskflow-tui` opens a machine picker: This machine, saved machines, backends
discovered on the network, and Add machine. `Enter` connects, `a` adds a machine
(host, SSH user, SSH port, backend port), and `R`/`F` rename or forget a saved
one. The first connection to an SSH host shows its key fingerprint and asks
whether to trust it.

- `taskflow-tui <machine>` connects to a saved machine by name or id and skips
  the picker. If that connection fails, the picker opens with the error.
- `taskflow-tui --connect host:port` dials a backend directly, such as a tunnel
  you opened yourself, with no picker and no saved machines. Bracket IPv6 hosts
  (`[::1]:7777`). It can't be combined with a machine name.
- Inside the TUI, `m` reopens the picker to switch machines. It isn't available
  in a `--connect` session.

The TUI keeps saved machines and per-machine selections in its state directory:
`TASKFLOW_TUI_STATE_DIR` (absolute) when set, else
`$XDG_CONFIG_HOME/taskflow/tui`, else `~/.config/taskflow/tui`. `bun run dev:tui`
defaults it to `tui` inside the development config root.

### TUI keyboard commands

Application commands are available while the UI owns focus. From a session,
press `Ctrl+Escape` or `Escape Escape` to return to application controls.

- `Up`/`Down` or `j`/`k`: select an owner; `Enter` or `l`: open it or focus its
  active session; `1`-`9`: select a session tab.
- `m`: switch machine.
- `p`: add a project folder (`Tab` completes the path); `X`: hide or permanently
  remove the selected project; `J`/`K`: move it down/up; `L`: edit its linked
  projects.
- `A`: switch the sidebar between active and archived tasks. In the archive,
  `u` restores the selected task with its subtasks and `D` permanently deletes
  it. Only selection, read-only task details, filter, zoom, `m`, help and quit work
  there.

`p`, `X`, `J`, `K`, `L` and `D` need the backend to run on this machine. While
you're connected to another machine they are hidden from the footer, marked
"(this machine only)" in help, and pressing one shows `Only available on this
machine.` Removing a project asks whether to keep its data: with the toggle on,
the project is hidden and adding the same folder again restores it; with it off,
the project and its tasks are deleted. Deleting an archived task that has a
worktree offers to delete the worktree and branch too.
- `s`: new session; `q`: close the active session; `r`: resume an interrupted
  agent session.
- `t`: task details; `n`: create a task or subtask; `g`: repository changes and
  commits.
- `/`: filter the owner list by project name or task title.
- `f`: flows; `c`: schedules; `,`: settings; `!`: notifications.
- `z`: zoom the main pane; `Q`: quit; `?`: keyboard help.

Each product screen shows its contextual commands in the footer. Task details
support bounded field and attribute updates, pin/archive actions, and external
editor handoff for long text. Git changes supports file/all staging and
unstaging, diffs, and local commits; generated commit messages only run when
explicitly requested. Settings covers TUI runtime defaults and layout, while
notifications supports open, read, read-all, and clear-read actions. `Escape`
or `q` returns from a product screen, and a modal owns input until it closes.

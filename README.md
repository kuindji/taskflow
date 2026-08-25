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

### TUI keyboard commands

Application commands are available while the UI owns focus. From a session,
press `Ctrl+Escape` or `Escape Escape` to return to application controls.

- `Up`/`Down` or `j`/`k`: select an owner; `Enter` or `l`: open it or focus its
  active session; `1`-`9`: select a session tab.
- `s`: new session; `q`: close the active session; `r`: resume an interrupted
  agent session.
- `t`: task details; `n`: create a task or subtask; `g`: repository changes and
  commits.
- `f`: flows; `c`: schedules; `,`: settings; `!`: notifications.
- `z`: zoom the main pane; `Q`: quit; `?`: keyboard help.

Each product screen shows its contextual commands in the footer. Task details
support bounded field and attribute updates, pin/archive actions, and external
editor handoff for long text. Git changes supports file/all staging and
unstaging, diffs, and local commits; generated commit messages only run when
explicitly requested. Settings covers TUI runtime defaults and layout, while
notifications supports open, read, read-all, and clear-read actions. `Escape`
or `q` returns from a product screen, and a modal owns input until it closes.

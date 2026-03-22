# Taskflow

A desktop application for orchestrating AI coding agents. Taskflow gives you a single workspace to launch, manage, and switch between Claude Code and Codex CLI sessions -- with just enough context around them (files, diffs, notes) to stay oriented without leaving the app.

**Not a harness.** Taskflow does not inject extensive context, prompts, or orchestration logic into the agents it runs. It provides basic task information and flow control, but the agents operate with their own capabilities -- Taskflow is a workspace around them, not a layer on top.

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

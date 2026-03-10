# Taskflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop app for local developer machines that orchestrates Claude Code and Codex CLIs in a task-oriented workspace with project context.

**Architecture:** Electron shell (workspace launcher) + Bun backend service (PTY, git, files, persistence over WebSocket) + React renderer (Monaco, xterm.js, Zustand). Monorepo with shared types package.

**Tech Stack:** Bun, Electron, React, TypeScript, Monaco, xterm.js, Zustand, node-pty, WebSocket

**Runtime Scope:** v1 is verified as a workspace-run macOS desktop app. Electron launches the backend from the checked-out repo and expects Bun to be installed on the developer machine. Packaging Bun into a standalone distributable app is a follow-up milestone and is not part of this plan.

**Persistence:** Project metadata is stored under `~/.config/taskflow/projects.json`; tasks and archives live under `~/.config/taskflow/tasks/` and `~/.config/taskflow/archive/`. A project record stores the chosen folder path plus an optional display name.

---

## Chunks

| Chunk | Description | File |
|-------|-------------|------|
| 1 | Scaffolding + Shared Types | [taskflow-plan-chunk-1.md](taskflow-plan-chunk-1.md) |
| 2 | Backend Core — WebSocket Server + Project/Task CRUD | [taskflow-plan-chunk-2.md](taskflow-plan-chunk-2.md) |
| 3 | Backend Sessions, Files & Git | [taskflow-plan-chunk-3.md](taskflow-plan-chunk-3.md) |
| 4 | Electron Shell | [taskflow-plan-chunk-4.md](taskflow-plan-chunk-4.md) |
| 4.5 | shadcn/ui Primitives Setup | [taskflow-plan-chunk-4.5.md](taskflow-plan-chunk-4.5.md) |
| 4.6 | Alert & Confirm Dialogs | [taskflow-plan-chunk-4.6.md](taskflow-plan-chunk-4.6.md) |
| 5 | UI Core — Layout, WebSocket, Stores, Sidebar | [taskflow-plan-chunk-5.md](taskflow-plan-chunk-5.md) |
| 6 | UI Panes — Terminal, Editor, Changes | [taskflow-plan-chunk-6.md](taskflow-plan-chunk-6.md) |
| 7 | UI Panels, Browser, Wiring & Polish | [taskflow-plan-chunk-7.md](taskflow-plan-chunk-7.md) |

---

## File Structure

### packages/shared/
- `package.json` — package config
- `src/index.ts` — barrel export
- `src/types/project.ts` — Project model
- `src/types/task.ts` — Task, SessionRef models
- `src/types/ws.ts` — Request, Response, Event base types + all message type definitions
- `src/types/file.ts` — FileNode, FileChangeEvent types
- `src/types/git.ts` — GitStatus, GitDiff types
- `src/types/system.ts` — SystemInfo type
- `src/constants.ts` — message type string constants, config paths

### packages/backend/
- `package.json` — package config
- `src/index.ts` — entry point, starts HTTP+WS server
- `src/ws/server.ts` — WebSocket server setup using Bun.serve
- `src/ws/router.ts` — routes messages by type to handlers
- `src/handlers/project.ts` — project:list, project:add, project:remove
- `src/handlers/task.ts` — task:list, task:create, task:update, task:archive, task:delete
- `src/handlers/session.ts` — session:create, session:close, session:input
- `src/handlers/file.ts` — file:tree, file:read, file:write, file:watch, file:unwatch
- `src/handlers/git.ts` — git:status, git:diff, git:diff-file, git:revert-file, git:worktree-create
- `src/services/task-store.ts` — JSON file read/write for projects and tasks
- `src/services/pty-manager.ts` — spawn/manage PTY sessions via node-pty
- `src/services/file-watcher.ts` — FS watching, tree building
- `src/services/git-service.ts` — git CLI wrapper
- `src/services/editor-detector.ts` — detect installed editors (code, cursor, etc.)
- `src/utils/path-validation.ts` — shared workspace path validation helpers
- `src/config.ts` — paths (~/.config/taskflow/), defaults
- `tests/services/task-store.test.ts`
- `tests/services/git-service.test.ts`
- `tests/services/file-watcher.test.ts`
- `tests/services/pty-manager.test.ts`
- `tests/ws/router.test.ts`
- `tests/handlers/project.test.ts`
- `tests/handlers/task.test.ts`

### packages/ui/
- `package.json` — package config
- `src/index.tsx` — React entry point
- `index.html` — HTML template
- `src/App.tsx` — root component, wraps providers
- `src/providers/WebSocketProvider.tsx` — WS connection, message routing
- `src/hooks/useWebSocket.ts` — hook for sending requests + receiving responses
- `src/stores/project-store.ts` — useProjectStore
- `src/stores/task-store.ts` — useTaskStore
- `src/stores/session-store.ts` — useSessionStore
- `src/stores/file-store.ts` — useFileStore
- `src/stores/ui-store.ts` — useUIStore
- `src/stores/dialog-store.ts` — imperative confirm()/alert() + DialogStore
- `src/components/AppShell.tsx` — 3-zone layout
- `src/components/DialogHost.tsx` — renders active alert/confirm dialog from store
- `src/components/ErrorBoundary.tsx` — error boundary for pane isolation
- `src/components/sidebar/TaskSidebar.tsx` — task list sidebar
- `src/components/sidebar/ProjectGroup.tsx` — collapsible project group
- `src/components/sidebar/TaskCard.tsx` — task card
- `src/components/workspace/Workspace.tsx` — center area
- `src/components/workspace/TaskHeader.tsx` — task name, actions
- `src/components/workspace/TabBar.tsx` — flat tabs + "+"
- `src/components/workspace/TabContent.tsx` — renders active tab
- `src/components/panes/TerminalPane.tsx` — xterm.js + PTY
- `src/components/panes/EditorPane.tsx` — Monaco editor
- `src/components/panes/ChangesPane.tsx` — file list + diffs
- `src/components/panes/BrowserPane.tsx` — webview
- `src/components/panels/FileExplorer.tsx` — collapsible left rail
- `src/components/panels/FileTree.tsx` — recursive file tree
- `src/components/panels/TaskInfoPanel.tsx` — collapsible right rail
- `src/styles/global.css` — base styles, Tailwind imports

### electron/
- `package.json` — electron config
- `src/main.ts` — main process: launch backend, create window, cleanup
- `src/preload.ts` — preload script (exposes backend port to renderer)

### Root
- `package.json` — workspace root with scripts
- `bunfig.toml` — Bun workspace config
- `tsconfig.base.json` — shared TS config
- `.gitignore` — updated for monorepo

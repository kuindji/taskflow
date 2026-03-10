# Taskflow — Design Spec

A desktop app for task-oriented AI-assisted development. Wraps Claude Code and Codex CLIs in a workspace that provides project context (file explorer, code editor, git changes) alongside agent conversations, organized by task.

## Architecture

Three-process architecture:

1. **Electron shell** — Thin launcher. Starts the backend service, opens the renderer window, kills backend on exit.
2. **Backend service (Bun)** — Owns all business logic: PTY session management, git operations, file watching, task persistence. Exposes a WebSocket API.
3. **Renderer (React + TypeScript)** — Electron renderer process. Monaco editor, xterm.js terminals, Zustand state management. Connects to backend via WebSocket.

### Why separate backend?

- Escapes Electron's sandbox for unrestricted CLI spawning
- Enables future automation (headless task pipelines)
- External agents can develop/debug the backend independently
- Backend is testable in isolation

## Monorepo Structure

```
taskflow/
├── packages/
│   ├── shared/        # TypeScript types, constants, shared utils
│   ├── backend/       # Bun service
│   └── ui/            # React app (Electron renderer)
├── electron/          # Electron main process (thin)
├── package.json       # Workspace root
└── bunfig.toml
```

Type safety is achieved via shared types package imported by both backend and UI. No codegen or tRPC.

## UI Layout

### Three-zone layout

- **Task sidebar** (always visible) — Tasks grouped by project, collapsible project groups, search/filter, history and settings at bottom
- **Collapsible file explorer** (left rail, closed by default) — Shows project file tree or worktree when active, git status colors on files
- **Workspace** (center) — Task header bar + flat tab bar + active pane
- **Collapsible task info** (right rail, closed by default) — Description, branch, worktree path, notes (all editable)

### Task sidebar

- Tasks grouped under collapsible project headers
- Each task card shows: title, active session indicators (colored dots per agent type), brief status
- Task status shown via left border color (blue=active, yellow=paused, green=done)
- Project headers show task count badge
- Bottom bar: History link, Settings link
- Search bar + "+" button at top (creates new task, prompts for project)

### Workspace tabs

Tab bar contains conversations and panels in a flat list. "+" button offers:
- Claude Code session
- Codex session
- Browser

Additional tab types opened contextually:
- **Editor** — opened by clicking files in file explorer or file path links in terminal
- **Changes** — opened from tab bar or task header
- **Browser** — also opened by agents or from URL links in terminal

### File explorer

- Shows task's worktree directory when worktree is active, otherwise project root
- Recursive file tree with expand/collapse
- Git status indicators: green (new), yellow (modified), red (deleted)
- Click file → opens Editor tab
- Right-click → context menu (new file, new folder, etc.)

### Task info panel

- Task description (editable text area)
- Git branch name
- Worktree path (if active)
- Created timestamp
- Free-form notes (editable)

## Data Model

### Storage

Flat JSON files on disk. No database.

```
~/.config/taskflow/
├── projects.json         # Registered projects list
├── settings.json         # App preferences
├── tasks/
│   ├── {task-id}.json    # One file per task
│   └── ...
└── archive/
    ├── {task-id}.json    # Archived tasks
    └── ...
```

### Models

```typescript
interface Project {
  id: string
  name: string
  path: string              // Absolute path to project root
  createdAt: string
}

interface Task {
  id: string
  projectId: string
  title: string
  description: string
  notes: string
  worktree: {
    enabled: boolean
    path: string | null     // e.g., .worktrees/auth-refactor
    branch: string | null
  }
  sessions: SessionRef[]
  createdAt: string
  status: 'active' | 'archived'
  archivedAt: string | null
}

interface SessionRef {
  id: string
  type: 'claude' | 'codex'
  label: string             // User-editable, e.g., "impl", "explore"
  createdAt: string
}
```

### What's NOT persisted

- Terminal history / conversation logs — ephemeral, live in PTY buffer
- File watcher state — rebuilt on startup
- Editor tab state — not critical for v1

### Archive

- Tasks are manually archived or deleted by the user
- Archived tasks auto-delete after 30 days
- Backend checks on startup and removes expired archives

## WebSocket API

Single WebSocket connection. All messages are typed JSON.

### Message patterns

```typescript
interface Request {
  correlationId: string
  type: string
  payload: unknown
}

interface Response {
  correlationId: string
  type: string
  payload: unknown
  error?: string
}

interface Event {
  type: string
  payload: unknown
}
```

### Message types

| Category | Messages |
|----------|----------|
| Projects | `project:list`, `project:add`, `project:remove` |
| Tasks | `task:list`, `task:create`, `task:update`, `task:archive`, `task:delete` |
| Sessions | `session:create`, `session:close`, `session:input` |
| Terminal | `terminal:output` (event), `terminal:resize` |
| Files | `file:tree`, `file:read`, `file:watch` (event) |
| Git | `git:status`, `git:diff`, `git:diff-file`, `git:revert-file`, `git:worktree-create` |
| System | `system:info` (event — available editors, etc.) |

### Terminal streaming flow

1. Renderer sends `session:create { taskId, type: 'claude' }`
2. Backend spawns PTY with CLI, returns `sessionId`
3. Backend streams `terminal:output { sessionId, data }` events
4. Renderer pipes data into xterm.js
5. User keystrokes sent as `session:input { sessionId, data }`
6. Backend writes to PTY stdin

### File watcher flow

1. Task selected → renderer sends `file:watch { path }`
2. Backend watches directory, sends `file:changed` events
3. Renderer updates file tree and changes tab

## Backend Service Structure

```
packages/backend/
├── index.ts              # Entry — start HTTP+WS server
├── ws/
│   ├── server.ts         # WebSocket server setup
│   └── router.ts         # Routes messages to handlers
├── handlers/
│   ├── project.ts
│   ├── task.ts
│   ├── session.ts
│   ├── file.ts
│   └── git.ts
├── services/
│   ├── pty-manager.ts    # Spawn/manage PTY sessions
│   ├── git-service.ts    # Git CLI wrapper
│   ├── file-watcher.ts   # FS watching, tree building
│   └── task-store.ts     # JSON file read/write
└── config.ts             # Paths, defaults
```

- **Handlers** are thin: validate, call service, return response
- **Services** own logic and state
- **PTY manager** uses node-pty to spawn `claude` and `codex` as pseudo-terminals
- **Git service** shells out to `git` CLI (no native deps)
- **File watcher** uses Bun's built-in watch or chokidar fallback

### Backend lifecycle

1. Electron main starts backend: `Bun.spawn(['bun', 'packages/backend/index.ts'])`
2. Backend starts on random port, writes port to a known file
3. Renderer reads port and connects via WebSocket
4. On shutdown, Electron main kills backend process

## UI Component Structure

```
<App>
  <WebSocketProvider>           — Connection state, reconnect
    <AppShell>                  — 3-zone layout manager
      <TaskSidebar>             — Always visible
        <ProjectGroup>          — Collapsible, per project
          <TaskCard>            — Title, status, sessions
      <FileExplorer>            — Collapsible left rail
        <FileTree>              — Recursive, git status
      <Workspace>               — Center, per active task
        <TaskHeader>            — Name, project, actions
        <TabBar>                — Flat tabs + "+"
        <TabContent>            — Renders active tab:
          <TerminalPane>        — xterm.js + PTY
          <EditorPane>          — Monaco
          <ChangesPane>         — File list + diff
          <BrowserPane>         — Webview
      <TaskInfoPanel>           — Collapsible right rail
        <TaskDescription>       — Editable
        <TaskMeta>              — Branch, worktree, created
        <TaskNotes>             — Editable
```

### State management — Zustand

| Store | Responsibility |
|-------|---------------|
| `useProjectStore` | Projects list, active project |
| `useTaskStore` | Tasks by project, active task, CRUD |
| `useSessionStore` | Terminal sessions, active tab per task |
| `useFileStore` | File tree, git status, open editor tabs |
| `useUIStore` | Panel visibility, sidebar width, layout prefs |

### Data flow

- User action → store method → WS request → backend → WS response → store update → re-render
- Backend events (terminal output, file changes) → WebSocketProvider → route to store → re-render

## Terminal & Link Detection

- xterm.js Link Provider API for detecting clickable content (no raw ANSI regex)
- Two providers: file paths and URLs
- Default click: file → EditorPane tab, localhost URL → BrowserPane tab
- Cmd+click: context menu with external editor options (VS Code, Cursor, etc.)
- Backend detects installed editors on startup via CLI checks (`code`, `cursor`, etc.)

## Task Lifecycle

1. User creates task (picks project, enters title)
2. Task starts working in project's main directory
3. User can upgrade to worktree at any point (app creates worktree + branch)
4. User opens conversations (CC, Codex), edits files, views changes
5. When done, user archives or deletes the task
6. Archived tasks auto-delete after 30 days

## v1 Scope

### In scope

- Multi-project task management
- Claude Code & Codex terminal sessions
- Multiple conversations per task
- File explorer with git status
- Monaco code editor (read/write)
- Changes view with diffs + per-file revert
- Embedded browser for local dev
- Worktree upgrade (start in main, upgrade later)
- Clickable file paths & URLs in terminal
- Cmd+click for external editor options
- Task archive + 30-day auto-cleanup
- Task history view

### Out of scope (v1)

- Task automation / pipelines
- Full git UI (commit, push, staging)
- Conversation persistence / replay
- Adversarial review automation
- Settings / preferences UI
- Multiple windows

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Bun (everywhere) |
| Desktop shell | Electron |
| UI framework | React + TypeScript |
| Code editor | Monaco |
| Terminal | xterm.js + node-pty |
| State management | Zustand |
| Communication | WebSocket |
| Persistence | JSON flat files |
| Git | Shell out to git CLI |
| File watching | Bun.watch / chokidar |
| Type safety | Shared types package |

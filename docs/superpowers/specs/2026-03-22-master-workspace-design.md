# Master Workspace Design

## Overview

A new workspace scope ("master") that provides a project/task-free environment for running agent sessions. It uses the user's home directory as the working directory and offers the same TabBar + terminal experience as project/task workspaces, minus git operations, file explorer, and task info.

## Entry Point

A button in the sidebar bottom toolbar (left section, before notifications). Uses a `Monitor` or `Terminal` icon from lucide-react. Highlights when master workspace is active.

## Navigation & State

### UI Store (`ui-store.ts`)

New state field:

```
masterWorkspaceActive: boolean  (default: false)
setMasterWorkspaceActive(active: boolean): void
```

Behavior:
- Master button click → `setMasterWorkspaceActive(true)`, `setActiveProject(null)`, `setActiveTask(null)`
- Project/task selection → `setMasterWorkspaceActive(false)` (existing setActiveProject/setActiveTask calls)

### `useActiveWorkspace` Hook

Add a third return shape checked before task/project:

```typescript
if (masterWorkspaceActive) {
    return {
        scope: "master" as const,
        task: null,
        project: null,
        workingDir: homedir,  // from backend or env
        workspaceKey: "master",
    };
}
```

The `homedir` value is fetched once from the backend (or read from `window.taskflow.homedir` in Electron).

## Backend — Session Ownership

### Shared Types (`ws.ts`)

`SessionCreatePayload` gains:
```typescript
master?: boolean;
```

### Session Owner Type (`session-lifecycle.ts`)

Extend `SessionOwner`:
```typescript
interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}
```

### Validation Change

Current (line 132):
```typescript
if ((taskId ? 1 : 0) + (projectId ? 1 : 0) !== 1) {
    throw new Error("Exactly one of taskId or projectId is required");
}
```

New:
```typescript
if ((taskId ? 1 : 0) + (projectId ? 1 : 0) + (master ? 1 : 0) !== 1) {
    throw new Error("Exactly one of taskId, projectId, or master is required");
}
```

### Working Directory

When `master: true`:
- `cwd` = `os.homedir()` (from Node/Bun)
- No project or task lookup needed

## Backend — Master Session Storage

Master sessions are stored in-memory only (no persistence across restarts, matching project/task session behavior).

### Task Store Extension

Add to task store:
```typescript
masterSessions: SessionRef[]
addMasterSession(session: SessionRef): void
removeMasterSession(sessionId: string): void
getMasterSessions(): SessionRef[]
```

### Session Lifecycle

- `createSession`: when `master: true`, register session in `masterSessions` instead of task/project
- `removeSessionFromOwner`: check `masterSessions` as a fallback after task/project lookups
- Broadcast session events with master context so UI can sync

### New WS Message

`MSG.MASTER_SESSIONS_LIST` → returns `{ sessions: SessionRef[] }` for UI tab sync on load.

## Workspace Component Changes

### Empty State Guard (`Workspace.tsx` line 432)

Current:
```typescript
if (!workspace.scope || !workspace.project) {
    return <empty state>;
}
```

New:
```typescript
if (!workspace.scope) {
    return <empty state>;
}
```

Master scope does not require `workspace.project`.

### Master Scope Rendering

When `scope === "master"`:
- **No `TaskHeader`** — no file explorer toggle, task info toggle, git operations, or project/task management buttons
- **TabBar** renders with:
  - `showRunButton: false` (no task description to auto-run against)
  - `showAgentOptions: false`
  - No scripts, no flows
  - Session tab creation (agents + shell) enabled
- **TabContent** renders normally (terminal panes, browser panes)

### Session Owner Construction

All `handleNewTab` / `handleRunTab` / etc. handlers must construct owner as `{ master: true }` when `scope === "master"`.

## Sidebar Button

Position: bottom toolbar left section in `TaskSidebar.tsx`, as the first item (before notification bell and update status).

```tsx
<Button
    variant="ghost"
    size="icon-xs"
    onClick={handleMasterWorkspace}
    aria-label="Master Workspace"
    tooltip="Master Workspace"
    tooltipSide="right"
    className={cn(
        "[-webkit-app-region:no-drag]",
        masterWorkspaceActive ? "text-accent" : "text-muted-foreground"
    )}
>
    <Monitor className="h-3.5 w-3.5" />
</Button>
```

## What Master Workspace Does NOT Have

- File explorer panel
- Task info panel
- Git operations (diff, commit, push, PR)
- Project/task rename, archive, delete buttons
- Worktree logic
- Scripts runner (no package.json context)
- Flow management (no project/task owner for flows)
- Run button (no task description to auto-send)

## What Master Workspace DOES Have

- TabBar with `+` menu for creating new agent/shell tabs
- All agent types (Claude, Codex, OpenCode, Gemini, Cursor)
- Shell sessions
- Browser tabs
- Terminal pane rendering with full xterm.js support
- Tab management (close, rename, switch)

## Tab Sync on Load

When the UI connects/reconnects, it requests `MSG.MASTER_SESSIONS_LIST` and rebuilds the `"master"` workspace tabs, same pattern as `syncWithTasks` / `syncWithProjects` in the session store.

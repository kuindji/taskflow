# Master Workspace Design

## Overview

A new workspace scope ("master") that provides a project/task-free environment for running agent sessions. It uses the user's home directory as the working directory and offers the same TabBar + terminal experience as project/task workspaces, minus git operations, file explorer, and task info.

## Entry Point

A button in the sidebar bottom toolbar (left section, before notifications). Uses a `Monitor` icon from lucide-react. Highlights when master workspace is active. Tooltip side: `"right"` (matching notification button pattern in same section).

## Navigation & State

### UI Store (`ui-store.ts`)

New state field:

```
masterWorkspaceActive: boolean  (default: false)
setMasterWorkspaceActive(active: boolean): void
```

Behavior:
- Master button click → `setMasterWorkspaceActive(true)`, `setActiveProject(null)`, `setActiveTask(null)`
- Project/task selection → `setMasterWorkspaceActive(false)` (add to existing `setActiveProject` and `setActiveTask` implementations)

### `useActiveWorkspace` Hook

Add a third return shape checked before task/project:

```typescript
if (masterWorkspaceActive) {
    return {
        scope: "master" as const,
        task: null,
        project: null,
        workingDir: homedir,  // from backend via SYSTEM_INFO or preload
        workspaceKey: "master",
    };
}
```

**Homedir source:** Add `homedir` to `electron/src/preload.ts` exposed via `window.taskflow.homedir`. For non-Electron, fetch from backend via existing `SYSTEM_INFO` message (add `homedir` field to its response).

### Typed Return Value

Add a discriminated union type for the hook return:

```typescript
type ActiveWorkspace =
    | { scope: "task"; task: Task; project: Project; workingDir: string; workspaceKey: string }
    | { scope: "project"; task: null; project: Project; workingDir: string; workspaceKey: string }
    | { scope: "master"; task: null; project: null; workingDir: string; workspaceKey: string }
    | { scope: null; task: null; project: null; workingDir: null; workspaceKey: null };
```

## Backend — Session Ownership

### Shared Types (`ws.ts`)

`SessionCreatePayload` gains:
```typescript
master?: boolean;
```

`SessionHistoryPayload` gains:
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
const { taskId, projectId, master } = owner;
if ((taskId ? 1 : 0) + (projectId ? 1 : 0) + (master ? 1 : 0) !== 1) {
    throw new Error("Exactly one of taskId, projectId, or master is required");
}
```

### `createSession` Full Restructuring

The `createSession` function in `session-lifecycle.ts` hard-requires a project for cwd, env vars, and session registration. When `master: true`:

1. **Skip task/project lookup** — no `taskStore.getTask()` / `taskStore.getProject()` calls
2. **`cwd`** = `os.homedir()` instead of deriving from `project.path` / `task.worktree.path`
3. **Session registration** → `taskStore.addMasterSession(ref)` instead of updating task/project sessions
4. **`onData` callback** — use `"master"` as the ownerId for `appendSessionOutput(ownerId, sessionId, data)` instead of `task?.id ?? project.id`
5. **`onExit` callback** — same: use `"master"` as ownerId for cleanup, broadcast exit event
6. **Internal agent skill** — still build launch spec, but pass `isProjectLevel: true` (no task context)
7. **Cursor rules check** — skip for master scope (no project dir to put rules in)

### Working Directory

When `master: true`:
- `cwd` = `os.homedir()` (from `import { homedir } from "os"`)
- No project or task lookup needed

## Backend — Master Session Storage

Master sessions are stored in-memory only (no persistence across restarts, matching project/task session behavior).

### Task Store Extension

Add to task store:
```typescript
masterSessions: SessionRef[]  // in-memory only
addMasterSession(session: SessionRef): void
removeMasterSession(sessionId: string): void
getMasterSessions(): SessionRef[]
```

Session output files use `"master"` as the ownerId directory key.

### Session Lifecycle

- `createSession`: when `master: true`, register session in `masterSessions` instead of task/project
- `removeSessionFromOwner`: check `masterSessions` as a fallback after task/project lookups
- Broadcast session events with master context so UI can sync

### Session Handlers (`session.ts`)

- `SESSION_HISTORY` handler: accept `master: true` in payload, use `"master"` as ownerId for history lookup
- `SESSION_RENAME` handler: search `masterSessions` in addition to tasks/projects when finding session owner
- `SESSION_CLOSE` handler: `removeSessionFromOwner` already searches broadly, but ensure it also checks `masterSessions`

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

All session-creating handlers must construct owner as `{ master: true }` when `scope === "master"`:
- `handleNewTab` (line ~457)
- `handleRunTab` (line ~507) — currently rejects non-task scope; for master, skip entirely or allow without prompt
- `handleRunScript` (line ~589) — skip for master (no scripts)
- `handleRunAgentCommand` (line ~533)
- `handleRunAction` (line ~542)
- `handleOpenDefaultTerminal` (line ~283) — currently rejects non-task/non-project; update to allow master scope with `{ master: true }` owner

### `handleCloseActiveTab` Fallback

When last tab is closed in master scope (lines 265-268): do nothing (stay in master workspace showing empty tab area). No navigation away.

### Skip Unnecessary Fetches

When `scope === "master"`, skip the effects that fetch:
- Scripts list (lines 185-202) — no `package.json` in `$HOME`
- Agent commands list (lines 204-223) — no project dir context
- Cursor rules check in `handleNewTab` — skip for master scope

### `TabContent.tsx` — TerminalPane Props

`TerminalPane` receives `taskId` and `projectId` for session history requests. When `scope === "master"`, pass `master: true` instead. Update `TerminalPane` to accept and forward `master?: boolean` for history fetching.

## Session Store (`session-store.ts`)

### `isSessionFocused`

Currently builds `workspaceKey` from `activeTaskId` or `activeProjectId`. Add `masterWorkspaceActive` check:

```typescript
if (masterWorkspaceActive) {
    workspaceKey = "master";
}
```

Import or subscribe to `masterWorkspaceActive` from `ui-store`.

### `createSession` (UI side)

The owner construction at lines ~151-187 must handle `{ master: true }` when neither `taskId` nor `projectId` is provided.

### `BROWSER_OPEN` event listener

Lines 572-587: builds workspaceKey from `taskId` or `projectId`. Add fallback: if neither is present, use `"master"` as workspaceKey.

### `syncWithMasterSessions`

New method following the `syncWithTasks` / `syncWithProjects` pattern:
- Fetches `MSG.MASTER_SESSIONS_LIST`
- Rebuilds only the `"master"` workspace key tabs
- Preserves all other workspace keys

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
- Cursor rules auto-creation
- Agent commands list

## What Master Workspace DOES Have

- TabBar with `+` menu for creating new agent/shell tabs
- All agent types (Claude, Codex, OpenCode, Gemini, Cursor)
- Shell sessions
- Browser tabs
- Terminal pane rendering with full xterm.js support
- Tab management (close, rename, switch)
- Cmd+T keyboard shortcut for new terminal

## Tab Sync on Load

When the UI connects/reconnects, it calls `syncWithMasterSessions()` which requests `MSG.MASTER_SESSIONS_LIST` and rebuilds the `"master"` workspace tabs, same pattern as `syncWithTasks` / `syncWithProjects` in the session store. The `"master"` key is preserved by both `syncWithTasks` and `syncWithProjects` since it doesn't match their `"task:"` / `"project:"` prefixes.

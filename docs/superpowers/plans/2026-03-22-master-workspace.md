# Master Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "master" workspace scope — a project/task-free environment for running agent and shell sessions from the user's home directory, accessed via a sidebar button.

**Architecture:** Extends the existing workspace model with a third scope `"master"`. Backend session lifecycle gains `master: true` as a session owner variant. UI navigation uses a new `masterWorkspaceActive` flag in ui-store. All session infrastructure (TabBar, TabContent, TerminalPane) is reused with conditional guards for the master case.

**Tech Stack:** React, Zustand, TypeScript, WebSocket messages, Electron preload

**Spec:** `docs/superpowers/specs/2026-03-22-master-workspace-design.md`

---

## File Structure

### Files to Modify

| File | Responsibility |
|------|---------------|
| `packages/shared/src/constants.ts` | Add `MASTER_SESSIONS_LIST` message constant |
| `packages/shared/src/types/ws.ts` | Add `master` field to `SessionCreatePayload`, `SessionHistoryPayload`, `BrowserOpenPayload`; add `MasterSessionsListResponse` type |
| `packages/backend/src/services/task-store.ts` | Add in-memory `masterSessions` storage with add/remove/list methods |
| `packages/backend/src/services/session-lifecycle.ts` | Handle `master: true` owner in `createSession` and `removeSessionFromOwner` |
| `packages/backend/src/handlers/session.ts` | Update `SESSION_HISTORY` and `SESSION_RENAME` for master; register `MASTER_SESSIONS_LIST` handler |
| `packages/backend/src/index.ts` | Add `homedir` to `SYSTEM_INFO` response |
| `packages/ui/src/stores/ui-store.ts` | Add `masterWorkspaceActive` state and setter |
| `packages/ui/src/hooks/useActiveWorkspace.ts` | Add `"master"` scope return path |
| `packages/ui/src/stores/session-store.ts` | Update `createSession`, `isSessionFocused`, `BROWSER_OPEN` listener, add `syncWithMasterSessions` |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Add master workspace button, call `syncWithMasterSessions` |
| `packages/ui/src/components/workspace/Workspace.tsx` | Handle `scope === "master"` in rendering and all session handlers |
| `packages/ui/src/components/workspace/TabContent.tsx` | Pass `master` prop to `TerminalPane` for master scope |
| `packages/ui/src/components/panes/TerminalPane.tsx` | Accept `master` prop, use it in session history requests and helper functions |

### No New Files

All changes fit within existing files.

---

## Task 1: Shared Types & Constants

**Files:**
- Modify: `packages/shared/src/constants.ts:128` (before `SYSTEM_INFO`)
- Modify: `packages/shared/src/types/ws.ts:116-129` (`SessionCreatePayload`), `:172-176` (`SessionHistoryPayload`), `:403-408` (`BrowserOpenPayload`)

- [ ] **Step 1: Add `MASTER_SESSIONS_LIST` to MSG constants**

In `packages/shared/src/constants.ts`, add before line 128 (`SYSTEM_INFO`):
```typescript
    // Master workspace
    MASTER_SESSIONS_LIST: "master:sessions-list",
```

- [ ] **Step 2: Update `SessionCreatePayload` in ws.ts**

Add `master?: boolean` field to the interface at line 116:
```typescript
export interface SessionCreatePayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "shell" | "editor";
    label?: string;
    prompt?: string;
    shell?: string;
    cols?: number;
    rows?: number;
    agentOptions?: AgentLaunchOptions;
    editorId?: string;
    filePath?: string;
    line?: number;
}
```

- [ ] **Step 3: Update `SessionHistoryPayload` in ws.ts**

At line 172:
```typescript
export interface SessionHistoryPayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
}
```

- [ ] **Step 4: Update `BrowserOpenPayload` in ws.ts**

At line 403:
```typescript
export interface BrowserOpenPayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    url: string;
    label?: string;
}
```

- [ ] **Step 5: Add `MasterSessionsListResponse` type**

After `BrowserOpenPayload` in ws.ts:
```typescript
export interface MasterSessionsListResponse {
    sessions: SessionRef[];
}
```

- [ ] **Step 6: Verify build**

Run: `cd packages/shared && bun run build`
Expected: Success with no errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add master workspace shared types and constants"
```

---

## Task 2: Backend — Task Store Master Session Storage

**Files:**
- Modify: `packages/backend/src/services/task-store.ts:365-420` (session history area)

- [ ] **Step 1: Add in-memory master session storage**

Add a `masterSessions` array and methods to the `TaskStore` class. Find the class and add these as new members:

```typescript
private masterSessions: SessionRef[] = [];

addMasterSession(session: SessionRef): void {
    this.masterSessions.push(session);
}

removeMasterSession(sessionId: string): void {
    this.masterSessions = this.masterSessions.filter((s) => s.id !== sessionId);
}

getMasterSessions(): SessionRef[] {
    return [...this.masterSessions];
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/task-store.ts
git commit -m "feat: add master session storage to task store"
```

---

## Task 3: Backend — Session Lifecycle Master Support

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts:13-16` (SessionOwner), `:62-111` (removeSessionFromOwner), `:114-305` (createSession)

- [ ] **Step 1: Update `SessionOwner` interface**

At line 13:
```typescript
interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}
```

- [ ] **Step 2: Add `homedir` import**

Add at top of file:
```typescript
import { homedir } from "os";
```

- [ ] **Step 3: Update `removeSessionFromOwner` to check master sessions**

At the end of `removeSessionFromOwner` (after the archived owner check, around line 111), add before the closing brace:

```typescript
        // Check master sessions
        const masterSessions = taskStore.getMasterSessions();
        if (masterSessions.some((s) => s.id === sessionId)) {
            taskStore.removeMasterSession(sessionId);
            await taskStore.deleteSessionHistory("master", sessionId);
            broadcast({
                type: MSG.MASTER_SESSIONS_LIST,
                payload: { sessions: taskStore.getMasterSessions() },
            });
            return;
        }
```

- [ ] **Step 4: Update `createSession` validation**

Replace the validation at line 132:
```typescript
const { taskId, projectId, master } = owner;

if ((taskId ? 1 : 0) + (projectId ? 1 : 0) + (master ? 1 : 0) !== 1) {
    throw new Error("Exactly one of taskId, projectId, or master is required");
}
```

- [ ] **Step 5: Restructure `createSession` for master scope**

After the validation, restructure the task/project lookup and cwd derivation. Replace lines ~136-147 with:

```typescript
let task: Awaited<ReturnType<typeof taskStore.getTask>> | null = null;
let project: Awaited<ReturnType<typeof taskStore.getProject>> | null = null;
let cwd: string;

if (master) {
    cwd = homedir();
} else {
    task = taskId ? await taskStore.getTask(taskId) : null;
    if (taskId && !task) throw new Error(`Task not found: ${taskId}`);

    project = task
        ? await taskStore.getProject(task.projectId)
        : projectId
          ? await taskStore.getProject(projectId)
          : null;
    if (!project) throw new Error(`Project not found: ${task?.projectId ?? projectId}`);

    cwd = task?.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
}
```

- [ ] **Step 6: Guard project-dependent code paths**

Several places in `createSession` reference `project` directly. Wrap them with guards:

**Env vars (around line 206-218):** The `TASKFLOW_PROJECT_ID` line already checks `if (project)`, so this is safe. No change needed.

**Cursor rules check (around line 182-183):** Add master guard:
```typescript
if (type === "cursor" && !master && systemPrompt) {
    await ensureCursorRulesFile(cwd, systemPrompt);
}
```

**Gemini system file (around line 184-190):** Keep `!task` logic as-is — for master, `task` is null so `isProjectLevel` will be true. This is correct.

- [ ] **Step 7: Update `onData` callback**

Replace `task?.id ?? project.id` with a pre-computed ownerId. Before the `ptyManager.spawn()` call, add:
```typescript
const ownerId = master ? "master" : (task?.id ?? project!.id);
```

Then in the `onData` callback:
```typescript
onData: (data, sequence) => {
    void taskStore.appendSessionOutput(ownerId, sessionId, sequence, data);
    // ... rest unchanged
},
```

- [ ] **Step 8: Update `onExit` callback**

In the `onExit` callback, update `removeSessionFromOwner` call:
```typescript
onExit: (exitCode) => {
    if (!opts.internal) {
        trayStateTracker.clearSession(sessionId);
        broadcast({
            type: MSG.SESSION_EXITED,
            payload: { sessionId, exitCode },
        });
        void removeSessionFromOwner(sessionId, master ? { master: true } : {
            taskId: task?.id,
            projectId: project!.id,
        });
    }
    onSessionExited?.(sessionId, exitCode);
},
```

- [ ] **Step 9: Update session registration**

In the session ref registration block (around line 264-295), add master branch:

```typescript
if (!opts.internal) {
    const sessionRef: SessionRef = {
        id: sessionId,
        type,
        label: opts.label ?? getDefaultSessionLabel(type),
        createdAt: new Date().toISOString(),
        instance: config.instanceId,
    };
    if (master) {
        taskStore.addMasterSession(sessionRef);
        broadcast({
            type: MSG.MASTER_SESSIONS_LIST,
            payload: { sessions: taskStore.getMasterSessions() },
        });
    } else if (task) {
        // ... existing task branch unchanged
    } else {
        // ... existing project branch unchanged
    }
    // ... status broadcast unchanged
}
```

- [ ] **Step 10: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 11: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts
git commit -m "feat: support master workspace sessions in session lifecycle"
```

---

## Task 4: Backend — Session Handlers

**Files:**
- Modify: `packages/backend/src/handlers/session.ts:30-58` (SESSION_CREATE), `:74-99` (SESSION_RENAME), `:107-114` (SESSION_HISTORY)
- Modify: `packages/backend/src/index.ts:311` (SYSTEM_INFO)

- [ ] **Step 1: Update `SESSION_CREATE` handler to pass `master` to lifecycle**

At line 30-58, add `master` to the destructuring:
```typescript
const {
    taskId,
    projectId,
    master,
    type,
    label,
    prompt,
    shell,
    cols,
    rows,
    agentOptions,
    editorId,
    filePath,
    line,
} = payload as SessionCreatePayload;
const sessionId = await sessionLifecycle.createSession({
    owner: { taskId, projectId, master },
    // ... rest unchanged
});
```

- [ ] **Step 2: Update `SESSION_RENAME` handler for master sessions**

After the project search (around line 96), before the `throw`, add:

```typescript
    // Check master sessions
    const masterSessions = taskStore.getMasterSessions();
    const masterSession = masterSessions.find((s) => s.id === sessionId);
    if (masterSession) {
        taskStore.removeMasterSession(sessionId);
        taskStore.addMasterSession({ ...masterSession, label });
        return { success: true };
    }

    throw new Error(`Session not found: ${sessionId}`);
```

- [ ] **Step 3: Update `SESSION_HISTORY` handler for master**

Replace lines 107-114:
```typescript
router.register(MSG.SESSION_HISTORY, async (payload) => {
    const { taskId, projectId, master, sessionId } = payload as SessionHistoryPayload;
    const ownerId = master ? "master" : (taskId ?? projectId);
    if (!ownerId || (!master && taskId && projectId)) {
        throw new Error("Exactly one of taskId, projectId, or master is required");
    }
    return taskStore.getSessionHistory(ownerId, sessionId);
});
```

- [ ] **Step 4: Register `MASTER_SESSIONS_LIST` handler**

In `session.ts`, add after the existing handlers:
```typescript
router.register(MSG.MASTER_SESSIONS_LIST, async () => {
    return { sessions: taskStore.getMasterSessions() };
});
```

- [ ] **Step 5: Add `homedir` to `SYSTEM_INFO` response**

In `packages/backend/src/index.ts` at line 311:
```typescript
router.register(MSG.SYSTEM_INFO, async () => ({ editors, homedir: homedir() }));
```

Add import at top:
```typescript
import { homedir } from "os";
```

- [ ] **Step 6: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/handlers/session.ts packages/backend/src/index.ts
git commit -m "feat: add master workspace session handlers and homedir to system info"
```

---

## Task 5: UI — Store Changes (ui-store, session-store)

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts:29-73` (interface), `:75-131` (implementation)
- Modify: `packages/ui/src/stores/session-store.ts:39-67` (interface), `:103-118` (isSessionFocused), `:151-186` (createSession), `:572-587` (BROWSER_OPEN)

- [ ] **Step 1: Add `masterWorkspaceActive` to ui-store interface**

In `packages/ui/src/stores/ui-store.ts`, add to the `UIStore` interface (after `activeProjectId`):
```typescript
masterWorkspaceActive: boolean;
```

Add setter method to interface:
```typescript
setMasterWorkspaceActive(active: boolean): void;
```

- [ ] **Step 2: Implement in ui-store**

Add default value in store creation (after `activeProjectId: null`):
```typescript
masterWorkspaceActive: false,
```

Add setter (after `setActiveProject`):
```typescript
setMasterWorkspaceActive(active) {
    set({ masterWorkspaceActive: active });
},
```

- [ ] **Step 3: Clear `masterWorkspaceActive` when project/task is selected**

Update `setActiveProject`:
```typescript
setActiveProject(id) {
    set({ activeProjectId: id, ...(id ? { masterWorkspaceActive: false } : {}) });
},
```

No change needed in `task-store.ts` — clearing is handled at the handler level in TaskSidebar (Task 9, Step 4).

- [ ] **Step 4: Update `isSessionFocused` in session-store**

In `packages/ui/src/stores/session-store.ts` at line 103, update to handle master:
```typescript
function isSessionFocused(sessionId: string): boolean {
    if (!windowFocused) return false;
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const activeProjectId = useUIStore.getState().activeProjectId;
    const masterWorkspaceActive = useUIStore.getState().masterWorkspaceActive;
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : masterWorkspaceActive
            ? "master"
            : null;
    if (!workspaceKey) return false;
    const store = useSessionStore.getState();
    const activeTabId = store.activeTabByWorkspace[workspaceKey];
    const tabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.sessionId === sessionId;
}
```

- [ ] **Step 5: Update `createSession` in session-store (UI side)**

At line 151-186, update to handle master owner:
First, update the `SessionStore` interface (lines 39-67). Change the `createSession` signature to accept `master`:
```typescript
createSession(
    owner: { taskId?: string; projectId?: string; master?: boolean },
    type: Tab["type"],
    label?: string,
    prompt?: string,
    shell?: string,
    agentOptions?: import("@taskflow/shared").AgentLaunchOptions,
    editorOpts?: { editorId: string; filePath: string; line?: number },
): Promise<string>;
```

Then update the implementation:
```typescript
async createSession(owner, type, label, prompt, shell, agentOptions, editorOpts) {
    const ownerId = owner.taskId ?? owner.projectId;
    if (!ownerId && !owner.master) throw new Error("Either taskId, projectId, or master is required");
    const lastTerminalSize = get().lastTerminalSize;
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, {
        ...owner,
        type,
        label,
        prompt,
        shell,
        cols: lastTerminalSize?.cols,
        rows: lastTerminalSize?.rows,
        agentOptions,
        ...(editorOpts && {
            editorId: editorOpts.editorId,
            filePath: editorOpts.filePath,
            line: editorOpts.line,
        }),
    });
    const tab: Tab = {
        id: sessionId,
        type,
        label: normalizeSessionLabel(type, label),
        sessionId,
        ...(type === "shell" && { autoTitle: true }),
        ...(editorOpts && { filePath: editorOpts.filePath }),
    };
    const workspaceKey = owner.taskId
        ? getTaskWorkspaceKey(owner.taskId)
        : ownerId
          ? getProjectWorkspaceKey(ownerId)
          : "master";
    get().addTab(workspaceKey, tab);
    await Promise.all([
        owner.taskId ? useTaskStore.getState().fetchTasks() : Promise.resolve(),
        owner.projectId ? useProjectStore.getState().fetchProjects() : Promise.resolve(),
    ]);
    return sessionId;
},
```

- [ ] **Step 6: Update `BROWSER_OPEN` event listener**

At lines 572-587, update workspaceKey derivation:
```typescript
const workspaceKey = taskId
    ? getTaskWorkspaceKey(taskId)
    : projectId
      ? getProjectWorkspaceKey(projectId)
      : (payload as BrowserOpenPayload).master
        ? "master"
        : null;
```

- [ ] **Step 7: Add `syncWithMasterSessions` to store interface and implementation**

Add to `SessionStore` interface:
```typescript
syncWithMasterSessions(sessions: SessionRef[]): void;
```

Add implementation (follow `syncWithProjects` pattern):
```typescript
syncWithMasterSessions(sessions) {
    set((state) => {
        const workspaceKey = "master";
        const existingTabs = state.tabsByWorkspace[workspaceKey] ?? [];
        const sessionsById = new Map(sessions.map((s) => [s.id, s]));
        const tabs = existingTabs
            .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
            .map((tab) => {
                if (!tab.sessionId) return tab;
                const session = sessionsById.get(tab.sessionId);
                if (!session) return tab;
                return {
                    ...tab,
                    type: session.type,
                    ...(tab.autoTitle !== true && {
                        label: normalizeSessionLabel(session.type, session.label),
                    }),
                };
            });

        for (const session of sessions) {
            if (!tabs.some((tab) => tab.sessionId === session.id)) {
                tabs.push(createSessionTab(session));
            }
        }

        if (tabs.length === 0) {
            const { [workspaceKey]: _, ...restTabs } = state.tabsByWorkspace;
            const { [workspaceKey]: __, ...restActive } = state.activeTabByWorkspace;
            return {
                tabsByWorkspace: restTabs,
                activeTabByWorkspace: restActive,
            };
        }

        const currentActiveId = state.activeTabByWorkspace[workspaceKey];
        return {
            tabsByWorkspace: {
                ...state.tabsByWorkspace,
                [workspaceKey]: tabs,
            },
            activeTabByWorkspace: {
                ...state.activeTabByWorkspace,
                [workspaceKey]: tabs.some((tab) => tab.id === currentActiveId)
                    ? currentActiveId
                    : tabs[0].id,
            },
        };
    });
},
```

- [ ] **Step 8: Add `onEvent` listener for `MASTER_SESSIONS_LIST` in session-store**

In the module-level event listeners section (near `_unsubBrowserOpen`, `_unsubSessionExited`), add:
```typescript
const _unsubMasterSessions = onEvent(MSG.MASTER_SESSIONS_LIST, (payload) => {
    if (!payload || typeof payload !== "object" || !("sessions" in payload)) return;
    const { sessions } = payload as MasterSessionsListResponse;
    useSessionStore.getState().syncWithMasterSessions(sessions);
});
```

Import `MasterSessionsListResponse` from `@taskflow/shared`.

- [ ] **Step 9: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts packages/ui/src/stores/session-store.ts packages/ui/src/stores/task-store.ts
git commit -m "feat: add master workspace state to UI and session stores"
```

---

## Task 6: UI — `useActiveWorkspace` Hook

**Files:**
- Modify: `packages/ui/src/hooks/useActiveWorkspace.ts`

- [ ] **Step 1: Add master scope to hook**

Update the full file:
```typescript
import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

export function getTaskWorkspaceKey(taskId: string): string {
    return `task:${taskId}`;
}

export function getProjectWorkspaceKey(projectId: string): string {
    return `project:${projectId}`;
}

export const MASTER_WORKSPACE_KEY = "master";

let cachedHomedir: string | null = null;

// Pre-fetch homedir as early as possible so it's ready before master workspace is activated.
// Called once when the module loads; subsequent calls to useHomedir() return the cached value instantly.
export function prefetchHomedir(): void {
    if (cachedHomedir) return;
    sendRequest<{ editors: unknown[]; homedir: string }>(MSG.SYSTEM_INFO, {})
        .then((res) => {
            cachedHomedir = res.homedir;
        })
        .catch(() => {});
}

export function useHomedir(): string | null {
    const [homedir, setHomedir] = useState<string | null>(cachedHomedir);

    useEffect(() => {
        if (cachedHomedir) {
            setHomedir(cachedHomedir);
            return;
        }
        sendRequest<{ editors: unknown[]; homedir: string }>(MSG.SYSTEM_INFO, {})
            .then((res) => {
                cachedHomedir = res.homedir;
                setHomedir(res.homedir);
            })
            .catch(() => {});
    }, []);

    return homedir;
}

export function useActiveWorkspace() {
    const tasks = useTaskStore((s) => s.tasks);
    const projects = useProjectStore((s) => s.projects);
    const activeTaskId = useTaskStore((s) => s.activeTaskId);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const masterWorkspaceActive = useUIStore((s) => s.masterWorkspaceActive);
    const homedir = useHomedir();

    return useMemo(() => {
        if (masterWorkspaceActive && homedir) {
            return {
                scope: "master" as const,
                task: null,
                project: null,
                workingDir: homedir,
                workspaceKey: MASTER_WORKSPACE_KEY,
            };
        }

        const task = activeTaskId
            ? (tasks.find((entry) => entry.id === activeTaskId) ?? null)
            : null;
        const project = task
            ? (projects.find((entry) => entry.id === task.projectId) ?? null)
            : activeProjectId
              ? (projects.find((entry) => entry.id === activeProjectId) ?? null)
              : null;

        if (task && project) {
            const workingDir =
                task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
            return {
                scope: "task" as const,
                task,
                project,
                workingDir,
                workspaceKey: getTaskWorkspaceKey(task.id),
            };
        }

        if (project) {
            return {
                scope: "project" as const,
                task: null,
                project,
                workingDir: project.path,
                workspaceKey: getProjectWorkspaceKey(project.id),
            };
        }

        return {
            scope: null,
            task: null,
            project: null,
            workingDir: null,
            workspaceKey: null,
        };
    }, [activeProjectId, activeTaskId, masterWorkspaceActive, homedir, projects, tasks]);
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/useActiveWorkspace.ts
git commit -m "feat: add master scope to useActiveWorkspace hook"
```

---

## Task 7: UI — Workspace Component

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Update empty state guard**

At line 432, change from:
```typescript
if (!workspace.scope || !workspace.project) {
```
to:
```typescript
if (!workspace.scope) {
```

- [ ] **Step 2: Update `handleOpenDefaultTerminal` for master scope**

At line 283-309, update to allow master:
```typescript
const handleOpenDefaultTerminal = useCallback(async () => {
    if (!workspace.scope) return;

    let shell = defaultShellPath;
    if (!shell) {
        const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
        shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
    }
    if (!shell) return;

    const owner =
        workspace.scope === "task"
            ? { taskId: workspace.task.id }
            : workspace.scope === "project"
              ? { projectId: workspace.project.id }
              : { master: true };
    setFocusedPanel("workspace");
    await createSession(owner, "shell", getShellSessionLabel(shell), undefined, shell);
}, [
    configuredShell,
    createSession,
    defaultShellPath,
    setFocusedPanel,
    workspace.project,
    workspace.scope,
    workspace.task,
]);
```

- [ ] **Step 3: Update `handleNewTab` owner construction**

At line ~457-505, update the owner construction to handle master scope. In the shell and agent branches, change:
```typescript
// Replace the owner construction pattern in all branches:
const owner =
    workspace.scope === "task"
        ? { taskId: workspace.task.id }
        : workspace.scope === "project"
          ? { projectId: workspace.project.id }
          : { master: true as const };
```

Apply this to all three places inside `handleNewTab` where owner is constructed (shell branch ~line 483, agent branch ~line 494, and browser needs no owner).

Also skip cursor rules check for master scope:
```typescript
if (type === "cursor" && workspace.scope !== "master" && workspace.workingDir && !skipCursorRulesCheck) {
```

- [ ] **Step 4: Update `handleRunAgentCommand` and `handleRunAction`**

Both use the same owner pattern. Update both:
```typescript
const owner =
    workspace.scope === "task"
        ? { taskId: workspace.task.id }
        : workspace.scope === "project"
          ? { projectId: workspace.project.id }
          : { master: true as const };
```

- [ ] **Step 5: Update `handleCloseActiveTab` fallback for master**

At line 261-277, add master case — do nothing (stay in master workspace):
```typescript
const handleCloseActiveTab = useCallback(() => {
    if (activeTab && workspace.workspaceKey) {
        if (activeTab.sessionId) destroyTerminal(activeTab.sessionId);
        void closeTab(workspace.workspaceKey, activeTab.id);
    } else if (workspace.scope === "task") {
        setActiveTask(null);
    } else if (workspace.scope === "project") {
        setActiveProject(null);
    }
    // master scope: do nothing when no tabs remain
}, [
    activeTab,
    workspace.workspaceKey,
    workspace.scope,
    closeTab,
    setActiveTask,
    setActiveProject,
]);
```

- [ ] **Step 6: Skip script/command fetches for master scope**

Wrap the scripts fetch effect (lines 185-202) with a scope guard:
```typescript
useEffect(() => {
    if (!workspace.workingDir || workspace.scope === "master") {
        setScripts(emptyScripts);
        return;
    }
    // ... rest unchanged
}, [workspace.workingDir, workspace.scope]);
```

Same for agent commands fetch (lines 204-223):
```typescript
useEffect(() => {
    if (!workspace.workingDir || workspace.scope === "master") {
        setAgentCommands(emptyAgentCommands);
        return;
    }
    // ... rest unchanged
}, [workspace.workingDir, workspace.scope]);
```

- [ ] **Step 7: Conditional rendering for master scope**

Update the return block. When `scope === "master"`, skip `TaskHeader`:
```typescript
if (workspace.scope === "master") {
    return (
        <>
            <TabBar
                tabs={visibleTabs}
                activeTabId={activeTab?.id ?? ""}
                onTabClick={(id) =>
                    workspace.workspaceKey && setActiveTab(workspace.workspaceKey, id)
                }
                onTabClose={(id) => {
                    if (!workspace.workspaceKey) return;
                    const tab = visibleTabs.find((t) => t.id === id);
                    const doClose = () => {
                        if (tab?.sessionId) destroyTerminal(tab.sessionId);
                        void closeTab(workspace.workspaceKey, id);
                    };
                    doClose();
                }}
                onTabRename={(id, newLabel) => {
                    if (workspace.workspaceKey) {
                        renameTab(workspace.workspaceKey, id, newLabel);
                    }
                }}
                onNewTab={handleNewTab}
                onRunTab={() => {}}
                onRunScript={() => {}}
                onRunAction={() => {}}
                onRunAgentCommand={handleRunAgentCommand}
                onStartFlow={() => {}}
                onManageFlows={toggleFlowManagement}
                scripts={{}}
                defaultRuntime={defaultRuntime}
                flows={[]}
                standaloneActions={[]}
                agentCommands={[]}
                activeFlowRun={null}
                showRunButton={false}
                showAgentOptions={false}
                allowSessionTabs={true}
            />
            <TabContent tabs={visibleTabs} activeTabId={activeTab?.id ?? ""} />
        </>
    );
}
```

Then the existing render path (with `TaskHeader`) handles task/project scopes as before.

- [ ] **Step 8: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: handle master workspace scope in Workspace component"
```

---

## Task 8: UI — TabContent & TerminalPane Master Support

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx:60-66` (TerminalPane props)
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:40-45` (props), `:103-120` (helpers), `:635-638` (history request)

- [ ] **Step 1: Add `master` prop to TerminalPaneProps**

In `TerminalPane.tsx` at line 40:
```typescript
interface TerminalPaneProps {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
    visible: boolean;
}
```

- [ ] **Step 2: Update `getWorkspaceKey` helper in TerminalPane**

At line 103:
```typescript
function getWorkspaceKey(taskId?: string, projectId?: string, master?: boolean): string | null {
    if (taskId) return getTaskWorkspaceKey(taskId);
    if (projectId) return getProjectWorkspaceKey(projectId);
    if (master) return "master";
    return null;
}
```

- [ ] **Step 3: Update `getWorkingDir` helper in TerminalPane**

At line 109, add master case at the end (before the final `return null`):
```typescript
    if (master) {
        // For master workspace, working dir is homedir — not available from stores.
        // Return null; link handling will gracefully degrade.
        return null;
    }
    return null;
```

- [ ] **Step 4: Update `replayFromHistory` in TerminalPane**

At line 635, update the history request to pass `master`:
```typescript
return sendRequest<SessionHistoryResponse>(MSG.SESSION_HISTORY, {
    taskId,
    projectId,
    master,
    sessionId,
})
```

- [ ] **Step 5: Thread `master` prop through all usages**

Find all calls to `getWorkspaceKey(taskId, projectId)` and `getWorkingDir(taskId, projectId)` inside the TerminalPane component and add `master` as the third argument. The component destructures props, so:
```typescript
const { taskId, projectId, master, sessionId, visible } = props;
```

Then update all calls:
- `getWorkspaceKey(taskId, projectId, master)`
- `getWorkingDir(taskId, projectId, master)`

- [ ] **Step 6: Update TabContent to pass `master` prop**

In `TabContent.tsx`, where `TerminalPane` is rendered (lines 60-66 and 76-82), add the `master` prop:
```typescript
<TerminalPane
    taskId={workspace.task?.id}
    projectId={workspace.task ? undefined : workspace.project?.id}
    master={workspace.scope === "master" ? true : undefined}
    sessionId={tab.sessionId}
    visible={isActive}
/>
```

Apply to both terminal rendering locations in the file.

- [ ] **Step 7: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: support master workspace in TabContent and TerminalPane"
```

---

## Task 9: UI — Sidebar Button & Master Session Sync

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:60-61` (sync), `:250-267` (click handlers), `:415-450` (bottom toolbar)

- [ ] **Step 1: Add master workspace button imports and state**

In `TaskSidebar.tsx`, add to imports:
```typescript
import { Monitor } from "lucide-react";
```

Add store subscriptions (near other useUIStore/useSessionStore subscriptions):
```typescript
const masterWorkspaceActive = useUIStore((s) => s.masterWorkspaceActive);
const setMasterWorkspaceActive = useUIStore((s) => s.setMasterWorkspaceActive);
const syncWithMasterSessions = useSessionStore((s) => s.syncWithMasterSessions);
```

- [ ] **Step 2: Add master session sync effect**

After the existing `syncWithProjects` effect (line 117-119), add:
```typescript
useEffect(() => {
    if (!connected) return;
    sendRequest<{ sessions: SessionRef[] }>(MSG.MASTER_SESSIONS_LIST, {})
        .then((res) => syncWithMasterSessions(res.sessions))
        .catch(() => {});
}, [connected, syncWithMasterSessions]);
```

Add the needed imports (`sendRequest` from `@/hooks/useWebSocket`, `MSG` from `@taskflow/shared`, `SessionRef` from `@taskflow/shared`).

Also call `prefetchHomedir()` from the same connected effect to ensure the homedir is cached before the user clicks the master button:
```typescript
import { prefetchHomedir } from "@/hooks/useActiveWorkspace";
```
In the existing `useEffect` that fires when `connected` becomes true (around line 105-111), add:
```typescript
prefetchHomedir();
```

- [ ] **Step 3: Add master workspace click handler**

Add handler:
```typescript
const handleMasterWorkspace = useCallback(() => {
    setActiveTask(null);
    setActiveProject(null);
    setMasterWorkspaceActive(true);
}, [setActiveTask, setActiveProject, setMasterWorkspaceActive]);
```

- [ ] **Step 4: Clear master workspace on project/task click**

In `handleProjectClick` (around line 250), add:
```typescript
setMasterWorkspaceActive(false);
```

In `handleTaskClick` (around line 259), add:
```typescript
setMasterWorkspaceActive(false);
```

Note: The ui-store `setActiveProject` already clears it when `id` is truthy (from Task 5 Step 3), and `setActiveTask` in task-store also clears it. But these handlers may need explicit clearing if they set null first. Verify the flow — `handleProjectClick` calls `setActiveTask(null)` then `setActiveProject(projectId)`. Since `setActiveProject(projectId)` with a truthy id clears `masterWorkspaceActive`, this should be fine. Still, adding explicit `setMasterWorkspaceActive(false)` in the handlers is safer.

- [ ] **Step 5: Add master workspace button to sidebar toolbar**

In the bottom toolbar left section (line 417), add the master button as the first item inside the `<div className="flex items-center">`:

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
        masterWorkspaceActive ? "text-accent" : "text-muted-foreground",
    )}
>
    <Monitor className="h-3.5 w-3.5" />
</Button>
```

This goes before the notification popover.

- [ ] **Step 6: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: add master workspace sidebar button and session sync"
```

---

## Task 10: Integration Verification

- [ ] **Step 1: Build all packages**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/implement-master-workspace-feature && bun run build`
Expected: All packages build successfully

- [ ] **Step 2: Verify no type errors**

Run: `bun run typecheck` (or equivalent)
Expected: No type errors

- [ ] **Step 3: Fix any lint issues**

Run: `bun run lint`
Fix any issues found.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve lint and type issues from master workspace feature"
```

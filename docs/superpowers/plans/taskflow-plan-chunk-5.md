# Chunk 5: UI Core — Layout, WebSocket, Stores, Sidebar

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 4 — Electron Shell](taskflow-plan-chunk-4.md) | Next: [Chunk 6 — UI Panes](taskflow-plan-chunk-6.md)

---

### Task 5.1: Vite config for the UI package

**Files:**
- Create: `packages/ui/vite.config.ts`

- [ ] **Step 1: Create Vite config**

File: `packages/ui/vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 2: Verify dev server starts**

Run: `cd packages/ui && bunx vite --host 2>&1 | head -5 &; sleep 3; kill %1 2>/dev/null; true`
Expected: Vite dev server output

- [ ] **Step 3: Commit**

```bash
git add packages/ui/vite.config.ts
git commit -m "feat: add Vite config for UI package"
```

### Task 5.2: WebSocket provider and hook

**Files:**
- Create: `packages/ui/src/providers/WebSocketProvider.tsx`
- Create: `packages/ui/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Create WebSocket hook**

File: `packages/ui/src/hooks/useWebSocket.ts`
```typescript
import type { WsRequest } from '@taskflow/shared';

let ws: WebSocket | null = null;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

export function connectWebSocket(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(`ws://localhost:${port}`);

    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Response to a request
      if (data.correlationId && pendingRequests.has(data.correlationId)) {
        const pending = pendingRequests.get(data.correlationId)!;
        pendingRequests.delete(data.correlationId);
        if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data.payload);
        }
        return;
      }

      // Event broadcast
      if (data.type) {
        const listeners = eventListeners.get(data.type);
        if (listeners) {
          for (const listener of listeners) {
            listener(data.payload);
          }
        }
      }
    };

    ws.onclose = () => {
      // Reject all pending requests
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error('WebSocket closed'));
      }
      pendingRequests.clear();
    };
  });
}

export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const correlationId = crypto.randomUUID();
    pendingRequests.set(correlationId, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    const request: WsRequest = { correlationId, type, payload };
    ws.send(JSON.stringify(request));

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(correlationId)) {
        pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout: ${type}`));
      }
    }, 30000);
  });
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
  if (!eventListeners.has(type)) {
    eventListeners.set(type, new Set());
  }
  eventListeners.get(type)!.add(handler);

  return () => {
    eventListeners.get(type)?.delete(handler);
  };
}
```

- [ ] **Step 2: Create WebSocket provider**

File: `packages/ui/src/providers/WebSocketProvider.tsx`
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { connectWebSocket } from '../hooks/useWebSocket';

interface WsContextValue {
  connected: boolean;
  error: string | null;
}

const WsContext = createContext<WsContextValue>({ connected: false, error: null });

export function useWsStatus() {
  return useContext(WsContext);
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function connect() {
      try {
        // Get port from Electron preload or fall back to env/default
        let port: number;
        if (window.taskflow) {
          port = await window.taskflow.getBackendPort();
        } else {
          // Dev mode: read from env or default
          port = parseInt(import.meta.env.VITE_BACKEND_PORT ?? '0');
          if (!port) {
            // Try reading port file via fetch to a local endpoint
            const resp = await fetch('/api/port');
            port = parseInt(await resp.text());
          }
        }

        await connectWebSocket(port);
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    }

    connect();
  }, []);

  return (
    <WsContext.Provider value={{ connected, error }}>
      {children}
    </WsContext.Provider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/useWebSocket.ts packages/ui/src/providers/WebSocketProvider.tsx
git commit -m "feat: add WebSocket provider and request/event hooks"
```

### Task 5.3: Zustand stores

**Files:**
- Create: `packages/ui/src/stores/project-store.ts`
- Create: `packages/ui/src/stores/task-store.ts`
- Create: `packages/ui/src/stores/session-store.ts`
- Create: `packages/ui/src/stores/file-store.ts`
- Create: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Create project store**

File: `packages/ui/src/stores/project-store.ts`
```typescript
import { create } from 'zustand';
import type { Project } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../hooks/useWebSocket';

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  fetchProjects(): Promise<void>;
  addProject(name: string | undefined, path: string): Promise<Project>;
  removeProject(id: string): Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  loading: false,

  async fetchProjects() {
    set({ loading: true });
    const { projects } = await sendRequest<{ projects: Project[] }>(MSG.PROJECT_LIST);
    set({ projects, loading: false });
  },

  async addProject(name, path) {
    const project = await sendRequest<Project>(MSG.PROJECT_ADD, { name, path });
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  async removeProject(id) {
    await sendRequest(MSG.PROJECT_REMOVE, { id });
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));
```

- [ ] **Step 2: Create task store**

File: `packages/ui/src/stores/task-store.ts`
```typescript
import { create } from 'zustand';
import type { Task } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../hooks/useWebSocket';

interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null;
  loading: boolean;
  fetchTasks(): Promise<void>;
  createTask(projectId: string, title: string): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<void>;
  archiveTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  setActiveTask(id: string | null): void;
  getActiveTask(): Task | undefined;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  loading: false,

  async fetchTasks() {
    set({ loading: true });
    const { tasks } = await sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST);
    set({ tasks, loading: false });
  },

  async createTask(projectId, title) {
    const task = await sendRequest<Task>(MSG.TASK_CREATE, { projectId, title });
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  async updateTask(id, updates) {
    const updated = await sendRequest<Task>(MSG.TASK_UPDATE, { id, ...updates });
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? updated : t)) }));
  },

  async archiveTask(id) {
    await sendRequest(MSG.TASK_ARCHIVE, { id });
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
    }));
  },

  async deleteTask(id) {
    await sendRequest(MSG.TASK_DELETE, { id });
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
    }));
  },

  setActiveTask(id) {
    set({ activeTaskId: id });
  },

  getActiveTask() {
    const { tasks, activeTaskId } = get();
    return tasks.find((t) => t.id === activeTaskId);
  },
}));
```

- [ ] **Step 3: Create session store**

File: `packages/ui/src/stores/session-store.ts`
```typescript
import { create } from 'zustand';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../hooks/useWebSocket';

export interface Tab {
  id: string;
  type: 'claude' | 'codex' | 'editor' | 'changes' | 'browser';
  label: string;
  sessionId?: string; // For terminal tabs
  filePath?: string;  // For editor tabs
  url?: string;       // For browser tabs
}

interface SessionStore {
  tabsByTask: Record<string, Tab[]>;
  activeTabByTask: Record<string, string>;
  createSession(taskId: string, type: 'claude' | 'codex', label?: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  sendInput(sessionId: string, data: string): void;
  resizeTerminal(sessionId: string, cols: number, rows: number): void;
  addTab(taskId: string, tab: Tab): void;
  closeTab(taskId: string, tabId: string): Promise<void>;
  setActiveTab(taskId: string, tabId: string): void;
  getTabs(taskId: string): Tab[];
  getActiveTab(taskId: string): Tab | undefined;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  tabsByTask: {},
  activeTabByTask: {},

  async createSession(taskId, type, label) {
    const { sessionId } = await sendRequest<{ sessionId: string }>(
      MSG.SESSION_CREATE, { taskId, type, label }
    );
    const tab: Tab = {
      id: sessionId,
      type,
      label: label ?? `${type} session`,
      sessionId,
    };
    get().addTab(taskId, tab);
    return sessionId;
  },

  async closeSession(sessionId) {
    await sendRequest(MSG.SESSION_CLOSE, { sessionId });
  },

  sendInput(sessionId, data) {
    sendRequest(MSG.SESSION_INPUT, { sessionId, data }).catch(console.error);
  },

  resizeTerminal(sessionId, cols, rows) {
    sendRequest(MSG.TERMINAL_RESIZE, { sessionId, cols, rows }).catch(console.error);
  },

  addTab(taskId, tab) {
    set((s) => {
      const tabs = [...(s.tabsByTask[taskId] ?? []), tab];
      return {
        tabsByTask: { ...s.tabsByTask, [taskId]: tabs },
        activeTabByTask: { ...s.activeTabByTask, [taskId]: tab.id },
      };
    });
  },

  async closeTab(taskId, tabId) {
    const tab = (get().tabsByTask[taskId] ?? []).find((entry) => entry.id === tabId);
    if (tab?.sessionId) {
      await sendRequest(MSG.SESSION_CLOSE, { sessionId: tab.sessionId });
    }

    set((s) => {
      const tabs = (s.tabsByTask[taskId] ?? []).filter((t) => t.id !== tabId);
      const activeId = s.activeTabByTask[taskId] === tabId
        ? tabs[tabs.length - 1]?.id ?? ''
        : s.activeTabByTask[taskId];
      return {
        tabsByTask: { ...s.tabsByTask, [taskId]: tabs },
        activeTabByTask: { ...s.activeTabByTask, [taskId]: activeId },
      };
    });
  },

  setActiveTab(taskId, tabId) {
    set((s) => ({
      activeTabByTask: { ...s.activeTabByTask, [taskId]: tabId },
    }));
  },

  getTabs(taskId) {
    return get().tabsByTask[taskId] ?? [];
  },

  getActiveTab(taskId) {
    const tabs = get().getTabs(taskId);
    const activeId = get().activeTabByTask[taskId];
    return tabs.find((t) => t.id === activeId);
  },
}));
```

- [ ] **Step 4: Create file store**

File: `packages/ui/src/stores/file-store.ts`
```typescript
import { create } from 'zustand';
import type { FileNode, GitStatusResult, FileChangeEvent } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { onEvent, sendRequest } from '../hooks/useWebSocket';

interface FileStore {
  tree: FileNode | null;
  gitStatus: GitStatusResult | null;
  watchedPath: string | null;
  loading: boolean;
  fetchTree(path: string): Promise<void>;
  fetchGitStatus(path: string): Promise<void>;
  watchPath(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

let fileChangeSubscriptionReady = false;
let fileChangeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useFileStore = create<FileStore>((set, get) => ({
  tree: null,
  gitStatus: null,
  watchedPath: null,
  loading: false,

  async fetchTree(path) {
    set({ loading: true });
    const { tree } = await sendRequest<{ tree: FileNode }>(MSG.FILE_TREE, { path });
    set({ tree, loading: false });
  },

  async fetchGitStatus(path) {
    const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path });
    set({ gitStatus: status });
  },

  async watchPath(path) {
    set({ watchedPath: path });

    if (!fileChangeSubscriptionReady) {
      fileChangeSubscriptionReady = true;
      onEvent(MSG.FILE_CHANGED, (payload) => {
        const event = payload as FileChangeEvent;
        const watchedPath = get().watchedPath;
        if (!watchedPath || !event.path.startsWith(watchedPath)) return;

        if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
        fileChangeRefreshTimer = setTimeout(() => {
          get().fetchTree(watchedPath).catch(console.error);
          get().fetchGitStatus(watchedPath).catch(console.error);
        }, 150);
      });
    }

    await sendRequest(MSG.FILE_WATCH, { path });
  },

  async readFile(path) {
    const { content } = await sendRequest<{ content: string }>(MSG.FILE_READ, { path });
    return content;
  },

  async writeFile(path, content) {
    await sendRequest(MSG.FILE_WRITE, { path, content });
    const watchedPath = get().watchedPath;
    if (watchedPath && path.startsWith(watchedPath)) {
      await get().fetchGitStatus(watchedPath);
    }
  },
}));
```

- [ ] **Step 5: Create UI store**

File: `packages/ui/src/stores/ui-store.ts`
```typescript
import { create } from 'zustand';

interface UIStore {
  fileExplorerOpen: boolean;
  taskInfoOpen: boolean;
  sidebarWidth: number;
  toggleFileExplorer(): void;
  toggleTaskInfo(): void;
  setSidebarWidth(width: number): void;
}

export const useUIStore = create<UIStore>((set) => ({
  fileExplorerOpen: false,
  taskInfoOpen: false,
  sidebarWidth: 220,

  toggleFileExplorer() {
    set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen }));
  },

  toggleTaskInfo() {
    set((s) => ({ taskInfoOpen: !s.taskInfoOpen }));
  },

  setSidebarWidth(width) {
    set({ sidebarWidth: width });
  },
}));
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/
git commit -m "feat: add Zustand stores for projects, tasks, sessions, files, UI"
```

### Task 5.4: AppShell layout component

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Create: `packages/ui/src/components/AppShell.tsx`

- [ ] **Step 1: Create AppShell**

File: `packages/ui/src/components/AppShell.tsx`
```tsx
import type { ReactNode } from 'react';
import { useUIStore } from '../stores/ui-store';

interface AppShellProps {
  sidebar: ReactNode;
  fileExplorer: ReactNode;
  workspace: ReactNode;
  taskInfo: ReactNode;
}

export function AppShell({ sidebar, fileExplorer, workspace, taskInfo }: AppShellProps) {
  const { fileExplorerOpen, taskInfoOpen, sidebarWidth } = useUIStore();

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Task sidebar */}
      <div style={{
        width: sidebarWidth,
        minWidth: 180,
        maxWidth: 350,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {sidebar}
      </div>

      {/* File explorer rail */}
      {fileExplorerOpen ? (
        <div style={{
          width: 220,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {fileExplorer}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleFileExplorer()}
          style={{
            width: 24,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 9,
            color: 'var(--text-muted)',
            letterSpacing: 2,
            userSelect: 'none',
          }}
        >
          FILES
        </div>
      )}

      {/* Main workspace */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {workspace}
      </div>

      {/* Task info rail */}
      {taskInfoOpen ? (
        <div style={{
          width: 220,
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {taskInfo}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleTaskInfo()}
          style={{
            width: 24,
            background: 'var(--bg-surface)',
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            writingMode: 'vertical-rl',
            fontSize: 9,
            color: 'var(--text-muted)',
            letterSpacing: 2,
            userSelect: 'none',
          }}
        >
          TASK
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to use AppShell**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from './providers/WebSocketProvider';
import { AppShell } from './components/AppShell';

export function App() {
  return (
    <WebSocketProvider>
      <AppShell
        sidebar={<div style={{ padding: 12, color: 'var(--text-muted)' }}>Task Sidebar</div>}
        fileExplorer={<div style={{ padding: 12, color: 'var(--text-muted)' }}>File Explorer</div>}
        workspace={<div style={{ padding: 12, color: 'var(--text-muted)' }}>Workspace</div>}
        taskInfo={<div style={{ padding: 12, color: 'var(--text-muted)' }}>Task Info</div>}
      />
    </WebSocketProvider>
  );
}
```

- [ ] **Step 3: Verify UI renders in dev mode**

Run: `cd packages/ui && bunx vite &; sleep 3; curl -s http://localhost:5173 | head -5; kill %1 2>/dev/null; true`
Expected: HTML output with Taskflow

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx packages/ui/src/App.tsx
git commit -m "feat: add AppShell 3-zone layout with collapsible panels"
```

### Task 5.5: Task sidebar components

**Files:**
- Create: `packages/ui/src/components/sidebar/TaskSidebar.tsx`
- Create: `packages/ui/src/components/sidebar/ProjectGroup.tsx`
- Create: `packages/ui/src/components/sidebar/TaskCard.tsx`

- [ ] **Step 1: Create TaskCard**

File: `packages/ui/src/components/sidebar/TaskCard.tsx`
```tsx
import type { Task } from '@taskflow/shared';

interface TaskCardProps {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}

export function TaskCard({ task, isActive, onClick }: TaskCardProps) {
  const borderColor = task.status === 'archived'
    ? 'var(--accent-green)'
    : isActive ? 'var(--accent-blue)' : 'var(--accent-yellow)';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px',
        margin: '2px 6px',
        borderRadius: 4,
        borderLeft: `3px solid ${borderColor}`,
        background: isActive ? 'var(--bg-overlay)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <div style={{
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: isActive ? 'bold' : 'normal',
      }}>
        {task.title}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
        {task.sessions.map((s) => (
          <span key={s.id} style={{
            color: s.type === 'claude' ? 'var(--accent-green)' : 'var(--accent-yellow)',
            marginRight: 6,
          }}>
            ● {s.type}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectGroup**

File: `packages/ui/src/components/sidebar/ProjectGroup.tsx`
```tsx
import { useState } from 'react';
import type { Project, Task } from '@taskflow/shared';
import { TaskCard } from './TaskCard';

interface ProjectGroupProps {
  project: Project;
  tasks: Task[];
  activeTaskId: string | null;
  onTaskClick: (taskId: string) => void;
}

export function ProjectGroup({ project, tasks, activeTaskId, onTaskClick }: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '4px 10px',
          color: 'var(--text-muted)',
          fontSize: 9,
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span>{collapsed ? '▸' : '▾'} {project.name}</span>
        <span style={{
          background: 'var(--bg-overlay)',
          borderRadius: 8,
          padding: '0 5px',
          fontSize: 8,
        }}>
          {tasks.length}
        </span>
      </div>
      {!collapsed && tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          isActive={task.id === activeTaskId}
          onClick={() => onTaskClick(task.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create TaskSidebar**

File: `packages/ui/src/components/sidebar/TaskSidebar.tsx`
```tsx
import { useEffect } from 'react';
import { useProjectStore } from '../../stores/project-store';
import { useTaskStore } from '../../stores/task-store';
import { ProjectGroup } from './ProjectGroup';

export function TaskSidebar() {
  const { projects, fetchProjects, addProject } = useProjectStore();
  const { tasks, activeTaskId, fetchTasks, setActiveTask, createTask } = useTaskStore();

  useEffect(() => {
    fetchProjects();
    fetchTasks();
  }, []);

  const tasksByProject = (projectId: string) =>
    tasks.filter((t) => t.projectId === projectId);

  const handleAddProject = async (): Promise<string | null> => {
    const path = await window.taskflow?.selectProjectDirectory?.();
    if (!path) return null;

    const suggestedName = path.split('/').pop() ?? '';
    const input = window.prompt('Project name (optional)', suggestedName);
    const project = await addProject(input?.trim() || undefined, path);
    return project.id;
  };

  const handleNewTask = async () => {
    let projectId = activeTaskId
      ? tasks.find((task) => task.id === activeTaskId)?.projectId
      : projects[0]?.id;

    if (!projectId) {
      projectId = await handleAddProject();
      if (!projectId) return;
    }

    const title = window.prompt('Task title');
    if (!title?.trim()) return;

    const task = await createTask(projectId, title.trim());
    setActiveTask(task.id);
  };

  return (
    <>
      {/* Search + New */}
      <div style={{
        padding: 8,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: 4,
      }}>
        <input
          placeholder="Search tasks..."
          style={{
            flex: 1,
            background: 'var(--bg-overlay)',
            border: 'none',
            borderRadius: 3,
            padding: '3px 6px',
            color: 'var(--text-primary)',
            fontSize: 11,
            outline: 'none',
          }}
        />
        <button
          onClick={handleNewTask}
          style={{
          background: 'var(--bg-overlay)',
          border: 'none',
          borderRadius: 3,
          padding: '3px 8px',
          color: 'var(--accent-blue)',
          cursor: 'pointer',
          fontSize: 12,
        }}
        >
          +
        </button>
      </div>

      {/* Project groups */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {projects.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
            <div style={{ marginBottom: 8 }}>No projects yet.</div>
            <button
              onClick={handleAddProject}
              style={{
                background: 'var(--bg-overlay)',
                border: 'none',
                borderRadius: 3,
                padding: '4px 8px',
                color: 'var(--accent-blue)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Add Project
            </button>
          </div>
        )}
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            tasks={tasksByProject(project.id)}
            activeTaskId={activeTaskId}
            onTaskClick={setActiveTask}
          />
        ))}
      </div>

      {/* Bottom bar */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '6px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        color: 'var(--text-muted)',
        fontSize: 11,
      }}>
        <span style={{ cursor: 'pointer' }} onClick={handleAddProject}>Add Project</span>
        <span style={{ cursor: 'pointer' }}>Settings</span>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/
git commit -m "feat: add task sidebar with project groups and task cards"
```

### Task 5.6: Workspace skeleton

**Files:**
- Create: `packages/ui/src/components/workspace/Workspace.tsx`
- Create: `packages/ui/src/components/workspace/TaskHeader.tsx`
- Create: `packages/ui/src/components/workspace/TabBar.tsx`
- Create: `packages/ui/src/components/workspace/TabContent.tsx`

- [ ] **Step 1: Create TaskHeader**

File: `packages/ui/src/components/workspace/TaskHeader.tsx`
```tsx
import type { Task, Project } from '@taskflow/shared';

interface TaskHeaderProps {
  task: Task;
  project: Project | undefined;
}

export function TaskHeader({ task, project }: TaskHeaderProps) {
  return (
    <div style={{
      padding: '5px 12px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>
          {task.title}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {project?.name}
        </span>
        {task.worktree.branch && (
          <span style={{
            color: 'var(--text-muted)',
            fontSize: 9,
            background: 'var(--bg-overlay)',
            padding: '1px 6px',
            borderRadius: 3,
          }}>
            {task.worktree.branch}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TabBar**

File: `packages/ui/src/components/workspace/TabBar.tsx`
```tsx
import type { Tab } from '../../stores/session-store';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: (type: 'claude' | 'codex' | 'browser') => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  const tabColor = (tab: Tab) => {
    if (tab.type === 'claude') return 'var(--accent-green)';
    if (tab.type === 'codex') return 'var(--accent-yellow)';
    return 'var(--text-muted)';
  };

  return (
    <div style={{
      padding: '3px 8px',
      background: 'var(--bg-surface)',
      display: 'flex',
      gap: 2,
      fontSize: 11,
      borderBottom: '1px solid var(--border)',
      alignItems: 'center',
    }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onTabClick(tab.id)}
          style={{
            padding: '2px 8px',
            borderRadius: 3,
            background: tab.id === activeTabId ? 'var(--bg-overlay)' : 'transparent',
            color: tabColor(tab),
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span>{tab.label}</span>
          <span
            onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
            style={{ color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer' }}
          >
            ✕
          </span>
        </div>
      ))}

      {/* New tab dropdown */}
      <div style={{ position: 'relative' }}>
        <select
          onChange={(e) => {
            if (e.target.value) {
              onNewTab(e.target.value as 'claude' | 'codex' | 'browser');
              e.target.value = '';
            }
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          <option value="">+</option>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="browser">Browser</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create TabContent**

File: `packages/ui/src/components/workspace/TabContent.tsx`
```tsx
import type { Tab } from '../../stores/session-store';

interface TabContentProps {
  tab: Tab | undefined;
}

export function TabContent({ tab }: TabContentProps) {
  if (!tab) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        No active tab. Create a session with +
      </div>
    );
  }

  // Placeholder — will be replaced with real pane components in Chunk 6
  return (
    <div style={{ flex: 1, padding: 12, color: 'var(--text-secondary)' }}>
      <p>Tab: {tab.label} ({tab.type})</p>
      {tab.sessionId && <p>Session: {tab.sessionId}</p>}
      {tab.filePath && <p>File: {tab.filePath}</p>}
      {tab.url && <p>URL: {tab.url}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create Workspace**

File: `packages/ui/src/components/workspace/Workspace.tsx`
```tsx
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';
import { useSessionStore } from '../../stores/session-store';
import { TaskHeader } from './TaskHeader';
import { TabBar } from './TabBar';
import { TabContent } from './TabContent';

export function Workspace() {
  const { activeTaskId } = useTaskStore();
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  const { getTabs, getActiveTab, setActiveTab, closeTab, createSession, addTab } = useSessionStore();

  if (!task) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 14,
      }}>
        Select a task from the sidebar
      </div>
    );
  }

  const tabs = getTabs(task.id);
  const activeTab = getActiveTab(task.id);

  const handleNewTab = async (type: 'claude' | 'codex' | 'browser') => {
    if (type === 'browser') {
      addTab(task.id, {
        id: crypto.randomUUID(),
        type: 'browser',
        label: 'Browser',
        url: 'http://localhost:3000',
      });
    } else {
      await createSession(task.id, type);
    }
  };

  return (
    <>
      <TaskHeader task={task} project={project} />
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id ?? ''}
        onTabClick={(id) => setActiveTab(task.id, id)}
        onTabClose={(id) => { void closeTab(task.id, id); }}
        onNewTab={handleNewTab}
      />
      <TabContent tab={activeTab} />
    </>
  );
}
```

- [ ] **Step 5: Wire everything into App.tsx**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from './providers/WebSocketProvider';
import { AppShell } from './components/AppShell';
import { TaskSidebar } from './components/sidebar/TaskSidebar';
import { Workspace } from './components/workspace/Workspace';

export function App() {
  return (
    <WebSocketProvider>
      <AppShell
        sidebar={<TaskSidebar />}
        fileExplorer={<div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>File Explorer (coming in Chunk 6)</div>}
        workspace={<Workspace />}
        taskInfo={<div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>Task Info (coming in Chunk 6)</div>}
      />
    </WebSocketProvider>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/ packages/ui/src/App.tsx
git commit -m "feat: add workspace with task header, tab bar, and tab content"
```

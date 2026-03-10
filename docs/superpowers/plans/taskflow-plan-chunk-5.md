# Chunk 5: UI Core — Layout, WebSocket, Stores, Sidebar

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 4.5 — shadcn Primitives](taskflow-plan-chunk-4.5.md) | Next: [Chunk 6 — UI Panes](taskflow-plan-chunk-6.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UI shell — WebSocket communication, Zustand state, layout, sidebar, and workspace skeleton.

**Architecture:** React app with Zustand stores communicating to the backend via WebSocket. AppShell provides a 3-zone layout (sidebar, workspace, panels). All UI components compose shadcn primitives with cva variants.

**Tech Stack:** React 19, Zustand 5, Vite 6, Tailwind CSS 4, shadcn/ui, cva, lucide-react

> **Depends on:** Chunk 4.5 (shadcn components in `packages/ui/src/components/ui/`, `cn()` in `src/lib/utils.ts`, shadcn CSS variables in `global.css`). Specifically requires the Badge `colorScheme` compound variant (Task 4.5.4) with values `claude`, `codex`, `active`, `archived`. All components use Tailwind utility classes with these CSS variables: `bg-background`, `bg-card`, `bg-popover`, `text-foreground`, `text-secondary-foreground`, `text-muted-foreground`, `border-border`, `text-accent`.

> **Shared types used:** `Project`, `Task` (with `sessions: SessionRef[]`, `worktree: { enabled: boolean; path: string | null; branch: string | null }`), `FileNode`, `GitStatusResult`, `FileChangeEvent`, `WsRequest`, `MSG` constants — all from `@taskflow/shared`.

---

### Task 5.1: Vite config for the UI package

**Files:**
- Create: `packages/ui/vite.config.ts`

> **Note:** If this file already exists from Chunk 4.5 Task 4.5.2 (which adds the `@` alias), verify it matches and skip to Step 2.

- [ ] **Step 1: Create Vite config**

File: `packages/ui/vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: { outDir: 'dist' },
  server: { port: 5173 },
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

### Task 5.2: WebSocket hook and provider

**Files:**
- Create: `packages/ui/src/hooks/useWebSocket.ts`
- Create: `packages/ui/src/providers/WebSocketProvider.tsx`

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
      if (data.correlationId && pendingRequests.has(data.correlationId)) {
        const pending = pendingRequests.get(data.correlationId)!;
        pendingRequests.delete(data.correlationId);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.payload);
        return;
      }
      if (data.type) {
        const listeners = eventListeners.get(data.type);
        if (listeners) for (const listener of listeners) listener(data.payload);
      }
    };
    ws.onclose = () => {
      for (const [, pending] of pendingRequests) pending.reject(new Error('WebSocket closed'));
      pendingRequests.clear();
    };
  });
}

export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket not connected')); return; }
    const correlationId = crypto.randomUUID();
    pendingRequests.set(correlationId, { resolve: resolve as (value: unknown) => void, reject });
    const request: WsRequest = { correlationId, type, payload };
    ws.send(JSON.stringify(request));
    setTimeout(() => {
      if (pendingRequests.has(correlationId)) {
        pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout: ${type}`));
      }
    }, 30000);
  });
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
  if (!eventListeners.has(type)) eventListeners.set(type, new Set());
  eventListeners.get(type)!.add(handler);
  return () => { eventListeners.get(type)?.delete(handler); };
}
```

- [ ] **Step 2: Create WebSocket provider**

File: `packages/ui/src/providers/WebSocketProvider.tsx`
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { connectWebSocket } from '../hooks/useWebSocket';

interface WsContextValue { connected: boolean; error: string | null; }
const WsContext = createContext<WsContextValue>({ connected: false, error: null });
export function useWsStatus() { return useContext(WsContext); }

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function connect() {
      try {
        let port: number;
        if (window.taskflow) {
          port = await window.taskflow.getBackendPort();
        } else {
          port = parseInt(import.meta.env.VITE_BACKEND_PORT ?? '0');
          if (!port) {
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

  return <WsContext.Provider value={{ connected, error }}>{children}</WsContext.Provider>;
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
  setActiveTask(id) { set({ activeTaskId: id }); },
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
  sessionId?: string;
  filePath?: string;
  url?: string;
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
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, { taskId, type, label });
    const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
    get().addTab(taskId, tab);
    return sessionId;
  },
  async closeSession(sessionId) { await sendRequest(MSG.SESSION_CLOSE, { sessionId }); },
  sendInput(sessionId, data) { sendRequest(MSG.SESSION_INPUT, { sessionId, data }).catch(console.error); },
  resizeTerminal(sessionId, cols, rows) { sendRequest(MSG.TERMINAL_RESIZE, { sessionId, cols, rows }).catch(console.error); },
  addTab(taskId, tab) {
    set((s) => ({
      tabsByTask: { ...s.tabsByTask, [taskId]: [...(s.tabsByTask[taskId] ?? []), tab] },
      activeTabByTask: { ...s.activeTabByTask, [taskId]: tab.id },
    }));
  },
  async closeTab(taskId, tabId) {
    const tab = (get().tabsByTask[taskId] ?? []).find((entry) => entry.id === tabId);
    if (tab?.sessionId) await sendRequest(MSG.SESSION_CLOSE, { sessionId: tab.sessionId });
    set((s) => {
      const tabs = (s.tabsByTask[taskId] ?? []).filter((t) => t.id !== tabId);
      const activeId = s.activeTabByTask[taskId] === tabId ? tabs[tabs.length - 1]?.id ?? '' : s.activeTabByTask[taskId];
      return { tabsByTask: { ...s.tabsByTask, [taskId]: tabs }, activeTabByTask: { ...s.activeTabByTask, [taskId]: activeId } };
    });
  },
  setActiveTab(taskId, tabId) { set((s) => ({ activeTabByTask: { ...s.activeTabByTask, [taskId]: tabId } })); },
  getTabs(taskId) { return get().tabsByTask[taskId] ?? []; },
  getActiveTab(taskId) {
    const tabs = get().getTabs(taskId);
    return tabs.find((t) => t.id === get().activeTabByTask[taskId]);
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
  tree: null, gitStatus: null, watchedPath: null, loading: false,
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
    if (watchedPath && path.startsWith(watchedPath)) await get().fetchGitStatus(watchedPath);
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
  toggleFileExplorer() { set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen })); },
  toggleTaskInfo() { set((s) => ({ taskInfoOpen: !s.taskInfoOpen })); },
  setSidebarWidth(width) { set({ sidebarWidth: width }); },
}));
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/project-store.ts packages/ui/src/stores/task-store.ts packages/ui/src/stores/session-store.ts packages/ui/src/stores/file-store.ts packages/ui/src/stores/ui-store.ts
git commit -m "feat: add Zustand stores for projects, tasks, sessions, files, UI"
```

### Task 5.4: AppShell layout component

**Files:**
- Create: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Create AppShell**

File: `packages/ui/src/components/AppShell.tsx`
```tsx
import type { ReactNode } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface AppShellProps {
  sidebar: ReactNode;
  fileExplorer: ReactNode;
  workspace: ReactNode;
  taskInfo: ReactNode;
}

export function AppShell({ sidebar, fileExplorer, workspace, taskInfo }: AppShellProps) {
  const { fileExplorerOpen, taskInfoOpen, sidebarWidth } = useUIStore();

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        className="min-w-[180px] max-w-[350px] bg-card flex flex-col"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </div>

      <Separator orientation="vertical" />

      {fileExplorerOpen ? (
        <div className="w-[220px] bg-card flex flex-col">
          {fileExplorer}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleFileExplorer()}
          className={cn(
            'w-6 bg-card flex items-center justify-center',
            'cursor-pointer [writing-mode:vertical-rl] rotate-180',
            'text-[9px] text-muted-foreground tracking-widest select-none',
            'hover:bg-muted/50 transition-colors',
          )}
        >
          FILES
        </div>
      )}

      <Separator orientation="vertical" />

      <div className="flex-1 flex flex-col overflow-hidden">{workspace}</div>

      <Separator orientation="vertical" />

      {taskInfoOpen ? (
        <div className="w-[220px] bg-card flex flex-col">
          {taskInfo}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleTaskInfo()}
          className={cn(
            'w-6 bg-card flex items-center justify-center',
            'cursor-pointer [writing-mode:vertical-rl]',
            'text-[9px] text-muted-foreground tracking-widest select-none',
            'hover:bg-muted/50 transition-colors',
          )}
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
import { WebSocketProvider } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';

export function App() {
  return (
    <WebSocketProvider>
      <AppShell
        sidebar={<div className="p-3 text-muted-foreground">Task Sidebar</div>}
        fileExplorer={<div className="p-3 text-muted-foreground">File Explorer</div>}
        workspace={<div className="p-3 text-muted-foreground">Workspace</div>}
        taskInfo={<div className="p-3 text-muted-foreground">Task Info</div>}
      />
    </WebSocketProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx packages/ui/src/App.tsx
git commit -m "feat: add AppShell 3-zone layout with collapsible panels"
```

### Task 5.5: Task sidebar components

**Files:**
- Create: `packages/ui/src/components/sidebar/TaskCard.tsx`
- Create: `packages/ui/src/components/sidebar/ProjectGroup.tsx`
- Create: `packages/ui/src/components/sidebar/TaskSidebar.tsx`

- [ ] **Step 1: Create TaskCard**

File: `packages/ui/src/components/sidebar/TaskCard.tsx`
```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import type { Task } from '@taskflow/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const taskCardVariants = cva(
  'px-2.5 py-1.5 mx-1.5 my-0.5 rounded cursor-pointer border-l-[3px]',
  {
    variants: {
      active: {
        true: 'bg-muted',
        false: 'bg-transparent hover:bg-muted/50',
      },
      status: {
        active: 'border-l-accent',
        archived: 'border-l-success',
        default: 'border-l-warning',
      },
    },
    defaultVariants: { active: false, status: 'default' },
  },
);

interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  className?: string;
}

export function TaskCard({ task, isActive, onClick, className }: TaskCardProps) {
  const status = task.status === 'archived' ? 'archived' : task.status === 'active' ? 'active' : 'default';

  return (
    <div onClick={onClick} className={cn(taskCardVariants({ active: isActive, status }), className)}>
      <div className={cn('text-xs', isActive ? 'text-foreground font-bold' : 'text-secondary-foreground')}>
        {task.title}
      </div>
      {task.sessions.length > 0 && (
        <div className="flex gap-1.5 mt-0.5">
          {task.sessions.map((s) => (
            <Badge key={s.id} variant="outline" colorScheme={s.type === 'claude' ? 'claude' : 'codex'} className="text-[10px] px-1 py-0">
              {s.type}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectGroup**

File: `packages/ui/src/components/sidebar/ProjectGroup.tsx`
```tsx
import { useState } from 'react';
import type { Project, Task } from '@taskflow/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { TaskCard } from './TaskCard';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ProjectGroupProps {
  project: Project;
  tasks: Task[];
  activeTaskId: string | null;
  onTaskClick: (taskId: string) => void;
}

export function ProjectGroup({ project, tasks, activeTaskId, onTaskClick }: ProjectGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full px-2.5 py-1 flex justify-between items-center cursor-pointer select-none hover:bg-muted/50 transition-colors">
        <span className="text-muted-foreground text-[9px] uppercase flex items-center gap-1">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {project.name}
        </span>
        <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{tasks.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} isActive={task.id === activeTaskId} onClick={() => onTaskClick(task.id)} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 3: Create TaskSidebar**

File: `packages/ui/src/components/sidebar/TaskSidebar.tsx`
```tsx
import { useEffect } from 'react';
import { useProjectStore } from '@/stores/project-store';
import { useTaskStore } from '@/stores/task-store';
import { ProjectGroup } from './ProjectGroup';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus } from 'lucide-react';

export function TaskSidebar() {
  const { projects, fetchProjects, addProject } = useProjectStore();
  const { tasks, activeTaskId, fetchTasks, setActiveTask, createTask } = useTaskStore();

  useEffect(() => { fetchProjects(); fetchTasks(); }, []);

  const tasksByProject = (projectId: string) => tasks.filter((t) => t.projectId === projectId);

  // TODO: Replace window.prompt() with shadcn Dialog for consistent UX
  const handleAddProject = async (): Promise<string | null> => {
    const path = await window.taskflow?.selectProjectDirectory?.();
    if (!path) return null;
    const suggestedName = path.split('/').pop() ?? '';
    const input = window.prompt('Project name (optional)', suggestedName);
    const project = await addProject(input?.trim() || undefined, path);
    return project.id;
  };

  const handleNewTask = async () => {
    let projectId = activeTaskId ? tasks.find((t) => t.id === activeTaskId)?.projectId : projects[0]?.id;
    if (!projectId) { projectId = await handleAddProject(); if (!projectId) return; }
    const title = window.prompt('Task title');
    if (!title?.trim()) return;
    const task = await createTask(projectId, title.trim());
    setActiveTask(task.id);
  };

  return (
    <>
      <div className="p-2 border-b border-border flex gap-1">
        <Input placeholder="Search tasks..." className="flex-1 h-7 text-xs" />
        <Button variant="ghost" size="icon-sm" onClick={handleNewTask}><Plus className="h-3 w-3" /></Button>
      </div>
      <ScrollArea className="flex-1 py-1">
        {projects.length === 0 && (
          <div className="p-3 text-muted-foreground text-[11px]">
            <div className="mb-2">No projects yet.</div>
            <Button variant="ghost" size="sm" onClick={handleAddProject} className="text-accent text-[11px]">Add Project</Button>
          </div>
        )}
        {projects.map((project) => (
          <ProjectGroup key={project.id} project={project} tasks={tasksByProject(project.id)} activeTaskId={activeTaskId} onTaskClick={setActiveTask} />
        ))}
      </ScrollArea>
      <Separator />
      <div className="px-2.5 py-1.5 flex justify-between">
        <Button variant="ghost" size="sm" onClick={handleAddProject} className="text-muted-foreground text-[11px]">Add Project</Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground text-[11px]">Settings</Button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/components/sidebar/ProjectGroup.tsx packages/ui/src/components/sidebar/TaskCard.tsx
git commit -m "feat: add task sidebar with project groups and task cards"
```

### Task 5.6: Workspace skeleton

**Files:**
- Create: `packages/ui/src/components/workspace/TaskHeader.tsx`
- Create: `packages/ui/src/components/workspace/TabBar.tsx`
- Create: `packages/ui/src/components/workspace/TabContent.tsx`
- Create: `packages/ui/src/components/workspace/Workspace.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Create TaskHeader**

File: `packages/ui/src/components/workspace/TaskHeader.tsx`
```tsx
import type { Task, Project } from '@taskflow/shared';
import { Badge } from '@/components/ui/badge';

interface TaskHeaderProps { task: Task; project: Project | undefined; }

export function TaskHeader({ task, project }: TaskHeaderProps) {
  return (
    <div className="px-3 py-1.5 border-b border-border flex items-center gap-2">
      <span className="text-foreground font-bold text-[13px]">{task.title}</span>
      <span className="text-muted-foreground text-[11px]">{project?.name}</span>
      {task.worktree?.branch && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0">{task.worktree.branch}</Badge>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TabBar**

File: `packages/ui/src/components/workspace/TabBar.tsx`
```tsx
import { cva } from 'class-variance-authority';
import type { Tab } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { X, Plus, Terminal, Code, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabVariants = cva(
  'px-2 py-0.5 rounded-sm cursor-pointer flex items-center gap-1 text-[11px] transition-colors',
  {
    variants: {
      type: { claude: 'text-success', codex: 'text-warning', editor: 'text-muted-foreground', changes: 'text-muted-foreground', browser: 'text-muted-foreground' },
      active: { true: 'bg-muted', false: 'bg-transparent hover:bg-muted/50' },
    },
    defaultVariants: { type: 'editor', active: false },
  },
);

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: (type: 'claude' | 'codex' | 'browser') => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  return (
    <div className="px-2 py-0.5 bg-card flex gap-0.5 border-b border-border items-center">
      {tabs.map((tab) => (
        <div key={tab.id} onClick={() => onTabClick(tab.id)} className={cn(tabVariants({ type: tab.type, active: tab.id === activeTabId }))}>
          <span>{tab.label}</span>
          <Button variant="ghost" size="icon-sm" className="h-4 w-4 ml-0.5" onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}>
            <X className="h-2.5 w-2.5" />
          </Button>
        </div>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><Plus className="h-3 w-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onNewTab('claude')}><Terminal className="h-3.5 w-3.5 mr-2" />Claude Code</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('codex')}><Code className="h-3.5 w-3.5 mr-2" />Codex</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('browser')}><Globe className="h-3.5 w-3.5 mr-2" />Browser</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

Note: TabBar uses a custom cva-driven tab strip rather than shadcn `<Tabs>` because the tab behavior here is non-standard — tabs are dynamic (created/closed at runtime), have per-tab close buttons, and are managed by the session store rather than by Radix state. shadcn `<Tabs>` is designed for static, content-switching tabs.

- [ ] **Step 3: Create TabContent**

File: `packages/ui/src/components/workspace/TabContent.tsx`
```tsx
import type { Tab } from '@/stores/session-store';

interface TabContentProps { tab: Tab | undefined; }

export function TabContent({ tab }: TabContentProps) {
  if (!tab) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">No active tab. Create a session with +</div>;
  }
  // Placeholder — replaced with real pane components in Chunk 6
  return (
    <div className="flex-1 p-3 text-secondary-foreground">
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
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { useSessionStore } from '@/stores/session-store';
import { TaskHeader } from './TaskHeader';
import { TabBar } from './TabBar';
import { TabContent } from './TabContent';

export function Workspace() {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { getTabs, getActiveTab, setActiveTab, closeTab, createSession, addTab } = useSessionStore();

  if (!task) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Select a task from the sidebar</div>;
  }

  const tabs = getTabs(task.id);
  const activeTab = getActiveTab(task.id);

  const handleNewTab = async (type: 'claude' | 'codex' | 'browser') => {
    if (type === 'browser') {
      addTab(task.id, { id: crypto.randomUUID(), type: 'browser', label: 'Browser', url: 'http://localhost:3000' });
    } else {
      await createSession(task.id, type);
    }
  };

  return (
    <>
      <TaskHeader task={task} project={project} />
      <TabBar tabs={tabs} activeTabId={activeTab?.id ?? ''} onTabClick={(id) => setActiveTab(task.id, id)} onTabClose={(id) => { void closeTab(task.id, id); }} onNewTab={handleNewTab} />
      <TabContent tab={activeTab} />
    </>
  );
}
```

- [ ] **Step 5: Wire everything into App.tsx**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';
import { TaskSidebar } from '@/components/sidebar/TaskSidebar';
import { Workspace } from '@/components/workspace/Workspace';
import { TooltipProvider } from '@/components/ui/tooltip';

export function App() {
  return (
    <WebSocketProvider>
      <TooltipProvider>
        <AppShell
          sidebar={<TaskSidebar />}
          fileExplorer={<div className="p-3 text-muted-foreground text-[11px]">File Explorer (coming in Chunk 6)</div>}
          workspace={<Workspace />}
          taskInfo={<div className="p-3 text-muted-foreground text-[11px]">Task Info (coming in Chunk 6)</div>}
        />
      </TooltipProvider>
    </WebSocketProvider>
  );
}
```

Note: `<TooltipProvider>` wraps the app so tooltips work throughout (required by Radix).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx packages/ui/src/components/workspace/TabBar.tsx packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/App.tsx
git commit -m "feat: add workspace with task header, tab bar, and tab content"
```

# Taskflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop app for local developer machines that orchestrates Claude Code and Codex CLIs in a task-oriented workspace with project context.

**Architecture:** Electron shell (workspace launcher) + Bun backend service (PTY, git, files, persistence over WebSocket) + React renderer (Monaco, xterm.js, Zustand). Monorepo with shared types package.

**Tech Stack:** Bun, Electron, React, TypeScript, Monaco, xterm.js, Zustand, node-pty, WebSocket

**Runtime Scope:** v1 is verified as a workspace-run desktop app. Electron launches the backend from the checked-out repo and expects Bun to be installed on the developer machine. Packaging Bun into a standalone distributable app is a follow-up milestone and is not part of this plan.

**Persistence:** Project metadata is stored under `~/.config/taskflow/projects.json`; tasks and archives live under `~/.config/taskflow/tasks/` and `~/.config/taskflow/archive/`. A project record stores the chosen folder path plus an optional display name.

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
- `src/handlers/file.ts` — file:tree, file:read, file:write, file:watch
- `src/handlers/git.ts` — git:status, git:diff, git:diff-file, git:revert-file, git:worktree-create
- `src/services/task-store.ts` — JSON file read/write for projects and tasks
- `src/services/pty-manager.ts` — spawn/manage PTY sessions via node-pty
- `src/services/file-watcher.ts` — FS watching, tree building
- `src/services/git-service.ts` — git CLI wrapper
- `src/services/editor-detector.ts` — detect installed editors (code, cursor, etc.)
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
- `src/index.html` — HTML template
- `src/App.tsx` — root component, wraps providers
- `src/providers/WebSocketProvider.tsx` — WS connection, message routing
- `src/hooks/useWebSocket.ts` — hook for sending requests + receiving responses
- `src/stores/project-store.ts` — useProjectStore
- `src/stores/task-store.ts` — useTaskStore
- `src/stores/session-store.ts` — useSessionStore
- `src/stores/file-store.ts` — useFileStore
- `src/stores/ui-store.ts` — useUIStore
- `src/components/AppShell.tsx` — 3-zone layout
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
- `src/lib/link-provider.ts` — xterm.js link providers for files and URLs
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

---

## Chunk 1: Scaffolding + Shared Types

### Task 1.1: Initialize monorepo

**Files:**
- Create: `package.json`
- Create: `bunfig.toml`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "taskflow",
  "private": true,
  "workspaces": [
    "packages/*",
    "electron"
  ],
  "scripts": {
    "dev:backend": "cd packages/backend && bun run dev",
    "dev:ui": "cd packages/ui && bun run dev",
    "dev:electron": "cd electron && bun run dev",
    "test": "bun test",
    "build": "bun run build:shared && bun run build:backend && bun run build:ui && bun run build:electron",
    "build:shared": "cd packages/shared && bun run build",
    "build:backend": "cd packages/backend && bun run build",
    "build:ui": "cd packages/ui && bun run build",
    "build:electron": "cd electron && bun run build"
  }
}
```

- [ ] **Step 2: Create bunfig.toml**

```toml
[install]
peer = false

[workspace]
packages = ["packages/*", "electron"]
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Update .gitignore**

```
node_modules/
dist/
.superpowers/
.env
*.log
.taskflow-port
*.taskflow-port
```

- [ ] **Step 5: Commit**

```bash
git add package.json bunfig.toml tsconfig.base.json .gitignore
git commit -m "feat: initialize monorepo scaffolding"
```

### Task 1.2: Create shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types/project.ts`
- Create: `packages/shared/src/types/task.ts`
- Create: `packages/shared/src/types/ws.ts`
- Create: `packages/shared/src/types/file.ts`
- Create: `packages/shared/src/types/git.ts`
- Create: `packages/shared/src/types/system.ts`
- Create: `packages/shared/src/constants.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@taskflow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create project types**

File: `packages/shared/src/types/project.ts`
```typescript
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}
```

- [ ] **Step 4: Create task types**

File: `packages/shared/src/types/task.ts`
```typescript
export interface SessionRef {
  id: string;
  type: 'claude' | 'codex';
  label: string;
  createdAt: string;
}

export interface TaskWorktree {
  enabled: boolean;
  path: string | null;
  branch: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  notes: string;
  worktree: TaskWorktree;
  sessions: SessionRef[];
  createdAt: string;
  status: 'active' | 'archived';
  archivedAt: string | null;
}
```

- [ ] **Step 5: Create WebSocket message types**

File: `packages/shared/src/types/ws.ts`
```typescript
import type { Project } from './project';
import type { Task } from './task';
import type { FileNode, FileChangeEvent } from './file';
import type { GitStatusResult, GitDiffResult } from './git';
import type { SystemInfo } from './system';

// Base message types
export interface WsRequest<T = unknown> {
  correlationId: string;
  type: string;
  payload: T;
}

export interface WsResponse<T = unknown> {
  correlationId: string;
  type: string;
  payload: T;
  error?: string;
}

export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
}

// Project messages
export interface ProjectListResponse {
  projects: Project[];
}

export interface ProjectAddPayload {
  name?: string;
  path: string;
}

export interface ProjectRemovePayload {
  id: string;
}

// Task messages
export interface TaskListPayload {
  projectId?: string;
}

export interface TaskListResponse {
  tasks: Task[];
}

export interface TaskCreatePayload {
  projectId: string;
  title: string;
  description?: string;
}

export interface TaskUpdatePayload {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
}

export interface TaskArchivePayload {
  id: string;
}

export interface TaskDeletePayload {
  id: string;
}

// Session messages
export interface SessionCreatePayload {
  taskId: string;
  type: 'claude' | 'codex';
  label?: string;
}

export interface SessionCreateResponse {
  sessionId: string;
}

export interface SessionClosePayload {
  sessionId: string;
}

export interface SessionInputPayload {
  sessionId: string;
  data: string;
}

// Terminal events
export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

// File messages
export interface FileTreePayload {
  path: string;
}

export interface FileTreeResponse {
  tree: FileNode;
}

export interface FileReadPayload {
  path: string;
}

export interface FileReadResponse {
  content: string;
}

export interface FileWatchPayload {
  path: string;
}

export interface FileWritePayload {
  path: string;
  content: string;
}

// Git messages
export interface GitStatusPayload {
  path: string;
}

export interface GitStatusResponse {
  status: GitStatusResult;
}

export interface GitDiffPayload {
  path: string;
}

export interface GitDiffResponse {
  diff: GitDiffResult;
}

export interface GitDiffFilePayload {
  repoPath: string;
  filePath: string;
}

export interface GitDiffFileResponse {
  diff: string;
}

export interface GitRevertFilePayload {
  repoPath: string;
  filePath: string;
}

export interface GitWorktreeCreatePayload {
  repoPath: string;
  branch: string;
  path: string;
}
```

- [ ] **Step 6: Create file types**

File: `packages/shared/src/types/file.ts`
```typescript
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  gitStatus?: 'new' | 'modified' | 'deleted' | 'untracked' | null;
}

export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete';
  path: string;
}
```

- [ ] **Step 7: Create git types**

File: `packages/shared/src/types/git.ts`
```typescript
export interface GitFileStatus {
  path: string;
  absolutePath?: string;
  status: 'new' | 'modified' | 'deleted' | 'untracked' | 'renamed';
}

export interface GitStatusResult {
  branch: string | null;
  files: GitFileStatus[];
}

export interface GitDiffResult {
  files: GitDiffFile[];
}

export interface GitDiffFile {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
}
```

- [ ] **Step 8: Create system types**

File: `packages/shared/src/types/system.ts`
```typescript
export interface EditorInfo {
  id: string;
  name: string;
  command: string;
}

export interface SystemInfo {
  editors: EditorInfo[];
}
```

- [ ] **Step 9: Create constants**

File: `packages/shared/src/constants.ts`
```typescript
// WebSocket message types
export const MSG = {
  // Projects
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',

  // Tasks
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_ARCHIVE: 'task:archive',
  TASK_DELETE: 'task:delete',

  // Sessions
  SESSION_CREATE: 'session:create',
  SESSION_CLOSE: 'session:close',
  SESSION_INPUT: 'session:input',

  // Terminal
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_RESIZE: 'terminal:resize',

  // Files
  FILE_TREE: 'file:tree',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_CHANGED: 'file:changed',
  FILE_WATCH: 'file:watch',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_DIFF_FILE: 'git:diff-file',
  GIT_REVERT_FILE: 'git:revert-file',
  GIT_WORKTREE_CREATE: 'git:worktree-create',

  // System
  SYSTEM_INFO: 'system:info',
} as const;

// Archive expiry (safe to import in browser)
export const ARCHIVE_EXPIRY_DAYS = 30;

// NOTE: Config paths (CONFIG_DIR, PROJECTS_FILE, etc.) live in
// packages/backend/src/config.ts — not here, because process.env.HOME
// is unavailable in the browser renderer.
```

- [ ] **Step 10: Create barrel export**

File: `packages/shared/src/index.ts`
```typescript
export * from './types/project';
export * from './types/task';
export * from './types/ws';
export * from './types/file';
export * from './types/git';
export * from './types/system';
export * from './constants';
```

- [ ] **Step 11: Verify types compile**

Run: `cd packages/shared && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types package with all models and WS message types"
```

### Task 1.3: Scaffold backend package

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/src/index.ts` (placeholder)
- Create: `packages/backend/src/config.ts`

- [ ] **Step 1: Create packages/backend/package.json**

```json
{
  "name": "@taskflow/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "bun test"
  },
  "dependencies": {
    "@taskflow/shared": "workspace:*",
    "node-pty": "^1.0.0",
    "chokidar": "^3.6.0"
  }
}
```

- [ ] **Step 2: Create packages/backend/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create config**

File: `packages/backend/src/config.ts`
```typescript
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.config', 'taskflow');

export const config = {
  configDir: CONFIG_DIR,
  projectsFile: join(CONFIG_DIR, 'projects.json'),
  tasksDir: join(CONFIG_DIR, 'tasks'),
  archiveDir: join(CONFIG_DIR, 'archive'),
  portFile: '/tmp/.taskflow-port',
};

export async function ensureDirectories(): Promise<void> {
  await mkdir(config.configDir, { recursive: true });
  await mkdir(config.tasksDir, { recursive: true });
  await mkdir(config.archiveDir, { recursive: true });
}
```

- [ ] **Step 4: Create placeholder entry point**

File: `packages/backend/src/index.ts`
```typescript
import { ensureDirectories } from './config';

async function main() {
  await ensureDirectories();
  console.log('Taskflow backend starting...');
}

main().catch(console.error);
```

- [ ] **Step 5: Verify it runs**

Run: `cd packages/backend && bun run src/index.ts`
Expected: "Taskflow backend starting..."

- [ ] **Step 6: Commit**

```bash
git add packages/backend/
git commit -m "feat: scaffold backend package with config"
```

### Task 1.4: Scaffold UI package

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.html`
- Create: `packages/ui/src/index.tsx` (placeholder)
- Create: `packages/ui/src/App.tsx` (placeholder)
- Create: `packages/ui/src/styles/global.css`

- [ ] **Step 1: Create packages/ui/package.json**

```json
{
  "name": "@taskflow/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bunx vite",
    "build": "bunx vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@taskflow/shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "xterm": "^5.5.0",
    "xterm-addon-fit": "^0.10.0",
    "xterm-addon-web-links": "^0.11.0",
    "monaco-editor": "^0.52.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^6.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create packages/ui/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create index.html**

Note: Vite expects index.html at the package root, not in src/.

File: `packages/ui/index.html`
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Taskflow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create placeholder App**

File: `packages/ui/src/App.tsx`
```tsx
export function App() {
  return (
    <div style={{ color: '#cdd6f4', background: '#1e1e2e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <h1>Taskflow</h1>
    </div>
  );
}
```

- [ ] **Step 5: Create entry point**

File: `packages/ui/src/index.tsx`
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 6: Create global CSS**

File: `packages/ui/src/styles/global.css`
```css
@import "tailwindcss";

:root {
  --bg-base: #1e1e2e;
  --bg-surface: #181825;
  --bg-overlay: #313244;
  --text-primary: #cdd6f4;
  --text-secondary: #a6adc8;
  --text-muted: #585b70;
  --border: #313244;
  --accent-blue: #89b4fa;
  --accent-green: #a6e3a1;
  --accent-yellow: #f9e2af;
  --accent-red: #f38ba8;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
  overflow: hidden;
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/
git commit -m "feat: scaffold UI package with React, Vite, Tailwind"
```

### Task 1.5: Scaffold Electron package

**Files:**
- Create: `electron/package.json`
- Create: `electron/tsconfig.json`
- Create: `electron/src/main.ts` (placeholder)
- Create: `electron/src/preload.ts` (placeholder)

- [ ] **Step 1: Create electron/package.json**

```json
{
  "name": "@taskflow/electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "dev": "TASKFLOW_UI_URL=http://localhost:5173 electron .",
    "build": "bun build src/main.ts --outdir dist --target node && bun build src/preload.ts --outdir dist --target node"
  },
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

- [ ] **Step 2: Create electron/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create placeholder main**

File: `electron/src/main.ts`
```typescript
console.log('Electron main process placeholder');
```

- [ ] **Step 4: Create placeholder preload**

File: `electron/src/preload.ts`
```typescript
console.log('Preload placeholder');
```

- [ ] **Step 5: Install all dependencies**

Run: `cd /Users/kuindji/Projects/taskflow && bun install`
Expected: Dependencies install successfully

- [ ] **Step 6: Verify shared types are accessible from backend**

Run: `cd packages/backend && bun -e "import { MSG } from '@taskflow/shared'; console.log(MSG.PROJECT_LIST)"`
Expected: `project:list`

- [ ] **Step 7: Commit**

```bash
git add electron/ bun.lockb
git commit -m "feat: scaffold Electron package and install all deps"
```

---

## Chunk 2: Backend Core — WebSocket Server + Project/Task CRUD

### Task 2.1: WebSocket server with Bun.serve

**Files:**
- Create: `packages/backend/src/ws/server.ts`
- Create: `packages/backend/src/ws/router.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Write router test**

File: `packages/backend/tests/ws/router.test.ts`
```typescript
import { describe, it, expect } from 'bun:test';
import { Router } from '../../src/ws/router';

describe('Router', () => {
  it('routes messages to registered handlers', async () => {
    const router = new Router();
    let received: unknown = null;

    router.register('test:echo', async (payload) => {
      received = payload;
      return { echo: payload };
    });

    const result = await router.handle('test:echo', { msg: 'hello' });
    expect(received).toEqual({ msg: 'hello' });
    expect(result).toEqual({ echo: { msg: 'hello' } });
  });

  it('throws on unregistered message type', async () => {
    const router = new Router();
    expect(router.handle('unknown:type', {})).rejects.toThrow('No handler for message type: unknown:type');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && bun test tests/ws/router.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement router**

File: `packages/backend/src/ws/router.ts`
```typescript
export type Handler = (payload: unknown) => Promise<unknown>;

export class Router {
  private handlers = new Map<string, Handler>();

  register(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  async handle(type: string, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler for message type: ${type}`);
    }
    return handler(payload);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && bun test tests/ws/router.test.ts`
Expected: PASS

- [ ] **Step 5: Create WebSocket server**

File: `packages/backend/src/ws/server.ts`
```typescript
import type { Server, ServerWebSocket } from 'bun';
import type { WsRequest, WsResponse, WsEvent } from '@taskflow/shared';
import { Router } from './router';

export interface WsClient {
  ws: ServerWebSocket<unknown>;
  send(msg: WsResponse | WsEvent): void;
}

export function createServer(router: Router, port: number = 0): {
  start(): Promise<{ port: number; stop(): void }>;
  broadcast(event: WsEvent): void;
} {
  let server: Server;
  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(event: WsEvent): void {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      ws.send(data);
    }
  }

  async function start() {
    server = Bun.serve({
      port,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response('Taskflow backend', { status: 200 });
      },
      websocket: {
        open(ws) {
          clients.add(ws);
        },
        close(ws) {
          clients.delete(ws);
        },
        async message(ws, message) {
          const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
          let request: WsRequest;
          try {
            request = JSON.parse(raw);
          } catch {
            ws.send(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          try {
            const result = await router.handle(request.type, request.payload);
            const response: WsResponse = {
              correlationId: request.correlationId,
              type: request.type,
              payload: result,
            };
            ws.send(JSON.stringify(response));
          } catch (err) {
            const response: WsResponse = {
              correlationId: request.correlationId,
              type: request.type,
              payload: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
            ws.send(JSON.stringify(response));
          }
        },
      },
    });

    return {
      port: server.port,
      stop() {
        server.stop();
      },
    };
  }

  return { start, broadcast };
}
```

- [ ] **Step 6: Update index.ts to use the server**

File: `packages/backend/src/index.ts`
```typescript
import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();

  const router = new Router();
  const server = createServer(router);
  const { port, stop } = await server.start();

  await writeFile(config.portFile, String(port));
  console.log(`Taskflow backend running on port ${port}`);

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

- [ ] **Step 7: Verify server starts**

Run: `cd packages/backend && timeout 3 bun run src/index.ts || true`
Expected: "Taskflow backend running on port XXXXX"

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/ws/ packages/backend/tests/ws/ packages/backend/src/index.ts
git commit -m "feat: add WebSocket server with message router"
```

### Task 2.2: Task store service

**Files:**
- Create: `packages/backend/src/services/task-store.ts`
- Create: `packages/backend/tests/services/task-store.test.ts`

- [ ] **Step 1: Write task store tests**

File: `packages/backend/tests/services/task-store.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TaskStore } from '../../src/services/task-store';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TaskStore', () => {
  let store: TaskStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-test-'));
    store = new TaskStore({
      projectsFile: join(tempDir, 'projects.json'),
      tasksDir: join(tempDir, 'tasks'),
      archiveDir: join(tempDir, 'archive'),
    });
    await store.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('projects', () => {
    it('starts with empty project list', async () => {
      const projects = await store.listProjects();
      expect(projects).toEqual([]);
    });

    it('adds and lists projects', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      expect(project.name).toBe('test');
      expect(project.path).toBe('/tmp/test');
      expect(project.id).toBeTruthy();

      const projects = await store.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('test');
    });

    it('removes projects', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      await store.removeProject(project.id);
      const projects = await store.listProjects();
      expect(projects).toEqual([]);
    });
  });

  describe('tasks', () => {
    it('creates and lists tasks', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      const task = await store.createTask({ projectId: project.id, title: 'My task' });
      expect(task.title).toBe('My task');
      expect(task.status).toBe('active');
      expect(task.worktree.enabled).toBe(false);

      const tasks = await store.listTasks();
      expect(tasks).toHaveLength(1);
    });

    it('lists tasks filtered by project', async () => {
      const p1 = await store.addProject({ name: 'p1', path: '/tmp/p1' });
      const p2 = await store.addProject({ name: 'p2', path: '/tmp/p2' });
      await store.createTask({ projectId: p1.id, title: 'Task 1' });
      await store.createTask({ projectId: p2.id, title: 'Task 2' });

      const p1Tasks = await store.listTasks(p1.id);
      expect(p1Tasks).toHaveLength(1);
      expect(p1Tasks[0].title).toBe('Task 1');
    });

    it('updates tasks', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      const task = await store.createTask({ projectId: project.id, title: 'Original' });
      const updated = await store.updateTask(task.id, { title: 'Updated', notes: 'some notes' });
      expect(updated.title).toBe('Updated');
      expect(updated.notes).toBe('some notes');
    });

    it('archives tasks', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      const task = await store.createTask({ projectId: project.id, title: 'Task' });
      await store.archiveTask(task.id);

      const active = await store.listTasks();
      expect(active).toHaveLength(0);

      const archived = await store.listArchived();
      expect(archived).toHaveLength(1);
      expect(archived[0].status).toBe('archived');
      expect(archived[0].archivedAt).toBeTruthy();
    });

    it('deletes tasks', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      const task = await store.createTask({ projectId: project.id, title: 'Task' });
      await store.deleteTask(task.id);

      const tasks = await store.listTasks();
      expect(tasks).toEqual([]);
    });

    it('cleans expired archives', async () => {
      const project = await store.addProject({ name: 'test', path: '/tmp/test' });
      const task = await store.createTask({ projectId: project.id, title: 'Old' });

      // Manually archive with old date
      const archived = await store.archiveTask(task.id);
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await store.updateArchived(archived.id, { archivedAt: oldDate });

      await store.cleanExpiredArchives();
      const remaining = await store.listArchived();
      expect(remaining).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement task store**

File: `packages/backend/src/services/task-store.ts`
```typescript
import type { Project, Task } from '@taskflow/shared';
import { ARCHIVE_EXPIRY_DAYS } from '@taskflow/shared';
import { readFile, writeFile, readdir, unlink, mkdir, realpath, stat } from 'fs/promises';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';

interface TaskStoreConfig {
  projectsFile: string;
  tasksDir: string;
  archiveDir: string;
}

export class TaskStore {
  private config: TaskStoreConfig;

  constructor(config: TaskStoreConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    await mkdir(this.config.tasksDir, { recursive: true });
    await mkdir(this.config.archiveDir, { recursive: true });
  }

  // --- Projects ---

  async listProjects(): Promise<Project[]> {
    try {
      const data = await readFile(this.config.projectsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async addProject(input: { name?: string; path: string }): Promise<Project> {
    const resolvedPath = await realpath(input.path).catch(() => input.path);
    const info = await stat(resolvedPath);
    if (!info.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`);
    }

    const projects = await this.listProjects();
    const project: Project = {
      id: randomUUID(),
      name: input.name?.trim() || basename(resolvedPath),
      path: resolvedPath,
      createdAt: new Date().toISOString(),
    };
    projects.push(project);
    await writeFile(this.config.projectsFile, JSON.stringify(projects, null, 2));
    return project;
  }

  async removeProject(id: string): Promise<void> {
    const projects = await this.listProjects();
    const filtered = projects.filter((p) => p.id !== id);
    await writeFile(this.config.projectsFile, JSON.stringify(filtered, null, 2));
  }

  // --- Tasks ---

  private taskPath(id: string): string {
    return join(this.config.tasksDir, `${id}.json`);
  }

  private archivePath(id: string): string {
    return join(this.config.archiveDir, `${id}.json`);
  }

  private async readTask(filePath: string): Promise<Task | null> {
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private async writeTask(filePath: string, task: Task): Promise<void> {
    await writeFile(filePath, JSON.stringify(task, null, 2));
  }

  async createTask(input: { projectId: string; title: string; description?: string }): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? '',
      notes: '',
      worktree: { enabled: false, path: null, branch: null },
      sessions: [],
      createdAt: new Date().toISOString(),
      status: 'active',
      archivedAt: null,
    };
    await this.writeTask(this.taskPath(task.id), task);
    return task;
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    const tasks: Task[] = [];
    try {
      const files = await readdir(this.config.tasksDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const task = await this.readTask(join(this.config.tasksDir, file));
        if (task && (!projectId || task.projectId === projectId)) {
          tasks.push(task);
        }
      }
    } catch {
      // Directory may not exist yet
    }
    return tasks;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.readTask(this.taskPath(id));
  }

  async updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'notes' | 'worktree' | 'sessions'>>): Promise<Task> {
    const task = await this.readTask(this.taskPath(id));
    if (!task) throw new Error(`Task not found: ${id}`);
    const updated = { ...task, ...updates };
    await this.writeTask(this.taskPath(id), updated);
    return updated;
  }

  async archiveTask(id: string): Promise<Task> {
    const task = await this.readTask(this.taskPath(id));
    if (!task) throw new Error(`Task not found: ${id}`);
    const archived: Task = {
      ...task,
      status: 'archived',
      archivedAt: new Date().toISOString(),
    };
    await this.writeTask(this.archivePath(id), archived);
    await unlink(this.taskPath(id));
    return archived;
  }

  async deleteTask(id: string): Promise<void> {
    try {
      await unlink(this.taskPath(id));
    } catch {
      // May already be deleted
    }
  }

  async listArchived(): Promise<Task[]> {
    const tasks: Task[] = [];
    try {
      const files = await readdir(this.config.archiveDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const task = await this.readTask(join(this.config.archiveDir, file));
        if (task) tasks.push(task);
      }
    } catch {
      // Directory may not exist
    }
    return tasks;
  }

  async updateArchived(id: string, updates: Partial<Task>): Promise<void> {
    const task = await this.readTask(this.archivePath(id));
    if (!task) throw new Error(`Archived task not found: ${id}`);
    await this.writeTask(this.archivePath(id), { ...task, ...updates });
  }

  async cleanExpiredArchives(): Promise<number> {
    const expiryMs = ARCHIVE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;
    const archived = await this.listArchived();
    for (const task of archived) {
      if (task.archivedAt) {
        const archivedTime = new Date(task.archivedAt).getTime();
        if (now - archivedTime > expiryMs) {
          await unlink(this.archivePath(task.id));
          cleaned++;
        }
      }
    }
    return cleaned;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
git commit -m "feat: add task store service with project and task CRUD"
```

### Task 2.3: Project and task handlers

**Files:**
- Create: `packages/backend/src/handlers/project.ts`
- Create: `packages/backend/src/handlers/task.ts`
- Create: `packages/backend/tests/handlers/project.test.ts`
- Create: `packages/backend/tests/handlers/task.test.ts`

- [ ] **Step 1: Write project handler tests**

File: `packages/backend/tests/handlers/project.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { registerProjectHandlers } from '../../src/handlers/project';
import { Router } from '../../src/ws/router';
import { TaskStore } from '../../src/services/task-store';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MSG } from '@taskflow/shared';

describe('project handlers', () => {
  let router: Router;
  let store: TaskStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-test-'));
    store = new TaskStore({
      projectsFile: join(tempDir, 'projects.json'),
      tasksDir: join(tempDir, 'tasks'),
      archiveDir: join(tempDir, 'archive'),
    });
    await store.init();
    router = new Router();
    registerProjectHandlers(router, store);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('lists projects (empty)', async () => {
    const result = await router.handle(MSG.PROJECT_LIST, {});
    expect(result).toEqual({ projects: [] });
  });

  it('adds and lists a project', async () => {
    await router.handle(MSG.PROJECT_ADD, { name: 'test', path: '/tmp/test' });
    const result = await router.handle(MSG.PROJECT_LIST, {}) as { projects: unknown[] };
    expect(result.projects).toHaveLength(1);
  });

  it('removes a project', async () => {
    const added = await router.handle(MSG.PROJECT_ADD, { name: 'test', path: '/tmp/test' }) as { id: string };
    await router.handle(MSG.PROJECT_REMOVE, { id: added.id });
    const result = await router.handle(MSG.PROJECT_LIST, {}) as { projects: unknown[] };
    expect(result.projects).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/project.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement project handlers**

File: `packages/backend/src/handlers/project.ts`
```typescript
import { MSG } from '@taskflow/shared';
import type { ProjectAddPayload, ProjectRemovePayload } from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { TaskStore } from '../services/task-store';

export function registerProjectHandlers(router: Router, store: TaskStore): void {
  router.register(MSG.PROJECT_LIST, async () => {
    const projects = await store.listProjects();
    return { projects };
  });

  router.register(MSG.PROJECT_ADD, async (payload) => {
    const { name, path } = payload as ProjectAddPayload;
    return store.addProject({ name, path });
  });

  router.register(MSG.PROJECT_REMOVE, async (payload) => {
    const { id } = payload as ProjectRemovePayload;
    await store.removeProject(id);
    return { success: true };
  });
}
```

- [ ] **Step 4: Run project handler tests**

Run: `cd packages/backend && bun test tests/handlers/project.test.ts`
Expected: All PASS

- [ ] **Step 5: Write task handler tests**

File: `packages/backend/tests/handlers/task.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { registerTaskHandlers } from '../../src/handlers/task';
import { registerProjectHandlers } from '../../src/handlers/project';
import { Router } from '../../src/ws/router';
import { TaskStore } from '../../src/services/task-store';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MSG } from '@taskflow/shared';

describe('task handlers', () => {
  let router: Router;
  let store: TaskStore;
  let tempDir: string;
  let projectId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-test-'));
    store = new TaskStore({
      projectsFile: join(tempDir, 'projects.json'),
      tasksDir: join(tempDir, 'tasks'),
      archiveDir: join(tempDir, 'archive'),
    });
    await store.init();
    router = new Router();
    registerProjectHandlers(router, store);
    registerTaskHandlers(router, store);
    const project = await store.addProject({ name: 'test', path: '/tmp/test' });
    projectId = project.id;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and lists tasks', async () => {
    await router.handle(MSG.TASK_CREATE, { projectId, title: 'Test task' });
    const result = await router.handle(MSG.TASK_LIST, {}) as { tasks: unknown[] };
    expect(result.tasks).toHaveLength(1);
  });

  it('filters tasks by project', async () => {
    await router.handle(MSG.TASK_CREATE, { projectId, title: 'Task 1' });
    const result = await router.handle(MSG.TASK_LIST, { projectId }) as { tasks: unknown[] };
    expect(result.tasks).toHaveLength(1);
  });

  it('updates a task', async () => {
    const task = await router.handle(MSG.TASK_CREATE, { projectId, title: 'Original' }) as { id: string };
    const updated = await router.handle(MSG.TASK_UPDATE, { id: task.id, title: 'Updated' }) as { title: string };
    expect(updated.title).toBe('Updated');
  });

  it('archives a task', async () => {
    const task = await router.handle(MSG.TASK_CREATE, { projectId, title: 'Task' }) as { id: string };
    await router.handle(MSG.TASK_ARCHIVE, { id: task.id });
    const result = await router.handle(MSG.TASK_LIST, {}) as { tasks: unknown[] };
    expect(result.tasks).toHaveLength(0);
  });

  it('deletes a task', async () => {
    const task = await router.handle(MSG.TASK_CREATE, { projectId, title: 'Task' }) as { id: string };
    await router.handle(MSG.TASK_DELETE, { id: task.id });
    const result = await router.handle(MSG.TASK_LIST, {}) as { tasks: unknown[] };
    expect(result.tasks).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run task handler tests to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/task.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement task handlers**

File: `packages/backend/src/handlers/task.ts`
```typescript
import { MSG } from '@taskflow/shared';
import type {
  TaskListPayload,
  TaskCreatePayload,
  TaskUpdatePayload,
  TaskArchivePayload,
  TaskDeletePayload,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { TaskStore } from '../services/task-store';

export function registerTaskHandlers(router: Router, store: TaskStore): void {
  router.register(MSG.TASK_LIST, async (payload) => {
    const { projectId } = (payload ?? {}) as TaskListPayload;
    const tasks = await store.listTasks(projectId);
    return { tasks };
  });

  router.register(MSG.TASK_CREATE, async (payload) => {
    const { projectId, title, description } = payload as TaskCreatePayload;
    return store.createTask({ projectId, title, description });
  });

  router.register(MSG.TASK_UPDATE, async (payload) => {
    const { id, ...updates } = payload as TaskUpdatePayload;
    return store.updateTask(id, updates);
  });

  router.register(MSG.TASK_ARCHIVE, async (payload) => {
    const { id } = payload as TaskArchivePayload;
    return store.archiveTask(id);
  });

  router.register(MSG.TASK_DELETE, async (payload) => {
    const { id } = payload as TaskDeletePayload;
    await store.deleteTask(id);
    return { success: true };
  });
}
```

- [ ] **Step 8: Run all task handler tests**

Run: `cd packages/backend && bun test tests/handlers/task.test.ts`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/handlers/ packages/backend/tests/handlers/
git commit -m "feat: add project and task handlers with tests"
```

### Task 2.4: Wire handlers into server

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Update index.ts to register all handlers**

File: `packages/backend/src/index.ts`
```typescript
import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { TaskStore } from './services/task-store';
import { registerProjectHandlers } from './handlers/project';
import { registerTaskHandlers } from './handlers/task';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();

  const store = new TaskStore({
    projectsFile: config.projectsFile,
    tasksDir: config.tasksDir,
    archiveDir: config.archiveDir,
  });
  await store.init();
  await store.cleanExpiredArchives();

  const router = new Router();
  registerProjectHandlers(router, store);
  registerTaskHandlers(router, store);

  const server = createServer(router);
  const { port, stop } = await server.start();

  await writeFile(config.portFile, String(port));
  console.log(`Taskflow backend running on port ${port}`);

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

- [ ] **Step 2: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: wire project and task handlers into server"
```

---

## Chunk 3: Backend Sessions, Files & Git

### Task 3.1: PTY manager service

**Files:**
- Create: `packages/backend/src/services/pty-manager.ts`
- Create: `packages/backend/tests/services/pty-manager.test.ts`

- [ ] **Step 1: Write PTY manager tests**

File: `packages/backend/tests/services/pty-manager.test.ts`
```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { PtyManager } from '../../src/services/pty-manager';

describe('PtyManager', () => {
  const manager = new PtyManager();

  afterEach(() => {
    manager.closeAll();
  });

  it('spawns a shell session and receives output', async () => {
    let output = '';
    const sessionId = manager.spawn({
      command: 'echo',
      args: ['hello-pty-test'],
      cwd: '/tmp',
      onData: (data) => { output += data; },
      onExit: () => {},
    });

    expect(sessionId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(output).toContain('hello-pty-test');
  });

  it('sends input to a session', async () => {
    let output = '';
    const sessionId = manager.spawn({
      command: '/bin/cat',
      args: [],
      cwd: '/tmp',
      onData: (data) => { output += data; },
      onExit: () => {},
    });

    manager.write(sessionId, 'test-input\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(output).toContain('test-input');
    manager.close(sessionId);
  });

  it('lists active sessions', () => {
    const id1 = manager.spawn({
      command: '/bin/cat', args: [], cwd: '/tmp',
      onData: () => {}, onExit: () => {},
    });
    const id2 = manager.spawn({
      command: '/bin/cat', args: [], cwd: '/tmp',
      onData: () => {}, onExit: () => {},
    });
    const sessions = manager.list();
    expect(sessions).toContain(id1);
    expect(sessions).toContain(id2);
  });

  it('closes a session', () => {
    const sessionId = manager.spawn({
      command: '/bin/cat', args: [], cwd: '/tmp',
      onData: () => {}, onExit: () => {},
    });
    manager.close(sessionId);
    expect(manager.list()).not.toContain(sessionId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/pty-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PTY manager**

File: `packages/backend/src/services/pty-manager.ts`
```typescript
import * as pty from 'node-pty';
import { randomUUID } from 'crypto';

interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export class PtyManager {
  private sessions = new Map<string, pty.IPty>();

  spawn(options: SpawnOptions): string {
    const id = randomUUID();
    const proc = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
    });

    proc.onData(options.onData);
    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      options.onExit(exitCode);
    });

    this.sessions.set(id, proc);
    return id;
  }

  write(id: string, data: string): void {
    const proc = this.sessions.get(id);
    if (!proc) throw new Error(`Session not found: ${id}`);
    proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.sessions.get(id);
    if (!proc) throw new Error(`Session not found: ${id}`);
    proc.resize(cols, rows);
  }

  close(id: string): void {
    const proc = this.sessions.get(id);
    if (proc) {
      proc.kill();
      this.sessions.delete(id);
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }

  list(): string[] {
    return Array.from(this.sessions.keys());
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/pty-manager.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/pty-manager.ts packages/backend/tests/services/pty-manager.test.ts
git commit -m "feat: add PTY manager service for terminal sessions"
```

### Task 3.2: Session handlers

**Files:**
- Create: `packages/backend/src/handlers/session.ts`

- [ ] **Step 1: Implement session handlers**

File: `packages/backend/src/handlers/session.ts`
```typescript
import { MSG } from '@taskflow/shared';
import type {
  SessionCreatePayload, SessionClosePayload,
  SessionInputPayload, TerminalResizePayload, WsEvent,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { PtyManager } from '../services/pty-manager';
import type { TaskStore } from '../services/task-store';

interface SessionHandlerDeps {
  router: Router;
  ptyManager: PtyManager;
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
  const { router, ptyManager, taskStore, broadcast } = deps;

  router.register(MSG.SESSION_CREATE, async (payload) => {
    const { taskId, type, label } = payload as SessionCreatePayload;
    const task = await taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = (await taskStore.listProjects()).find((p) => p.id === task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);
    const cwd = task.worktree.enabled && task.worktree.path
      ? task.worktree.path : project.path;

    const command = type === 'claude' ? 'claude' : 'codex';

    const sessionId = ptyManager.spawn({
      command, args: [], cwd,
      onData: (data) => {
        broadcast({
          type: MSG.TERMINAL_OUTPUT,
          payload: { sessionId, data },
        });
      },
      onExit: () => {
        taskStore.getTask(taskId).then((t) => {
          if (t) {
            const sessions = t.sessions.filter((s) => s.id !== sessionId);
            taskStore.updateTask(taskId, { sessions });
          }
        });
      },
    });

    const sessionRef = {
      id: sessionId, type,
      label: label ?? `${type} session`,
      createdAt: new Date().toISOString(),
    };
    await taskStore.updateTask(taskId, {
      sessions: [...task.sessions, sessionRef],
    });

    return { sessionId };
  });

  router.register(MSG.SESSION_INPUT, async (payload) => {
    const { sessionId, data } = payload as SessionInputPayload;
    ptyManager.write(sessionId, data);
    return { success: true };
  });

  router.register(MSG.SESSION_CLOSE, async (payload) => {
    const { sessionId } = payload as SessionClosePayload;
    ptyManager.close(sessionId);
    return { success: true };
  });

  router.register(MSG.TERMINAL_RESIZE, async (payload) => {
    const { sessionId, cols, rows } = payload as TerminalResizePayload;
    ptyManager.resize(sessionId, cols, rows);
    return { success: true };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/handlers/session.ts
git commit -m "feat: add session handlers for PTY terminal management"
```

### Task 3.3: Git service

**Files:**
- Create: `packages/backend/src/services/git-service.ts`
- Create: `packages/backend/tests/services/git-service.test.ts`

- [ ] **Step 1: Write git service tests**

File: `packages/backend/tests/services/git-service.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GitService } from '../../src/services/git-service';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

async function run(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}

describe('GitService', () => {
  let git: GitService;
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'taskflow-git-test-'));
    await run(['git', 'init'], repoDir);
    await run(['git', 'config', 'user.email', 'test@test.com'], repoDir);
    await run(['git', 'config', 'user.name', 'Test'], repoDir);
    await writeFile(join(repoDir, 'initial.txt'), 'initial content');
    await run(['git', 'add', '.'], repoDir);
    await run(['git', 'commit', '-m', 'initial'], repoDir);
    git = new GitService();
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('gets status of clean repo', async () => {
    const status = await git.status(repoDir);
    expect(status.branch).toBeTruthy();
    expect(status.files).toHaveLength(0);
  });

  it('detects modified files', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified');
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].status).toBe('modified');
  });

  it('detects new untracked files', async () => {
    await writeFile(join(repoDir, 'new.txt'), 'new file');
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].status).toBe('untracked');
  });

  it('gets diff', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified content');
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].diff).toContain('modified content');
  });

  it('reverts a file', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified');
    await git.revertFile(repoDir, 'initial.txt');
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('creates a worktree', async () => {
    const wtPath = join(repoDir, '.worktrees', 'test-branch');
    await git.createWorktree(repoDir, 'test-branch', wtPath);
    const status = await git.status(wtPath);
    expect(status.branch).toBe('test-branch');
    // Cleanup
    await run(['git', 'worktree', 'remove', wtPath], repoDir);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement git service**

Note: Uses `Bun.spawn` with explicit argument arrays to avoid shell injection.

File: `packages/backend/src/services/git-service.ts`
```typescript
import type { GitStatusResult, GitFileStatus, GitDiffResult, GitDiffFile } from '@taskflow/shared';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

export class GitService {
  async status(repoPath: string): Promise<GitStatusResult> {
    const branchOutput = await git(['branch', '--show-current'], repoPath);
    const statusOutput = await git(['status', '--porcelain'], repoPath);

    const files: GitFileStatus[] = [];
    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;
      const xy = line.substring(0, 2);
      const path = line.substring(3);
      files.push({
        path,
        absolutePath: join(repoPath, path),
        status: this.parseStatus(xy),
      });
    }

    return { branch: branchOutput || null, files };
  }

  private parseStatus(xy: string): GitFileStatus['status'] {
    if (xy === '??') return 'untracked';
    if (xy.includes('A')) return 'new';
    if (xy.includes('D')) return 'deleted';
    if (xy.includes('R')) return 'renamed';
    return 'modified';
  }

  async diff(repoPath: string): Promise<GitDiffResult> {
    const numstat = await git(['diff', '--numstat'], repoPath);
    const files: GitDiffFile[] = [];

    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue;
      const [add, del, path] = line.split('\t');
      const fileDiff = await this.diffFile(repoPath, path);
      files.push({
        path,
        additions: parseInt(add) || 0,
        deletions: parseInt(del) || 0,
        diff: fileDiff,
      });
    }

    return { files };
  }

  async diffFile(repoPath: string, filePath: string): Promise<string> {
    return git(['diff', '--', filePath], repoPath);
  }

  async revertFile(repoPath: string, filePath: string): Promise<void> {
    await git(['checkout', '--', filePath], repoPath);
  }

  async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
    await mkdir(dirname(worktreePath), { recursive: true });
    await git(['worktree', 'add', '-b', branch, worktreePath], repoPath);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git-service.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/git-service.ts packages/backend/tests/services/git-service.test.ts
git commit -m "feat: add git service with status, diff, revert, worktree"
```

### Task 3.4: File watcher service

**Files:**
- Create: `packages/backend/src/services/file-watcher.ts`
- Create: `packages/backend/tests/services/file-watcher.test.ts`

- [ ] **Step 1: Write file watcher tests**

File: `packages/backend/tests/services/file-watcher.test.ts`
```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { FileWatcher } from '../../src/services/file-watcher';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileWatcher', () => {
  let watcher: FileWatcher;
  let tempDir: string;

  afterEach(async () => {
    watcher?.stopAll();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('builds a file tree', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    await writeFile(join(tempDir, 'file1.ts'), 'content');
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'file2.ts'), 'content');

    watcher = new FileWatcher();
    const tree = await watcher.buildTree(tempDir);

    expect(tree.type).toBe('directory');
    expect(tree.children!.length).toBeGreaterThanOrEqual(2);

    const srcDir = tree.children!.find((c) => c.name === 'src');
    expect(srcDir).toBeTruthy();
    expect(srcDir!.children!).toHaveLength(1);
  });

  it('excludes node_modules and .git', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    await mkdir(join(tempDir, 'node_modules'));
    await writeFile(join(tempDir, 'node_modules', 'pkg.js'), 'x');
    await mkdir(join(tempDir, '.git'));
    await writeFile(join(tempDir, '.git', 'config'), 'x');
    await writeFile(join(tempDir, 'real.ts'), 'x');

    watcher = new FileWatcher();
    const tree = await watcher.buildTree(tempDir);

    const names = tree.children!.map((c) => c.name);
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
    expect(names).toContain('real.ts');
  });

  it('watches for file changes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    watcher = new FileWatcher();

    const changes: string[] = [];
    watcher.watch(tempDir, (event) => { changes.push(event.path); });

    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(join(tempDir, 'new-file.ts'), 'hello');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(changes.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/file-watcher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement file watcher**

File: `packages/backend/src/services/file-watcher.ts`
```typescript
import type { FileNode, FileChangeEvent } from '@taskflow/shared';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

const IGNORED = new Set([
  'node_modules', '.git', '.worktrees', 'dist', '.next', '.superpowers',
]);

export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();

  async buildTree(dirPath: string, depth = 0): Promise<FileNode> {
    const name = basename(dirPath);
    const node: FileNode = { name, path: dirPath, type: 'directory', children: [] };
    if (depth > 10) return node;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          node.children!.push(await this.buildTree(fullPath, depth + 1));
        } else {
          node.children!.push({ name: entry.name, path: fullPath, type: 'file' });
        }
      }
      node.children!.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch { /* permission denied */ }

    return node;
  }

  watch(dirPath: string, onChange: (event: FileChangeEvent) => void): void {
    this.stop(dirPath);
    const watcher = watch(dirPath, {
      ignored: [...IGNORED].map((i) => `**/${i}/**`),
      ignoreInitial: true,
      persistent: true,
    });
    watcher.on('add', (path) => onChange({ type: 'create', path }));
    watcher.on('change', (path) => onChange({ type: 'modify', path }));
    watcher.on('unlink', (path) => onChange({ type: 'delete', path }));
    this.watchers.set(dirPath, watcher);
  }

  stop(dirPath: string): void {
    const w = this.watchers.get(dirPath);
    if (w) { w.close(); this.watchers.delete(dirPath); }
  }

  stopAll(): void {
    for (const [path] of this.watchers) this.stop(path);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/file-watcher.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/file-watcher.ts packages/backend/tests/services/file-watcher.test.ts
git commit -m "feat: add file watcher service with tree building"
```

### Task 3.5: File, git handlers and editor detector

**Files:**
- Create: `packages/backend/src/handlers/file.ts`
- Create: `packages/backend/src/handlers/git.ts`
- Create: `packages/backend/src/services/editor-detector.ts`

- [ ] **Step 1: Implement file handlers**

File: `packages/backend/src/handlers/file.ts`
```typescript
import { MSG } from '@taskflow/shared';
import type {
  FileTreePayload,
  FileReadPayload,
  FileWatchPayload,
  FileWritePayload,
  WsEvent,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { FileWatcher } from '../services/file-watcher';
import { readFile, writeFile } from 'fs/promises';

interface FileHandlerDeps {
  router: Router;
  fileWatcher: FileWatcher;
  broadcast: (event: WsEvent) => void;
}

export function registerFileHandlers(deps: FileHandlerDeps): void {
  const { router, fileWatcher, broadcast } = deps;

  router.register(MSG.FILE_TREE, async (payload) => {
    const { path } = payload as FileTreePayload;
    const tree = await fileWatcher.buildTree(path);
    return { tree };
  });

  router.register(MSG.FILE_READ, async (payload) => {
    const { path } = payload as FileReadPayload;
    const content = await readFile(path, 'utf-8');
    return { content };
  });

  router.register(MSG.FILE_WRITE, async (payload) => {
    const { path, content } = payload as FileWritePayload;
    await writeFile(path, content, 'utf-8');
    return { success: true };
  });

  router.register(MSG.FILE_WATCH, async (payload) => {
    const { path } = payload as FileWatchPayload;
    fileWatcher.watch(path, (event) => {
      broadcast({ type: MSG.FILE_CHANGED, payload: event });
    });
    return { success: true };
  });
}
```

- [ ] **Step 2: Implement git handlers**

File: `packages/backend/src/handlers/git.ts`
```typescript
import { MSG } from '@taskflow/shared';
import type {
  GitStatusPayload, GitDiffPayload, GitDiffFilePayload,
  GitRevertFilePayload, GitWorktreeCreatePayload,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { GitService } from '../services/git-service';

export function registerGitHandlers(router: Router, git: GitService): void {
  router.register(MSG.GIT_STATUS, async (payload) => {
    const { path } = payload as GitStatusPayload;
    return { status: await git.status(path) };
  });

  router.register(MSG.GIT_DIFF, async (payload) => {
    const { path } = payload as GitDiffPayload;
    return { diff: await git.diff(path) };
  });

  router.register(MSG.GIT_DIFF_FILE, async (payload) => {
    const { repoPath, filePath } = payload as GitDiffFilePayload;
    return { diff: await git.diffFile(repoPath, filePath) };
  });

  router.register(MSG.GIT_REVERT_FILE, async (payload) => {
    const { repoPath, filePath } = payload as GitRevertFilePayload;
    await git.revertFile(repoPath, filePath);
    return { success: true };
  });

  router.register(MSG.GIT_WORKTREE_CREATE, async (payload) => {
    const { repoPath, branch, path } = payload as GitWorktreeCreatePayload;
    await git.createWorktree(repoPath, branch, path);
    return { success: true };
  });
}
```

- [ ] **Step 3: Implement editor detector**

File: `packages/backend/src/services/editor-detector.ts`
```typescript
import type { EditorInfo } from '@taskflow/shared';

const KNOWN_EDITORS = [
  { id: 'vscode', name: 'VS Code', command: 'code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor' },
  { id: 'zed', name: 'Zed', command: 'zed' },
  { id: 'sublime', name: 'Sublime Text', command: 'subl' },
  { id: 'nvim', name: 'Neovim', command: 'nvim' },
];

export async function detectEditors(): Promise<EditorInfo[]> {
  const available: EditorInfo[] = [];
  for (const editor of KNOWN_EDITORS) {
    try {
      const proc = Bun.spawn(['which', editor.command], {
        stdout: 'pipe', stderr: 'pipe',
      });
      await proc.exited;
      if (proc.exitCode === 0) available.push(editor);
    } catch { /* not found */ }
  }
  return available;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/file.ts packages/backend/src/handlers/git.ts packages/backend/src/services/editor-detector.ts
git commit -m "feat: add file, git handlers and editor detector"
```

### Task 3.6: Wire all services into index.ts

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Update index.ts with all services**

File: `packages/backend/src/index.ts`
```typescript
import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { TaskStore } from './services/task-store';
import { PtyManager } from './services/pty-manager';
import { GitService } from './services/git-service';
import { FileWatcher } from './services/file-watcher';
import { detectEditors } from './services/editor-detector';
import { registerProjectHandlers } from './handlers/project';
import { registerTaskHandlers } from './handlers/task';
import { registerSessionHandlers } from './handlers/session';
import { registerFileHandlers } from './handlers/file';
import { registerGitHandlers } from './handlers/git';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();

  const store = new TaskStore({
    projectsFile: config.projectsFile,
    tasksDir: config.tasksDir,
    archiveDir: config.archiveDir,
  });
  await store.init();
  await store.cleanExpiredArchives();

  const ptyManager = new PtyManager();
  const gitService = new GitService();
  const fileWatcher = new FileWatcher();

  const router = new Router();
  const server = createServer(router);

  registerProjectHandlers(router, store);
  registerTaskHandlers(router, store);
  registerSessionHandlers({
    router, ptyManager, taskStore: store,
    broadcast: server.broadcast,
  });
  registerFileHandlers({
    router, fileWatcher, broadcast: server.broadcast,
  });
  registerGitHandlers(router, gitService);

  const { port, stop } = await server.start();
  await writeFile(config.portFile, String(port));

  const editors = await detectEditors();
  console.log(`Taskflow backend running on port ${port}`);
  console.log(`Detected editors: ${editors.map((e) => e.name).join(', ') || 'none'}`);

  const shutdown = () => {
    ptyManager.closeAll();
    fileWatcher.stopAll();
    stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(console.error);
```

- [ ] **Step 2: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: wire all backend services and handlers together"
```

---

## Chunk 4: Electron Shell

### Task 4.1: Electron main process

**Files:**
- Modify: `electron/src/main.ts`
- Modify: `electron/src/preload.ts`

- [ ] **Step 1: Implement main process**

File: `electron/src/main.ts`
```typescript
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;

const PORT_FILE = '/tmp/.taskflow-port';
const UI_DEV_SERVER_URL = process.env.TASKFLOW_UI_URL;
const BACKEND_ENTRY = UI_DEV_SERVER_URL
  ? join(__dirname, '..', '..', 'packages', 'backend', 'src', 'index.ts')
  : join(__dirname, '..', '..', 'packages', 'backend', 'dist', 'index.js');

async function startBackend(): Promise<number> {
  return new Promise((resolve, reject) => {
    backendProcess = spawn('bun', ['run', BACKEND_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    backendProcess.stdout?.on('data', async (data) => {
      const output = data.toString();
      console.log('[backend]', output.trim());

      if (output.includes('running on port')) {
        try {
          const portStr = await readFile(PORT_FILE, 'utf-8');
          const port = parseInt(portStr.trim());
          resolve(port);
        } catch {
          reject(new Error('Could not read backend port file'));
        }
      }
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error('[backend error]', data.toString().trim());
    });

    backendProcess.on('error', reject);

    // Timeout after 10 seconds
    setTimeout(() => reject(new Error('Backend startup timeout')), 10000);
  });
}

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // For BrowserPane
    },
  });

  // In dev, load from Vite dev server; otherwise load the workspace build output.
  if (UI_DEV_SERVER_URL) {
    mainWindow.loadURL(UI_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '..', '..', 'packages', 'ui', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    backendPort = await startBackend();
    console.log(`Backend started on port ${backendPort}`);
    createWindow(backendPort);
  } catch (err) {
    console.error('Failed to start backend:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

// Expose backend port to renderer via IPC
ipcMain.handle('get-backend-port', () => backendPort);
ipcMain.handle('select-project-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});
```

- [ ] **Step 2: Implement preload script**

File: `electron/src/preload.ts`
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('taskflow', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  selectProjectDirectory: () => ipcRenderer.invoke('select-project-directory'),
});
```

- [ ] **Step 3: Add type declaration for the preload API**

File: `packages/ui/src/env.d.ts`
```typescript
interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

interface Window {
  taskflow?: TaskflowBridge;
}
```

- [ ] **Step 4: Build and verify Electron starts**

Run: `cd electron && bun run build`
Expected: dist/main.js and dist/preload.js created

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`
Expected: `packages/backend/dist/index.js` and `packages/ui/dist/index.html` exist for workspace-run Electron builds

- [ ] **Step 5: Commit**

```bash
git add electron/src/ packages/ui/src/env.d.ts
git commit -m "feat: implement Electron main process with backend lifecycle"
```

---

## Chunk 5: UI Core — Layout, WebSocket, Stores, Sidebar

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

---

## Chunk 6: UI Panes — Terminal, Editor, Files, Changes, Browser, TaskInfo

### Task 6.1: TerminalPane with xterm.js

**Files:**
- Create: `packages/ui/src/components/panes/TerminalPane.tsx`

- [ ] **Step 1: Implement TerminalPane**

File: `packages/ui/src/components/panes/TerminalPane.tsx`
```tsx
import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useSessionStore } from '../../stores/session-store';
import { onEvent } from '../../hooks/useWebSocket';
import { MSG } from '@taskflow/shared';
import type { TerminalOutputEvent } from '@taskflow/shared';
import 'xterm/css/xterm.css';

interface TerminalPaneProps {
  sessionId: string;
}

export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { sendInput, resizeTerminal } = useSessionStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Send keystrokes to PTY
    term.onData((data) => {
      sendInput(sessionId, data);
    });

    // Resize PTY when terminal resizes
    term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows);
    });

    // Listen for PTY output
    const unsubscribe = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
      const event = payload as TerminalOutputEvent;
      if (event.sessionId === sessionId) {
        term.write(event.data);
      }
    });

    // Resize on window resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden' }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: add TerminalPane with xterm.js and PTY integration"
```

### Task 6.2: EditorPane with Monaco

**Files:**
- Create: `packages/ui/src/components/panes/EditorPane.tsx`

- [ ] **Step 1: Implement EditorPane**

File: `packages/ui/src/components/panes/EditorPane.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { useFileStore } from '../../stores/file-store';

interface EditorPaneProps {
  filePath: string;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', sh: 'shell', bash: 'shell',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

export function EditorPane({ filePath }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { readFile, writeFile } = useFileStore();
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      theme: 'vs-dark',
      language: getLanguage(filePath),
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
    });

    editorRef.current = editor;

    // Load file content
    readFile(filePath).then((content) => {
      editor.setValue(content);
      setDirty(false);
      setLoading(false);
    });

    const changeDisposable = editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      await writeFile(filePath, editor.getValue());
      setDirty(false);
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
    };
  }, [filePath]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      {dirty && (
        <button
          onClick={async () => {
            if (!editorRef.current) return;
            await writeFile(filePath, editorRef.current.getValue());
            setDirty(false);
          }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 8px',
            color: 'var(--accent-blue)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Save
        </button>
      )}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', zIndex: 1,
        }}>
          Loading...
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/EditorPane.tsx
git commit -m "feat: add EditorPane with Monaco editor"
```

### Task 6.3: ChangesPane

**Files:**
- Create: `packages/ui/src/components/panes/ChangesPane.tsx`

- [ ] **Step 1: Implement ChangesPane**

File: `packages/ui/src/components/panes/ChangesPane.tsx`
```tsx
import { useEffect, useState } from 'react';
import type { GitStatusResult, GitFileStatus } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../../hooks/useWebSocket';

interface ChangesPaneProps {
  repoPath: string;
}

export function ChangesPane({ repoPath }: ChangesPaneProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');

  useEffect(() => {
    fetchStatus();
  }, [repoPath]);

  async function fetchStatus() {
    const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path: repoPath });
    setStatus(status);
  }

  async function showDiff(filePath: string) {
    setSelectedFile(filePath);
    const { diff } = await sendRequest<{ diff: string }>(MSG.GIT_DIFF_FILE, { repoPath, filePath });
    setDiff(diff);
  }

  async function revertFile(filePath: string) {
    await sendRequest(MSG.GIT_REVERT_FILE, { repoPath, filePath });
    await fetchStatus();
    if (selectedFile === filePath) {
      setSelectedFile(null);
      setDiff('');
    }
  }

  const statusColor = (s: GitFileStatus['status']) => {
    if (s === 'new' || s === 'untracked') return 'var(--accent-green)';
    if (s === 'modified') return 'var(--accent-yellow)';
    if (s === 'deleted') return 'var(--accent-red)';
    return 'var(--text-secondary)';
  };

  const statusPrefix = (s: GitFileStatus['status']) => {
    if (s === 'new' || s === 'untracked') return '+';
    if (s === 'modified') return 'M';
    if (s === 'deleted') return 'D';
    if (s === 'renamed') return 'R';
    return '?';
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* File list */}
      <div style={{
        padding: 8, borderBottom: '1px solid var(--border)',
        maxHeight: '40%', overflow: 'auto',
      }}>
        {status?.branch && (
          <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 6 }}>
            Branch: {status.branch}
          </div>
        )}
        {status?.files.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No changes</div>
        )}
        {status?.files.map((file) => (
          <div
            key={file.path}
            onClick={() => showDiff(file.path)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '3px 4px', cursor: 'pointer', fontSize: 11,
              background: selectedFile === file.path ? 'var(--bg-overlay)' : 'transparent',
              borderRadius: 3,
            }}
          >
            <span>
              <span style={{ color: statusColor(file.status), marginRight: 6 }}>
                {statusPrefix(file.status)}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{file.path}</span>
            </span>
            <span
              onClick={(e) => { e.stopPropagation(); revertFile(file.path); }}
              title="Revert"
              style={{ color: 'var(--accent-red)', cursor: 'pointer', fontSize: 10 }}
            >
              ↩
            </span>
          </div>
        ))}
      </div>

      {/* Diff view */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {diff ? (
          <pre style={{
            fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
            fontSize: 11, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap',
          }}>
            {diff.split('\n').map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('+') ? 'var(--accent-green)'
                  : line.startsWith('-') ? 'var(--accent-red)'
                  : line.startsWith('@@') ? 'var(--accent-blue)'
                  : 'var(--text-secondary)',
              }}>
                {line}
              </div>
            ))}
          </pre>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {selectedFile ? 'Loading diff...' : 'Click a file to see its diff'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/ChangesPane.tsx
git commit -m "feat: add ChangesPane with diff viewer and per-file revert"
```

### Task 6.4: BrowserPane

**Files:**
- Create: `packages/ui/src/components/panes/BrowserPane.tsx`

- [ ] **Step 1: Implement BrowserPane**

File: `packages/ui/src/components/panes/BrowserPane.tsx`
```tsx
import { useState } from 'react';

interface BrowserPaneProps {
  initialUrl: string;
}

export function BrowserPane({ initialUrl }: BrowserPaneProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* URL bar */}
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: 4,
      }}>
        <button
          onClick={() => {
            const wv = document.querySelector(`webview[data-url="${url}"]`) as any;
            wv?.goBack();
          }}
          style={{
            background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '2px 8px', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          ←
        </button>
        <button
          onClick={() => {
            const wv = document.querySelector(`webview[data-url="${url}"]`) as any;
            wv?.reload();
          }}
          style={{
            background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '2px 8px', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          ↻
        </button>
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setUrl(inputUrl); }}
          style={{
            flex: 1, background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '3px 6px', color: 'var(--text-primary)',
            fontSize: 11, outline: 'none',
          }}
        />
      </div>

      {/* Webview */}
      <webview
        src={url}
        data-url={url}
        style={{ flex: 1 }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/BrowserPane.tsx
git commit -m "feat: add BrowserPane with URL bar and webview"
```

### Task 6.5: FileExplorer and FileTree

**Files:**
- Create: `packages/ui/src/components/panels/FileExplorer.tsx`
- Create: `packages/ui/src/components/panels/FileTree.tsx`

- [ ] **Step 1: Create FileTree**

File: `packages/ui/src/components/panels/FileTree.tsx`
```tsx
import { useState } from 'react';
import type { FileNode } from '@taskflow/shared';

interface FileTreeProps {
  node: FileNode;
  depth?: number;
  gitFiles?: Map<string, string>; // path -> status
  onFileClick: (path: string) => void;
}

export function FileTree({ node, depth = 0, gitFiles, onFileClick }: FileTreeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const gitStatus = gitFiles?.get(node.path);
  const statusColor = gitStatus === 'new' || gitStatus === 'untracked'
    ? 'var(--accent-green)'
    : gitStatus === 'modified' ? 'var(--accent-yellow)'
    : gitStatus === 'deleted' ? 'var(--accent-red)'
    : 'var(--text-secondary)';

  if (node.type === 'file') {
    return (
      <div
        onClick={() => onFileClick(node.path)}
        style={{
          padding: '2px 8px',
          paddingLeft: depth * 12 + 8,
          cursor: 'pointer',
          fontSize: 11,
          color: statusColor,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '2px 8px',
          paddingLeft: depth * 12 + 8,
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--text-muted)',
          userSelect: 'none',
        }}
      >
        {expanded ? '▾' : '▸'} {node.name}
      </div>
      {expanded && node.children?.map((child) => (
        <FileTree
          key={child.path}
          node={child}
          depth={depth + 1}
          gitFiles={gitFiles}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create FileExplorer**

File: `packages/ui/src/components/panels/FileExplorer.tsx`
```tsx
import { useEffect, useMemo } from 'react';
import { useFileStore } from '../../stores/file-store';
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';
import { useSessionStore } from '../../stores/session-store';
import { useUIStore } from '../../stores/ui-store';
import { FileTree } from './FileTree';

export function FileExplorer() {
  const { tree, gitStatus, fetchTree, fetchGitStatus, watchPath } = useFileStore();
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { addTab } = useSessionStore();

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path
    : project?.path;

  useEffect(() => {
    if (workingDir) {
      fetchTree(workingDir);
      fetchGitStatus(workingDir);
      watchPath(workingDir);
    }
  }, [workingDir]);

  const gitFiles = useMemo(() => {
    const map = new Map<string, string>();
    gitStatus?.files.forEach((f) => {
      const absolutePath = f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
      map.set(absolutePath, f.status);
    });
    return map;
  }, [gitStatus, workingDir]);

  const handleFileClick = (path: string) => {
    if (!task) return;
    addTab(task.id, {
      id: `editor-${path}`,
      type: 'editor',
      label: path.split('/').pop() ?? path,
      filePath: path,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '5px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Files
        </span>
        <span
          onClick={() => useUIStore.getState().toggleFileExplorer()}
          style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}
        >
          ✕
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {tree ? (
          <FileTree
            node={tree}
            gitFiles={gitFiles}
            onFileClick={handleFileClick}
          />
        ) : (
          <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>
            {workingDir ? 'Loading...' : 'Select a task'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/FileExplorer.tsx packages/ui/src/components/panels/FileTree.tsx
git commit -m "feat: add FileExplorer and FileTree with git status"
```

### Task 6.6: TaskInfoPanel

**Files:**
- Create: `packages/ui/src/components/panels/TaskInfoPanel.tsx`

- [ ] **Step 1: Implement TaskInfoPanel**

File: `packages/ui/src/components/panels/TaskInfoPanel.tsx`
```tsx
import { useTaskStore } from '../../stores/task-store';
import { useUIStore } from '../../stores/ui-store';

export function TaskInfoPanel() {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const { updateTask } = useTaskStore();

  if (!task) {
    return (
      <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        Select a task
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '5px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Task Info
        </span>
        <span
          onClick={() => useUIStore.getState().toggleTaskInfo()}
          style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}
        >
          ✕
        </span>
      </div>

      <div style={{ flex: 1, padding: 8, overflow: 'auto', fontSize: 11 }}>
        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Description
        </label>
        <textarea
          value={task.description}
          onChange={(e) => updateTask(task.id, { description: e.target.value })}
          rows={4}
          style={{
            width: '100%', marginTop: 4, marginBottom: 12,
            background: 'var(--bg-overlay)', border: 'none', borderRadius: 3,
            padding: 6, color: 'var(--text-secondary)', fontSize: 11,
            resize: 'vertical', outline: 'none',
          }}
        />

        {task.worktree.branch && (
          <>
            <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
              Branch
            </label>
            <div style={{ color: 'var(--accent-blue)', marginTop: 4, marginBottom: 12 }}>
              {task.worktree.branch}
            </div>
          </>
        )}

        {task.worktree.path && (
          <>
            <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
              Worktree
            </label>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 12 }}>
              {task.worktree.path}
            </div>
          </>
        )}

        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Created
        </label>
        <div style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 12 }}>
          {new Date(task.createdAt).toLocaleString()}
        </div>

        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Notes
        </label>
        <textarea
          value={task.notes}
          onChange={(e) => updateTask(task.id, { notes: e.target.value })}
          rows={6}
          placeholder="Add notes..."
          style={{
            width: '100%', marginTop: 4,
            background: 'var(--bg-overlay)', border: 'none', borderRadius: 3,
            padding: 6, color: 'var(--text-secondary)', fontSize: 11,
            resize: 'vertical', outline: 'none',
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panels/TaskInfoPanel.tsx
git commit -m "feat: add TaskInfoPanel with editable description and notes"
```

### Task 6.7: Wire all panes into TabContent and App

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Update TabContent to render real panes**

File: `packages/ui/src/components/workspace/TabContent.tsx`
```tsx
import type { Tab } from '../../stores/session-store';
import { TerminalPane } from '../panes/TerminalPane';
import { EditorPane } from '../panes/EditorPane';
import { ChangesPane } from '../panes/ChangesPane';
import { BrowserPane } from '../panes/BrowserPane';
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';

interface TabContentProps {
  tab: Tab | undefined;
}

export function TabContent({ tab }: TabContentProps) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  if (!tab) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        No active tab. Create a session with +
      </div>
    );
  }

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path : project?.path ?? '';

  switch (tab.type) {
    case 'claude':
    case 'codex':
      return tab.sessionId
        ? <TerminalPane sessionId={tab.sessionId} />
        : <div style={{ padding: 12, color: 'var(--text-muted)' }}>Session not found</div>;

    case 'editor':
      return tab.filePath
        ? <EditorPane filePath={tab.filePath} />
        : <div style={{ padding: 12, color: 'var(--text-muted)' }}>No file specified</div>;

    case 'changes':
      return <ChangesPane repoPath={workingDir} />;

    case 'browser':
      return <BrowserPane initialUrl={tab.url ?? 'http://localhost:3000'} />;

    default:
      return <div style={{ padding: 12, color: 'var(--text-muted)' }}>Unknown tab type</div>;
  }
}
```

- [ ] **Step 2: Update App.tsx with real components**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from './providers/WebSocketProvider';
import { AppShell } from './components/AppShell';
import { TaskSidebar } from './components/sidebar/TaskSidebar';
import { FileExplorer } from './components/panels/FileExplorer';
import { TaskInfoPanel } from './components/panels/TaskInfoPanel';
import { Workspace } from './components/workspace/Workspace';

export function App() {
  return (
    <WebSocketProvider>
      <AppShell
        sidebar={<TaskSidebar />}
        fileExplorer={<FileExplorer />}
        workspace={<Workspace />}
        taskInfo={<TaskInfoPanel />}
      />
    </WebSocketProvider>
  );
}
```

- [ ] **Step 3: Run typecheck on UI**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors (or only expected warnings for xterm/monaco type quirks)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/App.tsx
git commit -m "feat: wire all panes into TabContent and complete App assembly"
```

### Task 6.8: Final integration verify

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run UI typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No blocking errors

- [ ] **Step 3: Start backend and verify**

Run: `cd packages/backend && timeout 3 bun run src/index.ts || true`
Expected: Backend starts, detects editors

- [ ] **Step 4: Verify editor save + live refresh behavior**

Manual verify:
- Open an editor tab, modify a file, press `Cmd/Ctrl+S`, and confirm the content persists on disk.
- Modify a watched file externally and confirm the file tree and git status refresh.
- Close a Claude/Codex tab and confirm the PTY session exits.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete v1 Taskflow implementation"
```

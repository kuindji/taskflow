# Chunk 1: Scaffolding + Shared Types

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Next: [Chunk 2 — Backend Core](taskflow-plan-chunk-2.md)

---

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

@theme {
  --color-base: #1e1e2e;
  --color-surface: #181825;
  --color-overlay: #313244;
  --color-primary: #cdd6f4;
  --color-secondary: #a6adc8;
  --color-muted: #585b70;
  --color-border: #313244;
  --color-accent-blue: #89b4fa;
  --color-accent-green: #a6e3a1;
  --color-accent-yellow: #f9e2af;
  --color-accent-red: #f38ba8;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  @apply bg-base text-primary overflow-hidden;
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

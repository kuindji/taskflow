# Chunk 3: Backend Sessions, Files & Git

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 2 — Backend Core](taskflow-plan-chunk-2.md) | Next: [Chunk 4 — Electron Shell](taskflow-plan-chunk-4.md)

---

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

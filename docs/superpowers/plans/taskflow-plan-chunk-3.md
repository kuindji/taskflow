# Chunk 3: Backend Sessions, Files & Git

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 2 — Backend Core](taskflow-plan-chunk-2.md) | Next: [Chunk 4 — Electron Shell](taskflow-plan-chunk-4.md)

---

### Task 3.1: PTY manager service

**Files:**
- Create: `packages/backend/src/services/pty-manager.ts`
- Create: `packages/backend/tests/services/pty-manager.test.ts`

- [ ] **Step 0: Verify node-pty works with Bun**

Run: `cd packages/backend && bun -e "const pty = require('node-pty'); const p = pty.spawn('echo', ['ok'], { cwd: '/tmp' }); p.onData(d => { console.log('OK:', d.trim()); }); setTimeout(() => process.exit(0), 1000);"`
Expected: `OK: ok`
If this fails, node-pty's native addon is incompatible with Bun. Fallback: use `Bun.spawn` with raw stdin/stdout pipes instead of PTY (loses terminal features like colors and resize, but functional).

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
    await new Promise((resolve) => setTimeout(resolve, 2000));
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

  async function removeSessionFromTask(sessionId: string, taskId?: string): Promise<void> {
    const tasks = taskId
      ? [await taskStore.getTask(taskId)].filter(Boolean)
      : await taskStore.listTasks();

    const owner = tasks.find((task) => task?.sessions.some((session) => session.id === sessionId));
    if (!owner) return;

    await taskStore.updateTask(owner.id, {
      sessions: owner.sessions.filter((session) => session.id !== sessionId),
    });
  }

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
        void removeSessionFromTask(sessionId, taskId);
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
    await removeSessionFromTask(sessionId);
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

  it('throws when the path is not a git repository', async () => {
    const nonRepoDir = await mkdtemp(join(tmpdir(), 'taskflow-git-nonrepo-'));
    await expect(git.status(nonRepoDir)).rejects.toThrow();
    await rm(nonRepoDir, { recursive: true, force: true });
  });

  it('reverts a modified file', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified');
    await git.revertFile(repoDir, { path: 'initial.txt', status: 'modified' });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('parses renamed files with spaces using porcelain -z metadata', async () => {
    await run(['git', 'mv', 'initial.txt', 'renamed file.txt'], repoDir);
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0]).toMatchObject({
      status: 'renamed',
      path: 'renamed file.txt',
      previousPath: 'initial.txt',
    });
  });

  it('reverts an untracked file by removing it', async () => {
    await writeFile(join(repoDir, 'scratch.txt'), 'temporary');
    await git.revertFile(repoDir, { path: 'scratch.txt', status: 'untracked' });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('reverts a renamed file', async () => {
    await run(['git', 'mv', 'initial.txt', 'renamed file.txt'], repoDir);
    await git.revertFile(repoDir, {
      path: 'renamed file.txt',
      previousPath: 'initial.txt',
      status: 'renamed',
    });
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
import { mkdir, rm } from 'fs/promises';
import { dirname, join } from 'path';

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim()
        || stdout.trim()
        || `git ${args.join(' ')} failed with exit code ${exitCode}`,
    );
  }
  return stdout.trim();
}

export class GitService {
  async status(repoPath: string): Promise<GitStatusResult> {
    const branchOutput = await git(['branch', '--show-current'], repoPath);
    // Use the NUL-delimited porcelain format so paths are machine-safe even when
    // rename targets contain spaces or other escaped characters.
    const statusOutput = await git(['status', '--porcelain=v1', '-z'], repoPath);

    const files: GitFileStatus[] = [];
    const entries = statusOutput.split('\0').filter((entry) => entry.length > 0);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const xy = entry.substring(0, 2);
      const path = entry.substring(3);
      let previousPath: string | undefined;

      if (xy.includes('R')) {
        previousPath = entries[index + 1];
        if (!previousPath) {
          throw new Error('Malformed git status output: rename entry missing previous path');
        }
        index += 1;
      }

      files.push({
        path,
        absolutePath: join(repoPath, path),
        previousPath,
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

  async revertFile(
    repoPath: string,
    file: Pick<GitFileStatus, 'path' | 'status' | 'previousPath'>,
  ): Promise<void> {
    if (file.status === 'untracked' || file.status === 'new') {
      await rm(join(repoPath, file.path), { recursive: true, force: true });
      return;
    }

    const paths = file.status === 'renamed' && file.previousPath
      ? [file.previousPath, file.path]
      : [file.path];

    await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths], repoPath);
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
    await writeFile(join(tempDir, '.gitignore'), 'dist\n');
    await writeFile(join(tempDir, 'real.ts'), 'x');

    watcher = new FileWatcher();
    const tree = await watcher.buildTree(tempDir);

    const names = tree.children!.map((c) => c.name);
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
    expect(names).toContain('.gitignore');
    expect(names).toContain('real.ts');
  });

  it('watches for file changes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    watcher = new FileWatcher();

    const changes: string[] = [];
    watcher.watch(tempDir, (event) => { changes.push(event.path); });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await writeFile(join(tempDir, 'new-file.ts'), 'hello');
    await new Promise((resolve) => setTimeout(resolve, 1500));

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

### Task 3.5: Path validation utilities

**Files:**
- Create: `packages/backend/src/utils/path-validation.ts`

- [ ] **Step 1: Create shared path validation module**

File: `packages/backend/src/utils/path-validation.ts`
```typescript
import type { TaskStore } from '../services/task-store';
import { realpath } from 'fs/promises';
import { basename, dirname, resolve, sep } from 'path';

export function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`);
}

export async function listWorkspaceRoots(taskStore: TaskStore): Promise<string[]> {
  const [projects, tasks] = await Promise.all([
    taskStore.listProjects(),
    taskStore.listTasks(),
  ]);
  const roots = new Set<string>();

  for (const project of projects) {
    roots.add(await realpath(project.path).catch(() => resolve(project.path)));
  }
  for (const task of tasks) {
    if (task.worktree.enabled && task.worktree.path) {
      roots.add(await realpath(task.worktree.path).catch(() => resolve(task.worktree.path)));
    }
  }

  return Array.from(roots);
}

export async function resolveWorkspacePath(path: string): Promise<string> {
  return realpath(path).catch(async () => {
    const parentPath = await realpath(dirname(path)).catch(() => resolve(dirname(path)));
    return resolve(parentPath, basename(path));
  });
}

export async function assertWorkspacePath(taskStore: TaskStore, path: string): Promise<string> {
  const [roots, resolvedPath] = await Promise.all([
    listWorkspaceRoots(taskStore),
    resolveWorkspacePath(path),
  ]);
  if (!roots.some((root) => isWithinRoot(resolvedPath, root))) {
    throw new Error(`Path is outside known workspaces: ${path}`);
  }
  return resolvedPath;
}

export async function assertWorkspaceRepo(taskStore: TaskStore, repoPath: string): Promise<string> {
  const [roots, resolvedRepoPath] = await Promise.all([
    listWorkspaceRoots(taskStore),
    realpath(repoPath).catch(() => resolve(repoPath)),
  ]);
  if (!roots.some((root) => isWithinRoot(resolvedRepoPath, root))) {
    throw new Error(`Repository is outside known workspaces: ${repoPath}`);
  }
  return resolvedRepoPath;
}

export function assertRepoFilePath(repoPath: string, filePath: string): void {
  const resolvedFilePath = resolve(repoPath, filePath);
  if (!isWithinRoot(resolvedFilePath, repoPath)) {
    throw new Error(`File path is outside repository: ${filePath}`);
  }
}

export function assertWorktreePath(repoPath: string, worktreePath: string): string {
  const worktreesRoot = resolve(repoPath, '.worktrees');
  const resolvedWorktreePath = resolve(worktreePath);
  if (!isWithinRoot(resolvedWorktreePath, worktreesRoot)) {
    throw new Error(`Worktree path must be inside ${worktreesRoot}`);
  }
  return resolvedWorktreePath;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/utils/path-validation.ts
git commit -m "feat: extract shared path validation utilities"
```

### Task 3.6: File, git handlers and editor detector

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
  FileUnwatchPayload,
  FileWritePayload,
  WsEvent,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { FileWatcher } from '../services/file-watcher';
import type { TaskStore } from '../services/task-store';
import { readFile, writeFile } from 'fs/promises';
import { assertWorkspacePath } from '../utils/path-validation';

interface FileHandlerDeps {
  router: Router;
  fileWatcher: FileWatcher;
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
}

export function registerFileHandlers(deps: FileHandlerDeps): void {
  const { router, fileWatcher, taskStore, broadcast } = deps;

  router.register(MSG.FILE_TREE, async (payload) => {
    const { path } = payload as FileTreePayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    const tree = await fileWatcher.buildTree(workspacePath);
    return { tree };
  });

  router.register(MSG.FILE_READ, async (payload) => {
    const { path } = payload as FileReadPayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    const content = await readFile(workspacePath, 'utf-8');
    return { content };
  });

  router.register(MSG.FILE_WRITE, async (payload) => {
    const { path, content } = payload as FileWritePayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    await writeFile(workspacePath, content, 'utf-8');
    return { success: true };
  });

  router.register(MSG.FILE_WATCH, async (payload) => {
    const { path } = payload as FileWatchPayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    fileWatcher.watch(workspacePath, (event) => {
      broadcast({ type: MSG.FILE_CHANGED, payload: event });
    });
    return { success: true };
  });

  router.register(MSG.FILE_UNWATCH, async (payload) => {
    const { path } = payload as FileUnwatchPayload;
    const workspacePath = await assertWorkspacePath(taskStore, path);
    fileWatcher.stop(workspacePath);
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
import type { TaskStore } from '../services/task-store';
import {
  assertWorkspaceRepo, assertRepoFilePath, assertWorktreePath,
} from '../utils/path-validation';

interface GitHandlerDeps {
  router: Router;
  git: GitService;
  taskStore: TaskStore;
}

export function registerGitHandlers(deps: GitHandlerDeps): void {
  const { router, git, taskStore } = deps;

  router.register(MSG.GIT_STATUS, async (payload) => {
    const { path } = payload as GitStatusPayload;
    const repoPath = await assertWorkspaceRepo(taskStore, path);
    return { status: await git.status(repoPath) };
  });

  router.register(MSG.GIT_DIFF, async (payload) => {
    const { path } = payload as GitDiffPayload;
    const repoPath = await assertWorkspaceRepo(taskStore, path);
    return { diff: await git.diff(repoPath) };
  });

  router.register(MSG.GIT_DIFF_FILE, async (payload) => {
    const { repoPath: rawRepoPath, filePath } = payload as GitDiffFilePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    assertRepoFilePath(repoPath, filePath);
    return { diff: await git.diffFile(repoPath, filePath) };
  });

  router.register(MSG.GIT_REVERT_FILE, async (payload) => {
    const {
      repoPath: rawRepoPath,
      filePath,
      status,
      previousPath,
    } = payload as GitRevertFilePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    assertRepoFilePath(repoPath, filePath);
    if (previousPath) {
      assertRepoFilePath(repoPath, previousPath);
    }
    await git.revertFile(repoPath, { path: filePath, status, previousPath });
    return { success: true };
  });

  router.register(MSG.GIT_WORKTREE_CREATE, async (payload) => {
    const { repoPath: rawRepoPath, branch, path } = payload as GitWorktreeCreatePayload;
    const repoPath = await assertWorkspaceRepo(taskStore, rawRepoPath);
    const worktreePath = assertWorktreePath(repoPath, path);
    await git.createWorktree(repoPath, branch, worktreePath);
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

### Task 3.7: Wire all services into index.ts

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Update index.ts with all services**

File: `packages/backend/src/index.ts`
```typescript
import { MSG } from '@taskflow/shared';
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
    router, fileWatcher, taskStore: store, broadcast: server.broadcast,
  });
  registerGitHandlers({ router, git: gitService, taskStore: store });

  // System info handler
  const editors = await detectEditors();
  router.register(MSG.SYSTEM_INFO, async () => ({ editors }));

  const { port, stop } = await server.start();
  await writeFile(config.portFile, String(port));

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

# Chunk 2: Backend Core — WebSocket Server + Project/Task CRUD

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 1 — Scaffolding](taskflow-plan-chunk-1.md) | Next: [Chunk 3 — Backend Sessions, Files & Git](taskflow-plan-chunk-3.md)

---

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

Run: `cd packages/backend && log_file="$(mktemp -t taskflow-backend.XXXXXX)" && bun run src/index.ts >"$log_file" 2>&1 & pid=$! && sleep 3 && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null || true && cat "$log_file"`
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
import { mkdtemp, mkdir, rm } from 'fs/promises';
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

  async function createProjectDir(name: string): Promise<string> {
    const dir = join(tempDir, name);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  describe('projects', () => {
    it('starts with empty project list', async () => {
      const projects = await store.listProjects();
      expect(projects).toEqual([]);
    });

    it('adds and lists projects', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      expect(project.name).toBe('test');
      expect(project.path).toBe(projectDir);
      expect(project.id).toBeTruthy();

      const projects = await store.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('test');
    });

    it('removes projects', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      await store.removeProject(project.id);
      const projects = await store.listProjects();
      expect(projects).toEqual([]);
    });

    it('rejects removing projects with existing tasks', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      await store.createTask({ projectId: project.id, title: 'Task' });
      expect(store.removeProject(project.id)).rejects.toThrow('Cannot remove project with existing tasks');
    });
  });

  describe('tasks', () => {
    it('creates and lists tasks', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      const task = await store.createTask({ projectId: project.id, title: 'My task' });
      expect(task.title).toBe('My task');
      expect(task.status).toBe('active');
      expect(task.worktree.enabled).toBe(false);

      const tasks = await store.listTasks();
      expect(tasks).toHaveLength(1);
    });

    it('lists tasks filtered by project', async () => {
      const p1Dir = await createProjectDir('p1');
      const p2Dir = await createProjectDir('p2');
      const p1 = await store.addProject({ name: 'p1', path: p1Dir });
      const p2 = await store.addProject({ name: 'p2', path: p2Dir });
      await store.createTask({ projectId: p1.id, title: 'Task 1' });
      await store.createTask({ projectId: p2.id, title: 'Task 2' });

      const p1Tasks = await store.listTasks(p1.id);
      expect(p1Tasks).toHaveLength(1);
      expect(p1Tasks[0].title).toBe('Task 1');
    });

    it('updates tasks', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      const task = await store.createTask({ projectId: project.id, title: 'Original' });
      const updated = await store.updateTask(task.id, { title: 'Updated', notes: 'some notes' });
      expect(updated.title).toBe('Updated');
      expect(updated.notes).toBe('some notes');
    });

    it('archives tasks', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
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
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
      const task = await store.createTask({ projectId: project.id, title: 'Task' });
      await store.deleteTask(task.id);

      const tasks = await store.listTasks();
      expect(tasks).toEqual([]);
    });

    it('cleans expired archives', async () => {
      const projectDir = await createProjectDir('test');
      const project = await store.addProject({ name: 'test', path: projectDir });
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
    const tasks = await this.listTasks(id);
    if (tasks.length > 0) {
      throw new Error(`Cannot remove project with existing tasks: ${id}`);
    }
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
import { mkdtemp, mkdir, rm } from 'fs/promises';
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

  async function createProjectDir(name: string): Promise<string> {
    const dir = join(tempDir, name);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it('lists projects (empty)', async () => {
    const result = await router.handle(MSG.PROJECT_LIST, {});
    expect(result).toEqual({ projects: [] });
  });

  it('adds and lists a project', async () => {
    const projectDir = await createProjectDir('test');
    await router.handle(MSG.PROJECT_ADD, { name: 'test', path: projectDir });
    const result = await router.handle(MSG.PROJECT_LIST, {}) as { projects: unknown[] };
    expect(result.projects).toHaveLength(1);
  });

  it('removes a project', async () => {
    const projectDir = await createProjectDir('test');
    const added = await router.handle(MSG.PROJECT_ADD, { name: 'test', path: projectDir }) as { id: string };
    await router.handle(MSG.PROJECT_REMOVE, { id: added.id });
    const result = await router.handle(MSG.PROJECT_LIST, {}) as { projects: unknown[] };
    expect(result.projects).toHaveLength(0);
  });

  it('rejects removing a project with existing tasks', async () => {
    const projectDir = await createProjectDir('test');
    const added = await router.handle(MSG.PROJECT_ADD, { name: 'test', path: projectDir }) as { id: string };
    await store.createTask({ projectId: added.id, title: 'Task' });
    expect(router.handle(MSG.PROJECT_REMOVE, { id: added.id })).rejects.toThrow('Cannot remove project with existing tasks');
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
import { mkdtemp, mkdir, rm } from 'fs/promises';
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
    const projectDir = join(tempDir, 'test');
    await mkdir(projectDir, { recursive: true });
    const project = await store.addProject({ name: 'test', path: projectDir });
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

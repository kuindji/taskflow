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
    const [tasks, archived] = await Promise.all([
      this.listTasks(id),
      this.listArchived(),
    ]);
    const archivedForProject = archived.filter((t) => t.projectId === id);
    if (tasks.length > 0 || archivedForProject.length > 0) {
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

  async createTask(input: {
    projectId: string;
    title: string;
    description?: string;
  }): Promise<Task> {
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

  async updateTask(
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'notes' | 'worktree' | 'sessions'>>,
  ): Promise<Task> {
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

import type { Project, Task, TaskLogEntry, TaskLogEntryType, TaskWorktree } from "@taskflow/shared";
import { ARCHIVE_EXPIRY_DAYS } from "@taskflow/shared";
import {
    appendFile,
    readFile,
    writeFile,
    readdir,
    unlink,
    mkdir,
    realpath,
    rm,
    stat,
} from "fs/promises";
import { basename, join } from "path";
import { randomUUID } from "crypto";

interface TaskStoreConfig {
    projectsFile: string;
    tasksDir: string;
    archiveDir: string;
    taskLogsDir: string;
    sessionLogsDir: string;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isJsonParseError(error: unknown): error is SyntaxError {
    return error instanceof SyntaxError;
}

function getCreatedAtTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareTasksByCreatedAtDesc(a: Task, b: Task): number {
    const createdAtDiff = getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
    if (createdAtDiff !== 0) {
        return createdAtDiff;
    }

    return a.id.localeCompare(b.id);
}

export class TaskStore {
    private config: TaskStoreConfig;
    private taskMutations = new Map<string, Promise<void>>();
    private sessionLogMutations = new Map<string, Promise<void>>();

    constructor(config: TaskStoreConfig) {
        this.config = config;
    }

    async updateConfig(config: TaskStoreConfig): Promise<void> {
        this.config = config;
        await this.init();
    }

    async init(): Promise<void> {
        await mkdir(this.config.tasksDir, { recursive: true });
        await mkdir(this.config.archiveDir, { recursive: true });
        await mkdir(this.config.sessionLogsDir, { recursive: true });
        await mkdir(this.config.taskLogsDir, { recursive: true });
    }

    async clearAllSessions(): Promise<void> {
        const [tasks, projects] = await Promise.all([this.listTasks(), this.listProjects()]);
        for (const task of tasks) {
            if (task.sessions.length > 0) {
                await this.updateTask(task.id, { sessions: [] });
            }
        }
        for (const project of projects) {
            if (project.sessions.length > 0) {
                await this.updateProject(project.id, { sessions: [] });
            }
        }
    }

    async cleanupAllSessionLogs(): Promise<void> {
        await rm(this.config.sessionLogsDir, { recursive: true, force: true });
        await mkdir(this.config.sessionLogsDir, { recursive: true });
    }

    // --- Projects ---

    private stripEphemeralFields(projects: Project[]): Omit<Project, "locationValid">[] {
        return projects.map(({ locationValid: _, ...rest }) => rest);
    }

    async listProjects(): Promise<Project[]> {
        let data: string;
        try {
            data = await readFile(this.config.projectsFile, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return [];
            }
            throw error;
        }

        let projects: Project[];
        try {
            const parsed = JSON.parse(data) as Array<Project & { sessions?: Project["sessions"] }>;
            projects = parsed.map((project) => ({
                ...project,
                sessions: project.sessions ?? [],
            }));
        } catch (error) {
            if (isJsonParseError(error)) {
                return [];
            }
            throw error;
        }

        await Promise.all(
            projects.map(async (project) => {
                try {
                    const info = await stat(project.path);
                    project.locationValid = info.isDirectory();
                } catch {
                    project.locationValid = false;
                }
            }),
        );

        return projects;
    }

    private async unlinkIfPresent(filePath: string): Promise<void> {
        try {
            await unlink(filePath);
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }

    private async readTask(filePath: string): Promise<Task | null> {
        let data: string;
        try {
            data = await readFile(filePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return null;
            }
            throw error;
        }

        try {
            return JSON.parse(data) as Task;
        } catch (error) {
            if (isJsonParseError(error)) {
                await this.unlinkIfPresent(filePath);
                return null;
            }
            throw error;
        }
    }

    private async readTasksFromDir(dirPath: string, projectId?: string): Promise<Task[]> {
        const tasks: Task[] = [];
        let files: string[];

        try {
            files = await readdir(dirPath);
        } catch (error) {
            if (isMissingFileError(error)) {
                return [];
            }
            throw error;
        }

        for (const file of files) {
            if (!file.endsWith(".json")) {
                continue;
            }

            const task = await this.readTask(join(dirPath, file));
            if (task && (!projectId || task.projectId === projectId)) {
                tasks.push(task);
            }
        }

        return tasks.sort(compareTasksByCreatedAtDesc);
    }

    async addProject(input: { name?: string; path: string }): Promise<Project> {
        const resolvedPath = await realpath(input.path).catch(() => input.path);
        const info = await stat(resolvedPath);
        if (!info.isDirectory()) {
            throw new Error(`Project path is not a directory: ${resolvedPath}`);
        }

        const projects = await this.listProjects();
        const duplicate = projects.find((p) => p.path === resolvedPath);
        if (duplicate) {
            throw new Error(`A project already exists at this path: ${duplicate.name}`);
        }
        const project: Project = {
            id: randomUUID(),
            name: input.name?.trim() || basename(resolvedPath),
            path: resolvedPath,
            sessions: [],
            createdAt: new Date().toISOString(),
        };
        projects.push(project);
        await writeFile(
            this.config.projectsFile,
            JSON.stringify(this.stripEphemeralFields(projects), null, 2),
        );
        return project;
    }

    async getProject(id: string): Promise<Project | null> {
        const projects = await this.listProjects();
        return projects.find((project) => project.id === id) ?? null;
    }

    async updateProject(
        id: string,
        updates:
            | Partial<Pick<Project, "name" | "path" | "sessions">>
            | ((project: Project) => Partial<Pick<Project, "name" | "path" | "sessions">>),
    ): Promise<Project> {
        const projects = await this.listProjects();
        const index = projects.findIndex((p) => p.id === id);
        if (index === -1) {
            throw new Error(`Project not found: ${id}`);
        }
        const resolvedUpdates = typeof updates === "function" ? updates(projects[index]) : updates;

        let resolvedPath = projects[index].path;
        if (resolvedUpdates.path) {
            const rawPath = resolvedUpdates.path;
            resolvedPath = await realpath(rawPath).catch(() => rawPath);
            const info = await stat(resolvedPath);
            if (!info.isDirectory()) {
                throw new Error(`Project path is not a directory: ${resolvedPath}`);
            }
            const duplicate = projects.find((p) => p.id !== id && p.path === resolvedPath);
            if (duplicate) {
                throw new Error(`A project already exists at this path: ${duplicate.name}`);
            }
        }

        projects[index] = {
            ...projects[index],
            ...resolvedUpdates,
            name: resolvedUpdates.name ? resolvedUpdates.name.trim() : projects[index].name,
            path: resolvedPath,
            sessions: resolvedUpdates.sessions ?? projects[index].sessions,
        };
        await writeFile(
            this.config.projectsFile,
            JSON.stringify(this.stripEphemeralFields(projects), null, 2),
        );

        // Re-validate location after path change
        try {
            const info = await stat(projects[index].path);
            projects[index].locationValid = info.isDirectory();
        } catch {
            projects[index].locationValid = false;
        }

        return projects[index];
    }

    async removeProject(id: string): Promise<void> {
        const [tasks, archived, project] = await Promise.all([
            this.listTasks(id),
            this.listArchived(),
            this.getProject(id),
        ]);
        const archivedForProject = archived.filter((task) => task.projectId === id);

        await Promise.all(tasks.map((task) => this.deleteTask(task.id)));
        await Promise.all(
            (project?.sessions ?? []).map((session) => this.deleteSessionHistory(id, session.id)),
        );
        await Promise.all(
            archivedForProject.map(async (task) => {
                await this.withTaskMutation(task.id, async () => {
                    await this.unlinkIfPresent(this.archivePath(task.id));
                });
                await this.deleteTaskSessionHistory(task.id);
                await this.deleteTaskLog(task.id);
            }),
        );

        const projects = await this.listProjects();
        const filtered = projects.filter((p) => p.id !== id);
        await writeFile(
            this.config.projectsFile,
            JSON.stringify(this.stripEphemeralFields(filtered), null, 2),
        );
    }

    // --- Tasks ---

    private taskPath(id: string): string {
        return join(this.config.tasksDir, `${id}.json`);
    }

    private archivePath(id: string): string {
        return join(this.config.archiveDir, `${id}.json`);
    }

    private sessionLogPath(taskId: string, sessionId: string): string {
        return join(this.config.sessionLogsDir, `${taskId}--${sessionId}.jsonl`);
    }

    private async writeTask(filePath: string, task: Task): Promise<void> {
        await writeFile(filePath, JSON.stringify(task, null, 2));
    }

    private async withSessionLogMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.sessionLogMutations.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);

        this.sessionLogMutations.set(key, queued);
        await previous.catch(() => undefined);

        try {
            return await mutation();
        } finally {
            release();
            if (this.sessionLogMutations.get(key) === queued) {
                this.sessionLogMutations.delete(key);
            }
        }
    }

    async appendSessionOutput(
        taskId: string,
        sessionId: string,
        sequence: number,
        data: string,
    ): Promise<void> {
        const logPath = this.sessionLogPath(taskId, sessionId);
        const entry = JSON.stringify({ sequence, data }) + "\n";
        await this.withSessionLogMutation(logPath, async () => {
            await appendFile(logPath, entry, "utf-8");
        });
    }

    async getSessionHistory(
        taskId: string,
        sessionId: string,
    ): Promise<{ data: string; lastSequence: number }> {
        const logPath = this.sessionLogPath(taskId, sessionId);
        await this.sessionLogMutations.get(logPath)?.catch(() => undefined);

        let raw: string;
        try {
            raw = await readFile(logPath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return { data: "", lastSequence: 0 };
            }
            throw error;
        }

        let data = "";
        let lastSequence = 0;
        for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line) as { sequence?: number; data?: string };
                if (typeof entry.data === "string") {
                    data += entry.data;
                }
                if (typeof entry.sequence === "number" && entry.sequence > lastSequence) {
                    lastSequence = entry.sequence;
                }
            } catch {
                continue;
            }
        }

        return { data, lastSequence };
    }

    async deleteSessionHistory(taskId: string, sessionId: string): Promise<void> {
        const logPath = this.sessionLogPath(taskId, sessionId);
        await this.withSessionLogMutation(logPath, async () => {
            await this.unlinkIfPresent(logPath);
        });
    }

    async deleteTaskSessionHistory(taskId: string): Promise<void> {
        let files: string[];
        try {
            files = await readdir(this.config.sessionLogsDir);
        } catch (error) {
            if (isMissingFileError(error)) {
                return;
            }
            throw error;
        }

        await Promise.all(
            files
                .filter((file) => file.startsWith(`${taskId}--`) && file.endsWith(".jsonl"))
                .map((file) =>
                    this.withSessionLogMutation(
                        join(this.config.sessionLogsDir, file),
                        async () => {
                            await this.unlinkIfPresent(join(this.config.sessionLogsDir, file));
                        },
                    ),
                ),
        );
    }

    // --- Task Logs ---

    private taskLogPath(taskId: string): string {
        return join(this.config.taskLogsDir, `${taskId}.jsonl`);
    }

    private taskLogMutations = new Map<string, Promise<void>>();

    private async withTaskLogMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.taskLogMutations.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);

        this.taskLogMutations.set(key, queued);
        await previous.catch(() => undefined);

        try {
            return await mutation();
        } finally {
            release();
            if (this.taskLogMutations.get(key) === queued) {
                this.taskLogMutations.delete(key);
            }
        }
    }

    async appendTaskLog(
        taskId: string,
        sessionId: string,
        type: TaskLogEntryType,
        message: string,
        meta?: Record<string, string>,
    ): Promise<TaskLogEntry> {
        const entry: TaskLogEntry = {
            id: randomUUID(),
            sessionId,
            timestamp: new Date().toISOString(),
            type,
            message,
            ...(meta ? { meta } : {}),
        };
        const logPath = this.taskLogPath(taskId);
        const line = JSON.stringify(entry) + "\n";
        await this.withTaskLogMutation(logPath, async () => {
            await appendFile(logPath, line, "utf-8");
        });
        return entry;
    }

    async getTaskLog(taskId: string): Promise<TaskLogEntry[]> {
        const logPath = this.taskLogPath(taskId);
        await this.taskLogMutations.get(logPath)?.catch(() => undefined);

        let raw: string;
        try {
            raw = await readFile(logPath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return [];
            }
            throw error;
        }

        const entries: TaskLogEntry[] = [];
        for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
                entries.push(JSON.parse(line) as TaskLogEntry);
            } catch {
                continue;
            }
        }
        return entries;
    }

    async deleteTaskLog(taskId: string): Promise<void> {
        const logPath = this.taskLogPath(taskId);
        await this.withTaskLogMutation(logPath, async () => {
            await this.unlinkIfPresent(logPath);
        });
    }

    async createTask(input: {
        projectId: string;
        parentId?: string;
        title: string;
        description: string;
        worktree?: TaskWorktree;
    }): Promise<Task> {
        const task: Task = {
            id: randomUUID(),
            projectId: input.projectId,
            parentId: input.parentId,
            title: input.title,
            description: input.description,
            notes: "",
            worktree: input.worktree ?? { enabled: false, path: null, branch: null },
            sessions: [],
            createdAt: new Date().toISOString(),
            status: "active",
            archivedAt: null,
        };
        await this.writeTask(this.taskPath(task.id), task);
        return task;
    }

    async listTasks(projectId?: string): Promise<Task[]> {
        return this.readTasksFromDir(this.config.tasksDir, projectId);
    }

    async getTask(id: string): Promise<Task | null> {
        return this.readTask(this.taskPath(id));
    }

    async getArchived(id: string): Promise<Task | null> {
        return this.readTask(this.archivePath(id));
    }

    private async withTaskMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.taskMutations.get(id) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);

        this.taskMutations.set(id, queued);
        await previous.catch(() => undefined);

        try {
            return await mutation();
        } finally {
            release();
            if (this.taskMutations.get(id) === queued) {
                this.taskMutations.delete(id);
            }
        }
    }

    async updateTask(
        id: string,
        updates:
            | Partial<Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions">>
            | ((
                  task: Task,
              ) => Partial<
                  Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions">
              >),
    ): Promise<Task> {
        return this.withTaskMutation(id, async () => {
            const task = await this.readTask(this.taskPath(id));
            if (!task) throw new Error(`Task not found: ${id}`);
            const resolvedUpdates = typeof updates === "function" ? updates(task) : updates;
            const updated = { ...task, ...resolvedUpdates };
            await this.writeTask(this.taskPath(id), updated);
            return updated;
        });
    }

    async archiveTask(id: string): Promise<Task> {
        return this.withTaskMutation(id, async () => {
            const task = await this.readTask(this.taskPath(id));
            if (!task) throw new Error(`Task not found: ${id}`);
            const archived: Task = {
                ...task,
                status: "archived",
                archivedAt: new Date().toISOString(),
            };
            await this.writeTask(this.archivePath(id), archived);
            await this.unlinkIfPresent(this.taskPath(id));
            return archived;
        });
    }

    async deleteTask(id: string): Promise<void> {
        await this.withTaskMutation(id, async () => {
            await this.unlinkIfPresent(this.taskPath(id));
        });
        await this.deleteTaskSessionHistory(id);
        await this.deleteTaskLog(id);
    }

    async deleteArchived(id: string): Promise<void> {
        await this.withTaskMutation(id, async () => {
            await this.unlinkIfPresent(this.archivePath(id));
        });
        await this.deleteTaskSessionHistory(id);
        await this.deleteTaskLog(id);
    }

    async listArchived(): Promise<Task[]> {
        return this.readTasksFromDir(this.config.archiveDir);
    }

    async getSubtasks(parentId: string): Promise<Task[]> {
        const tasks = await this.listTasks();
        return tasks.filter((t) => t.parentId === parentId);
    }

    async getArchivedSubtasks(parentId: string): Promise<Task[]> {
        const tasks = await this.listArchived();
        return tasks.filter((t) => t.parentId === parentId);
    }

    async unarchiveTask(id: string): Promise<Task> {
        return this.withTaskMutation(id, async () => {
            const task = await this.readTask(this.archivePath(id));
            if (!task) throw new Error(`Archived task not found: ${id}`);
            const restored: Task = {
                ...task,
                status: "active",
                archivedAt: null,
            };
            await this.writeTask(this.taskPath(id), restored);
            await this.unlinkIfPresent(this.archivePath(id));
            return restored;
        });
    }

    async updateArchived(
        id: string,
        updates: Partial<Task> | ((task: Task) => Partial<Task>),
    ): Promise<void> {
        await this.withTaskMutation(id, async () => {
            const task = await this.readTask(this.archivePath(id));
            if (!task) throw new Error(`Archived task not found: ${id}`);
            const resolvedUpdates = typeof updates === "function" ? updates(task) : updates;
            await this.writeTask(this.archivePath(id), { ...task, ...resolvedUpdates });
        });
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
                    await this.unlinkIfPresent(this.archivePath(task.id));
                    await this.deleteTaskSessionHistory(task.id);
                    await this.deleteTaskLog(task.id);
                    cleaned++;
                }
            }
        }
        return cleaned;
    }
}

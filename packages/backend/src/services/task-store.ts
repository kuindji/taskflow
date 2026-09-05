import type {
    Attribute,
    AttributeLayer,
    Project,
    SessionRef,
    Task,
    TaskLogEntry,
    TaskLogEntryType,
    TaskWorktree,
} from "@taskflow/shared";
import {
    ARCHIVE_EXPIRY_DAYS,
    isAgentType,
    orderProjectsByIds,
    sortTasksByCreatedAtDesc,
} from "@taskflow/shared";
import { appendFile, open, readFile, readdir, mkdir, realpath, rm, stat } from "fs/promises";
import { basename, dirname, join } from "path";
import { randomUUID } from "crypto";
import { isMissingFileError, isJsonParseError } from "./task-store-helpers";
import { addAttribute, editAttribute, removeAttribute } from "./attribute-mutations";
import { NotFoundError } from "./errors";
import { acquireFileMutationLock } from "./file-mutation-lock";
import {
    removeFileOrWrite,
    removeFileOrWriteJson,
    writeFileAtomic,
    writeJsonAtomic,
} from "./write-file-atomic";

/** How much of a session log getSessionHistory reads back, from the end. */
const SESSION_HISTORY_TAIL_BYTES = 256 * 1024;
/** A session log is compacted once an append pushes it past this size. */
const SESSION_LOG_MAX_BYTES = 4 * 1024 * 1024;
/** What compaction keeps, measured from the end and cut at a line boundary. */
const SESSION_LOG_KEEP_BYTES = 1024 * 1024;

/**
 * The last `maxBytes` of `buffer`, advanced to the first line boundary so the
 * result never starts inside a record. A buffer shorter than `maxBytes` is
 * returned whole.
 */
function tailAtLineBoundary(buffer: Buffer, maxBytes: number): Buffer {
    if (buffer.byteLength <= maxBytes) return buffer;
    const start = buffer.byteLength - maxBytes;
    const newline = buffer.indexOf(0x0a, start);
    return newline === -1 ? Buffer.alloc(0) : buffer.subarray(newline + 1);
}

/**
 * Read about the last `maxBytes` of a file as UTF-8, starting at a line
 * boundary. The window widens until it holds at least one complete line, so a
 * single record larger than the window still comes back whole instead of
 * yielding an empty result.
 */
async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
    const handle = await open(filePath, "r");
    try {
        const { size } = await handle.stat();
        let window = maxBytes;
        for (;;) {
            const start = Math.max(0, size - window);
            const buffer = Buffer.alloc(size - start);
            await handle.read(buffer, 0, buffer.byteLength, start);
            if (start === 0) return buffer.toString("utf-8");
            // The first byte of the window is never known to start a record,
            // so the boundary search must skip past it.
            const tail = tailAtLineBoundary(buffer, window - 1);
            if (tail.byteLength > 0) return tail.toString("utf-8");
            window *= 2;
        }
    } finally {
        await handle.close();
    }
}

interface TaskStoreConfig {
    projectsFile: string;
    tasksDir: string;
    archiveDir: string;
    taskLogsDir: string;
    sessionLogsDir: string;
    masterSessionsFile?: string;
}

interface TaskTombstone extends Task {
    kind: "taskflow-task-tombstone";
    version: 1;
}

function isTaskTombstone(value: unknown): value is TaskTombstone {
    return (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "taskflow-task-tombstone"
    );
}

export class TaskStore {
    private config: TaskStoreConfig;
    private taskMutations = new Map<string, Promise<void>>();
    private sessionLogMutations = new Map<string, Promise<void>>();
    private masterSessions: SessionRef[] = [];
    private projectsMutation: Promise<unknown> = Promise.resolve();
    private masterSessionsMutation: Promise<unknown> = Promise.resolve();

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
        await mkdir(dirname(this.masterSessionsFile), { recursive: true });
        try {
            this.masterSessions = JSON.parse(
                await readFile(this.masterSessionsFile, "utf-8"),
            ) as SessionRef[];
        } catch (error) {
            if (!isMissingFileError(error) && !isJsonParseError(error)) throw error;
            this.masterSessions = [];
        }
    }

    private get masterSessionsFile(): string {
        return (
            this.config.masterSessionsFile ??
            join(dirname(this.config.projectsFile), "sessions", "main", "master.json")
        );
    }

    async clearAllSessions(instanceId?: string): Promise<void> {
        const [tasks, projects] = await Promise.all([this.listTasks(), this.listProjects()]);
        const keep = (s: SessionRef) =>
            instanceId !== undefined && s.instance !== undefined && s.instance !== instanceId;
        for (const task of tasks) {
            if (task.sessions.length === 0) continue;
            const remaining = task.sessions.filter(keep);
            if (remaining.length !== task.sessions.length) {
                await this.updateTask(task.id, { sessions: remaining });
                await this.deleteSessionHistories(
                    task.id,
                    task.sessions.filter((s) => !keep(s)).map((s) => s.id),
                );
            }
        }
        for (const project of projects) {
            if (project.sessions.length === 0) continue;
            const remaining = project.sessions.filter(keep);
            if (remaining.length !== project.sessions.length) {
                await this.updateProject(project.id, { sessions: remaining });
                await this.deleteSessionHistories(
                    project.id,
                    project.sessions.filter((s) => !keep(s)).map((s) => s.id),
                );
            }
        }
    }

    /**
     * Remove session logs that no task, archived task, project, or master
     * session references any more. Sessions are dropped from their owners on
     * several paths (archive, restart reconciliation, internal sessions that
     * were never registered), so a boot-time sweep is what keeps the log
     * directory bounded regardless of which path leaked.
     */
    async sweepOrphanSessionLogs(): Promise<number> {
        let files: string[];
        try {
            files = await readdir(this.config.sessionLogsDir);
        } catch (error) {
            if (isMissingFileError(error)) return 0;
            throw error;
        }
        const [tasks, archived, projects] = await Promise.all([
            this.listTasks(),
            this.listArchived(),
            this.listProjects(),
        ]);
        const referenced = new Set<string>();
        for (const owner of [...tasks, ...archived, ...projects]) {
            for (const session of owner.sessions) referenced.add(`${owner.id}--${session.id}`);
        }
        for (const session of this.masterSessions) referenced.add(`master--${session.id}`);

        const orphans = files.filter(
            (file) => file.endsWith(".jsonl") && !referenced.has(file.slice(0, -".jsonl".length)),
        );
        await Promise.all(
            orphans.map((file) => {
                const logPath = join(this.config.sessionLogsDir, file);
                return this.withSessionLogMutation(logPath, () => this.unlinkIfPresent(logPath));
            }),
        );
        return orphans.length;
    }

    async cleanupAllSessionLogs(): Promise<void> {
        await rm(this.config.sessionLogsDir, { recursive: true, force: true });
        await mkdir(this.config.sessionLogsDir, { recursive: true });
    }

    // --- Master Sessions ---

    private async persistMasterSessions(): Promise<void> {
        await writeJsonAtomic(this.masterSessionsFile, this.masterSessions);
    }

    private async withMasterSessionsMutation<T>(mutation: () => Promise<T>): Promise<T> {
        const run = this.masterSessionsMutation.then(async () => {
            const release = await acquireFileMutationLock(this.masterSessionsFile);
            try {
                try {
                    this.masterSessions = JSON.parse(
                        await readFile(this.masterSessionsFile, "utf-8"),
                    ) as SessionRef[];
                } catch (error) {
                    if (!isMissingFileError(error) && !isJsonParseError(error)) throw error;
                    this.masterSessions = [];
                }
                return await mutation();
            } finally {
                await release();
            }
        });
        this.masterSessionsMutation = run.catch(() => undefined);
        return run;
    }

    async addMasterSession(session: SessionRef): Promise<void> {
        await this.withMasterSessionsMutation(async () => {
            this.masterSessions.push(session);
            await this.persistMasterSessions();
        });
    }

    async removeMasterSession(sessionId: string): Promise<void> {
        await this.withMasterSessionsMutation(async () => {
            this.masterSessions = this.masterSessions.filter((s) => s.id !== sessionId);
            await this.persistMasterSessions();
        });
    }

    getMasterSessions(): SessionRef[] {
        return [...this.masterSessions];
    }

    async updateMasterSession(sessionId: string, updates: Partial<SessionRef>): Promise<void> {
        await this.withMasterSessionsMutation(async () => {
            this.masterSessions = this.masterSessions.map((s) =>
                s.id === sessionId ? { ...s, ...updates } : s,
            );
            await this.persistMasterSessions();
        });
    }

    private reconcileSessionList(
        sessions: SessionRef[],
        instanceId: string,
        bootId: string,
        onlyBootId?: string,
    ): { sessions: SessionRef[]; changed: boolean; dropped: string[] } {
        let changed = false;
        const next: SessionRef[] = [];
        const dropped: string[] = [];
        for (const session of sessions) {
            if (
                session.instance !== instanceId ||
                (onlyBootId !== undefined && session.bootId !== onlyBootId)
            ) {
                next.push(session);
                continue;
            }
            if (!isAgentType(session.type)) {
                changed = true;
                dropped.push(session.id);
                continue;
            }
            if (session.bootId === bootId) {
                next.push(session);
                continue;
            }
            const reconciled: SessionRef = {
                ...session,
                state: "interrupted",
            };
            next.push(reconciled);
            if (session.state !== "interrupted") changed = true;
        }
        return { sessions: next, changed, dropped };
    }

    /**
     * Apply reconcileSessionList to every owner, re-running it inside each
     * owner's own read-modify-write so a concurrent update is not lost, and
     * delete the logs of the sessions it dropped.
     */
    private async reconcileAllSessionLists(
        instanceId: string,
        bootId: string,
        onlyBootId?: string,
    ): Promise<void> {
        const reconcile = (sessions: SessionRef[]) =>
            this.reconcileSessionList(sessions, instanceId, bootId, onlyBootId);
        const [tasks, projects] = await Promise.all([this.listTasks(), this.listProjects()]);
        for (const task of tasks) {
            if (!reconcile(task.sessions).changed) continue;
            let dropped: string[] = [];
            await this.updateTask(task.id, (current) => {
                const latest = reconcile(current.sessions);
                dropped = latest.dropped;
                return { sessions: latest.sessions };
            });
            await this.deleteSessionHistories(task.id, dropped);
        }
        for (const project of projects) {
            if (!reconcile(project.sessions).changed) continue;
            let dropped: string[] = [];
            await this.updateProject(project.id, (current) => {
                const latest = reconcile(current.sessions);
                dropped = latest.dropped;
                return { sessions: latest.sessions };
            });
            await this.deleteSessionHistories(project.id, dropped);
        }
        if (reconcile(this.masterSessions).changed) {
            let dropped: string[] = [];
            await this.withMasterSessionsMutation(async () => {
                const latest = reconcile(this.masterSessions);
                this.masterSessions = latest.sessions;
                dropped = latest.dropped;
                if (latest.changed) await this.persistMasterSessions();
            });
            await this.deleteSessionHistories("master", dropped);
        }
    }

    async reconcileInterruptedSessions(instanceId: string, bootId: string): Promise<void> {
        await this.reconcileAllSessionLists(instanceId, bootId);
    }

    async markBootSessionsInterrupted(instanceId: string, bootId: string): Promise<void> {
        await this.reconcileAllSessionLists(instanceId, "__next_boot__", bootId);
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
                attributes: project.attributes ?? [],
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
        await removeFileOrWrite(filePath, "");
    }

    private async removeTaskRecord(filePath: string, id: string): Promise<void> {
        const deletedAt = new Date().toISOString();
        await removeFileOrWriteJson(filePath, {
            kind: "taskflow-task-tombstone",
            version: 1,
            id,
            // Keep tombstones structurally compatible with older Taskflow
            // backends that share this directory but do not know the marker.
            // The reserved project keeps the record out of every real project.
            projectId: "__taskflow_deleted__",
            title: "Deleted task",
            description: "",
            notes: "",
            worktree: { enabled: false, path: null, branch: null, pr: null },
            sessions: [],
            attributes: [],
            createdAt: deletedAt,
            status: "archived",
            archivedAt: deletedAt,
            pinned: false,
        } satisfies TaskTombstone);
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
            const parsed = JSON.parse(data) as unknown;
            if (isTaskTombstone(parsed)) {
                return null;
            }
            const task = parsed as Task;
            return {
                ...task,
                pinned: task.pinned ?? false,
                attributes: task.attributes ?? [],
                worktree: { ...task.worktree, pr: task.worktree.pr ?? null },
            };
        } catch (error) {
            if (isJsonParseError(error)) {
                // Never delete the file: reading is not a mutation, and a parse
                // failure can be transient (a half-materialised file from cloud
                // storage, a write from another process). Deleting here destroyed
                // real tasks. Leave it on disk so the next write repairs it and a
                // genuinely corrupt file stays recoverable by hand.
                console.error(`[task-store] Unparsable task file, skipping: ${filePath}`);
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

        return sortTasksByCreatedAtDesc(tasks);
    }

    async addProject(input: {
        name?: string;
        path: string;
        defaultInitCommand?: string;
    }): Promise<Project> {
        const resolvedPath = await realpath(input.path).catch(() => input.path);
        const info = await stat(resolvedPath);
        if (!info.isDirectory()) {
            throw new Error(`Project path is not a directory: ${resolvedPath}`);
        }

        return this.withProjectsMutation(async () => {
            const projects = await this.listProjects();
            const duplicate = projects.find((p) => p.path === resolvedPath);
            if (duplicate) {
                if (duplicate.hidden) {
                    duplicate.hidden = false;
                    await writeJsonAtomic(
                        this.config.projectsFile,
                        this.stripEphemeralFields(projects),
                    );
                    return duplicate;
                }
                throw new Error(`A project already exists at this path: ${duplicate.name}`);
            }
            const project: Project = {
                id: randomUUID(),
                name: input.name?.trim() || basename(resolvedPath),
                path: resolvedPath,
                sessions: [],
                attributes: [],
                createdAt: new Date().toISOString(),
                ...(input.defaultInitCommand?.trim()
                    ? { defaultInitCommand: input.defaultInitCommand.trim() }
                    : {}),
            };
            projects.push(project);
            await writeJsonAtomic(this.config.projectsFile, this.stripEphemeralFields(projects));
            return project;
        });
    }

    async getProject(id: string): Promise<Project | null> {
        const projects = await this.listProjects();
        return projects.find((project) => project.id === id) ?? null;
    }

    async updateProject(
        id: string,
        updates:
            | Partial<
                  Pick<
                      Project,
                      | "name"
                      | "path"
                      | "sessions"
                      | "hidden"
                      | "defaultInitCommand"
                      | "prompt"
                      | "linkedProjects"
                      | "attributes"
                  >
              >
            | ((
                  project: Project,
              ) => Partial<
                  Pick<
                      Project,
                      | "name"
                      | "path"
                      | "sessions"
                      | "hidden"
                      | "defaultInitCommand"
                      | "prompt"
                      | "linkedProjects"
                      | "attributes"
                  >
              >),
    ): Promise<Project> {
        return this.withProjectsMutation(async () => {
            const projects = await this.listProjects();
            const index = projects.findIndex((p) => p.id === id);
            if (index === -1) {
                throw new NotFoundError(`Project not found: ${id}`);
            }
            const resolvedUpdates =
                typeof updates === "function" ? updates(projects[index]) : updates;

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
                defaultInitCommand:
                    "defaultInitCommand" in resolvedUpdates
                        ? resolvedUpdates.defaultInitCommand?.trim() || undefined
                        : projects[index].defaultInitCommand,
                prompt:
                    "prompt" in resolvedUpdates
                        ? resolvedUpdates.prompt?.trim() || undefined
                        : projects[index].prompt,
                linkedProjects:
                    "linkedProjects" in resolvedUpdates
                        ? resolvedUpdates.linkedProjects
                        : projects[index].linkedProjects,
            };
            await writeJsonAtomic(this.config.projectsFile, this.stripEphemeralFields(projects));

            // Re-validate location after path change
            try {
                const info = await stat(projects[index].path);
                projects[index].locationValid = info.isDirectory();
            } catch {
                projects[index].locationValid = false;
            }

            return projects[index];
        });
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
                    await this.removeTaskRecord(this.archivePath(task.id), task.id);
                });
                await this.deleteTaskSessionHistory(task.id);
                await this.deleteTaskLog(task.id);
            }),
        );

        await this.withProjectsMutation(async () => {
            const projects = await this.listProjects();
            const filtered = projects.filter((p) => p.id !== id);
            await writeJsonAtomic(this.config.projectsFile, this.stripEphemeralFields(filtered));
        });
    }

    async reorderProjects(orderedIds: string[]): Promise<Project[]> {
        return this.withProjectsMutation(async () => {
            const projects = await this.listProjects();
            const reordered = orderProjectsByIds(projects, orderedIds);
            await writeJsonAtomic(this.config.projectsFile, this.stripEphemeralFields(reordered));
            return reordered;
        });
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
        await writeJsonAtomic(filePath, task);
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
        }
    }

    /**
     * Byte size of each session log this process has appended to, so the
     * compaction check does not stat the file on every PTY batch. Seeded from
     * disk on first append and dropped when the log is deleted.
     */
    private sessionLogSizes = new Map<string, number>();

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
            let size = this.sessionLogSizes.get(logPath);
            if (size === undefined) {
                size = await stat(logPath).then(
                    (info) => info.size,
                    () => Buffer.byteLength(entry),
                );
            } else {
                size += Buffer.byteLength(entry);
            }
            if (size > SESSION_LOG_MAX_BYTES) {
                size = await this.compactSessionLog(logPath);
            }
            this.sessionLogSizes.set(logPath, size);
        });
    }

    /**
     * Rewrite a session log keeping only its last SESSION_LOG_KEEP_BYTES, cut
     * at a line boundary. Sequences are monotonic, so dropping the head loses
     * nothing a client can replay, and the in-memory scrollback the PTY
     * manager keeps is far smaller than what is retained here.
     */
    private async compactSessionLog(logPath: string): Promise<number> {
        const raw = await readFile(logPath);
        if (raw.byteLength <= SESSION_LOG_KEEP_BYTES) return raw.byteLength;
        const tail = tailAtLineBoundary(raw, SESSION_LOG_KEEP_BYTES);
        await writeFileAtomic(logPath, tail.toString("utf-8"));
        return tail.byteLength;
    }

    async getSessionHistory(
        taskId: string,
        sessionId: string,
    ): Promise<{ data: string; lastSequence: number }> {
        const logPath = this.sessionLogPath(taskId, sessionId);

        // Only the tail is read: a long session's log can reach tens of MB and
        // a client can only ever display the last few thousand lines of it.
        // The read takes its turn in the log's mutation queue so it can never
        // overlap a compaction, which rewrites the file in place on some mounts.
        let raw: string;
        try {
            raw = await this.withSessionLogMutation(logPath, () =>
                readFileTail(logPath, SESSION_HISTORY_TAIL_BYTES),
            );
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
            this.sessionLogSizes.delete(logPath);
            await this.unlinkIfPresent(logPath);
        });
    }

    private async deleteSessionHistories(ownerId: string, sessionIds: string[]): Promise<void> {
        await Promise.all(sessionIds.map((id) => this.deleteSessionHistory(ownerId, id)));
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
                .map((file) => {
                    const logPath = join(this.config.sessionLogsDir, file);
                    return this.withSessionLogMutation(logPath, async () => {
                        this.sessionLogSizes.delete(logPath);
                        await this.unlinkIfPresent(logPath);
                    });
                }),
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
        initCommand?: string;
    }): Promise<Task> {
        const task: Task = {
            id: randomUUID(),
            projectId: input.projectId,
            parentId: input.parentId,
            title: input.title,
            description: input.description,
            notes: "",
            worktree: input.worktree ?? { enabled: false, path: null, branch: null, pr: null },
            sessions: [],
            attributes: [],
            createdAt: new Date().toISOString(),
            status: "active",
            archivedAt: null,
            pinned: false,
            ...(input.initCommand && { initCommand: input.initCommand }),
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

    /**
     * Serializes read-modify-write cycles over the single projects file. Not
     * reentrant — never call a locked method from inside another one.
     */
    private withProjectsMutation<T>(mutation: () => Promise<T>): Promise<T> {
        const lockedMutation = async () => {
            const release = await acquireFileMutationLock(this.config.projectsFile);
            try {
                return await mutation();
            } finally {
                await release();
            }
        };
        const run = this.projectsMutation.then(lockedMutation, lockedMutation);
        this.projectsMutation = run.catch(() => undefined);
        return run;
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
            const releaseFileLock = await acquireFileMutationLock(this.taskPath(id));
            try {
                return await mutation();
            } finally {
                await releaseFileLock();
            }
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
            | Partial<
                  Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions" | "pinned">
              >
            | ((
                  task: Task,
              ) => Partial<
                  Pick<Task, "title" | "description" | "notes" | "worktree" | "sessions" | "pinned">
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

    private async mutateTaskAttributes(
        taskId: string,
        mutate: (list: Attribute[]) => Attribute[],
    ): Promise<Task> {
        return this.withTaskMutation(taskId, async () => {
            const task = await this.readTask(this.taskPath(taskId));
            if (!task) throw new NotFoundError(`Task not found: ${taskId}`);
            const updated: Task = { ...task, attributes: mutate(task.attributes) };
            await this.writeTask(this.taskPath(taskId), updated);
            return updated;
        });
    }

    async createTaskAttribute(taskId: string, name: string, value: string): Promise<Task> {
        const id = randomUUID();
        return this.mutateTaskAttributes(taskId, (list) => addAttribute(list, id, name, value));
    }

    async updateTaskAttribute(
        taskId: string,
        attrId: string,
        updates: { name?: string; value?: string },
    ): Promise<Task> {
        return this.mutateTaskAttributes(taskId, (list) => editAttribute(list, attrId, updates));
    }

    async deleteTaskAttribute(taskId: string, attrId: string): Promise<Task> {
        return this.mutateTaskAttributes(taskId, (list) => removeAttribute(list, attrId));
    }

    private async mutateProjectAttributes(
        projectId: string,
        mutate: (list: Attribute[]) => Attribute[],
    ): Promise<Project> {
        // The function form reads inside updateProject's own read-modify-write,
        // which Step 9a makes atomic. Reading separately here would reintroduce
        // the lost-update race.
        return this.updateProject(projectId, (project) => ({
            attributes: mutate(project.attributes),
        }));
    }

    async createProjectAttribute(projectId: string, name: string, value: string): Promise<Project> {
        const id = randomUUID();
        return this.mutateProjectAttributes(projectId, (list) =>
            addAttribute(list, id, name, value),
        );
    }

    async updateProjectAttribute(
        projectId: string,
        attrId: string,
        updates: { name?: string; value?: string },
    ): Promise<Project> {
        return this.mutateProjectAttributes(projectId, (list) =>
            editAttribute(list, attrId, updates),
        );
    }

    async deleteProjectAttribute(projectId: string, attrId: string): Promise<Project> {
        return this.mutateProjectAttributes(projectId, (list) => removeAttribute(list, attrId));
    }

    async resolveTaskAttributeLayers(taskId: string): Promise<AttributeLayer[]> {
        const task = await this.getTask(taskId);
        if (!task) throw new NotFoundError(`Task not found: ${taskId}`);
        const project = await this.getProject(task.projectId);
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: project?.attributes ?? [] },
        ];
        if (task.parentId) {
            const parent = await this.getTask(task.parentId);
            layers.push({ scope: "parent", attributes: parent?.attributes ?? [] });
        }
        layers.push({ scope: "task", attributes: task.attributes });
        return layers;
    }

    async resolveProjectAttributeLayers(projectId: string): Promise<AttributeLayer[]> {
        const project = await this.getProject(projectId);
        if (!project) throw new NotFoundError(`Project not found: ${projectId}`);
        return [{ scope: "project", attributes: project.attributes }];
    }

    async archiveTask(id: string): Promise<Task> {
        return this.withTaskMutation(id, async () => {
            const task = await this.readTask(this.taskPath(id));
            if (!task) throw new Error(`Task not found: ${id}`);
            const archived: Task = {
                ...task,
                status: "archived",
                archivedAt: new Date().toISOString(),
                pinned: false,
            };
            await this.writeTask(this.archivePath(id), archived);
            await this.removeTaskRecord(this.taskPath(id), id);
            return archived;
        });
    }

    async deleteTask(id: string): Promise<void> {
        await this.withTaskMutation(id, async () => {
            await this.removeTaskRecord(this.taskPath(id), id);
        });
        await this.deleteTaskSessionHistory(id);
        await this.deleteTaskLog(id);
    }

    async deleteArchived(id: string): Promise<void> {
        await this.withTaskMutation(id, async () => {
            await this.removeTaskRecord(this.archivePath(id), id);
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
            await this.removeTaskRecord(this.archivePath(id), id);
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
                    await this.removeTaskRecord(this.archivePath(task.id), task.id);
                    await this.deleteTaskSessionHistory(task.id);
                    await this.deleteTaskLog(task.id);
                    cleaned++;
                }
            }
        }
        return cleaned;
    }
}

import { MSG, orderProjectsByIds, sortTasksByCreatedAtDesc } from "@taskflow/shared";
import type {
    MasterSessionsListResponse,
    Project,
    ProjectListResponse,
    SessionRef,
    Task,
    TaskListResponse,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

function upsert<T extends { id: string }>(items: T[], next: T): T[] {
    const index = items.findIndex((item) => item.id === next.id);
    if (index === -1) return [...items, next];
    const copy = [...items];
    copy[index] = next;
    return copy;
}

class Store {
    private projectList: Project[] = [];
    private taskList: Task[] = [];
    private masterSessionList: SessionRef[] = [];
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    /**
     * Non-null while a `load()` is in flight. Events that land in that window
     * describe changes the snapshot may predate, so they are held here and
     * replayed on top of the snapshot instead of being overwritten by it.
     * One shared queue across overlapping loads: whichever load commits drains it,
     * from that load's own mark onwards.
     */
    private deferred: (() => void)[] | null = null;
    /** Incremented per `load()`; only the newest load may commit its snapshot. */
    private loadToken = 0;

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.PROJECT_CREATED, (payload) => {
                this.apply(() => this.applyProject(payload));
            }),
            net.on(MSG.PROJECT_UPDATED, (payload) => {
                this.apply(() => this.applyProject(payload));
            }),
            net.on(MSG.PROJECT_REMOVED, (payload) => {
                this.apply(() => {
                    this.removeProject(payload);
                });
            }),
            net.on(MSG.PROJECT_REORDERED, (payload) => {
                this.apply(() => {
                    this.reorderProjects(payload);
                });
            }),
            net.on(MSG.TASK_CREATED, (payload) => {
                this.apply(() => this.applyTask(payload));
            }),
            net.on(MSG.TASK_UPDATED, (payload) => {
                this.apply(() => this.updateTask(payload));
            }),
            net.on(MSG.MASTER_SESSIONS_LIST, (payload) => {
                this.apply(() => {
                    this.masterSessionList = (payload as MasterSessionsListResponse).sessions;
                });
            }),
        );
    }

    /** Run a mutation now, or defer it until the in-flight `load()` settles. */
    private apply(mutation: () => void): void {
        if (this.deferred) {
            this.deferred.push(mutation);
            return;
        }
        mutation();
        this.notify();
    }

    private applyProject(payload: unknown): void {
        this.projectList = upsert(this.projectList, payload as Project);
    }

    /**
     * Snapshots arrive in the backend's own order, and the sidebar shows that
     * order, so a record folded in from a broadcast has to be re-sorted into it.
     * Appending instead would leave a new or newly pinned task in a slot the
     * next snapshot moves it out of.
     */
    private applyTask(payload: unknown): void {
        this.taskList = sortTasksByCreatedAtDesc(upsert(this.taskList, payload as Task));
    }

    private updateTask(payload: unknown): void {
        const next = payload as Task;
        const previous = this.taskList.find((t) => t.id === next.id);
        this.applyTask(payload);
        if (next.parentId !== undefined) return;
        // Archiving or unarchiving a top-level task cascades to its subtasks on
        // the backend, which broadcasts the parent alone
        // (`api/routes/task-routes.ts` archive and unarchive), so mirror the
        // cascade or the children keep the status they had before.
        // Only a status transition cascades: an ordinary parent update — a
        // rename, a session change — must leave the children as they are.
        if (previous !== undefined && previous.status !== next.status) {
            const { status, archivedAt } = next;
            this.taskList = this.taskList.map((t) =>
                t.parentId === next.id ? { ...t, status, archivedAt } : t,
            );
        }
        // Unarchiving restores every archived subtask, including ones archived
        // on their own. `TASK_LIST` serves active tasks only, so those are
        // records this cache has never held and cannot reconstruct — the parent
        // coming back is the signal to go and fetch them.
        if (next.status === "active" && previous?.status !== "active") this.refresh();
    }

    /**
     * A background reload for a cascade this cache cannot mirror locally.
     * A failure leaves the stale rows in place until the next load; the store
     * has no error channel of its own and reconnect is the app's job.
     */
    private refresh(): void {
        this.load().catch(() => undefined);
    }

    /**
     * Project order is client-visible, and a reorder broadcast carries only the
     * new id order, so reapply it to the records already held.
     */
    private reorderProjects(payload: unknown): void {
        const { orderedIds } = payload as { orderedIds: string[] };
        this.projectList = orderProjectsByIds(this.projectList, orderedIds);
    }

    /**
     * Removing a project cascades to its tasks on the backend, which emits no
     * per-task event for them, so drop them here or they linger as orphans.
     */
    private removeProject(payload: unknown): void {
        const { id } = payload as { id: string };
        this.projectList = this.projectList.filter((p) => p.id !== id);
        this.taskList = this.taskList.filter((t) => t.projectId !== id);
    }

    private notify(): void {
        for (const listener of [...this.listeners]) listener();
    }

    async load(): Promise<void> {
        const token = ++this.loadToken;
        // Mutations already queued were broadcast before these requests went out,
        // so the backend had committed them before it built this snapshot.
        // Replaying them on top would put their older values back over newer ones.
        const mark = (this.deferred ??= []).length;
        let committed = false;
        try {
            const [projects, tasks, masterSessions] = await Promise.all([
                this.net.request<ProjectListResponse>(MSG.PROJECT_LIST),
                this.net.request<TaskListResponse>(MSG.TASK_LIST),
                this.net.request<MasterSessionsListResponse>(MSG.MASTER_SESSIONS_LIST),
            ]);
            // A later load() already owns the state; this snapshot is stale by
            // definition, so committing it would undo the newer one.
            if (this.loadToken !== token) return;
            this.projectList = projects.projects;
            this.taskList = tasks.tasks;
            this.masterSessionList = masterSessions.sessions;
            committed = true;
        } finally {
            if (this.loadToken === token) {
                const deferred = this.deferred ?? [];
                this.deferred = null;
                // Without a committed snapshot nothing has superseded the earlier
                // mutations, so they all still have to be applied.
                for (const mutation of committed ? deferred.slice(mark) : deferred) mutation();
                this.notify();
            }
        }
    }

    get projects(): readonly Project[] {
        return this.projectList.filter((p) => p.hidden !== true);
    }

    get tasks(): readonly Task[] {
        return this.taskList;
    }

    projectById(projectId: string): Project | null {
        return this.projectList.find((project) => project.id === projectId) ?? null;
    }

    taskById(taskId: string): Task | null {
        return this.taskList.find((task) => task.id === taskId) ?? null;
    }

    applyServerTask(task: Task): void {
        this.apply(() => this.updateTask(task));
    }

    get masterSessions(): readonly SessionRef[] {
        return this.masterSessionList;
    }

    tasksFor(projectId: string): Task[] {
        return this.taskList.filter((t) => t.projectId === projectId && t.status === "active");
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { Store };

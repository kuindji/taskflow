import { MSG } from "@taskflow/shared";
import type { Project, Task, ProjectListResponse, TaskListResponse } from "@taskflow/shared";
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
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    /**
     * Non-null while a `load()` is in flight. Events that land in that window
     * describe changes the snapshot may predate, so they are held here and
     * replayed on top of the snapshot instead of being overwritten by it.
     * One shared queue across overlapping loads: whichever load commits drains it.
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
            net.on(MSG.TASK_CREATED, (payload) => {
                this.apply(() => this.applyTask(payload));
            }),
            net.on(MSG.TASK_UPDATED, (payload) => {
                this.apply(() => this.applyTask(payload));
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

    private applyTask(payload: unknown): void {
        this.taskList = upsert(this.taskList, payload as Task);
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
        this.deferred ??= [];
        try {
            const [projects, tasks] = await Promise.all([
                this.net.request<ProjectListResponse>(MSG.PROJECT_LIST),
                this.net.request<TaskListResponse>(MSG.TASK_LIST),
            ]);
            // A later load() already owns the state; this snapshot is stale by
            // definition, so committing it would undo the newer one.
            if (this.loadToken !== token) return;
            this.projectList = projects.projects;
            this.taskList = tasks.tasks;
        } finally {
            if (this.loadToken === token) {
                const deferred = this.deferred ?? [];
                this.deferred = null;
                for (const mutation of deferred) mutation();
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

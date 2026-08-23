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

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.PROJECT_CREATED, (payload) => {
                this.applyProject(payload);
            }),
            net.on(MSG.PROJECT_UPDATED, (payload) => {
                this.applyProject(payload);
            }),
            net.on(MSG.PROJECT_REMOVED, (payload) => {
                const { id } = payload as { id: string };
                this.projectList = this.projectList.filter((p) => p.id !== id);
                this.notify();
            }),
            net.on(MSG.TASK_CREATED, (payload) => {
                this.applyTask(payload);
            }),
            net.on(MSG.TASK_UPDATED, (payload) => {
                this.applyTask(payload);
            }),
        );
    }

    private applyProject(payload: unknown): void {
        this.projectList = upsert(this.projectList, payload as Project);
        this.notify();
    }

    private applyTask(payload: unknown): void {
        this.taskList = upsert(this.taskList, payload as Task);
        this.notify();
    }

    private notify(): void {
        for (const listener of [...this.listeners]) listener();
    }

    async load(): Promise<void> {
        const [projects, tasks] = await Promise.all([
            this.net.request<ProjectListResponse>(MSG.PROJECT_LIST),
            this.net.request<TaskListResponse>(MSG.TASK_LIST),
        ]);
        this.projectList = projects.projects;
        this.taskList = tasks.tasks;
        this.notify();
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

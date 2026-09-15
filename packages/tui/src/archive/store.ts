import { MSG } from "@taskflow/shared";
import type {
    Task,
    TaskDeletePayload,
    TaskListResponse,
    TaskUnarchivePayload,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

/**
 * Archived tasks, fetched when the archive sidebar opens. Nothing is broadcast
 * for unarchive or delete over WebSocket, so each response is applied here.
 */
class ArchiveStore {
    private list: Task[] = [];

    constructor(private readonly net: NetLike) {}

    async load(): Promise<Task[]> {
        const response = await this.net.request<TaskListResponse>(MSG.TASK_LIST_ARCHIVED);
        this.list = response.tasks;
        return response.tasks;
    }

    tasks(): readonly Task[] {
        return this.list;
    }

    /** The backend restores the archived subtasks too, but returns only the parent. */
    async unarchive(id: string): Promise<Task> {
        const payload: TaskUnarchivePayload = { id };
        const task = await this.net.request<Task>(MSG.TASK_UNARCHIVE, payload);
        this.removeWithSubtasks(id);
        return task;
    }

    /** Resolves before the worktree is gone: the backend removes it in the background. */
    async delete(id: string, deleteWorktree: boolean): Promise<void> {
        const payload: TaskDeletePayload = { id, deleteWorktree };
        await this.net.request(MSG.TASK_DELETE, payload);
        this.removeWithSubtasks(id);
    }

    removeLocal(ids: readonly string[]): void {
        const removed = new Set(ids);
        this.list = this.list.filter((task) => !removed.has(task.id));
    }

    private removeWithSubtasks(id: string): void {
        const subtaskIds = this.list.filter((task) => task.parentId === id).map((task) => task.id);
        this.removeLocal([id, ...subtaskIds]);
    }
}

export { ArchiveStore };

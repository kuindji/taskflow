import { MSG } from "@taskflow/shared";
import type {
    AttrCreatePayload,
    AttrDeletePayload,
    AttrUpdatePayload,
    Task,
    TaskCreatePayload,
    TaskLogAddedEvent,
    TaskLogEntry,
    TaskLogListResponse,
    TaskUpdatePayload,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

function chronological(entries: readonly TaskLogEntry[]): TaskLogEntry[] {
    return [...entries].sort(
        (left, right) =>
            left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id),
    );
}

function upsertLog(entries: readonly TaskLogEntry[], entry: TaskLogEntry): TaskLogEntry[] {
    return chronological([...entries.filter((candidate) => candidate.id !== entry.id), entry]);
}

function mergeLogs(
    snapshot: readonly TaskLogEntry[],
    liveEntries: readonly TaskLogEntry[],
): TaskLogEntry[] {
    return liveEntries.reduce<TaskLogEntry[]>(
        (entries, entry) => upsertLog(entries, entry),
        chronological(snapshot),
    );
}

class TaskDetailStore {
    private readonly logSnapshots = new Map<string, TaskLogEntry[]>();
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    private loadToken = 0;
    private selectedTaskId: string | null = null;
    private disposed = false;

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.TASK_LOG_ADDED, (payload) => {
                const event = payload as Partial<TaskLogAddedEvent>;
                if (!event.taskId || !event.entry) return;
                this.logSnapshots.set(
                    event.taskId,
                    upsertLog(this.logSnapshots.get(event.taskId) ?? [], event.entry),
                );
                this.notify();
            }),
        );
    }

    logsFor(taskId: string): readonly TaskLogEntry[] {
        return this.logSnapshots.get(taskId) ?? [];
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    async loadLogs(taskId: string): Promise<void> {
        const token = ++this.loadToken;
        this.selectedTaskId = taskId;
        const response = await this.net.request<TaskLogListResponse>(MSG.TASK_LOG_LIST, { taskId });
        if (this.disposed || token !== this.loadToken || this.selectedTaskId !== taskId) {
            return;
        }
        this.logSnapshots.set(
            taskId,
            mergeLogs(response.entries, this.logSnapshots.get(taskId) ?? []),
        );
        this.notify();
    }

    selectTask(taskId: string | null): void {
        if (this.selectedTaskId === taskId) return;
        this.selectedTaskId = taskId;
        this.loadToken++;
    }

    create(payload: TaskCreatePayload): Promise<Task> {
        return this.net.request<Task>(MSG.TASK_CREATE, payload);
    }

    update(payload: TaskUpdatePayload): Promise<Task> {
        return this.net.request<Task>(MSG.TASK_UPDATE, payload);
    }

    archive(taskId: string): Promise<Task> {
        return this.net.request<Task>(MSG.TASK_ARCHIVE, { id: taskId });
    }

    createAttribute(payload: AttrCreatePayload): Promise<Task> {
        return this.net.request<Task>(MSG.ATTR_CREATE, payload);
    }

    updateAttribute(payload: AttrUpdatePayload): Promise<Task> {
        return this.net.request<Task>(MSG.ATTR_UPDATE, payload);
    }

    deleteAttribute(payload: AttrDeletePayload): Promise<Task> {
        return this.net.request<Task>(MSG.ATTR_DELETE, payload);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.loadToken++;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { TaskDetailStore, chronological };

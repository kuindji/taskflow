import { create } from "zustand";
import type {
    Task,
    TaskLogEntry,
    TaskLogAddedEvent,
    TaskListResponse,
    TaskLogListResponse,
} from "@taskflow/shared";
import { MSG, sortTasksByCreatedAtDesc } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

interface TaskCreatePayload {
    projectId: string;
    title?: string;
    description: string;
    worktree?: boolean;
    parentId?: string;
    initCommand?: string;
}

/**
 * Mutations take the whole record rather than its id: the record's own
 * `backendId` is the only target a mutation may go to.
 */
interface TaskStore {
    tasks: Scoped<Task>[];
    archivedTasks: Scoped<Task>[];
    showArchive: boolean;
    activeTaskId: string | null;
    loading: boolean;
    taskLogs: Record<string, TaskLogEntry[]>;
    /** Rejects when the request fails, so a bootstrap can tell the machine is unusable. */
    fetchTasks(backendId: string): Promise<void>;
    fetchArchivedTasks(backendId: string): Promise<void>;
    setShowArchive(show: boolean): void;
    /** A task's machine is its project's, so the caller passes the project's `backendId`. */
    createTask(backendId: string, payload: TaskCreatePayload): Promise<Scoped<Task>>;
    updateTask(task: Scoped<Task>, updates: Partial<Task>): Promise<void>;
    archiveTask(task: Scoped<Task>): Promise<void>;
    unarchiveTask(task: Scoped<Task>): Promise<void>;
    deleteTask(task: Scoped<Task>, options?: { deleteWorktree?: boolean }): Promise<void>;
    setActiveTask(id: string | null): void;
    fetchTaskLog(task: Scoped<Task>): Promise<void>;
    appendLogEntry(taskId: string, entry: TaskLogEntry): void;
}

const live = createSlices<Task>();
const archived = createSlices<Task>();

function publish(): void {
    useTaskStore.setState({ tasks: live.read(), archivedTasks: archived.read() });
}

async function requestTasks(backendId: string, type: string): Promise<Task[]> {
    const { tasks } = await sendRequest<TaskListResponse>(backendId, type);
    return sortTasksByCreatedAtDesc(tasks);
}

/** A task and its subtasks: archiving or deleting one takes the others with it. */
function withoutTaskFamily(items: Scoped<Task>[], id: string): Scoped<Task>[] {
    return items.filter((t) => t.id !== id && t.parentId !== id);
}

function activeTaskAfterRemoving(id: string): string | null {
    const { activeTaskId, tasks } = useTaskStore.getState();
    const removed =
        activeTaskId === id || tasks.some((t) => t.parentId === id && t.id === activeTaskId);
    return removed ? null : activeTaskId;
}

export const useTaskStore = create<TaskStore>((set) => ({
    tasks: [],
    archivedTasks: [],
    showArchive: false,
    activeTaskId: null,
    loading: false,
    taskLogs: {},
    async fetchTasks(backendId) {
        set({ loading: true });
        try {
            const before = live.read().filter((t) => t.backendId === backendId);
            const landed = await live.load(backendId, () => requestTasks(backendId, MSG.TASK_LIST));
            if (!landed) return;
            // Only a task this machine held can have vanished from it; an active
            // task on another machine is not this response's to clear.
            const { activeTaskId } = useTaskStore.getState();
            const vanished =
                before.some((t) => t.id === activeTaskId) &&
                !live.read().some((t) => t.backendId === backendId && t.id === activeTaskId);
            useTaskStore.setState({
                tasks: live.read(),
                activeTaskId: vanished ? null : activeTaskId,
            });
        } finally {
            set({ loading: false });
        }
    },
    async fetchArchivedTasks(backendId) {
        const landed = await archived.load(backendId, () =>
            requestTasks(backendId, MSG.TASK_LIST_ARCHIVED),
        );
        if (landed) publish();
    },
    setShowArchive(show) {
        set({ showArchive: show });
        if (!show) return;
        // The archive view lists every machine the live list does.
        for (const backendId of live.backends()) {
            useTaskStore
                .getState()
                .fetchArchivedTasks(backendId)
                .catch(() => {});
        }
    },
    async createTask(backendId, payload) {
        const task = await sendRequest<Task>(backendId, MSG.TASK_CREATE, payload);
        const scoped = { ...task, backendId };
        // TASK_CREATE does not broadcast to its sender, so this response is the
        // only write. Going through `apply` is what makes a TASK_LIST already
        // in flight land with it replayed rather than erase it.
        live.apply(backendId, (items) =>
            items.some((t) => t.id === task.id)
                ? items
                : sortTasksByCreatedAtDesc([...items, scoped]),
        );
        publish();
        return scoped;
    },
    async updateTask(task, updates) {
        const updated = await sendRequest<Task>(task.backendId, MSG.TASK_UPDATE, {
            id: task.id,
            ...updates,
        });
        applyTaskUpdate(task.backendId, updated);
    },
    async archiveTask(task) {
        await sendRequest(task.backendId, MSG.TASK_ARCHIVE, { id: task.id });
        const activeTaskId = activeTaskAfterRemoving(task.id);
        live.apply(task.backendId, (items) => withoutTaskFamily(items, task.id));
        useTaskStore.setState({ tasks: live.read(), activeTaskId });
        if (useTaskStore.getState().showArchive) {
            useTaskStore
                .getState()
                .fetchArchivedTasks(task.backendId)
                .catch(() => {});
        }
    },
    async unarchiveTask(task) {
        await sendRequest(task.backendId, MSG.TASK_UNARCHIVE, { id: task.id });
        archived.apply(task.backendId, (items) => withoutTaskFamily(items, task.id));
        publish();
        useTaskStore
            .getState()
            .fetchTasks(task.backendId)
            .catch(() => {});
    },
    async deleteTask(task, options) {
        await sendRequest(task.backendId, MSG.TASK_DELETE, {
            id: task.id,
            deleteWorktree: options?.deleteWorktree,
        });
        const activeTaskId = activeTaskAfterRemoving(task.id);
        live.apply(task.backendId, (items) => withoutTaskFamily(items, task.id));
        archived.apply(task.backendId, (items) => withoutTaskFamily(items, task.id));
        useTaskStore.setState({
            tasks: live.read(),
            archivedTasks: archived.read(),
            activeTaskId,
        });
    },
    setActiveTask(id) {
        set({ activeTaskId: id });
    },
    async fetchTaskLog(task) {
        const { entries } = await sendRequest<TaskLogListResponse>(
            task.backendId,
            MSG.TASK_LOG_LIST,
            { taskId: task.id },
        );
        set((s) => ({
            taskLogs: { ...s.taskLogs, [task.id]: entries },
        }));
    },
    appendLogEntry(taskId, entry) {
        set((s) => ({
            taskLogs: {
                ...s.taskLogs,
                [taskId]: [...(s.taskLogs[taskId] ?? []), entry],
            },
        }));
    },
}));

function applyTaskUpdate(backendId: string, task: Task): void {
    live.apply(backendId, (items) =>
        sortTasksByCreatedAtDesc(items.map((t) => (t.id === task.id ? { ...task, backendId } : t))),
    );
    publish();
}

registerBackendReset("task-store", (backendId) => {
    const dropped = new Set(
        [...live.read(), ...archived.read()]
            .filter((t) => t.backendId === backendId)
            .map((t) => t.id),
    );
    live.drop(backendId);
    archived.drop(backendId);
    useTaskStore.setState((s) => ({
        tasks: live.read(),
        archivedTasks: archived.read(),
        taskLogs: Object.fromEntries(
            Object.entries(s.taskLogs).filter(([taskId]) => !dropped.has(taskId)),
        ),
    }));
});

function isTask(payload: unknown): payload is Task {
    return !!payload && typeof payload === "object" && "id" in payload;
}

// Listen for task updates from the HTTP API (e.g., title generation).
// Module-level listener — singleton store, registered once.
const _unsubTaskUpdated = onEvent(MSG.TASK_UPDATED, (payload, backendId) => {
    if (isTask(payload)) applyTaskUpdate(backendId, payload);
});

const _unsubTaskCreated = onEvent(MSG.TASK_CREATED, (payload, backendId) => {
    if (!isTask(payload)) return;
    const task = payload;
    // Avoid duplicates (e.g., if the current client created the task via WS)
    if (live.read().some((t) => t.backendId === backendId && t.id === task.id)) return;
    live.apply(backendId, (items) => sortTasksByCreatedAtDesc([...items, { ...task, backendId }]));
    publish();
});

// Task ids are UUIDs, so a log entry cannot land on another machine's task.
const _unsubTaskLogAdded = onEvent(MSG.TASK_LOG_ADDED, (payload) => {
    const event = payload as TaskLogAddedEvent;
    if (event?.taskId && event?.entry) {
        useTaskStore.getState().appendLogEntry(event.taskId, event.entry);
    }
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubTaskUpdated();
        _unsubTaskCreated();
        _unsubTaskLogAdded();
    });
}

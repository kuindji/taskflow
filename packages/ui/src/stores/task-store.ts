import { create } from "zustand";
import type { Task, TaskLogEntry, TaskLogAddedEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface TaskStore {
    tasks: Task[];
    archivedTasks: Task[];
    showArchive: boolean;
    activeTaskId: string | null;
    loading: boolean;
    taskLogs: Record<string, TaskLogEntry[]>;
    fetchTasks(): Promise<void>;
    fetchArchivedTasks(): Promise<void>;
    setShowArchive(show: boolean): void;
    createTask(payload: {
        projectId: string;
        title?: string;
        description: string;
        worktree?: boolean;
        parentId?: string;
    }): Promise<Task>;
    applyTaskUpdate(task: Task): void;
    updateTask(id: string, updates: Partial<Task>): Promise<void>;
    archiveTask(id: string): Promise<void>;
    unarchiveTask(id: string): Promise<void>;
    deleteTask(id: string, options?: { deleteWorktree?: boolean }): Promise<void>;
    setActiveTask(id: string | null): void;
    fetchTaskLog(taskId: string): Promise<void>;
    appendLogEntry(taskId: string, entry: TaskLogEntry): void;
}

function getCreatedAtTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortTasksByCreatedAtDesc(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const aPinned = a.pinned ? 1 : 0;
        const bPinned = b.pinned ? 1 : 0;
        if (aPinned !== bPinned) {
            return bPinned - aPinned;
        }

        const createdAtDiff =
            getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
        if (createdAtDiff !== 0) {
            return createdAtDiff;
        }

        return a.id.localeCompare(b.id);
    });
}

export const useTaskStore = create<TaskStore>((set) => ({
    tasks: [],
    archivedTasks: [],
    showArchive: false,
    activeTaskId: null,
    loading: false,
    taskLogs: {},
    async fetchTasks() {
        set({ loading: true });
        try {
            const { tasks } = await sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST);
            const sortedTasks = sortTasksByCreatedAtDesc(tasks);
            set((state) => ({
                tasks: sortedTasks,
                loading: false,
                activeTaskId: sortedTasks.some((task) => task.id === state.activeTaskId)
                    ? state.activeTaskId
                    : null,
            }));
        } catch {
            set({ loading: false });
        }
    },
    async fetchArchivedTasks() {
        const { tasks } = await sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST_ARCHIVED);
        set({ archivedTasks: sortTasksByCreatedAtDesc(tasks) });
    },
    setShowArchive(show) {
        set({ showArchive: show });
        if (show) {
            void useTaskStore.getState().fetchArchivedTasks();
        }
    },
    async createTask(payload) {
        const task = await sendRequest<Task>(MSG.TASK_CREATE, payload);
        set((s) => ({
            tasks: sortTasksByCreatedAtDesc([...s.tasks, task]),
        }));
        return task;
    },
    applyTaskUpdate(task) {
        set((s) => ({
            tasks: sortTasksByCreatedAtDesc(s.tasks.map((t) => (t.id === task.id ? task : t))),
        }));
    },
    async updateTask(id, updates) {
        const updated = await sendRequest<Task>(MSG.TASK_UPDATE, { id, ...updates });
        set((s) => ({
            tasks: sortTasksByCreatedAtDesc(s.tasks.map((t) => (t.id === id ? updated : t))),
        }));
    },
    async archiveTask(id) {
        await sendRequest(MSG.TASK_ARCHIVE, { id });
        set((s) => ({
            tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id),
            activeTaskId:
                s.activeTaskId === id ||
                s.tasks.some((t) => t.parentId === id && t.id === s.activeTaskId)
                    ? null
                    : s.activeTaskId,
        }));
        if (useTaskStore.getState().showArchive) {
            void useTaskStore.getState().fetchArchivedTasks();
        }
    },
    async unarchiveTask(id) {
        await sendRequest(MSG.TASK_UNARCHIVE, { id });
        set((s) => ({
            archivedTasks: s.archivedTasks.filter((t) => t.id !== id && t.parentId !== id),
        }));
        void useTaskStore.getState().fetchTasks();
    },
    async deleteTask(id, options) {
        await sendRequest(MSG.TASK_DELETE, { id, deleteWorktree: options?.deleteWorktree });
        set((s) => ({
            tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id),
            archivedTasks: s.archivedTasks.filter((t) => t.id !== id && t.parentId !== id),
            activeTaskId:
                s.activeTaskId === id ||
                s.tasks.some((t) => t.parentId === id && t.id === s.activeTaskId)
                    ? null
                    : s.activeTaskId,
        }));
    },
    setActiveTask(id) {
        set({ activeTaskId: id });
    },
    async fetchTaskLog(taskId) {
        const { entries } = await sendRequest<{ entries: TaskLogEntry[] }>(MSG.TASK_LOG_LIST, {
            taskId,
        });
        set((s) => ({
            taskLogs: { ...s.taskLogs, [taskId]: entries },
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

// Listen for task updates from the HTTP API (e.g., title generation).
// Module-level listener — singleton store, registered once.
const _unsubTaskUpdated = onEvent(MSG.TASK_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        useTaskStore.getState().applyTaskUpdate(payload as Task);
    }
});

const _unsubTaskCreated = onEvent(MSG.TASK_CREATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        const task = payload as Task;
        const state = useTaskStore.getState();
        // Avoid duplicates (e.g., if the current client created the task via WS)
        if (!state.tasks.some((t) => t.id === task.id)) {
            useTaskStore.setState({
                tasks: sortTasksByCreatedAtDesc([...state.tasks, task]),
            });
        }
    }
});

const _unsubTaskLogAdded = onEvent(MSG.TASK_LOG_ADDED, (payload) => {
    const event = payload as TaskLogAddedEvent;
    if (event?.taskId && event?.entry) {
        useTaskStore.getState().appendLogEntry(event.taskId, event.entry);
    }
});

import { create } from "zustand";
import type { Task, TaskLogEntry, TaskLogAddedEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface TaskStore {
    tasks: Task[];
    activeTaskId: string | null;
    loading: boolean;
    taskLogs: Record<string, TaskLogEntry[]>;
    fetchTasks(): Promise<void>;
    createTask(payload: {
        projectId: string;
        title?: string;
        description: string;
        worktree?: boolean;
    }): Promise<Task>;
    applyTaskUpdate(task: Task): void;
    updateTask(id: string, updates: Partial<Task>): Promise<void>;
    archiveTask(id: string): Promise<void>;
    deleteTask(id: string): Promise<void>;
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
        const createdAtDiff = getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
        if (createdAtDiff !== 0) {
            return createdAtDiff;
        }

        return a.id.localeCompare(b.id);
    });
}

export const useTaskStore = create<TaskStore>((set) => ({
    tasks: [],
    activeTaskId: null,
    loading: false,
    taskLogs: {},
    async fetchTasks() {
        set({ loading: true });
        const { tasks } = await sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST);
        const sortedTasks = sortTasksByCreatedAtDesc(tasks);
        set((state) => ({
            tasks: sortedTasks,
            loading: false,
            activeTaskId: sortedTasks.some((task) => task.id === state.activeTaskId)
                ? state.activeTaskId
                : null,
        }));
    },
    async createTask(payload) {
        const task = await sendRequest<Task>(MSG.TASK_CREATE, payload);
        set((s) => ({ tasks: sortTasksByCreatedAtDesc([...s.tasks, task]) }));
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
            tasks: s.tasks.filter((t) => t.id !== id),
            activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
        }));
    },
    async deleteTask(id) {
        await sendRequest(MSG.TASK_DELETE, { id });
        set((s) => ({
            tasks: s.tasks.filter((t) => t.id !== id),
            activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
        }));
    },
    setActiveTask(id) {
        set({ activeTaskId: id });
    },
    async fetchTaskLog(taskId) {
        const { entries } = await sendRequest<{ entries: TaskLogEntry[] }>(MSG.TASK_LOG_LIST, { taskId });
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

const _unsubTaskLogAdded = onEvent(MSG.TASK_LOG_ADDED, (payload) => {
    const event = payload as TaskLogAddedEvent;
    if (event?.taskId && event?.entry) {
        useTaskStore.getState().appendLogEntry(event.taskId, event.entry);
    }
});

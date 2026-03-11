import { create } from "zustand";
import type { Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface TaskStore {
    tasks: Task[];
    activeTaskId: string | null;
    loading: boolean;
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
}

export const useTaskStore = create<TaskStore>((set) => ({
    tasks: [],
    activeTaskId: null,
    loading: false,
    async fetchTasks() {
        set({ loading: true });
        const { tasks } = await sendRequest<{ tasks: Task[] }>(MSG.TASK_LIST);
        set((state) => ({
            tasks,
            loading: false,
            activeTaskId: tasks.some((task) => task.id === state.activeTaskId) ? state.activeTaskId : null,
        }));
    },
    async createTask(payload) {
        const task = await sendRequest<Task>(MSG.TASK_CREATE, payload);
        set((s) => ({ tasks: [...s.tasks, task] }));
        return task;
    },
    applyTaskUpdate(task) {
        set((s) => ({
            tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
        }));
    },
    async updateTask(id, updates) {
        const updated = await sendRequest<Task>(MSG.TASK_UPDATE, { id, ...updates });
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? updated : t)) }));
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
}));

// Listen for task updates from the HTTP API (e.g., title generation).
// Module-level listener — singleton store, registered once.
const _unsubTaskUpdated = onEvent(MSG.TASK_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        useTaskStore.getState().applyTaskUpdate(payload as Task);
    }
});

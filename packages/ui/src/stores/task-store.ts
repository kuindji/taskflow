import { create } from 'zustand';
import type { Task } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../hooks/useWebSocket';

interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null;
  loading: boolean;
  fetchTasks(): Promise<void>;
  createTask(projectId: string, title: string): Promise<Task>;
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
    set({ tasks, loading: false });
  },
  async createTask(projectId, title) {
    const task = await sendRequest<Task>(MSG.TASK_CREATE, { projectId, title });
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
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
  setActiveTask(id) { set({ activeTaskId: id }); },
}));

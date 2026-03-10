import { create } from 'zustand';
import type { Project } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../hooks/useWebSocket';

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  fetchProjects(): Promise<void>;
  addProject(name: string | undefined, path: string): Promise<Project>;
  removeProject(id: string): Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  loading: false,
  async fetchProjects() {
    set({ loading: true });
    const { projects } = await sendRequest<{ projects: Project[] }>(MSG.PROJECT_LIST);
    set({ projects, loading: false });
  },
  async addProject(name, path) {
    const project = await sendRequest<Project>(MSG.PROJECT_ADD, { name, path });
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },
  async removeProject(id) {
    await sendRequest(MSG.PROJECT_REMOVE, { id });
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));

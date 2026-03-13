import { create } from "zustand";
import type { Project } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";

interface ProjectStore {
    projects: Project[];
    loading: boolean;
    fetchProjects(): Promise<void>;
    addProject(path: string): Promise<Project>;
    updateProject(id: string, updates: { name?: string; path?: string }): Promise<Project>;
    removeProject(id: string): Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
    projects: [],
    loading: false,
    async fetchProjects() {
        set({ loading: true });
        const { projects } = await sendRequest<{ projects: Project[] }>(MSG.PROJECT_LIST);
        set({ projects, loading: false });
        const activeProjectId = useUIStore.getState().activeProjectId;
        if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
            useUIStore.getState().setActiveProject(null);
        }
    },
    async addProject(path) {
        const project = await sendRequest<Project>(MSG.PROJECT_ADD, { path });
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
    },
    async updateProject(id, updates) {
        const project = await sendRequest<Project>(MSG.PROJECT_UPDATE, { id, ...updates });
        set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? project : p)),
        }));
        return project;
    },
    async removeProject(id) {
        await sendRequest(MSG.PROJECT_REMOVE, { id });
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
        if (useUIStore.getState().activeProjectId === id) {
            useUIStore.getState().setActiveProject(null);
        }
        await useTaskStore.getState().fetchTasks();
    },
}));

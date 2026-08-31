import { create } from "zustand";
import type {
    LinkedProject,
    Project,
    ProjectForkResponse,
    ProjectListResponse,
} from "@taskflow/shared";
import { MSG, orderProjectsByIds } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";

interface ProjectStore {
    projects: Project[];
    loading: boolean;
    showArchivedProjects: boolean;
    fetchProjects(): Promise<void>;
    addProject(path: string): Promise<Project>;
    updateProject(
        id: string,
        updates: {
            name?: string;
            path?: string;
            hidden?: boolean;
            defaultInitCommand?: string;
            prompt?: string;
            linkedProjects?: LinkedProject[];
        },
    ): Promise<Project>;
    setShowArchivedProjects(show: boolean): void;
    archiveProject(id: string): Promise<void>;
    unarchiveProject(id: string): Promise<void>;
    removeProject(id: string): Promise<void>;
    forkProject(
        projectId: string,
        branch: string,
        folderName?: string,
    ): Promise<ProjectForkResponse>;
    reorderProjects(orderedIds: string[]): Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
    projects: [],
    loading: false,
    showArchivedProjects: false,
    async fetchProjects() {
        set({ loading: true });
        try {
            const { projects } = await sendRequest<ProjectListResponse>(MSG.PROJECT_LIST);
            set({ projects, loading: false });
            const activeProjectId = useUIStore.getState().activeProjectId;
            if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
                useUIStore.getState().setActiveProject(null);
            }
        } catch {
            set({ loading: false });
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
    setShowArchivedProjects(show) {
        set({ showArchivedProjects: show });
    },
    async archiveProject(id) {
        const project = await sendRequest<Project>(MSG.PROJECT_UPDATE, { id, hidden: true });
        set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? project : p)),
        }));
        if (
            !useProjectStore.getState().showArchivedProjects &&
            useUIStore.getState().activeProjectId === id
        ) {
            useUIStore.getState().setActiveProject(null);
        }
    },
    async unarchiveProject(id) {
        const project = await sendRequest<Project>(MSG.PROJECT_UPDATE, { id, hidden: false });
        set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? project : p)),
        }));
    },
    async removeProject(id) {
        await sendRequest(MSG.PROJECT_REMOVE, { id });
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
        if (useUIStore.getState().activeProjectId === id) {
            useUIStore.getState().setActiveProject(null);
        }
        useUIStore.getState().setProjectCollapsed(id, false);
        await useTaskStore.getState().fetchTasks();
    },
    async forkProject(projectId, branch, folderName) {
        const response = await sendRequest<ProjectForkResponse>(MSG.PROJECT_FORK, {
            projectId,
            branch,
            folderName,
        });
        set((s) => ({ projects: [...s.projects, response.project] }));
        return response;
    },
    async reorderProjects(orderedIds) {
        // Optimistic local reorder, then confirm with the server.
        set((s) => ({ projects: orderProjectsByIds(s.projects, orderedIds) }));
        const { projects } = await sendRequest<ProjectListResponse>(MSG.PROJECT_REORDER, {
            orderedIds,
        });
        set({ projects });
    },
}));

// Listen for new projects broadcast by the backend (e.g., added via CLI).
const _unsubProjectCreated = onEvent(MSG.PROJECT_CREATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        const project = payload as Project;
        const state = useProjectStore.getState();
        if (!state.projects.some((p) => p.id === project.id)) {
            useProjectStore.setState({ projects: [...state.projects, project] });
        }
    }
});

// Listen for project removals broadcast by the backend (e.g., removed via CLI).
const _unsubProjectRemoved = onEvent(MSG.PROJECT_REMOVED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        const { id } = payload as { id: string };
        const state = useProjectStore.getState();
        useProjectStore.setState({ projects: state.projects.filter((p) => p.id !== id) });
        if (useUIStore.getState().activeProjectId === id) {
            useUIStore.getState().setActiveProject(null);
        }
    }
});

// Listen for project updates broadcast by the backend (e.g., new session added by a flow step).
const _unsubProjectUpdated = onEvent(MSG.PROJECT_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        const project = payload as Project;
        const state = useProjectStore.getState();
        useProjectStore.setState({
            projects: state.projects.map((p) => (p.id === project.id ? project : p)),
        });
    }
});

// Listen for project reorder broadcast from another window.
const _unsubProjectReordered = onEvent(MSG.PROJECT_REORDERED, (payload) => {
    if (payload && typeof payload === "object" && "orderedIds" in payload) {
        const { orderedIds } = payload as { orderedIds: string[] };
        const state = useProjectStore.getState();
        useProjectStore.setState({
            projects: orderProjectsByIds(state.projects, orderedIds),
        });
    }
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubProjectCreated();
        _unsubProjectRemoved();
        _unsubProjectUpdated();
        _unsubProjectReordered();
    });
}

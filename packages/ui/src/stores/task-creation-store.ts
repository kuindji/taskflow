import { create } from "zustand";
import { useProjectStore } from "./project-store";

interface TaskCreationStore {
    newTaskOpen: boolean;
    newProjectOpen: boolean;
    openTaskAfterProject: boolean;
    projectError: string | null;
    requestNewTask(): void;
    openProjectDialog(thenOpenTask?: boolean): void;
    setNewTaskOpen(open: boolean): void;
    setNewProjectOpen(open: boolean): void;
    setProjectError(error: string | null): void;
    handleProjectCreated(): void;
}

export const useTaskCreationStore = create<TaskCreationStore>((set) => ({
    newTaskOpen: false,
    newProjectOpen: false,
    openTaskAfterProject: false,
    projectError: null,
    requestNewTask() {
        const hasProjects = useProjectStore.getState().projects.length > 0;
        set({
            newTaskOpen: hasProjects,
            newProjectOpen: !hasProjects,
            openTaskAfterProject: !hasProjects,
            projectError: null,
        });
    },
    openProjectDialog(thenOpenTask = false) {
        set({
            newProjectOpen: true,
            newTaskOpen: false,
            openTaskAfterProject: thenOpenTask,
            projectError: null,
        });
    },
    setNewTaskOpen(open) {
        set({ newTaskOpen: open });
    },
    setNewProjectOpen(open) {
        set((state) => ({
            newProjectOpen: open,
            projectError: open ? state.projectError : null,
            openTaskAfterProject: open ? state.openTaskAfterProject : false,
        }));
    },
    setProjectError(error) {
        set({ projectError: error });
    },
    handleProjectCreated() {
        set((state) => ({
            newProjectOpen: false,
            newTaskOpen: state.openTaskAfterProject,
            openTaskAfterProject: false,
            projectError: null,
        }));
    },
}));

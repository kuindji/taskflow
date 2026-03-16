import { create } from "zustand";
import { useProjectStore } from "./project-store";

interface TaskCreationStore {
    newTaskOpen: boolean;
    newProjectOpen: boolean;
    openTaskAfterProject: boolean;
    projectError: string | null;
    parentTaskId: string | null;
    requestNewTask(): void;
    requestNewSubtask(parentTaskId: string): void;
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
    parentTaskId: null,
    requestNewTask() {
        const hasProjects = useProjectStore.getState().projects.length > 0;
        set({
            newTaskOpen: hasProjects,
            newProjectOpen: !hasProjects,
            openTaskAfterProject: !hasProjects,
            projectError: null,
            parentTaskId: null,
        });
    },
    requestNewSubtask(parentTaskId: string) {
        set({
            newTaskOpen: true,
            parentTaskId,
            newProjectOpen: false,
            openTaskAfterProject: false,
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
        set(open ? { newTaskOpen: open } : { newTaskOpen: open, parentTaskId: null });
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

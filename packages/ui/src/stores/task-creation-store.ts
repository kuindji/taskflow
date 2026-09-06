import { create } from "zustand";
import type { DroppedTask } from "@/lib/dropped-task";
import { useProjectStore } from "./project-store";

interface TaskCreationStore {
    newTaskOpen: boolean;
    newProjectOpen: boolean;
    openTaskAfterProject: boolean;
    projectError: string | null;
    parentTaskId: string | null;
    preferredProjectId: string | null;
    /** Fields the dialog opens with, when the request came from a drop. */
    prefill: DroppedTask | null;
    requestNewTask(projectId?: string): void;
    requestNewTaskWithPrefill(prefill: DroppedTask, projectId?: string): void;
    requestNewSubtask(parentTaskId: string): void;
    openProjectDialog(thenOpenTask?: boolean): void;
    setNewTaskOpen(open: boolean): void;
    setNewProjectOpen(open: boolean): void;
    setProjectError(error: string | null): void;
    handleProjectCreated(): void;
}

/**
 * With no projects yet, the request has to detour through the project dialog
 * first; `handleProjectCreated` picks the task dialog back up afterwards, and
 * carries `prefill` across that hop.
 */
function taskRequest(prefill: DroppedTask | null, projectId?: string) {
    const hasProjects = useProjectStore.getState().projects.length > 0;
    return {
        newTaskOpen: hasProjects,
        newProjectOpen: !hasProjects,
        openTaskAfterProject: !hasProjects,
        projectError: null,
        parentTaskId: null,
        preferredProjectId: projectId ?? null,
        prefill,
    };
}

export const useTaskCreationStore = create<TaskCreationStore>((set) => ({
    newTaskOpen: false,
    newProjectOpen: false,
    openTaskAfterProject: false,
    projectError: null,
    parentTaskId: null,
    preferredProjectId: null,
    prefill: null,
    requestNewTask(projectId) {
        set(taskRequest(null, projectId));
    },
    requestNewTaskWithPrefill(prefill, projectId) {
        set(taskRequest(prefill, projectId));
    },
    requestNewSubtask(parentTaskId: string) {
        set({
            newTaskOpen: true,
            parentTaskId,
            newProjectOpen: false,
            openTaskAfterProject: false,
            projectError: null,
            preferredProjectId: null,
            prefill: null,
        });
    },
    openProjectDialog(thenOpenTask = false) {
        set({
            newProjectOpen: true,
            newTaskOpen: false,
            openTaskAfterProject: thenOpenTask,
            projectError: null,
            preferredProjectId: null,
            prefill: null,
        });
    },
    setNewTaskOpen(open) {
        set(
            open
                ? { newTaskOpen: open }
                : {
                      newTaskOpen: open,
                      parentTaskId: null,
                      preferredProjectId: null,
                      prefill: null,
                  },
        );
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
        // `prefill` is deliberately left alone: a drop made with no projects yet
        // opens this dialog first, and the dropped text has to survive the hop.
        set((state) => ({
            newProjectOpen: false,
            newTaskOpen: state.openTaskAfterProject,
            openTaskAfterProject: false,
            projectError: null,
        }));
    },
}));

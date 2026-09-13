import { create } from "zustand";
import type { FlowDefinition, Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import type { DroppedTask } from "@/lib/dropped-task";
import { filterByProject } from "./flow-store";
import { useProjectStore } from "./project-store";

/**
 * The machine a new task is created on. A subtask's parent decides it: the
 * backend takes a subtask's project from the parent and ignores the dialog's,
 * which can be a project on another machine.
 */
export function taskCreationBackend(
    request: { projectId: string; parentId?: string },
    projects: Scoped<Project>[],
    tasks: Scoped<Task>[],
): string {
    if (request.parentId) {
        const parent = tasks.find((t) => t.id === request.parentId);
        if (!parent) throw new Error(`Unknown parent task ${request.parentId}`);
        return parent.backendId;
    }
    const project = projects.find((p) => p.id === request.projectId);
    if (!project) throw new Error(`Unknown project ${request.projectId}`);
    return project.backendId;
}

/**
 * The flows a new task can start with. The flow starts on the task's machine,
 * which resolves the id locally, so only that machine's flows for the task's
 * project are offered — a subtask's parent's, like its machine.
 */
export function taskCreationFlows(
    request: { projectId: string; parentId?: string },
    projects: Scoped<Project>[],
    tasks: Scoped<Task>[],
    flows: Scoped<FlowDefinition>[],
): Scoped<FlowDefinition>[] {
    if (request.parentId) {
        const parent = tasks.find((t) => t.id === request.parentId);
        return parent ? filterByProject(flows, parent.projectId, parent.backendId) : [];
    }
    const project = projects.find((p) => p.id === request.projectId);
    return project ? filterByProject(flows, project.id, project.backendId) : [];
}

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

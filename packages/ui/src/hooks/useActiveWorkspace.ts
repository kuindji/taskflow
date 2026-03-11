import { useMemo } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";

export function getTaskWorkspaceKey(taskId: string): string {
    return `task:${taskId}`;
}

export function getProjectWorkspaceKey(projectId: string): string {
    return `project:${projectId}`;
}

export function useActiveWorkspace() {
    const tasks = useTaskStore((s) => s.tasks);
    const projects = useProjectStore((s) => s.projects);
    const activeTaskId = useTaskStore((s) => s.activeTaskId);
    const activeProjectId = useUIStore((s) => s.activeProjectId);

    return useMemo(() => {
        const task = activeTaskId ? tasks.find((entry) => entry.id === activeTaskId) ?? null : null;
        const project = task
            ? projects.find((entry) => entry.id === task.projectId) ?? null
            : activeProjectId
              ? projects.find((entry) => entry.id === activeProjectId) ?? null
              : null;

        if (task && project) {
            const workingDir =
                task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
            return {
                scope: "task" as const,
                task,
                project,
                workingDir,
                workspaceKey: getTaskWorkspaceKey(task.id),
            };
        }

        if (project) {
            return {
                scope: "project" as const,
                task: null,
                project,
                workingDir: project.path,
                workspaceKey: getProjectWorkspaceKey(project.id),
            };
        }

        return {
            scope: null,
            task: null,
            project: null,
            workingDir: null,
            workspaceKey: null,
        };
    }, [activeProjectId, activeTaskId, projects, tasks]);
}

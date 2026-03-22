import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { MSG } from "@taskflow/shared";
import type { SystemInfoResponse } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

export function getTaskWorkspaceKey(taskId: string): string {
    return `task:${taskId}`;
}

export function getProjectWorkspaceKey(projectId: string): string {
    return `project:${projectId}`;
}

export const MASTER_WORKSPACE_KEY = "master";

let cachedHomedir: string | null = null;

// Pre-fetch homedir as early as possible so it's ready before master workspace is activated.
// Called once when the module loads; subsequent calls to useHomedir() return the cached value instantly.
export function prefetchHomedir(): void {
    if (cachedHomedir) return;
    sendRequest<SystemInfoResponse>(MSG.SYSTEM_INFO, {})
        .then((res) => {
            cachedHomedir = res.homedir;
        })
        .catch(() => {});
}

export function useHomedir(): string | null {
    const [homedir, setHomedir] = useState<string | null>(cachedHomedir);

    useEffect(() => {
        if (cachedHomedir) {
            setHomedir(cachedHomedir);
            return;
        }
        sendRequest<SystemInfoResponse>(MSG.SYSTEM_INFO, {})
            .then((res) => {
                cachedHomedir = res.homedir;
                setHomedir(res.homedir);
            })
            .catch(() => {});
    }, []);

    return homedir;
}

export function useActiveWorkspace() {
    const tasks = useTaskStore((s) => s.tasks);
    const projects = useProjectStore((s) => s.projects);
    const activeTaskId = useTaskStore((s) => s.activeTaskId);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const masterWorkspaceActive = useUIStore((s) => s.masterWorkspaceActive);
    const homedir = useHomedir();

    return useMemo(() => {
        if (masterWorkspaceActive) {
            return {
                scope: "master" as const,
                task: null,
                project: null,
                workingDir: homedir ?? null,
                workspaceKey: MASTER_WORKSPACE_KEY,
            };
        }

        const task = activeTaskId
            ? (tasks.find((entry) => entry.id === activeTaskId) ?? null)
            : null;
        const project = task
            ? (projects.find((entry) => entry.id === task.projectId) ?? null)
            : activeProjectId
              ? (projects.find((entry) => entry.id === activeProjectId) ?? null)
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
    }, [activeProjectId, activeTaskId, masterWorkspaceActive, homedir, projects, tasks]);
}

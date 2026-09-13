import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { MSG } from "@taskflow/shared";
import type { SystemInfoResponse } from "@taskflow/shared";
import { getPrimary, onPrimaryChange, sendRequest } from "@/lib/connection-registry";
import { createPerBackendCache } from "@/lib/per-backend-cache";

export function getTaskWorkspaceKey(taskId: string): string {
    return `task:${taskId}`;
}

export function getProjectWorkspaceKey(projectId: string): string {
    return `project:${projectId}`;
}

export const MASTER_WORKSPACE_KEY = "master";

/**
 * The machine a workspace (or pane) key's record lives on; master is
 * primary's. For code that holds a key rather than a record.
 */
export function workspaceBackendId(workspaceKey: string): string | null {
    const key = workspaceKey.endsWith(":right")
        ? workspaceKey.slice(0, -":right".length)
        : workspaceKey;
    if (key === MASTER_WORKSPACE_KEY) return getPrimary();
    if (key.startsWith("task:")) {
        const id = key.slice("task:".length);
        return useTaskStore.getState().tasks.find((t) => t.id === id)?.backendId ?? null;
    }
    if (key.startsWith("project:")) {
        const id = key.slice("project:".length);
        return useProjectStore.getState().projects.find((p) => p.id === id)?.backendId ?? null;
    }
    return null;
}

const homedirCache = createPerBackendCache(
    (backendId) =>
        sendRequest<SystemInfoResponse>(backendId, MSG.SYSTEM_INFO, {}).then((res) => res.homedir),
    "homedir-cache",
);

/** Fetch a machine's home directory ahead of the master workspace needing it. */
export function prefetchHomedir(backendId: string): void {
    homedirCache.get(backendId).catch(() => {});
}

function useHomedir(backendId: string | null): string | null {
    const [homedir, setHomedir] = useState<string | null>(() =>
        backendId ? homedirCache.peek(backendId) : null,
    );

    useEffect(() => {
        if (!backendId) {
            setHomedir(null);
            return;
        }
        let cancelled = false;
        setHomedir(homedirCache.peek(backendId));
        homedirCache.get(backendId).then(
            (next) => {
                if (!cancelled) setHomedir(next);
            },
            () => {},
        );
        return () => {
            cancelled = true;
        };
    }, [backendId]);

    return homedir;
}

export function useActiveWorkspace() {
    const tasks = useTaskStore((s) => s.tasks);
    const projects = useProjectStore((s) => s.projects);
    const activeTaskId = useTaskStore((s) => s.activeTaskId);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const masterWorkspaceActive = useUIStore((s) => s.masterWorkspaceActive);
    // The master workspace is primary's, so its working directory is primary's home.
    const primaryId = useSyncExternalStore(onPrimaryChange, getPrimary);
    const homedir = useHomedir(primaryId);

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

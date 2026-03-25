import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";

function getWorkspaceKey(taskId?: string, projectId?: string, master?: boolean): string | null {
    if (taskId) return getTaskWorkspaceKey(taskId);
    if (projectId) return getProjectWorkspaceKey(projectId);
    if (master) return "master";
    return null;
}

function getWorkingDir(taskId?: string, projectId?: string, master?: boolean): string | null {
    if (taskId) {
        const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
        if (!task) return null;
        const project = useProjectStore.getState().projects.find((p) => p.id === task.projectId);
        if (!project) return null;
        return task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
    }
    if (projectId) {
        const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
        return project?.path ?? null;
    }
    if (master) {
        return null;
    }
    return null;
}

function openUrlInApp(url: string, workspaceKey: string | null) {
    if (!workspaceKey) return;
    const store = useSessionStore.getState();
    const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const existing = existingTabs.find((t) => t.type === "browser" && t.url === url);
    if (existing) {
        store.setActiveTab(workspaceKey, existing.id);
        return;
    }
    let label = url;
    try {
        const parsed = new URL(url);
        label = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
    } catch {
        /* keep raw url as label */
    }
    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: "browser",
        label,
        url,
    });
}

function openExternalUrl(url: string) {
    if (window.taskflow) {
        void window.taskflow.openExternalUrl(url);
    } else {
        window.open(url, "_blank");
    }
}

function openExternalFile(filePath: string, opts?: { line?: number; col?: number }) {
    if (window.taskflow) {
        const editor = useSettingsStore.getState().settings?.editor.externalEditor;
        void window.taskflow.openExternalFile(filePath, { ...opts, editor });
    }
}

function createWebLinkHandler(taskId?: string, projectId?: string, master?: boolean) {
    const workspaceKey = getWorkspaceKey(taskId, projectId, master);
    return (event: MouseEvent, uri: string) => {
        if (event.metaKey || event.ctrlKey) {
            openExternalUrl(uri);
        } else {
            openUrlInApp(uri, workspaceKey);
        }
    };
}

export {
    getWorkspaceKey,
    getWorkingDir,
    openUrlInApp,
    openExternalUrl,
    openExternalFile,
    createWebLinkHandler,
};

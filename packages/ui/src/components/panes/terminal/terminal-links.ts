import { browserTabLabel, type SessionOwnerRef } from "@taskflow/shared";
import { openHostedBrowserTab } from "@/lib/hosted-browser";
import { findSessionTab, useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useBackendStore } from "@/stores/backend-store";
import {
    getTaskWorkspaceKey,
    getProjectWorkspaceKey,
    workspaceBackendId,
    workspaceOwner,
} from "@/hooks/useActiveWorkspace";
import {
    fileUriToPath,
    nativePath,
    pathFlavour,
    quoteDialect,
    relativeTo,
    shellQuote,
    type PathFlavour,
} from "@/lib/path-flavour";

function getWorkspaceKey(taskId?: string, projectId?: string, master?: boolean): string | null {
    if (taskId) return getTaskWorkspaceKey(taskId);
    if (projectId) return getProjectWorkspaceKey(projectId);
    if (master) return "master";
    return null;
}

function ownerWorkingDir(taskId?: string, projectId?: string, master?: boolean): string | null {
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

/** The session's own cwd wherever its tab now is, else its owner's directory. */
function getWorkingDir(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string | null {
    return findSessionTab(sessionId)?.tab.cwd ?? ownerWorkingDir(taskId, projectId, master);
}

/** How the machine with this id spells paths, from what its handshake reported. */
function backendPathFlavour(backendId: string | null): PathFlavour {
    return pathFlavour(useBackendStore.getState().machines.find((m) => m.id === backendId)?.os);
}

interface SessionDrop {
    flavour: PathFlavour;
    root: string | null;
    quote: (text: string) => string;
}

function sessionDrop(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): SessionDrop {
    const { workspaceKey } = sessionWorkspace(sessionId, taskId, projectId, master);
    const flavour = backendPathFlavour(workspaceKey ? workspaceBackendId(workspaceKey) : null);
    const dialect = quoteDialect(flavour, findSessionTab(sessionId)?.tab.shell);
    return {
        flavour,
        root: getWorkingDir(sessionId, taskId, projectId, master),
        quote: (text) => shellQuote(text, dialect),
    };
}

/**
 * Relative to the session's own cwd when it lies inside it, else absolute;
 * as the shell spells it either way. The explorer's Windows paths use
 * forward slashes, which cmd reads as switches.
 */
function relativeDropPath(drop: SessionDrop, absolutePath: string): string {
    const relative = drop.root ? relativeTo(drop.root, absolutePath, drop.flavour) : null;
    return relative ? relative : nativePath(absolutePath, drop.flavour);
}

/**
 * What dropping these paths types into the session's terminal: each made
 * relative where it can be and quoted for the session's shell, space-joined.
 */
function droppedPaths(
    absolutePaths: string[],
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string {
    const drop = sessionDrop(sessionId, taskId, projectId, master);
    return absolutePaths.map((path) => drop.quote(relativeDropPath(drop, path))).join(" ");
}

/** As `droppedPaths`, for the `file:` URIs of a `text/uri-list`; null when it has none. */
function droppedUris(
    uriList: string,
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string | null {
    const drop = sessionDrop(sessionId, taskId, projectId, master);
    const paths = uriList
        .split(/\r?\n/)
        .filter((line) => line.startsWith("file://"))
        .map((uri) => fileUriToPath(uri.trim(), drop.flavour))
        .filter((path) => path !== null);
    if (paths.length === 0) return null;
    return paths.map((path) => drop.quote(relativeDropPath(drop, path))).join(" ");
}

/** Dropped plain text, quoted for the session's shell. */
function droppedText(
    text: string,
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string {
    return sessionDrop(sessionId, taskId, projectId, master).quote(text);
}

/**
 * The workspace (pane) key of the session's tab now, else the one its
 * terminal was mounted with, and that workspace's owner ids.
 */
function sessionWorkspace(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): { workspaceKey: string | null; owner: SessionOwnerRef } {
    const workspaceKey =
        findSessionTab(sessionId)?.workspaceKey ?? getWorkspaceKey(taskId, projectId, master);
    return { workspaceKey, owner: workspaceKey ? workspaceOwner(workspaceKey) : {} };
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
    const hosted = openHostedBrowserTab(workspaceKey, url, browserTabLabel(url));
    if (hosted) {
        void hosted.catch(() => {});
        return;
    }
    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: "browser",
        label: browserTabLabel(url),
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

function createWebLinkHandler(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
) {
    return (event: MouseEvent, uri: string) => {
        if (event.metaKey || event.ctrlKey) {
            openExternalUrl(uri);
        } else {
            openUrlInApp(uri, sessionWorkspace(sessionId, taskId, projectId, master).workspaceKey);
        }
    };
}

export {
    getWorkingDir,
    backendPathFlavour,
    droppedPaths,
    droppedUris,
    droppedText,
    sessionWorkspace,
    openUrlInApp,
    openExternalUrl,
    openExternalFile,
    createWebLinkHandler,
};

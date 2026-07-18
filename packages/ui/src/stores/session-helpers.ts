import type { SessionRef } from "@taskflow/shared";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";
import { getProjectWorkspaceKey, getTaskWorkspaceKey } from "@/hooks/useActiveWorkspace";

interface Tab {
    id: string;
    type:
        | "claude"
        | "codex"
        | "opencode"
        | "gemini"
        | "cursor"
        | "pi"
        | "shell"
        | "editor"
        | "changes"
        | "history"
        | "browser"
        | "markdown";
    label: string;
    sessionId?: string;
    filePath?: string;
    url?: string;
    autoTitle?: boolean;
    trayExclude?: boolean;
}

function getDefaultSessionLabel(type: Tab["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "opencode") return "OpenCode";
    if (type === "gemini") return "Gemini";
    if (type === "cursor") return "Cursor";
    if (type === "pi") return "Pi";
    if (type === "editor") return "Editor";
    return `${type} session`;
}

function normalizeSessionLabel(type: Tab["type"], label?: string): string {
    if (!label || label === `${type} session` || (type === "editor" && label === "Editor")) {
        return getDefaultSessionLabel(type);
    }
    return label;
}

function createSessionTab(session: SessionRef): Tab {
    return {
        id: session.id,
        type: session.type,
        label: normalizeSessionLabel(session.type, session.label),
        sessionId: session.id,
        ...(session.type === "shell" && { autoTitle: true }),
        ...(session.trayExclude && { trayExclude: true }),
    };
}

const exitedSessions = new Set<string>();

function isSessionExited(sessionId: string): boolean {
    return exitedSessions.has(sessionId);
}

/** Whether the Electron/browser window is currently focused. */
let windowFocused = true;

function getWindowFocused(): boolean {
    return windowFocused;
}

function setWindowFocused(value: boolean): void {
    windowFocused = value;
}

/**
 * Check whether a session's tab is currently visible (active task + active tab + window focused).
 * Requires a getter for the session store to avoid circular imports.
 */
function isSessionFocused(
    sessionId: string,
    getSessionState: () => {
        activeTabByWorkspace: Record<string, string>;
        tabsByWorkspace: Record<string, Tab[]>;
    },
): boolean {
    if (!windowFocused) return false;
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const activeProjectId = useUIStore.getState().activeProjectId;
    const masterWorkspaceActive = useUIStore.getState().masterWorkspaceActive;
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : masterWorkspaceActive
            ? "master"
            : null;
    if (!workspaceKey) return false;
    const store = getSessionState();
    for (const key of [workspaceKey, `${workspaceKey}:right`]) {
        const activeTabId = store.activeTabByWorkspace[key];
        const tabs = store.tabsByWorkspace[key] ?? [];
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab?.sessionId === sessionId) return true;
    }
    return false;
}

function getSessionTab(
    sessionId: string,
    getSessionState: () => { tabsByWorkspace: Record<string, Tab[]> },
): Tab | undefined {
    const store = getSessionState();
    for (const tabs of Object.values(store.tabsByWorkspace)) {
        const tab = tabs.find((entry) => entry.sessionId === sessionId);
        if (tab) return tab;
    }
    return undefined;
}

function usesTerminalActivityStatus(
    sessionId: string,
    getSessionState: () => { tabsByWorkspace: Record<string, Tab[]> },
): boolean {
    const type = getSessionTab(sessionId, getSessionState)?.type;
    return (
        type === "claude" ||
        type === "codex" ||
        type === "opencode" ||
        type === "gemini" ||
        type === "cursor" ||
        type === "pi"
    );
}

export type { Tab };
export {
    getDefaultSessionLabel,
    normalizeSessionLabel,
    createSessionTab,
    exitedSessions,
    isSessionExited,
    isSessionFocused,
    getSessionTab,
    usesTerminalActivityStatus,
    getWindowFocused,
    setWindowFocused,
};

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
        | "pi"
        | "kimi"
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
    sessionState?: SessionRef["state"];
    resumeAvailable?: boolean;
    /** markdown tabs only — which pane the tab currently shows. Absent means "preview". */
    mode?: "preview" | "edit";
    /** markdown tabs only — scroll offset of the preview pane, restored across pane swaps. */
    previewScrollTop?: number;
    /** markdown tabs only — file paths visited in this tab, oldest first. */
    history?: string[];
    /** markdown tabs only — index into `history` of the currently shown file. */
    historyIndex?: number;
}

function getDefaultSessionLabel(type: Tab["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "opencode") return "OpenCode";
    if (type === "pi") return "Pi";
    if (type === "kimi") return "Kimi";
    if (type === "editor") return "Editor";
    return `${type} session`;
}

function normalizeSessionLabel(type: Tab["type"], label?: string): string {
    if (!label || label === `${type} session` || (type === "editor" && label === "Editor")) {
        return getDefaultSessionLabel(type);
    }
    return label;
}

const KNOWN_TAB_SESSION_TYPES: ReadonlySet<string> = new Set([
    "claude",
    "codex",
    "opencode",
    "pi",
    "kimi",
    "shell",
    "editor",
]);

/** Persisted stores may contain sessions of removed agent types (e.g. "gemini"); skip those. */
function isKnownSessionType(session: SessionRef): boolean {
    return KNOWN_TAB_SESSION_TYPES.has(session.type);
}

function createSessionTab(session: SessionRef): Tab {
    return {
        id: session.id,
        type: session.type,
        label: normalizeSessionLabel(session.type, session.label),
        sessionId: session.id,
        sessionState: session.state,
        resumeAvailable: session.state === "interrupted" && Boolean(session.nativeSessionId),
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
        type === "pi" ||
        type === "kimi"
    );
}

function labelForPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

/**
 * Move a markdown tab to `filePath`, truncating any forward entries. Returns
 * the original tab unchanged when the target is already shown, so Zustand
 * subscribers do not re-render on a redundant navigation.
 */
function pushHistory(tab: Tab, filePath: string): Tab {
    const history = tab.history ?? (tab.filePath ? [tab.filePath] : []);
    const index = tab.historyIndex ?? history.length - 1;
    if (history[index] === filePath) return tab;
    const nextHistory = [...history.slice(0, index + 1), filePath];
    return {
        ...tab,
        filePath,
        label: labelForPath(filePath),
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        previewScrollTop: 0,
    };
}

/** Step a markdown tab back (-1) or forward (+1) through its own history. */
function stepHistory(tab: Tab, delta: -1 | 1): Tab {
    const history = tab.history;
    if (!history || history.length === 0) return tab;
    const index = tab.historyIndex ?? history.length - 1;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= history.length) return tab;
    const filePath = history[nextIndex];
    return {
        ...tab,
        filePath,
        label: labelForPath(filePath),
        historyIndex: nextIndex,
        previewScrollTop: 0,
    };
}

export type { Tab };
export {
    pushHistory,
    stepHistory,
    getDefaultSessionLabel,
    normalizeSessionLabel,
    createSessionTab,
    isKnownSessionType,
    exitedSessions,
    isSessionExited,
    isSessionFocused,
    getSessionTab,
    usesTerminalActivityStatus,
    getWindowFocused,
    setWindowFocused,
};

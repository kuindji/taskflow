import { create } from "zustand";
import type {
    SessionRef,
    Task,
    BrowserOpenPayload,
    SessionStatus,
    SessionStatusEvent,
    TerminalOutputEvent,
    SessionExitedEvent,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, sendFireAndForget, onEvent } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";
import { useProjectStore } from "./project-store";
import { useUIStore } from "./ui-store";
import { getProjectWorkspaceKey, getTaskWorkspaceKey } from "@/hooks/useActiveWorkspace";

interface Tab {
    id: string;
    type: "claude" | "codex" | "shell" | "editor" | "changes" | "browser";
    label: string;
    sessionId?: string;
    filePath?: string;
    url?: string;
}

interface SessionStore {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
    sessionStatus: Partial<Record<string, SessionStatus>>;
    lastTerminalSize: { cols: number; rows: number } | null;
    createSession(
        owner: { taskId?: string; projectId?: string },
        type: "claude" | "codex" | "shell",
        label?: string,
        prompt?: string,
        shell?: string,
    ): Promise<string>;
    closeSession(sessionId: string): Promise<void>;
    sendInput(sessionId: string, data: string): void;
    resizeTerminal(sessionId: string, cols: number, rows: number): void;
    addTab(workspaceKey: string, tab: Tab): void;
    closeTab(workspaceKey: string, tabId: string): Promise<void>;
    setActiveTab(workspaceKey: string, tabId: string): void;
    setSessionStatus(sessionId: string, status?: SessionStatus): void;
    getTaskStatus(taskId: string): SessionStatus | undefined;
    getTabs(workspaceKey: string): Tab[];
    getActiveTab(workspaceKey: string): Tab | undefined;
    syncWithTasks(tasks: Task[]): void;
    syncWithProjects(projects: { id: string; sessions: SessionRef[] }[]): void;
}

export type { Tab };

function createSessionTab(session: SessionRef): Tab {
    return {
        id: session.id,
        type: session.type,
        label: session.label,
        sessionId: session.id,
    };
}

/** Check whether a session's tab is currently visible (active task + active tab). */
function isSessionFocused(sessionId: string): boolean {
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const activeProjectId = useUIStore.getState().activeProjectId;
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : null;
    if (!workspaceKey) return false;
    const store = useSessionStore.getState();
    const activeTabId = store.activeTabByWorkspace[workspaceKey];
    const tabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.sessionId === sessionId;
}

function getSessionTab(sessionId: string): Tab | undefined {
    const store = useSessionStore.getState();
    for (const tabs of Object.values(store.tabsByWorkspace)) {
        const tab = tabs.find((entry) => entry.sessionId === sessionId);
        if (tab) return tab;
    }
    return undefined;
}

function usesTerminalActivityStatus(sessionId: string): boolean {
    const type = getSessionTab(sessionId)?.type;
    return type === "claude" || type === "codex";
}

export const useSessionStore = create<SessionStore>((set, get) => ({
    tabsByWorkspace: {},
    activeTabByWorkspace: {},
    sessionStatus: {},
    lastTerminalSize: null,
    async createSession(owner, type, label, prompt, shell) {
        const ownerId = owner.taskId ?? owner.projectId;
        if (!ownerId) throw new Error("Either taskId or projectId is required");
        const lastTerminalSize = get().lastTerminalSize;
        const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, {
            ...owner,
            type,
            label,
            prompt,
            shell,
            cols: lastTerminalSize?.cols,
            rows: lastTerminalSize?.rows,
        });
        const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
        const workspaceKey = owner.taskId
            ? getTaskWorkspaceKey(owner.taskId)
            : getProjectWorkspaceKey(ownerId);
        get().addTab(workspaceKey, tab);
        await Promise.all([
            owner.taskId ? useTaskStore.getState().fetchTasks() : Promise.resolve(),
            owner.projectId ? useProjectStore.getState().fetchProjects() : Promise.resolve(),
        ]);
        return sessionId;
    },
    async closeSession(sessionId) {
        await sendRequest(MSG.SESSION_CLOSE, { sessionId });
        await Promise.all([
            useTaskStore.getState().fetchTasks(),
            useProjectStore.getState().fetchProjects(),
        ]);
    },
    sendInput(sessionId, data) {
        markRecentInput(sessionId, data);
        sendFireAndForget(MSG.SESSION_INPUT, { sessionId, data });
    },
    resizeTerminal(sessionId, cols, rows) {
        set({ lastTerminalSize: { cols, rows } });
        sendFireAndForget(MSG.TERMINAL_RESIZE, { sessionId, cols, rows });
    },
    addTab(workspaceKey, tab) {
        set((s) => ({
            tabsByWorkspace: {
                ...s.tabsByWorkspace,
                [workspaceKey]: [...(s.tabsByWorkspace[workspaceKey] ?? []), tab],
            },
            activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: tab.id },
        }));
    },
    async closeTab(workspaceKey, tabId) {
        const tab = (get().tabsByWorkspace[workspaceKey] ?? []).find((entry) => entry.id === tabId);
        if (tab?.sessionId) {
            await get().closeSession(tab.sessionId);
        }
        set((s) => {
            const tabs = (s.tabsByWorkspace[workspaceKey] ?? []).filter((t) => t.id !== tabId);
            const activeId =
                s.activeTabByWorkspace[workspaceKey] === tabId
                    ? (tabs[tabs.length - 1]?.id ?? "")
                    : s.activeTabByWorkspace[workspaceKey];
            const { [tab?.sessionId ?? ""]: _, ...remainingStatus } = s.sessionStatus;
            return {
                tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: tabs },
                activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: activeId },
                sessionStatus: tab?.sessionId ? remainingStatus : s.sessionStatus,
            };
        });
    },
    setActiveTab(workspaceKey, tabId) {
        set((s) => {
            const next = { activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: tabId } };
            const newTab = (s.tabsByWorkspace[workspaceKey] ?? []).find((tab) => tab.id === tabId);
            const sessionIdToClear = newTab?.sessionId &&
                s.sessionStatus[newTab.sessionId] === "attention"
                ? newTab.sessionId
                : undefined;

            if (sessionIdToClear) {
                const { [sessionIdToClear]: _, ...nextStatus } = s.sessionStatus;
                return { ...next, sessionStatus: nextStatus };
            }

            return next;
        });
    },
    setSessionStatus(sessionId, status) {
        set((s) => {
            if (!status) {
                if (!(sessionId in s.sessionStatus)) return s;
                const { [sessionId]: _, ...nextStatus } = s.sessionStatus;
                return { sessionStatus: nextStatus };
            }

            return {
                sessionStatus: { ...s.sessionStatus, [sessionId]: status },
            };
        });
    },
    getTaskStatus(taskId) {
        const tabs = get().tabsByWorkspace[getTaskWorkspaceKey(taskId)] ?? [];
        const statuses = get().sessionStatus;
        let hasAttention = false;
        for (const tab of tabs) {
            if (!tab.sessionId) continue;
            const s = statuses[tab.sessionId];
            if (s === "working") return "working";
            if (s === "attention") hasAttention = true;
        }
        return hasAttention ? "attention" : undefined;
    },
    getTabs(workspaceKey) {
        return get().tabsByWorkspace[workspaceKey] ?? [];
    },
    getActiveTab(workspaceKey) {
        const tabs = get().getTabs(workspaceKey);
        return tabs.find((t) => t.id === get().activeTabByWorkspace[workspaceKey]);
    },
    syncWithTasks(tasks) {
        set((state) => {
            const nextTabsByWorkspace: Record<string, Tab[]> = Object.fromEntries(
                Object.entries(state.tabsByWorkspace).filter(([key]) => !key.startsWith("task:")),
            );
            const nextActiveTabByWorkspace: Record<string, string> = Object.fromEntries(
                Object.entries(state.activeTabByWorkspace).filter(([key]) => !key.startsWith("task:")),
            );

            for (const task of tasks) {
                const workspaceKey = getTaskWorkspaceKey(task.id);
                const existingTabs = state.tabsByWorkspace[workspaceKey] ?? [];
                const sessionsById = new Map(task.sessions.map((session) => [session.id, session]));
                const tabs = existingTabs
                    .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                    .map((tab) => {
                        if (!tab.sessionId) return tab;
                        const session = sessionsById.get(tab.sessionId);
                        return session ? { ...tab, type: session.type, label: session.label } : tab;
                    });

                for (const session of task.sessions) {
                    if (!tabs.some((tab) => tab.sessionId === session.id)) {
                        tabs.push(createSessionTab(session));
                    }
                }

                if (tabs.length === 0) {
                    continue;
                }

                nextTabsByWorkspace[workspaceKey] = tabs;
                const currentActiveId = state.activeTabByWorkspace[workspaceKey];
                nextActiveTabByWorkspace[workspaceKey] = tabs.some((tab) => tab.id === currentActiveId)
                    ? currentActiveId
                    : tabs[0].id;
            }

            return {
                tabsByWorkspace: nextTabsByWorkspace,
                activeTabByWorkspace: nextActiveTabByWorkspace,
            };
        });
    },
    syncWithProjects(projects) {
        set((state) => {
            const nextTabsByWorkspace: Record<string, Tab[]> = Object.fromEntries(
                Object.entries(state.tabsByWorkspace).filter(([key]) => !key.startsWith("project:")),
            );
            const nextActiveTabByWorkspace: Record<string, string> = Object.fromEntries(
                Object.entries(state.activeTabByWorkspace).filter(([key]) => !key.startsWith("project:")),
            );

            for (const project of projects) {
                const workspaceKey = getProjectWorkspaceKey(project.id);
                const existingTabs = state.tabsByWorkspace[workspaceKey] ?? [];
                const sessionsById = new Map(project.sessions.map((session) => [session.id, session]));
                const tabs = existingTabs
                    .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                    .map((tab) => {
                        if (!tab.sessionId) return tab;
                        const session = sessionsById.get(tab.sessionId);
                        return session ? { ...tab, type: session.type, label: session.label } : tab;
                    });

                for (const session of project.sessions) {
                    if (!tabs.some((tab) => tab.sessionId === session.id)) {
                        tabs.push(createSessionTab(session));
                    }
                }

                if (tabs.length === 0) {
                    continue;
                }

                nextTabsByWorkspace[workspaceKey] = tabs;
                const currentActiveId = state.activeTabByWorkspace[workspaceKey];
                nextActiveTabByWorkspace[workspaceKey] = tabs.some((tab) => tab.id === currentActiveId)
                    ? currentActiveId
                    : tabs[0].id;
            }

            return {
                tabsByWorkspace: nextTabsByWorkspace,
                activeTabByWorkspace: nextActiveTabByWorkspace,
            };
        });
    },
}));

// --- Module-level event listeners (singleton, registered once) ---

// Debounce timers for working → attention transitions
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ACTIVITY_TIMEOUT = 3000;
interface RecentInputChunk {
    at: number;
    data: string;
}

const recentInput = new Map<string, RecentInputChunk[]>();
const TYPING_ACTIVITY_SUPPRESSION_MS = 400;
const MAX_PENDING_INPUT_CHUNKS = 64;

function markRecentInput(sessionId: string, data: string): void {
    const now = Date.now();
    const pending = recentInput.get(sessionId) ?? [];
    const next = pending
        .filter((chunk) => now - chunk.at <= TYPING_ACTIVITY_SUPPRESSION_MS)
        .concat({ at: now, data })
        .slice(-MAX_PENDING_INPUT_CHUNKS);
    recentInput.set(sessionId, next);
}

function clearRecentInput(sessionId: string): void {
    recentInput.delete(sessionId);
}

function pruneRecentInput(sessionId: string, now: number): RecentInputChunk[] {
    const pending = recentInput.get(sessionId) ?? [];
    const next = pending.filter((chunk) => now - chunk.at <= TYPING_ACTIVITY_SUPPRESSION_MS);
    if (next.length === 0) {
        recentInput.delete(sessionId);
        return [];
    }
    recentInput.set(sessionId, next);
    return next;
}

function shouldIgnoreRecentEcho(sessionId: string, data: string): boolean {
    const pending = pruneRecentInput(sessionId, Date.now());
    if (pending.length === 0) return false;
    if (!isSessionFocused(sessionId)) return false;

    let matchedCount = 0;
    let combined = "";

    for (const chunk of pending) {
        combined += chunk.data;
        matchedCount += 1;

        const isDirectEcho = data === combined;
        const isEnterEcho = combined === "\r" && data === "\r\n";
        if (!isDirectEcho && !isEnterEcho) continue;

        const remaining = pending.slice(matchedCount);
        if (remaining.length === 0) {
            recentInput.delete(sessionId);
        } else {
            recentInput.set(sessionId, remaining);
        }
        return true;
    }

    return false;
}

function clearActivityTimer(sessionId: string): void {
    const timer = activityTimers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        activityTimers.delete(sessionId);
    }
}

function settleInactiveSession(sessionId: string): void {
    const status = isSessionFocused(sessionId) ? undefined : "attention";
    useSessionStore.getState().setSessionStatus(sessionId, status);
}

function scheduleActivityTimeout(sessionId: string): void {
    clearActivityTimer(sessionId);
    activityTimers.set(
        sessionId,
        setTimeout(() => {
            activityTimers.delete(sessionId);
            settleInactiveSession(sessionId);
        }, ACTIVITY_TIMEOUT),
    );
}

// Track terminal output → working / attention status
const _unsubTerminalOutput = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
    if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
    const { sessionId, data } = payload as TerminalOutputEvent;
    if (shouldIgnoreRecentEcho(sessionId, data)) return;
    if (!usesTerminalActivityStatus(sessionId)) return;

    const store = useSessionStore.getState();
    if (store.sessionStatus[sessionId] !== "working") {
        store.setSessionStatus(sessionId, "working");
    }

    scheduleActivityTimeout(sessionId);
});

const _unsubSessionStatus = onEvent(MSG.SESSION_STATUS, (payload) => {
    if (
        !payload ||
        typeof payload !== "object" ||
        !("sessionId" in payload) ||
        !("status" in payload)
    ) {
        return;
    }

    const { sessionId, status } = payload as SessionStatusEvent;
    useSessionStore.getState().setSessionStatus(sessionId, status);

    if (status === "working") {
        scheduleActivityTimeout(sessionId);
        return;
    }

    clearActivityTimer(sessionId);
});

// Clean up status when session exits
const _unsubSessionExited = onEvent(MSG.SESSION_EXITED, (payload) => {
    if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
    const { sessionId } = payload as SessionExitedEvent;
    clearActivityTimer(sessionId);
    clearRecentInput(sessionId);
    const { [sessionId]: _, ...remaining } = useSessionStore.getState().sessionStatus;
    useSessionStore.setState({ sessionStatus: remaining });
});

// Listen for browser:open events from backend (e.g., agent API calls).
const _unsubBrowserOpen = onEvent(MSG.BROWSER_OPEN, (payload) => {
    if (!payload || typeof payload !== "object" || !("url" in payload))
        return;
    const { taskId, projectId, url, label } = payload as BrowserOpenPayload;
    const workspaceKey = taskId
        ? getTaskWorkspaceKey(taskId)
        : projectId
          ? getProjectWorkspaceKey(projectId)
          : null;
    if (!workspaceKey) return;
    useSessionStore.getState().addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: "browser",
        label: label ?? "Browser",
        url,
    });
});

const _unsubActiveTask = useTaskStore.subscribe((state, prevState) => {
    if (state.activeTaskId === prevState.activeTaskId || !state.activeTaskId) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    const workspaceKey = getTaskWorkspaceKey(state.activeTaskId);
    const activeTabId = sessionStore.activeTabByWorkspace[workspaceKey];
    const activeTab = (sessionStore.tabsByWorkspace[workspaceKey] ?? []).find(
        (tab) => tab.id === activeTabId,
    );

    if (
        activeTab?.sessionId &&
        sessionStore.sessionStatus[activeTab.sessionId] === "attention"
    ) {
        sessionStore.setSessionStatus(activeTab.sessionId, undefined);
    }
});

const _unsubActiveProject = useUIStore.subscribe((state, prevState) => {
    if (state.activeProjectId === prevState.activeProjectId || !state.activeProjectId) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    const workspaceKey = getProjectWorkspaceKey(state.activeProjectId);
    const activeTabId = sessionStore.activeTabByWorkspace[workspaceKey];
    const activeTab = (sessionStore.tabsByWorkspace[workspaceKey] ?? []).find(
        (tab) => tab.id === activeTabId,
    );

    if (
        activeTab?.sessionId &&
        sessionStore.sessionStatus[activeTab.sessionId] === "attention"
    ) {
        sessionStore.setSessionStatus(activeTab.sessionId, undefined);
    }
});

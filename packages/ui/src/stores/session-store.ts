import { create } from "zustand";
import type {
    SessionRef,
    Task,
    BrowserOpenPayload,
    SessionStatus,
    TerminalOutputEvent,
    SessionExitedEvent,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, sendFireAndForget, onEvent } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";

interface Tab {
    id: string;
    type: "claude" | "codex" | "shell" | "editor" | "changes" | "browser";
    label: string;
    sessionId?: string;
    filePath?: string;
    url?: string;
}

interface SessionStore {
    tabsByTask: Record<string, Tab[]>;
    activeTabByTask: Record<string, string>;
    sessionStatus: Record<string, SessionStatus>;
    createSession(
        taskId: string,
        type: "claude" | "codex" | "shell",
        label?: string,
        prompt?: string,
        shell?: string,
    ): Promise<string>;
    closeSession(sessionId: string): Promise<void>;
    sendInput(sessionId: string, data: string): void;
    resizeTerminal(sessionId: string, cols: number, rows: number): void;
    addTab(taskId: string, tab: Tab): void;
    closeTab(taskId: string, tabId: string): Promise<void>;
    setActiveTab(taskId: string, tabId: string): void;
    setSessionStatus(sessionId: string, status: SessionStatus): void;
    getTaskStatus(taskId: string): SessionStatus;
    getTabs(taskId: string): Tab[];
    getActiveTab(taskId: string): Tab | undefined;
    syncWithTasks(tasks: Task[]): void;
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
    if (!activeTaskId) return false;
    const store = useSessionStore.getState();
    const activeTabId = store.activeTabByTask[activeTaskId];
    const tabs = store.tabsByTask[activeTaskId] ?? [];
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.sessionId === sessionId;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
    tabsByTask: {},
    activeTabByTask: {},
    sessionStatus: {},
    async createSession(taskId, type, label, prompt, shell) {
        const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, {
            taskId,
            type,
            label,
            prompt,
            shell,
        });
        const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
        get().addTab(taskId, tab);
        await useTaskStore.getState().fetchTasks();
        return sessionId;
    },
    async closeSession(sessionId) {
        await sendRequest(MSG.SESSION_CLOSE, { sessionId });
        await useTaskStore.getState().fetchTasks();
    },
    sendInput(sessionId, data) {
        sendFireAndForget(MSG.SESSION_INPUT, { sessionId, data });
    },
    resizeTerminal(sessionId, cols, rows) {
        sendFireAndForget(MSG.TERMINAL_RESIZE, { sessionId, cols, rows });
    },
    addTab(taskId, tab) {
        set((s) => ({
            tabsByTask: { ...s.tabsByTask, [taskId]: [...(s.tabsByTask[taskId] ?? []), tab] },
            activeTabByTask: { ...s.activeTabByTask, [taskId]: tab.id },
        }));
    },
    async closeTab(taskId, tabId) {
        const tab = (get().tabsByTask[taskId] ?? []).find((entry) => entry.id === tabId);
        if (tab?.sessionId) {
            await get().closeSession(tab.sessionId);
        }
        set((s) => {
            const tabs = (s.tabsByTask[taskId] ?? []).filter((t) => t.id !== tabId);
            const activeId =
                s.activeTabByTask[taskId] === tabId
                    ? (tabs[tabs.length - 1]?.id ?? "")
                    : s.activeTabByTask[taskId];
            const { [tab?.sessionId ?? ""]: _, ...remainingStatus } = s.sessionStatus;
            return {
                tabsByTask: { ...s.tabsByTask, [taskId]: tabs },
                activeTabByTask: { ...s.activeTabByTask, [taskId]: activeId },
                sessionStatus: tab?.sessionId ? remainingStatus : s.sessionStatus,
            };
        });
    },
    setActiveTab(taskId, tabId) {
        set((s) => {
            const next = { activeTabByTask: { ...s.activeTabByTask, [taskId]: tabId } };
            // Reset attention → idle when focusing a tab with an attention session
            const tab = (s.tabsByTask[taskId] ?? []).find((t) => t.id === tabId);
            if (tab?.sessionId && s.sessionStatus[tab.sessionId] === "attention") {
                return {
                    ...next,
                    sessionStatus: { ...s.sessionStatus, [tab.sessionId]: "idle" },
                };
            }
            return next;
        });
    },
    setSessionStatus(sessionId, status) {
        set((s) => ({
            sessionStatus: { ...s.sessionStatus, [sessionId]: status },
        }));
    },
    getTaskStatus(taskId) {
        const tabs = get().tabsByTask[taskId] ?? [];
        const statuses = get().sessionStatus;
        let hasAttention = false;
        for (const tab of tabs) {
            if (!tab.sessionId) continue;
            const s = statuses[tab.sessionId];
            if (s === "working") return "working";
            if (s === "attention") hasAttention = true;
        }
        return hasAttention ? "attention" : "idle";
    },
    getTabs(taskId) {
        return get().tabsByTask[taskId] ?? [];
    },
    getActiveTab(taskId) {
        const tabs = get().getTabs(taskId);
        return tabs.find((t) => t.id === get().activeTabByTask[taskId]);
    },
    syncWithTasks(tasks) {
        set((state) => {
            const nextTabsByTask: Record<string, Tab[]> = {};
            const nextActiveTabByTask: Record<string, string> = {};

            for (const task of tasks) {
                const existingTabs = state.tabsByTask[task.id] ?? [];
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

                nextTabsByTask[task.id] = tabs;
                const currentActiveId = state.activeTabByTask[task.id];
                nextActiveTabByTask[task.id] = tabs.some((tab) => tab.id === currentActiveId)
                    ? currentActiveId
                    : tabs[0].id;
            }

            return {
                tabsByTask: nextTabsByTask,
                activeTabByTask: nextActiveTabByTask,
            };
        });
    },
}));

// --- Module-level event listeners (singleton, registered once) ---

// Debounce timers for working → attention transitions
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ACTIVITY_TIMEOUT = 3000;

function clearActivityTimer(sessionId: string): void {
    const timer = activityTimers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        activityTimers.delete(sessionId);
    }
}

// Track terminal output → working / attention status
const _unsubTerminalOutput = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
    if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
    const { sessionId } = payload as TerminalOutputEvent;

    const store = useSessionStore.getState();
    if (store.sessionStatus[sessionId] !== "working") {
        store.setSessionStatus(sessionId, "working");
    }

    // Reset debounce timer
    clearActivityTimer(sessionId);
    activityTimers.set(
        sessionId,
        setTimeout(() => {
            activityTimers.delete(sessionId);
            // If the session's tab is focused, go straight to idle
            const status = isSessionFocused(sessionId) ? "idle" : "attention";
            useSessionStore.getState().setSessionStatus(sessionId, status);
        }, ACTIVITY_TIMEOUT),
    );
});

// Clean up status when session exits
const _unsubSessionExited = onEvent(MSG.SESSION_EXITED, (payload) => {
    if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
    const { sessionId } = payload as SessionExitedEvent;
    clearActivityTimer(sessionId);
    const { [sessionId]: _, ...remaining } = useSessionStore.getState().sessionStatus;
    useSessionStore.setState({ sessionStatus: remaining });
});

// Listen for browser:open events from backend (e.g., agent API calls).
const _unsubBrowserOpen = onEvent(MSG.BROWSER_OPEN, (payload) => {
    if (!payload || typeof payload !== "object" || !("taskId" in payload) || !("url" in payload))
        return;
    const { taskId, url, label } = payload as BrowserOpenPayload;
    useSessionStore.getState().addTab(taskId, {
        id: crypto.randomUUID(),
        type: "browser",
        label: label ?? "Browser",
        url,
    });
});

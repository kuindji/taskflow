import type {
    BrowserOpenPayload,
    MasterSessionsListResponse,
    SessionStatusEvent,
    TerminalOutputEvent,
    SessionExitedEvent,
    SessionStatus,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";
import { getProjectWorkspaceKey, getTaskWorkspaceKey } from "@/hooks/useActiveWorkspace";
import {
    exitedSessions,
    usesTerminalActivityStatus,
    getSessionTab,
    setWindowFocused,
} from "./session-helpers";
import {
    isUserInteracting,
    clearActivityTimer,
    clearInteraction,
    scheduleActivityTimeout,
    settleInactiveSession,
} from "./session-activity";
import type { Tab } from "./session-helpers";

interface SessionStoreApi {
    getState(): {
        tabsByWorkspace: Record<string, Tab[]>;
        activeTabByWorkspace: Record<string, string>;
        sessionStatus: Partial<Record<string, SessionStatus>>;
        setSessionStatus(sessionId: string, status?: SessionStatus): void;
        setActiveTab(workspaceKey: string, tabId: string): void;
        addTab(workspaceKey: string, tab: Tab): void;
        syncWithMasterSessions(
            sessions: { id: string; type: Tab["type"]; label?: string; trayExclude?: boolean }[],
        ): void;
    };
    setState(
        partial: Partial<{
            sessionStatus: Partial<Record<string, SessionStatus>>;
        }>,
    ): void;
    subscribe(
        listener: (
            state: { sessionStatus: Partial<Record<string, SessionStatus>> },
            prevState: { sessionStatus: Partial<Record<string, SessionStatus>> },
        ) => void,
    ): () => void;
}

// --- Tray icon state aggregation ---

let lastTrayState: string | null | undefined = undefined;

function syncTrayState(
    state: { sessionStatus: Partial<Record<string, SessionStatus>> },
    store: SessionStoreApi,
): void {
    let aggregate: string | null = null;
    let hasWorking = false;

    for (const [sessionId, status] of Object.entries(state.sessionStatus)) {
        if (getSessionTab(sessionId, store.getState)?.trayExclude) continue;
        if (status === "attention") {
            aggregate = "attention";
            break;
        }
        if (status === "working") hasWorking = true;
    }

    if (!aggregate && hasWorking) aggregate = "working";

    if (aggregate !== lastTrayState) {
        lastTrayState = aggregate;
        window.taskflow?.sendTrayState(aggregate);
    }
}

// --- Window focus tracking ---

function onWindowFocusChanged(focused: boolean, store: SessionStoreApi): void {
    setWindowFocused(focused);
    if (focused) {
        // Re-settle all sessions: clears attention on the currently visible tab
        const state = store.getState();
        for (const sessionId of Object.keys(state.sessionStatus)) {
            if (state.sessionStatus[sessionId] === "attention") {
                settleInactiveSession(sessionId, store.getState);
            }
        }
    }
}

function initSessionSubscriptions(store: SessionStoreApi): void {
    // Track terminal output → working / attention status
    const _unsubTerminalOutput = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
        if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
        const { sessionId } = payload as TerminalOutputEvent;

        const state = store.getState();
        const currentStatus = state.sessionStatus[sessionId];

        // "initializing" is only set for claude/codex sessions, so terminal
        // output is a reliable signal the agent has started — transition
        // immediately without requiring the tab to exist in the store yet.
        if (currentStatus === "initializing") {
            state.setSessionStatus(sessionId, "working");
            scheduleActivityTimeout(sessionId, store.getState);
            return;
        }

        if (isUserInteracting(sessionId)) return;
        if (!usesTerminalActivityStatus(sessionId, store.getState)) return;

        if (currentStatus !== "working") {
            state.setSessionStatus(sessionId, "working");
        }

        scheduleActivityTimeout(sessionId, store.getState);
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
        store.getState().setSessionStatus(sessionId, status);

        if (status === "working") {
            scheduleActivityTimeout(sessionId, store.getState);
            return;
        }

        clearActivityTimer(sessionId);
    });

    // Clean up status when session exits
    const _unsubSessionExited = onEvent(MSG.SESSION_EXITED, (payload) => {
        if (!payload || typeof payload !== "object" || !("sessionId" in payload)) return;
        const { sessionId } = payload as SessionExitedEvent;
        exitedSessions.add(sessionId);
        clearActivityTimer(sessionId);
        clearInteraction(sessionId);
        const { [sessionId]: _, ...remaining } = store.getState().sessionStatus;
        store.setState({ sessionStatus: remaining });
    });

    // Listen for browser:open events from backend (e.g., agent API calls).
    const _unsubBrowserOpen = onEvent(MSG.BROWSER_OPEN, (payload) => {
        if (!payload || typeof payload !== "object" || !("url" in payload)) return;
        const { taskId, projectId, url, label } = payload as BrowserOpenPayload;
        const workspaceKey = taskId
            ? getTaskWorkspaceKey(taskId)
            : projectId
              ? getProjectWorkspaceKey(projectId)
              : (payload as BrowserOpenPayload).master
                ? "master"
                : null;
        if (!workspaceKey) return;
        store.getState().addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "browser",
            label: label ?? "Browser",
            url,
        });
    });

    const _unsubMasterSessions = onEvent(MSG.MASTER_SESSIONS_LIST, (payload) => {
        if (!payload || typeof payload !== "object" || !("sessions" in payload)) return;
        const { sessions } = payload as MasterSessionsListResponse;
        store.getState().syncWithMasterSessions(sessions);
    });

    const _unsubActiveTask = useTaskStore.subscribe((state, prevState) => {
        if (state.activeTaskId === prevState.activeTaskId) {
            return;
        }

        const sessionStore = store.getState();

        // Task activated → switch to attention tab if any, then clear its attention
        if (state.activeTaskId) {
            const workspaceKey = getTaskWorkspaceKey(state.activeTaskId);
            for (const key of [workspaceKey, `${workspaceKey}:right`]) {
                const tabs = sessionStore.tabsByWorkspace[key] ?? [];
                const attentionTab = tabs.find(
                    (tab) =>
                        tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
                );
                if (attentionTab) {
                    sessionStore.setActiveTab(key, attentionTab.id);
                }
            }
            return;
        }

        // Task deactivated (back to project view) → switch to attention tab if any
        const activeProjectId = useUIStore.getState().activeProjectId;
        if (activeProjectId) {
            const workspaceKey = getProjectWorkspaceKey(activeProjectId);
            for (const key of [workspaceKey, `${workspaceKey}:right`]) {
                const tabs = sessionStore.tabsByWorkspace[key] ?? [];
                const attentionTab = tabs.find(
                    (tab) =>
                        tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
                );
                if (attentionTab) {
                    sessionStore.setActiveTab(key, attentionTab.id);
                }
            }
        }
    });

    const _unsubActiveProject = useUIStore.subscribe((state, prevState) => {
        if (state.activeProjectId === prevState.activeProjectId || !state.activeProjectId) {
            return;
        }

        const sessionStore = store.getState();
        const workspaceKey = getProjectWorkspaceKey(state.activeProjectId);
        for (const key of [workspaceKey, `${workspaceKey}:right`]) {
            const tabs = sessionStore.tabsByWorkspace[key] ?? [];
            const attentionTab = tabs.find(
                (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
            );
            if (attentionTab) {
                sessionStore.setActiveTab(key, attentionTab.id);
            }
        }
    });

    const _unsubTrayState = store.subscribe((state, prevState) => {
        if (state.sessionStatus === prevState.sessionStatus) return;
        syncTrayState(state, store);
    });

    syncTrayState(store.getState(), store);

    // --- Window focus tracking ---

    if (window.taskflow?.onWindowFocusChanged) {
        window.taskflow.onWindowFocusChanged((focused: boolean) =>
            onWindowFocusChanged(focused, store),
        );
    } else {
        // Fallback for non-Electron (browser dev mode)
        document.addEventListener("visibilitychange", () => {
            onWindowFocusChanged(document.visibilityState === "visible", store);
        });
    }

    // --- HMR dispose ---

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            _unsubTerminalOutput();
            _unsubSessionStatus();
            _unsubSessionExited();
            _unsubBrowserOpen();
            _unsubMasterSessions();
            _unsubActiveTask();
            _unsubActiveProject();
            _unsubTrayState();
        });
    }
}

export { initSessionSubscriptions };

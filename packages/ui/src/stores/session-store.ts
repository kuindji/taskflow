import { create } from "zustand";
import type {
    AgentLaunchOptions,
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
    type: "claude" | "codex" | "gemini" | "shell" | "editor" | "changes" | "browser";
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
        type: "claude" | "codex" | "gemini" | "shell",
        label?: string,
        prompt?: string,
        shell?: string,
        agentOptions?: AgentLaunchOptions,
    ): Promise<string>;
    closeSession(sessionId: string): Promise<void>;
    sendInput(sessionId: string, data: string): void;
    resizeTerminal(sessionId: string, cols: number, rows: number): void;
    addTab(workspaceKey: string, tab: Tab): void;
    closeTab(workspaceKey: string, tabId: string): Promise<void>;
    setActiveTab(workspaceKey: string, tabId: string): void;
    setSessionStatus(sessionId: string, status?: SessionStatus): void;
    getTaskStatus(taskId: string): SessionStatus | undefined;
    renameTab(workspaceKey: string, tabId: string, newLabel: string): void;
    getTabs(workspaceKey: string): Tab[];
    getActiveTab(workspaceKey: string): Tab | undefined;
    syncWithTasks(tasks: Task[]): void;
    syncWithProjects(projects: { id: string; sessions: SessionRef[] }[]): void;
}

export type { Tab };

function getDefaultSessionLabel(type: Tab["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "gemini") return "Gemini";
    return `${type} session`;
}

function normalizeSessionLabel(type: SessionRef["type"], label?: string): string {
    if (!label || label === `${type} session`) {
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
    };
}

/** Whether the Electron/browser window is currently focused. */
let windowFocused = true;

/** Check whether a session's tab is currently visible (active task + active tab + window focused). */
function isSessionFocused(sessionId: string): boolean {
    if (!windowFocused) return false;
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
    return type === "claude" || type === "codex" || type === "gemini";
}

export const useSessionStore = create<SessionStore>((set, get) => ({
    tabsByWorkspace: {},
    activeTabByWorkspace: {},
    sessionStatus: {},
    lastTerminalSize: null,
    async createSession(owner, type, label, prompt, shell, agentOptions) {
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
            agentOptions,
        });
        const tab: Tab = {
            id: sessionId,
            type,
            label: normalizeSessionLabel(type, label),
            sessionId,
        };
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
        markInteraction(sessionId);
        sendFireAndForget(MSG.SESSION_INPUT, { sessionId, data });
    },
    resizeTerminal(sessionId, cols, rows) {
        markInteraction(sessionId);
        set({ lastTerminalSize: { cols, rows } });
        sendFireAndForget(MSG.TERMINAL_RESIZE, { sessionId, cols, rows });
    },
    addTab(workspaceKey, tab) {
        set((s) => {
            const existing = s.tabsByWorkspace[workspaceKey] ?? [];
            // Prevent duplicate tabs for the same session (race between
            // MSG.TASK_UPDATED broadcast triggering syncWithTasks and the
            // SESSION_CREATE response calling addTab directly).
            const existingTab = tab.sessionId
                ? existing.find((t) => t.sessionId === tab.sessionId)
                : undefined;
            if (existingTab) {
                return {
                    activeTabByWorkspace: {
                        ...s.activeTabByWorkspace,
                        [workspaceKey]: existingTab.id,
                    },
                };
            }
            return {
                tabsByWorkspace: {
                    ...s.tabsByWorkspace,
                    [workspaceKey]: [...existing, tab],
                },
                activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: tab.id },
            };
        });
    },
    async closeTab(workspaceKey, tabId) {
        const tab = (get().tabsByWorkspace[workspaceKey] ?? []).find((entry) => entry.id === tabId);
        try {
            if (tab?.sessionId) {
                await get().closeSession(tab.sessionId);
            }
        } finally {
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
        }
    },
    setActiveTab(workspaceKey, tabId) {
        set((s) => {
            const next = {
                activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: tabId },
            };
            const newTab = (s.tabsByWorkspace[workspaceKey] ?? []).find((tab) => tab.id === tabId);
            const sessionIdToClear =
                newTab?.sessionId && s.sessionStatus[newTab.sessionId] === "attention"
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
    renameTab(workspaceKey, tabId, newLabel) {
        const tabs = get().tabsByWorkspace[workspaceKey] ?? [];
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab || tab.label === newLabel) return;

        set((s) => ({
            tabsByWorkspace: {
                ...s.tabsByWorkspace,
                [workspaceKey]: (s.tabsByWorkspace[workspaceKey] ?? []).map((t) =>
                    t.id === tabId ? { ...t, label: newLabel } : t,
                ),
            },
        }));

        if (tab.sessionId) {
            sendFireAndForget(MSG.SESSION_RENAME, {
                sessionId: tab.sessionId,
                label: newLabel,
            });
        }
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
                Object.entries(state.activeTabByWorkspace).filter(
                    ([key]) => !key.startsWith("task:"),
                ),
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
                        return session
                            ? {
                                  ...tab,
                                  type: session.type,
                                  label: normalizeSessionLabel(session.type, session.label),
                              }
                            : tab;
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
                nextActiveTabByWorkspace[workspaceKey] = tabs.some(
                    (tab) => tab.id === currentActiveId,
                )
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
                Object.entries(state.tabsByWorkspace).filter(
                    ([key]) => !key.startsWith("project:"),
                ),
            );
            const nextActiveTabByWorkspace: Record<string, string> = Object.fromEntries(
                Object.entries(state.activeTabByWorkspace).filter(
                    ([key]) => !key.startsWith("project:"),
                ),
            );

            for (const project of projects) {
                const workspaceKey = getProjectWorkspaceKey(project.id);
                const existingTabs = state.tabsByWorkspace[workspaceKey] ?? [];
                const sessionsById = new Map(
                    project.sessions.map((session) => [session.id, session]),
                );
                const tabs = existingTabs
                    .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                    .map((tab) => {
                        if (!tab.sessionId) return tab;
                        const session = sessionsById.get(tab.sessionId);
                        return session
                            ? {
                                  ...tab,
                                  type: session.type,
                                  label: normalizeSessionLabel(session.type, session.label),
                              }
                            : tab;
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
                nextActiveTabByWorkspace[workspaceKey] = tabs.some(
                    (tab) => tab.id === currentActiveId,
                )
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
const lastInteractionAt = new Map<string, number>();
const INTERACTION_SUPPRESSION_MS = 500;

function markInteraction(sessionId: string): void {
    lastInteractionAt.set(sessionId, Date.now());
}

function clearInteraction(sessionId: string): void {
    lastInteractionAt.delete(sessionId);
}

function isUserInteracting(sessionId: string): boolean {
    const lastAt = lastInteractionAt.get(sessionId);
    if (lastAt === undefined) return false;
    return Date.now() - lastAt < INTERACTION_SUPPRESSION_MS;
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
    const { sessionId } = payload as TerminalOutputEvent;
    if (isUserInteracting(sessionId)) return;
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
    clearInteraction(sessionId);
    const { [sessionId]: _, ...remaining } = useSessionStore.getState().sessionStatus;
    useSessionStore.setState({ sessionStatus: remaining });
});

// Listen for browser:open events from backend (e.g., agent API calls).
const _unsubBrowserOpen = onEvent(MSG.BROWSER_OPEN, (payload) => {
    if (!payload || typeof payload !== "object" || !("url" in payload)) return;
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
    if (state.activeTaskId === prevState.activeTaskId) {
        return;
    }

    const sessionStore = useSessionStore.getState();

    // Task activated → switch to attention tab if any, then clear its attention
    if (state.activeTaskId) {
        const workspaceKey = getTaskWorkspaceKey(state.activeTaskId);
        const tabs = sessionStore.tabsByWorkspace[workspaceKey] ?? [];
        const attentionTab = tabs.find(
            (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
        );
        if (attentionTab) {
            sessionStore.setActiveTab(workspaceKey, attentionTab.id);
        }
        return;
    }

    // Task deactivated (back to project view) → switch to attention tab if any
    const activeProjectId = useUIStore.getState().activeProjectId;
    if (activeProjectId) {
        const workspaceKey = getProjectWorkspaceKey(activeProjectId);
        const tabs = sessionStore.tabsByWorkspace[workspaceKey] ?? [];
        const attentionTab = tabs.find(
            (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
        );
        if (attentionTab) {
            sessionStore.setActiveTab(workspaceKey, attentionTab.id);
        }
    }
});

const _unsubActiveProject = useUIStore.subscribe((state, prevState) => {
    if (state.activeProjectId === prevState.activeProjectId || !state.activeProjectId) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    const workspaceKey = getProjectWorkspaceKey(state.activeProjectId);
    const tabs = sessionStore.tabsByWorkspace[workspaceKey] ?? [];
    const attentionTab = tabs.find(
        (tab) => tab.sessionId && sessionStore.sessionStatus[tab.sessionId] === "attention",
    );
    if (attentionTab) {
        sessionStore.setActiveTab(workspaceKey, attentionTab.id);
    }
});

// --- Window focus tracking ---

function onWindowFocusChanged(focused: boolean): void {
    windowFocused = focused;
    if (focused) {
        // Re-settle all sessions: clears attention on the currently visible tab
        const store = useSessionStore.getState();
        for (const sessionId of Object.keys(store.sessionStatus)) {
            if (store.sessionStatus[sessionId] === "attention") {
                settleInactiveSession(sessionId);
            }
        }
    }
}

if (window.taskflow?.onWindowFocusChanged) {
    window.taskflow.onWindowFocusChanged(onWindowFocusChanged);
} else {
    // Fallback for non-Electron (browser dev mode)
    document.addEventListener("visibilitychange", () => {
        onWindowFocusChanged(document.visibilityState === "visible");
    });
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubTerminalOutput();
        _unsubSessionStatus();
        _unsubSessionExited();
        _unsubBrowserOpen();
        _unsubActiveTask();
        _unsubActiveProject();
    });
}

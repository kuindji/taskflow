import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type {
    AgentLaunchOptions,
    SessionRef,
    Task,
    SessionStatus,
    SessionCreateResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, sendFireAndForget } from "../hooks/useWebSocket";
import { useTaskStore } from "./task-store";
import { useProjectStore } from "./project-store";
import { getProjectWorkspaceKey, getTaskWorkspaceKey } from "@/hooks/useActiveWorkspace";
import {
    normalizeSessionLabel,
    createSessionTab,
    isKnownSessionType,
    exitedSessions,
    isSessionExited,
} from "./session-helpers";
import { syncOwnerTabs } from "./session-sync";
import type { Tab } from "./session-helpers";
import { markInteraction } from "./session-activity";
import { initSessionSubscriptions } from "./session-subscriptions";

/**
 * Owner IDs with an in-flight createSession call that targets a non-default
 * workspace key (e.g. a split right pane). While a create is pending,
 * syncWithTasks/syncWithProjects must not auto-place new sessions for that
 * owner — the createSession caller will place the tab explicitly.
 */
const pendingSessionCreates = new Set<string>();

interface SessionStore {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
    sessionStatus: Partial<Record<string, SessionStatus>>;
    lastTerminalSize: { cols: number; rows: number } | null;
    createSession(
        owner: { taskId?: string; projectId?: string; master?: boolean },
        type: Tab["type"],
        label?: string,
        prompt?: string,
        shell?: string,
        agentOptions?: AgentLaunchOptions,
        editorOpts?: { editorId: string; filePath: string; line?: number },
        cwd?: string,
        targetWorkspaceKey?: string,
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
    reorderTabs(workspaceKey: string, activeId: string, overId: string): void;
    updateAutoTitle(workspaceKey: string, tabId: string, title: string): void;
    getTabs(workspaceKey: string): Tab[];
    getActiveTab(workspaceKey: string): Tab | undefined;
    mergeSplitTabs(workspaceKey: string): void;
    moveTabToPane(sourceKey: string, targetKey: string, tabId: string, insertIndex?: number): void;
    syncWithTasks(tasks: Task[]): void;
    syncWithProjects(projects: { id: string; sessions: SessionRef[] }[]): void;
    syncWithMasterSessions(sessions: SessionRef[]): void;
}

export type { Tab };
export { isSessionExited };

export const useSessionStore = create<SessionStore>((set, get) => ({
    tabsByWorkspace: {},
    activeTabByWorkspace: {},
    sessionStatus: {},
    lastTerminalSize: null,
    async createSession(
        owner,
        type,
        label,
        prompt,
        shell,
        agentOptions,
        editorOpts,
        cwd,
        targetWorkspaceKey,
    ) {
        const ownerId = owner.taskId ?? owner.projectId;
        if (!ownerId && !owner.master)
            throw new Error("Either taskId, projectId, or master is required");

        // When targeting a non-default workspace key (e.g. split right pane),
        // block syncWithTasks from auto-placing the session while we await.
        const pendingKey = ownerId ?? (owner.master ? "master" : undefined);
        if (targetWorkspaceKey && pendingKey) {
            pendingSessionCreates.add(pendingKey);
        }

        const lastTerminalSize = get().lastTerminalSize;
        const { sessionId } = await sendRequest<SessionCreateResponse>(MSG.SESSION_CREATE, {
            ...owner,
            type,
            label,
            prompt,
            shell,
            cwd,
            cols: lastTerminalSize?.cols,
            rows: lastTerminalSize?.rows,
            agentOptions,
            ...(editorOpts && {
                editorId: editorOpts.editorId,
                filePath: editorOpts.filePath,
                line: editorOpts.line,
            }),
        });
        const tab: Tab = {
            id: sessionId,
            type,
            label: normalizeSessionLabel(type, label),
            sessionId,
            ...(type === "shell" && { autoTitle: true }),
            ...(editorOpts && { filePath: editorOpts.filePath }),
        };
        const workspaceKey =
            targetWorkspaceKey ??
            (owner.taskId
                ? getTaskWorkspaceKey(owner.taskId)
                : ownerId
                  ? getProjectWorkspaceKey(ownerId)
                  : "master");
        get().addTab(workspaceKey, tab);
        if (pendingKey) pendingSessionCreates.delete(pendingKey);
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

            const nextTabs = {
                ...s.tabsByWorkspace,
                [workspaceKey]: [...existing, tab],
            };

            // If the session was placed in a split pane (:right key) but a
            // broadcast-driven sync already added it to the sibling pane (or
            // vice-versa), remove the duplicate from the sibling.
            if (tab.sessionId) {
                const siblingKey = workspaceKey.endsWith(":right")
                    ? workspaceKey.slice(0, -":right".length)
                    : `${workspaceKey}:right`;
                const siblingTabs = nextTabs[siblingKey];
                if (siblingTabs?.some((t) => t.sessionId === tab.sessionId)) {
                    nextTabs[siblingKey] = siblingTabs.filter((t) => t.sessionId !== tab.sessionId);
                }
            }

            return {
                tabsByWorkspace: nextTabs,
                activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceKey]: tab.id },
            };
        });
    },
    async closeTab(workspaceKey, tabId) {
        const tab = (get().tabsByWorkspace[workspaceKey] ?? []).find((entry) => entry.id === tabId);
        try {
            if (tab?.sessionId) {
                exitedSessions.delete(tab.sessionId);
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
        let hasInitializing = false;
        for (const tab of tabs) {
            if (!tab.sessionId) continue;
            const s = statuses[tab.sessionId];
            if (s === "working") return "working";
            if (s === "attention") hasAttention = true;
            if (s === "initializing") hasInitializing = true;
        }
        if (hasAttention) return "attention";
        if (hasInitializing) return "initializing";
        return undefined;
    },
    renameTab(workspaceKey, tabId, newLabel) {
        const tabs = get().tabsByWorkspace[workspaceKey] ?? [];
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) return;

        // Always lock autoTitle on manual rename, even if label is unchanged
        const labelChanged = tab.label !== newLabel;
        const autoTitleChanged = tab.autoTitle !== false;

        if (!labelChanged && !autoTitleChanged) return;

        set((s) => ({
            tabsByWorkspace: {
                ...s.tabsByWorkspace,
                [workspaceKey]: (s.tabsByWorkspace[workspaceKey] ?? []).map((t) =>
                    t.id === tabId ? { ...t, label: newLabel, autoTitle: false } : t,
                ),
            },
        }));

        if (labelChanged && tab.sessionId) {
            sendFireAndForget(MSG.SESSION_RENAME, {
                sessionId: tab.sessionId,
                label: newLabel,
            });
        }
    },
    reorderTabs(workspaceKey, activeId, overId) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            const oldIndex = tabs.findIndex((t) => t.id === activeId);
            const newIndex = tabs.findIndex((t) => t.id === overId);
            if (oldIndex === -1 || newIndex === -1) return s;
            return {
                tabsByWorkspace: {
                    ...s.tabsByWorkspace,
                    [workspaceKey]: arrayMove(tabs, oldIndex, newIndex),
                },
            };
        });
    },
    updateAutoTitle(workspaceKey, tabId, title) {
        const tabs = get().tabsByWorkspace[workspaceKey] ?? [];
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab || tab.type !== "shell" || tab.autoTitle === false) return;
        if (tab.label === title) return;

        set((s) => ({
            tabsByWorkspace: {
                ...s.tabsByWorkspace,
                [workspaceKey]: (s.tabsByWorkspace[workspaceKey] ?? []).map((t) =>
                    t.id === tabId ? { ...t, label: title, autoTitle: true } : t,
                ),
            },
        }));
    },
    getTabs(workspaceKey) {
        return get().tabsByWorkspace[workspaceKey] ?? [];
    },
    getActiveTab(workspaceKey) {
        const tabs = get().getTabs(workspaceKey);
        return tabs.find((t) => t.id === get().activeTabByWorkspace[workspaceKey]);
    },
    mergeSplitTabs(workspaceKey) {
        set((s) => {
            const rightKey = `${workspaceKey}:right`;
            const rightTabs = s.tabsByWorkspace[rightKey] ?? [];

            const { [rightKey]: _rt, ...tabsWithoutRight } = s.tabsByWorkspace;
            const { [rightKey]: _ra, ...activeWithoutRight } = s.activeTabByWorkspace;

            if (rightTabs.length === 0) {
                return {
                    tabsByWorkspace: tabsWithoutRight,
                    activeTabByWorkspace: activeWithoutRight,
                };
            }

            const baseTabs = tabsWithoutRight[workspaceKey] ?? [];
            const mergedTabs = [...baseTabs, ...rightTabs];

            return {
                tabsByWorkspace: {
                    ...tabsWithoutRight,
                    [workspaceKey]: mergedTabs,
                },
                activeTabByWorkspace: activeWithoutRight,
            };
        });
    },
    moveTabToPane(sourceKey, targetKey, tabId, insertIndex) {
        set((s) => {
            const sourceTabs = s.tabsByWorkspace[sourceKey] ?? [];
            const tab = sourceTabs.find((t) => t.id === tabId);
            if (!tab) return s;

            const newSourceTabs = sourceTabs.filter((t) => t.id !== tabId);
            const targetTabs = s.tabsByWorkspace[targetKey] ?? [];
            const newTargetTabs =
                insertIndex !== undefined
                    ? [...targetTabs.slice(0, insertIndex), tab, ...targetTabs.slice(insertIndex)]
                    : [...targetTabs, tab];

            const currentSourceActive = s.activeTabByWorkspace[sourceKey];
            const sourceActiveId =
                currentSourceActive === tabId
                    ? (newSourceTabs[newSourceTabs.length - 1]?.id ?? "")
                    : currentSourceActive;

            return {
                tabsByWorkspace: {
                    ...s.tabsByWorkspace,
                    [sourceKey]: newSourceTabs,
                    [targetKey]: newTargetTabs,
                },
                activeTabByWorkspace: {
                    ...s.activeTabByWorkspace,
                    [sourceKey]: sourceActiveId,
                    [targetKey]: tab.id,
                },
            };
        });
    },
    syncWithTasks(tasks) {
        set((state) =>
            syncOwnerTabs({
                owners: tasks,
                keyPrefix: "task:",
                getWorkspaceKey: getTaskWorkspaceKey,
                pendingSessionCreates,
                tabsByWorkspace: state.tabsByWorkspace,
                activeTabByWorkspace: state.activeTabByWorkspace,
            }),
        );
    },
    syncWithProjects(projects) {
        set((state) =>
            syncOwnerTabs({
                owners: projects,
                keyPrefix: "project:",
                getWorkspaceKey: getProjectWorkspaceKey,
                pendingSessionCreates,
                tabsByWorkspace: state.tabsByWorkspace,
                activeTabByWorkspace: state.activeTabByWorkspace,
            }),
        );
    },
    syncWithMasterSessions(sessions) {
        set((state) => {
            const workspaceKey = "master";
            const rightKey = "master:right";
            const sessionsById = new Map(sessions.map((s) => [s.id, s]));

            // Process right-pane tabs: filter by session existence only, no new sessions added
            const existingRightTabs = state.tabsByWorkspace[rightKey] ?? [];
            const rightTabs = existingRightTabs
                .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                .map((tab) => {
                    if (!tab.sessionId) return tab;
                    const session = sessionsById.get(tab.sessionId);
                    if (!session) return tab;
                    return {
                        ...tab,
                        type: session.type,
                        ...(tab.autoTitle !== true && {
                            label: normalizeSessionLabel(session.type, session.label),
                        }),
                    };
                });

            // Process base-pane tabs
            const existingTabs = state.tabsByWorkspace[workspaceKey] ?? [];
            const tabs = existingTabs
                .filter((tab) => !tab.sessionId || sessionsById.has(tab.sessionId))
                .map((tab) => {
                    if (!tab.sessionId) return tab;
                    const session = sessionsById.get(tab.sessionId);
                    if (!session) return tab;
                    return {
                        ...tab,
                        type: session.type,
                        ...(tab.autoTitle !== true && {
                            label: normalizeSessionLabel(session.type, session.label),
                        }),
                    };
                });

            if (!pendingSessionCreates.has("master")) {
                for (const session of sessions) {
                    if (!isKnownSessionType(session)) continue;
                    const alreadyInBase = tabs.some((tab) => tab.sessionId === session.id);
                    const alreadyInRight = rightTabs.some((tab) => tab.sessionId === session.id);
                    if (!alreadyInBase && !alreadyInRight) {
                        tabs.push(createSessionTab(session));
                    }
                }
            }

            // Build result by removing stale keys and adding current ones
            const { [workspaceKey]: _wt, [rightKey]: _rt, ...restTabs } = state.tabsByWorkspace;
            const {
                [workspaceKey]: _wa,
                [rightKey]: _ra,
                ...restActive
            } = state.activeTabByWorkspace;

            const nextTabsByWorkspace: Record<string, Tab[]> = { ...restTabs };
            const nextActiveTabByWorkspace: Record<string, string> = { ...restActive };

            if (rightTabs.length > 0) {
                nextTabsByWorkspace[rightKey] = rightTabs;
                const currentRightActiveId = state.activeTabByWorkspace[rightKey];
                nextActiveTabByWorkspace[rightKey] = rightTabs.some(
                    (tab) => tab.id === currentRightActiveId,
                )
                    ? currentRightActiveId
                    : rightTabs[0].id;
            }

            if (tabs.length === 0) {
                return {
                    tabsByWorkspace: nextTabsByWorkspace,
                    activeTabByWorkspace: nextActiveTabByWorkspace,
                };
            }

            const currentActiveId = state.activeTabByWorkspace[workspaceKey];
            nextTabsByWorkspace[workspaceKey] = tabs;
            nextActiveTabByWorkspace[workspaceKey] = tabs.some((tab) => tab.id === currentActiveId)
                ? currentActiveId
                : tabs[0].id;

            return {
                tabsByWorkspace: nextTabsByWorkspace,
                activeTabByWorkspace: nextActiveTabByWorkspace,
            };
        });
    },
}));

// Initialize all event subscriptions after store creation
initSessionSubscriptions(useSessionStore);

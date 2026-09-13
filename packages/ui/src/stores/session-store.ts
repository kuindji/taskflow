import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type {
    AgentLaunchOptions,
    SessionRef,
    Task,
    SessionStatus,
    SessionCreateResponse,
    SessionResumeResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { getPrimary, sendFireAndForget, sendRequest } from "@/lib/connection-registry";
import { useTaskStore } from "./task-store";
import { useProjectStore } from "./project-store";
import {
    getProjectWorkspaceKey,
    getTaskWorkspaceKey,
    workspaceBackendId,
} from "@/hooks/useActiveWorkspace";
import {
    baseWorkspaceKey,
    normalizeSessionLabel,
    createSessionTab,
    isKnownSessionType,
    exitedSessions,
    isSessionExited,
    pushHistory,
    stepHistory,
} from "./session-helpers";
import { syncOwnerTabs } from "./session-sync";
import type { Tab } from "./session-helpers";
import {
    forgetSession,
    markInteraction,
    noteSessionBackend,
    sessionBackendOf,
    sessionsOwnedBy,
} from "./session-activity";
import { initSessionSubscriptions } from "./session-subscriptions";
import { registerBackendReset } from "./store-reset";

/**
 * Owner IDs with an in-flight createSession call that targets a non-default
 * workspace key (e.g. a split right pane). While a create is pending,
 * syncWithTasks/syncWithProjects must not auto-place new sessions for that
 * owner — the createSession caller will place the tab explicitly.
 */
const pendingSessionCreates = new Set<string>();

/** The task and project workspace keys each machine's last sync covered. */
const workspaceKeysByBackend = new Map<string, Set<string>>();
/** The machine whose master sessions the "master" workspace shows. */
let masterBackendId: string | null = null;

/**
 * The keys a sync for one machine may rebuild: the ones its previous list held,
 * so a record that vanished from it takes its tabs along, plus the current ones.
 * Records the current keys as what the next sync starts from.
 */
function claimWorkspaceKeys(backendId: string, keyPrefix: string, keys: string[]): Set<string> {
    const held = workspaceKeysByBackend.get(backendId) ?? new Set<string>();
    const owned = new Set([...held, ...keys]);
    const next = new Set([...held].filter((key) => !key.startsWith(keyPrefix)));
    for (const key of keys) next.add(key);
    workspaceKeysByBackend.set(backendId, next);
    return owned;
}

/**
 * A session change touches the records of the machine it ran on. A failed
 * refetch leaves the previous records in place, as before.
 */
function refetchRecords(
    backendId: string,
    which: { tasks: boolean; projects: boolean },
): Promise<unknown> {
    return Promise.all([
        which.tasks
            ? useTaskStore
                  .getState()
                  .fetchTasks(backendId)
                  .catch(() => {})
            : null,
        which.projects
            ? useProjectStore
                  .getState()
                  .fetchProjects(backendId)
                  .catch(() => {})
            : null,
    ]);
}

/**
 * The machine a session runs on: the one it was created on or last reported
 * from, else the machine of the workspace whose tab holds it.
 */
function sessionBackend(sessionId: string): string | null {
    const noted = sessionBackendOf(sessionId);
    if (noted) return noted;
    for (const [workspaceKey, tabs] of Object.entries(useSessionStore.getState().tabsByWorkspace)) {
        if (tabs.some((tab) => tab.sessionId === sessionId))
            return workspaceBackendId(workspaceKey);
    }
    return null;
}

interface SessionStore {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
    sessionStatus: Partial<Record<string, SessionStatus>>;
    lastTerminalSize: { cols: number; rows: number } | null;
    /**
     * `owner.backendId` names the owner's machine; without it the machine is
     * looked up from the owner's record (master: primary).
     */
    createSession(
        owner: { taskId?: string; projectId?: string; master?: boolean; backendId?: string },
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
    resumeSession(sessionId: string, cols?: number, rows?: number): Promise<void>;
    sendInput(sessionId: string, data: string): void;
    resizeTerminal(sessionId: string, cols: number, rows: number): void;
    addTab(workspaceKey: string, tab: Tab): void;
    closeTab(workspaceKey: string, tabId: string): Promise<void>;
    setActiveTab(workspaceKey: string, tabId: string): void;
    setSessionStatus(sessionId: string, status?: SessionStatus): void;
    getTaskStatus(taskId: string): SessionStatus | undefined;
    renameTab(workspaceKey: string, tabId: string, newLabel: string): void;
    setTabMode(workspaceKey: string, tabId: string, mode: "preview" | "edit"): void;
    setTabScrollTop(workspaceKey: string, tabId: string, scrollTop: number): void;
    navigateTab(workspaceKey: string, tabId: string, filePath: string): void;
    stepTabHistory(workspaceKey: string, tabId: string, delta: -1 | 1): void;
    reorderTabs(workspaceKey: string, activeId: string, overId: string): void;
    updateAutoTitle(workspaceKey: string, tabId: string, title: string): void;
    getTabs(workspaceKey: string): Tab[];
    getActiveTab(workspaceKey: string): Tab | undefined;
    mergeSplitTabs(workspaceKey: string): void;
    moveTabToPane(sourceKey: string, targetKey: string, tabId: string, insertIndex?: number): void;
    /** `tasks` is that machine's whole list; other machines' workspaces are left alone. */
    syncWithTasks(backendId: string, tasks: Task[]): void;
    /** `projects` is that machine's whole list; other machines' workspaces are left alone. */
    syncWithProjects(backendId: string, projects: { id: string; sessions: SessionRef[] }[]): void;
    syncWithMasterSessions(backendId: string, sessions: SessionRef[]): void;
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
        const { backendId: ownerBackendId, ...ownerIds } = owner;
        const ownerId = owner.taskId ?? owner.projectId;
        if (!ownerId && !owner.master)
            throw new Error("Either taskId, projectId, or master is required");

        const ownerWorkspaceKey = owner.taskId
            ? getTaskWorkspaceKey(owner.taskId)
            : ownerId
              ? getProjectWorkspaceKey(ownerId)
              : "master";
        // The session runs where its owner lives; asking any other machine
        // could start it in a checkout that merely shares the path.
        const backendId = ownerBackendId || workspaceBackendId(ownerWorkspaceKey);
        if (!backendId) throw new Error("No attached machine holds this session's owner");

        // When targeting a non-default workspace key (e.g. split right pane),
        // block syncWithTasks from auto-placing the session while we await.
        const pendingKey = ownerId ?? (owner.master ? "master" : undefined);
        if (targetWorkspaceKey && pendingKey) {
            pendingSessionCreates.add(pendingKey);
        }

        const lastTerminalSize = get().lastTerminalSize;
        const { sessionId } = await sendRequest<SessionCreateResponse>(
            backendId,
            MSG.SESSION_CREATE,
            {
                ...ownerIds,
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
            },
        );
        const tab: Tab = {
            id: sessionId,
            type,
            label: normalizeSessionLabel(type, label),
            sessionId,
            ...(type === "shell" && { autoTitle: true }),
            ...(editorOpts && { filePath: editorOpts.filePath }),
        };
        noteSessionBackend(sessionId, backendId);
        get().addTab(targetWorkspaceKey ?? ownerWorkspaceKey, tab);
        if (pendingKey) pendingSessionCreates.delete(pendingKey);
        await refetchRecords(backendId, { tasks: !!owner.taskId, projects: !!owner.projectId });
        return sessionId;
    },
    async closeSession(sessionId) {
        const backendId = sessionBackend(sessionId);
        if (!backendId) throw new Error(`No attached machine runs session ${sessionId}`);
        await sendRequest(backendId, MSG.SESSION_CLOSE, { sessionId });
        await refetchRecords(backendId, { tasks: true, projects: true });
    },
    async resumeSession(sessionId, cols, rows) {
        const backendId = sessionBackend(sessionId);
        if (!backendId) throw new Error(`No attached machine runs session ${sessionId}`);
        set((state) => ({
            tabsByWorkspace: Object.fromEntries(
                Object.entries(state.tabsByWorkspace).map(([key, tabs]) => [
                    key,
                    tabs.map((tab) =>
                        tab.sessionId === sessionId
                            ? { ...tab, sessionState: "resuming" as const }
                            : tab,
                    ),
                ]),
            ),
        }));
        try {
            await sendRequest<SessionResumeResponse>(backendId, MSG.SESSION_RESUME, {
                sessionId,
                cols,
                rows,
            });
        } finally {
            // The master workspace is primary's alone.
            const primary = getPrimary();
            await Promise.all([
                refetchRecords(backendId, { tasks: true, projects: true }),
                primary
                    ? sendRequest<{ sessions: SessionRef[] }>(
                          primary,
                          MSG.MASTER_SESSIONS_LIST,
                      ).then(({ sessions }) => get().syncWithMasterSessions(primary, sessions))
                    : null,
            ]);
        }
    },
    sendInput(sessionId, data) {
        markInteraction(sessionId);
        const backendId = sessionBackend(sessionId);
        if (backendId) sendFireAndForget(backendId, MSG.SESSION_INPUT, { sessionId, data });
    },
    resizeTerminal(sessionId, cols, rows) {
        markInteraction(sessionId);
        set({ lastTerminalSize: { cols, rows } });
        const backendId = sessionBackend(sessionId);
        if (backendId) {
            sendFireAndForget(backendId, MSG.TERMINAL_RESIZE, { sessionId, cols, rows });
        }
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
    setTabMode(workspaceKey, tabId, mode) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId || (tab.mode ?? "preview") === mode) return tab;
                changed = true;
                return { ...tab, mode };
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
    setTabScrollTop(workspaceKey, tabId, scrollTop) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId || tab.previewScrollTop === scrollTop) return tab;
                changed = true;
                return { ...tab, previewScrollTop: scrollTop };
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
    navigateTab(workspaceKey, tabId, filePath) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId) return tab;
                const updated = pushHistory(tab, filePath);
                if (updated !== tab) changed = true;
                return updated;
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
    },
    stepTabHistory(workspaceKey, tabId, delta) {
        set((s) => {
            const tabs = s.tabsByWorkspace[workspaceKey];
            if (!tabs) return s;
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.id !== tabId) return tab;
                const updated = stepHistory(tab, delta);
                if (updated !== tab) changed = true;
                return updated;
            });
            if (!changed) return s;
            return { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceKey]: next } };
        });
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

        const sessionBackendId = tab.sessionId ? sessionBackend(tab.sessionId) : null;
        if (labelChanged && tab.sessionId && sessionBackendId) {
            sendFireAndForget(sessionBackendId, MSG.SESSION_RENAME, {
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
    syncWithTasks(backendId, tasks) {
        const ownedWorkspaceKeys = claimWorkspaceKeys(
            backendId,
            "task:",
            tasks.map((task) => getTaskWorkspaceKey(task.id)),
        );
        set((state) =>
            syncOwnerTabs({
                owners: tasks,
                keyPrefix: "task:",
                getWorkspaceKey: getTaskWorkspaceKey,
                ownedWorkspaceKeys,
                pendingSessionCreates,
                tabsByWorkspace: state.tabsByWorkspace,
                activeTabByWorkspace: state.activeTabByWorkspace,
            }),
        );
    },
    syncWithProjects(backendId, projects) {
        const ownedWorkspaceKeys = claimWorkspaceKeys(
            backendId,
            "project:",
            projects.map((project) => getProjectWorkspaceKey(project.id)),
        );
        set((state) =>
            syncOwnerTabs({
                owners: projects,
                keyPrefix: "project:",
                getWorkspaceKey: getProjectWorkspaceKey,
                ownedWorkspaceKeys,
                pendingSessionCreates,
                tabsByWorkspace: state.tabsByWorkspace,
                activeTabByWorkspace: state.activeTabByWorkspace,
            }),
        );
    },
    syncWithMasterSessions(backendId, sessions) {
        masterBackendId = backendId;
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
                        sessionState: session.state,
                        resumeAvailable:
                            session.state === "interrupted" && Boolean(session.nativeSessionId),
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
                        sessionState: session.state,
                        resumeAvailable:
                            session.state === "interrupted" && Boolean(session.nativeSessionId),
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

registerBackendReset("session-store", (backendId) => {
    const keys = workspaceKeysByBackend.get(backendId) ?? new Set<string>();
    workspaceKeysByBackend.delete(backendId);
    if (masterBackendId === backendId) {
        keys.add("master");
        masterBackendId = null;
    }
    const drops = (key: string): boolean => keys.has(baseWorkspaceKey(key));

    const state = useSessionStore.getState();
    // Sessions this machine reported activity for, and those in its tabs.
    const sessions = new Set(sessionsOwnedBy(backendId));
    const tabsByWorkspace: Record<string, Tab[]> = {};
    for (const [key, tabs] of Object.entries(state.tabsByWorkspace)) {
        if (!drops(key)) {
            tabsByWorkspace[key] = tabs;
            continue;
        }
        for (const tab of tabs) if (tab.sessionId) sessions.add(tab.sessionId);
    }
    for (const sessionId of sessions) forgetSession(sessionId);

    useSessionStore.setState({
        tabsByWorkspace,
        activeTabByWorkspace: Object.fromEntries(
            Object.entries(state.activeTabByWorkspace).filter(([key]) => !drops(key)),
        ),
        sessionStatus: Object.fromEntries(
            Object.entries(state.sessionStatus).filter(([sessionId]) => !sessions.has(sessionId)),
        ),
    });
});

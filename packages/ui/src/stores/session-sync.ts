import type { SessionRef } from "@taskflow/shared";
import type { Tab } from "./session-helpers";
import { createSessionTab, isKnownSessionType, normalizeSessionLabel } from "./session-helpers";

interface SyncOwner {
    id: string;
    sessions: SessionRef[];
}

interface WorkspaceTabState {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
}

interface SyncOwnerTabsArgs extends WorkspaceTabState {
    owners: SyncOwner[];
    keyPrefix: string;
    getWorkspaceKey: (ownerId: string) => string;
    pendingSessionCreates: ReadonlySet<string>;
}

/**
 * Reconcile an existing tab list (filter out dead sessions, refresh type/label)
 * while preserving object references when nothing changed. Returns the
 * original array reference if no tab was added, removed, or modified.
 */
function syncPaneTabs(existing: Tab[], sessionsById: Map<string, SessionRef>): Tab[] {
    let changed = false;
    const next: Tab[] = [];
    for (const tab of existing) {
        if (!tab.sessionId) {
            next.push(tab);
            continue;
        }
        const session = sessionsById.get(tab.sessionId);
        if (!session) {
            changed = true;
            continue;
        }
        const label =
            tab.autoTitle !== true ? normalizeSessionLabel(session.type, session.label) : tab.label;
        if (tab.type === session.type && tab.label === label) {
            next.push(tab);
        } else {
            changed = true;
            next.push({
                ...tab,
                type: session.type,
                ...(tab.autoTitle !== true && { label }),
            });
        }
    }
    return changed ? next : existing;
}

function sameRecord<T>(a: Record<string, T>, b: Record<string, T>): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

/**
 * Rebuild the workspace tab maps for all owners under a key prefix
 * ("task:" or "project:"). Behavior matches the previous inline
 * syncWithTasks/syncWithProjects logic exactly, with one addition:
 * when the result is identical, the ORIGINAL map references are
 * returned so Zustand subscribers don't re-render.
 */
function syncOwnerTabs(args: SyncOwnerTabsArgs): WorkspaceTabState {
    const { owners, keyPrefix, getWorkspaceKey, pendingSessionCreates } = args;

    const nextTabs: Record<string, Tab[]> = {};
    for (const [key, value] of Object.entries(args.tabsByWorkspace)) {
        if (!key.startsWith(keyPrefix)) nextTabs[key] = value;
    }
    const nextActive: Record<string, string> = {};
    for (const [key, value] of Object.entries(args.activeTabByWorkspace)) {
        if (!key.startsWith(keyPrefix)) nextActive[key] = value;
    }

    for (const owner of owners) {
        const workspaceKey = getWorkspaceKey(owner.id);
        const rightKey = `${workspaceKey}:right`;
        const sessionsById = new Map(owner.sessions.map((session) => [session.id, session]));

        // Right-pane tabs: filter by session existence only, no new sessions added
        const rightTabs = syncPaneTabs(args.tabsByWorkspace[rightKey] ?? [], sessionsById);
        if (rightTabs.length > 0) {
            nextTabs[rightKey] = rightTabs;
            const currentRightActiveId = args.activeTabByWorkspace[rightKey];
            nextActive[rightKey] = rightTabs.some((tab) => tab.id === currentRightActiveId)
                ? currentRightActiveId
                : rightTabs[0].id;
        }

        // Base-pane tabs
        let tabs = syncPaneTabs(args.tabsByWorkspace[workspaceKey] ?? [], sessionsById);
        if (!pendingSessionCreates.has(owner.id)) {
            let additions: Tab[] | null = null;
            for (const session of owner.sessions) {
                if (!isKnownSessionType(session)) continue;
                const alreadyInBase = tabs.some((tab) => tab.sessionId === session.id);
                const alreadyInRight = rightTabs.some((tab) => tab.sessionId === session.id);
                const alreadyAdded =
                    additions?.some((tab) => tab.sessionId === session.id) ?? false;
                if (!alreadyInBase && !alreadyInRight && !alreadyAdded) {
                    (additions ??= []).push(createSessionTab(session));
                }
            }
            if (additions) tabs = [...tabs, ...additions];
        }

        if (tabs.length === 0) {
            continue;
        }

        nextTabs[workspaceKey] = tabs;
        const currentActiveId = args.activeTabByWorkspace[workspaceKey];
        nextActive[workspaceKey] = tabs.some((tab) => tab.id === currentActiveId)
            ? currentActiveId
            : tabs[0].id;
    }

    if (
        sameRecord(nextTabs, args.tabsByWorkspace) &&
        sameRecord(nextActive, args.activeTabByWorkspace)
    ) {
        return {
            tabsByWorkspace: args.tabsByWorkspace,
            activeTabByWorkspace: args.activeTabByWorkspace,
        };
    }
    return { tabsByWorkspace: nextTabs, activeTabByWorkspace: nextActive };
}

export { syncOwnerTabs };

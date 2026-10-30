import type { BrowserTab, BrowserTabScope } from "@taskflow/shared";
import type { Tab } from "./session-helpers";

interface WorkspaceTabState {
    tabsByWorkspace: Record<string, Tab[]>;
    activeTabByWorkspace: Record<string, string>;
}

export function syncBrowserTabs(
    state: WorkspaceTabState,
    args: {
        tabs: BrowserTab[];
        workspaceKeyFor: (scope: BrowserTabScope) => string | null;
        knownIds: ReadonlySet<string>;
        initial: boolean;
    },
): WorkspaceTabState {
    const listed = new Map(args.tabs.map((tab) => [tab.id, tab]));
    const placed = new Set<string>();
    let tabsByWorkspace = state.tabsByWorkspace;
    let activeTabByWorkspace = state.activeTabByWorkspace;
    const writeTabs = (key: string, tabs: Tab[]) => {
        if (tabsByWorkspace === state.tabsByWorkspace) tabsByWorkspace = { ...tabsByWorkspace };
        tabsByWorkspace[key] = tabs;
    };
    const activate = (key: string, id: string) => {
        if (activeTabByWorkspace[key] === id) return;
        if (activeTabByWorkspace === state.activeTabByWorkspace)
            activeTabByWorkspace = { ...activeTabByWorkspace };
        activeTabByWorkspace[key] = id;
    };
    for (const [key, tabs] of Object.entries(state.tabsByWorkspace)) {
        const next: Tab[] = [];
        let changed = false;
        for (const tab of tabs) {
            const record = tab.browserTabId ? listed.get(tab.browserTabId) : undefined;
            if (record) {
                placed.add(record.id);
                const label = record.title || record.label;
                const agentConnected = record.agentConnections > 0 ? true : undefined;
                if (
                    tab.label !== label ||
                    tab.url !== record.url ||
                    tab.agentConnected !== agentConnected
                ) {
                    next.push({ ...tab, label, url: record.url, agentConnected });
                    changed = true;
                } else next.push(tab);
            } else if (tab.browserTabId && args.knownIds.has(tab.browserTabId)) {
                changed = true;
            } else next.push(tab);
        }
        if (!changed) continue;
        writeTabs(key, next);
        if (
            tabs.some((tab) => tab.id === activeTabByWorkspace[key]) &&
            !next.some((tab) => tab.id === activeTabByWorkspace[key])
        ) {
            activate(key, next.at(-1)?.id ?? "");
        }
    }
    for (const tab of args.tabs) {
        if (placed.has(tab.id)) continue;
        const key = args.workspaceKeyFor(tab.scope);
        if (!key) continue;
        const next: Tab = {
            id: `browser:${tab.id}`,
            type: "browser",
            browserTabId: tab.id,
            label: tab.title || tab.label,
            url: tab.url,
            agentConnected: tab.agentConnections > 0 ? true : undefined,
        };
        writeTabs(key, [...(tabsByWorkspace[key] ?? []), next]);
        if (!args.initial && !args.knownIds.has(tab.id)) activate(key, next.id);
    }
    return tabsByWorkspace === state.tabsByWorkspace &&
        activeTabByWorkspace === state.activeTabByWorkspace
        ? state
        : { tabsByWorkspace, activeTabByWorkspace };
}

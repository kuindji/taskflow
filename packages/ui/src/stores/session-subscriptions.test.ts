import { expect, test } from "bun:test";
import { createStore } from "zustand";
import type { BrowserTab, SessionStatus } from "@taskflow/shared";
import { setPrimary } from "@/lib/connection-registry";
import { MASTER_WORKSPACE_KEY } from "@/hooks/useActiveWorkspace";
import { useBrowserTabStore } from "./browser-tab-store";
import type { Tab } from "./session-helpers";
import { initSessionSubscriptions } from "./session-subscriptions";

const masterTab: BrowserTab = {
    id: "m1",
    scope: { kind: "master" },
    label: "m1",
    url: "about:blank",
    createdAt: "2026-10-30T00:00:00Z",
    loaded: false,
    agentConnections: 0,
};

test("master browser tabs listed before their backend became primary appear on promotion", () => {
    const store = createStore<{
        tabsByWorkspace: Record<string, Tab[]>;
        activeTabByWorkspace: Record<string, string>;
        sessionStatus: Partial<Record<string, SessionStatus>>;
        setSessionStatus(sessionId: string, status?: SessionStatus): void;
        setActiveTab(workspaceKey: string, tabId: string): void;
        addTab(workspaceKey: string, tab: Tab): void;
        syncWithMasterSessions(
            backendId: string,
            sessions: { id: string; type: Tab["type"] }[],
        ): void;
    }>()(() => ({
        tabsByWorkspace: {},
        activeTabByWorkspace: {},
        sessionStatus: {},
        setSessionStatus() {},
        setActiveTab() {},
        addTab() {},
        syncWithMasterSessions() {},
    }));
    initSessionSubscriptions(store);
    setPrimary("remote");
    useBrowserTabStore.setState({
        byBackend: { local: { tabs: [masterTab], hostAvailable: true } },
        initialByBackend: { local: true },
    });
    expect(store.getState().tabsByWorkspace[MASTER_WORKSPACE_KEY]).toBeUndefined();

    setPrimary("local");
    expect(
        store.getState().tabsByWorkspace[MASTER_WORKSPACE_KEY]?.map((tab) => tab.browserTabId),
    ).toEqual(["m1"]);
    expect(store.getState().activeTabByWorkspace[MASTER_WORKSPACE_KEY]).toBeUndefined();
});

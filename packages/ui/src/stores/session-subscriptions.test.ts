import { expect, test } from "bun:test";
import { createStore } from "zustand";
import {
    MSG,
    type BrowserTab,
    type BrowserTabListResponse,
    type SessionStatus,
} from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer } from "@/lib/test-ws-server";
import { MASTER_WORKSPACE_KEY } from "@/hooks/useActiveWorkspace";
import { useBrowserTabStore } from "./browser-tab-store";
import type { Tab } from "./session-helpers";
import { useSessionStore } from "./session-store";
import { initSessionSubscriptions } from "./session-subscriptions";
import { resetBackend } from "./store-reset";

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

test("the old primary's teardown keeps the new primary's master browser tabs", async () => {
    const server = startTestServer("new", (type) =>
        type === MSG.BROWSER_TABS_LIST
            ? ({
                  tabs: [{ ...masterTab, id: "m2" }],
                  hostAvailable: true,
              } satisfies BrowserTabListResponse)
            : {},
    );
    try {
        setPrimary("old");
        useSessionStore
            .getState()
            .syncWithMasterSessions("old", [
                {
                    id: "s-old",
                    type: "shell",
                    label: "old shell",
                    createdAt: "2026-10-30T00:00:00Z",
                },
            ]);
        await openConnection("new", server.origin);
        await useBrowserTabStore.getState().fetchBrowserTabs("new");
        setPrimary("new");
        resetBackend("old");
        expect(
            useSessionStore
                .getState()
                .tabsByWorkspace[
                    MASTER_WORKSPACE_KEY
                ]?.map((tab) => tab.browserTabId ?? tab.sessionId),
        ).toEqual(["m2"]);
    } finally {
        closeConnection("new", "detach");
        resetBackend("new");
        server.stop();
    }
});

import { describe, expect, test } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { syncOwnerTabs } from "./session-sync";
import { createSessionTab } from "./session-helpers";

function makeSession(id: string, label = "Claude"): SessionRef {
    return {
        id,
        type: "claude",
        label,
        createdAt: "2026-01-01T00:00:00.000Z",
        instance: "test",
    };
}

const baseArgs = {
    keyPrefix: "task:",
    getWorkspaceKey: (id: string) => `task:${id}`,
    pendingSessionCreates: new Set<string>(),
};

describe("syncOwnerTabs", () => {
    test("refreshes interrupted and resume availability state", () => {
        const live = makeSession("session-1");
        const tab = createSessionTab(live);
        const interrupted = {
            ...live,
            state: "interrupted" as const,
            nativeSessionId: "native-1",
        };
        const result = syncOwnerTabs({
            owners: [{ id: "owner-1", sessions: [interrupted] }],
            keyPrefix: "task:",
            getWorkspaceKey: () => "task:owner-1",
            tabsByWorkspace: { "task:owner-1": [tab] },
            activeTabByWorkspace: { "task:owner-1": tab.id },
            pendingSessionCreates: new Set(),
        });
        expect(result.tabsByWorkspace["task:owner-1"][0].sessionState).toBe("interrupted");
        expect(result.tabsByWorkspace["task:owner-1"][0].resumeAvailable).toBe(true);
    });

    test("returns identical references when nothing changed", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const tabsByWorkspace = { "task:t1": [tab] };
        const activeTabByWorkspace = { "task:t1": tab.id };

        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace,
            activeTabByWorkspace,
        });

        expect(result.tabsByWorkspace).toBe(tabsByWorkspace);
        expect(result.activeTabByWorkspace).toBe(activeTabByWorkspace);
    });

    test("changed label produces new refs only for the affected workspace", () => {
        const s1 = makeSession("s1");
        const s2 = makeSession("s2");
        const tab1 = createSessionTab(s1);
        const tab2 = createSessionTab(s2);
        const tabsByWorkspace = { "task:t1": [tab1], "task:t2": [tab2] };
        const activeTabByWorkspace = { "task:t1": tab1.id, "task:t2": tab2.id };

        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [
                { id: "t1", sessions: [s1] },
                { id: "t2", sessions: [{ ...s2, label: "Renamed" }] },
            ],
            tabsByWorkspace,
            activeTabByWorkspace,
        });

        expect(result.tabsByWorkspace).not.toBe(tabsByWorkspace);
        expect(result.tabsByWorkspace["task:t1"]).toBe(tabsByWorkspace["task:t1"]);
        expect(result.tabsByWorkspace["task:t2"]).not.toBe(tabsByWorkspace["task:t2"]);
        expect(result.tabsByWorkspace["task:t2"][0].label).toBe("Renamed");
    });

    test("drops tabs whose session no longer exists", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [] }],
            tabsByWorkspace: { "task:t1": [tab] },
            activeTabByWorkspace: { "task:t1": tab.id },
        });
        expect(result.tabsByWorkspace["task:t1"]).toBeUndefined();
        expect(result.activeTabByWorkspace["task:t1"]).toBeUndefined();
    });

    test("auto-adds new sessions to the base pane", () => {
        const session = makeSession("s1");
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace: {},
            activeTabByWorkspace: {},
        });
        const tabs = result.tabsByWorkspace["task:t1"];
        expect(tabs).toHaveLength(1);
        expect(tabs[0].sessionId).toBe("s1");
        expect(result.activeTabByWorkspace["task:t1"]).toBe(tabs[0].id);
    });

    test("does not auto-add sessions while a create is pending for the owner", () => {
        const session = makeSession("s1");
        const result = syncOwnerTabs({
            ...baseArgs,
            pendingSessionCreates: new Set(["t1"]),
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace: {},
            activeTabByWorkspace: {},
        });
        expect(result.tabsByWorkspace["task:t1"]).toBeUndefined();
    });

    test("preserves workspace keys with other prefixes by reference", () => {
        const otherTabs = [createSessionTab(makeSession("other"))];
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [],
            tabsByWorkspace: { "project:p1": otherTabs },
            activeTabByWorkspace: { "project:p1": otherTabs[0].id },
        });
        expect(result.tabsByWorkspace["project:p1"]).toBe(otherTabs);
    });

    test("right-pane tabs are preserved by reference when nothing changed", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const rightKey = "task:t1:right";
        const tabsByWorkspace = { [rightKey]: [tab] };
        const activeTabByWorkspace = { [rightKey]: tab.id };
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [session] }],
            tabsByWorkspace,
            activeTabByWorkspace,
        });
        expect(result.tabsByWorkspace[rightKey]).toBe(tabsByWorkspace[rightKey]);
        expect(result.activeTabByWorkspace[rightKey]).toBe(tab.id);
    });

    test("right-pane tabs and active entry are removed when session disappears", () => {
        const session = makeSession("s1");
        const tab = createSessionTab(session);
        const rightKey = "task:t1:right";
        const result = syncOwnerTabs({
            ...baseArgs,
            owners: [{ id: "t1", sessions: [] }],
            tabsByWorkspace: { [rightKey]: [tab] },
            activeTabByWorkspace: { [rightKey]: tab.id },
        });
        expect(result.tabsByWorkspace[rightKey]).toBeUndefined();
        expect(result.activeTabByWorkspace[rightKey]).toBeUndefined();
    });
});

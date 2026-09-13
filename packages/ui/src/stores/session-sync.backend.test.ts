import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionRef, Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { syncOwnerTabs } from "./session-sync";
import { createSessionTab } from "./session-helpers";
import { useSessionStore } from "./session-store";
import { resetBackend } from "./store-reset";

function makeSession(id: string): SessionRef {
    return {
        id,
        type: "claude",
        label: "Claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        instance: "test",
    };
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the store");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe("syncOwnerTabs scoped to one backend", () => {
    test("a sync for one machine leaves another machine's tabs alone", () => {
        const laptop = makeSession("session-laptop");
        const desktop = makeSession("session-desktop");
        const laptopTab = createSessionTab(laptop);
        const desktopTab = createSessionTab(desktop);

        const result = syncOwnerTabs({
            owners: [{ id: "laptop-task", sessions: [laptop] }],
            keyPrefix: "task:",
            getWorkspaceKey: (id: string) => `task:${id}`,
            // Only the laptop's workspaces are this sync's business.
            ownedWorkspaceKeys: new Set(["task:laptop-task"]),
            tabsByWorkspace: {
                "task:laptop-task": [laptopTab],
                "task:desktop-task": [desktopTab],
            },
            activeTabByWorkspace: {
                "task:laptop-task": laptopTab.id,
                "task:desktop-task": desktopTab.id,
            },
            pendingSessionCreates: new Set<string>(),
        });

        expect(result.tabsByWorkspace["task:laptop-task"]).toHaveLength(1);
        expect(result.tabsByWorkspace["task:desktop-task"]).toEqual([desktopTab]);
        expect(result.activeTabByWorkspace["task:desktop-task"]).toBe(desktopTab.id);
    });

    test("an owned workspace whose session is gone loses its right pane too", () => {
        const session = makeSession("session-1");
        const tab = createSessionTab(session);

        const result = syncOwnerTabs({
            owners: [{ id: "t1", sessions: [] }],
            keyPrefix: "task:",
            getWorkspaceKey: (id: string) => `task:${id}`,
            ownedWorkspaceKeys: new Set(["task:t1"]),
            tabsByWorkspace: { "task:t1:right": [tab] },
            activeTabByWorkspace: { "task:t1:right": tab.id },
            pendingSessionCreates: new Set<string>(),
        });

        expect(result.tabsByWorkspace["task:t1:right"]).toBeUndefined();
        expect(result.activeTabByWorkspace["task:t1:right"]).toBeUndefined();
    });
});

function task(id: string, sessions: SessionRef[]): Task {
    return {
        id,
        projectId: "p",
        title: id,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions,
        attributes: [],
        createdAt: "2026-09-13T00:00:00.000Z",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

const servers: TestServer[] = [];

beforeEach(() => {
    useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {}, sessionStatus: {} });
});

afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
});

describe("session store across two backends", () => {
    test("a machine's list prunes its own vanished task and keeps the other machine's", () => {
        const store = useSessionStore.getState();
        store.syncWithTasks("a", [task("ta", [makeSession("sa")])]);
        store.syncWithTasks("b", [task("tb", [makeSession("sb")])]);

        // The task was deleted on a; b's list is not in this sync at all.
        useSessionStore.getState().syncWithTasks("a", []);

        const { tabsByWorkspace } = useSessionStore.getState();
        expect(tabsByWorkspace["task:ta"]).toBeUndefined();
        expect(tabsByWorkspace["task:tb"]?.map((tab) => tab.sessionId)).toEqual(["sb"]);
    });

    test("detaching a machine drops its tabs and statuses, not another machine's", () => {
        const store = useSessionStore.getState();
        store.syncWithTasks("a", [task("ta", [makeSession("sa")])]);
        store.syncWithProjects("a", [{ id: "pa", sessions: [makeSession("spa")] }]);
        store.syncWithTasks("b", [task("tb", [makeSession("sb")])]);
        store.setSessionStatus("sa", "working");
        store.setSessionStatus("spa", "attention");
        store.setSessionStatus("sb", "working");

        resetBackend("a");

        const state = useSessionStore.getState();
        expect(Object.keys(state.tabsByWorkspace)).toEqual(["task:tb"]);
        expect(Object.keys(state.activeTabByWorkspace)).toEqual(["task:tb"]);
        expect(state.sessionStatus).toEqual({ sb: "working" });
    });

    test("an activity debounce armed before a detach does not bring the status back", async () => {
        const server = startTestServer("A");
        servers.push(server);
        await openConnection("a", server.origin);
        useSessionStore.getState().syncWithTasks("a", [task("ta", [makeSession("sa")])]);

        // Output from a machine that is not primary still drives its session.
        server.broadcast(MSG.TERMINAL_OUTPUT, { sessionId: "sa", data: "x" });
        await until(() => useSessionStore.getState().sessionStatus.sa === "working");

        closeConnection("a", "detach");
        resetBackend("a");
        // Past the 3 s working → attention debounce.
        await new Promise((resolve) => setTimeout(resolve, 3300));

        expect(useSessionStore.getState().sessionStatus).toEqual({});
    }, 10_000);

    test("another machine's master sessions do not show in primary's master workspace", async () => {
        const serverA = startTestServer("A");
        const serverB = startTestServer("B");
        servers.push(serverA, serverB);
        await openConnection("a", serverA.origin);
        await openConnection("b", serverB.origin);
        setPrimary("a");

        serverA.broadcast(MSG.MASTER_SESSIONS_LIST, { sessions: [makeSession("master-a")] });
        await until(() => (useSessionStore.getState().tabsByWorkspace.master ?? []).length > 0);

        serverB.broadcast(MSG.MASTER_SESSIONS_LIST, { sessions: [makeSession("master-b")] });
        // One socket delivers in send order, so once this status lands b's list has too.
        serverB.broadcast(MSG.SESSION_STATUS, { sessionId: "probe", status: "working" });
        await until(() => useSessionStore.getState().sessionStatus.probe === "working");

        expect(useSessionStore.getState().tabsByWorkspace.master.map((t) => t.sessionId)).toEqual([
            "master-a",
        ]);
    });
});

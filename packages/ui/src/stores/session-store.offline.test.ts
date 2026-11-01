import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import { closeConnection, onStatusChange, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { noteSessionBackend } from "./session-activity";
import type { Tab } from "./session-helpers";
import { useSessionStore } from "./session-store";

const tab: Tab = { id: "tab-1", type: "claude", label: "Claude", sessionId: "s1" };
const workspaceKey = "task:t1";

let server: TestServer | null = null;

beforeEach(() => {
    useSessionStore.setState({
        tabsByWorkspace: { [workspaceKey]: [tab] },
        activeTabByWorkspace: { [workspaceKey]: tab.id },
    });
});

afterEach(() => {
    closeConnection("remote", "detach");
    server?.stop();
    server = null;
});

async function dropConnection(): Promise<void> {
    const dropped = new Promise<void>((resolve) => {
        const off = onStatusChange("remote", (status) => {
            if (status.connected) return;
            queueMicrotask(off);
            resolve();
        });
    });
    server?.stop();
    await dropped;
}

async function attachRemote(): Promise<TestServer> {
    server = startTestServer("remote");
    await openConnection("remote", server.origin);
    noteSessionBackend("s1", "remote");
    return server;
}

function tabIds(): string[] {
    return (useSessionStore.getState().tabsByWorkspace[workspaceKey] ?? []).map((t) => t.id);
}

describe("closeTab", () => {
    it("keeps the tab when its attached machine cannot take the close", async () => {
        const remote = await attachRemote();
        await dropConnection();

        const error = await useSessionStore
            .getState()
            .closeTab(workspaceKey, tab.id)
            .then(
                () => null,
                (reason: unknown) => reason,
            );

        expect(error).toBeInstanceOf(Error);
        expect(remote.received.some((r) => r.type === MSG.SESSION_CLOSE)).toBe(false);
        expect(tabIds()).toEqual([tab.id]);
    });

    it("drops the tab of a session no attached machine runs", async () => {
        noteSessionBackend("s1", "gone");

        await useSessionStore.getState().closeTab(workspaceKey, tab.id);

        expect(tabIds()).toEqual([]);
    });
});

describe("sendInput", () => {
    it("reports whether the input reached the session's machine", async () => {
        await attachRemote();
        expect(useSessionStore.getState().sendInput("s1", "review this")).toBe(true);

        await dropConnection();

        // The prompt editor keeps its draft on false.
        expect(useSessionStore.getState().sendInput("s1", "review this")).toBe(false);
    });
});

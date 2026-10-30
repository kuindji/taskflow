import { afterEach, expect, test } from "bun:test";
import { MSG, type BrowserTab, type BrowserTabListResponse } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { resetBackend } from "./store-reset";
import { useBrowserTabStore } from "./browser-tab-store";

const servers: TestServer[] = [];
const tab = (id: string): BrowserTab => ({
    id,
    scope: { kind: "master" },
    label: id,
    url: "about:blank",
    createdAt: "2026-10-30T00:00:00Z",
    loaded: false,
    agentConnections: 0,
});
async function attach(id: string, tabs: BrowserTab[], hostAvailable = true) {
    const server = startTestServer(id, (type) =>
        type === MSG.BROWSER_TABS_LIST
            ? ({ tabs, hostAvailable } satisfies BrowserTabListResponse)
            : {},
    );
    servers.push(server);
    await openConnection(id, server.origin);
    await useBrowserTabStore.getState().fetchBrowserTabs(id);
    return server;
}
afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
});
test("bootstrap fetch stores the list per backend", async () => {
    await attach("a", [tab("1")]);
    await attach("b", [tab("2")], false);
    expect(useBrowserTabStore.getState().byBackend).toEqual({
        a: { tabs: [tab("1")], hostAvailable: true },
        b: { tabs: [tab("2")], hostAvailable: false },
    });
});
test("broadcast replaces that backend's list", async () => {
    const a = await attach("a", [tab("1")]);
    await attach("b", [tab("2")]);
    a.broadcast(MSG.BROWSER_TABS_LIST, { tabs: [tab("3")], hostAvailable: false });
    const deadline = Date.now() + 2000;
    while (useBrowserTabStore.getState().byBackend.a?.tabs[0]?.id !== "3") {
        if (Date.now() > deadline) throw new Error("broadcast timed out");
        await Bun.sleep(10);
    }
    expect(useBrowserTabStore.getState().byBackend).toEqual({
        a: { tabs: [tab("3")], hostAvailable: false },
        b: { tabs: [tab("2")], hostAvailable: true },
    });
});
test("reset drops only that backend", async () => {
    await attach("a", [tab("1")]);
    await attach("b", [tab("2")]);
    resetBackend("a");
    expect(useBrowserTabStore.getState().byBackend).toEqual({
        b: { tabs: [tab("2")], hostAvailable: true },
    });
});

test("a backend without the browser API leaves its registry empty", async () => {
    const server = startTestServer("a", () => ({}));
    servers.push(server);
    await openConnection("a", server.origin);
    let failure: unknown;
    try {
        await useBrowserTabStore.getState().fetchBrowserTabs("a");
    } catch (error) {
        failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Invalid browser tab list");
    expect(useBrowserTabStore.getState().byBackend.a).toBeUndefined();
});

import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setPrimary } from "@/lib/connection-registry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const show = mock(async () => {});
Object.defineProperty(window, "taskflow", {
    configurable: true,
    value: {
        sendTrayState: () => {},
        onBackendsChanged: () => () => {},
        onBackendDropped: () => () => {},
        onBackendSeen: () => () => {},
        browser: {
            show,
            hide: async () => {},
            navigate: async () => {},
            back: async () => {},
            reload: async () => {},
            freeze: async () => "",
            onNavState: () => () => {},
        },
    },
});
const { TabContent } = await import("./TabContent");
const { useBackendStore } = await import("@/stores/backend-store");
const { useBrowserTabStore } = await import("@/stores/browser-tab-store");
const { useUIStore } = await import("@/stores/ui-store");
const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
test("a registry tab renders HostedBrowserPane and a legacy tab renders LegacyBrowserPane", async () => {
    setPrimary("local");
    useUIStore.setState({ masterWorkspaceActive: true });
    useBackendStore.setState({
        machines: [
            {
                id: "local",
                displayName: "This machine",
                host: "127.0.0.1",
                instanceId: "main",
                state: "attached",
                isLocal: true,
                keepAttached: true,
            },
        ],
    });
    useBrowserTabStore.setState({
        byBackend: {
            local: {
                hostAvailable: true,
                tabs: [
                    {
                        id: "a",
                        scope: { kind: "master" },
                        label: "A",
                        url: "about:blank",
                        loaded: true,
                        agentConnections: 0,
                        createdAt: "2026-10-30T00:00:00Z",
                    },
                ],
            },
        },
    });
    act(() =>
        root.render(
            <TabContent
                tabs={[
                    {
                        id: "browser:a",
                        type: "browser",
                        label: "A",
                        browserTabId: "a",
                        url: "about:blank",
                    },
                ]}
                activeTabId="browser:a"
                workspaceKey="master"
            />,
        ),
    );
    await act(async () => {
        await Bun.sleep(40);
    });
    expect(show).toHaveBeenCalled();
    expect(container.querySelector("webview")).toBeNull();
    act(() =>
        root.render(
            <TabContent
                tabs={[{ id: "legacy", type: "browser", label: "Legacy", url: "about:blank" }]}
                activeTabId="legacy"
                workspaceKey="master"
            />,
        ),
    );
    expect(container.querySelector("webview")).not.toBeNull();
});

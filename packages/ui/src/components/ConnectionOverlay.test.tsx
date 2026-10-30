import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { WsContext } from "@/providers/ws-context";
import { useBackendStore } from "@/stores/backend-store";
// @ts-expect-error react act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
const original = useBackendStore.getState();
afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn());
    useBackendStore.setState(original);
});
function mount(local: boolean) {
    const id = local ? "local" : "remote";
    useBackendStore.setState({
        primaryId: id,
        machines: [
            {
                id,
                displayName: id,
                host: "host",
                instanceId: "main",
                state: "offline",
                isLocal: local,
                keepAttached: true,
                failure: {
                    kind: "unauthorized",
                    message: "Remote backend rejected the access token",
                    stderr: "",
                },
            },
        ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
        root.render(
            <WsContext.Provider value={{ connected: false, error: null }}>
                <ConnectionOverlay />
            </WsContext.Provider>,
        ),
    );
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return container;
}
test("a primary remote rejected for its token shows the message and returns to local", async () => {
    let calls = 0;
    useBackendStore.setState({
        returnToLocal: async () => {
            calls++;
            return { ok: true };
        },
    });
    const container = mount(false);
    expect(container.textContent).toContain("Connection Failed");
    expect(container.textContent).toContain("Remote backend rejected the access token");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(calls).toBe(1);
});
test("a disconnected local primary shows no return button", () => {
    const container = mount(true);
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Connecting to backend...");
});

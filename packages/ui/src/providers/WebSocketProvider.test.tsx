import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { onBackendReady } from "../lib/backend-ready";
import { installFakeBridge, uninstallFakeBridge } from "../stores/fake-desktop-bridge";
import { closeConnection, onStatusChange } from "../lib/connection-registry";

async function waitUntil(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 3500;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out");
        await Bun.sleep(10);
    }
}

test("the dev renderer publishes backend ready when its socket reconnects", async () => {
    const savedBridge = window.taskflow;
    await installFakeBridge();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const savedPort = process.env.VITE_BACKEND_PORT,
        savedToken = process.env.VITE_BACKEND_TOKEN;
    delete window.taskflow;
    const start = (port: number) =>
        Bun.serve({
            port,
            hostname: "127.0.0.1",
            fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
            websocket: {
                message(ws, raw) {
                    const r = JSON.parse(String(raw)) as { correlationId?: string };
                    if (r.correlationId)
                        ws.send(
                            JSON.stringify({
                                correlationId: r.correlationId,
                                payload: { online: true },
                            }),
                        );
                },
            },
        });
    let server = start(0);
    const port = server.port ?? 0;
    process.env.VITE_BACKEND_PORT = String(port);
    process.env.VITE_BACKEND_TOKEN = "test-token";
    const ids: string[] = [];
    const off = onBackendReady((id) => ids.push(id));
    let connected = false;
    const offStatus = onStatusChange("local", (status) => {
        connected = status.connected;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
        const { WebSocketProvider } = await import("./WebSocketProvider");
        await act(async () => {
            root.render(
                <WebSocketProvider>
                    <div />
                </WebSocketProvider>,
            );
        });
        await act(async () => {
            await waitUntil(() => connected);
        });
        expect(ids).toEqual([]);
        await server.stop(true);
        await act(async () => {
            await waitUntil(() => !connected);
        });
        server = start(port);
        await act(async () => {
            await waitUntil(() => connected);
        });
        expect(ids).toEqual(["local"]);
        await act(async () => {
            root.unmount();
        });
        await server.stop(true);
        await waitUntil(() => !connected);
        server = start(port);
        await waitUntil(() => connected);
        expect(ids).toEqual(["local"]);
    } finally {
        await act(async () => {
            root.unmount();
        });
        closeConnection("local", "detach");
        off();
        offStatus();
        await server.stop(true);
        container.remove();
        uninstallFakeBridge();
        if (savedBridge) window.taskflow = savedBridge;
        if (savedPort === undefined) delete process.env.VITE_BACKEND_PORT;
        else process.env.VITE_BACKEND_PORT = savedPort;
        if (savedToken === undefined) delete process.env.VITE_BACKEND_TOKEN;
        else process.env.VITE_BACKEND_TOKEN = savedToken;
    }
});

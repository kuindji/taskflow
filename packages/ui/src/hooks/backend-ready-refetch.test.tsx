import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import { notifyBackendReady } from "@/lib/backend-ready";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { initConnectivity, useConnectivity } from "./useConnectivity";
import { useRemoteAgentStatus } from "./useRemoteAgentStatus";

const BACKEND = "ready-refetch";
let remoteOnline = false;
let agentRunning = false;
let server: ReturnType<typeof startServer>;

/** Each tick is its own `act`, so React commits what arrived before the next check. */
async function waitUntil(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out");
        await act(async () => {
            await Bun.sleep(10);
        });
    }
}

function startServer() {
    return Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            message(ws, raw) {
                const r = JSON.parse(String(raw)) as { correlationId?: string; type?: string };
                if (!r.correlationId) return;
                const payload =
                    r.type === MSG.REMOTE_AGENT_STATUS
                        ? { running: agentRunning }
                        : { online: remoteOnline };
                ws.send(JSON.stringify({ correlationId: r.correlationId, payload }));
            },
        },
    });
}

beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    server = startServer();
});

afterAll(async () => {
    closeConnection(BACKEND, "detach");
    await server.stop(true);
});

test("primary's connectivity is asked again when its connection is ready again", async () => {
    await openConnection(BACKEND, `http://127.0.0.1:${server.port}`, "test-token");
    setPrimary(BACKEND);
    function Probe() {
        return <>{String(useConnectivity())}</>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    const online = () => container.textContent;
    await act(async () => {
        root.render(<Probe />);
    });
    remoteOnline = false;
    initConnectivity(BACKEND);
    await waitUntil(() => online() === "false");
    // The change was broadcast while this client was away.
    remoteOnline = true;
    notifyBackendReady(BACKEND);
    await waitUntil(() => online() === "true");
    expect(online()).toBe("true");
    await act(async () => {
        root.unmount();
    });
});

test("a remote agent status read before the connection existed is asked again once it is ready", async () => {
    closeConnection(BACKEND, "detach");
    agentRunning = true;
    function Probe() {
        return <>{String(useRemoteAgentStatus(BACKEND).running)}</>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    const running = () => container.textContent;
    await act(async () => {
        root.render(<Probe />);
    });
    expect(running()).toBe("false");
    await openConnection(BACKEND, `http://127.0.0.1:${server.port}`, "test-token");
    notifyBackendReady(BACKEND);
    await waitUntil(() => running() === "true");
    expect(running()).toBe("true");
    await act(async () => {
        root.unmount();
    });
});

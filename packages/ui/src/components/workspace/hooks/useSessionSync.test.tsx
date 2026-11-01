import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import type { FlowRun } from "@taskflow/shared";
import { notifyBackendReady } from "@/lib/backend-ready";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { MASTER_WORKSPACE_KEY } from "@/hooks/useActiveWorkspace";
import { useSessionSync } from "./useSessionSync";

const BACKEND = "session-sync-flow-runs";
let runs: FlowRun[] = [];
let server: ReturnType<typeof startServer>;

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
                    r.type === MSG.FLOW_RUNS_LIST
                        ? { runs }
                        : r.type === MSG.FLOW_DEFINITIONS_LIST
                          ? { flows: [] }
                          : r.type === MSG.FLOW_ACTIONS_LIST
                            ? { actions: [] }
                            : { shells: [], systemShellPath: "/bin/sh" };
                ws.send(JSON.stringify({ correlationId: r.correlationId, payload }));
            },
        },
    });
}

async function waitUntil(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out");
        await act(async () => {
            await Bun.sleep(10);
        });
    }
}

beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    server = startServer();
});

afterAll(async () => {
    closeConnection(BACKEND, "detach");
    await server.stop(true);
});

test("a flow run that finished while the machine was away is cleared once it is ready again", async () => {
    await openConnection(BACKEND, `http://127.0.0.1:${server.port}`, "test-token");
    setPrimary(BACKEND);
    runs = [
        {
            master: true,
            flowId: "flow-1",
            status: "running",
            currentActionIndex: 0,
            actions: [{ actionEntryId: "entry-1", status: "running" }],
            artifacts: [],
            startedAt: "2026-11-01T00:00:00.000Z",
        },
    ];
    const workspace = {
        scope: "master" as const,
        task: null,
        project: null,
        workingDir: null,
        workspaceKey: MASTER_WORKSPACE_KEY,
    };
    function Probe() {
        const { activeFlowRun } = useSessionSync(workspace);
        return <>{activeFlowRun?.status ?? "none"}</>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
        root.render(<Probe />);
    });
    await waitUntil(() => container.textContent === "running");
    // The run's completion was broadcast while this client was disconnected.
    runs = [{ ...runs[0], status: "completed" }];
    notifyBackendReady(BACKEND);
    await waitUntil(() => container.textContent === "none");
    expect(container.textContent).toBe("none");
    await act(async () => {
        root.unmount();
    });
});

test("the default shell is never one resolved for the previously selected machine", async () => {
    const held: { releaseLinux?: () => void } = {};
    function shellServer(shell: string, hold: boolean) {
        return Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ok")),
            websocket: {
                message(ws, raw) {
                    const r = JSON.parse(String(raw)) as { correlationId?: string; type?: string };
                    if (!r.correlationId) return;
                    const payload =
                        r.type === MSG.SHELLS_LIST
                            ? { shells: [{ name: shell, path: shell }], systemShellPath: shell }
                            : r.type === MSG.FLOW_RUNS_LIST
                              ? { runs: [] }
                              : r.type === MSG.FLOW_DEFINITIONS_LIST
                                ? { flows: [] }
                                : { actions: [] };
                    const send = () =>
                        ws.send(JSON.stringify({ correlationId: r.correlationId, payload }));
                    if (hold && r.type === MSG.SHELLS_LIST) held.releaseLinux = send;
                    else send();
                },
            },
        });
    }
    const mac = shellServer("/bin/zsh", false);
    const linux = shellServer("/bin/bash", true);
    await openConnection("shell-mac", `http://127.0.0.1:${mac.port}`, "test-token");
    await openConnection("shell-linux", `http://127.0.0.1:${linux.port}`, "test-token");
    setPrimary("shell-mac");
    const workspace = {
        scope: "master" as const,
        task: null,
        project: null,
        workingDir: null,
        workspaceKey: MASTER_WORKSPACE_KEY,
    };
    function Probe() {
        const { defaultShellPath, backendId } = useSessionSync(workspace);
        return <>{`${backendId}:${defaultShellPath ?? "none"}`}</>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
        root.render(<Probe />);
    });
    await waitUntil(() => container.textContent === "shell-mac:/bin/zsh");

    // The workspace moves to the other machine; its shell list is still in flight.
    setPrimary("shell-linux");
    await act(async () => {
        root.render(<Probe />);
    });
    await waitUntil(() => held.releaseLinux !== undefined);
    expect(container.textContent).toBe("shell-linux:none");

    held.releaseLinux?.();
    await waitUntil(() => container.textContent === "shell-linux:/bin/bash");
    await act(async () => {
        root.unmount();
    });
    closeConnection("shell-mac", "detach");
    closeConnection("shell-linux", "detach");
    await mac.stop(true);
    await linux.stop(true);
});

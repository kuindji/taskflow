import { startBackend } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient } from "../net/client";
import { Store } from "../state/store";
import { SessionController } from "../sessions/controller";
import { ownerRequest } from "../sessions/owner";
import { OpenTuiApp } from "./app";
import { OpenTuiRuntimeOwner } from "./runtime";
import { SessionBridge } from "./session-bridge";

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let app: OpenTuiApp | null = null;
    let store: Store | null = null;
    let controller: SessionController | null = null;
    let finishing = false;

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        app?.destroy();
        controller?.destroy();
        store?.dispose();
        await owner.shutdown();
        process.exit(code);
    };

    try {
        let net: WsClient;
        if (options.connect === null) {
            const backend = await startBackend({
                binary: process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend",
                args: [],
                devBranch: process.env.TASKFLOW_DEV_BRANCH ?? null,
                onSpawn: (stop) => owner.ownBackend({ stop }),
            });
            owner.ownBackend(backend);
            net = new WsClient(backend.port);
        } else {
            net = new WsClient(options.connect.port, options.connect.host);
        }
        owner.ownSocket(net);
        await net.connect();

        const renderer = await owner.create();
        store = new Store(net);
        controller = new SessionController({
            createBridge: (session, sessionOwner) => {
                const pane = app?.paneDimensions ?? {
                    cols: Math.max(
                        1,
                        renderer.terminalWidth -
                            Math.min(30, Math.floor(renderer.terminalWidth / 3)),
                    ),
                    rows: Math.max(1, renderer.terminalHeight - 1),
                };
                return new SessionBridge({
                    renderer,
                    net,
                    sessionId: session.id,
                    owner: ownerRequest(sessionOwner),
                    cols: pane.cols,
                    rows: pane.rows,
                });
            },
            request: <T>(type: string, payload?: unknown) => net.request<T>(type, payload),
            onChange: (sessions, activeId) => app?.setSessions(sessions, activeId),
        });
        app = new OpenTuiApp({
            renderer,
            net,
            store,
            onOwnerChange: (sessionOwner, sessions) =>
                controller?.reconcile(sessionOwner, sessions),
            onSessionSelect: (sessionId) => controller?.select(sessionId),
            onReconnect: () => controller?.reattach(),
            onCreate: (sessionOwner, payload) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.create(sessionOwner, payload);
            },
            onClose: (sessionId) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.close(sessionId);
            },
            onResume: (sessionId, cols, rows) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.resume(sessionId, cols, rows);
            },
            onQuit: () => void finish(0),
        });
        await app.init();
        renderer.requestRender();
    } catch (error) {
        app?.destroy();
        controller?.destroy();
        store?.dispose();
        await owner.shutdown();
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

export { main };

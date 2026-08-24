import { startBackend } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient } from "../net/client";
import { Store } from "../state/store";
import { OpenTuiApp } from "./app";
import { OpenTuiRuntimeOwner } from "./runtime";

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let app: OpenTuiApp | null = null;
    let store: Store | null = null;
    let finishing = false;

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        app?.destroy();
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
        app = new OpenTuiApp({
            renderer,
            net,
            store,
            sessions: [],
            onQuit: () => void finish(0),
        });
        await app.init();
        renderer.requestRender();
    } catch (error) {
        app?.destroy();
        store?.dispose();
        await owner.shutdown();
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

export { main };

import { startBackend } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient } from "../net/client";
import { OpenTuiRuntimeOwner } from "./runtime";
import { openWorkspace, type Workspace } from "./workspace";

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let workspace: Workspace | null = null;
    let finishing = false;

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        workspace?.dispose();
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
        const target =
            options.connect === null
                ? null
                : `${options.connect.host}:${String(options.connect.port)}`;
        workspace = await openWorkspace(net, {
            renderer,
            machineId: target === null ? "local" : `connect:${target}`,
            machineLabel: target ?? "This machine",
            local: target === null,
            onQuit: () => void finish(0),
            onSwitchMachine: () => undefined,
        });
    } catch (error) {
        workspace?.dispose();
        await owner.shutdown();
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

export { main };

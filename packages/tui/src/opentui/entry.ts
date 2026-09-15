import { homedir } from "node:os";
import { TextRenderable, type CliRenderer } from "@opentui/core";
import type { MenuEntry } from "@taskflow/shared";
import { startBackend } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient } from "../net/client";
import { connectMachine } from "../remote/connect";
import { createMachines } from "../remote/machines";
import { findMachineByName } from "../remote/picker-model";
import { resolveStateDir } from "../remote/state-dir";
import { readTuiState, writeTuiState } from "../remote/tui-state";
import { askTrust, MachinePicker } from "./machine-picker";
import { MachineSession } from "./machine-session";
import { OpenTuiRuntimeOwner } from "./runtime";
import { openWorkspace } from "./workspace";

/**
 * Connect the machine named on the command line, or show the picker. A named
 * machine that fails to connect opens the picker with the failure.
 */
async function launch(
    session: MachineSession,
    renderer: CliRenderer,
    named: MenuEntry | null,
): Promise<void> {
    if (named === null) return session.openPicker();
    const status = new TextRenderable(renderer, {
        content: ` Connecting to ${named.displayName}…`,
        height: 1,
    });
    renderer.root.add(status);
    const result = await session.switchTo({ kind: "machine", entry: named });
    status.destroy();
    if (!result.ok) await session.openPicker({ failure: result.message, lastMachineId: named.id });
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let finishing = false;

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        await owner.shutdown();
        process.exit(code);
    };

    const fail = async (error: unknown): Promise<void> => {
        if (finishing) return;
        finishing = true;
        await owner.shutdown();
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    };

    try {
        if (options.connect !== null) {
            // A tunnel the user opened by hand: no picker, no registry.
            const target = `${options.connect.host}:${String(options.connect.port)}`;
            const net = new WsClient(options.connect.port, options.connect.host);
            owner.ownSocket(net);
            await net.connect();
            const renderer = await owner.create();
            const workspace = await openWorkspace(net, {
                renderer,
                machineId: `connect:${target}`,
                machineLabel: target,
                local: false,
                onQuit: () => void finish(0),
            });
            owner.setShutdownHook(() => {
                workspace.dispose();
                return Promise.resolve();
            });
            return;
        }

        const stateDir = resolveStateDir(process.env, homedir());
        const machines = createMachines(stateDir);
        await machines.registry.load();
        const state = await readTuiState(stateDir);

        let named: MenuEntry | null = null;
        if (options.machine !== null) {
            const entries = await machines.registry.listBackends();
            named = findMachineByName(entries, options.machine);
            if (named === null) {
                const names = entries.filter((entry) => entry.saved).map((e) => e.displayName);
                process.stderr.write(
                    `Unknown machine "${options.machine}". Saved: ${names.join(", ")}\n`,
                );
                await finish(2);
                return;
            }
        }

        const renderer = await owner.create();
        const session = new MachineSession({
            renderer,
            machines,
            state,
            writeState: (next) => writeTuiState(stateDir, next),
            connect: (id) => connectMachine(machines, id),
            startBackend: (onSpawn) =>
                startBackend({
                    binary: process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend",
                    args: [],
                    devBranch: process.env.TASKFLOW_DEV_BRANCH ?? null,
                    onSpawn,
                }),
            createLocalClient: (port) => new WsClient(port),
            openWorkspace,
            createPicker: (pickerDeps) => {
                const picker = new MachinePicker(pickerDeps);
                renderer.root.add(picker.renderable);
                return picker;
            },
            askTrust: (fingerprint, host) => askTrust(renderer, fingerprint, host),
            onQuit: () => void finish(0),
            onFatal: (error) => void fail(error),
        });
        // Signals and fatal errors reach the session through the runtime owner.
        owner.setShutdownHook(() => session.shutdown());
        await launch(session, renderer, named);
    } catch (error) {
        await fail(error);
    }
}

export { main };

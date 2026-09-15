import { homedir } from "node:os";
import { TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { MSG } from "@taskflow/shared";
import type { MenuEntry, SystemInfo } from "@taskflow/shared";
import { startBackend, type BackendHandle } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient, type NetLike } from "../net/client";
import { connectMachine, type ConnectOutcome } from "../remote/connect";
import { createMachines, LOCAL_MACHINE_ID, type Machines } from "../remote/machines";
import { findMachineByName, type PickerRow } from "../remote/picker-model";
import { resolveStateDir } from "../remote/state-dir";
import { readTuiState, writeTuiState, type TuiState } from "../remote/tui-state";
import { askTrust, MachinePicker } from "./machine-picker";
import { OpenTuiRuntimeOwner } from "./runtime";
import { openWorkspace, type Workspace } from "./workspace";

/** A connected machine, or why not. A null message means the user backed out. */
type PickResult =
    | { ok: true; machineId: string; label: string; local: boolean; net: NetLike }
    | { ok: false; message: string | null };

interface PickContext {
    owner: OpenTuiRuntimeOwner;
    machines: Machines;
    /** Started by the first pick of this machine and reused by any later one. */
    localBackend: BackendHandle | null;
    askTrust(fingerprint: string, host: string): Promise<boolean>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function connectLocal(ctx: PickContext): Promise<PickResult> {
    const { owner } = ctx;
    if (ctx.localBackend === null) {
        const backend = await startBackend({
            binary: process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend",
            args: [],
            devBranch: process.env.TASKFLOW_DEV_BRANCH ?? null,
            onSpawn: (stop) => owner.ownBackend({ stop }),
        });
        owner.ownBackend(backend);
        ctx.localBackend = backend;
    }
    const net = new WsClient(ctx.localBackend.port);
    owner.ownSocket(net);
    try {
        await net.connect();
        const info = await net.request<SystemInfo>(MSG.SYSTEM_INFO);
        // Lets the registry drop this machine's own beacon from the rows.
        if (info.backendUid) ctx.machines.registry.setLocalUid(info.backendUid);
    } catch (error) {
        net.close();
        throw error;
    }
    return { ok: true, machineId: LOCAL_MACHINE_ID, label: "This machine", local: true, net };
}

function describeOutcome(outcome: ConnectOutcome, entry: MenuEntry): PickResult {
    if (outcome.ok) {
        return {
            ok: true,
            machineId: outcome.machineId,
            label: entry.displayName,
            local: false,
            net: outcome.net,
        };
    }
    if ("failure" in outcome) return { ok: false, message: outcome.failure.message };
    if ("incompatible" in outcome) {
        return {
            ok: false,
            message: `${entry.displayName} runs an incompatible Taskflow version.`,
        };
    }
    // Nothing is attached before the first pick, so this is not expected here.
    return { ok: false, message: `${entry.displayName} is already connected.` };
}

async function connectRemote(ctx: PickContext, entry: MenuEntry): Promise<PickResult> {
    const { registry } = ctx.machines;
    let id = entry.id;
    if (!entry.saved) {
        const record = await registry.addDiscoveredBackend(entry.id);
        if (record === null) {
            return { ok: false, message: `${entry.displayName} is no longer on the network.` };
        }
        id = record.id;
    }

    let outcome = await connectMachine(ctx.machines, id);
    if (!outcome.ok && "failure" in outcome && outcome.failure.kind === "unknown-host-key") {
        const scanned = await registry.getHostFingerprint(id);
        if (!scanned.ok) return { ok: false, message: scanned.reason };
        if (!(await ctx.askTrust(scanned.fingerprint, entry.host))) {
            return { ok: false, message: null };
        }
        const trusted = await registry.trustBackendHost(id);
        if (!trusted.ok) {
            return {
                ok: false,
                message: trusted.reason ?? `Could not trust the host key of ${entry.host}.`,
            };
        }
        outcome = await connectMachine(ctx.machines, id);
    }
    if (outcome.ok) ctx.owner.ownSocket(outcome.net);
    return describeOutcome(outcome, entry);
}

/** Connect whatever row was picked. Never throws: every failure is a message. */
async function connectRow(ctx: PickContext, row: PickerRow): Promise<PickResult> {
    try {
        if (row.kind === "local") return await connectLocal(ctx);
        if (row.kind === "machine") return await connectRemote(ctx, row.entry);
        return { ok: false, message: null };
    } catch (error) {
        return { ok: false, message: errorMessage(error) };
    }
}

function rowName(row: PickerRow): string {
    return row.kind === "machine" ? row.entry.displayName : "this machine";
}

interface LaunchDeps {
    owner: OpenTuiRuntimeOwner;
    machines: Machines;
    renderer: CliRenderer;
    stateDir: string;
    state: TuiState;
    /** Set by `taskflow-tui <name>`: connect to it first, without the picker. */
    named: MenuEntry | null;
    onQuit(): void;
    onOpened(workspace: Workspace): void;
    onFatal(error: unknown): void;
}

/**
 * Pick a machine, connect to it and open its workspace. Discovery runs only
 * while the picker is on screen.
 */
async function launchMachine(deps: LaunchDeps): Promise<void> {
    const { renderer, machines } = deps;
    const { registry } = machines;
    let picker: MachinePicker | null = null;
    let busy = false;
    // While the trust dialog is up it reads the keys, not the picker.
    let prompting = false;
    const disposers: Array<() => void> = [];

    const ctx: PickContext = {
        owner: deps.owner,
        machines,
        localBackend: null,
        askTrust: async (fingerprint, host) => {
            prompting = true;
            try {
                return await askTrust(renderer, fingerprint, host);
            } finally {
                prompting = false;
            }
        },
    };

    const showFailure = (message: string): void => picker?.showFailure(message);

    const open = async (result: Extract<PickResult, { ok: true }>): Promise<void> => {
        for (const dispose of disposers.splice(0)) dispose();
        picker?.destroy();
        picker = null;
        await writeTuiState(deps.stateDir, { ...deps.state, lastMachineId: result.machineId });
        const workspace = await openWorkspace(result.net, {
            renderer,
            machineId: result.machineId,
            machineLabel: result.label,
            local: result.local,
            onQuit: deps.onQuit,
            onSwitchMachine: () => undefined,
        });
        deps.onOpened(workspace);
        const selection = deps.state.selections[result.machineId];
        if (selection) workspace.restoreSelection(selection);
    };

    const pick = async (row: PickerRow): Promise<void> => {
        if (busy || picker === null) return;
        busy = true;
        picker.setPending(`Connecting to ${rowName(row)}…`);
        const result = await connectRow(ctx, row);
        busy = false;
        if (result.ok) {
            await open(result).catch(deps.onFatal);
            return;
        }
        if (result.message === null) picker?.setPending(null);
        else showFailure(result.message);
    };

    const refresh = (): void => {
        void registry.listBackends().then((entries) => picker?.setEntries(entries));
    };

    const showPicker = async (
        failure: string | null,
        lastMachineId: string | null,
    ): Promise<void> => {
        picker = new MachinePicker({
            renderer,
            entries: await registry.listBackends(),
            lastMachineId,
            mode: "launch",
            onPick: (row) => void pick(row),
            onAdd: (input) => {
                registry.addBackend(input).catch((error: unknown) => {
                    showFailure(errorMessage(error));
                });
            },
            onRename: (id, name) => {
                void registry.updateBackend(id, { displayName: name }).then((result) => {
                    if (!result.ok) showFailure(result.reason ?? "Could not rename the machine.");
                });
            },
            onForget: (id) => {
                void registry.removeBackend(id).then((result) => {
                    if (!result.ok) showFailure(result.reason ?? "Could not forget the machine.");
                });
            },
            onCancel: deps.onQuit,
        });
        renderer.root.add(picker.renderable);
        if (failure !== null) picker.showFailure(failure);

        const onKey = (event: KeyEvent): void => {
            if (!prompting) picker?.handleKey(event);
        };
        renderer.keyInput.on("keypress", onKey);
        disposers.push(
            () => renderer.keyInput.off("keypress", onKey),
            registry.onChanged(refresh),
            () => registry.stopDiscovery(),
        );
        try {
            await registry.startDiscovery();
        } catch (error) {
            // Saved machines and "Add machine" still work without discovery.
            if (failure === null) showFailure(`Discovery is off: ${errorMessage(error)}`);
        }
    };

    if (deps.named !== null) {
        const status = new TextRenderable(renderer, {
            content: ` Connecting to ${deps.named.displayName}…`,
            height: 1,
        });
        renderer.root.add(status);
        const result = await connectRow(ctx, { kind: "machine", entry: deps.named });
        status.destroy();
        if (result.ok) return open(result);
        return showPicker(result.message, deps.named.id);
    }
    return showPicker(null, deps.state.lastMachineId);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let workspace: Workspace | null = null;
    let machines: Machines | null = null;
    let finishing = false;

    const shutdown = async (): Promise<void> => {
        workspace?.dispose();
        machines?.registry.stopDiscovery();
        await owner.shutdown();
        machines?.tunnels.closeAllTunnels();
    };

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        await shutdown();
        process.exit(code);
    };

    const fail = async (error: unknown): Promise<void> => {
        if (finishing) return;
        finishing = true;
        await shutdown();
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
            workspace = await openWorkspace(net, {
                renderer,
                machineId: `connect:${target}`,
                machineLabel: target,
                local: false,
                onQuit: () => void finish(0),
                onSwitchMachine: () => undefined,
            });
            return;
        }

        const stateDir = resolveStateDir(process.env, homedir());
        machines = createMachines(stateDir);
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
        await launchMachine({
            owner,
            machines,
            renderer,
            stateDir,
            state,
            named,
            onQuit: () => void finish(0),
            onOpened: (opened) => {
                workspace = opened;
            },
            onFatal: (error) => void fail(error),
        });
    } catch (error) {
        await fail(error);
    }
}

export { main };

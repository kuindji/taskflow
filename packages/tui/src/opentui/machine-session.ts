import type { CliRenderer, KeyEvent } from "@opentui/core";
import { MSG } from "@taskflow/shared";
import type { MenuEntry, SystemInfo } from "@taskflow/shared";
import type { BackendRegistry, TunnelManager } from "@taskflow/shared/remote";
import type { BackendHandle } from "../backend/manager";
import type { NetLike } from "../net/client";
import type { ConnectOutcome, MachineClient } from "../remote/connect";
import { LOCAL_MACHINE_ID } from "../remote/machines";
import type { PickerRow } from "../remote/picker-model";
import type { TuiState } from "../remote/tui-state";
import type { OverlayHandle } from "./app";
import type { MachinePicker, MachinePickerDeps } from "./machine-picker";
import type { Workspace, WorkspaceContext } from "./workspace";

type SessionRegistry = Pick<
    BackendRegistry,
    | "addBackend"
    | "addDiscoveredBackend"
    | "detachBackend"
    | "getHostFingerprint"
    | "listBackends"
    | "onChanged"
    | "removeBackend"
    | "setLocalUid"
    | "startDiscovery"
    | "stopDiscovery"
    | "trustBackendHost"
    | "updateBackend"
>;

type SessionWorkspace = Pick<
    Workspace,
    "dispose" | "hasOpenEditor" | "selection" | "restoreSelection" | "showOverlay"
>;

type PickerView = Pick<
    MachinePicker,
    "keyHints" | "handleKey" | "setEntries" | "setPending" | "showFailure" | "destroy"
>;

interface MachineSessionDeps {
    renderer: CliRenderer;
    machines: { registry: SessionRegistry; tunnels: Pick<TunnelManager, "closeAllTunnels"> };
    /** Updated in place: selections on every switch, `lastMachineId` after each open. */
    state: TuiState;
    writeState(state: TuiState): Promise<void>;
    connect(id: string): Promise<ConnectOutcome>;
    /** `onSpawn` hands over `stop` before the port is known, so a quit mid-start still stops it. */
    startBackend(onSpawn: (stop: () => void) => void): Promise<BackendHandle>;
    createLocalClient(port: number): MachineClient;
    openWorkspace(net: NetLike, context: WorkspaceContext): Promise<SessionWorkspace>;
    /** Builds the picker and puts it on screen. Keys are routed by the session. */
    createPicker(deps: MachinePickerDeps): PickerView;
    askTrust(fingerprint: string, host: string): Promise<boolean>;
    onQuit(): void;
    onFatal(error: unknown): void;
}

type SwitchResult = { ok: true } | { ok: false; message: string };

interface CurrentMachine {
    machineId: string;
    local: boolean;
    net: MachineClient;
    workspace: SessionWorkspace;
}

/** Where a connect attempt landed. `current`: it resolved to the machine already open. */
type Target =
    | { kind: "connected"; machineId: string; label: string; local: boolean; net: MachineClient }
    | { kind: "failed"; message: string }
    | { kind: "current" };

interface OpenPicker {
    view: PickerView;
    overlay: OverlayHandle;
    unsubscribe(): void;
}

const EDITOR_OPEN_MESSAGE = "Close the external editor before switching machines.";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function failed(message: string): Target {
    return { kind: "failed", message };
}

function rowName(row: PickerRow): string {
    return row.kind === "machine" ? row.entry.displayName : "this machine";
}

function isCurrentRow(row: PickerRow, current: CurrentMachine): boolean {
    if (row.kind === "local") return current.local;
    return row.kind === "machine" && row.entry.id === current.machineId;
}

/**
 * Owns the machine the TUI is connected to: its workspace and socket, the
 * local backend this process started, and the picker used to change machines.
 * Launch and the `m` switch share `switchTo`.
 */
class MachineSession {
    private current: CurrentMachine | null = null;
    private localBackend: BackendHandle | null = null;
    private stopSpawnedBackend: (() => void) | null = null;
    private picker: OpenPicker | null = null;
    private pickerOpening = false;
    private connecting = false;
    private shutdownPromise: Promise<void> | null = null;

    constructor(private readonly deps: MachineSessionDeps) {}

    /**
     * Connect the row first and only then replace the current workspace, so a
     * failed connect leaves everything as it was. Rejects only when the new
     * workspace fails to open after the old one is gone.
     */
    async switchTo(row: PickerRow): Promise<SwitchResult> {
        const previous = this.current;
        if (previous?.workspace.hasOpenEditor()) return { ok: false, message: EDITOR_OPEN_MESSAGE };
        // Dialing the open machine again would replace the tunnel its socket uses.
        if (previous !== null && isCurrentRow(row, previous)) return { ok: true };

        const target = await this.connectRow(row);
        if (target.kind === "failed") return { ok: false, message: target.message };
        if (target.kind === "current") return { ok: true };
        if (this.shutdownPromise !== null) {
            await this.release(target);
            return { ok: false, message: "Taskflow is quitting." };
        }

        const { state } = this.deps;
        if (previous !== null) {
            state.selections[previous.machineId] = previous.workspace.selection();
            this.current = null;
            previous.workspace.dispose();
            previous.net.close();
            // The local backend keeps running: switching back reuses it.
            if (!previous.local) await this.detachQuietly(previous.machineId);
        }

        let workspace: SessionWorkspace;
        try {
            workspace = await this.deps.openWorkspace(target.net, {
                renderer: this.deps.renderer,
                machineId: target.machineId,
                machineLabel: target.label,
                local: target.local,
                onQuit: () => this.deps.onQuit(),
                onSwitchMachine: () => {
                    this.openPicker().catch((error: unknown) => this.deps.onFatal(error));
                },
            });
        } catch (error) {
            await this.release(target);
            throw error;
        }
        this.current = {
            machineId: target.machineId,
            local: target.local,
            net: target.net,
            workspace,
        };
        const selection = state.selections[target.machineId];
        if (selection) workspace.restoreSelection(selection);
        state.lastMachineId = target.machineId;
        await this.deps.writeState(state);
        return { ok: true };
    }

    /**
     * Show the machine picker: over the workspace when one is open (Esc closes
     * it), or alone at launch (Esc quits). Discovery runs while it is open.
     */
    async openPicker(options: { failure?: string; lastMachineId?: string } = {}): Promise<void> {
        if (this.picker !== null || this.pickerOpening || this.shutdownPromise !== null) return;
        const { registry } = this.deps.machines;
        this.pickerOpening = true;
        let entries: MenuEntry[];
        try {
            entries = await registry.listBackends();
        } finally {
            this.pickerOpening = false;
        }
        if (this.shutdownPromise !== null) return;

        const mode = this.current === null ? "launch" : "switch";
        // Registry writes can reject (a failed persist): show it, never let it escape.
        const report = (work: Promise<{ ok: boolean; reason?: string }>, fallback: string) => {
            work.then(
                (result) => {
                    if (!result.ok) this.showPickerFailure(result.reason ?? fallback);
                },
                (error: unknown) => this.showPickerFailure(errorMessage(error)),
            );
        };
        const view = this.deps.createPicker({
            renderer: this.deps.renderer,
            entries,
            lastMachineId:
                options.lastMachineId ?? this.current?.machineId ?? this.deps.state.lastMachineId,
            mode,
            onPick: (row) => void this.pick(row),
            onAdd: (input) =>
                report(
                    registry.addBackend(input).then(() => ({ ok: true })),
                    "Could not add the machine.",
                ),
            onRename: (id, name) =>
                report(
                    registry.updateBackend(id, { displayName: name }),
                    "Could not rename the machine.",
                ),
            onForget: (id) => report(registry.removeBackend(id), "Could not forget the machine."),
            onCancel: () => {
                if (mode === "launch") this.deps.onQuit();
                else this.closePicker();
            },
        });
        const overlay = this.mountPicker(view);
        const picker: OpenPicker = {
            view,
            overlay,
            unsubscribe: registry.onChanged(() => {
                void registry.listBackends().then((next) => {
                    if (this.picker !== picker) return;
                    view.setEntries(next);
                    overlay.refresh();
                });
            }),
        };
        this.picker = picker;
        if (options.failure !== undefined) this.showPickerFailure(options.failure);

        try {
            await registry.startDiscovery();
        } catch (error) {
            // Saved machines and "Add machine" still work without discovery.
            if (options.failure === undefined) {
                this.showPickerFailure(`Discovery is off: ${errorMessage(error)}`);
            }
        }
    }

    /** Workspace, socket, tunnels, the owned local backend, discovery. Runs once. */
    shutdown(): Promise<void> {
        this.shutdownPromise ??= this.shutdownOnce();
        return this.shutdownPromise;
    }

    private shutdownOnce(): Promise<void> {
        const { registry, tunnels } = this.deps.machines;
        const errors: unknown[] = [];
        // Each step runs even if an earlier one threw: a leaked ssh child or
        // backend outlives the TUI.
        const step = (work: () => void): void => {
            try {
                work();
            } catch (error) {
                errors.push(error);
            }
        };
        step(() => this.dropPicker());
        const current = this.current;
        this.current = null;
        if (current !== null) {
            step(() => current.workspace.dispose());
            step(() => current.net.close());
        }
        step(() => tunnels.closeAllTunnels());
        step(() => this.stopLocalBackend());
        step(() => registry.stopDiscovery());
        if (errors.length === 0) return Promise.resolve();
        const [first] = errors;
        return Promise.reject(first instanceof Error ? first : new Error(String(first)));
    }

    private async pick(row: PickerRow): Promise<void> {
        const picker = this.picker;
        if (this.connecting || picker === null) return;
        this.connecting = true;
        picker.view.setPending(`Connecting to ${rowName(row)}…`);
        picker.overlay.refresh();
        let result: SwitchResult;
        try {
            result = await this.switchTo(row);
        } catch (error) {
            this.deps.onFatal(error);
            return;
        } finally {
            this.connecting = false;
        }
        if (this.picker !== picker) return;
        if (result.ok) this.closePicker();
        else this.showPickerFailure(result.message);
    }

    /** Over the app, keys go through its overlay slot. At launch there is no app. */
    private mountPicker(view: PickerView): OverlayHandle {
        if (this.current !== null) return this.current.workspace.showOverlay(view);
        const { keyInput } = this.deps.renderer;
        const onKey = (event: KeyEvent): void => view.handleKey(event);
        keyInput.on("keypress", onKey);
        return {
            refresh: () => undefined,
            close: () => keyInput.off("keypress", onKey),
        };
    }

    private showPickerFailure(message: string): void {
        if (this.picker === null) return;
        this.picker.view.showFailure(message);
        this.picker.overlay.refresh();
    }

    private closePicker(): void {
        if (this.dropPicker()) this.deps.machines.registry.stopDiscovery();
    }

    private dropPicker(): boolean {
        const picker = this.picker;
        if (picker === null) return false;
        this.picker = null;
        picker.unsubscribe();
        picker.overlay.close();
        picker.view.destroy();
        return true;
    }

    private stopLocalBackend(): void {
        const stop = this.localBackend?.stop ?? this.stopSpawnedBackend;
        this.localBackend = null;
        this.stopSpawnedBackend = null;
        stop?.();
    }

    /** Never throws: every failure is a message. */
    private async connectRow(row: PickerRow): Promise<Target> {
        try {
            if (row.kind === "local") return await this.connectLocal();
            if (row.kind === "machine") return await this.connectRemote(row.entry);
            return failed("Pick a machine to connect to.");
        } catch (error) {
            return failed(errorMessage(error));
        }
    }

    private async connectLocal(): Promise<Target> {
        if (this.localBackend === null) {
            this.localBackend = await this.deps.startBackend((stop) => {
                this.stopSpawnedBackend = stop;
            });
        }
        const net = this.deps.createLocalClient(this.localBackend.port);
        try {
            await net.connect();
            const info = await net.request<SystemInfo>(MSG.SYSTEM_INFO);
            // Lets the registry drop this machine's own beacon from the rows.
            if (info.backendUid) this.deps.machines.registry.setLocalUid(info.backendUid);
        } catch (error) {
            net.close();
            throw error;
        }
        return {
            kind: "connected",
            machineId: LOCAL_MACHINE_ID,
            label: "This machine",
            local: true,
            net,
        };
    }

    private async connectRemote(entry: MenuEntry): Promise<Target> {
        const { registry } = this.deps.machines;
        let id = entry.id;
        if (!entry.saved) {
            const record = await registry.addDiscoveredBackend(entry.id);
            if (record === null) return failed(`${entry.displayName} is no longer on the network.`);
            id = record.id;
        }

        let outcome = await this.deps.connect(id);
        if (!outcome.ok && "failure" in outcome && outcome.failure.kind === "unknown-host-key") {
            const scanned = await registry.getHostFingerprint(id);
            if (!scanned.ok) return failed(scanned.reason);
            if (!(await this.deps.askTrust(scanned.fingerprint, entry.host))) {
                return failed(`Not connected: the host key of ${entry.host} was not trusted.`);
            }
            const trusted = await registry.trustBackendHost(id);
            if (!trusted.ok) {
                return failed(trusted.reason ?? `Could not trust the host key of ${entry.host}.`);
            }
            outcome = await this.deps.connect(id);
        }

        if (!outcome.ok && "alreadyAttached" in outcome) {
            if (outcome.machineId === this.current?.machineId) return { kind: "current" };
            // Attached, but not by this session: a stale origin. Drop it and dial again.
            await registry.detachBackend(outcome.machineId);
            outcome = await this.deps.connect(outcome.machineId);
        }

        if (outcome.ok) {
            return {
                kind: "connected",
                machineId: outcome.machineId,
                label: entry.displayName,
                local: false,
                net: outcome.net,
            };
        }
        if ("failure" in outcome) return failed(outcome.failure.message);
        if ("incompatible" in outcome) {
            return failed(`${entry.displayName} runs an incompatible Taskflow version.`);
        }
        return failed(`${entry.displayName} is already connected.`);
    }

    /** Undo a connect whose workspace will never open. */
    private async release(target: Extract<Target, { kind: "connected" }>): Promise<void> {
        target.net.close();
        if (!target.local) await this.detachQuietly(target.machineId);
    }

    private async detachQuietly(id: string): Promise<void> {
        try {
            await this.deps.machines.registry.detachBackend(id);
        } catch {
            // Detach only closes the tunnel and persists; the switch goes on.
        }
    }
}

export { MachineSession };
export type { MachineSessionDeps };

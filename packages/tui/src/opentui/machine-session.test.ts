import { afterEach, describe, expect, it } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { MenuEntry } from "@taskflow/shared";
import type { ConnectOutcome, MachineClient } from "../remote/connect";
import type { PickerRow } from "../remote/picker-model";
import type { TuiState } from "../remote/tui-state";
import type { KeyOverlay } from "./app";
import type { MachinePickerDeps } from "./machine-picker";
import { MachineSession, type MachineSessionDeps } from "./machine-session";
import type { WorkspaceContext } from "./workspace";

type SessionWorkspace = Awaited<ReturnType<MachineSessionDeps["openWorkspace"]>>;
type PickerView = ReturnType<MachineSessionDeps["createPicker"]>;
type Registry = MachineSessionDeps["machines"]["registry"];

async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (condition()) return;
        await Bun.sleep(2);
    }
    throw new Error("Timed out waiting for condition");
}

function entry(id: string, saved = true): MenuEntry {
    return {
        id,
        displayName: id,
        instanceId: "main",
        host: `${id}.lan`,
        attached: false,
        saved,
        seen: true,
    };
}

function machineRow(id: string): PickerRow {
    return { kind: "machine", entry: entry(id) };
}

const LOCAL_ROW: PickerRow = { kind: "local" };

class FakeClient implements MachineClient {
    constructor(
        private readonly name: string,
        private readonly log: string[],
    ) {}
    connect(): Promise<void> {
        return Promise.resolve();
    }
    request<T>(): Promise<T> {
        return Promise.resolve({ backendUid: "local-uid" } as T);
    }
    on(): () => void {
        return () => undefined;
    }
    onStatusChange(): () => void {
        return () => undefined;
    }
    retarget(): void {}
    close(): void {
        this.log.push(`close(${this.name})`);
    }
}

interface Harness {
    session: MachineSession;
    log: string[];
    state: TuiState;
    writes: TuiState[];
    contexts: WorkspaceContext[];
    pickers: Array<{ deps: MachinePickerDeps; failures: string[]; destroyed: boolean }>;
    overlays: KeyOverlay[];
    outcomes: Map<string, ConnectOutcome[]>;
    registry: Registry;
    editorOpen: { value: boolean };
    localPorts: number[];
}

describe("MachineSession", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    async function harness(): Promise<Harness> {
        const test = await createTestRenderer({ width: 80, height: 24 });
        cleanups.push(() => test.renderer.destroy());
        const log: string[] = [];
        const state: TuiState = { lastMachineId: null, selections: {} };
        const writes: TuiState[] = [];
        const contexts: WorkspaceContext[] = [];
        const pickers: Harness["pickers"] = [];
        const overlays: KeyOverlay[] = [];
        const outcomes = new Map<string, ConnectOutcome[]>();
        const editorOpen = { value: false };
        const localPorts: number[] = [];

        const registry: Registry = {
            addBackend: () => Promise.reject(new Error("unused")),
            addDiscoveredBackend: () => Promise.resolve(null),
            detachBackend: (id) => {
                log.push(`detach(${id})`);
                return Promise.resolve();
            },
            getHostFingerprint: () => Promise.resolve({ ok: false, reason: "unused" }),
            listBackends: () => Promise.resolve([entry("alpha"), entry("beta")]),
            onChanged: () => () => undefined,
            removeBackend: () => Promise.resolve({ ok: true }),
            setLocalUid: () => undefined,
            startDiscovery: () => {
                log.push("startDiscovery");
                return Promise.resolve();
            },
            stopDiscovery: () => {
                log.push("stopDiscovery");
            },
            trustBackendHost: () => Promise.resolve({ ok: true }),
            updateBackend: () => Promise.resolve({ ok: true }),
        };

        const workspace = (id: string): SessionWorkspace => ({
            dispose: () => log.push(`dispose(${id})`),
            hasOpenEditor: () => editorOpen.value,
            selection: () => ({ projectId: `${id}-project`, taskId: null }),
            restoreSelection: (selection) => log.push(`restore(${id}:${selection.projectId})`),
            showOverlay: (overlay) => {
                overlays.push(overlay);
                return { refresh: () => undefined, close: () => undefined };
            },
        });

        const session = new MachineSession({
            renderer: test.renderer,
            machines: {
                registry,
                tunnels: { closeAllTunnels: () => log.push("closeAllTunnels") },
            },
            state,
            writeState: (next) => {
                writes.push(structuredClone(next));
                return Promise.resolve();
            },
            connect: (id) => {
                log.push(`connect(${id})`);
                const queued = outcomes.get(id)?.shift();
                return Promise.resolve(
                    queued ?? { ok: true, machineId: id, net: new FakeClient(id, log) },
                );
            },
            startBackend: () => {
                log.push("startBackend");
                return Promise.resolve({ port: 4100, stop: () => log.push("stopBackend") });
            },
            createLocalClient: (port) => {
                localPorts.push(port);
                return new FakeClient("local", log);
            },
            openWorkspace: (_net, context) => {
                contexts.push(context);
                log.push(`open(${context.machineId})`);
                return Promise.resolve(workspace(context.machineId));
            },
            createPicker: (deps): PickerView => {
                const record = { deps, failures: [] as string[], destroyed: false };
                pickers.push(record);
                return {
                    keyHints: " picker",
                    handleKey: () => undefined,
                    setEntries: () => undefined,
                    setPending: () => undefined,
                    showFailure: (message) => record.failures.push(message),
                    destroy: () => {
                        record.destroyed = true;
                    },
                };
            },
            askTrust: () => Promise.resolve(false),
            onQuit: () => undefined,
            onFatal: (error) => {
                throw error;
            },
        });
        cleanups.push(() => void session.shutdown());
        return {
            session,
            log,
            state,
            writes,
            contexts,
            pickers,
            overlays,
            outcomes,
            registry,
            editorOpen,
            localPorts,
        };
    }

    it("connects the new machine before tearing down the old one", async () => {
        const h = await harness();
        expect(await h.session.switchTo(machineRow("alpha"))).toEqual({ ok: true });
        h.state.selections.beta = { projectId: "beta-saved", taskId: null };
        h.log.length = 0;

        expect(await h.session.switchTo(machineRow("beta"))).toEqual({ ok: true });
        expect(h.log).toEqual([
            "connect(beta)",
            "dispose(alpha)",
            "close(alpha)",
            "detach(alpha)",
            "open(beta)",
            "restore(beta:beta-saved)",
        ]);
        expect(h.state.selections.alpha).toEqual({ projectId: "alpha-project", taskId: null });
        expect(h.writes.at(-1)?.lastMachineId).toBe("beta");
        expect(h.contexts.at(-1)?.local).toBe(false);
        expect(h.contexts.at(-1)?.machineLabel).toBe("beta");
    });

    it("keeps the current workspace when the connect fails", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.outcomes.set("beta", [
            {
                ok: false,
                machineId: "beta",
                failure: { kind: "auth-refused", message: "Permission denied", stderr: "" },
            },
        ]);
        h.log.length = 0;

        expect(await h.session.switchTo(machineRow("beta"))).toEqual({
            ok: false,
            message: "Permission denied",
        });
        expect(h.log).toEqual(["connect(beta)"]);

        await h.session.shutdown();
        expect(h.log).toContain("dispose(alpha)");
    });

    it("stays put when the target turns out to be the current machine", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.outcomes.set("alpha-alias", [{ ok: false, machineId: "alpha", alreadyAttached: true }]);
        h.log.length = 0;

        expect(await h.session.switchTo(machineRow("alpha-alias"))).toEqual({ ok: true });
        expect(h.log).toEqual(["connect(alpha-alias)"]);
    });

    it("drops a stale origin and dials the canonical machine again", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.outcomes.set("beta", [{ ok: false, machineId: "stale", alreadyAttached: true }]);
        h.log.length = 0;

        expect(await h.session.switchTo(machineRow("beta"))).toEqual({ ok: true });
        expect(h.log).toEqual([
            "connect(beta)",
            "detach(stale)",
            "connect(stale)",
            "dispose(alpha)",
            "close(alpha)",
            "detach(alpha)",
            "open(stale)",
        ]);
        expect(h.writes.at(-1)?.lastMachineId).toBe("stale");
    });

    it("refuses to switch while an external editor is open", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.editorOpen.value = true;
        h.log.length = 0;

        expect(await h.session.switchTo(machineRow("beta"))).toEqual({
            ok: false,
            message: "Close the external editor before switching machines.",
        });
        expect(h.log).toEqual([]);
    });

    it("keeps the local backend running across switches and reuses it", async () => {
        const h = await harness();
        await h.session.switchTo(LOCAL_ROW);
        await h.session.switchTo(machineRow("alpha"));
        await h.session.switchTo(LOCAL_ROW);

        expect(h.log.filter((line) => line === "startBackend")).toHaveLength(1);
        expect(h.log).not.toContain("stopBackend");
        expect(h.log).not.toContain("detach(local)");
        expect(h.localPorts).toEqual([4100, 4100]);
        expect(h.contexts.map((context) => context.local)).toEqual([true, false, true]);
    });

    it("shuts down the workspace, tunnels, local backend and discovery once", async () => {
        const h = await harness();
        await h.session.switchTo(LOCAL_ROW);
        h.log.length = 0;

        await Promise.all([h.session.shutdown(), h.session.shutdown()]);
        await h.session.shutdown();
        expect(h.log).toEqual([
            "dispose(local)",
            "close(local)",
            "closeAllTunnels",
            "stopBackend",
            "stopDiscovery",
        ]);
    });

    it("runs discovery only while the switch picker is open", async () => {
        const h = await harness();
        await h.session.switchTo(LOCAL_ROW);
        h.log.length = 0;

        h.contexts[0].onSwitchMachine?.();
        await waitFor(() => h.log.includes("startDiscovery"));
        expect(h.pickers).toHaveLength(1);
        expect(h.pickers[0].deps.mode).toBe("switch");
        expect(h.pickers[0].deps.lastMachineId).toBe("local");
        expect(h.overlays).toHaveLength(1);

        h.pickers[0].deps.onCancel();
        expect(h.log).toEqual(["startDiscovery", "stopDiscovery"]);
        expect(h.pickers[0].destroyed).toBe(true);

        h.contexts[0].onSwitchMachine?.();
        await waitFor(() => h.pickers.length === 2);
        h.pickers[1].deps.onPick(machineRow("alpha"));
        await waitFor(() => h.pickers[1].destroyed);
        expect(h.log).toEqual([
            "startDiscovery",
            "stopDiscovery",
            "startDiscovery",
            "connect(alpha)",
            "dispose(local)",
            "close(local)",
            "open(alpha)",
            "stopDiscovery",
        ]);
    });

    it("shows a failed switch in the picker and keeps it open", async () => {
        const h = await harness();
        await h.session.switchTo(LOCAL_ROW);
        h.editorOpen.value = true;
        h.contexts[0].onSwitchMachine?.();
        await waitFor(() => h.pickers.length === 1);

        h.pickers[0].deps.onPick(machineRow("alpha"));
        await waitFor(() => h.pickers[0].failures.length === 1);
        expect(h.pickers[0].failures).toEqual([
            "Close the external editor before switching machines.",
        ]);
        expect(h.pickers[0].destroyed).toBe(false);
    });

    it("shows a rejected forget, rename or add as a picker failure", async () => {
        const h = await harness();
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);
        cleanups.push(() => process.off("unhandledRejection", onUnhandled));
        h.registry.removeBackend = () => Promise.reject(new Error("EACCES: forget"));
        h.registry.updateBackend = () => Promise.reject(new Error("EACCES: rename"));
        h.registry.addBackend = () => Promise.reject(new Error("EACCES: add"));

        await h.session.openPicker();
        const picker = h.pickers[0];
        picker.deps.onForget("alpha");
        picker.deps.onRename("alpha", "Alpha");
        picker.deps.onAdd({ host: "gamma.lan" });
        await waitFor(() => picker.failures.length === 3);
        await Bun.sleep(5);

        expect([...picker.failures].sort()).toEqual([
            "EACCES: add",
            "EACCES: forget",
            "EACCES: rename",
        ]);
        expect(unhandled).toEqual([]);
    });
});

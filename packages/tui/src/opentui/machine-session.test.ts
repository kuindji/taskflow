import { afterEach, describe, expect, it } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { MSG } from "@taskflow/shared";
import type { MenuEntry, TunnelFailure } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { MachineOfflineError } from "../net/offline-guard";
import type { ConnectOutcome, MachineClient } from "../remote/connect";
import type { PickerRow } from "../remote/picker-model";
import type { TuiState } from "../remote/tui-state";
import type { KeyOverlay, MachineStatus } from "./app";
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
    private readonly statusListeners = new Set<(status: { connected: boolean }) => void>();

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
    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }
    retarget(port: number, host: string | null): void {
        this.log.push(`retarget(${this.name}:${String(host)}:${String(port)})`);
    }
    close(): void {
        this.log.push(`close(${this.name})`);
    }
    emitStatus(connected: boolean): void {
        for (const listener of this.statusListeners) listener({ connected });
    }
}

interface FakeTimer {
    delay: number;
    run(): void;
    cancelled: boolean;
}

type AttachResult = Awaited<ReturnType<Registry["attachBackend"]>>;

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
    clients: Map<string, FakeClient>;
    nets: NetLike[];
    statuses: Array<{ id: string; status: MachineStatus }>;
    timers: FakeTimer[];
    attaches: AttachResult[];
    exitTunnel(id: string, failure: TunnelFailure): void;
    writeState: { override: ((state: TuiState) => Promise<void>) | null };
}

/** Run every armed timer, then let the attempts they started settle. */
async function fireTimers(h: Harness): Promise<void> {
    const armed = h.timers.splice(0).filter((timer) => !timer.cancelled);
    for (const timer of armed) timer.run();
    await Bun.sleep(1);
}

function failure(kind: TunnelFailure["kind"], message: string): TunnelFailure {
    return { kind, message, stderr: "" };
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
        const clients = new Map<string, FakeClient>();
        const nets: NetLike[] = [];
        const statuses: Harness["statuses"] = [];
        const timers: FakeTimer[] = [];
        const attaches: AttachResult[] = [];
        const writeState: Harness["writeState"] = { override: null };
        let exitHandler: ((id: string, failure: TunnelFailure) => void) | null = null;
        const client = (name: string): FakeClient => {
            const created = new FakeClient(name, log);
            clients.set(name, created);
            return created;
        };

        const registry: Registry = {
            addBackend: () => Promise.reject(new Error("unused")),
            addDiscoveredBackend: () => Promise.resolve(null),
            attachBackend: (id) => {
                log.push(`attach(${id})`);
                return Promise.resolve(
                    attaches.shift() ?? {
                        ok: false,
                        failure: failure("no-route", "No route to host"),
                    },
                );
            },
            tunnelExited: (id) => {
                log.push(`tunnelExited(${id})`);
                return Promise.resolve();
            },
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
            setMachineStatus: (status) => statuses.push({ id, status }),
            resetSessionResizes: () => log.push(`resetResizes(${id})`),
        });

        const session = new MachineSession({
            renderer: test.renderer,
            machines: {
                registry,
                tunnels: {
                    closeAllTunnels: () => log.push("closeAllTunnels"),
                    onTunnelExit: (handler) => {
                        exitHandler = handler;
                    },
                },
            },
            state,
            writeState: (next) => {
                if (writeState.override) return writeState.override(next);
                writes.push(structuredClone(next));
                return Promise.resolve();
            },
            connect: (id) => {
                log.push(`connect(${id})`);
                const queued = outcomes.get(id)?.shift();
                return Promise.resolve(queued ?? { ok: true, machineId: id, net: client(id) });
            },
            startBackend: () => {
                log.push("startBackend");
                return Promise.resolve({ port: 4100, stop: () => log.push("stopBackend") });
            },
            createLocalClient: (port) => {
                localPorts.push(port);
                return client("local");
            },
            openWorkspace: (net, context) => {
                contexts.push(context);
                nets.push(net);
                log.push(`open(${context.machineId})`);
                return Promise.resolve(workspace(context.machineId));
            },
            schedule: (run, delay) => {
                const timer: FakeTimer = { delay, run, cancelled: false };
                timers.push(timer);
                return () => {
                    timer.cancelled = true;
                };
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
            clients,
            nets,
            statuses,
            timers,
            attaches,
            exitTunnel: (id, exit) => exitHandler?.(id, exit),
            writeState,
        };
    }

    const statesOf = (h: Harness): string[] =>
        h.statuses.map(({ id, status }) =>
            status.state === "online" ? `${id}:online` : `${id}:${status.state}:${status.reason}`,
        );

    const armed = (h: Harness): number[] =>
        h.timers.filter((timer) => !timer.cancelled).map((timer) => timer.delay);

    it("marks a remote machine offline when its tunnel exits and refuses requests", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.log.length = 0;

        h.exitTunnel("alpha", failure("unknown", "ssh exited with code 255"));
        await Bun.sleep(1);
        expect(h.log).toEqual(["tunnelExited(alpha)"]);
        expect(statesOf(h)).toEqual(["alpha:offline:ssh exited with code 255"]);
        expect(armed(h)).toEqual([1000]);
        expect(
            await h.nets[0].request(MSG.TASK_CREATE).catch((error: unknown) => error),
        ).toBeInstanceOf(MachineOfflineError);
    });

    it("re-attaches with backoff, retargets the socket and goes online once it connects", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        await Bun.sleep(1);
        h.log.length = 0;

        await fireTimers(h);
        expect(armed(h)).toEqual([2000]);
        await fireTimers(h);
        expect(armed(h)).toEqual([4000]);
        h.attaches.push({ ok: true, origin: "http://127.0.0.1:5123" });
        await fireTimers(h);

        expect(h.log).toEqual([
            "attach(alpha)",
            "attach(alpha)",
            "attach(alpha)",
            "retarget(alpha:127.0.0.1:5123)",
        ]);
        expect(armed(h)).toEqual([]);
        expect(statesOf(h)).toEqual(["alpha:offline:ssh exited"]);

        h.clients.get("alpha")?.emitStatus(true);
        expect(statesOf(h).at(-1)).toBe("alpha:online");
        expect(h.log.filter((line) => line === "resetResizes(alpha)")).toHaveLength(1);
        expect(await h.nets[0].request<{ backendUid: string }>(MSG.SYSTEM_INFO)).toEqual({
            backendUid: "local-uid",
        });
    });

    it("caps the re-attach backoff at 30 seconds", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        const delays: number[] = [];
        for (let attempt = 0; attempt < 8; attempt++) {
            delays.push(...armed(h));
            await fireTimers(h);
        }
        expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    });

    it("stops retrying when the machine has no backend", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        h.attaches.push({
            ok: false,
            failure: failure("no-backend", "Taskflow is not running on alpha"),
        });
        h.log.length = 0;

        await fireTimers(h);
        expect(h.log).toEqual(["attach(alpha)"]);
        expect(armed(h)).toEqual([]);
        expect(statesOf(h).at(-1)).toBe("alpha:stopped:Taskflow is not running on alpha");
    });

    it("cancels a pending re-attach when switching machines", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        await Bun.sleep(1);
        expect(armed(h)).toEqual([1000]);

        await h.session.switchTo(machineRow("beta"));
        h.log.length = 0;
        await fireTimers(h);
        expect(h.log).toEqual([]);
    });

    it("cancels a pending re-attach on shutdown", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        await h.session.shutdown();
        h.log.length = 0;
        await fireTimers(h);
        expect(h.log).toEqual([]);
    });

    it("ignores the exit of a tunnel that is not the open machine's", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("beta", failure("unknown", "ssh exited"));
        await Bun.sleep(1);
        expect(statesOf(h)).toEqual([]);
        expect(armed(h)).toEqual([]);
    });

    it("follows the local socket's status and resets session sizes when it returns", async () => {
        const h = await harness();
        await h.session.switchTo(LOCAL_ROW);
        const local = h.clients.get("local");

        local?.emitStatus(false);
        expect(statesOf(h)).toEqual(["local:offline:Connection lost"]);
        expect(
            await h.nets[0].request(MSG.TASK_CREATE).catch((error: unknown) => error),
        ).toBeInstanceOf(MachineOfflineError);

        local?.emitStatus(true);
        local?.emitStatus(true);
        expect(statesOf(h)).toEqual(["local:offline:Connection lost", "local:online"]);
        expect(h.log.filter((line) => line === "resetResizes(local)")).toHaveLength(1);
        expect(armed(h)).toEqual([]);
    });

    it("keeps the tunnel's reason when the socket drop is reported afterwards", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.exitTunnel("alpha", failure("unknown", "ssh exited"));
        h.clients.get("alpha")?.emitStatus(false);
        expect(statesOf(h)).toEqual(["alpha:offline:ssh exited"]);
    });

    it("saves the selection before disposing the workspace on shutdown", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.writeState.override = (next) => {
            h.log.push(`write(${next.selections.alpha?.projectId ?? "none"})`);
            return Promise.resolve();
        };
        h.log.length = 0;

        await h.session.shutdown();
        expect(h.log.slice(0, 2)).toEqual(["write(alpha-project)", "dispose(alpha)"]);
    });

    it("finishes shutdown when saving the selection fails", async () => {
        const h = await harness();
        await h.session.switchTo(machineRow("alpha"));
        h.writeState.override = () => Promise.reject(new Error("EACCES: state"));
        h.log.length = 0;

        const shutdownError = await h.session.shutdown().catch((error: unknown) => error);
        expect(shutdownError).toEqual(new Error("EACCES: state"));
        expect(h.log).toEqual([
            "dispose(alpha)",
            "close(alpha)",
            "closeAllTunnels",
            "stopDiscovery",
        ]);
    });

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

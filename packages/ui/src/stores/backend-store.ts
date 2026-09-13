import { create } from "zustand";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { SystemInfoResponse, TunnelFailure } from "@taskflow/shared";
import { dirtyFilePaths } from "@/components/panes/editor-dirty-state";
import { initConnectivity } from "@/hooks/useConnectivity";
import {
    closeConnection,
    onStatusChange,
    openConnection,
    rekeyConnection,
    sendRequest,
    setPrimary,
} from "@/lib/connection-registry";
import { useFlowStore } from "./flow-store";
import { useNotificationStore } from "./notification-store";
import { useProjectStore } from "./project-store";
import { useScheduleStore } from "./schedule-store";
import { useSettingsStore } from "./settings-store";
import { resetBackend } from "./store-reset";
import { useTaskStore } from "./task-store";

/**
 * For the failures that never reach ssh at all — a refused socket, a handshake
 * that never answered. `classifyTunnelFailure` lives in the main process and is
 * not importable here, so this constructs the union's generic variant directly.
 * `stderr` stays empty rather than absent: it is always retained so that a
 * misclassification stays diagnosable.
 */
function unknownFailure(message: string): TunnelFailure {
    return { kind: "unknown", message, stderr: "" };
}

export type MachineState = {
    id: string;
    displayName: string;
    host: string;
    instanceId: string;
    state: "attaching" | "attached" | "offline" | "incompatible";
    failure?: TunnelFailure;
    isLocal: boolean;
    /**
     * The user wants this machine attached: main's persisted intent. `state`
     * cannot say it — a machine the user detached and one whose tunnel died are
     * both "offline", and only the second keeps its sidebar section.
     */
    keepAttached: boolean;
    /** What the handshake reported. `rehandshake` refuses a socket that
     *  answers with a different one: that is a different backend on the port. */
    backendUid?: string;
};

/** Local is not a record; main answers its attach with the local origin. */
export const LOCAL_BACKEND_ID = "local";

export type SwitchResult =
    | { ok: true }
    | { ok: false; reason: "dirty"; files: string[] }
    | { ok: false; reason: "unreachable"; failure: TunnelFailure }
    | { ok: false; reason: "busy" };

interface BackendStore {
    machines: MachineState[];
    primaryId: string | null;
    /** The app shell's `key`: bumped when a hard switch changes primary. */
    shellKey: number;
    /**
     * A hard switch is running. For rendering only — the controls that start
     * one are disabled off it; the guard itself is `switchInFlight`.
     */
    switching: boolean;
    /**
     * Hard switch: make `id` the only attached machine and primary. The target
     * is prepared first and never torn down, so a failure leaves the attached
     * set untouched.
     */
    workAs(id: string): Promise<SwitchResult>;
    /** `workAs` local. */
    returnToLocal(): Promise<SwitchResult>;
    /**
     * Resolves to the id the machine ended up attached under — its uid after a
     * first handshake renames it — or null when it did not attach. Callers
     * that go on to address the machine (the hard switch) must use the
     * returned id, not the one they passed.
     */
    attach(id: string): Promise<string | null>;
    /** `reason` only changes the error pending requests see. */
    detach(id: string, reason?: "detach" | "switch"): Promise<void>;
    /** Tear the connection down and run `attach` again. */
    retry(id: string): void;
    /** Reconcile rows with main. Never sets a row "attached": only `attach` does. */
    refresh(): Promise<void>;
    /** Fetch every slice for one machine. A failed leg marks only that machine offline. */
    bootstrapBackend(id: string): Promise<void>;
    /** `attach`'s tail, run when a socket reconnects on its own. */
    rehandshake(id: string): Promise<void>;
}

function bridge(): NonNullable<Window["taskflow"]> {
    if (!window.taskflow) throw new Error("Backends are managed by the desktop app");
    return window.taskflow;
}

function patch(id: string, changes: Partial<MachineState>): void {
    useBackendStore.setState((state) => ({
        machines: state.machines.map((m) => (m.id === id ? { ...m, ...changes } : m)),
    }));
}

/**
 * One counter per machine, bumped by `attach`, `detach` and `retry`. An attach
 * checks it after every await and gives up once it moved: the user unticked the
 * machine, or a retry started over, and a late "attached" would resurrect a
 * row whose connection is already gone.
 */
const attempts = new Map<string, number>();

function nextAttempt(id: string): number {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    return attempt;
}

/** One status subscription per machine, dropped whenever its connection is. */
const statusUnsubs = new Map<string, () => void>();

function unfollow(id: string): void {
    statusUnsubs.get(id)?.();
    statusUnsubs.delete(id);
}

/** Close the connection and stop following it; the row is the caller's. */
function drop(id: string): void {
    unfollow(id);
    closeConnection(id, "detach");
}

/**
 * The handshake. A socket opening proves a server is listening, not that it is
 * a compatible Taskflow, and the beacon's uid is a hint anyone on the LAN can
 * forge — this is where identity is actually established. On failure the
 * connection is dropped, the row says why, and the answer is null.
 *
 * `current` says whether the caller still owns the machine. A newer attach
 * replaces the socket, which fails this request; the connection and row are
 * then the newer attach's, so a stale caller leaves both alone.
 */
async function handshake(id: string, current: () => boolean): Promise<SystemInfoResponse | null> {
    let info: SystemInfoResponse;
    try {
        info = await sendRequest<SystemInfoResponse>(id, MSG.SYSTEM_INFO, {});
    } catch {
        if (!current()) return null;
        drop(id);
        patch(id, { state: "offline", failure: unknownFailure("No handshake") });
        return null;
    }
    if (!current()) return null;
    // Before anything is confirmed with main: main has no socket, so the
    // version check is only ever enforced here.
    if (info.protocolVersion !== PROTOCOL_VERSION) {
        drop(id);
        patch(id, { state: "incompatible", failure: undefined });
        return null;
    }
    return info;
}

/** Move a row to the id main refiled its record under. */
function renameRow(fromId: string, toId: string): void {
    useBackendStore.setState((state) => {
        // A `backends-changed` refresh may have landed first and already listed
        // the record under its new id; keep one row, the one this attach owns.
        if (!state.machines.some((m) => m.id === fromId)) return state;
        return {
            machines: state.machines
                .filter((m) => m.id !== toId)
                .map((m) => (m.id === fromId ? { ...m, id: toId } : m)),
        };
    });
}

export const useBackendStore = create<BackendStore>((_set, get) => ({
    machines: [],
    primaryId: null,
    shellKey: 0,
    switching: false,

    async workAs(id) {
        // One switch at a time. Two in flight each detach everything except
        // their own target, so each closes the other's: pick b and c while a,
        // b and c are attached, and every backend ends up offline — including
        // both targets that were just validated. A double-click is enough.
        if (switchInFlight) return { ok: false, reason: "busy" };
        switchInFlight = true;
        useBackendStore.setState({ switching: true });
        try {
            return await runSwitch(id);
        } finally {
            switchInFlight = false;
            useBackendStore.setState({ switching: false });
        }
    },

    returnToLocal() {
        return get().workAs(LOCAL_BACKEND_ID);
    },

    async attach(id) {
        const attempt = nextAttempt(id);
        const current = () => attempts.get(id) === attempt;
        patch(id, { state: "attaching", failure: undefined, keepAttached: true });

        const result = await bridge().attachBackend(id);
        if (!current()) return null;
        if (!result.ok) {
            patch(id, { state: "offline", failure: result.failure });
            return null;
        }

        // `openConnection` replaces any connection under this id. Drop the
        // previous socket's status subscription first: it is keyed by id, so
        // the new socket's "connected" would otherwise reach it as a reconnect
        // and start a second handshake beside this one.
        unfollow(id);

        try {
            await openConnection(id, result.origin);
        } catch {
            if (!current()) return null;
            // Drop the connection too, or it keeps reconnecting in the
            // background with nobody to handshake when it succeeds.
            drop(id);
            patch(id, { state: "offline", failure: unknownFailure("Socket refused") });
            return null;
        }
        if (!current()) return null;

        const info = await handshake(id, current);
        if (!info) return null;

        let liveId = id;
        if (info.backendUid) {
            let confirmed: { id: string; merged: boolean };
            try {
                confirmed = await bridge().confirmBackend(id, {
                    backendUid: info.backendUid,
                    protocolVersion: info.protocolVersion ?? PROTOCOL_VERSION,
                });
            } catch (error) {
                // Main refuses, touching nothing, for a uid outside the safe
                // label set, a record removed mid-handshake, and a confirmed
                // record answering with a different uid — a different backend
                // on that host and port.
                if (!current()) return null;
                drop(id);
                patch(id, {
                    state: "offline",
                    failure: unknownFailure(
                        error instanceof Error ? error.message : "Backend was refused",
                    ),
                });
                return null;
            }
            if (!current()) return null;

            if (confirmed.merged && confirmed.id !== id) {
                // The genuine alias case: another record already held this uid,
                // so there are two connections to one machine. Main closed this
                // alias's tunnel, so this socket goes either way.
                drop(id);
                attempts.delete(id);
                const canonical = get().machines.find((m) => m.id === confirmed.id);
                if (canonical) {
                    useBackendStore.setState((state) => ({
                        machines: state.machines.filter((m) => m.id !== id),
                    }));
                } else {
                    renameRow(id, confirmed.id);
                }
                // Main's "merged" means it holds the canonical's tunnel, not that
                // this renderer holds a socket there: that attach may have failed
                // or still be running. Only an attached row is the answer as is.
                if (canonical?.state === "attached") return confirmed.id;
                return get().attach(confirmed.id);
            }

            if (confirmed.id !== id) {
                // A rename, not a merge — this record simply had no uid until
                // now, which is every manual connect and every record read from
                // a pre-uid backends.json. The socket just handshaken over is
                // the only one there is; refile it rather than close it.
                rekeyConnection(id, confirmed.id);
                renameRow(id, confirmed.id);
                attempts.delete(id);
                nextAttempt(confirmed.id);
                liveId = confirmed.id;
            }
        }

        patch(liveId, { state: "attached", failure: undefined, backendUid: info.backendUid });
        followSocket(liveId);
        await get().bootstrapBackend(liveId);
        return liveId;
    },

    async detach(id, reason = "detach") {
        nextAttempt(id);
        unfollow(id);
        closeConnection(id, reason);
        resetBackend(id);
        try {
            await bridge().detachBackend(id);
        } finally {
            // The socket is closed either way; a row left "attached" over it
            // would lie. Main failing to persist the intent still rejects.
            patch(id, { state: "offline", failure: undefined, keepAttached: false });
        }
    },

    async refresh() {
        const [entries, attached] = await Promise.all([
            bridge().listBackends(),
            bridge().getAttached(),
        ]);
        const attachedById = new Map(attached.map((a) => [a.id, a]));

        function rowFor(
            state: BackendStore,
            id: string,
            base: Pick<MachineState, "displayName" | "host" | "instanceId" | "keepAttached">,
        ): MachineState {
            const previous = state.machines.find((m) => m.id === id);
            return {
                id,
                ...base,
                isLocal: attachedById.get(id)?.isLocal ?? previous?.isLocal ?? false,
                // Main's "attached" means a tunnel exists — not that the
                // handshake passed, nor that this renderer holds a socket. Only
                // `attach` may set that state; refresh reconciles identity and
                // labels and otherwise leaves the row's state alone.
                state: previous?.state ?? "offline",
                failure: previous?.failure,
                backendUid: previous?.backendUid,
                // Main persists `attached` only once the tunnel is open, so a
                // refresh landing mid-attach would read the old `false` and
                // drop the section of a machine the user just ticked.
                keepAttached: previous?.state === "attaching" ? true : base.keepAttached,
            };
        }

        useBackendStore.setState((state) => {
            const rows = entries.map((entry) =>
                rowFor(state, entry.id, {
                    displayName: entry.displayName,
                    host: entry.host,
                    instanceId: entry.instanceId,
                    keepAttached: entry.attached,
                }),
            );
            // Local is not a saved record, so `listBackends()` cannot return it,
            // but `getAttached()` does and every attached id needs a row. Without
            // it a purely local user has no "local" machine at all.
            const known = new Set(rows.map((row) => row.id));
            for (const live of attached) {
                if (known.has(live.id)) continue;
                known.add(live.id);
                rows.unshift(
                    rowFor(state, live.id, {
                        displayName: live.isLocal ? "This machine" : live.id,
                        host: "127.0.0.1",
                        instanceId: "main",
                        keepAttached: true,
                    }),
                );
            }
            // Local's row survives a refresh that lands while main's local port
            // is unknown: `getAttached()` omits it then, and the row `attach`
            // already drove to "attached" must not vanish under the workspace.
            for (const previous of state.machines) {
                if (previous.isLocal && !known.has(previous.id)) rows.unshift(previous);
            }
            return { machines: rows };
        });
    },

    async bootstrapBackend(id) {
        const attempt = attempts.get(id);
        // The sidebar and launch payloads need these too, but without them the
        // machine's projects and tasks still work: they never take it offline.
        void Promise.allSettled([
            useNotificationStore.getState().fetchNotifications(id),
            useScheduleStore.getState().fetchSchedules(id),
            useFlowStore.getState().fetchFlows(id),
            useFlowStore.getState().fetchActions(id),
            useSettingsStore.getState().fetchSettings(id),
        ]);
        const legs = await Promise.allSettled([
            useProjectStore.getState().fetchProjects(id),
            useTaskStore.getState().fetchTasks(id),
        ]);
        // A detach, retry or drop meanwhile owns the row now, and its closed
        // socket is what failed these requests.
        if (attempts.get(id) !== attempt) return;
        // Only this machine goes offline; every other machine's slices stay.
        if (legs.some((leg) => leg.status === "rejected")) {
            patch(id, {
                state: "offline",
                failure: unknownFailure("Could not load this machine's projects and tasks"),
            });
        }
    },

    async rehandshake(id) {
        const expectedUid = get().machines.find((m) => m.id === id)?.backendUid;
        const attempt = attempts.get(id);
        const info = await handshake(id, () => attempts.get(id) === attempt);
        if (!info) return;
        if (expectedUid && info.backendUid !== expectedUid) {
            // A different backend is answering on this port. Detach rather than
            // adopt it: its data would be filed under another machine's id.
            await get().detach(id);
            patch(id, { failure: unknownFailure("A different backend answered on this port") });
            return;
        }
        patch(id, { state: "attached", failure: undefined });
        await get().bootstrapBackend(id);
    },

    retry(id) {
        void (async () => {
            const attempt = nextAttempt(id);
            unfollow(id);
            closeConnection(id, "detach");
            // A tunnel main still holds for this id is handed back as-is by the
            // tunnel manager, even when the remote backend has since moved port.
            // Close it first so the attach dials afresh. Only when one exists:
            // a detach also clears the persisted intent, which a machine whose
            // tunnel already died must keep so the next launch redials it.
            const live = await bridge().getAttached();
            if (attempts.get(id) !== attempt) return;
            if (live.some((entry) => entry.id === id && !entry.isLocal)) {
                await bridge().detachBackend(id);
                if (attempts.get(id) !== attempt) return;
            }
            await get().attach(id);
        })();
    },
}));

function followSocket(backendId: string): void {
    unfollow(backendId);
    // `onStatusChange` replays the current status on subscribe, which is
    // "connected" right after a handshake.
    let wasConnected = true;
    statusUnsubs.set(
        backendId,
        onStatusChange(backendId, (status) => {
            if (status.connected && !wasConnected) {
                // The socket came back by itself. Re-handshake before trusting
                // it — a backend that restarted may be a different build, or not
                // the same backend at all — then refetch, because every slice
                // for this machine is now arbitrarily stale.
                wasConnected = true;
                void useBackendStore.getState().rehandshake(backendId);
                return;
            }
            if (!status.connected && wasConnected) {
                wasConnected = false;
                patch(backendId, { state: "offline" });
            }
        }),
    );
}

/** Primary's id, for a surface that addresses primary; throws before one exists. */
export function requirePrimary(): string {
    const { primaryId } = useBackendStore.getState();
    if (!primaryId) throw new Error("Not connected to a backend");
    return primaryId;
}

export function setPrimaryBackend(id: string): void {
    setPrimary(id);
    useBackendStore.setState({ primaryId: id });
}

/**
 * Beside the store rather than in it: it guards a procedure, and state would
 * invite a component to render off it and race the guard it exists to be.
 */
let switchInFlight = false;

/** Unsaved buffers on any machine the switch would detach, which disposes their models. */
function refusedAsDirty(target: string): SwitchResult | null {
    const files = dirtyFilePaths(target);
    return files.length > 0 ? { ok: false, reason: "dirty", files } : null;
}

/** Only `workAs` calls this, inside its guard. */
async function runSwitch(id: string): Promise<SwitchResult> {
    // Prepare the target first and never tear it down. Reuse it as-is if it
    // is already attached, which is the likely case. Otherwise address it by
    // the id `attach` hands back: a first handshake renames a provisional
    // record onto its uid, and by the id we were given it no longer exists.
    let target = id;
    const machines = () => useBackendStore.getState().machines;
    if (machines().some((m) => m.id === id && m.state === "attached")) {
        const dirty = refusedAsDirty(id);
        if (dirty) return dirty;
    } else {
        // No dirty check before attaching: until the handshake the target may be
        // an alias of an attached machine, whose buffers the switch keeps.
        // A refusal must leave the attached set as it found it, so a target
        // attached only for this switch is detached again. One the user already
        // wanted keeps the attach: that is what they asked for anyway. Judged by
        // both ids, before attaching: the target can turn out to be an alias of
        // a machine already attached under its uid.
        const wanted = new Set(
            machines()
                .filter((m) => m.keepAttached || m.state === "attached")
                .map((m) => m.id),
        );
        const refuse = async (result: SwitchResult, liveId: string): Promise<SwitchResult> => {
            if (!wanted.has(id) && !wanted.has(liveId)) {
                await useBackendStore.getState().detach(liveId);
            }
            return result;
        };

        const attached = await useBackendStore.getState().attach(id);
        // `attach` answers once the bootstrap ran, and a bootstrap that could
        // not load the machine's projects leaves it offline: not usable as primary.
        const row = machines().find((m) => m.id === (attached ?? id));
        if (attached === null || row?.state !== "attached") {
            const failure = row?.failure ?? unknownFailure("The machine did not attach");
            return refuse({ ok: false, reason: "unreachable", failure }, attached ?? id);
        }
        target = attached;
        const dirtyNow = refusedAsDirty(target);
        if (dirtyNow) return refuse(dirtyNow, target);
    }

    // Promote before detaching anything: closing the old primary's connection
    // clears primary in the registry, and every surface that addresses primary
    // — the connection overlay first — would read "not connected" until the
    // loop below finished.
    setPrimaryBackend(target);
    initConnectivity(target);

    // Detach everything except the target through the same `detach` the menu
    // uses, so each row goes offline and its socket subscription is dropped —
    // local included; main's IPC layer makes local's detach a no-op on its
    // side. All are started before any is awaited: each closes its socket and
    // disposes its buffers synchronously, so no machine stays editable after
    // the dirty check while main persists another's detach. Primary has already
    // moved, so a machine main fails to detach must not stop the rest: its
    // socket is closed and its row offline regardless.
    const { detach } = useBackendStore.getState();
    await Promise.allSettled(
        machines()
            .filter((machine) => machine.id !== target)
            .map((machine) => detach(machine.id, "switch")),
    );

    // Primary changing re-roots theme, master workspace, settings and connectivity.
    useBackendStore.setState((state) => ({ shellKey: state.shellKey + 1 }));
    return { ok: true };
}

window.taskflow?.onBackendsChanged(() => void useBackendStore.getState().refresh());

window.taskflow?.onBackendDropped((id, failure) => {
    // The ssh child died. Its forwarded port points at nothing, so stop the
    // socket retrying it; the records stay and only this machine goes offline.
    // An attach or rehandshake still awaiting over that tunnel is now stale: it
    // must not report success, or overwrite the drop's reason.
    nextAttempt(id);
    drop(id);
    patch(id, { state: "offline", failure });
});

window.taskflow?.onBackendSeen((id) => {
    // The beacon reappeared, which is positive evidence the machine woke up.
    // Re-attach now rather than waiting out the reconnect backoff. Only a machine
    // the user left attached: main announces every saved machine it sees, and a
    // detached row is "offline" too. A detach while main answers leaves that
    // answer stale, so the attempt counter must not have moved.
    const attempt = attempts.get(id);
    void (async () => {
        const entries = await bridge().listBackends();
        if (attempts.get(id) !== attempt) return;
        if (!entries.some((entry) => entry.id === id && entry.attached)) return;
        const machine = useBackendStore.getState().machines.find((m) => m.id === id);
        if (machine && machine.state === "offline") useBackendStore.getState().retry(id);
    })();
});

import { create } from "zustand";
import {
    MSG,
    PROTOCOL_VERSION,
    BackendUnauthorizedError,
    createTokenRefreshGate,
    unauthorizedFailure,
} from "@taskflow/shared";
import type { SystemInfoResponse, TunnelFailure } from "@taskflow/shared";
import { createBackendReconnects } from "@/lib/backend-reconnect";
import { notifyBackendReady } from "@/lib/backend-ready";
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
import { useBrowserTabStore } from "./browser-tab-store";
import { useDevServerStore } from "./dev-server-store";
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
    state: "attaching" | "attached" | "offline" | "incompatible" | "reconnecting";
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
        machines: state.machines.map((m) => {
            if (m.id !== id) return m;
            const next = { ...m, ...changes };
            // The same failure again keeps its identity: the machines menu
            // remembers a dismissed host-key dialog by object, and automatic
            // retries must not reopen it on every attempt.
            if (m.failure && next.failure && sameFailure(m.failure, next.failure)) {
                next.failure = m.failure;
            }
            return next;
        }),
    }));
}

function sameFailure(a: TunnelFailure, b: TunnelFailure): boolean {
    return a.kind === b.kind && a.message === b.message && a.stderr === b.stderr;
}

/**
 * One counter per machine, bumped by `attach`, `detach` and `retry`. An attach
 * checks it after every await and gives up once it moved: the user unticked the
 * machine, or a retry started over, and a late "attached" would resurrect a
 * row whose connection is already gone.
 */
const attempts = new Map<string, number>();
const gate = createTokenRefreshGate();

function nextAttempt(id: string): number {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    return attempt;
}

/** Automatic attempts retain the recovering row through transport and bootstrap. */
const automaticAttempts = new Map<string, symbol>();
const recovering = new Set<string>();
const confirmingIds = new Map<string, { uid: string; attempt: number }>();
const reconnects = createBackendReconnects({
    isWanted(id) {
        return useBackendStore
            .getState()
            .machines.some(
                (m) =>
                    m.id === id &&
                    !m.isLocal &&
                    m.keepAttached &&
                    m.failure?.kind !== "unauthorized",
            );
    },
    async attempt(id) {
        const owner = Symbol();
        automaticAttempts.set(id, owner);
        try {
            // A failed attempt may have left a tunnel to a port the backend has
            // since left; reusing it would fail the same way forever.
            const live = await closeLiveTunnel(
                id,
                () =>
                    automaticAttempts.get(id) === owner &&
                    useBackendStore.getState().machines.some((m) => m.id === id && m.keepAttached),
            );
            if (!live) return null;
            const canonical = await useBackendStore.getState().attach(id);
            return canonical &&
                useBackendStore
                    .getState()
                    .machines.some((m) => m.id === canonical && m.state === "attached")
                ? canonical
                : null;
        } catch (error) {
            if (automaticAttempts.get(id) === owner && recovering.has(id)) {
                patch(id, {
                    state: recoveryState(id),
                    failure: unknownFailure(error instanceof Error ? error.message : String(error)),
                });
            }
            return null;
        } finally {
            for (const [key, value] of automaticAttempts)
                if (value === owner) automaticAttempts.delete(key);
        }
    },
});

function recoveryState(id: string): "reconnecting" | "incompatible" | "offline" {
    if (!automaticAttempts.has(id)) return "offline";
    return useBackendStore.getState().machines.find((m) => m.id === id)?.state === "incompatible"
        ? "incompatible"
        : "reconnecting";
}

function removeRecovery(id: string): void {
    reconnects.remove(id);
    recovering.delete(id);
}

function rekeyRecovery(fromId: string, toId: string): void {
    reconnects.rekey(fromId, toId);
    if (recovering.delete(fromId)) recovering.add(toId);
    const owner = automaticAttempts.get(fromId);
    if (owner && !automaticAttempts.has(toId)) automaticAttempts.set(toId, owner);
    automaticAttempts.delete(fromId);
}

/**
 * A tunnel main still holds for this id is handed back as-is by the tunnel
 * manager, even when the remote backend has since moved port. Close it so the
 * next attach dials afresh. Only when one exists: a detach also clears the
 * persisted intent, which a machine whose tunnel already died must keep so the
 * next launch redials it. False once `current` lapses.
 */
async function closeLiveTunnel(id: string, current: () => boolean): Promise<boolean> {
    const live = await bridge().getAttached();
    if (!current()) return false;
    if (live.some((entry) => entry.id === id && !entry.isLocal)) {
        await bridge().detachBackend(id);
        if (!current()) return false;
    }
    return true;
}

/** A late tunnel belongs to nobody only while no newer attach wants this id. */
async function releaseLateTunnel(id: string): Promise<void> {
    const row = useBackendStore.getState().machines.find((m) => m.id === id);
    if (!row || !row.keepAttached) await bridge().detachBackend(id);
}

/** One status subscription per machine, dropped whenever its connection is. */
const statusUnsubs = new Map<string, () => void>();

function unfollow(id: string): void {
    statusUnsubs.get(id)?.();
    statusUnsubs.delete(id);
}

/** Close the connection and stop following it; the row is the caller's. */
function drop(id: string): void {
    reconnects.setConnected(id, false);
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
async function handshake(
    id: string,
    current: () => boolean,
): Promise<SystemInfoResponse | "unauthorized" | null> {
    let info: SystemInfoResponse;
    try {
        info = await sendRequest<SystemInfoResponse>(id, MSG.SYSTEM_INFO, {});
    } catch (error) {
        if (!current()) return null;
        if (error instanceof BackendUnauthorizedError) return "unauthorized";
        drop(id);
        patch(id, { state: recoveryState(id), failure: unknownFailure("No handshake") });
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

async function recoverUnauthorized(
    id: string,
    attempt: number | undefined,
): Promise<string | null> {
    const current = () =>
        attempts.get(id) === attempt &&
        useBackendStore.getState().machines.some((m) => m.id === id && m.keepAttached);
    if (!current()) return null;
    if (id === LOCAL_BACKEND_ID || gate.unauthorized(id) === "reject") {
        drop(id);
        patch(id, { state: "offline", failure: unauthorizedFailure(id === LOCAL_BACKEND_ID) });
        removeRecovery(id);
        return null;
    }
    await bridge().refreshBackendToken(id);
    if (!current()) return null;
    drop(id);
    return useBackendStore.getState().attach(id);
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
        const current = () =>
            attempts.get(id) === attempt &&
            get().machines.some((m) => m.id === id && m.keepAttached);
        patch(id, {
            state: automaticAttempts.has(id) ? recoveryState(id) : "attaching",
            failure: automaticAttempts.has(id)
                ? get().machines.find((m) => m.id === id)?.failure
                : undefined,
            keepAttached: true,
        });

        const result = await bridge().attachBackend(id);
        if (!current()) {
            if (result.ok) await releaseLateTunnel(id);
            return null;
        }
        if (!result.ok) {
            patch(id, { state: recoveryState(id), failure: result.failure });
            return null;
        }

        // `openConnection` replaces any connection under this id. Drop the
        // previous socket's status subscription first: it is keyed by id, so
        // the new socket's "connected" would otherwise reach it as a reconnect
        // and start a second handshake beside this one.
        unfollow(id);

        try {
            await openConnection(id, result.origin, result.token ?? null);
        } catch (error) {
            if (!current()) return null;
            if (error instanceof BackendUnauthorizedError) return recoverUnauthorized(id, attempt);
            // Drop the connection too, or it keeps reconnecting in the
            // background with nobody to handshake when it succeeds.
            drop(id);
            patch(id, { state: recoveryState(id), failure: unknownFailure("Socket refused") });
            return null;
        }
        if (!current()) return null;

        const info = await handshake(id, current);
        if (info === "unauthorized") return recoverUnauthorized(id, attempt);
        if (!info) return null;
        gate.authenticated(id);

        let liveId = id;
        if (info.backendUid) {
            let confirmed: { id: string; merged: boolean };
            const confirmation = { uid: info.backendUid, attempt };
            confirmingIds.set(id, confirmation);
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
                    state: recoveryState(id),
                    failure: unknownFailure(
                        error instanceof Error ? error.message : "Backend was refused",
                    ),
                });
                return null;
            } finally {
                if (confirmingIds.get(id) === confirmation) confirmingIds.delete(id);
            }
            if (!current()) {
                await releaseLateTunnel(confirmed.id);
                return null;
            }

            if (confirmed.merged && confirmed.id !== id) {
                // The genuine alias case: another record already held this uid,
                // so there are two connections to one machine. Main closed this
                // alias's tunnel, so this socket goes either way.
                drop(id);
                rekeyRecovery(id, confirmed.id);
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
                if (canonical?.state === "attached") {
                    recovering.delete(confirmed.id);
                    reconnects.setConnected(confirmed.id, true);
                    return confirmed.id;
                }
                if (canonical && recovering.has(confirmed.id)) {
                    reconnects.retryNow(confirmed.id);
                    return null;
                }
                return get().attach(confirmed.id);
            }

            if (confirmed.id !== id) {
                // A rename, not a merge — this record simply had no uid until
                // now, which is every manual connect and every record read from
                // a pre-uid backends.json. The socket just handshaken over is
                // the only one there is; refile it rather than close it.
                rekeyConnection(id, confirmed.id);
                rekeyRecovery(id, confirmed.id);
                renameRow(id, confirmed.id);
                attempts.delete(id);
                nextAttempt(confirmed.id);
                liveId = confirmed.id;
            }
        }

        gate.authenticated(liveId);
        if (get().primaryId === id || get().primaryId === liveId) setPrimaryBackend(liveId);
        const automatic = automaticAttempts.has(liveId);
        patch(liveId, {
            state: automatic ? "reconnecting" : "attached",
            failure: undefined,
            backendUid: info.backendUid,
        });
        followSocket(liveId);
        const liveAttempt = attempts.get(liveId);
        await get().bootstrapBackend(liveId);
        if (
            automatic &&
            attempts.get(liveId) === liveAttempt &&
            !get().machines.find((m) => m.id === liveId)?.failure
        ) {
            patch(liveId, { state: "attached" });
        }
        if (
            attempts.get(liveId) === liveAttempt &&
            get().machines.find((m) => m.id === liveId)?.state === "attached"
        ) {
            recovering.delete(liveId);
            reconnects.setConnected(liveId, true);
            notifyBackendReady(liveId);
        }
        return liveId;
    },

    async detach(id, reason = "detach") {
        removeRecovery(id);
        nextAttempt(id);
        patch(id, { keepAttached: false });
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
                keepAttached:
                    previous?.state === "attaching" || automaticAttempts.has(id)
                        ? (previous?.keepAttached ?? true)
                        : base.keepAttached,
            };
        }

        useBackendStore.setState((state) => {
            // A discovered machine that is not saved is not a machine yet: the
            // menu offers to add it, and attaching or switching to it has no record.
            const rows = entries
                .filter((entry) => entry.saved)
                .map((entry) =>
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
                if (known.has(previous.id)) continue;
                const confirmation = confirmingIds.get(previous.id);
                // Main may publish the uid rename before its confirm IPC resolves.
                // Keep the old row until that same attempt transfers ownership.
                if (
                    previous.isLocal ||
                    (confirmation &&
                        confirmation.attempt === attempts.get(previous.id) &&
                        known.has(confirmation.uid))
                ) {
                    rows.unshift(previous);
                }
            }
            for (const previous of state.machines) {
                const row = rows.find((m) => m.id === previous.id);
                if (!row || !row.keepAttached) {
                    removeRecovery(previous.id);
                    nextAttempt(previous.id);
                    drop(previous.id);
                }
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
            useDevServerStore.getState().fetchDevServers(id),
            useBrowserTabStore.getState().fetchBrowserTabs(id),
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
                state: recoveryState(id),
                failure: unknownFailure("Could not load this machine's projects and tasks"),
            });
        }
    },

    async rehandshake(id) {
        const expectedUid = get().machines.find((m) => m.id === id)?.backendUid;
        const attempt = attempts.get(id);
        const info = await handshake(
            id,
            () =>
                attempts.get(id) === attempt &&
                get().machines.some((m) => m.id === id && m.keepAttached),
        );
        if (info === "unauthorized") {
            await recoverUnauthorized(id, attempt);
            return;
        }
        if (!info) return;
        gate.authenticated(id);
        if (expectedUid && info.backendUid !== expectedUid) {
            // A different backend is answering on this port. Detach rather than
            // adopt it: its data would be filed under another machine's id.
            await get().detach(id);
            patch(id, { failure: unknownFailure("A different backend answered on this port") });
            return;
        }
        patch(id, { state: "attached", failure: undefined });
        await get().bootstrapBackend(id);
        if (
            attempts.get(id) === attempt &&
            get().machines.find((m) => m.id === id)?.state === "attached"
        ) {
            reconnects.setConnected(id, true);
            notifyBackendReady(id);
        }
    },

    retry(id) {
        if (recovering.has(id)) {
            reconnects.retryNow(id);
            return;
        }
        void (async () => {
            const attempt = nextAttempt(id);
            unfollow(id);
            closeConnection(id, "detach");
            if (!(await closeLiveTunnel(id, () => attempts.get(id) === attempt))) return;
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
                reconnects.setConnected(backendId, false);
                patch(backendId, { state: recovering.has(backendId) ? "reconnecting" : "offline" });
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

const unsubscribeChanged = window.taskflow?.onBackendsChanged(
    () => void useBackendStore.getState().refresh(),
);

const unsubscribeDropped = window.taskflow?.onBackendDropped((id, failure) => {
    const machine = useBackendStore.getState().machines.find((m) => m.id === id);
    if (
        !machine ||
        machine.isLocal ||
        !machine.keepAttached ||
        machine.failure?.kind === "unauthorized"
    )
        return;
    nextAttempt(id);
    drop(id);
    patch(id, { state: "reconnecting", failure });
    recovering.add(id);
    reconnects.lost(id);
});

const unsubscribeSeen = window.taskflow?.onBackendSeen((id) => {
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
        if (!machine || machine.isLocal || !machine.keepAttached) return;
        if (recovering.has(id)) reconnects.retryNow(id);
        else if (machine.state === "offline") useBackendStore.getState().retry(id);
    })();
});

const wakeRemotes = () => reconnects.retryNow();
const unsubscribeResume = window.taskflow?.onRemoteResume?.(wakeRemotes);
window.addEventListener("online", wakeRemotes);

function disposeRemoteListeners(): void {
    unsubscribeChanged?.();
    unsubscribeDropped?.();
    unsubscribeSeen?.();
    unsubscribeResume?.();
    window.removeEventListener("online", wakeRemotes);
    window.removeEventListener("beforeunload", disposeRemoteListeners);
    reconnects.dispose();
    recovering.clear();
    for (const id of attempts.keys()) nextAttempt(id);
}
window.addEventListener("beforeunload", disposeRemoteListeners);
if (import.meta.hot) import.meta.hot.dispose(disposeRemoteListeners);

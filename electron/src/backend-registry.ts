import { readFile, rename, writeFile } from "fs/promises";
import type { BackendRecord, DiscoveredBackend, MenuEntry, TunnelFailure } from "@taskflow/shared";
import {
    backendIdFor,
    createListener,
    isSafeLabel,
    isStale,
    isValidPort,
    type DiscoveryListener,
} from "@taskflow/shared/discovery";
import {
    adoptUid,
    matchesDiscovered,
    mergeForMenu,
    normalizeRecords,
    recordFromDiscovered,
    removeRecord,
    upsertRecord,
} from "./backend-records";
import type { TunnelResult } from "./tunnel-manager";

interface RegistryDeps {
    file: string;
    defaultUser: string;
    openTunnel(record: BackendRecord, backendPort: number): Promise<TunnelResult>;
    closeTunnel(id: string): void;
    /** Move a live ssh child from one record id to another, killing nothing. */
    rekeyTunnel(fromId: string, toId: string): void;
    readRemotePort(record: BackendRecord): Promise<{ port: number } | { failure: TunnelFailure }>;
    fetchHostKeyFingerprint(record: BackendRecord): Promise<string>;
    trustHostKey(record: BackendRecord): Promise<void>;
    /** Drop a fingerprint scanned for `id`, so an edited or removed record is never
     *  pinned with key material read from its old endpoint. */
    forgetScannedHostKey(id: string): void;
}

interface AddBackendInput {
    host: string;
    user?: string;
    sshPort?: number;
    port?: number;
    instanceId?: string;
}

interface BackendPatch {
    displayName?: string;
    user?: string;
    sshPort?: number;
}

type AttachResult = { ok: true; origin: string } | { ok: false; failure: TunnelFailure };

function unknownFailure(message: string): TunnelFailure {
    return { kind: "unknown", message, stderr: "" };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createRegistry(deps: RegistryDeps) {
    let records: BackendRecord[] = [];
    let discovered: DiscoveredBackend[] = [];
    let listener: DiscoveryListener | null = null;
    const origins = new Map<string, string>();
    const changeHandlers = new Set<() => void>();
    const seenHandlers = new Set<(id: string) => void>();

    function notifyChanged(): void {
        for (const handler of changeHandlers) handler();
    }

    function findRecord(id: string): BackendRecord | undefined {
        return records.find((entry) => entry.id === id);
    }

    /**
     * Writes are chained. Mutators on *different* ids are not serialized against
     * each other, and two concurrent writes to one path are not atomic. Each call
     * snapshots `records` when it is queued, so the last one queued carries the
     * newest state and lands last. A temp file and a rename keep a crash
     * mid-write from leaving a torn file, which `load` would read as no machines
     * and the next write would make permanent.
     */
    let persistChain: Promise<void> = Promise.resolve();
    function persist(): Promise<void> {
        const snapshot = JSON.stringify(records, null, 2);
        const temp = `${deps.file}.tmp`;
        const write = persistChain.then(async () => {
            await writeFile(temp, snapshot);
            await rename(temp, deps.file);
        });
        persistChain = write.catch(() => {});
        return write;
    }

    async function load(): Promise<void> {
        try {
            records = normalizeRecords(JSON.parse(await readFile(deps.file, "utf-8")));
        } catch {
            records = [];
        }
    }

    /**
     * Candidate ports for this backend, best first. A list rather than a single
     * answer, because every source can be wrong and one of them is hostile.
     *
     * `backendUid` is broadcast in cleartext in every announce, so any peer on the
     * LAN knows every uid, and `matchesDiscovered` keys on the uid alone: a
     * spoofed announce matches a saved record without claiming its address. If
     * the beacon won, that peer could point a saved machine at a dead port for as
     * long as it announces, and the same match drives `onSeen`, which re-drives
     * the failing attach.
     *
     * A port we have actually reached goes first. The readiness probe rejects
     * anything that is not a Taskflow, so a wrong candidate costs a probe.
     */
    async function backendPortCandidates(record: BackendRecord): Promise<number[] | TunnelFailure> {
        const live = discovered.find((entry) => matchesDiscovered(record, entry));
        const candidates: number[] = [];
        if (record.lastKnownPort) candidates.push(record.lastKnownPort);
        if (live && live.port !== record.lastKnownPort) candidates.push(live.port);
        if (candidates.length > 0) return candidates;
        const result = await deps.readRemotePort(record);
        return "port" in result ? [result.port] : result.failure;
    }

    /**
     * Registry mutations are serialized per backend id.
     *
     * Every mutator reads `records`, awaits, and writes back a value derived from
     * what it read, and `openTunnel` sits inside that window for up to ten seconds
     * of readiness probing. Unserialized, unchecking a machine while it connects
     * resurrects it: `upsertRecord` appends when the id is gone, so the attach's
     * stale snapshot reinstates the record with `attached: true` and an origin
     * pointing at the ssh child `removeBackend` just killed. A rename during an
     * attach is lost the same way.
     */
    const queues = new Map<string, Promise<unknown>>();
    function serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
        const previous = queues.get(id) ?? Promise.resolve();
        const next = previous.then(work, work);
        queues.set(
            id,
            next.catch(() => {}),
        );
        return next;
    }

    return {
        async init(): Promise<void> {
            await load();
            listener = createListener({
                onChange(entries) {
                    const before = new Set(discovered.map((entry) => entry.backendUid));
                    discovered = entries;
                    for (const entry of entries) {
                        if (before.has(entry.backendUid)) continue;
                        const record = records.find((r) => matchesDiscovered(r, entry));
                        if (record) for (const handler of seenHandlers) handler(record.id);
                    }
                    notifyChanged();
                },
            });
            await listener.start();
        },

        listBackends(): Promise<MenuEntry[]> {
            return Promise.resolve(mergeForMenu(records, discovered, Date.now()));
        },

        /** Records whose attached flag was persisted. The renderer dials these at
         *  launch; main deliberately does not, so there is one owner of the dial. */
        attachedRecordIds(): string[] {
            return records.filter((record) => record.attached).map((record) => record.id);
        },

        /** Every record with a live tunnel, and the origin that reaches it. */
        attached(): { id: string; origin: string }[] {
            return [...origins].map(([id, origin]) => ({ id, origin }));
        },

        addBackend(input: AddBackendInput): Promise<BackendRecord> {
            const host = input.host.trim();
            const instanceId = input.instanceId ?? "main";
            if (!host) return Promise.reject(new Error("Enter a host name or address."));
            if (!isSafeLabel(instanceId)) {
                return Promise.reject(new Error(`"${instanceId}" is not a valid instance name.`));
            }
            for (const value of [input.sshPort, input.port]) {
                if (value !== undefined && !isValidPort(value)) {
                    return Promise.reject(new Error(`${String(value)} is not a valid port.`));
                }
            }
            const id = backendIdFor(host, instanceId);
            // Serialized: adding a host that is already saved must not overwrite
            // that record while an attach of it holds a stale copy.
            return serialize(id, async () => {
                const existing = findRecord(id);
                if (existing) return existing;
                const record: BackendRecord = {
                    id,
                    backendUid: null,
                    host,
                    instanceId,
                    displayName: host,
                    user: input.user || deps.defaultUser,
                    sshPort: input.sshPort ?? 22,
                    lastKnownPort: input.port ?? null,
                    attached: false,
                    addedAt: new Date().toISOString(),
                };
                records = upsertRecord(records, record);
                await persist();
                notifyChanged();
                return record;
            });
        },

        /**
         * Save a seen-but-unsaved menu entry. Its id is `backendIdFor(address,
         * instanceId)`, the id the saved record will have; the record is
         * provisional (`recordFromDiscovered`) until a handshake confirms who it is.
         */
        addDiscoveredBackend(entryId: string): Promise<BackendRecord | null> {
            return serialize(entryId, async () => {
                const now = Date.now();
                const live = discovered.find(
                    (entry) =>
                        backendIdFor(entry.address, entry.instanceId) === entryId &&
                        !isStale(entry.lastSeenAt, now),
                );
                if (!live) return null;
                const existing = findRecord(entryId);
                if (existing) return existing;
                const record = recordFromDiscovered(
                    live,
                    deps.defaultUser,
                    new Date(now).toISOString(),
                );
                records = upsertRecord(records, record);
                await persist();
                notifyChanged();
                return record;
            });
        },

        attachBackend(id: string): Promise<AttachResult> {
            return serialize(id, async (): Promise<AttachResult> => {
                const record = findRecord(id);
                if (!record) return { ok: false, failure: unknownFailure("No such backend") };

                const candidates = await backendPortCandidates(record);
                if (!Array.isArray(candidates)) return { ok: false, failure: candidates };

                let tunnel: TunnelResult = {
                    ok: false,
                    failure: unknownFailure("No candidate port"),
                };
                let port = 0;
                for (const candidate of candidates) {
                    tunnel = await deps.openTunnel(record, candidate);
                    if (tunnel.ok) {
                        port = candidate;
                        break;
                    }
                }
                if (!tunnel.ok) return tunnel;

                // Re-read: serialization keeps other mutators out of this window,
                // but a removal queued before us leaves nothing to attach.
                const current = findRecord(id);
                if (!current) {
                    deps.closeTunnel(id);
                    return { ok: false, failure: unknownFailure("Backend was removed") };
                }

                const origin = `http://127.0.0.1:${tunnel.localPort}`;
                origins.set(id, origin);
                records = upsertRecord(records, {
                    ...current,
                    attached: true,
                    lastKnownPort: port,
                });
                await persist();
                notifyChanged();
                return { ok: true, origin };
            });
        },

        detachBackend(id: string): Promise<void> {
            return serialize(id, async () => {
                deps.closeTunnel(id);
                origins.delete(id);
                const record = findRecord(id);
                if (record) records = upsertRecord(records, { ...record, attached: false });
                await persist();
                notifyChanged();
            });
        },

        /**
         * The ssh child for `id` exited without being closed. Its origin now points
         * at nothing. The persisted `attached` flag stays: the user still wants
         * that machine, and the renderer's retry (or the next launch) redials it.
         */
        tunnelExited(id: string): Promise<void> {
            return serialize(id, () => {
                if (origins.delete(id)) notifyChanged();
                return Promise.resolve();
            });
        },

        /**
         * The renderer completed a handshake and learned who this really is.
         * Rekeying happens here rather than at attach time because only the
         * renderer has a socket, and a beacon-advertised uid is a hint anyone on
         * the LAN can forge.
         *
         * Two cases, and conflating them breaks the common one. **Rename** is the
         * first successful attach of any record that had no uid yet, which is every
         * manual connect: the record, its origin and its ssh child move to the uid,
         * and the renderer's live connection is still the only one there is.
         * **Merge** is the alias case: a record already holds this uid *and* has a
         * live origin, so the newcomer's connection and tunnel are surplus.
         *
         * Rejects, touching nothing, when the uid is outside the safe label set
         * (it could spell a provisional `host:instance` id and merge two
         * machines), when the record is gone, and when an already-confirmed record
         * answers with a different uid: that is a different backend on that host
         * and port, and adopting it would hand this record's attached flag and
         * tunnel to whoever answered.
         */
        confirmBackend(
            id: string,
            info: { backendUid: string; protocolVersion: number },
        ): Promise<{ id: string; merged: boolean }> {
            return serialize(id, async () => {
                const uid = info.backendUid;
                if (!isSafeLabel(uid)) throw new Error(`"${uid}" is not a valid backend uid.`);
                const record = findRecord(id);
                if (!record) throw new Error("No such backend");
                if (record.backendUid !== null && record.backendUid !== uid) {
                    throw new Error(
                        `${record.displayName} answered as a different backend than the one saved.`,
                    );
                }
                if (id === uid) return { id, merged: false };

                // Merge only when the canonical record is live. A saved but
                // detached record under this uid has nothing worth keeping, so
                // that case is a rename onto it: the records still merge
                // (`adoptUid` handles both) and the renderer keeps its connection.
                const merged = origins.has(uid);

                records = adoptUid(records, id, uid);
                deps.forgetScannedHostKey(id);

                const origin = origins.get(id);
                origins.delete(id);
                if (merged) {
                    // The canonical record keeps what it had. This tunnel is
                    // surplus, and nothing would ever close it by this id again.
                    deps.closeTunnel(id);
                } else {
                    // Carry the live tunnel and origin across, or `closeTunnel(uid)`
                    // on the next detach kills nothing and leaks an ssh child.
                    deps.rekeyTunnel(id, uid);
                    if (origin) origins.set(uid, origin);
                }

                await persist();
                notifyChanged();
                return { id: uid, merged };
            });
        },

        updateBackend(id: string, patch: BackendPatch): Promise<{ ok: boolean; reason?: string }> {
            return serialize(id, async () => {
                const record = findRecord(id);
                if (!record) return { ok: false, reason: "No such backend" };
                if (patch.sshPort !== undefined && !isValidPort(patch.sshPort)) {
                    return { ok: false, reason: `${String(patch.sshPort)} is not a valid port.` };
                }
                // Named fields only: the patch arrives over IPC, and spreading it
                // whole would let it rewrite `id` or `backendUid`.
                const next: BackendRecord = {
                    ...record,
                    displayName:
                        typeof patch.displayName === "string"
                            ? patch.displayName
                            : record.displayName,
                    user: typeof patch.user === "string" ? patch.user : record.user,
                    sshPort: patch.sshPort ?? record.sshPort,
                };
                deps.forgetScannedHostKey(id);
                records = upsertRecord(records, next);
                await persist();
                notifyChanged();
                return { ok: true };
            });
        },

        removeBackend(id: string): Promise<{ ok: boolean; reason?: string }> {
            return serialize(id, async () => {
                deps.closeTunnel(id);
                deps.forgetScannedHostKey(id);
                origins.delete(id);
                records = removeRecord(records, id);
                await persist();
                notifyChanged();
                return { ok: true };
            });
        },

        async getHostFingerprint(
            id: string,
        ): Promise<{ ok: true; fingerprint: string } | { ok: false; reason: string }> {
            const record = findRecord(id);
            if (!record) return { ok: false, reason: "No such backend" };
            try {
                return { ok: true, fingerprint: await deps.fetchHostKeyFingerprint(record) };
            } catch (error) {
                return { ok: false, reason: errorMessage(error) };
            }
        },

        async trustBackendHost(id: string): Promise<{ ok: boolean; reason?: string }> {
            const record = findRecord(id);
            if (!record) return { ok: false, reason: "No such backend" };
            try {
                await deps.trustHostKey(record);
                return { ok: true };
            } catch (error) {
                return { ok: false, reason: errorMessage(error) };
            }
        },

        originFor(id: string): string | null {
            return origins.get(id) ?? null;
        },

        onChanged(handler: () => void): () => void {
            changeHandlers.add(handler);
            return () => changeHandlers.delete(handler);
        },

        onSeen(handler: (id: string) => void): () => void {
            seenHandlers.add(handler);
            return () => seenHandlers.delete(handler);
        },

        probe(): void {
            listener?.probe();
        },

        /** Seed the discovery cache without a socket. Tests only: the port
         *  preference rules are the point and they are not reachable otherwise. */
        __setDiscoveredForTest(entries: DiscoveredBackend[]): void {
            discovered = entries;
        },

        stop(): void {
            listener?.stop();
        },
    };
}

type BackendRegistry = ReturnType<typeof createRegistry>;

export { createRegistry };
export type { BackendRegistry };

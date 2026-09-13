import { backendIdFor, isSafeLabel, isStale, isValidPort } from "@taskflow/shared/discovery";
import type { BackendRecord, DiscoveredBackend } from "@taskflow/shared";

/** A row in the machines menu: a saved record, a discovered backend, or both. */
export interface MenuEntry {
    id: string;
    displayName: string;
    instanceId: string;
    host: string;
    attached: boolean;
    saved: boolean;
    seen: boolean;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Parse `backends.json`, tolerating a file written before uids existed. Such a
 * file has no `backendUid` and no `attached`, so its records are read as
 * provisional and detached; the first successful handshake rekeys them. There
 * is deliberately no migration step: a machine that is never reached again
 * simply stays provisional, which costs nothing.
 */
export function normalizeRecords(parsed: unknown): BackendRecord[] {
    if (!Array.isArray(parsed)) return [];
    const records: BackendRecord[] = [];
    // Per id: where it sits in `records`, and whether the file already saved it
    // under that id.
    const slots = new Map<string, { index: number; exact: boolean }>();
    for (const entry of parsed) {
        if (!isRecordLike(entry)) continue;
        const host = typeof entry.host === "string" ? entry.host : null;
        const instanceId = typeof entry.instanceId === "string" ? entry.instanceId : null;
        if (!host || !instanceId) continue;
        // Held to the codec's label set: `:` is outside it, so a uid can never
        // spell a provisional `host:instance` id.
        const backendUid =
            typeof entry.backendUid === "string" && isSafeLabel(entry.backendUid)
                ? entry.backendUid
                : null;
        const storedId = typeof entry.id === "string" && entry.id ? entry.id : null;
        // A confirmed record is keyed by its uid whatever id the file holds, so
        // `adoptUid` finds it by id. Of hand-edited duplicates, the one already
        // saved under that id wins (it is what the registry last wrote);
        // otherwise the first does.
        const id = backendUid ?? storedId ?? backendIdFor(host, instanceId);
        const exact = storedId === id;
        const slot = slots.get(id);
        if (slot && (slot.exact || !exact)) continue;
        const index = slot ? slot.index : records.length;
        slots.set(id, { index, exact });
        records[index] = {
            id,
            backendUid,
            host,
            instanceId,
            displayName: typeof entry.displayName === "string" ? entry.displayName : host,
            user: typeof entry.user === "string" ? entry.user : "",
            sshPort: isValidPort(entry.sshPort) ? entry.sshPort : 22,
            lastKnownPort: isValidPort(entry.lastKnownPort) ? entry.lastKnownPort : null,
            attached: entry.attached === true,
            addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date(0).toISOString(),
        };
    }
    return records;
}

export function upsertRecord(records: BackendRecord[], next: BackendRecord): BackendRecord[] {
    const index = records.findIndex((record) => record.id === next.id);
    if (index === -1) return [...records, next];
    const copy = [...records];
    copy[index] = next;
    return copy;
}

export function removeRecord(records: BackendRecord[], id: string): BackendRecord[] {
    return records.filter((record) => record.id !== id);
}

/**
 * Rekey the record currently under `currentId` onto the `backendUid` its
 * handshake reported. If another record already holds that uid, the two are one
 * backend reached by two names: they merge, the survivor keeps its attached
 * state, and it adopts the host that just proved reachable.
 */
export function adoptUid(
    records: BackendRecord[],
    currentId: string,
    backendUid: string,
): BackendRecord[] {
    if (!isSafeLabel(backendUid)) return records;
    const source = records.find((record) => record.id === currentId);
    if (!source) return records;
    if (source.id === backendUid && source.backendUid === backendUid) return records;

    const existing = records.find((record) => record.id === backendUid && record !== source);
    if (!existing) {
        return records.map((record) =>
            record === source ? { ...record, id: backendUid, backendUid } : record,
        );
    }

    const merged: BackendRecord = {
        ...existing,
        backendUid,
        id: backendUid,
        host: source.host,
        sshPort: source.sshPort,
        user: source.user || existing.user,
        lastKnownPort: source.lastKnownPort ?? existing.lastKnownPort,
        attached: existing.attached || source.attached,
    };
    return records
        .filter((record) => record !== source)
        .map((record) => (record === existing ? merged : record));
}

export function recordFromDiscovered(
    entry: DiscoveredBackend,
    defaultUser: string,
    addedAt: string,
): BackendRecord {
    return {
        // Provisional, exactly like a manual connect. The beacon's uid is a hint
        // anyone on the LAN can advertise; it is confirmed at handshake and
        // adopted there (`adoptUid`), never here. `matchesDiscovered` still
        // finds this record from its address and instance, so `seen` works.
        id: backendIdFor(entry.address, entry.instanceId),
        backendUid: null,
        // The datagram's source address, never the announced hostname. A
        // hostname announced by another machine is not necessarily resolvable
        // from here, and it is attacker-chosen text from an unauthenticated
        // datagram: `isSafeLabel` keeps it to [A-Za-z0-9._-], which is exactly
        // the character set of an ssh_config `Host` alias. Whatever lands here
        // becomes an ssh destination and a host-key lookup key.
        host: entry.address,
        instanceId: entry.instanceId,
        displayName: entry.displayName || entry.hostname,
        user: defaultUser,
        sshPort: 22,
        lastKnownPort: entry.port,
        attached: false,
        addedAt,
    };
}

/**
 * Does this announcement describe this record? Uid first, because that is
 * identity; host and instance only as a fallback for a record that has never
 * completed a handshake.
 */
export function matchesDiscovered(record: BackendRecord, entry: DiscoveredBackend): boolean {
    if (record.backendUid) return record.backendUid === entry.backendUid;
    return record.host === entry.address && record.instanceId === entry.instanceId;
}

/**
 * Saved records first in their stored order, then live entries not yet saved.
 * An unsaved row is keyed by source address and instance — the id
 * `recordFromDiscovered` will save it under — not by its announced uid, which
 * any machine on the LAN can repeat.
 */
export function mergeForMenu(
    records: BackendRecord[],
    discovered: DiscoveredBackend[],
    now: number,
): MenuEntry[] {
    const live = discovered.filter((entry) => !isStale(entry.lastSeenAt, now));
    const saved: MenuEntry[] = records.map((record) => ({
        id: record.id,
        displayName: record.displayName,
        instanceId: record.instanceId,
        host: record.host,
        attached: record.attached,
        saved: true,
        seen: live.some((entry) => matchesDiscovered(record, entry)),
    }));
    const unsaved: MenuEntry[] = live
        .filter((entry) => !records.some((record) => matchesDiscovered(record, entry)))
        .map((entry) => ({
            id: backendIdFor(entry.address, entry.instanceId),
            displayName: entry.displayName || entry.hostname,
            instanceId: entry.instanceId,
            host: entry.address,
            attached: false,
            saved: false,
            seen: true,
        }));
    return [...saved, ...unsaved];
}

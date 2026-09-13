import {
    DISCOVERY_MAX_DATAGRAM_BYTES,
    DISCOVERY_MAX_DISPLAY_NAME,
    DISCOVERY_STALE_AFTER_MS,
} from "../constants";
import type { BeaconAnnounce, BeaconProbe } from "../types/backend";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Provisional key for a backend whose uid is not known yet — a manual connect,
 * a port-file fallback, or a record persisted before uids existed. Records under
 * this key are rekeyed to their backendUid on first successful handshake.
 * Never use it to decide whether two records are the same backend.
 */
function backendIdFor(hostname: string, instanceId: string): string {
    return `${hostname}:${instanceId}`;
}

function encodeAnnounce(announce: BeaconAnnounce): Uint8Array {
    return encoder.encode(JSON.stringify(announce));
}

function encodeProbe(): Uint8Array {
    const probe: BeaconProbe = { v: 1, probe: true };
    return encoder.encode(JSON.stringify(probe));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * `instanceId` and `hostname` are the announced strings that leave the codec:
 * they form the provisional record id, and `instanceId` is interpolated into a
 * command run over ssh on the remote machine. Anything outside this character
 * set is refused here rather than quoted later, because there is one parser and
 * many consumers. `backendUid` is held to the same set.
 */
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isSafeLabel(value: string): boolean {
    return SAFE_LABEL.test(value);
}

function isValidPort(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

/**
 * Anything on the LAN can send us bytes, so every field is checked and any
 * surprise returns null rather than throwing.
 */
function parseDatagram(bytes: Uint8Array): BeaconAnnounce | BeaconProbe | null {
    if (bytes.byteLength > DISCOVERY_MAX_DATAGRAM_BYTES) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoder.decode(bytes));
    } catch {
        return null;
    }
    if (!isRecord(parsed) || parsed.v !== 1) return null;

    if (parsed.probe === true) return { v: 1, probe: true };

    const { protocolVersion, instanceId, hostname, displayName, port, appVersion, os, backendUid } =
        parsed;
    if (typeof protocolVersion !== "number" || !Number.isInteger(protocolVersion)) return null;
    if (typeof instanceId !== "string" || !isSafeLabel(instanceId)) return null;
    if (typeof hostname !== "string" || !isSafeLabel(hostname)) return null;
    if (
        typeof displayName !== "string" ||
        displayName.length === 0 ||
        displayName.length > DISCOVERY_MAX_DISPLAY_NAME
    ) {
        return null;
    }
    if (!isValidPort(port)) return null;
    if (typeof appVersion !== "string") return null;
    if (typeof os !== "string") return null;
    if (typeof backendUid !== "string" || !isSafeLabel(backendUid)) return null;

    return {
        v: 1,
        protocolVersion,
        instanceId,
        hostname,
        displayName,
        port,
        appVersion,
        os,
        backendUid,
    };
}

function isStale(lastSeenAt: number, now: number): boolean {
    return now - lastSeenAt > DISCOVERY_STALE_AFTER_MS;
}

export {
    backendIdFor,
    encodeAnnounce,
    encodeProbe,
    isSafeLabel,
    isStale,
    isValidPort,
    parseDatagram,
};

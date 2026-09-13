/** One backend announcing itself on the local network. */
export interface BeaconAnnounce {
    v: 1;
    protocolVersion: number;
    instanceId: string;
    hostname: string;
    displayName: string;
    port: number;
    appVersion: string;
    os: string;
    /** The advertising backend's stable identity. A hint only: anyone on the LAN
     *  can advertise one, so it is never trusted until a handshake confirms it. */
    backendUid: string;
}

/** Sent by a client to ask every backend to announce immediately. */
export interface BeaconProbe {
    v: 1;
    probe: true;
}

/** An announcement plus what the receiver knows about it. */
export interface DiscoveredBackend extends BeaconAnnounce {
    /** Source address of the datagram, which is what we ssh to. */
    address: string;
    lastSeenAt: number;
}

export interface BackendRecord {
    /** The record's key. The `backendUid` once known, otherwise a provisional
     *  `${host}:${instanceId}`. Never assume it is one or the other. */
    id: string;
    /** Confirmed identity, learned at handshake. `null` until then. */
    backendUid: string | null;
    host: string;
    instanceId: string;
    displayName: string;
    user: string;
    sshPort: number;
    /** The backend's own port, refreshed from the beacon. Not the tunnel's. */
    lastKnownPort: number | null;
    /** Restored at launch. Attach is attempted in the background, never blocking. */
    attached: boolean;
    addedAt: string;
}

/** A row in the machines menu: a saved record, a discovered backend, or both. */
export interface MenuEntry {
    id: string;
    displayName: string;
    instanceId: string;
    host: string;
    attached: boolean;
    saved: boolean;
    seen: boolean;
    /** The saved record's ssh login, for editing. Absent on an unsaved discovered row. */
    user?: string;
    sshPort?: number;
}

export type TunnelFailureKind =
    | "unknown-host-key"
    | "changed-host-key"
    | "auth-refused"
    | "no-route"
    | "local-bind-failed"
    | "no-backend"
    | "no-ssh-binary"
    /** ssh refused the user or host string itself. See `classifyTunnelFailure`. */
    | "bad-destination"
    | "unknown";

export interface TunnelFailure {
    kind: TunnelFailureKind;
    /** Shown to the user. */
    message: string;
    /** Always retained, whatever the classification, so a misclassification stays diagnosable. */
    stderr: string;
}

import type { BackendRecord, BeaconAnnounce } from "../types/backend";

const BANNER = "Taskflow backend";

/**
 * What a backend answers to an anonymous `GET /`: the banner, then its
 * instance and uid. Both are already broadcast in every beacon, so naming
 * them unauthenticated discloses nothing new. The tunnel's readiness probe
 * reads them to tell this backend apart from another instance that has taken
 * its remembered port.
 */
export function backendBanner(identity: Pick<BeaconAnnounce, "instanceId" | "backendUid">): string {
    return `${BANNER} ${identity.instanceId} ${identity.backendUid}`;
}

/**
 * Whether a `GET /` body comes from the backend `expected` names. The uid is
 * compared when the record has one, else the instance. A bare banner (a backend
 * older than the identity) is accepted. `null` means the body is not a Taskflow
 * banner at all.
 */
export function readBackendBanner(
    body: string,
    expected: Pick<BackendRecord, "instanceId" | "backendUid">,
): "match" | "other" | null {
    const text = body.trim();
    if (text === BANNER) return "match";
    if (!text.startsWith(`${BANNER} `)) return null;
    const [instanceId = "", backendUid = ""] = text.slice(BANNER.length + 1).split(" ");
    const same =
        expected.backendUid !== null
            ? backendUid === expected.backendUid
            : instanceId === expected.instanceId;
    return same ? "match" : "other";
}

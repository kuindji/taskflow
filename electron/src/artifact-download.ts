import type { AttachedBackend } from "./attached-backends";

const ARTIFACT_PATH_PREFIX = "/api/flow/artifact/";

/** Whether `value` is a raw-artifact route on one of the attached backends. */
function isArtifactUrl(value: string, attached: AttachedBackend[]): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        url.pathname.startsWith(ARTIFACT_PATH_PREFIX) &&
        attached.some((entry) => new URL(entry.origin).origin === url.origin)
    );
}

/**
 * The bytes at an artifact URL already checked by `isArtifactUrl`. Redirects are
 * refused: following one would fetch an origin that check never saw.
 */
async function fetchArtifactBytes(url: string): Promise<Buffer> {
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

export { fetchArtifactBytes, isArtifactUrl };

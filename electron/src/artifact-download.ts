import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { rename, rm } from "fs/promises";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import type { AttachedBackend } from "./attached-backends";

const ARTIFACT_PATH_PREFIX = "/api/flow/artifact/";

/** A response body's chunks; the body is cancelled if the consumer stops early. */
async function* chunksOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    let done = false;
    try {
        while (!done) {
            const next = await reader.read();
            done = next.done;
            if (next.value) yield next.value;
        }
    } finally {
        if (!done) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

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
 * Saves the bytes at a raw-artifact URL to `destination`. The attached set is checked
 * when the download starts, not only when it was asked for: the save dialog in between
 * can stay open while that machine is detached. Redirects are refused: following one
 * would fetch an origin that check never saw. The body is streamed to disk, since an
 * artifact can be larger than main should hold in memory. It is written beside
 * `destination` and renamed over it only once complete, so a download that breaks off
 * removes its own partial file and leaves a file the user chose to replace as it was.
 */
async function downloadArtifact(
    url: string,
    attached: () => AttachedBackend[],
    destination: string,
): Promise<void> {
    if (!isArtifactUrl(url, attached())) throw new Error("Invalid artifact URL");
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("Artifact response has no body");
    // Not named after `destination`: a name the filesystem just accepts would not fit.
    const partial = join(dirname(destination), `.taskflow-${randomUUID()}.part`);
    try {
        await pipeline(chunksOf(response.body), createWriteStream(partial));
        await rename(partial, destination);
    } catch (err) {
        await rm(partial, { force: true });
        throw err;
    }
}

export { downloadArtifact, isArtifactUrl };

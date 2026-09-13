import { originFor } from "@/lib/connection-registry";

/** URL for the raw bytes of an absolute path on a specific backend, or null if it is not attached. */
function rawFileUrl(backendId: string, absolutePath: string): string | null {
    const origin = originFor(backendId);
    if (origin === null) return null;
    return `${origin}/api/file/raw?path=${encodeURIComponent(absolutePath)}`;
}

export { rawFileUrl };

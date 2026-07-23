import { getBackendPort } from "@/hooks/useWebSocket";

function backendHttpOrigin(): string | null {
    const port = getBackendPort();
    return port === null ? null : `http://localhost:${port}`;
}

/** URL for the raw bytes of an absolute workspace path, or null before connect. */
function rawFileUrl(absolutePath: string): string | null {
    const origin = backendHttpOrigin();
    if (origin === null) return null;
    return `${origin}/api/file/raw?path=${encodeURIComponent(absolutePath)}`;
}

export { rawFileUrl };

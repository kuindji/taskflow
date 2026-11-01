import { useCallback, useEffect, useState } from "react";
import { MSG, type RemoteAgentStatusPayload } from "@taskflow/shared";
import { onBackendReady } from "@/lib/backend-ready";
import { onEvent, sendRequest } from "@/lib/connection-registry";

/** The remote agent of one backend: settings show primary's. */
function useRemoteAgentStatus(backendId: string | null) {
    const [status, setStatus] = useState<RemoteAgentStatusPayload>({ running: false });

    useEffect(() => {
        setStatus({ running: false });
        if (!backendId) return;
        let cancelled = false;
        const fetchStatus = () => {
            sendRequest<RemoteAgentStatusPayload>(backendId, MSG.REMOTE_AGENT_STATUS, {}).then(
                (next) => {
                    if (!cancelled) setStatus(next);
                },
                () => {},
            );
        };
        fetchStatus();

        const off = onEvent(MSG.REMOTE_AGENT_STATUS_CHANGED, (payload, fromBackendId) => {
            if (fromBackendId === backendId) setStatus(payload as RemoteAgentStatusPayload);
        });
        // Settings stays mounted from launch, so the first read can come before
        // the connection exists, and a change made while the socket was down is
        // never broadcast again: read again whenever the machine is ready.
        const offReady = onBackendReady((readyId) => {
            if (readyId === backendId) fetchStatus();
        });
        return () => {
            cancelled = true;
            off();
            offReady();
        };
    }, [backendId]);

    const start = useCallback(async () => {
        if (!backendId) return;
        const result = await sendRequest<RemoteAgentStatusPayload>(
            backendId,
            MSG.REMOTE_AGENT_START,
            {},
        );
        setStatus(result);
    }, [backendId]);

    const stop = useCallback(async () => {
        if (!backendId) return;
        const result = await sendRequest<RemoteAgentStatusPayload>(
            backendId,
            MSG.REMOTE_AGENT_STOP,
            {},
        );
        setStatus(result);
    }, [backendId]);

    return { ...status, start, stop };
}

export { useRemoteAgentStatus };

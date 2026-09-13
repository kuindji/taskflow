import { useCallback, useEffect, useState } from "react";
import { MSG, type RemoteAgentStatusPayload } from "@taskflow/shared";
import { onEvent, sendRequest } from "@/lib/connection-registry";

/** The remote agent of one backend: settings show primary's. */
function useRemoteAgentStatus(backendId: string | null) {
    const [status, setStatus] = useState<RemoteAgentStatusPayload>({ running: false });

    useEffect(() => {
        setStatus({ running: false });
        if (!backendId) return;
        let cancelled = false;
        sendRequest<RemoteAgentStatusPayload>(backendId, MSG.REMOTE_AGENT_STATUS, {}).then(
            (next) => {
                if (!cancelled) setStatus(next);
            },
            () => {},
        );

        const off = onEvent(MSG.REMOTE_AGENT_STATUS_CHANGED, (payload, fromBackendId) => {
            if (fromBackendId === backendId) setStatus(payload as RemoteAgentStatusPayload);
        });
        return () => {
            cancelled = true;
            off();
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

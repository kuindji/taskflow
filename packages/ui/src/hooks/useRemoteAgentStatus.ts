import { useCallback, useEffect, useState } from "react";
import { MSG, type RemoteAgentStatusPayload } from "@taskflow/shared";
import { sendRequest, onEvent } from "./useWebSocket";

function useRemoteAgentStatus() {
    const [status, setStatus] = useState<RemoteAgentStatusPayload>({ running: false });

    useEffect(() => {
        sendRequest<RemoteAgentStatusPayload>(MSG.REMOTE_AGENT_STATUS, {}).then(
            setStatus,
            () => {},
        );

        return onEvent(MSG.REMOTE_AGENT_STATUS_CHANGED, (payload) => {
            setStatus(payload as RemoteAgentStatusPayload);
        });
    }, []);

    const start = useCallback(async () => {
        const result = await sendRequest<RemoteAgentStatusPayload>(MSG.REMOTE_AGENT_START, {});
        setStatus(result);
    }, []);

    const stop = useCallback(async () => {
        const result = await sendRequest<RemoteAgentStatusPayload>(MSG.REMOTE_AGENT_STOP, {});
        setStatus(result);
    }, []);

    return { ...status, start, stop };
}

export { useRemoteAgentStatus };

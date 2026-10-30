import {
    INHERIT_AGENT_ACCOUNT,
    MSG,
    type CodexModelsPayload,
    type CodexModelsResponse,
} from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";

export function loadCodexDiscovery(
    backendId: string,
    payload: CodexModelsPayload,
): Promise<CodexModelsResponse> {
    const { account, projectId } = payload;
    return sendRequest<CodexModelsResponse>(backendId, MSG.CODEX_MODELS, {
        ...(account && account !== INHERIT_AGENT_ACCOUNT ? { account } : {}),
        ...(projectId ? { projectId } : {}),
    });
}

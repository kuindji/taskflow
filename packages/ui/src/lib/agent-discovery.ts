import {
    INHERIT_AGENT_ACCOUNT,
    MSG,
    type CodexModelsPayload,
    type CodexModelsResponse,
    type PiModelsResponse,
} from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";

/** Backends from before account diagnostics answer `{ models }` only. */
type CodexModelsWire = Omit<CodexModelsResponse, "account"> &
    Partial<Pick<CodexModelsResponse, "account">>;

export async function loadCodexDiscovery(
    backendId: string,
    payload: CodexModelsPayload,
    request: (backendId: string, type: string, payload: unknown) => Promise<CodexModelsWire> = (
        id,
        type,
        body,
    ) => sendRequest<CodexModelsWire>(id, type, body),
): Promise<CodexModelsResponse> {
    const { account, projectId } = payload;
    const response = await request(backendId, MSG.CODEX_MODELS, {
        ...(account && account !== INHERIT_AGENT_ACCOUNT ? { account } : {}),
        ...(projectId ? { projectId } : {}),
    });
    return { models: response.models, account: response.account ?? { state: "unknown" } };
}

export function loadPiModels(backendId: string): Promise<PiModelsResponse> {
    return sendRequest<PiModelsResponse>(backendId, MSG.PI_MODELS, {});
}

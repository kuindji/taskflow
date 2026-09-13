import { useCallback } from "react";
import { sendRequest } from "@/lib/connection-registry";
import { useWorkspaceBackend } from "./useWorkspaceBackend";

type WorkspaceRequest = <T = unknown>(type: string, payload?: unknown) => Promise<T>;

/**
 * A request bound to the open workspace's machine, for pane-layer code that
 * sends several. Rejects while the workspace has no machine, like a request to
 * a detached one.
 */
export function useWorkspaceRequest(): WorkspaceRequest {
    const backendId = useWorkspaceBackend();
    return useCallback<WorkspaceRequest>(
        <T>(type: string, payload: unknown = {}) =>
            backendId
                ? sendRequest<T>(backendId, type, payload)
                : Promise.reject(new Error("This workspace has no machine")),
        [backendId],
    );
}

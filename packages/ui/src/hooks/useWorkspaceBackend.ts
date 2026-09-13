import { useActiveWorkspace } from "./useActiveWorkspace";
import { usePrimaryBackend } from "./usePrimaryBackend";

/**
 * The machine the open workspace belongs to. Master workspace belongs to
 * primary. The single place the pane layer reads its target from — everything
 * outside a workspace (sidebar rows, background work) must carry its own.
 */
export function useWorkspaceBackend(): string | null {
    const workspace = useActiveWorkspace();
    const primaryId = usePrimaryBackend();
    if (workspace.scope === "master") return primaryId;
    return workspace.project?.backendId ?? null;
}

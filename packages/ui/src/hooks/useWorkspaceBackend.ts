import { useSyncExternalStore } from "react";
import { getPrimary, onPrimaryChange } from "@/lib/connection-registry";
import { useActiveWorkspace } from "./useActiveWorkspace";

/**
 * The machine the open workspace belongs to. Master workspace belongs to
 * primary. The single place the pane layer reads its target from — everything
 * outside a workspace (sidebar rows, background work) must carry its own.
 */
export function useWorkspaceBackend(): string | null {
    const workspace = useActiveWorkspace();
    const primaryId = useSyncExternalStore(onPrimaryChange, getPrimary);
    if (workspace.scope === "master") return primaryId;
    return workspace.project?.backendId ?? null;
}

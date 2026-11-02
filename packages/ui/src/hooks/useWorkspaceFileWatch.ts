import { useEffect } from "react";
import { useFileStore } from "@/stores/file-store";
import { useBackendStore } from "@/stores/backend-store";
import { pathFlavour, relativeTo } from "@/lib/path-flavour";
import { useActiveWorkspace } from "./useActiveWorkspace";

/**
 * Keeps the open workspace's root watched while a pane shows `filePath` from
 * it, so FILE_CHANGED reaches the pane with the file explorer closed. The
 * explorer watches the same root, so both share one backend watch.
 */
export function useWorkspaceFileWatch(backendId: string | null, filePath: string): void {
    const workingDir = useActiveWorkspace().workingDir;
    const os = useBackendStore((s) => s.machines.find((m) => m.id === backendId)?.os);
    const retainWatch = useFileStore((s) => s.retainWatch);
    const root =
        workingDir !== null && relativeTo(workingDir, filePath, pathFlavour(os)) !== null
            ? workingDir
            : null;

    useEffect(() => {
        if (backendId === null || root === null) return;
        return retainWatch(backendId, root);
    }, [backendId, root, retainWatch]);
}

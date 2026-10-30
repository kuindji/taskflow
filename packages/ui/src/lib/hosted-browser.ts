import { MSG, type BrowserTab, type BrowserTabOpenPayload } from "@taskflow/shared";
import { workspaceBackendId, workspaceOwner } from "@/hooks/useActiveWorkspace";
import { isElectron } from "@/hooks/useIsElectron";
import { sendRequest } from "@/lib/connection-registry";
import { useBackendStore } from "@/stores/backend-store";
import { backendHostsBrowser, useBrowserTabStore } from "@/stores/browser-tab-store";

/**
 * Opens a registry tab in the workspace's scope when its backend hosts the
 * browser. Null when it doesn't: the caller opens a legacy tab instead.
 */
export function openHostedBrowserTab(
    workspaceKey: string,
    url: string,
    label: string,
): Promise<BrowserTab> | null {
    const backendId = workspaceBackendId(workspaceKey);
    if (
        !backendId ||
        !backendHostsBrowser(
            backendId,
            isElectron(),
            useBackendStore.getState().machines,
            useBrowserTabStore.getState().byBackend[backendId],
        )
    )
        return null;
    const owner = workspaceOwner(workspaceKey);
    const payload: BrowserTabOpenPayload = {
        scope: owner.taskId
            ? { kind: "task", taskId: owner.taskId }
            : owner.projectId
              ? { kind: "project", projectId: owner.projectId }
              : { kind: "master" },
        url,
        label,
    };
    return sendRequest<BrowserTab>(backendId, MSG.BROWSER_TAB_OPEN, payload);
}

import { useSessionStore, isSessionExited } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import { isEditorDirty, clearEditorDirty } from "@/components/panes/editor-dirty-state";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { confirm } from "@/stores/dialog-store";

/**
 * Close a workspace tab the way its close button does: an editor or markdown
 * tab with unsaved edits, or a CLI editor that is still running, asks first.
 * The tab button, Close Tab menu item and Cmd/Ctrl+W all come through here.
 */
function requestCloseTab(workspaceKey: string, tab: Tab): void {
    const backendId = workspaceBackendId(workspaceKey);

    const doClose = () => {
        if (tab.filePath && backendId !== null) clearEditorDirty(backendId, tab.filePath);
        // A close the session's machine refuses keeps the tab, so the terminal
        // goes only once the close went through.
        void useSessionStore
            .getState()
            .closeTab(workspaceKey, tab.id)
            .then(
                () => {
                    if (tab.sessionId) destroyTerminal(tab.sessionId);
                },
                (error: unknown) => console.warn("Close tab failed; the tab stays", error),
            );
    };

    if (
        (tab.type === "editor" || tab.type === "markdown") &&
        tab.filePath &&
        backendId !== null &&
        isEditorDirty(backendId, tab.filePath)
    ) {
        void confirm({
            title: "Unsaved Changes",
            description: `"${tab.filePath.split("/").pop()}" has unsaved changes that will be lost.`,
            confirmLabel: "Close Without Saving",
            cancelLabel: "Cancel",
            variant: "destructive",
            onConfirm: async () => doClose(),
        });
        return;
    }

    if (tab.type === "editor" && tab.sessionId && !isSessionExited(tab.sessionId)) {
        void confirm({
            title: "Editor Still Running",
            description: `"${tab.label}" is still running. Unsaved changes will be lost.`,
            confirmLabel: "Close Editor",
            cancelLabel: "Cancel",
            variant: "destructive",
            onConfirm: async () => doClose(),
        });
        return;
    }

    doClose();
}

export { requestCloseTab };

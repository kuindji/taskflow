import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("taskflow", {
    getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
    selectProjectDirectory: () => ipcRenderer.invoke("select-project-directory"),
    selectThemeFile: () => ipcRenderer.invoke("select-theme-file"),
    openExternalUrl: (url: string) => ipcRenderer.invoke("open-external-url", url),
    openExternalFile: (filePath: string, opts?: { line?: number; col?: number; editor?: string }) =>
        ipcRenderer.invoke("open-external-file", filePath, opts),
    showItemInFolder: (filePath: string) => ipcRenderer.send("show-item-in-folder", filePath),
    onNewTask: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("new-task", listener);
        return () => {
            ipcRenderer.removeListener("new-task", listener);
        };
    },
    onNewTerminal: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("new-terminal", listener);
        return () => {
            ipcRenderer.removeListener("new-terminal", listener);
        };
    },
    onCloseTab: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("close-tab", listener);
        return () => {
            ipcRenderer.removeListener("close-tab", listener);
        };
    },
    onOpenSettings: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("open-settings", listener);
        return () => {
            ipcRenderer.removeListener("open-settings", listener);
        };
    },
    onToggleArchive: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("toggle-archive", listener);
        return () => {
            ipcRenderer.removeListener("toggle-archive", listener);
        };
    },
    sendArchiveState: (showArchive: boolean) => {
        ipcRenderer.send("archive-state-changed", showArchive);
    },
    onToggleCompactSidebar: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("toggle-compact-sidebar", listener);
        return () => {
            ipcRenderer.removeListener("toggle-compact-sidebar", listener);
        };
    },
    sendCompactSidebarState: (compact: boolean) => {
        ipcRenderer.send("compact-sidebar-changed", compact);
    },
    onToggleFileExplorer: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("toggle-file-explorer", listener);
        return () => {
            ipcRenderer.removeListener("toggle-file-explorer", listener);
        };
    },
    sendFileExplorerState: (open: boolean) => {
        ipcRenderer.send("file-explorer-state-changed", open);
    },
    onToggleTaskInfo: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("toggle-task-info", listener);
        return () => {
            ipcRenderer.removeListener("toggle-task-info", listener);
        };
    },
    sendTaskInfoState: (open: boolean) => {
        ipcRenderer.send("task-info-state-changed", open);
    },
    onToggleWordWrap: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("toggle-word-wrap", listener);
        return () => {
            ipcRenderer.removeListener("toggle-word-wrap", listener);
        };
    },
    sendWordWrapState: (enabled: boolean) => {
        ipcRenderer.send("word-wrap-state-changed", enabled);
    },
    onUpdateStatus: (callback: (payload: { status: string; version?: string }) => void) => {
        const listener = (
            _event: Electron.IpcRendererEvent,
            payload: { status: string; version?: string },
        ) => callback(payload);
        ipcRenderer.on("update-status", listener);
        return () => {
            ipcRenderer.removeListener("update-status", listener);
        };
    },
    quitAndInstallUpdate: () => {
        ipcRenderer.send("quit-and-install-update");
    },
    onWindowFocusChanged: (callback: (focused: boolean) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: { focused: boolean }) =>
            callback(payload.focused);
        ipcRenderer.on("window-focus-changed", listener);
        return () => {
            ipcRenderer.removeListener("window-focus-changed", listener);
        };
    },
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
});

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("taskflow", {
    getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
    selectProjectDirectory: () => ipcRenderer.invoke("select-project-directory"),
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
});

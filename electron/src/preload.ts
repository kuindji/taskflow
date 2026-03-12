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
    onCloseTab: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("close-tab", listener);
        return () => {
            ipcRenderer.removeListener("close-tab", listener);
        };
    },
});

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("taskflow", {
    getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
    selectProjectDirectory: () => ipcRenderer.invoke("select-project-directory"),
    openExternalUrl: (url: string) => ipcRenderer.invoke("open-external-url", url),
    openExternalFile: (filePath: string) => ipcRenderer.invoke("open-external-file", filePath),
    onCloseTab: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("close-tab", listener);
        return () => {
            ipcRenderer.removeListener("close-tab", listener);
        };
    },
});

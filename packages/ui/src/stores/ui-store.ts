import { create } from "zustand";

interface UIStore {
    fileExplorerOpen: boolean;
    taskInfoOpen: boolean;
    settingsOpen: boolean;
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    panelGap: number;
    toggleFileExplorer(): void;
    toggleTaskInfo(): void;
    toggleSettings(): void;
    setSidebarWidth(width: number): void;
    setFileExplorerWidth(width: number): void;
    setTaskInfoWidth(width: number): void;
    setPanelGap(gap: number): void;
}

export const useUIStore = create<UIStore>((set) => ({
    fileExplorerOpen: false,
    taskInfoOpen: false,
    settingsOpen: false,
    sidebarWidth: 220,
    fileExplorerWidth: 220,
    taskInfoWidth: 220,
    panelGap: 6,
    toggleFileExplorer() {
        set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen }));
    },
    toggleTaskInfo() {
        set((s) => ({ taskInfoOpen: !s.taskInfoOpen }));
    },
    toggleSettings() {
        set((s) => ({ settingsOpen: !s.settingsOpen }));
    },
    setSidebarWidth(width) {
        set({ sidebarWidth: width });
    },
    setFileExplorerWidth(width) {
        set({ fileExplorerWidth: width });
    },
    setTaskInfoWidth(width) {
        set({ taskInfoWidth: width });
    },
    setPanelGap(gap) {
        set({ panelGap: gap });
    },
}));

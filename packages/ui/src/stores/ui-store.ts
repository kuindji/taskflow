import { create } from "zustand";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 350;
const FILE_EXPLORER_MIN = 150;
const FILE_EXPLORER_MAX = 500;
const TASK_INFO_MIN = 150;
const TASK_INFO_MAX = 500;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

interface UIStore {
    activeProjectId: string | null;
    fileExplorerOpen: boolean;
    taskInfoOpen: boolean;
    settingsOpen: boolean;
    flowManagementOpen: boolean;
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    panelGap: number;
    toggleFileExplorer(): void;
    toggleTaskInfo(): void;
    toggleSettings(): void;
    toggleFlowManagement(): void;
    setActiveProject(id: string | null): void;
    setSidebarWidth(width: number): void;
    setFileExplorerWidth(width: number): void;
    setTaskInfoWidth(width: number): void;
    setPanelGap(gap: number): void;
    hydrateLayout(panels: {
        sidebarWidth?: number;
        fileExplorerWidth?: number;
        taskInfoWidth?: number;
    }): void;
}

export const useUIStore = create<UIStore>((set) => ({
    activeProjectId: null,
    fileExplorerOpen: false,
    taskInfoOpen: false,
    settingsOpen: false,
    flowManagementOpen: false,
    sidebarWidth: 220,
    fileExplorerWidth: 220,
    taskInfoWidth: 220,
    panelGap: 4,
    toggleFileExplorer() {
        set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen }));
    },
    toggleTaskInfo() {
        set((s) => ({ taskInfoOpen: !s.taskInfoOpen }));
    },
    toggleSettings() {
        set((s) => ({ settingsOpen: !s.settingsOpen }));
    },
    toggleFlowManagement() {
        set((s) => ({ flowManagementOpen: !s.flowManagementOpen }));
    },
    setActiveProject(id) {
        set({ activeProjectId: id });
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
    hydrateLayout(panels) {
        set({
            sidebarWidth: clamp(panels.sidebarWidth ?? 220, SIDEBAR_MIN, SIDEBAR_MAX),
            fileExplorerWidth: clamp(
                panels.fileExplorerWidth ?? 220,
                FILE_EXPLORER_MIN,
                FILE_EXPLORER_MAX,
            ),
            taskInfoWidth: clamp(panels.taskInfoWidth ?? 220, TASK_INFO_MIN, TASK_INFO_MAX),
        });
    },
}));

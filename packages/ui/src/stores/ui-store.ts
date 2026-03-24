import { create } from "zustand";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 350;
const FILE_EXPLORER_MIN = 150;
const FILE_EXPLORER_MAX = 500;
const TASK_INFO_MIN = 150;
const TASK_INFO_MAX = 500;
const FLOW_PANEL_MIN = 150;
const FLOW_PANEL_MAX = 400;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function updateCollapsedProjectIds(
    current: string[],
    projectId: string,
    collapsed: boolean,
): string[] {
    if (collapsed) {
        if (current.includes(projectId)) return current;
        return [...current, projectId];
    }

    return current.filter((id) => id !== projectId);
}

type PanelId = "sidebar" | "fileexplorer" | "workspace" | "taskinfo";
export type { PanelId };

interface UIStore {
    activeProjectId: string | null;
    masterWorkspaceActive: boolean;
    fileExplorerOpen: boolean;
    taskInfoOpen: boolean;
    settingsOpen: boolean;
    flowPanelOpen: boolean;
    flowManagementOpen: boolean;
    scheduleManagementOpen: boolean;
    appearanceOpen: boolean;
    shortcutsDialogOpen: boolean;
    agentOperationsHelpOpen: boolean;
    focusedPanel: PanelId;
    sidebarFocusedItem: { type: "project" | "task"; id: string } | null;
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    flowPanelWidth: number;
    panelGap: number;
    collapsedProjectIds: string[];
    toggleFileExplorer(): void;
    toggleTaskInfo(): void;
    openSettings(): void;
    toggleSettings(): void;
    toggleFlowManagement(): void;
    toggleScheduleManagement(): void;
    setAppearanceOpen(open: boolean): void;
    toggleAppearance(): void;
    openShortcutsDialog(): void;
    setShortcutsDialogOpen(open: boolean): void;
    toggleShortcutsDialog(): void;
    openAgentOperationsHelp(): void;
    setAgentOperationsHelpOpen(open: boolean): void;
    setFocusedPanel(panel: PanelId): void;
    setSidebarFocusedItem(item: { type: "project" | "task"; id: string } | null): void;
    setFlowPanelOpen(open: boolean): void;
    setMasterWorkspaceActive(active: boolean): void;
    setActiveProject(id: string | null): void;
    setSidebarWidth(width: number): void;
    setFileExplorerWidth(width: number): void;
    setTaskInfoWidth(width: number): void;
    setFlowPanelWidth(width: number): void;
    setPanelGap(gap: number): void;
    setProjectCollapsed(projectId: string, collapsed: boolean): void;
    hydrateLayout(panels: {
        sidebarWidth?: number;
        fileExplorerWidth?: number;
        taskInfoWidth?: number;
        flowPanelWidth?: number;
        collapsedProjectIds?: string[];
    }): void;
}

export const useUIStore = create<UIStore>((set) => ({
    activeProjectId: null,
    masterWorkspaceActive: false,
    fileExplorerOpen: false,
    taskInfoOpen: false,
    settingsOpen: false,
    flowPanelOpen: false,
    flowManagementOpen: false,
    scheduleManagementOpen: false,
    appearanceOpen: false,
    shortcutsDialogOpen: false,
    agentOperationsHelpOpen: false,
    focusedPanel: "workspace" as const,
    sidebarFocusedItem: null,
    sidebarWidth: 220,
    fileExplorerWidth: 220,
    taskInfoWidth: 220,
    flowPanelWidth: 220,
    panelGap: 4,
    collapsedProjectIds: [],
    toggleFileExplorer() {
        set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen }));
    },
    toggleTaskInfo() {
        set((s) => ({ taskInfoOpen: !s.taskInfoOpen }));
    },
    openSettings() {
        set({ settingsOpen: true });
    },
    toggleSettings() {
        set((s) => ({ settingsOpen: !s.settingsOpen }));
    },
    toggleFlowManagement() {
        set((s) => ({ flowManagementOpen: !s.flowManagementOpen }));
    },
    toggleScheduleManagement() {
        set((s) => ({ scheduleManagementOpen: !s.scheduleManagementOpen }));
    },
    setAppearanceOpen(open) {
        set({ appearanceOpen: open });
    },
    toggleAppearance() {
        set((s) => ({ appearanceOpen: !s.appearanceOpen }));
    },
    openShortcutsDialog() {
        set({ shortcutsDialogOpen: true });
    },
    setShortcutsDialogOpen(open) {
        set({ shortcutsDialogOpen: open });
    },
    toggleShortcutsDialog() {
        set((s) => ({ shortcutsDialogOpen: !s.shortcutsDialogOpen }));
    },
    openAgentOperationsHelp() {
        set({ agentOperationsHelpOpen: true });
    },
    setAgentOperationsHelpOpen(open) {
        set({ agentOperationsHelpOpen: open });
    },
    setFocusedPanel(panel) {
        set({ focusedPanel: panel });
    },
    setSidebarFocusedItem(item) {
        set({ sidebarFocusedItem: item });
    },
    setFlowPanelOpen(open) {
        set({ flowPanelOpen: open });
    },
    setMasterWorkspaceActive(active) {
        set({ masterWorkspaceActive: active });
    },
    setActiveProject(id) {
        set({ activeProjectId: id, ...(id ? { masterWorkspaceActive: false } : {}) });
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
    setFlowPanelWidth(width) {
        set({ flowPanelWidth: width });
    },
    setPanelGap(gap) {
        set({ panelGap: gap });
    },
    setProjectCollapsed(projectId, collapsed) {
        set((s) => ({
            collapsedProjectIds: updateCollapsedProjectIds(
                s.collapsedProjectIds,
                projectId,
                collapsed,
            ),
        }));
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
            flowPanelWidth: clamp(panels.flowPanelWidth ?? 220, FLOW_PANEL_MIN, FLOW_PANEL_MAX),
            collapsedProjectIds: panels.collapsedProjectIds ?? [],
        });
    },
}));

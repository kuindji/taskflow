import { create } from "zustand";

const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 350;
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

type PaneId = "left" | "right";
export type { PaneId };

interface WorkspaceSplit {
    open: boolean;
    ratio: number;
    activePane: PaneId;
}

/** Static ordering used by cycleFocus to determine panel cycle direction. */
const PANEL_ORDER: readonly PanelId[] = ["sidebar", "fileexplorer", "workspace", "taskinfo"];

function getOrderedPanels(registered: Set<PanelId>): PanelId[] {
    return PANEL_ORDER.filter((id) => registered.has(id));
}

export { getOrderedPanels };

interface UIStore {
    activeProjectId: string | null;
    masterWorkspaceActive: boolean;
    fileExplorerOpen: boolean;
    searchPanelOpen: boolean;
    wikiPanelOpen: boolean;
    taskInfoOpen: boolean;
    settingsOpen: boolean;
    flowPanelOpen: boolean;
    flowManagementOpen: boolean;
    scheduleManagementOpen: boolean;
    appearanceOpen: boolean;
    shortcutsDialogOpen: boolean;
    agentOperationsHelpOpen: boolean;
    commandPaletteOpen: boolean;
    focusedPanel: PanelId;
    navigationMode: boolean;
    cmdHeld: boolean;
    registeredPanels: Set<PanelId>;
    sidebarFocusedItem: { type: "project" | "task"; id: string } | null;
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    flowPanelWidth: number;
    panelGap: number;
    collapsedProjectIds: string[];
    splitByWorkspace: Record<string, WorkspaceSplit>;
    toggleFileExplorer(): void;
    toggleSearchPanel(): void;
    toggleWikiPanel(): void;
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
    setCommandPaletteOpen(open: boolean): void;
    toggleCommandPalette(): void;
    setFocusedPanel(panel: PanelId): void;
    setNavigationMode(active: boolean): void;
    setCmdHeld(held: boolean): void;
    registerPanel(id: PanelId): void;
    unregisterPanel(id: PanelId): void;
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
    toggleSplit(workspaceKey: string): void;
    setSplitRatio(workspaceKey: string, ratio: number): void;
    setActivePane(workspaceKey: string, pane: PaneId): void;
    getSplit(workspaceKey: string): WorkspaceSplit | undefined;
}

export const useUIStore = create<UIStore>((set, get) => ({
    activeProjectId: null,
    masterWorkspaceActive: false,
    fileExplorerOpen: false,
    searchPanelOpen: false,
    wikiPanelOpen: false,
    taskInfoOpen: false,
    settingsOpen: false,
    flowPanelOpen: false,
    flowManagementOpen: false,
    scheduleManagementOpen: false,
    appearanceOpen: false,
    shortcutsDialogOpen: false,
    agentOperationsHelpOpen: false,
    commandPaletteOpen: false,
    focusedPanel: "workspace" as const,
    navigationMode: false,
    cmdHeld: false,
    registeredPanels: new Set<PanelId>(["sidebar", "workspace"]),
    sidebarFocusedItem: null,
    sidebarWidth: 220,
    fileExplorerWidth: 220,
    taskInfoWidth: 220,
    flowPanelWidth: 220,
    panelGap: 6,
    collapsedProjectIds: [],
    splitByWorkspace: {},
    toggleFileExplorer() {
        set((s) => ({
            fileExplorerOpen: !s.fileExplorerOpen,
            ...(!s.fileExplorerOpen ? { searchPanelOpen: false, wikiPanelOpen: false } : {}),
        }));
    },
    toggleSearchPanel() {
        set((s) => ({
            searchPanelOpen: !s.searchPanelOpen,
            ...(!s.searchPanelOpen ? { fileExplorerOpen: false, wikiPanelOpen: false } : {}),
        }));
    },
    toggleWikiPanel() {
        set((s) => ({
            wikiPanelOpen: !s.wikiPanelOpen,
            ...(!s.wikiPanelOpen ? { fileExplorerOpen: false, searchPanelOpen: false } : {}),
        }));
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
    setCommandPaletteOpen(open) {
        set({ commandPaletteOpen: open });
    },
    toggleCommandPalette() {
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen }));
    },
    setFocusedPanel(panel) {
        set({ focusedPanel: panel });
    },
    setNavigationMode(active) {
        set({ navigationMode: active });
    },
    setCmdHeld(held) {
        set({ cmdHeld: held });
    },
    registerPanel(id) {
        set((s) => {
            if (s.registeredPanels.has(id)) return s;
            const next = new Set(s.registeredPanels);
            next.add(id);
            return { registeredPanels: next };
        });
    },
    unregisterPanel(id) {
        set((s) => {
            if (!s.registeredPanels.has(id)) return s;
            const next = new Set(s.registeredPanels);
            next.delete(id);
            // Fall back to workspace if the unregistered panel was focused
            const patch: Partial<UIStore> = { registeredPanels: next };
            if (s.focusedPanel === id) patch.focusedPanel = "workspace";
            return patch;
        });
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
    toggleSplit(workspaceKey) {
        set((s) => {
            const existing = s.splitByWorkspace[workspaceKey];
            if (existing) {
                const { [workspaceKey]: _, ...rest } = s.splitByWorkspace;
                return { splitByWorkspace: rest };
            }
            return {
                splitByWorkspace: {
                    ...s.splitByWorkspace,
                    [workspaceKey]: { open: true, ratio: 0.5, activePane: "left" as PaneId },
                },
            };
        });
    },
    setSplitRatio(workspaceKey, ratio) {
        set((s) => {
            const existing = s.splitByWorkspace[workspaceKey];
            if (!existing) return s;
            return {
                splitByWorkspace: {
                    ...s.splitByWorkspace,
                    [workspaceKey]: { ...existing, ratio: clamp(ratio, 0.2, 0.8) },
                },
            };
        });
    },
    setActivePane(workspaceKey, pane) {
        set((s) => {
            const existing = s.splitByWorkspace[workspaceKey];
            if (!existing) return s;
            return {
                splitByWorkspace: {
                    ...s.splitByWorkspace,
                    [workspaceKey]: { ...existing, activePane: pane },
                },
            };
        });
    },
    getSplit(workspaceKey) {
        return get().splitByWorkspace[workspaceKey];
    },
}));

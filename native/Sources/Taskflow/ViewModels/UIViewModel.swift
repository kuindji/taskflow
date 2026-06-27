import Foundation
import Observation

// MARK: - Supporting types

/// Sidebar-focused item — mirrors `{ type: "project" | "task"; id: string }` in `ui-store.ts`.
struct SidebarFocusedItem: Equatable, Sendable {
    enum ItemType: String, Sendable { case project, task }
    let type: ItemType
    let id: String
}

// MARK: - UIViewModel

/// 1:1 port of `packages/ui/src/stores/ui-store.ts`.
///
/// - All panel visibility flags and width setters with their exact clamp ranges.
/// - `fileExplorerOpen` and `searchPanelOpen` are mutually exclusive (opening one closes the other).
/// - `splitByWorkspace` tracks per-workspace split state; `toggleSplit` creates on first open
///   and toggles `open` in place on subsequent calls (preserving ratio/activePane).
/// - `hydrateLayout` accepts `PanelSettings` (the generated type from Task 3) and writes
///   clamped widths + `collapsedProjectIds`.
/// - UIViewModel carries no WS client: `ui-store.ts` has no WS subscriptions (`YAGNI`).
@MainActor
@Observable
final class UIViewModel {

    // MARK: - PanelId

    /// Panel identifiers — mirrors `PanelId` in `ui-store.ts`.
    enum PanelId: String, Sendable { case sidebar, fileexplorer, workspace, taskinfo }

    // MARK: - Width constants

    private static let sidebarMin: Double    = 180
    private static let sidebarMax: Double    = 350
    private static let fileExplorerMin: Double = 150
    private static let fileExplorerMax: Double = 500
    private static let taskInfoMin: Double   = 150
    private static let taskInfoMax: Double   = 500
    private static let flowPanelMin: Double  = 150
    private static let flowPanelMax: Double  = 400

    private static let splitRatioMin: Double = 0.2
    private static let splitRatioMax: Double = 0.8

    // MARK: - Default widths

    private static let defaultSidebarWidth: Double      = 220
    private static let defaultFileExplorerWidth: Double = 220
    private static let defaultTaskInfoWidth: Double     = 220
    private static let defaultFlowPanelWidth: Double    = 220

    // MARK: - Panel order (for cycleFocus)

    private static let panelOrder: [PanelId] = [.sidebar, .fileexplorer, .workspace, .taskinfo]

    // MARK: - State

    var activeProjectId: String? = nil
    var masterWorkspaceActive: Bool = false

    // Panel visibility
    var fileExplorerOpen: Bool = false
    var searchPanelOpen: Bool = false
    var taskInfoOpen: Bool = false
    var settingsOpen: Bool = false
    var flowPanelOpen: Bool = false
    var flowManagementOpen: Bool = false
    var scheduleManagementOpen: Bool = false
    var appearanceOpen: Bool = false
    var shortcutsDialogOpen: Bool = false
    var agentOperationsHelpOpen: Bool = false
    var commandPaletteOpen: Bool = false

    // Focus / keyboard
    var focusedPanel: PanelId = .workspace
    var navigationMode: Bool = false
    var cmdHeld: Bool = false

    // Panel registry
    var registeredPanels: Set<PanelId> = [.sidebar, .workspace]

    // Sidebar focus
    var sidebarFocusedItem: SidebarFocusedItem? = nil

    // Panel widths (private(set): mutations go through the clamping setters)
    private(set) var sidebarWidth: Double      = defaultSidebarWidth
    private(set) var fileExplorerWidth: Double = defaultFileExplorerWidth
    private(set) var taskInfoWidth: Double     = defaultTaskInfoWidth
    private(set) var flowPanelWidth: Double    = defaultFlowPanelWidth
    var panelGap: Double = 6

    // Collapsed project IDs
    var collapsedProjectIds: [String] = []

    // Split state
    private(set) var splitByWorkspace: [String: WorkspaceSplit] = [:]

    // MARK: - Init (no WS client: ui-store.ts has no subscriptions)

    init() {}

    // MARK: - Clamp helper

    /// Pure clamp — used by all width setters and `setSplitRatio`.
    static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        Swift.min(hi, Swift.max(lo, v))
    }

    // MARK: - Panel visibility actions

    /// Toggles file-explorer; if opening, closes search panel (mutually exclusive).
    func toggleFileExplorer() {
        let opening = !fileExplorerOpen
        fileExplorerOpen = opening
        if opening { searchPanelOpen = false }
    }

    /// Toggles search panel; if opening, closes file-explorer (mutually exclusive).
    func toggleSearchPanel() {
        let opening = !searchPanelOpen
        searchPanelOpen = opening
        if opening { fileExplorerOpen = false }
    }

    /// Opens search panel and closes file-explorer (mutual exclusivity enforced).
    func openSearchPanel() {
        searchPanelOpen = true
        fileExplorerOpen = false
    }

    func toggleTaskInfo() { taskInfoOpen.toggle() }

    func openSettings() { settingsOpen = true }
    func toggleSettings() { settingsOpen.toggle() }

    func toggleFlowManagement() { flowManagementOpen.toggle() }
    func toggleScheduleManagement() { scheduleManagementOpen.toggle() }

    func setAppearanceOpen(_ open: Bool) { appearanceOpen = open }
    func toggleAppearance() { appearanceOpen.toggle() }

    func openShortcutsDialog() { shortcutsDialogOpen = true }
    func setShortcutsDialogOpen(_ open: Bool) { shortcutsDialogOpen = open }
    func toggleShortcutsDialog() { shortcutsDialogOpen.toggle() }

    func openAgentOperationsHelp() { agentOperationsHelpOpen = true }
    func setAgentOperationsHelpOpen(_ open: Bool) { agentOperationsHelpOpen = open }

    func setCommandPaletteOpen(_ open: Bool) { commandPaletteOpen = open }
    func toggleCommandPalette() { commandPaletteOpen.toggle() }

    // MARK: - Focus / keyboard actions

    func setFocusedPanel(_ panel: PanelId) { focusedPanel = panel }
    func setNavigationMode(_ active: Bool) { navigationMode = active }
    func setCmdHeld(_ held: Bool) { cmdHeld = held }

    // MARK: - Panel registry

    func registerPanel(_ id: PanelId) {
        registeredPanels.insert(id)
    }

    func unregisterPanel(_ id: PanelId) {
        registeredPanels.remove(id)
        if focusedPanel == id { focusedPanel = .workspace }
    }

    // MARK: - Sidebar

    func setSidebarFocusedItem(_ item: SidebarFocusedItem?) { sidebarFocusedItem = item }

    // MARK: - Workspace activation

    func setFlowPanelOpen(_ open: Bool) { flowPanelOpen = open }

    func setMasterWorkspaceActive(_ active: Bool) { masterWorkspaceActive = active }

    func setActiveProject(_ id: String?) {
        activeProjectId = id
        if id != nil { masterWorkspaceActive = false }
    }

    // MARK: - Width setters (all clamp to spec ranges)

    func setSidebarWidth(_ width: Double) {
        sidebarWidth = Self.clamp(width, Self.sidebarMin, Self.sidebarMax)
    }

    func setFileExplorerWidth(_ width: Double) {
        fileExplorerWidth = Self.clamp(width, Self.fileExplorerMin, Self.fileExplorerMax)
    }

    func setTaskInfoWidth(_ width: Double) {
        taskInfoWidth = Self.clamp(width, Self.taskInfoMin, Self.taskInfoMax)
    }

    func setFlowPanelWidth(_ width: Double) {
        flowPanelWidth = Self.clamp(width, Self.flowPanelMin, Self.flowPanelMax)
    }

    func setPanelGap(_ gap: Double) { panelGap = gap }

    // MARK: - Collapsed projects

    func setProjectCollapsed(_ projectId: String, _ collapsed: Bool) {
        collapsedProjectIds = Self.updateCollapsedProjectIds(
            collapsedProjectIds,
            projectId: projectId,
            collapsed: collapsed
        )
    }

    // MARK: - Layout hydration

    /// Writes persisted layout widths (clamped) and `collapsedProjectIds`.
    /// Mirrors `hydrateLayout` in `ui-store.ts`; accepts `PanelSettings` (generated type, Task 3).
    func hydrateLayout(_ panels: PanelSettings) {
        sidebarWidth      = Self.clamp(panels.sidebarWidth,      Self.sidebarMin,      Self.sidebarMax)
        fileExplorerWidth = Self.clamp(panels.fileExplorerWidth, Self.fileExplorerMin, Self.fileExplorerMax)
        taskInfoWidth     = Self.clamp(panels.taskInfoWidth,     Self.taskInfoMin,     Self.taskInfoMax)
        flowPanelWidth    = Self.clamp(panels.flowPanelWidth,    Self.flowPanelMin,    Self.flowPanelMax)
        collapsedProjectIds = panels.collapsedProjectIds
    }

    // MARK: - Split actions

    /// Toggles the split for `key`.
    /// - If no entry exists: creates `{open: true, ratio: 0.5, activePane: .left}`.
    /// - If an entry exists: toggles `open` in place (ratio/activePane are preserved).
    ///
    /// Note: Swift port retains the entry when closing (sets `open = false`) rather than
    /// removing the key as the TS store does, so that `getSplit` always returns the same
    /// optional-Bool that the tests assert.
    func toggleSplit(_ key: String) {
        if var existing = splitByWorkspace[key] {
            existing.open.toggle()
            splitByWorkspace[key] = existing
        } else {
            splitByWorkspace[key] = WorkspaceSplit(open: true, ratio: 0.5, activePane: .left)
        }
    }

    func setSplitRatio(_ key: String, _ ratio: Double) {
        guard var existing = splitByWorkspace[key] else { return }
        existing.ratio = Self.clamp(ratio, Self.splitRatioMin, Self.splitRatioMax)
        splitByWorkspace[key] = existing
    }

    func setActivePane(_ key: String, _ pane: PaneId) {
        guard var existing = splitByWorkspace[key] else { return }
        existing.activePane = pane
        splitByWorkspace[key] = existing
    }

    func getSplit(_ key: String) -> WorkspaceSplit? {
        splitByWorkspace[key]
    }

    // MARK: - Pure reducers (static, TDD-able without async plumbing)

    /// Returns the registered panels in display order.
    /// Mirrors `getOrderedPanels` exported from `ui-store.ts`.
    static func getOrderedPanels(_ registered: Set<PanelId>) -> [PanelId] {
        panelOrder.filter { registered.contains($0) }
    }

    /// Adds or removes `projectId` from the collapsed-project list.
    /// Mirrors `updateCollapsedProjectIds` exported from `ui-store.ts`.
    static func updateCollapsedProjectIds(
        _ current: [String],
        projectId: String,
        collapsed: Bool
    ) -> [String] {
        if collapsed {
            guard !current.contains(projectId) else { return current }
            return current + [projectId]
        }
        return current.filter { $0 != projectId }
    }
}

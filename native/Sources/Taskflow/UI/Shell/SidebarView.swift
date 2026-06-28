import SwiftUI

/// Sidebar — full composition: header toolbar, scrollable project list (driven by collapse state
/// + drag-reorder via `ProjectGroup`), footer. Port of the React `Sidebar` component.
///
/// Selection:
/// - Tapping a project sets `ui.activeProjectId`, clears `tasks.activeTaskId`, focuses workspace.
/// - Tapping a task sets both `tasks.activeTaskId` and `ui.activeProjectId` (its parent), focuses workspace.
///
/// Archive mode: when `env.tasks?.showArchive == true` the list renders `archivedTasks` grouped
/// by project with a "No archived tasks" empty state.
///
/// Subtask nesting (rendering `parentId != nil` children indented) — 5B follow-up seam.
struct SidebarView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            SidebarHeaderToolbar()
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    if env.tasks?.showArchive == true {
                        archiveList
                    } else {
                        projectList
                    }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
            }
            Divider()
            SidebarFooter()
        }
        .background(theme.color(.sidebarBackground))
        // Keyboard navigation: Cmd+Up/Down move through visible items via SidebarNavigation.next;
        // Cmd+Left collapses focused project (or focuses parent if on a task);
        // Cmd+Right expands focused project; Cmd+0 activates Master Workspace.
        // Requires the sidebar panel to have SwiftUI focus (.focusable) AND be the focused panel.
        // Known limitation: .onKeyPress fires only while this VStack holds SwiftUI focus; if the
        // Metal-rendered EditorPane or another NSView steals first-responder, events are not routed
        // here — a Phase-6 shell-wide key-routing audit is needed to address cross-view focus.
        // 5B seam: Cmd+digit (1–9) quick-select is documented in handleKeyPress but not wired;
        // see comment there for rationale.
        .focusable()
        .onKeyPress(phases: .down, action: handleKeyPress)
    }

    // MARK: - List sections

    @ViewBuilder private var projectList: some View {
        if visibleProjects.isEmpty {
            Text("No projects yet")
                .font(.system(size: 12))
                .foregroundStyle(theme.color(.mutedForeground))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else {
            ForEach(visibleProjects, id: \.id) { project in
                ProjectGroup(
                    project: project,
                    tasks: tasks(for: project.id),
                    isActive: env.ui.activeProjectId == project.id,
                    activeTaskId: env.tasks?.activeTaskId,
                    open: !(env.ui.collapsedProjectIds.contains(project.id)),
                    onOpenChange: { env.ui.setProjectCollapsed(project.id, !$0) },
                    onProjectClick: { selectProject(project.id) },
                    onTaskClick: { selectTask($0, in: project.id) }
                )
            }
        }
    }

    @ViewBuilder private var archiveList: some View {
        let archivedSource = env.tasks?.archivedTasks ?? []
        if archivedSource.isEmpty {
            Text("No archived tasks")
                .font(.system(size: 12))
                .foregroundStyle(theme.color(.mutedForeground))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else {
            ForEach(visibleProjects, id: \.id) { project in
                let projectArchived = archivedSource.filter {
                    $0.projectId == project.id && $0.parentId == nil
                }
                if !projectArchived.isEmpty {
                    ProjectGroup(
                        project: project,
                        tasks: projectArchived,
                        isActive: env.ui.activeProjectId == project.id,
                        activeTaskId: env.tasks?.activeTaskId,
                        open: !(env.ui.collapsedProjectIds.contains(project.id)),
                        onOpenChange: { env.ui.setProjectCollapsed(project.id, !$0) },
                        onProjectClick: { selectProject(project.id) },
                        onTaskClick: { selectTask($0, in: project.id) }
                    )
                }
            }
        }
    }

    // MARK: - Computed helpers

    private var allProjects: [Project] { env.projects?.projects ?? [] }
    private var visibleProjects: [Project] { allProjects.filter { $0.hidden != true } }

    private func tasks(for projectId: String) -> [TaskItem] {
        let all = env.tasks?.tasks ?? []
        return all.filter { $0.projectId == projectId && $0.parentId == nil }
    }

    /// Flattened ordered list of visible sidebar items used by keyboard navigation.
    /// Mirrors useSidebarNavigation.ts: each visible project followed by its top-level tasks;
    /// collapsed projects contribute only the project row (tasks hidden).
    private var flatVisibleItems: [SidebarFocusedItem] {
        var result: [SidebarFocusedItem] = []
        for project in visibleProjects {
            result.append(.init(type: .project, id: project.id))
            if !env.ui.collapsedProjectIds.contains(project.id) {
                for task in tasks(for: project.id) {
                    result.append(.init(type: .task, id: task.id))
                }
            }
        }
        return result
    }

    // MARK: - Navigation actions

    private func selectProject(_ id: String) {
        env.ui.setFocusedPanel(.workspace)
        env.ui.setMasterWorkspaceActive(false)
        env.ui.setActiveProject(id)
        env.tasks?.setActiveTask(nil)
    }

    private func selectTask(_ id: String, in projectId: String) {
        env.ui.setFocusedPanel(.workspace)
        env.ui.setMasterWorkspaceActive(false)
        env.ui.setActiveProject(projectId)
        env.tasks?.setActiveTask(id)
    }

    // MARK: - Keyboard navigation (Cmd+arrows / Cmd+0)

    /// Handle sidebar key events. Returns true if the event was consumed.
    /// Called from `.onKeyPress` when `focusedPanel == .sidebar`.
    @discardableResult
    private func handleKeyPress(_ press: KeyPress) -> KeyPress.Result {
        guard env.ui.focusedPanel == .sidebar,
              press.modifiers.contains(.command) else { return .ignored }

        switch press.key {
        case .upArrow:
            let next = SidebarNavigation.next(
                items: flatVisibleItems,
                current: env.ui.sidebarFocusedItem,
                direction: .up
            )
            env.ui.setSidebarFocusedItem(next)
            return .handled

        case .downArrow:
            let next = SidebarNavigation.next(
                items: flatVisibleItems,
                current: env.ui.sidebarFocusedItem,
                direction: .down
            )
            env.ui.setSidebarFocusedItem(next)
            return .handled

        case .leftArrow:
            guard let focused = env.ui.sidebarFocusedItem else { return .ignored }
            if focused.type == .task {
                // Move focus to the parent project
                let parentId = env.tasks?.tasks.first(where: { $0.id == focused.id })?.projectId
                if let parentId {
                    env.ui.setSidebarFocusedItem(.init(type: .project, id: parentId))
                    env.ui.setActiveProject(parentId)
                    env.tasks?.setActiveTask(nil)
                }
            } else {
                // Collapse focused project
                env.ui.setProjectCollapsed(focused.id, true)
            }
            return .handled

        case .rightArrow:
            guard let focused = env.ui.sidebarFocusedItem,
                  focused.type == .project else { return .ignored }
            env.ui.setProjectCollapsed(focused.id, false)
            return .handled

        default:
            // Cmd+0: master workspace
            if press.characters == "0" {
                env.ui.setMasterWorkspaceActive(true)
                env.ui.setSidebarFocusedItem(nil)
                return .handled
            }
            // 5B seam: Cmd+digit (1–9) quick-select — not wired; cross-panel digit routing
            // conflicts with other Cmd+digit bindings and needs a Phase-6 global key-routing audit.
            return .ignored
        }
    }
}

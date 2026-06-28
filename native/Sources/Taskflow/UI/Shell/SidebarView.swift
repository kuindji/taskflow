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
}

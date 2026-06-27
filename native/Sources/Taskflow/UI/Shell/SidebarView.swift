import SwiftUI

/// Sidebar — live list of projects with their nested tasks.
/// Reads from `ProjectViewModel` and `TaskViewModel` via `AppEnvironment`; SwiftUI's Observation
/// framework re-renders only when the read properties (`projects`, `tasks`, active IDs) change.
///
/// Selection:
/// - Tapping a project sets `ui.activeProjectId` and clears `tasks.activeTaskId`.
/// - Tapping a task sets both `tasks.activeTaskId` and `ui.activeProjectId` (its parent).
///
/// Drag-reorder of sidebar items is deferred to Phase 5 — the list is static order here.
struct SidebarView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        let projectList   = env.projects?.projects ?? []
        let taskList      = env.tasks?.tasks ?? []
        let activeProject = env.ui.activeProjectId
        let activeTask    = env.tasks?.activeTaskId

        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(projectList, id: \.id) { project in
                    let isActiveProject = activeProject == project.id
                    projectRow(project, isActive: isActiveProject)
                        .onTapGesture {
                            env.ui.setActiveProject(project.id)
                            env.tasks?.setActiveTask(nil)
                        }

                    let projectTasks = taskList.filter { $0.projectId == project.id }
                    if !projectTasks.isEmpty {
                        ForEach(projectTasks, id: \.id) { task in
                            let isActiveTask = activeTask == task.id
                            taskRow(task, isActive: isActiveTask)
                                .onTapGesture {
                                    env.ui.setActiveProject(task.projectId)
                                    env.tasks?.setActiveTask(task.id)
                                }
                        }
                    }
                }

                if projectList.isEmpty {
                    Text("No projects")
                        .font(.caption)
                        .foregroundStyle(theme.color(.sidebarForeground).opacity(0.4))
                        .padding(.horizontal, 12)
                        .padding(.top, 16)
                }
            }
            .padding(.vertical, 8)
        }
        .background(theme.color(.sidebarBackground))
    }

    // MARK: - Row views

    private func projectRow(_ project: Project, isActive: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "folder.fill")
                .font(.system(size: 11))
                .foregroundStyle(
                    isActive
                        ? theme.color(.sidebarPrimary)
                        : theme.color(.sidebarForeground).opacity(0.7)
                )
            Text(project.name)
                .font(.subheadline)
                .fontWeight(isActive ? .semibold : .regular)
                .foregroundStyle(
                    isActive
                        ? theme.color(.sidebarPrimary)
                        : theme.color(.sidebarForeground)
                )
                .lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(
            isActive
                ? theme.color(.sidebarAccent).opacity(0.25)
                : Color.clear
        )
        .contentShape(Rectangle())
    }

    private func taskRow(_ task: TaskItem, isActive: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "circle.fill")
                .font(.system(size: 5))
                .foregroundStyle(
                    isActive
                        ? theme.color(.sidebarPrimary)
                        : theme.color(.sidebarForeground).opacity(0.45)
                )
            Text(task.title.isEmpty ? task.description : task.title)
                .font(.caption)
                .foregroundStyle(
                    isActive
                        ? theme.color(.sidebarPrimary)
                        : theme.color(.sidebarForeground).opacity(0.65)
                )
                .lineLimit(1)
            Spacer()
        }
        .padding(.leading, 24)
        .padding(.trailing, 8)
        .padding(.vertical, 3)
        .background(
            isActive
                ? theme.color(.sidebarAccent).opacity(0.15)
                : Color.clear
        )
        .contentShape(Rectangle())
    }
}

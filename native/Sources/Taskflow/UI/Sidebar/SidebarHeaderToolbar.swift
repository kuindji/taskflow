import SwiftUI

/// Top sidebar toolbar: New Task + New Project. Port of TaskSidebar.tsx header.
struct SidebarHeaderToolbar: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        HStack(spacing: 6) {
            Button {
                env.taskCreation.requestNewTask(projectId: env.ui.activeProjectId)
            } label: {
                Label("Task", systemImage: "plus")
            }
            .buttonStyle(.plain)
            .font(.system(size: 12))
            .help("New task (Cmd+N)")

            Spacer()

            Button {
                env.taskCreation.requestNewProject()
            } label: {
                AppIcon("FolderPlus")
            }
            .buttonStyle(.plain)
            .help("New project")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .foregroundStyle(theme.color(.sidebarForeground))
    }
}

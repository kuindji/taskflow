import SwiftUI

/// Workspace placeholder — displays the active workspace key.
/// Real split/tab content (SplitContainer, TabBar) is implemented in Tasks 10–11.
///
/// Workspace key resolution (mirrors `useActiveWorkspace.ts`):
///   task active → `task:<id>`
///   project active → `project:<id>`
///   master active → `master`
///   otherwise → `workspace` (no selection)
struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(theme.color(.card))
            VStack(spacing: 6) {
                Text(activeWorkspaceKey)
                    .font(.title2)
                    .fontWeight(.light)
                    .foregroundStyle(theme.foreground.opacity(0.35))
                Text("Tasks 10–11 placeholder")
                    .font(.caption2)
                    .foregroundStyle(theme.foreground.opacity(0.2))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var activeWorkspaceKey: String {
        if let taskId = env.tasks?.activeTaskId {
            return WorkspaceKey.task(taskId)
        }
        if let projectId = env.ui.activeProjectId {
            return WorkspaceKey.project(projectId)
        }
        if env.ui.masterWorkspaceActive {
            return WorkspaceKey.master
        }
        return "workspace"
    }
}

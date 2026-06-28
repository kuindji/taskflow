import SwiftUI

/// Bottom sidebar bar: Master Workspace, Notifications, OfflineIndicator, nav toolbar.
/// Port of TaskSidebar.tsx bottom row.
struct SidebarFooter: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    @State private var notificationsOpen = false

    var body: some View {
        HStack(spacing: 8) {
            Button {
                env.ui.setActiveProject(nil)
                env.tasks?.setActiveTask(nil)
                env.ui.setMasterWorkspaceActive(true)
            } label: {
                AppIcon("Monitor")
            }
            .buttonStyle(.plain)
            .help("Master Workspace")

            Button { notificationsOpen.toggle() } label: {
                AppIcon("Bell")
                    .overlay(alignment: .topTrailing) {
                        if unreadCount > 0 {
                            Circle()
                                .fill(theme.color(.info))
                                .frame(width: 6, height: 6)
                        }
                    }
            }
            .buttonStyle(.plain)
            .help("Notifications")
            .popover(isPresented: $notificationsOpen, arrowEdge: .top) {
                NotificationPopover { note in
                    notificationsOpen = false
                    navigate(to: note)
                }
            }

            OfflineIndicator()
            Spacer()
            SidebarToolbar()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .foregroundStyle(theme.color(.sidebarForeground))
    }

    private var unreadCount: Int {
        (env.notifications?.notifications ?? []).filter { !$0.read }.count
    }

    private func navigate(to note: Notification) {
        env.ui.setActiveProject(note.projectId)
        if let taskId = note.taskId { env.tasks?.setActiveTask(taskId) }
        env.ui.setFocusedPanel(.workspace)
        // Session-tab focus (note.sessionId) is a seam: requires session-tab activation wiring.
    }
}

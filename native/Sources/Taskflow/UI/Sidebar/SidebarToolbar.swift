import SwiftUI

/// Bottom sidebar nav. Port of components/sidebar/SidebarToolbar.tsx.
struct SidebarToolbar: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        HStack(spacing: 4) {
            iconButton("Workflow", help: "Flows") { env.ui.toggleFlowManagement() }
            iconButton("CalendarClock", help: "Schedules") { env.ui.toggleScheduleManagement() }
            iconButton("Palette", help: "Appearance") { env.ui.toggleAppearance() }
            iconButton("Settings2", help: "Settings") { env.ui.openSettings() }
        }
    }

    @ViewBuilder private func iconButton(_ icon: String, help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { AppIcon(icon).font(.system(size: 13)) }
            .buttonStyle(.plain)
            .foregroundStyle(theme.color(.sidebarForeground))
            .help(help)
    }
}

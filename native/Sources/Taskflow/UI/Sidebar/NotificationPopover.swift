import SwiftUI

/// Notifications popover content. Port of components/sidebar/NotificationPopover.tsx.
struct NotificationPopover: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    let onNavigate: (Notification) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(.system(size: 13, weight: .semibold))
                Spacer()
                if !items.isEmpty {
                    Button("Dismiss all") { Task { await env.notifications?.deleteAll() } }
                        .buttonStyle(.plain)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.color(.mutedForeground))
                }
            }
            .padding(10)
            Divider()
            if items.isEmpty {
                Text("No notifications")
                    .font(.system(size: 12)).foregroundStyle(theme.color(.mutedForeground))
                    .frame(maxWidth: .infinity).padding(24)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(items, id: \.id) { n in row(n) }
                    }
                }
                .frame(maxHeight: 360)
            }
        }
        .frame(width: 320)
        .background(theme.color(.background))
    }

    private var items: [Notification] {
        NotificationViewModel.sorted(env.notifications?.notifications ?? [])
    }

    private func projectName(_ id: String) -> String {
        env.projects?.projects.first { $0.id == id }?.name ?? "Unknown"
    }

    @ViewBuilder private func row(_ n: Notification) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(n.read ? Color.clear : theme.color(.info))
                .frame(width: 6, height: 6).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(n.message).font(.system(size: 12)).foregroundStyle(theme.color(.foreground))
                    .lineLimit(2)
                Text("\(projectName(n.projectId)) · \(Self.relativeTime(n.createdAt, now: Date()))")
                    .font(.system(size: 10)).foregroundStyle(theme.color(.mutedForeground))
            }
            Spacer(minLength: 4)
            Button { Task { await env.notifications?.markAsRead(id: n.id) }; onNavigate(n) } label: {
                AppIcon("ChevronRight").font(.system(size: 10))
            }.buttonStyle(.plain)
            Button { Task { await env.notifications?.deleteNotification(id: n.id) } } label: {
                AppIcon("X").font(.system(size: 10)).foregroundStyle(theme.color(.mutedForeground))
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .contentShape(Rectangle())
        .background(n.read ? Color.clear : theme.color(.muted).opacity(0.4))
    }

    nonisolated static func relativeTime(_ iso: String, now: Date) -> String {
        guard let then = ISO8601DateFormatter().date(from: iso) else { return "" }
        let secs = Int(now.timeIntervalSince(then))
        if secs < 60 { return "just now" }
        let mins = secs / 60
        if mins < 60 { return "\(mins)m ago" }
        let hrs = mins / 60
        if hrs < 24 { return "\(hrs)h ago" }
        return "\(hrs / 24)d ago"
    }
}

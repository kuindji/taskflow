import SwiftUI

/// One task row in the sidebar. Port of components/sidebar/TaskCard.tsx (view parts;
/// context menu added in Task 9). Worktree diff/behind counts deferred (5C diff-store seam).
struct TaskCard: View {
    @Environment(\.appTheme) private var theme
    let task: TaskItem
    let projectPath: String
    let isActive: Bool
    var isSubtask: Bool = false
    var keyBadgeNumber: Int? = nil
    let onClick: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if task.pinned {
                        AppIcon("Pin")
                            .font(.system(size: 9))
                            .foregroundStyle(theme.color(.mutedForeground))
                    }
                    Text(Self.displayTitle(task))
                        .font(.system(size: isSubtask ? 11 : 12))
                        .foregroundStyle(theme.color(isActive ? .sidebarPrimary : .sidebarForeground))
                        .lineLimit(1)
                }
                if task.worktree.enabled, let branch = task.worktree.branch {
                    worktreeBadge(branch: branch, pr: task.worktree.pr)
                }
                if !task.sessions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(task.sessions, id: \.id) { SessionBadge($0) }
                    }
                }
            }
            Spacer(minLength: 4)
            if let k = keyBadgeNumber {
                Text("\(k)")
                    .font(.system(size: 9, weight: .semibold))
                    .padding(.horizontal, 4)
                    .background(theme.color(.muted))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .padding(.leading, isSubtask ? 16 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isActive ? theme.color(.sidebarAccent).opacity(0.15) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture(perform: onClick)
    }

    @ViewBuilder private func worktreeBadge(branch: String, pr: TaskWorktreePr?) -> some View {
        HStack(spacing: 3) {
            AppIcon("GitBranch").font(.system(size: 9))
            Text(branch).font(.system(size: 10)).lineLimit(1)
            if let pr {
                // TS renders `#{pr.number}` (accent-coloured); mirror that label.
                Text("#\(Int(pr.number))").font(.system(size: 10))
            }
            // Phase 5C/diff-store seam: live +adds/-dels and `behind` counts go here.
        }
        .foregroundStyle(theme.color(.mutedForeground))
    }

    /// Title or, when empty, a ≤50-char truncation of the description (+ ellipsis if cut).
    nonisolated static func displayTitle(_ task: TaskItem) -> String {
        if !task.title.isEmpty { return task.title }
        let d = task.description
        return d.count > 50 ? String(d.prefix(50)) + "…" : d
    }
}

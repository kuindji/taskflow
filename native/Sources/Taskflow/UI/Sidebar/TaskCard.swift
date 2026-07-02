import SwiftUI

/// One task row in the sidebar. Port of components/sidebar/TaskCard.tsx (view parts;
/// context menu added in Task 9). Worktree diff/behind counts deferred (5C diff-store seam).
struct TaskCard: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    let task: TaskItem
    let projectPath: String
    let isActive: Bool
    var isSubtask: Bool = false
    var keyBadgeNumber: Int? = nil
    let onClick: () -> Void

    private var isArchived: Bool { task.archivedAt != nil }
    private var online: Bool { if case .connected = env.status { return true } else { return false } }
    private var defaultRuntime: String { env.settings?.settings?.general.defaultRuntime ?? "bun" }
    private var configuredShell: String { env.settings?.settings?.terminal.defaultShell ?? "system" }

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
        .contextMenu { taskMenu }
    }

    @ViewBuilder private var taskMenu: some View {
        Button("Add subtask") {
            env.taskCreation.requestNewSubtask(parentId: task.id, projectId: task.projectId)
        }
        Button(task.pinned ? "Unpin" : "Pin") {
            Task { try? await env.tasks?.updateTask(
                id: task.id, title: nil, description: nil,
                notes: nil, worktree: nil, pinned: !task.pinned
            ) }
        }
        if let run = env.runMenu {
            let d = run.data(
                projectId: task.projectId,
                flows: env.flows?.flows ?? [],
                standaloneActions: env.flows?.actions ?? [],
                hasActiveFlowRun: false,
                defaultRuntime: defaultRuntime,
                online: online,
                showAgentOptions: !isArchived
            )
            if RunMenuViewModel.hasRunMenuItems(d) {
                Menu("Run") {
                    RunMenuItems(
                        data: d,
                        callbacks: run.callbacks(
                            projectId: task.projectId,
                            taskId: task.id,
                            session: env.session,
                            flows: env.flows,
                            tasks: env.tasks,
                            ui: env.ui,
                            defaultRuntime: defaultRuntime,
                            configuredShell: configuredShell
                        )
                    )
                }
            }
        }
        Divider()
        if isArchived {
            Button("Unarchive") { Task { try? await env.tasks?.unarchiveTask(id: task.id) } }
        } else {
            Button("Archive") { Task { try? await env.tasks?.archiveTask(id: task.id) } }
        }
        // Delete-with-worktree confirmation dialog is 5F; 5B does a direct delete (no worktree removal).
        Button("Delete", role: .destructive) {
            Task { try? await env.tasks?.deleteTask(id: task.id, deleteWorktree: nil) }
        }
    }

    @ViewBuilder private func worktreeBadge(branch: String, pr: TaskWorktreePr?) -> some View {
        let behind = env.diff?.state.behindByProject[task.id] ?? 0
        let stats = env.diff?.state.statsByProject[task.id]
        HStack(spacing: 3) {
            AppIcon("GitBranch").font(.system(size: 9))
            Text(branch).font(.system(size: 10)).lineLimit(1)
            if let pr {
                Text("#\(Int(pr.number))").font(.system(size: 10))
            }
            if behind > 0 {
                Text("↓\(behind)").font(.system(size: 10)).foregroundStyle(theme.color(.info))
            }
            if let stats {
                Text("+\(stats.additions)").font(.system(size: 10)).foregroundStyle(theme.color(.success))
                Text("-\(stats.deletions)").font(.system(size: 10)).foregroundStyle(theme.color(.destructive))
            }
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

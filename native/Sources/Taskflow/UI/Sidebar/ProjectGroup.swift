import SwiftUI
import UniformTypeIdentifiers

// MARK: - Drag payload

extension UTType {
    static let taskflowProject = UTType(exportedAs: "com.taskflow.project")
}

struct ProjectDragItem: Codable, Transferable, Sendable {
    let projectId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .taskflowProject)
    }
}

// MARK: - ProjectGroup

/// Collapsible project group in the sidebar. Port of components/sidebar/ProjectGroup.tsx.
///
/// Header shows chevron + optional rolled-up status dot (when collapsed) + project name.
/// When open: session badges + task list (pinned first, divider, then unpinned).
/// Drag-to-reorder mirrors the `TabItem`/`TabDragItem` pattern from `Workspace/TabItem.swift`:
/// each header is draggable (`ProjectDragItem`) and is also a drop target that calls
/// `SidebarReorder.buildReorderedProjectIds` + `env.projects?.reorderProjects(orderedIds:)`.
struct ProjectGroup: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    let project: Project
    let tasks: [TaskItem]
    let isActive: Bool
    let activeTaskId: String?
    let open: Bool
    let onOpenChange: (Bool) -> Void
    let onProjectClick: () -> Void
    let onTaskClick: (String) -> Void

    // MARK: - Computed helpers

    private var pinned: [TaskItem] { tasks.filter { $0.pinned } }
    private var unpinned: [TaskItem] { tasks.filter { !$0.pinned } }
    private var online: Bool { if case .connected = env.status { return true } else { return false } }
    private var defaultRuntime: String { env.settings?.settings?.general.defaultRuntime ?? "bun" }

    private var rolledUpStatus: SessionStatus? {
        let statusFn: (String) -> SessionStatus? = { [env] id in env.session?.sessionStatus[id] }
        let projStatus = SidebarStatus.project(sessionIds: project.sessions.map(\.id), status: statusFn)
        let taskStatuses = tasks.map { t in
            SidebarStatus.project(sessionIds: t.sessions.map(\.id), status: statusFn)
        }
        return SidebarStatus.rollup(projectStatus: projStatus, taskStatuses: taskStatuses)
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            header
            if open {
                if !project.sessions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(project.sessions, id: \.id) { SessionBadge($0) }
                    }
                    .padding(.leading, 18)
                }
                ForEach(pinned, id: \.id) { taskRow($0) }
                if !pinned.isEmpty && !unpinned.isEmpty {
                    Divider().padding(.leading, 18).padding(.vertical, 2)
                }
                ForEach(unpinned, id: \.id) { taskRow($0) }
            }
        }
        .task { await env.runMenu?.ensureLoaded(projectId: project.id, projectPath: project.path) }
    }

    // MARK: - Sub-views

    @ViewBuilder private func taskRow(_ t: TaskItem) -> some View {
        TaskCard(
            task: t,
            projectPath: project.path,
            isActive: t.id == activeTaskId,
            onClick: { onTaskClick(t.id) }
        )
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button { onOpenChange(!open) } label: {
                AppIcon(open ? "ChevronDown" : "ChevronRight")
                    .font(.system(size: 9))
            }
            .buttonStyle(.plain)

            if !open, let token = SessionBadge.dotToken(for: rolledUpStatus) {
                Circle()
                    .fill(theme.color(token))
                    .frame(width: 6, height: 6)
            }

            Text(project.name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.color(isActive ? .sidebarPrimary : .sidebarForeground))
                .lineLimit(1)

            if let branch = env.diff?.state.branchByProject[project.id] {
                Text("(\(branch))")
                    .font(.system(size: 10))
                    .foregroundStyle(theme.color(.mutedForeground))
                    .lineLimit(1)
            }

            Spacer(minLength: 4)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(isActive ? theme.color(.sidebarAccent).opacity(0.25) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture(perform: onProjectClick)
        .draggable(ProjectDragItem(projectId: project.id))
        .dropDestination(for: ProjectDragItem.self) { items, _ in
            guard let dropped = items.first, dropped.projectId != project.id else { return false }
            reorder(movingId: dropped.projectId, overId: project.id)
            return true
        }
        .contextMenu { projectMenu }
    }

    @ViewBuilder private var projectMenu: some View {
        Button("Create task") { env.taskCreation.requestNewTask(projectId: project.id) }
        Button("Fork project") { /* 5F: fork dialog seam */ }
        if let run = env.runMenu {
            let d = run.data(
                projectId: project.id,
                flows: env.flows?.flows ?? [],
                standaloneActions: env.flows?.actions ?? [],
                hasActiveFlowRun: false,
                defaultRuntime: defaultRuntime,
                online: online,
                showAgentOptions: false
            )
            if RunMenuViewModel.hasRunMenuItems(d) {
                Menu("Run") {
                    RunMenuItems(
                        data: d,
                        callbacks: run.callbacks(
                            projectId: project.id,
                            taskId: nil,
                            session: env.session,
                            flows: env.flows,
                            tasks: env.tasks,
                            ui: env.ui,
                            defaultRuntime: defaultRuntime
                        )
                    )
                }
            }
        }
        Divider()
        // Remove confirmation dialog is 5F; 5B calls hideProject (reversible) as the safe default.
        Button("Delete project", role: .destructive) {
            Task { try? await env.projects?.hideProject(id: project.id) }
        }
    }

    // MARK: - Drag-reorder

    private func reorder(movingId: String, overId: String) {
        guard let projects = env.projects?.projects else { return }
        let visible = projects.filter { $0.hidden != true }.map(\.id)
        guard let from = visible.firstIndex(of: movingId),
              let to = visible.firstIndex(of: overId) else { return }
        var reordered = visible
        let moved = reordered.remove(at: from)
        reordered.insert(moved, at: to)
        let full = SidebarReorder.buildReorderedProjectIds(
            fullIds: projects.map(\.id),
            visibleIdsInNewOrder: reordered
        )
        Task { try? await env.projects?.reorderProjects(orderedIds: full) }
    }
}

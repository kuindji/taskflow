import SwiftUI

/// Master/detail modal for managing flows and actions: Actions/Flows tab switch, project filter,
/// a scrollable item list, and a `FlowEditor`/`ActionEditor` detail pane.
/// Port of `packages/ui/src/components/flows/FlowManagementDialog.tsx`.
struct FlowManagementDialog: View {

    // MARK: - Tab

    private enum ManagementTab: Int {
        case actions = 0
        case flows   = 1
    }

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    /// 0 = actions, 1 = flows — drives AppSegmentedTabs.
    @State private var tabIndex: Int = ManagementTab.actions.rawValue
    @State private var selectedId: String?
    @State private var creating: Bool = false
    /// Explicit override; nil means "use activeProjectId ?? all" (lazy init pattern).
    @State private var projectFilterOverride: String?

    // MARK: - Derived

    private var tab: ManagementTab { ManagementTab(rawValue: tabIndex) ?? .actions }

    /// Effective project filter — mirrors TS `useState(activeProjectId ?? "all")`.
    private var projectFilter: String { projectFilterOverride ?? env.ui.activeProjectId ?? "all" }

    private var projectFilterBinding: Binding<String> {
        Binding(
            get: { projectFilter },
            set: { v in
                projectFilterOverride = v
                selectedId = nil
                creating = false
            }
        )
    }

    private var projects: [Project] { env.projects?.projects ?? [] }

    private var filteredFlows: [FlowDefinition] {
        filterByProject(items: env.flows?.flows ?? [], projectFilter: projectFilter)
    }

    private var filteredActions: [ActionDefinition] {
        filterByProject(items: env.flows?.actions ?? [], projectFilter: projectFilter)
    }

    /// `projectFilter` value when it is a real project id (not "all"/"global").
    private var defaultProjectId: String? {
        projectFilter != "all" && projectFilter != "global" ? projectFilter : nil
    }

    private var selectedFlow: FlowDefinition? {
        guard tab == .flows else { return nil }
        return filteredFlows.first { $0.id == selectedId }
    }

    private var selectedAction: ActionDefinition? {
        guard tab == .actions else { return nil }
        return filteredActions.first { $0.id == selectedId }
    }

    /// Maps each action ID to the flows that reference it (via `.reference` entries).
    /// Used to compute `deleteDisabled` / `deleteDisabledReason` for `ActionEditor`.
    /// Only performs the (expensive) decode work when ActionEditor is actually shown.
    private var referencingFlowsByActionId: [String: [FlowDefinition]] {
        guard tab == .actions && (creating || selectedAction != nil) else { return [:] }
        let allFlows   = env.flows?.flows ?? []
        let allActions = env.flows?.actions ?? []
        var map: [String: [FlowDefinition]] = [:]
        for action in allActions {
            map[action.id] = allFlows.filter { flow in
                FlowActionEntryCodec.decode(flow.actions).contains { entry in
                    if case .reference(let r) = entry { return r.actionId == action.id }
                    return false
                }
            }
        }
        return map
    }

    private var projectFilterOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [
            (value: "all",    label: "All"),
            (value: "global", label: "Global"),
        ]
        opts += projects.map { (value: $0.id, label: $0.name) }
        return opts
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            HStack(spacing: 0) {
                leftPanel
                Divider()
                rightPanel
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: 740, height: 520)
        .background(theme.background)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .task {
            try? await env.flows?.fetchFlows()
            try? await env.flows?.fetchActions()
        }
        .onChange(of: tabIndex) { _, _ in
            selectedId = nil
            creating = false
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Flows & Actions")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                env.ui.toggleFlowManagement()
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Left panel

    private var leftPanel: some View {
        VStack(spacing: 0) {
            AppSegmentedTabs(selection: $tabIndex, titles: ["Actions", "Flows"])
                .padding(12)

            AppSelect(projectFilterBinding, options: projectFilterOptions)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)

            ScrollView {
                VStack(spacing: 2) {
                    if tab == .flows {
                        flowRows
                    } else {
                        actionRows
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(maxHeight: .infinity)

            HStack {
                Spacer()
                Button {
                    creating = true
                    selectedId = nil
                } label: {
                    AppIcon("Plus").font(.system(size: 14))
                        .foregroundStyle(theme.foreground)
                }
                .buttonStyle(.plain)
                .help(tab == .flows ? "New flow" : "New action")
                .padding(8)
            }
        }
        .frame(width: 220)
    }

    // MARK: - Flow list rows

    @ViewBuilder
    private var flowRows: some View {
        if filteredFlows.isEmpty {
            Text("No flows yet")
                .font(.system(size: 12))
                .foregroundStyle(theme.foreground.opacity(0.4))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else {
            ForEach(filteredFlows, id: \.id) { flow in
                listRow(
                    id: flow.id,
                    title: flow.name,
                    subtitle: "\(flow.actions.count) action\(flow.actions.count != 1 ? "s" : "")"
                )
            }
        }
    }

    // MARK: - Action list rows

    @ViewBuilder
    private var actionRows: some View {
        if filteredActions.isEmpty {
            Text("No actions yet")
                .font(.system(size: 12))
                .foregroundStyle(theme.foreground.opacity(0.4))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else {
            ForEach(filteredActions, id: \.id) { action in
                listRow(
                    id: action.id,
                    title: action.name,
                    subtitle: action.sessionType.rawValue
                )
            }
        }
    }

    private func listRow(id: String, title: String, subtitle: String) -> some View {
        Button {
            selectedId = id
            creating = false
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: selectedId == id ? .semibold : .regular))
                    .foregroundStyle(theme.foreground)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.foreground.opacity(0.5))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(selectedId == id ? theme.muted.opacity(0.5) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Right panel

    @ViewBuilder
    private var rightPanel: some View {
        if tab == .flows && (creating || selectedFlow != nil) {
            FlowEditor(
                flow: creating ? nil : selectedFlow,
                globalActions: env.flows?.actions ?? [],
                defaultProjectId: defaultProjectId,
                onSave: { flow in
                    Task {
                        try? await env.flows?.saveFlow(flow)
                        selectedId = flow.id
                        creating = false
                    }
                },
                onCancel: {
                    creating = false
                    selectedId = nil
                },
                onDelete: selectedFlow.map { f in
                    {
                        Task {
                            try? await env.flows?.deleteFlow(id: f.id)
                            selectedId = nil
                            creating = false
                        }
                    }
                }
            )
            .id(creating ? "new-flow-\(defaultProjectId ?? "global")" : (selectedFlow?.id ?? ""))
        } else if tab == .actions && (creating || selectedAction != nil) {
            let refCount = selectedAction.map { referencingFlowsByActionId[$0.id]?.count ?? 0 } ?? 0
            ActionEditor(
                action: creating ? nil : selectedAction,
                defaultProjectId: defaultProjectId,
                onSave: { action in
                    Task {
                        try? await env.flows?.saveAction(action)
                        selectedId = action.id
                        creating = false
                    }
                },
                onCancel: {
                    creating = false
                    selectedId = nil
                },
                onDelete: selectedAction.map { a in
                    {
                        Task {
                            try? await env.flows?.deleteAction(id: a.id)
                            selectedId = nil
                            creating = false
                        }
                    }
                },
                deleteDisabled: refCount > 0,
                deleteDisabledReason: refCount > 0
                    ? "Used by \(refCount) flow\(refCount != 1 ? "s" : "")"
                    : nil
            )
            .id(creating ? "new-action-\(defaultProjectId ?? "global")" : (selectedAction?.id ?? ""))
        } else {
            Text("Select an item or click + to create")
                .font(.system(size: 13))
                .foregroundStyle(theme.foreground.opacity(0.4))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Helpers

    /// Filters a collection by `projectFilter`: "all" returns all; "global" returns nil-projectId
    /// items; otherwise matches `projectId == projectFilter`.
    private func filterByProject<T: HasProjectId>(items: [T], projectFilter: String) -> [T] {
        switch projectFilter {
        case "all":    return items
        case "global": return items.filter { $0.projectId == nil }
        default:       return items.filter { $0.projectId == projectFilter }
        }
    }
}

// MARK: - HasProjectId

/// Lightweight protocol so `filterByProject` works for both `FlowDefinition` and `ActionDefinition`
/// without duplicating the switch block.
private protocol HasProjectId {
    var projectId: String? { get }
}

extension FlowDefinition: HasProjectId {}
extension ActionDefinition: HasProjectId {}

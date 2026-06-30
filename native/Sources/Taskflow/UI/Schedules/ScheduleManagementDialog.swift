import SwiftUI

/// Master/detail modal for managing schedules: a scrollable list with status dot, enable toggle,
/// run-now and delete actions, plus a `ScheduleForm` detail pane.
/// Port of `packages/ui/src/components/schedules/ScheduleManagementDialog.tsx`.
/// Mounted as a `.sheet` in `AppShell` driven by `UIViewModel.scheduleManagementOpen`.
struct ScheduleManagementDialog: View {

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var selectedId: String?
    @State private var creating: Bool = false
    /// Explicit override; nil means "use activeProjectId ?? 'all'" (lazy init pattern).
    @State private var projectFilterOverride: String?
    @State private var pendingDeleteId: String?

    // MARK: - Derived

    /// Effective project filter — mirrors TS `useState(activeProjectId ?? "all")`.
    private var projectFilter: String {
        projectFilterOverride ?? env.ui.activeProjectId ?? "all"
    }

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

    private var projectMap: [String: String] {
        Dictionary(
            uniqueKeysWithValues: (env.projects?.projects ?? []).map { ($0.id, $0.name) }
        )
    }

    private var actionMap: [String: ActionDefinition] {
        Dictionary(
            uniqueKeysWithValues: (env.flows?.actions ?? []).map { ($0.id, $0) }
        )
    }

    private var filteredSchedules: [Schedule] {
        let all = env.schedules?.schedules ?? []
        guard projectFilter != "all" else { return all }
        return all.filter { $0.projectId == projectFilter }
    }

    /// `projectFilter` value when it is a real project id (not "all").
    private var defaultProjectId: String? {
        projectFilter != "all" ? projectFilter : nil
    }

    private var selectedSchedule: Schedule? {
        filteredSchedules.first { $0.id == selectedId }
    }

    private var projectFilterOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "all", label: "All Projects")]
        opts += (env.projects?.projects ?? []).map { (value: $0.id, label: $0.name) }
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
            await env.schedules?.load(projectId: nil)
            try? await env.flows?.fetchActions()
        }
        .alert("Delete this schedule?", isPresented: Binding(
            get: { pendingDeleteId != nil },
            set: { if !$0 { pendingDeleteId = nil } }
        )) {
            Button("Delete", role: .destructive) {
                if let id = pendingDeleteId {
                    Task {
                        try? await env.schedules?.delete(id: id)
                        selectedId = nil
                        creating = false
                        pendingDeleteId = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                pendingDeleteId = nil
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Schedules")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                env.ui.toggleScheduleManagement()
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
            AppSelect(projectFilterBinding, options: projectFilterOptions)
                .padding(12)

            ScrollView {
                VStack(spacing: 2) {
                    scheduleRows
                }
                .padding(.horizontal, 8)
            }
            .frame(maxHeight: .infinity)

            HStack {
                Spacer()
                Button {
                    selectedId = nil
                    creating = true
                } label: {
                    AppIcon("Plus").font(.system(size: 14))
                        .foregroundStyle(theme.foreground)
                }
                .buttonStyle(.plain)
                .help("New schedule")
                .padding(8)
            }
        }
        .frame(width: 260)
    }

    // MARK: - Schedule list rows

    @ViewBuilder
    private var scheduleRows: some View {
        if filteredSchedules.isEmpty {
            Text("No schedules yet")
                .font(.system(size: 12))
                .foregroundStyle(theme.foreground.opacity(0.4))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else {
            ForEach(filteredSchedules, id: \.id) { s in
                scheduleRow(s)
            }
        }
    }

    private func statusColor(for s: Schedule) -> Color {
        switch ScheduleHelpers.scheduleStatus(runningSessionId: s.runningSessionId, lastError: s.lastError) {
        case .running: return .blue
        case .error:   return .red
        case .idle:    return .green
        }
    }

    private func scheduleRow(_ s: Schedule) -> some View {
        let title = s.name.isEmpty ? String(s.prompt.prefix(40)) : s.name
        let subtitle = "\(s.expression) · \(ScheduleHelpers.formatRelativeTime(s.lastRunAt, now: Date()))"
        let isSelected = selectedId == s.id

        return VStack(alignment: .leading, spacing: 0) {
            // Tappable area: selects the schedule
            Button {
                selectedId = s.id
                creating = false
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(statusColor(for: s))
                            .frame(width: 8, height: 8)
                        Text(title)
                            .font(.system(size: 13, weight: isSelected ? .semibold : .medium))
                            .foregroundStyle(theme.foreground)
                            .lineLimit(1)
                    }

                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.foreground.opacity(0.5))
                        .lineLimit(1)

                    if let actionId = s.actionId, let action = actionMap[actionId] {
                        Text(action.name)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.foreground.opacity(0.6))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(theme.muted.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                            .lineLimit(1)
                    }

                    if projectFilter == "all" {
                        Text(projectMap[s.projectId] ?? "Unknown")
                            .font(.system(size: 11))
                            .foregroundStyle(theme.foreground.opacity(0.6))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(theme.muted.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            // Controls row: enable toggle + actions menu (not part of the selectable button)
            HStack(spacing: 6) {
                Toggle(isOn: Binding(
                    get: { s.enabled },
                    set: { _ in handleToggleEnabled(s) }
                )) {
                    EmptyView()
                }
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(theme.accent)
                .controlSize(.mini)

                Menu {
                    Button("Run now") {
                        Task { try? await env.schedules?.trigger(id: s.id) }
                    }
                    Button("Delete", role: .destructive) {
                        pendingDeleteId = s.id
                    }
                } label: {
                    AppIcon("MoreHorizontal")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.foreground.opacity(0.5))
                        .padding(4)
                }
                .menuStyle(.automatic)
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(isSelected ? theme.muted.opacity(0.5) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Right panel

    @ViewBuilder
    private var rightPanel: some View {
        if creating || selectedSchedule != nil {
            ScheduleForm(
                schedule: creating ? nil : selectedSchedule,
                projects: env.projects?.projects ?? [],
                actions: env.flows?.actions ?? [],
                defaultProjectId: defaultProjectId,
                onSave: { payload in
                    Task {
                        switch payload {
                        case .create(let c):
                            if let s = try? await env.schedules?.create(c) {
                                selectedId = s.id
                            }
                        case .update(let u):
                            // Form-driven update: routes through update(formPayload:) which
                            // forces actionId/agentType/agentOptions to explicit JSON null so
                            // the backend CLEARS those fields rather than leaving them unchanged.
                            if let s = try? await env.schedules?.update(formPayload: u) {
                                selectedId = s.id
                            }
                        }
                        creating = false
                    }
                },
                onCancel: {
                    creating = false
                    selectedId = nil
                },
                onDelete: selectedSchedule.map { s in
                    { pendingDeleteId = s.id }
                }
            )
            .id(creating ? "new-schedule-\(defaultProjectId ?? "none")" : (selectedSchedule?.id ?? ""))
        } else {
            VStack(spacing: 8) {
                AppIcon("CalendarClock")
                    .font(.system(size: 28))
                    .foregroundStyle(theme.foreground.opacity(0.3))
                Text("Select a schedule or click + to create")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.foreground.opacity(0.4))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Actions

    /// Enable/disable toggle — uses plain `update(_:)` (NOT `update(formPayload:)`) so that
    /// only the `enabled` flag is sent; all other fields are absent (nil → omitted from JSON)
    /// and the backend leaves them unchanged. Routing through `update(formPayload:)` would
    /// force actionId/agentType/agentOptions to explicit null and CLEAR them — data loss.
    private func handleToggleEnabled(_ s: Schedule) {
        let payload = ScheduleUpdatePayload(
            id: s.id,
            name: nil,
            prompt: nil,
            actionId: nil,
            agentType: nil,
            agentOptions: nil,
            expression: nil,
            expressionType: nil,
            timeout: nil,
            enabled: !s.enabled
        )
        Task { try? await env.schedules?.update(payload) }
    }
}

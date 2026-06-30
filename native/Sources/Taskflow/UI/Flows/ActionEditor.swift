import SwiftUI

/// Create/edit form for a reusable `ActionDefinition`.
/// Port of `packages/ui/src/components/flows/ActionEditor.tsx`.
struct ActionEditor: View {

    // MARK: - Props

    let action: ActionDefinition?
    var defaultProjectId: String?
    let onSave: (ActionDefinition) -> Void
    let onCancel: () -> Void
    var onDelete: (() -> Void)?
    var deleteDisabled: Bool = false
    var deleteDisabledReason: String?

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var name: String
    @State private var prompt: String
    @State private var projectId: String?
    @State private var sessionType: SessionType
    @State private var standalone: Bool
    @State private var confirmDelete: Bool = false
    @State private var optionsModel: AgentOptionsFormModel

    // Baseline snapshot for dirty-checking — fixed at creation time.
    private let initialKey: String

    // MARK: - Init

    init(
        action: ActionDefinition?,
        defaultProjectId: String? = nil,
        onSave: @escaping (ActionDefinition) -> Void,
        onCancel: @escaping () -> Void,
        onDelete: (() -> Void)? = nil,
        deleteDisabled: Bool = false,
        deleteDisabledReason: String? = nil
    ) {
        self.action = action
        self.defaultProjectId = defaultProjectId
        self.onSave = onSave
        self.onCancel = onCancel
        self.onDelete = onDelete
        self.deleteDisabled = deleteDisabled
        self.deleteDisabledReason = deleteDisabledReason

        let initialName = action?.name ?? ""
        let initialPrompt = action?.prompt ?? ""
        let initialProjectId = action?.projectId ?? defaultProjectId
        let initialSessionType = action?.sessionType ?? .claude
        let initialStandalone = action?.standalone ?? false

        _name = State(initialValue: initialName)
        _prompt = State(initialValue: initialPrompt)
        _projectId = State(initialValue: initialProjectId)
        _sessionType = State(initialValue: initialSessionType)
        _standalone = State(initialValue: initialStandalone)
        _confirmDelete = State(initialValue: false)
        // Seed agent options from the existing action (settings not available in init).
        // For new actions, settings defaults are applied on first appear.
        _optionsModel = State(initialValue: AgentOptionsFormModel(
            seed: action?.agentOptions,
            settings: nil
        ))
        // For edit mode, round-trip the stored agentOptions through AgentOptionsFormModel
        // (same path as currentKey) so default-filled fields (e.g. permissionMode, sandbox,
        // approvalPolicy) don't produce a false dirty state on open.
        let initialOptions: AgentLaunchOptions?
        if action != nil, initialSessionType != .shell {
            let tempModel = AgentOptionsFormModel(seed: action?.agentOptions, settings: nil)
            let initialAgentType = AgentType(rawValue: initialSessionType.rawValue) ?? .claude
            initialOptions = tempModel.options(for: initialAgentType)
        } else {
            initialOptions = nil
        }
        initialKey = ActionEditor.snapshotKey(
            name: initialName,
            prompt: initialPrompt,
            projectId: initialProjectId,
            sessionType: initialSessionType,
            standalone: initialStandalone,
            options: initialOptions
        )
    }

    // MARK: - Derived

    /// SessionType → AgentType (shell has no AgentType; excluded at call sites).
    private var agentType: AgentType {
        AgentType(rawValue: sessionType.rawValue) ?? .claude
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty &&
        !prompt.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var currentKey: String {
        ActionEditor.snapshotKey(
            name: name,
            prompt: prompt,
            projectId: projectId,
            sessionType: sessionType,
            standalone: standalone,
            options: sessionType == .shell ? nil : optionsModel.options(for: agentType)
        )
    }

    private var hasChanges: Bool { currentKey != initialKey }

    /// Binding bridge: maps `nil` projectId ↔ `"__global__"` sentinel for AppSelect.
    private var projectIdSentinel: Binding<String> {
        Binding(
            get: { projectId ?? "__global__" },
            set: { projectId = $0 == "__global__" ? nil : $0 }
        )
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            // Scrollable form area
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Title
                    Text(headerTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.foreground)
                        .padding(.bottom, 20)

                    // Fields
                    VStack(alignment: .leading, spacing: 16) {
                        fieldGroup(label: "Name") {
                            AppTextField(text: $name, placeholder: "Action name")
                        }

                        fieldGroup(label: "Project") {
                            AppSelect(projectIdSentinel, options: projectOptions)
                        }

                        fieldGroup(label: "Session Type") {
                            AppSelect($sessionType, options: Self.sessionTypeOptions)
                                .onChange(of: sessionType) { _, _ in
                                    // Clear options on any type change (matches TS handleSessionTypeChange:
                                    // only keeps existing options if their type already matches new type,
                                    // which never happens in practice after a user-driven change).
                                    optionsModel = AgentOptionsFormModel(
                                        seed: nil,
                                        settings: env.settings?.settings
                                    )
                                }
                        }

                        AppToggle(
                            title: "Standalone (available in Run menu)",
                            isOn: $standalone
                        )

                        fieldGroup(label: sessionType == .shell ? "Command" : "Prompt") {
                            multilineEditor
                        }

                        if sessionType != .shell {
                            AgentOptionsFormView(
                                model: optionsModel,
                                agent: agentType,
                                onReset: { optionsModel.reset(to: env.settings?.settings) }
                            )
                            .padding(12)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(theme.border, lineWidth: 1)
                            )
                        }
                    }
                }
                .padding(20)
            }

            Divider()

            // Sticky footer
            HStack(spacing: 8) {
                if action != nil, onDelete != nil {
                    AppButton(title: "Delete Action", kind: .destructive) {
                        confirmDelete = true
                    }
                    .disabled(deleteDisabled)
                    .help(deleteDisabledReason ?? "")

                    if let reason = deleteDisabledReason {
                        Text(reason)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.foreground.opacity(0.5))
                    }
                }

                Spacer()

                AppButton(title: "Cancel", kind: .secondary, action: onCancel)

                AppButton(
                    title: action == nil ? "Create Action" : "Save Action",
                    action: save
                )
                .disabled(!isValid || !hasChanges)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(theme.background)
        .onAppear {
            // For new actions, seed agent-options defaults from settings now that env is available.
            if action == nil {
                optionsModel = AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)
            }
        }
        .alert("Delete this action?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { onDelete?() }
            Button("Cancel", role: .cancel) { }
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private func fieldGroup<Content: View>(
        label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.foreground.opacity(0.6))
                .textCase(.uppercase)
                .tracking(0.5)
            content()
        }
    }

    private var multilineEditor: some View {
        let placeholder = sessionType == .shell
            ? "Command to run in the terminal..."
            : "Instructions for the agent..."
        return ZStack(alignment: .topLeading) {
            if prompt.isEmpty {
                Text(placeholder)
                    .foregroundStyle(theme.foreground.opacity(0.35))
                    .font(.system(size: 13))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $prompt)
                .scrollContentBackground(.hidden)
                .font(.system(size: 13))
                .foregroundStyle(theme.foreground)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .frame(minHeight: 120)
        }
        .background(theme.background)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme.border, lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private var headerTitle: String {
        if let action {
            return action.name.isEmpty ? "Edit Action" : action.name
        }
        return "New Action"
    }

    private var projectOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "__global__", label: "Global")]
        let projects = env.projects?.projects ?? []
        opts += projects.map { (value: $0.id, label: $0.name) }
        return opts
    }

    nonisolated static let sessionTypeOptions: [(value: SessionType, label: String)] = [
        (value: .claude,    label: "Claude"),
        (value: .codex,     label: "Codex"),
        (value: .opencode,  label: "OpenCode"),
        (value: .gemini,    label: "Gemini"),
        (value: .cursor,    label: "Cursor"),
        (value: .shell,     label: "Shell"),
    ]

    // MARK: - Save

    private func save() {
        let now = ISO8601DateFormatter().string(from: Date())
        let opts: AgentLaunchOptions? = sessionType == .shell
            ? nil
            : optionsModel.options(for: agentType)
        let definition = ActionDefinition(
            id: action?.id ?? UUID().uuidString,
            projectId: projectId,
            name: name.trimmingCharacters(in: .whitespaces),
            prompt: prompt,  // NOT trimmed, matching TS handleSave
            sessionType: sessionType,
            agentOptions: opts,
            standalone: standalone ? true : nil,
            createdAt: action?.createdAt ?? now,
            updatedAt: now
        )
        onSave(definition)
    }

    // MARK: - Snapshot (dirty-check key)

    /// Canonical snapshot string for dirty-checking. Matches the field set in
    /// `ActionEditor.tsx` `initialSnapshot` / `currentSnapshot`.
    nonisolated static func snapshotKey(
        name: String,
        prompt: String,
        projectId: String?,
        sessionType: SessionType,
        standalone: Bool,
        options: AgentLaunchOptions?
    ) -> String {
        let normalized = AgentOptionsNormalize.normalized(type: sessionType, options: options)
        var parts = [
            "name=\(name)",
            "prompt=\(prompt)",
            "projectId=\(projectId ?? "__global__")",
            "sessionType=\(sessionType.rawValue)",
            "standalone=\(standalone)",
        ]
        if let normalized,
           let data = try? JSONEncoder().encode(normalized),
           let str = String(data: data, encoding: .utf8) {
            parts.append("agentOptions=\(str)")
        } else {
            parts.append("agentOptions=")
        }
        return parts.joined(separator: "&")
    }
}

import SwiftUI

/// Data submitted when the user confirms the New Task / New Subtask form.
struct NewTaskSubmit: Equatable {
    let projectId: String
    let title: String?
    let description: String
    let worktree: Bool
    let parentId: String?
    let startWith: AgentType?
    let agentOptions: AgentLaunchOptions?
    let startWithFlowId: String?
    let initCommand: String?
}

/// Presentation-only New Task / New Subtask creation form.
/// Port of `packages/ui/src/components/sidebar/NewTaskDialog.tsx`.
/// The host (Task 7) owns the open state and wires `onSubmit`.
struct NewTaskDialog: View {

    // MARK: - Props

    @Binding var isPresented: Bool
    let projects: [Project]
    let flows: [FlowDefinition]
    let defaultProjectId: String?
    let parentId: String?
    let onSubmit: (NewTaskSubmit) -> Void

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var selectedProjectId: String
    @State private var description: String = ""
    @State private var title: String = ""
    @State private var worktree: Bool = false
    @State private var initCommand: String = ""
    /// Raw value: "none", an AgentType.rawValue, or "flow".
    @State private var startWithRaw: String = "none"
    @State private var startWithFlowId: String = ""
    @State private var agentOptionsExpanded: Bool = false
    @State private var optionsModel: AgentOptionsFormModel
    @FocusState private var descriptionFocused: Bool

    // MARK: - Init

    init(
        isPresented: Binding<Bool>,
        projects: [Project],
        flows: [FlowDefinition],
        defaultProjectId: String?,
        parentId: String?,
        onSubmit: @escaping (NewTaskSubmit) -> Void
    ) {
        _isPresented = isPresented
        self.projects = projects
        self.flows = flows
        self.defaultProjectId = defaultProjectId
        self.parentId = parentId
        self.onSubmit = onSubmit
        _selectedProjectId = State(initialValue: defaultProjectId ?? "")
        // Settings not available in init; re-seeded in onAppear.
        _optionsModel = State(initialValue: AgentOptionsFormModel(seed: nil, settings: nil))
    }

    // MARK: - Derived

    private var isSubtask: Bool { parentId != nil }

    private var selectedAgent: AgentType? {
        AgentType(rawValue: startWithRaw)
    }

    private var hasFlowSelection: Bool {
        startWithRaw != "flow" || !startWithFlowId.isEmpty
    }

    private var canSubmit: Bool {
        (isSubtask || !selectedProjectId.isEmpty)
            && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && hasFlowSelection
    }

    private var initCommandPlaceholder: String {
        projects.first { $0.id == selectedProjectId }?.defaultInitCommand ?? "bun install"
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Project — hidden in subtask mode
                    if !isSubtask {
                        fieldGroup(label: "Project") {
                            AppSelect($selectedProjectId, options: projectOptions)
                        }
                    }

                    // Description (multi-line, autofocus)
                    fieldGroup(label: "Description") {
                        multilineEditor
                    }

                    // Title (optional)
                    fieldGroup(label: "Title") {
                        AppTextField(
                            text: $title,
                            placeholder: "auto-generated from description"
                        )
                    }

                    // Use git worktree — hidden in subtask mode
                    if !isSubtask {
                        AppToggle(title: "Use git worktree", isOn: $worktree)
                    }

                    // Init command — only when worktree is on (never shown in subtask mode)
                    if !isSubtask && worktree {
                        fieldGroup(label: "Init command") {
                            AppTextField(
                                text: $initCommand,
                                placeholder: initCommandPlaceholder
                            )
                        }
                    }

                    // Start immediately with
                    fieldGroup(label: "Start immediately with") {
                        AppSelect($startWithRaw, options: startWithOptions)
                            .onChange(of: startWithRaw) { _, newValue in
                                if newValue != "flow" {
                                    startWithFlowId = ""
                                }
                                // Re-seed agent options on every agent change
                                optionsModel = AgentOptionsFormModel(
                                    seed: nil,
                                    settings: env.settings?.settings
                                )
                            }
                    }

                    // Flow — only when start-with == "flow"
                    if startWithRaw == "flow" && !flows.isEmpty {
                        fieldGroup(label: "Flow") {
                            AppSelect($startWithFlowId, options: flowOptions)
                        }
                    }

                    // Agent options disclosure — only when a concrete agent is selected
                    if let agent = selectedAgent {
                        VStack(alignment: .leading, spacing: 0) {
                            DisclosureGroup(isExpanded: $agentOptionsExpanded) {
                                AgentOptionsFormView(
                                    model: optionsModel,
                                    agent: agent,
                                    onReset: { optionsModel.reset(to: env.settings?.settings) }
                                )
                                .padding(.top, 8)
                            } label: {
                                Text("Agent Options")
                                    .font(.system(size: 13))
                                    .foregroundStyle(theme.foreground.opacity(0.7))
                            }
                            .padding(12)
                        }
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(theme.border, lineWidth: 1)
                        )
                    }
                }
                .padding(20)
            }
            Divider()
            footer
        }
        .frame(width: 520)
        .background(theme.background)
        .onAppear {
            // Seed agent-option defaults once env is available (settings not in init scope).
            optionsModel = AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)
            descriptionFocused = true
        }
    }

    // MARK: - Sub-views

    private var header: some View {
        HStack {
            Text(isSubtask ? "New Subtask" : "New Task")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                isPresented = false
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Spacer()
            AppButton(title: "Cancel", kind: .secondary) {
                isPresented = false
            }
            AppButton(
                title: isSubtask ? "Create Subtask" : "Create Task",
                action: handleSubmit
            )
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canSubmit)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var multilineEditor: some View {
        ZStack(alignment: .topLeading) {
            if description.isEmpty {
                Text("Describe what this task should accomplish...")
                    .foregroundStyle(theme.foreground.opacity(0.35))
                    .font(.system(size: 13))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $description)
                .focused($descriptionFocused)
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

    // MARK: - Option lists

    private var projectOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "", label: "Select a project")]
        opts += projects.map { (value: $0.id, label: $0.name) }
        return opts
    }

    private var startWithOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "none", label: "None")]
        for agent in RunMenuViewModel.allAgentTypes {
            opts.append((value: agent.rawValue, label: RunMenuViewModel.displayName(agent)))
        }
        if !flows.isEmpty {
            opts.append((value: "flow", label: "Flow"))
        }
        return opts
    }

    private var flowOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "", label: "Select a flow")]
        opts += flows.map { (value: $0.id, label: $0.name) }
        return opts
    }

    // MARK: - Submit

    private func handleSubmit() {
        guard canSubmit else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let agent = selectedAgent
        let agentOptions: AgentLaunchOptions? = agent.flatMap { optionsModel.options(for: $0) }
        let submit = NewTaskSubmit(
            projectId: isSubtask ? (defaultProjectId ?? "") : selectedProjectId,
            title: trimmedTitle.isEmpty ? nil : trimmedTitle,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            worktree: isSubtask ? false : worktree,
            parentId: parentId,
            startWith: agent,
            agentOptions: agentOptions,
            startWithFlowId: (startWithRaw == "flow" && !startWithFlowId.isEmpty)
                ? startWithFlowId : nil,
            initCommand: worktree
                ? initCommand.trimmingCharacters(in: .whitespacesAndNewlines)
                : nil
        )
        onSubmit(submit)
    }
}

import SwiftUI

// Port of `packages/ui/src/components/schedules/ScheduleForm.tsx`.
// Create or edit a single `Schedule`. Embeds `AgentOptionsFormView` and uses `ScheduleHelpers`.

// MARK: - ScheduleSavePayload

/// UI-local payload discriminant. Lets the dialog dispatch to
/// `ScheduleViewModel.create` vs `.update` without inspecting the schedule id.
enum ScheduleSavePayload {
    case create(ScheduleCreatePayload)
    case update(ScheduleUpdatePayload)
}

// MARK: - ScheduleUpdatePayload custom encoding
//
// BACKEND CLEAR-SEMANTICS (backend/src/handlers/schedule.ts):
//   `if ("actionId" in payload) next.actionId = payload.actionId ?? undefined;`
//   `if ("agentType" in payload) next.agentType = payload.agentType ?? undefined;`
//   `if ("agentOptions" in payload) next.agentOptions = payload.agentOptions ?? undefined;`
//
// The backend uses *key-presence* (`"x" in payload`), not undefined-check, to decide
// whether to clear a nullable field.  Absent key → leave existing value unchanged.
// Key present with JSON null → clear the field.
//
// Swift's JSONEncoder omits nil-optional keys by default (absent, not null), so a user
// editing a schedule and removing an action or switching to "Default" agent type would
// NOT actually clear those fields at the backend — they would be silently left as-is.
//
// Fix: override `encode(to:)` so that `actionId`, `agentType`, and `agentOptions` are
// ALWAYS emitted in the JSON (as explicit null when nil).  All other fields remain
// `encodeIfPresent` (absent = leave unchanged), matching the TS PATCH semantics.
extension ScheduleUpdatePayload {
    private enum WireKey: String, CodingKey {
        case id, name, prompt, actionId, agentType, agentOptions
        case expression, expressionType, timeout, enabled
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: WireKey.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(prompt, forKey: .prompt)
        // Always emit — null clears; absent would silently leave existing value.
        if let actionId { try c.encode(actionId, forKey: .actionId) }
        else { try c.encodeNil(forKey: .actionId) }
        if let agentType { try c.encode(agentType, forKey: .agentType) }
        else { try c.encodeNil(forKey: .agentType) }
        if let agentOptions { try c.encode(agentOptions, forKey: .agentOptions) }
        else { try c.encodeNil(forKey: .agentOptions) }
        try c.encodeIfPresent(expression, forKey: .expression)
        try c.encodeIfPresent(expressionType, forKey: .expressionType)
        try c.encodeIfPresent(timeout, forKey: .timeout)
        try c.encodeIfPresent(enabled, forKey: .enabled)
    }
}

// MARK: - ScheduleForm

struct ScheduleForm: View {

    // MARK: Props

    let schedule: Schedule?
    let projects: [Project]
    let actions: [ActionDefinition]
    var defaultProjectId: String?
    let onSave: (ScheduleSavePayload) -> Void
    let onCancel: () -> Void
    var onDelete: (() -> Void)?

    // MARK: Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: State

    @State private var projectId: String
    @State private var actionId: String
    @State private var name: String
    @State private var prompt: String
    @State private var expressionType: String
    @State private var expression: String
    @State private var agentType: String   // "" = default; "shell" = shell; else AgentType.rawValue
    @State private var timeout: String
    @State private var confirmDelete: Bool = false
    @State private var optionsModel: AgentOptionsFormModel

    // Fixed at construction time — not @State so it never triggers re-renders.
    private let isEditing: Bool
    private let initialKey: String

    // MARK: Init

    init(
        schedule: Schedule?,
        projects: [Project],
        actions: [ActionDefinition],
        defaultProjectId: String? = nil,
        onSave: @escaping (ScheduleSavePayload) -> Void,
        onCancel: @escaping () -> Void,
        onDelete: (() -> Void)? = nil
    ) {
        self.schedule = schedule
        self.projects = projects
        self.actions = actions
        self.defaultProjectId = defaultProjectId
        self.onSave = onSave
        self.onCancel = onCancel
        self.onDelete = onDelete

        let editing = schedule != nil
        isEditing = editing

        // Extract agentType string from AnyCodable?
        let initialAgentTypeStr: String
        if let at = schedule?.agentType, case .string(let s) = at.value {
            initialAgentTypeStr = s
        } else {
            initialAgentTypeStr = ""
        }

        let initialProjectId  = schedule?.projectId ?? defaultProjectId ?? ""
        let initialActionId   = schedule?.actionId ?? ""
        let initialName       = schedule?.name ?? ""
        let initialPrompt     = schedule?.prompt ?? ""
        let initialExpType    = schedule?.expressionType ?? "rate"
        let initialExpression = schedule?.expression ?? "rate(30 minutes)"
        let initialTimeout    = String(Int(schedule?.timeout ?? 30))

        _projectId      = State(initialValue: initialProjectId)
        _actionId       = State(initialValue: initialActionId)
        _name           = State(initialValue: initialName)
        _prompt         = State(initialValue: initialPrompt)
        _expressionType = State(initialValue: initialExpType)
        _expression     = State(initialValue: initialExpression)
        _agentType      = State(initialValue: initialAgentTypeStr)
        _timeout        = State(initialValue: initialTimeout)
        _confirmDelete  = State(initialValue: false)
        _optionsModel   = State(initialValue: AgentOptionsFormModel(seed: schedule?.agentOptions, settings: nil))

        // Build initial dirty key via the same AgentOptionsFormModel path used for currentKey.
        // Using the raw options directly would produce a mismatch because the model fills in
        // defaults (e.g. permissionMode, sandbox, approvalPolicy), making edit-mode start dirty.
        let initialUseAction = !initialActionId.isEmpty
        let initialAgentTypeEnum: AgentType? = {
            guard !initialAgentTypeStr.isEmpty && initialAgentTypeStr != "shell" else { return nil }
            return AgentType(rawValue: initialAgentTypeStr)
        }()
        let initialOptions: AgentLaunchOptions?
        if !initialUseAction, let atEnum = initialAgentTypeEnum {
            let tempModel = AgentOptionsFormModel(seed: schedule?.agentOptions, settings: nil)
            initialOptions = tempModel.options(for: atEnum)
        } else {
            initialOptions = nil
        }
        initialKey = ScheduleHelpers.dirtyKey(
            includeProjectId: !editing,
            projectId: initialProjectId,
            name: initialName,
            actionId: initialActionId,
            prompt: initialPrompt,
            expression: initialExpression,
            expressionType: initialExpType,
            agentType: initialAgentTypeStr,
            agentOptions: initialOptions,
            timeout: initialTimeout,
            useAction: initialUseAction
        )
    }

    // MARK: Derived

    /// Actions visible for the current project: global (nil projectId) + same project, standalone only.
    /// Mirrors TS `filterByProject(actions, projectId).filter(a => a.standalone)`.
    private var availableActions: [ActionDefinition] {
        let base: [ActionDefinition] = projectId.isEmpty
            ? actions
            : actions.filter { $0.projectId == nil || $0.projectId == projectId }
        return base.filter { $0.standalone == true }
    }

    private var selectedAction: ActionDefinition? {
        actionId.isEmpty ? nil : actions.first { $0.id == actionId }
    }

    private var useAction: Bool { selectedAction != nil }

    private var nextRunPreview: String? {
        ScheduleHelpers.computeNextRunPreview(expression: expression, expressionType: expressionType, now: Date())
    }

    /// String agentType → AgentType enum (empty / "shell" / "__default__" → nil).
    private var agentTypeEnum: AgentType? {
        guard !agentType.isEmpty && agentType != "shell" && agentType != "__default__" else { return nil }
        return AgentType(rawValue: agentType)
    }

    private var currentKey: String {
        let opts = useAction ? nil : agentTypeEnum.flatMap { optionsModel.options(for: $0) }
        return ScheduleHelpers.dirtyKey(
            includeProjectId: !isEditing,
            projectId: projectId,
            name: name,
            actionId: actionId,
            prompt: prompt,
            expression: expression,
            expressionType: expressionType,
            agentType: agentType,
            agentOptions: opts,
            timeout: timeout,
            useAction: useAction
        )
    }

    private var hasChanges: Bool { currentKey != initialKey }

    /// Port of TS canSave: prompt required unless action selected; expression required; projectId
    /// required when creating.
    private var canSave: Bool {
        (useAction || !prompt.trimmingCharacters(in: .whitespaces).isEmpty) &&
        !expression.trimmingCharacters(in: .whitespaces).isEmpty &&
        (isEditing || !projectId.isEmpty)
    }

    // MARK: Body

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(isEditing ? "Edit Schedule" : "New Schedule")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.foreground)
                Spacer()
                if onDelete != nil {
                    AppButton(title: "Delete", kind: .destructive) { confirmDelete = true }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            Divider()

            // Error banner (above form, below header)
            if let lastError = schedule?.lastError {
                Text(lastError)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.destructive)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.destructive.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(theme.destructive.opacity(0.3), lineWidth: 1)
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
            }

            // Scrollable form area
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {

                    // Project — create only
                    if !isEditing {
                        fieldGroup(label: "Project") {
                            AppSelect($projectId, options: projectOptions)
                                .onChange(of: projectId) { _, _ in
                                    if !actionId.isEmpty,
                                       !availableActions.contains(where: { $0.id == actionId }) {
                                        actionId = ""
                                    }
                                }
                        }
                    }

                    // Action selector (only when standalone actions exist for this project)
                    if !availableActions.isEmpty {
                        fieldGroup(label: "Action") {
                            AppSelect(actionSentinelBinding, options: actionOptions)
                        }
                    }

                    // Action summary card
                    if useAction, let sel = selectedAction {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Action: \(sel.name)")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(theme.foreground.opacity(0.6))
                                .textCase(.uppercase)
                                .tracking(0.5)
                            Text("Agent: \(sel.sessionType.rawValue)")
                                .font(.system(size: 11))
                                .foregroundStyle(theme.foreground.opacity(0.6))
                            Text(sel.prompt)
                                .font(.system(size: 11))
                                .foregroundStyle(theme.foreground.opacity(0.6))
                                .lineLimit(3)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.muted.opacity(0.3))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(theme.border, lineWidth: 1)
                        )
                    }

                    // Type — hidden when action selected
                    if !useAction {
                        fieldGroup(label: "Type") {
                            AppSelect(agentTypeSentinelBinding, options: Self.agentTypeOptions)
                                .onChange(of: agentType) { _, _ in
                                    optionsModel = AgentOptionsFormModel(
                                        seed: nil, settings: env.settings?.settings
                                    )
                                }
                        }
                    }

                    // Name — hidden when action selected
                    if !useAction {
                        fieldGroup(label: "Name (optional)") {
                            AppTextField(text: $name, placeholder: "Auto-generated from prompt")
                        }
                    }

                    // Prompt / Command — hidden when action selected
                    if !useAction {
                        let promptLabel = agentType == "shell" ? "Command" : "Prompt"
                        fieldGroup(label: promptLabel) {
                            promptEditor
                        }
                    }

                    // Schedule expression row
                    fieldGroup(label: "Schedule") {
                        HStack(spacing: 8) {
                            AppSelect($expressionType, options: Self.expressionTypeOptions)
                            AppTextField(
                                text: $expression,
                                placeholder: expressionType == "rate" ? "rate(30 minutes)" : "0 */6 * * *"
                            )
                        }
                        if let preview = nextRunPreview {
                            Text("Next run: \(preview)")
                                .font(.system(size: 11))
                                .foregroundStyle(theme.foreground.opacity(0.5))
                        }
                    }

                    // Agent options — hidden when action selected or shell or no type
                    if !useAction, !agentType.isEmpty, agentType != "shell",
                       let atEnum = agentTypeEnum {
                        AgentOptionsFormView(
                            model: optionsModel,
                            agent: atEnum,
                            onReset: { optionsModel.reset(to: env.settings?.settings) }
                        )
                        .padding(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(theme.border, lineWidth: 1)
                        )
                    }

                    // Timeout
                    fieldGroup(label: "Timeout (minutes)") {
                        AppTextField(text: $timeout, placeholder: "30")
                    }

                }
                .padding(20)
            }

            Divider()

            // Footer
            HStack(spacing: 8) {
                Spacer()
                AppButton(title: "Cancel", kind: .secondary, action: onCancel)
                AppButton(
                    title: isEditing ? "Save" : "Create",
                    action: handleSave
                )
                .disabled(!canSave || !hasChanges)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(theme.background)
        .onAppear {
            // Seed agent-option defaults from settings when creating a new schedule.
            // Edit mode keeps the schedule's stored options as-is.
            if !isEditing {
                optionsModel = AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)
            }
        }
        .alert("Delete this schedule?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { onDelete?() }
            Button("Cancel", role: .cancel) { }
        }
    }

    // MARK: Sub-views

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

    private var promptEditor: some View {
        let placeholder = agentType == "shell"
            ? "Shell command to run"
            : "What should the agent do?"
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
                .frame(minHeight: 80)
        }
        .background(theme.background)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme.border, lineWidth: 1)
        )
    }

    // MARK: Binding bridges

    /// Maps `actionId = ""` ↔ sentinel `"__none__"` for the AppSelect.
    private var actionSentinelBinding: Binding<String> {
        Binding(
            get: { actionId.isEmpty ? "__none__" : actionId },
            set: { actionId = $0 == "__none__" ? "" : $0 }
        )
    }

    /// Maps `agentType = ""` ↔ sentinel `"__default__"` for the AppSelect.
    private var agentTypeSentinelBinding: Binding<String> {
        Binding(
            get: { agentType.isEmpty ? "__default__" : agentType },
            set: { agentType = $0 == "__default__" ? "" : $0 }
        )
    }

    // MARK: Option lists (static)

    private var projectOptions: [(value: String, label: String)] {
        projects.map { (value: $0.id, label: $0.name) }
    }

    private var actionOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [("__none__", "None (custom prompt)")]
        opts += availableActions.map { (value: $0.id, label: $0.name) }
        return opts
    }

    /// All agent-type options including pi (schedules differ from flow editors here).
    nonisolated static let agentTypeOptions: [(value: String, label: String)] = [
        ("__default__", "Default"),
        ("claude",     "Claude"),
        ("codex",      "Codex"),
        ("opencode",   "OpenCode"),
        ("gemini",     "Gemini"),
        ("cursor",     "Cursor"),
        ("pi",         "Pi"),
        ("shell",      "Shell"),
    ]

    nonisolated static let expressionTypeOptions: [(value: String, label: String)] = [
        ("rate", "Rate"),
        ("cron", "Cron"),
    ]

    // MARK: Save

    private func handleSave() {
        guard canSave && hasChanges else { return }

        let effectiveTimeout = ScheduleHelpers.normalizeTimeout(timeout)

        // Map string → AgentType enum; "" / "shell" / "__default__" all become nil.
        let agentTypeAnyCodable: AnyCodable? = agentTypeEnum.map { AnyCodable(.string($0.rawValue)) }

        // Agent options: nil when action is selected or no AI type configured.
        let opts: AgentLaunchOptions? = useAction ? nil : agentTypeEnum.flatMap { optionsModel.options(for: $0) }

        if isEditing, let existing = schedule {
            // TS sends actionId/agentType as `null` to CLEAR them; the custom encode(to:)
            // above ensures nil Swift optionals reach the backend as JSON null (not absent).
            let payload = ScheduleUpdatePayload(
                id: existing.id,
                name: name.isEmpty ? nil : name,
                prompt: useAction ? nil : prompt,
                actionId: actionId.isEmpty ? nil : actionId,
                agentType: useAction ? nil : agentTypeAnyCodable,
                agentOptions: opts,
                expression: expression,
                expressionType: expressionType,
                timeout: effectiveTimeout,
                enabled: nil
            )
            onSave(.update(payload))
        } else {
            let payload = ScheduleCreatePayload(
                projectId: projectId,
                name: name.isEmpty ? nil : name,
                prompt: useAction ? nil : prompt,
                actionId: actionId.isEmpty ? nil : actionId,
                agentType: useAction ? nil : agentTypeAnyCodable,
                agentOptions: opts,
                expression: expression,
                expressionType: expressionType,
                timeout: effectiveTimeout,
                enabled: nil
            )
            onSave(.create(payload))
        }
    }
}

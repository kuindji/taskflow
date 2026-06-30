import SwiftUI

/// Inline sub-form for editing an `ActionInline` embedded in a flow row.
/// Parent-controlled: no internal dirty-check; pushes every edit up via `onUpdate`.
/// Port of `packages/ui/src/components/flows/InlineActionEditor.tsx`.
struct InlineActionEditor: View {

    // MARK: - Props

    let entryId: String
    let inline: ActionInline
    let onUpdate: (String, ActionInline) -> Void

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var name: String
    @State private var prompt: String
    @State private var sessionType: SessionType
    @State private var optionsModel: AgentOptionsFormModel

    // MARK: - Init

    init(
        entryId: String,
        inline: ActionInline,
        onUpdate: @escaping (String, ActionInline) -> Void
    ) {
        self.entryId = entryId
        self.inline = inline
        self.onUpdate = onUpdate

        _name = State(initialValue: inline.name)
        _prompt = State(initialValue: inline.prompt)
        _sessionType = State(initialValue: inline.sessionType)
        // Seed agent options from the existing inline (settings not available in init).
        _optionsModel = State(initialValue: AgentOptionsFormModel(
            seed: inline.agentOptions,
            settings: nil
        ))
    }

    // MARK: - Derived

    /// SessionType → AgentType (shell has no AgentType; excluded at call sites).
    private var agentType: AgentType {
        AgentType(rawValue: sessionType.rawValue) ?? .claude
    }

    /// Snapshot string covering all agent-options model fields for change detection via
    /// `.onChange(of:)`. Returns `""` when `sessionType == .shell` so that switching to
    /// shell does not produce a spurious emission from residual field values.
    private var optionsSnapshot: String {
        guard sessionType != .shell else { return "" }
        let fields: [String] = [
            optionsModel.claudeModel ?? "",
            optionsModel.claudeEffort?.rawValue ?? "",
            String(optionsModel.claudeSkipPermissions),
            optionsModel.claudePermissionMode.rawValue,
            optionsModel.codexModel,
            String(optionsModel.codexFullAuto),
            optionsModel.codexSandbox.rawValue,
            optionsModel.codexApprovalPolicy.rawValue,
            optionsModel.geminiModel,
            optionsModel.geminiApprovalMode,
            String(optionsModel.geminiSandbox),
            optionsModel.cursorModel,
            String(optionsModel.cursorYolo),
            optionsModel.openCodeModel,
            optionsModel.openCodeVariant,
            String(optionsModel.openCodeAutoApprove),
        ]
        return fields.joined(separator: "|")
    }

    nonisolated static let sessionTypeOptions: [(value: SessionType, label: String)] = [
        (value: .claude,    label: "Claude"),
        (value: .codex,     label: "Codex"),
        (value: .opencode,  label: "OpenCode"),
        (value: .gemini,    label: "Gemini"),
        (value: .cursor,    label: "Cursor"),
        (value: .shell,     label: "Shell"),
    ]

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AppTextField(text: $name, placeholder: "Inline action name")
                .onChange(of: name) { _, _ in emitUpdate() }

            AppSelect($sessionType, options: Self.sessionTypeOptions)
                .onChange(of: sessionType) { _, _ in
                    // Clear options on session-type change, seeding defaults from settings.
                    // Mirrors ActionEditor.handleSessionTypeChange.
                    optionsModel = AgentOptionsFormModel(
                        seed: nil,
                        settings: env.settings?.settings
                    )
                    emitUpdate()
                }

            multilineEditor
                .onChange(of: prompt) { _, _ in emitUpdate() }

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
                // Propagate any options-model mutation to the parent. `optionsSnapshot`
                // reads all model fields so SwiftUI tracks the @Observable class and
                // fires this handler whenever any field changes (including onReset).
                .onChange(of: optionsSnapshot) { _, _ in emitUpdate() }
            }
        }
    }

    // MARK: - Sub-views

    private var multilineEditor: some View {
        let placeholder = sessionType == .shell
            ? "Command to run in the terminal..."
            : "Inline action prompt"
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

    // MARK: - Emit

    /// Assembles the current local state into an `ActionInline` and calls `onUpdate`.
    /// Called from every `.onChange` handler so the parent always sees the latest snapshot.
    private func emitUpdate() {
        let opts: AgentLaunchOptions? = sessionType == .shell
            ? nil
            : optionsModel.options(for: agentType)
        let updated = ActionInline(
            name: name,
            prompt: prompt,
            sessionType: sessionType,
            agentOptions: opts
        )
        onUpdate(entryId, updated)
    }
}

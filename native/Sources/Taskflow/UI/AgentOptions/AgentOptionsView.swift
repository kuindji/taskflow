import SwiftUI

/// Switches on the agent type to the matching option fragment. Self-contained editable
/// state for the gallery; 5D/5E lift the bindings into their form models.
struct AgentOptionsView: View {
    let agent: AgentType
    var mode: AgentOptionsMode = .session

    // Claude
    @State private var claudeModel: String? = nil
    @State private var claudeEffort: ClaudeEffortLevel? = nil
    @State private var claudeSkip = false
    @State private var claudePermission: ClaudePermissionMode = .default
    // Codex
    @State private var codexModel = ""
    @State private var codexFullAuto = false
    @State private var codexSandbox: CodexSandboxMode = .workspaceWrite
    @State private var codexApproval: CodexApprovalPolicy = .onRequest
    // Gemini
    @State private var geminiModel = ""
    @State private var geminiApproval = "default"
    @State private var geminiSandbox = false
    // Cursor
    @State private var cursorModel = ""
    @State private var cursorYolo = false
    // OpenCode
    @State private var ocModel = ""
    @State private var ocVariant = ""
    @State private var ocAutoApprove = false
    // Pi
    @State private var piModel = ""
    @State private var piThinking: PiThinkingLevel = .off
    @State private var piTools = ""

    var body: some View {
        switch agent {
        case .claude:
            ClaudeOptionsView(model: $claudeModel, effort: $claudeEffort,
                              skipPermissions: $claudeSkip, permissionMode: $claudePermission, mode: mode)
        case .codex:
            CodexOptionsView(model: $codexModel, fullAuto: $codexFullAuto,
                             sandbox: $codexSandbox, approvalPolicy: $codexApproval, mode: mode)
        case .gemini:
            GeminiOptionsView(model: $geminiModel, approvalMode: $geminiApproval,
                              sandbox: $geminiSandbox, mode: mode)
        case .cursor:
            CursorOptionsView(model: $cursorModel, yolo: $cursorYolo, mode: mode)
        case .opencode:
            OpenCodeOptionsView(model: $ocModel, variant: $ocVariant,
                                autoApprove: $ocAutoApprove, mode: mode)
        case .pi:
            PiOptionsView(model: $piModel, thinking: $piThinking, tools: $piTools, mode: mode)
        }
    }
}

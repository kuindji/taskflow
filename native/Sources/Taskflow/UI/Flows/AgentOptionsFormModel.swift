import Foundation

// Reusable agent-options sub-form model. Lifts the Phase-5A *OptionsView @State into a model.
// Mirrors packages/ui/src/components/workspace/AgentOptionsPanel.tsx build/emit behavior.
@MainActor @Observable
final class AgentOptionsFormModel {

    // MARK: - Claude fields

    var claudeModel: String? = nil
    var claudeEffort: ClaudeEffortLevel? = nil
    var claudeSkipPermissions: Bool = false
    var claudePermissionMode: ClaudePermissionMode = .default

    // MARK: - Codex fields

    var codexModel: String = ""
    var codexFullAuto: Bool = false
    var codexSandbox: CodexSandboxMode = .workspaceWrite
    var codexApprovalPolicy: CodexApprovalPolicy = .onRequest

    // MARK: - Gemini fields

    var geminiModel: String = ""
    var geminiApprovalMode: String = "default"
    var geminiSandbox: Bool = false

    // MARK: - Cursor fields

    var cursorModel: String = ""
    var cursorYolo: Bool = false

    // MARK: - OpenCode fields

    var openCodeModel: String = ""
    var openCodeVariant: String = ""
    var openCodeAutoApprove: Bool = false

    // MARK: - Pi fields

    var piModel: String = ""
    var piThinking: PiThinkingLevel = .off
    var piTools: String = ""

    // MARK: - Init

    init(seed: AgentLaunchOptions?, settings: AppSettings?) {
        seedDefaults(from: settings)
        switch seed {
        case .claude(let o)?:
            claudeModel = o.model
            claudeEffort = o.effort
            claudeSkipPermissions = o.dangerouslySkipPermissions ?? false
            claudePermissionMode = o.permissionMode ?? .default
        case .codex(let o)?:
            codexModel = o.model ?? ""
            codexFullAuto = o.fullAuto ?? false
            if let s = o.sandbox { codexSandbox = s }
            if let p = o.approvalPolicy { codexApprovalPolicy = p }
        case .opencode(let o)?:
            openCodeModel = o.model ?? ""
            openCodeVariant = o.variant ?? ""
            openCodeAutoApprove = o.autoApprove ?? false
        case .gemini(let o)?:
            geminiModel = o.model ?? ""
            geminiApprovalMode = o.approvalMode ?? "default"
            geminiSandbox = o.sandbox ?? false
        case .cursor(let o)?:
            cursorModel = o.model ?? ""
            cursorYolo = o.yolo ?? false
        case .pi(let o)?:
            piModel = o.model ?? ""
            piThinking = o.thinking ?? .off
            piTools = o.tools ?? ""
        case nil:
            break
        }
    }

    // MARK: - options(for:)

    func options(for agent: AgentType) -> AgentLaunchOptions? {
        let raw: AgentLaunchOptions
        switch agent {
        case .claude:
            raw = .claude(ClaudeLaunchOptions(
                type: AnyCodable(.string("claude")),
                dangerouslySkipPermissions: claudeSkipPermissions,
                permissionMode: claudePermissionMode,
                model: claudeModel,
                effort: claudeEffort))
        case .codex:
            raw = .codex(CodexLaunchOptions(
                type: AnyCodable(.string("codex")),
                model: codexModel,
                sandbox: codexSandbox,
                approvalPolicy: codexApprovalPolicy,
                fullAuto: codexFullAuto))
        case .opencode:
            raw = .opencode(OpenCodeLaunchOptions(
                type: AnyCodable(.string("opencode")),
                model: openCodeModel,
                variant: openCodeVariant,
                autoApprove: openCodeAutoApprove))
        case .gemini:
            raw = .gemini(GeminiLaunchOptions(
                type: AnyCodable(.string("gemini")),
                approvalMode: geminiApprovalMode,
                sandbox: geminiSandbox,
                model: geminiModel))
        case .cursor:
            raw = .cursor(CursorLaunchOptions(
                type: AnyCodable(.string("cursor")),
                yolo: cursorYolo,
                model: cursorModel))
        case .pi:
            raw = .pi(PiLaunchOptions(
                type: AnyCodable(.string("pi")),
                model: piModel,
                thinking: piThinking,
                tools: piTools))
        }
        return AgentOptionsNormalize.normalized(
            type: SessionType(rawValue: agent.rawValue) ?? .shell,
            options: raw)
    }

    // MARK: - reset(to:)

    func reset(to settings: AppSettings?) {
        claudeModel = nil
        claudeEffort = nil
        claudeSkipPermissions = false
        claudePermissionMode = .default
        codexModel = ""
        codexFullAuto = false
        codexSandbox = .workspaceWrite
        codexApprovalPolicy = .onRequest
        geminiModel = ""
        geminiApprovalMode = "default"
        geminiSandbox = false
        cursorModel = ""
        cursorYolo = false
        openCodeModel = ""
        openCodeVariant = ""
        openCodeAutoApprove = false
        piModel = ""
        piThinking = .off
        piTools = ""
        seedDefaults(from: settings)
    }

    // MARK: - Private

    private func seedDefaults(from settings: AppSettings?) {
        guard let s = settings else { return }
        // Claude — defaultEffort and permissionMode are AnyCodable; decode via pattern matching
        claudeModel = s.claude.defaultModel.isEmpty ? nil : s.claude.defaultModel
        claudeSkipPermissions = s.claude.dangerouslySkipPermissions
        if case .string(let raw) = s.claude.defaultEffort.value {
            claudeEffort = ClaudeEffortLevel(rawValue: raw)
        }
        if case .string(let raw) = s.claude.permissionMode.value {
            claudePermissionMode = ClaudePermissionMode(rawValue: raw) ?? .default
        }
        // Codex
        codexModel = s.codex.defaultModel
        codexSandbox = s.codex.sandbox
        codexApprovalPolicy = s.codex.approvalPolicy
        codexFullAuto = s.codex.fullAuto
        // OpenCode
        openCodeModel = s.opencode.defaultModel
        openCodeVariant = s.opencode.defaultVariant
        openCodeAutoApprove = s.opencode.autoApprove
        // Gemini
        geminiModel = s.gemini.defaultModel
        geminiApprovalMode = s.gemini.approvalMode
        geminiSandbox = s.gemini.sandbox
        // Cursor
        cursorModel = s.cursor.defaultModel
        cursorYolo = s.cursor.yolo
        // Pi
        piModel = s.pi.defaultModel
        piThinking = s.pi.thinking
        piTools = s.pi.tools
    }
}

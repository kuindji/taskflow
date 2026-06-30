// Port of packages/ui/src/lib/normalize-agent-options.ts
// Canonical agent-options encoder used for dirty-checking across the flow/schedule editors.
enum AgentOptionsNormalize {
    nonisolated static func normalized(type: SessionType, options: AgentLaunchOptions?) -> AgentLaunchOptions? {
        guard type != .shell, let options else { return nil }
        switch (type, options) {
        case (.claude, .claude(let o)):
            return .claude(ClaudeLaunchOptions(
                type: AnyCodable(.string("claude")),
                dangerouslySkipPermissions: o.dangerouslySkipPermissions == true ? true : nil,
                permissionMode: o.permissionMode,
                model: (o.model?.isEmpty == false) ? o.model : nil,
                effort: o.effort))
        case (.codex, .codex(let o)):
            return .codex(CodexLaunchOptions(
                type: AnyCodable(.string("codex")),
                model: (o.model?.isEmpty == false) ? o.model : nil,
                sandbox: o.sandbox,
                approvalPolicy: o.approvalPolicy,
                fullAuto: o.fullAuto == true ? true : nil))
        case (.opencode, .opencode(let o)):
            return .opencode(OpenCodeLaunchOptions(
                type: AnyCodable(.string("opencode")),
                model: (o.model?.isEmpty == false) ? o.model : nil,
                variant: (o.variant?.isEmpty == false) ? o.variant : nil,
                autoApprove: o.autoApprove == true ? true : nil))
        case (.gemini, .gemini(let o)):
            return .gemini(GeminiLaunchOptions(
                type: AnyCodable(.string("gemini")),
                approvalMode: o.approvalMode,
                sandbox: o.sandbox == true ? true : nil,
                model: (o.model?.isEmpty == false) ? o.model : nil))
        case (.cursor, .cursor(let o)):
            return .cursor(CursorLaunchOptions(
                type: AnyCodable(.string("cursor")),
                yolo: o.yolo == true ? true : nil,
                model: (o.model?.isEmpty == false) ? o.model : nil))
        case (.pi, .pi(let o)):
            return .pi(PiLaunchOptions(
                type: AnyCodable(.string("pi")),
                model: (o.model?.isEmpty == false) ? o.model : nil,
                thinking: o.thinking,
                tools: (o.tools?.isEmpty == false) ? o.tools : nil))
        default:
            return nil   // type mismatch
        }
    }
}

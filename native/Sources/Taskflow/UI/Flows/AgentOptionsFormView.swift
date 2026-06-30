import SwiftUI

/// Reusable agent-options form view. Embeds the matching fragment for `agent`,
/// binding into `model`. Provides an optional reset button via `onReset`.
struct AgentOptionsFormView: View {
    @Bindable var model: AgentOptionsFormModel
    let agent: AgentType
    var onReset: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch agent {
            case .claude:
                ClaudeOptionsView(
                    model: $model.claudeModel,
                    effort: $model.claudeEffort,
                    skipPermissions: $model.claudeSkipPermissions,
                    permissionMode: $model.claudePermissionMode)
            case .codex:
                CodexOptionsView(
                    model: $model.codexModel,
                    fullAuto: $model.codexFullAuto,
                    sandbox: $model.codexSandbox,
                    approvalPolicy: $model.codexApprovalPolicy)
            case .opencode:
                OpenCodeOptionsView(
                    model: $model.openCodeModel,
                    variant: $model.openCodeVariant,
                    autoApprove: $model.openCodeAutoApprove)
            case .gemini:
                GeminiOptionsView(
                    model: $model.geminiModel,
                    approvalMode: $model.geminiApprovalMode,
                    sandbox: $model.geminiSandbox)
            case .cursor:
                CursorOptionsView(
                    model: $model.cursorModel,
                    yolo: $model.cursorYolo)
            case .pi:
                PiOptionsView(
                    model: $model.piModel,
                    thinking: $model.piThinking,
                    tools: $model.piTools)
            }
            if let onReset {
                AppButton(title: "Reset to defaults", kind: .secondary, action: onReset)
            }
        }
    }
}

import SwiftUI

/// Port of components/shared/CodexOptions.tsx. Sandbox + approval are disabled while Full Auto is on.
struct CodexOptionsView: View {
    @Binding var model: String
    @Binding var fullAuto: Bool
    @Binding var sandbox: CodexSandboxMode
    @Binding var approvalPolicy: CodexApprovalPolicy
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: mode == .defaults ? "Default Model" : "Model",
                       hint: mode == .defaults ? "Pre-selected model when running Codex sessions"
                                               : "Model for Codex session") {
                AppTextField(text: $model, placeholder: "e.g. o3, o4-mini")
                    .frame(width: 180)
            }
            SettingRow(label: "Full Auto",
                       hint: "Convenience mode: workspace-write sandbox + on-request approval") {
                AppToggle(title: fullAuto ? "Enabled" : "Disabled", isOn: $fullAuto)
            }
            SettingRow(label: "Sandbox",
                       hint: mode == .defaults ? "Default sandbox policy for model-generated shell commands"
                                               : "Sandbox policy for model-generated shell commands") {
                AppSelect($sandbox, options: [
                    (.readOnly, "Read only"), (.workspaceWrite, "Workspace write"),
                    (.dangerFullAccess, "Full access (dangerous)"),
                ])
                .disabled(fullAuto)
            }
            SettingRow(label: "Approval Policy",
                       hint: mode == .defaults ? "Default approval policy for commands"
                                               : "When to ask for approval of commands") {
                AppSelect($approvalPolicy, options: [
                    (.always, "Always"), (.unlessAllowListed, "Unless allow-listed"),
                    (.onRequest, "On request"), (.never, "Never"),
                ])
                .disabled(fullAuto)
            }
        }
    }
}

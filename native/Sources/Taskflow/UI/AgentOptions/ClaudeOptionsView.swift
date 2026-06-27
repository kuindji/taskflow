import SwiftUI

/// Port of components/shared/ClaudeOptions.tsx. Presentational: binds to typed values;
/// the consumer (5D/5E) owns serialization to ClaudeLaunchOptions.
struct ClaudeOptionsView: View {
    @Binding var model: String?               // nil = "Default" sentinel
    @Binding var effort: ClaudeEffortLevel?   // nil = "Default"
    @Binding var skipPermissions: Bool
    @Binding var permissionMode: ClaudePermissionMode
    var mode: AgentOptionsMode = .session

    nonisolated static func modelLabel(_ mode: AgentOptionsMode) -> String {
        mode == .defaults ? "Default Model" : "Model"
    }
    private nonisolated static func effortLabel(_ mode: AgentOptionsMode) -> String {
        mode == .defaults ? "Default Effort" : "Effort"
    }

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(label: Self.modelLabel(mode),
                       hint: mode == .defaults ? "Pre-selected model when running Claude sessions"
                                               : "Model for Claude session") {
                AppSelect($model, options: [
                    (nil, "Default"), ("fable", "Fable"), ("opus", "Opus"),
                    ("sonnet", "Sonnet"), ("haiku", "Haiku"),
                ])
            }
            SettingRow(label: Self.effortLabel(mode),
                       hint: mode == .defaults ? "Pre-selected effort level when running Claude sessions"
                                               : "Effort level for Claude session") {
                AppSelect($effort, options: [
                    (Optional<ClaudeEffortLevel>.none, "Default"),
                    (.low, "Low"), (.medium, "Medium"), (.high, "High"),
                    (.xhigh, "Extra High"), (.max, "Max"),
                ])
            }
            SettingRow(label: "Skip Permissions",
                       hint: mode == .defaults ? "Bypass all permission checks by default (--dangerously-skip-permissions)"
                                               : "Bypass all permission checks (--dangerously-skip-permissions)") {
                AppToggle(title: skipPermissions ? "Enabled" : "Disabled", isOn: $skipPermissions)
            }
            SettingRow(label: "Permission Mode",
                       hint: mode == .defaults ? "Default permission mode for Claude sessions"
                                               : "Permission mode for this session") {
                AppSelect($permissionMode, options: [
                    (.default, "Default"), (.auto, "Auto"), (.acceptEdits, "Accept Edits"),
                    (.bypassPermissions, "Bypass Permissions"), (.dontAsk, "Don't Ask"), (.plan, "Plan"),
                ])
            }
        }
    }
}

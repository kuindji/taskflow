import SwiftUI

/// Port of components/shared/GeminiOptions.tsx. Presentational: binds to typed values;
/// the consumer (5D/5E) owns serialization to GeminiLaunchOptions.
struct GeminiOptionsView: View {
    @Binding var model: String
    @Binding var approvalMode: String
    @Binding var sandbox: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(
                label: mode == .defaults ? "Default Model" : "Model",
                hint: mode == .defaults
                    ? "Pre-selected model when running Gemini sessions"
                    : "Model for Gemini session"
            ) {
                AppTextField(text: $model, placeholder: "default")
                    .frame(width: 180)
            }
            SettingRow(
                label: "Approval Mode",
                hint: mode == .defaults
                    ? "Default approval mode for tool actions"
                    : "Controls how tool actions are approved"
            ) {
                AppSelect($approvalMode, options: [
                    ("default", "Default"),
                    ("auto_edit", "Auto Edit"),
                    ("yolo", "Yolo"),
                    ("plan", "Plan"),
                ])
            }
            SettingRow(
                label: "Sandbox",
                hint: mode == .defaults ? "Run in sandbox mode by default" : "Run in sandbox mode"
            ) {
                AppToggle(title: sandbox ? "Enabled" : "Disabled", isOn: $sandbox)
            }
        }
    }
}

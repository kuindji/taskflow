import SwiftUI

/// Port of components/shared/OpenCodeOptions.tsx. Variant is a string select matching
/// TS options: none/"", high, max, minimal.
struct OpenCodeOptionsView: View {
    @Binding var model: String
    @Binding var variant: String
    @Binding var autoApprove: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(
                label: mode == .defaults ? "Default Model" : "Model",
                hint: mode == .defaults
                    ? "Pre-selected model when running OpenCode sessions"
                    : "Model for OpenCode session (--model)"
            ) {
                OpenCodeModelSelect(value: $model)
            }
            SettingRow(
                label: mode == .defaults ? "Default Variant" : "Variant",
                hint: mode == .defaults
                    ? "Model variant / reasoning effort level"
                    : "Reasoning effort level (--variant)"
            ) {
                AppSelect($variant, options: [
                    ("", "None"), ("high", "High"), ("max", "Max"), ("minimal", "Minimal"),
                ])
            }
            SettingRow(
                label: "Auto-approve",
                hint: mode == .defaults
                    ? "Auto-approve all tool permissions by default"
                    : "Auto-approve all tool permissions"
            ) {
                AppToggle(title: autoApprove ? "Enabled" : "Disabled", isOn: $autoApprove)
            }
        }
    }
}

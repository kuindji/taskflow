import SwiftUI

/// Port of components/shared/PiOptions.tsx. Thinking is a typed AppSelect<PiThinkingLevel>
/// over the six reasoning levels.
struct PiOptionsView: View {
    @Binding var model: String
    @Binding var thinking: PiThinkingLevel
    @Binding var tools: String
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(
                label: mode == .defaults ? "Default Model" : "Model",
                hint: mode == .defaults
                    ? "Pre-selected model when running Pi sessions"
                    : "Model for Pi session (--model)"
            ) {
                PiModelSelect(value: $model)
            }
            SettingRow(
                label: mode == .defaults ? "Default Thinking" : "Thinking",
                hint: mode == .defaults
                    ? "Default reasoning level for supported models"
                    : "Reasoning level (--thinking)"
            ) {
                AppSelect($thinking, options: [
                    (.off, "Off"), (.minimal, "Minimal"), (.low, "Low"),
                    (.medium, "Medium"), (.high, "High"), (.xhigh, "Xhigh"),
                ])
            }
            SettingRow(
                label: mode == .defaults ? "Default Tools" : "Tools",
                hint: mode == .defaults
                    ? "Comma-separated list of built-in tools to enable"
                    : "Comma-separated list of built-in tools (--tools)"
            ) {
                AppTextField(text: $tools, placeholder: "read,bash,edit,write,grep,find,ls")
            }
        }
    }
}

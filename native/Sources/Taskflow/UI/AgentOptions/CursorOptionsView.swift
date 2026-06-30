import SwiftUI

/// Port of components/shared/CursorOptions.tsx. Presentational: binds to typed values;
/// the consumer (5D/5E) owns serialization to CursorLaunchOptions.
struct CursorOptionsView: View {
    @Binding var model: String
    @Binding var yolo: Bool
    var mode: AgentOptionsMode = .session

    var body: some View {
        VStack(spacing: 0) {
            SettingRow(
                label: mode == .defaults ? "Default Model" : "Model",
                hint: mode == .defaults
                    ? "Pre-selected model when running Cursor sessions"
                    : "Model for Cursor session"
            ) {
                CursorModelSelect(value: $model)
            }
            SettingRow(
                label: "Yolo",
                hint: mode == .defaults
                    ? "Run in yolo mode by default (auto-approve commands)"
                    : "Auto-approve commands (--yolo)"
            ) {
                AppToggle(title: yolo ? "Enabled" : "Disabled", isOn: $yolo)
            }
        }
    }
}

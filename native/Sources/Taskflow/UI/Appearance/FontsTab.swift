import SwiftUI

// Port of packages/ui/src/components/appearance/FontsTab.tsx
// Three sections — Workspace (general), Terminal, Editor — each with a
// FontFamilySelect and a validated size field (8–32).  "Reset to defaults"
// sends FontResetPatch so the backend re-expands nulls to defaults.
struct FontsTab: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        if let vm = env.settings, let s = vm.settings {
            VStack(alignment: .leading, spacing: 16) {
                fontSection(
                    "Workspace",
                    family: Binding(
                        get: { s.general.fontFamily },
                        set: { persist(GeneralPatch(fontFamily: $0)) }
                    ),
                    size: s.general.fontSize,
                    onSize: { persist(GeneralPatch(fontSize: $0)) }
                )
                Divider()
                fontSection(
                    "Terminal",
                    family: Binding(
                        get: { s.terminal.fontFamily },
                        set: { persist(TerminalPatch(fontFamily: $0)) }
                    ),
                    size: s.terminal.fontSize,
                    onSize: { persist(TerminalPatch(fontSize: $0)) }
                )
                Divider()
                fontSection(
                    "Editor",
                    family: Binding(
                        get: { s.editor.fontFamily },
                        set: { persist(EditorPatch(fontFamily: $0)) }
                    ),
                    size: s.editor.fontSize,
                    onSize: { persist(EditorPatch(fontSize: $0)) }
                )
                AppButton(title: "Reset to defaults", kind: .secondary) {
                    Task { await env.settings?.updateSettings(FontResetPatch()) }
                }
            }
        }
    }

    // MARK: - Section builder

    @ViewBuilder
    private func fontSection(
        _ title: String,
        family: Binding<String>,
        size: Double,
        onSize: @escaping (Double) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.color(.foreground))
            SettingRow(label: "Font family") {
                FontFamilySelect(value: family)
                    .frame(width: 220)
            }
            SettingRow(label: "Font size") {
                // Computed binding: get always reflects persisted settings;
                // set parses to Int and persists only when the value is in 8...32
                // (mirrors TS: type=number min=8 max=32, skip if NaN or <= 0).
                AppTextField(
                    text: Binding(
                        get: { String(Int(size)) },
                        set: { raw in
                            guard let parsed = Int(raw), (8 ... 32).contains(parsed) else { return }
                            onSize(Double(parsed))
                        }
                    ),
                    placeholder: "Size"
                )
                .frame(width: 80)
            }
        }
    }

    // MARK: - Persist helpers

    private func persist(_ g: GeneralPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(general: g)) }
    }

    private func persist(_ t: TerminalPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(terminal: t)) }
    }

    private func persist(_ e: EditorPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(editor: e)) }
    }
}

import SwiftUI

// Port of packages/ui/src/components/settings/sections/RemoteSection.tsx
// Rows: Auto Start, App Name, Headless (all bound via RemoteAgentPatch),
// and Status with green dot + Start/Stop button driven by SettingsCatalogViewModel.
struct RemoteSection: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        if let settings = env.settings, let s = settings.settings {
            VStack(alignment: .leading, spacing: 0) {
                SettingRow(
                    label: "Auto Start",
                    hint: "Start remote agent when Taskflow launches"
                ) {
                    AppToggle(
                        title: "Auto Start",
                        isOn: Binding(
                            get: { s.remoteAgent.autoStart },
                            set: { persist(RemoteAgentPatch(autoStart: $0)) }
                        )
                    )
                }

                SettingRow(
                    label: "App Name",
                    hint: "Display name for this instance on remote apps"
                ) {
                    AppTextField(
                        text: Binding(
                            get: { s.remoteAgent.appName },
                            set: { persist(RemoteAgentPatch(appName: $0)) }
                        ),
                        placeholder: "Auto-generated"
                    )
                }

                SettingRow(
                    label: "Headless",
                    hint: "Run without showing a session tab"
                ) {
                    AppToggle(
                        title: "Headless",
                        isOn: Binding(
                            get: { s.remoteAgent.headless },
                            set: { persist(RemoteAgentPatch(headless: $0)) }
                        )
                    )
                }

                statusRow
            }
        } else {
            Text("Loading...")
                .foregroundStyle(theme.color(.mutedForeground))
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        let running = env.settingsCatalog?.remoteRunning == true
        SettingRow(
            label: "Status",
            hint: running ? "Remote agent is running" : "Remote agent is stopped"
        ) {
            HStack(spacing: 8) {
                if running {
                    Circle()
                        .fill(theme.success)
                        .frame(width: 8, height: 8)
                }
                AppButton(title: running ? "Stop" : "Start", kind: .secondary) {
                    Task {
                        if running {
                            await env.settingsCatalog?.stopRemote()
                        } else {
                            await env.settingsCatalog?.startRemote()
                        }
                    }
                }
            }
        }
    }

    private func persist(_ p: RemoteAgentPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(remoteAgent: p)) }
    }
}

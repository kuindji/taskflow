import AppKit
import SwiftUI

// Port of packages/ui/src/components/settings/sections/GeneralSection.tsx
// and SettingsModal conflict-handling logic.
struct GeneralSection: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var migrating = false
    @State private var conflictPath: String?
    @State private var migrationError: String?

    var body: some View {
        if let settings = env.settings {
            VStack(alignment: .leading, spacing: 0) {
                dataDirSection(settings: settings)
                Divider().padding(.vertical, 8)
                askBeforeExitSection(settings: settings)
            }
        } else {
            Text("Loading...")
                .foregroundStyle(theme.color(.mutedForeground))
        }
    }

    // MARK: - Data Folder

    @ViewBuilder
    private func dataDirSection(settings: SettingsViewModel) -> some View {
        let info = settings.dataDirInfo

        VStack(alignment: .leading, spacing: 6) {
            Text("Data Folder")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.color(.foreground))

            // Path display
            Text(info?.dataDir ?? "Loading...")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(theme.color(.mutedForeground))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Error display
            if let error = migrationError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.destructive)
            }

            HStack(spacing: 8) {
                AppButton(title: migrating ? "Moving…" : "Change", kind: .secondary) {
                    guard !migrating else { return }
                    guard let url = pickDirectory() else { return }
                    let path = url.path
                    migrating = true
                    Task {
                        defer { migrating = false }
                        do {
                            let info = try await settings.updateDataDir(path: path)
                            if info.conflict == true {
                                conflictPath = path
                            }
                        } catch {
                            migrationError = error.localizedDescription
                            scheduleClearError()
                        }
                    }
                }

                if let info, !info.isDefault {
                    AppButton(title: "Reset", kind: .secondary) {
                        guard !migrating else { return }
                        migrating = true
                        Task {
                            defer { migrating = false }
                            do {
                                try await settings.updateDataDir(path: info.baseDir)
                            } catch {
                                migrationError = error.localizedDescription
                                scheduleClearError()
                            }
                        }
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .alert("Existing Data Found", isPresented: Binding(
            get: { conflictPath != nil },
            set: { if !$0 { conflictPath = nil } }
        )) {
            Button("Overwrite", role: .destructive) {
                resolveConflict(path: conflictPath, mode: .overwrite, settings: settings)
            }
            Button("Use Existing") {
                resolveConflict(path: conflictPath, mode: .adopt, settings: settings)
            }
            Button("Cancel", role: .cancel) {
                conflictPath = nil
            }
        } message: {
            Text("The selected folder already contains Taskflow data. How would you like to proceed?")
        }
    }

    // MARK: - Ask Before Exit

    @ViewBuilder
    private func askBeforeExitSection(settings: SettingsViewModel) -> some View {
        if let appSettings = settings.settings {
            SettingRow(
                label: "Ask before exit",
                hint: "Show a confirmation prompt when quitting Taskflow."
            ) {
                AppToggle(
                    title: "Ask before exit",
                    isOn: Binding(
                        get: { appSettings.general.confirmBeforeExit },
                        set: { value in
                            Task {
                                await settings.updateSettings(
                                    SettingsPatch(general: GeneralPatch(confirmBeforeExit: value))
                                )
                            }
                        }
                    )
                )
            }
        }
    }

    // MARK: - Helpers

    @MainActor
    private func pickDirectory() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        return panel.runModal() == .OK ? panel.url : nil
    }

    private func resolveConflict(path: String?, mode: DataDirMode, settings: SettingsViewModel) {
        guard let path else { return }
        conflictPath = nil
        migrating = true
        Task {
            defer { migrating = false }
            do {
                try await settings.updateDataDir(path: path, mode: mode)
            } catch {
                migrationError = error.localizedDescription
                scheduleClearError()
            }
        }
    }

    private func scheduleClearError() {
        Task {
            try? await Task.sleep(for: .seconds(5))
            migrationError = nil
        }
    }
}

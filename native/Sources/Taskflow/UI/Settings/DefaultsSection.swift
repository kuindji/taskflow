import SwiftUI

// Port of packages/ui/src/components/settings/sections/DefaultsSection.tsx
struct DefaultsSection: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        if let settingsVM = env.settings,
           let s = settingsVM.settings,
           let catalog = env.settingsCatalog {
            content(settingsVM: settingsVM, catalog: catalog, settings: s)
        } else {
            Text("Loading…")
                .foregroundStyle(theme.color(.mutedForeground))
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func content(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            internalEditorRow(settingsVM: settingsVM, catalog: catalog, settings: settings)
            externalEditorRow(settingsVM: settingsVM, catalog: catalog, settings: settings)
            defaultAgentRow(settingsVM: settingsVM, catalog: catalog, settings: settings)
            toolbarAgentsSection(settingsVM: settingsVM, catalog: catalog, settings: settings)
            defaultShellRow(settingsVM: settingsVM, catalog: catalog, settings: settings)
            defaultRuntimeRow(settingsVM: settingsVM, catalog: catalog, settings: settings)
        }
    }

    // MARK: - Internal Editor

    @ViewBuilder
    private func internalEditorRow(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let options: [(value: String, label: String)] =
            [("monaco", "Monaco")] +
            catalog.editors.filter { $0.type == "internal" }.map { (value: $0.id, label: $0.name) }
        SettingRow(
            label: "Internal Editor",
            hint: "Opens files when clicking paths in the terminal"
        ) {
            AppSelect(
                Binding(
                    get: { settings.editor.internalEditor },
                    set: { val in persist(editor: EditorPatch(internalEditor: val), settingsVM: settingsVM) }
                ),
                options: options
            )
        }
    }

    // MARK: - External Editor

    @ViewBuilder
    private func externalEditorRow(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let options: [(value: String, label: String)] =
            [("system", "System Default")] +
            catalog.editors.filter { $0.type == "external" }.map { (value: $0.id, label: $0.name) }
        SettingRow(
            label: "External Editor",
            hint: "Opens files when Cmd+clicking paths in the terminal"
        ) {
            AppSelect(
                Binding(
                    get: { settings.editor.externalEditor },
                    set: { val in persist(editor: EditorPatch(externalEditor: val), settingsVM: settingsVM) }
                ),
                options: options
            )
        }
    }

    // MARK: - Default Agent

    @ViewBuilder
    private func defaultAgentRow(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let options: [(value: AgentType, label: String)] = RunMenuViewModel.allAgentTypes.map { agent in
            let name = RunMenuViewModel.displayName(agent)
            return (value: agent, label: catalog.isAvailable(agent) ? name : name + " (not installed)")
        }
        SettingRow(
            label: "Default Agent",
            hint: "Pre-selected for new tasks, titles, and commits"
        ) {
            AppSelect(
                Binding(
                    get: { settings.general.defaultAgent },
                    set: { val in persist(general: GeneralPatch(defaultAgent: val), settingsVM: settingsVM) }
                ),
                options: options
            )
        }
    }

    // MARK: - Toolbar Agents

    @ViewBuilder
    private func toolbarAgentsSection(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let availableAgents = RunMenuViewModel.allAgentTypes.filter { catalog.isAvailable($0) }
        VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Toolbar Agents")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.color(.foreground))
                Text("Favorited agents appear as buttons in the workspace toolbar")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.color(.mutedForeground))
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(availableAgents, id: \.self) { agent in
                AppToggle(
                    title: RunMenuViewModel.displayName(agent),
                    isOn: Binding(
                        get: { settings.general.favoriteAgents.contains(agent) },
                        set: { checked in
                            var updated = settings.general.favoriteAgents
                            if checked {
                                if !updated.contains(agent) { updated.append(agent) }
                            } else {
                                updated.removeAll { $0 == agent }
                            }
                            persist(general: GeneralPatch(favoriteAgents: updated), settingsVM: settingsVM)
                        }
                    )
                )
                .padding(.vertical, 2)
            }
        }
        .padding(.vertical, 6)
    }

    // MARK: - Default Shell

    @ViewBuilder
    private func defaultShellRow(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let systemLabel = catalog.systemShellPath.map { "System Default (\($0))" } ?? "System Default"
        let options: [(value: String, label: String)] =
            [("system", systemLabel)] +
            catalog.shells.map { (value: $0.path, label: $0.name) }
        SettingRow(
            label: "Default Shell",
            hint: "Default shell for new terminal tabs"
        ) {
            AppSelect(
                Binding(
                    get: { settings.terminal.defaultShell },
                    set: { val in persist(terminal: TerminalPatch(defaultShell: val), settingsVM: settingsVM) }
                ),
                options: options
            )
        }
    }

    // MARK: - Default Runtime

    @ViewBuilder
    private func defaultRuntimeRow(
        settingsVM: SettingsViewModel,
        catalog: SettingsCatalogViewModel,
        settings: AppSettings
    ) -> some View {
        let options: [(value: String, label: String)] =
            catalog.runtimes.map { rt in (value: rt.name, label: "\(rt.name) (\(rt.version))") }
        SettingRow(
            label: "Default Runtime",
            hint: "Runtime for executing scripts and commands"
        ) {
            AppSelect(
                Binding(
                    get: { settings.general.defaultRuntime },
                    set: { val in persist(general: GeneralPatch(defaultRuntime: val), settingsVM: settingsVM) }
                ),
                options: options
            )
        }
    }

    // MARK: - Persist helpers

    private func persist(editor patch: EditorPatch, settingsVM: SettingsViewModel) {
        Task { await settingsVM.updateSettings(SettingsPatch(editor: patch)) }
    }

    private func persist(general patch: GeneralPatch, settingsVM: SettingsViewModel) {
        Task { await settingsVM.updateSettings(SettingsPatch(general: patch)) }
    }

    private func persist(terminal patch: TerminalPatch, settingsVM: SettingsViewModel) {
        Task { await settingsVM.updateSettings(SettingsPatch(terminal: patch)) }
    }
}

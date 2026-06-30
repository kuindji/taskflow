import SwiftUI

// Port of packages/ui/src/components/settings/SettingsModal.tsx (chrome + nav).
struct SettingsDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme
    @State private var section: SettingsSection = .general

    private var sections: [SettingsSection] {
        var items = SettingsSection.allCases.filter { $0 != .remoteAgent }
        if env.settingsCatalog?.isAvailable(.claude) == true { items.append(.remoteAgent) }
        return items
    }

    var body: some View {
        HStack(spacing: 0) {
            // sidebar
            VStack(alignment: .leading, spacing: 2) {
                ForEach(sections, id: \.self) { s in
                    Button { section = s } label: {
                        Text(s.title)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(section == s ? theme.muted : .clear)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .frame(width: 148)
            .padding(8)
            Divider()
            // content
            ScrollView {
                content.padding(16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(width: 640, height: 460)
        .background(theme.background)
        .task {
            await env.settings?.fetchDataDir()
            await env.settingsCatalog?.loadCatalog()
        }
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .general:    GeneralSection()
        case .defaults:   DefaultsSection()
        case .claude:     AgentDefaultsSection(agent: .claude)
        case .codex:      AgentDefaultsSection(agent: .codex)
        case .opencode:   AgentDefaultsSection(agent: .opencode)
        case .gemini:     AgentDefaultsSection(agent: .gemini)
        case .cursor:     AgentDefaultsSection(agent: .cursor)
        case .pi:         AgentDefaultsSection(agent: .pi)
        case .remoteAgent: RemoteSection()
        }
    }
}

private enum SettingsSection: String, CaseIterable {
    case general, defaults, claude, codex, opencode, gemini, cursor, pi, remoteAgent
    var title: String {
        switch self {
        case .general:     "General"
        case .defaults:    "Defaults"
        case .claude:      "Claude"
        case .codex:       "Codex"
        case .opencode:    "OpenCode"
        case .gemini:      "Gemini"
        case .cursor:      "Cursor"
        case .pi:          "Pi"
        case .remoteAgent: "Remote Agent"
        }
    }
}

// MARK: - Stubs (replaced by real implementations in later tasks)

struct RemoteSection: View { var body: some View { EmptyView() } }          // STUB — replaced in Task 11

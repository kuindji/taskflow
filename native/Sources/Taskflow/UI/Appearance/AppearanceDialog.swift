import SwiftUI

// Port of packages/ui/src/components/appearance/AppearanceDialog.tsx (chrome + nav).
// Import (theme import) is deferred — 5E includes Themes and Fonts only.
struct AppearanceDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme
    @State private var section: AppearanceSection = .themes

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            HStack(spacing: 0) {
                // sidebar
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(AppearanceSection.allCases, id: \.self) { s in
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
        }
        .frame(width: 720, height: 460)
        .background(theme.background)
        .task {
            await env.themeCatalog?.load()
        }
    }

    private var header: some View {
        HStack {
            Text("Appearance")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                env.ui.toggleAppearance()
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .themes: ThemeGrid()
        case .fonts:  FontsTab()
        }
    }
}

private enum AppearanceSection: String, CaseIterable {
    case themes, fonts
    var title: String {
        switch self {
        case .themes: "Themes"
        case .fonts:  "Fonts"
        }
    }
}


import SwiftUI

// Port of packages/ui/src/components/appearance/ThemeGrid.tsx
struct ThemeGrid: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        if let catalog = env.themeCatalog {
            let activeId = ThemeCatalogViewModel.resolveActiveId(
                settingsTheme: env.settings?.settings?.appearance.theme,
                available: catalog.themes,
                fallback: env.themeStore.current.id
            )
            if catalog.themes.isEmpty {
                Text("No themes installed.").foregroundStyle(theme.muted)
            } else {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3),
                    spacing: 12
                ) {
                    ForEach(catalog.themes, id: \.id) { rec in
                        ThemeCard(record: rec, isActive: rec.id == activeId) {
                            Task {
                                await catalog.activate(rec.id, themeStore: env.themeStore, settings: env.settings)
                            }
                        }
                    }
                }
            }
        }
    }
}

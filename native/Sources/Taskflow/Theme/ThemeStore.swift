import SwiftUI

@MainActor
final class ThemeStore: ObservableObject {
    @Published private(set) var current: AppTheme
    let all: [AppTheme]

    init(defaultId: String = "catppuccin-mocha") {
        let files = ThemeStore.loadAllFiles()
        let themes = files.map(AppTheme.init).sorted { $0.id < $1.id }
        all = themes
        current = themes.first { $0.id == defaultId } ?? themes.first ?? .fallback
    }

    func select(id: String) {
        if let t = all.first(where: { $0.id == id }) { current = t }
    }

    nonisolated static func loadAllFiles() -> [ResolvedThemeFile] {
        guard let urls = Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: "themes")
        else { return [] }
        let dec = JSONDecoder()
        return urls.compactMap { try? dec.decode(ResolvedThemeFile.self, from: Data(contentsOf: $0)) }
    }

    nonisolated static func loadFile(id: String) throws -> ResolvedThemeFile {
        guard let url = Bundle.module.url(forResource: id, withExtension: "json", subdirectory: "themes")
        else { throw CocoaError(.fileNoSuchFile) }
        return try JSONDecoder().decode(ResolvedThemeFile.self, from: Data(contentsOf: url))
    }
}

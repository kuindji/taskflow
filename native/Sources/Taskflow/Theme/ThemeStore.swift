import SwiftUI
import Observation

@MainActor
@Observable
final class ThemeStore {
    private(set) var current: AppTheme
    @ObservationIgnored let all: [AppTheme]
    @ObservationIgnored private let fileMap: [String: ResolvedThemeFile]

    // Used only when no bundle theme files can be loaded (misconfiguration edge case).
    private static let hardcodedFallback = ResolvedThemeFile(
        id: "fallback", name: "Fallback",
        css: [:],
        xterm: XtermColors(
            background: "#1e1e2e", foreground: "#cdd6f4",
            cursor: "#f5e0dc", cursorAccent: "#1e1e2e",
            selectionBackground: "#585b70",
            black: "#45475a", red: "#f38ba8", green: "#a6e3a1",
            yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7",
            cyan: "#94e2d5", white: "#bac2de",
            brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1",
            brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7",
            brightCyan: "#94e2d5", brightWhite: "#a6adc8"
        )
    )

    init(defaultId: String = "catppuccin-mocha") {
        let files = ThemeStore.loadAllFiles()
        let themes = files.map(AppTheme.init).sorted { $0.id < $1.id }
        all = themes
        fileMap = Dictionary(uniqueKeysWithValues: files.map { ($0.id, $0) })
        current = themes.first { $0.id == defaultId } ?? themes.first ?? .fallback
    }

    /// Returns the `ResolvedThemeFile` backing the currently active theme.
    /// Falls back to the first available file, then to hardcoded Catppuccin Mocha
    /// defaults when the bundle contains no theme files.
    var currentFile: ResolvedThemeFile {
        fileMap[current.id] ?? fileMap.values.first ?? Self.hardcodedFallback
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

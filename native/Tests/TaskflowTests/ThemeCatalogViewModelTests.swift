import XCTest
@testable import Taskflow

@MainActor
final class ThemeCatalogViewModelTests: XCTestCase {
    private func rec(_ id: String, _ origin: ThemeOrigin) -> ThemeRecord {
        ThemeRecord(id: id, source: ThemeSource(version: 1, name: id, author: nil, origin: origin,
            colors: ThemeColors(foreground: "#fff", background: "#000", cursor: "#fff", cursorText: "#000",
                selection: "#333", selectionText: "#fff",
                ansi: AnsiColors(black: "#000", red: "#f00", green: "#0f0", yellow: "#ff0", blue: "#00f",
                    magenta: "#f0f", cyan: "#0ff", white: "#fff", brightBlack: "#111", brightRed: "#f00",
                    brightGreen: "#0f0", brightYellow: "#ff0", brightBlue: "#00f", brightMagenta: "#f0f",
                    brightCyan: "#0ff", brightWhite: "#fff")), overrides: nil))
    }

    func testBundledFilter() {
        let out = ThemeCatalogViewModel.bundled([rec("a", .bundled), rec("b", .imported), rec("c", .bundled)])
        XCTAssertEqual(out.map(\.id), ["a", "c"])
    }

    func testResolveActiveIdPrefersSettings() {
        let recs = [rec("dracula", .bundled), rec("nordic", .bundled)]
        XCTAssertEqual(ThemeCatalogViewModel.resolveActiveId(settingsTheme: "nordic", available: recs, fallback: "catppuccin-mocha"), "nordic")
    }

    func testResolveActiveIdFallsBackWhenMissing() {
        let recs = [rec("dracula", .bundled)]
        XCTAssertEqual(ThemeCatalogViewModel.resolveActiveId(settingsTheme: "ghost", available: recs, fallback: "catppuccin-mocha"), "catppuccin-mocha")
    }
}

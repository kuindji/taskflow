import XCTest
import SwiftUI
@testable import Taskflow

@MainActor
final class ThemeTests: XCTestCase {
    func testThemeStoreLoadsBundledThemes() {
        let store = ThemeStore()
        XCTAssertEqual(store.all.count, 14)
        XCTAssertTrue(store.all.contains { $0.id == "catppuccin-mocha" })
    }

    func testAppThemeExposesCssTokens() throws {
        let store = ThemeStore()
        store.select(id: "dracula")
        // Dracula background per its bundled colors.
        XCTAssertEqual(store.current.hex(.background).lowercased(), "#282a36")
    }

    func testGhosttyPairsIncludePalette() throws {
        let file = try ThemeStore.loadFile(id: "dracula")
        let pairs = GhosttyThemeConfig.pairs(from: file)
        XCTAssertTrue(pairs.contains { $0.0 == "background" })
        XCTAssertTrue(pairs.contains { $0.0 == "palette" && $0.1.hasPrefix("0=") })
        XCTAssertEqual(pairs.filter { $0.0 == "palette" }.count, 16)
    }
}

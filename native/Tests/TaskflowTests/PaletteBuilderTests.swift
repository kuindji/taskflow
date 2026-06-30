import XCTest
@testable import Taskflow

final class PaletteBuilderTests: XCTestCase {
    private func action(_ id: String, _ name: String, _ type: SessionType = .claude) -> ActionDefinition {
        ActionDefinition(id: id, projectId: nil, name: name, prompt: "", sessionType: type,
                         agentOptions: nil, standalone: true, createdAt: "", updatedAt: "")
    }

    func testEmptyQueryShowsAllInNaturalOrder() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review"), action("a2", "Plan")],
            scripts: ["test": "vitest", "build": "tsc"],
            online: true, defaultRuntime: "bun", query: "")
        XCTAssertEqual(g.map(\.title), ["Actions", "package.json"])
        XCTAssertEqual(g[0].rows.map(\.label), ["Review", "Plan"])      // action input order
        XCTAssertEqual(g[1].rows.map(\.label), ["build", "test"])        // scripts sorted asc
        XCTAssertEqual(g[1].rows[0].detail, "bun")
    }

    func testOfflineDisablesActionsAndSetsDetail() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review")], scripts: [:],
            online: false, defaultRuntime: "bun", query: "")
        XCTAssertTrue(g[0].rows[0].disabled)
        XCTAssertEqual(g[0].rows[0].detail, "offline")
    }

    func testQueryFiltersAndSortsByScore() {
        let g = PaletteBuilder.buildGroups(
            actions: [action("a1", "Review"), action("a2", "Refactor"), action("a3", "Plan")],
            scripts: [:], online: true, defaultRuntime: "bun", query: "re")
        let labels = g[0].rows.map(\.label)
        XCTAssertEqual(Set(labels), ["Review", "Refactor"])   // "Plan" dropped
        XCTAssertFalse(g[0].rows[0].indices.isEmpty)          // highlight indices set
    }

    func testEmptyGroupsAreDropped() {
        let g = PaletteBuilder.buildGroups(
            actions: [], scripts: ["build": "tsc"],
            online: true, defaultRuntime: "bun", query: "build")
        XCTAssertEqual(g.map(\.title), ["package.json"])      // no Actions group
    }
}

import XCTest
@testable import Taskflow

final class SidebarReorderTests: XCTestCase {
    func testHiddenSlotsPreserved() {
        // full = [a,b,c,d]; b is hidden; visible reordered = [c,a,d]
        let out = SidebarReorder.buildReorderedProjectIds(
            fullIds: ["a", "b", "c", "d"], visibleIdsInNewOrder: ["c", "a", "d"])
        XCTAssertEqual(out, ["c", "b", "a", "d"]) // b keeps its absolute index 1
    }
    func testAllVisibleIsPlainReorder() {
        XCTAssertEqual(
            SidebarReorder.buildReorderedProjectIds(fullIds: ["a", "b", "c"], visibleIdsInNewOrder: ["c", "b", "a"]),
            ["c", "b", "a"])
    }
}

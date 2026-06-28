import XCTest
@testable import Taskflow

final class SidebarNavigationTests: XCTestCase {
    private let items: [SidebarFocusedItem] = [
        .init(type: .project, id: "p1"),
        .init(type: .task, id: "t1"),
        .init(type: .project, id: "p2"),
    ]

    func testDownFromNil() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: nil, direction: .down), items[0])
    }

    func testDownAndUp() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[0], direction: .down), items[1])
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[1], direction: .up), items[0])
    }

    // TS clamp: nextIdx < 0 or >= length → return early (item unchanged).
    // Swift reducer mirrors: clamp to ends instead of wrapping.
    func testClampAtEnds() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[2], direction: .down), items[2])
        XCTAssertEqual(SidebarNavigation.next(items: items, current: items[0], direction: .up), items[0])
    }

    func testEmptyItems() {
        XCTAssertNil(SidebarNavigation.next(items: [], current: nil, direction: .down))
        XCTAssertNil(SidebarNavigation.next(items: [], current: nil, direction: .up))
    }

    func testUpFromNilReturnsLast() {
        XCTAssertEqual(SidebarNavigation.next(items: items, current: nil, direction: .up), items[2])
    }

    func testCurrentNotFoundReturnsFirst() {
        let ghost = SidebarFocusedItem(type: .task, id: "unknown")
        // Current not in list — falls back to first for down, last for up (mirrors TS nil-current logic)
        XCTAssertEqual(SidebarNavigation.next(items: items, current: ghost, direction: .down), items[0])
        XCTAssertEqual(SidebarNavigation.next(items: items, current: ghost, direction: .up), items[2])
    }
}

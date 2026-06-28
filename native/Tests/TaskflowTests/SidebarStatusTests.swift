import XCTest
@testable import Taskflow

final class SidebarStatusTests: XCTestCase {
    func testAggregatePriority() {
        XCTAssertEqual(SidebarStatus.aggregate([.working, .attention, .initializing]), .attention)
        XCTAssertEqual(SidebarStatus.aggregate([.working, .initializing]), .working)
        XCTAssertEqual(SidebarStatus.aggregate([.initializing]), .initializing)
        XCTAssertNil(SidebarStatus.aggregate([nil, nil]))
        XCTAssertNil(SidebarStatus.aggregate([]))
    }
    func testProjectLooksUpBySessionId() {
        let map: [String: SessionStatus] = ["s1": .working, "s2": .attention]
        XCTAssertEqual(SidebarStatus.project(sessionIds: ["s1", "s2"]) { map[$0] }, .attention)
        XCTAssertEqual(SidebarStatus.project(sessionIds: ["s1"]) { map[$0] }, .working)
        XCTAssertNil(SidebarStatus.project(sessionIds: ["x"]) { map[$0] })
    }
    func testRollupCombinesProjectAndTasks() {
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: .working, taskStatuses: [.attention]), .attention)
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: nil, taskStatuses: [.working, nil]), .working)
        XCTAssertEqual(SidebarStatus.rollup(projectStatus: .initializing, taskStatuses: [nil]), .initializing)
        XCTAssertNil(SidebarStatus.rollup(projectStatus: nil, taskStatuses: [nil]))
    }
}

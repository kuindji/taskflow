import XCTest
@testable import Taskflow

final class WorkspaceKeyTests: XCTestCase {
    func testRightAndBase() {
        let k = WorkspaceKey.task("abc")
        XCTAssertEqual(k, "task:abc")
        XCTAssertEqual(WorkspaceKey.right(k), "task:abc:right")
        XCTAssertTrue(WorkspaceKey.isRight("task:abc:right"))
        XCTAssertFalse(WorkspaceKey.isRight("task:abc"))
        XCTAssertEqual(WorkspaceKey.base("task:abc:right"), "task:abc")
        XCTAssertEqual(WorkspaceKey.base("task:abc"), "task:abc")
    }

    func testProjectKey() {
        XCTAssertEqual(WorkspaceKey.project("xyz"), "project:xyz")
    }

    func testMasterKey() {
        XCTAssertEqual(WorkspaceKey.master, "master")
    }
}

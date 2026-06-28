import XCTest
@testable import Taskflow

final class FileMoveTests: XCTestCase {
    func testRejectsMoveOntoSelf() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a", dest: "/r/a"))
    }
    func testRejectsMoveIntoOwnSubtree() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a", dest: "/r/a/b"))
    }
    func testRejectsMoveIntoCurrentParent() {
        XCTAssertFalse(FileTreeRow.canMove(source: "/r/a/x.txt", dest: "/r/a"))
    }
    func testAllowsValidMove() {
        XCTAssertTrue(FileTreeRow.canMove(source: "/r/a/x.txt", dest: "/r/b"))
    }
}

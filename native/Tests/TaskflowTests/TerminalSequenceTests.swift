import XCTest
@testable import Taskflow

final class TerminalSequenceTests: XCTestCase {
    typealias Chunk = (seq: Int, data: String)
    func testDropsChunksAtOrBeforeLastSequence() {
        let r = TerminalSessionBridge.reconcile(
            pending: [(1, "a"), (2, "b"), (3, "c")], lastSequence: 2)
        XCTAssertEqual(r.apply, ["c"])
        XCTAssertTrue(r.keep.isEmpty)
    }
    func testAppliesInSequenceOrderRegardlessOfArrival() {
        let r = TerminalSessionBridge.reconcile(
            pending: [(3, "c"), (1, "a"), (2, "b")], lastSequence: 0)
        XCTAssertEqual(r.apply, ["a", "b", "c"])
    }
    func testEmptyPendingIsNoOp() {
        let r = TerminalSessionBridge.reconcile(pending: [], lastSequence: 5)
        XCTAssertTrue(r.apply.isEmpty)
        XCTAssertTrue(r.keep.isEmpty)
    }

    func testHistoryPayloadIncludesTaskOwner() {
        let payload = TerminalSessionBridge.historyPayload(sessionId: "s1", workspaceKey: "task:t1")
        XCTAssertEqual(payload["sessionId"] as? String, "s1")
        XCTAssertEqual(payload["taskId"] as? String, "t1")
    }

    func testHistoryPayloadIncludesProjectOwnerForRightPane() {
        let payload = TerminalSessionBridge.historyPayload(sessionId: "s1", workspaceKey: "project:p1:right")
        XCTAssertEqual(payload["projectId"] as? String, "p1")
    }

    func testHistoryPayloadIncludesMasterOwner() {
        let payload = TerminalSessionBridge.historyPayload(sessionId: "s1", workspaceKey: "master")
        XCTAssertEqual(payload["master"] as? Bool, true)
    }
}

import XCTest
@testable import Taskflow

final class MessageTypeTests: XCTestCase {
    func testKnownWireValues() {
        XCTAssertEqual(MessageType.taskList.rawValue, "task:list")
        XCTAssertEqual(MessageType.taskCreated.rawValue, "task:created")
        XCTAssertEqual(MessageType.systemInfo.rawValue, "system:info")
    }

    func testRoundTripFromRaw() {
        XCTAssertEqual(MessageType(rawValue: "task:updated"), .taskUpdated)
    }
}

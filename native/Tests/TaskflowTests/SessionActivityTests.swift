import XCTest
@testable import Taskflow

@MainActor
final class SessionActivityTests: XCTestCase {
    // terminal:output while "initializing" → transition straight to "working"
    func testInitializingToWorkingOnOutput() {
        XCTAssertEqual(SessionActivity.nextStatus(current: .initializing, isInteracting: false, usesActivity: true), .working)
    }
    // terminal:output while the user is actively typing → no status change
    func testNoChangeWhileInteracting() {
        XCTAssertNil(SessionActivity.nextStatus(current: .working, isInteracting: true, usesActivity: true))
    }
    // terminal:output for a session whose type does not use activity status → no change
    func testNoChangeWhenNotActivityType() {
        XCTAssertNil(SessionActivity.nextStatus(current: nil, isInteracting: false, usesActivity: false))
    }
    // terminal:output while idle on an activity session not yet "working" → "working"
    func testIdleOutputBecomesWorking() {
        XCTAssertEqual(SessionActivity.nextStatus(current: nil, isInteracting: false, usesActivity: true), .working)
    }
    // already "working" → leave as-is (nil = "no write needed")
    func testAlreadyWorkingNoWrite() {
        XCTAssertNil(SessionActivity.nextStatus(current: .working, isInteracting: false, usesActivity: true))
    }
}

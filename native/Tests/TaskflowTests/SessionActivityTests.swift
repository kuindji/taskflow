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

    // MARK: - interaction suppression (500ms time window, ports session-activity.ts)

    // within INTERACTION_SUPPRESSION_MS of the last interaction → still interacting
    func testInteractingWithinWindow() {
        let activity = SessionActivity()
        let t0 = Date(timeIntervalSince1970: 1000)
        activity.markInteraction("s1", at: t0)
        XCTAssertTrue(activity.isInteracting("s1", now: t0.addingTimeInterval(0.4)))
    }

    // once the window has elapsed → no longer interacting
    func testNotInteractingAfterWindow() {
        let activity = SessionActivity()
        let t0 = Date(timeIntervalSince1970: 1000)
        activity.markInteraction("s1", at: t0)
        XCTAssertFalse(activity.isInteracting("s1", now: t0.addingTimeInterval(0.5)))
    }

    // never marked → not interacting
    func testNotInteractingWhenNeverMarked() {
        let activity = SessionActivity()
        XCTAssertFalse(activity.isInteracting("s1", now: Date()))
    }

    // cleared → not interacting even within the window
    func testNotInteractingAfterClear() {
        let activity = SessionActivity()
        let t0 = Date(timeIntervalSince1970: 1000)
        activity.markInteraction("s1", at: t0)
        activity.clearInteraction("s1")
        XCTAssertFalse(activity.isInteracting("s1", now: t0.addingTimeInterval(0.1)))
    }
}

import XCTest
@testable import Taskflow

final class SessionBadgeTests: XCTestCase {
    func testColorTokenByType() {
        XCTAssertEqual(SessionBadge.colorToken(forType: "claude"), .primary)
        XCTAssertEqual(SessionBadge.colorToken(forType: "cursor"), .cursorAgent)
        XCTAssertEqual(SessionBadge.colorToken(forType: "shell"), .mutedForeground)
        XCTAssertEqual(SessionBadge.colorToken(forType: "codex"), .foreground)
        XCTAssertEqual(SessionBadge.colorToken(forType: "anything-else"), .foreground) // default branch
    }
    func testDotToken() {
        XCTAssertEqual(SessionBadge.dotToken(for: .working), .success)
        XCTAssertEqual(SessionBadge.dotToken(for: .attention), .warning)
        XCTAssertEqual(SessionBadge.dotToken(for: .initializing), .mutedForeground)
        XCTAssertNil(SessionBadge.dotToken(for: nil))
    }
}

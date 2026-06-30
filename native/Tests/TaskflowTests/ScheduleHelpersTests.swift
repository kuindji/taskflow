import XCTest
@testable import Taskflow

final class ScheduleHelpersTests: XCTestCase {
    func testNormalizeTimeoutFallback() {
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout(""), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("0"), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("-5"), 30)
        XCTAssertEqual(ScheduleHelpers.normalizeTimeout("45"), 45)
    }
    func testCronPreviewIsNil() {
        XCTAssertNil(ScheduleHelpers.computeNextRunPreview(expression: "0 */6 * * *", expressionType: "cron", now: Date(timeIntervalSince1970: 0)))
    }
    func testRatePreviewNonNil() {
        XCTAssertNotNil(ScheduleHelpers.computeNextRunPreview(expression: "rate(30 minutes)", expressionType: "rate", now: Date(timeIntervalSince1970: 0)))
    }
    func testRatePreviewBadFormatNil() {
        XCTAssertNil(ScheduleHelpers.computeNextRunPreview(expression: "every 5 mins", expressionType: "rate", now: Date()))
    }
    func testRelativeTimeNever() {
        XCTAssertEqual(ScheduleHelpers.formatRelativeTime(nil, now: Date()), "Never")
    }
    func testRelativeTimeHoursAgo() {
        let now = Date(timeIntervalSince1970: 100_000)
        let twoHoursAgo = ISO8601DateFormatter().string(from: now.addingTimeInterval(-7200))
        XCTAssertEqual(ScheduleHelpers.formatRelativeTime(twoHoursAgo, now: now), "2h ago")
    }
    func testStatus() {
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: "s", lastError: nil), .running)
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: nil, lastError: "boom"), .error)
        XCTAssertEqual(ScheduleHelpers.scheduleStatus(runningSessionId: nil, lastError: nil), .idle)
    }
    func testDirtyKeyStableForSameInput() {
        let a = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: false)
        let b = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: false)
        XCTAssertEqual(a, b)
    }
    func testDirtyKeyUseActionDropsPromptAndAgent() {
        let withPrompt = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "a1", prompt: "do", expression: "rate(5 minutes)", expressionType: "rate", agentType: "claude", agentOptions: nil, timeout: "30", useAction: true)
        let noPrompt = ScheduleHelpers.dirtyKey(includeProjectId: false, projectId: "p", name: "n", actionId: "a1", prompt: "DIFFERENT", expression: "rate(5 minutes)", expressionType: "rate", agentType: "gemini", agentOptions: nil, timeout: "30", useAction: true)
        XCTAssertEqual(withPrompt, noPrompt)  // prompt + agentType ignored when useAction
    }
}

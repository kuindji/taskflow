import XCTest
@testable import Taskflow

final class ScheduleViewModelTests: XCTestCase {
    private func mk(_ id: String, name: String = "n") -> Schedule {
        Schedule(id: id, projectId: "p", name: name, prompt: "x", actionId: nil, agentType: nil,
                 agentOptions: nil, expression: "rate(5 minutes)", expressionType: "rate", timeout: 30,
                 enabled: true, lastRunAt: nil, lastError: nil, nextRunAt: nil, runningSessionId: nil,
                 createdAt: "t", updatedAt: "t")
    }

    func testUpsertAppendsNew() {
        let out = ScheduleViewModel.upsert([mk("a")], mk("b"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    func testUpsertReplacesExisting() {
        let out = ScheduleViewModel.upsert([mk("a", name: "old")], mk("a", name: "new"))
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].name, "new")
    }

    func testRemove() {
        XCTAssertEqual(ScheduleViewModel.remove([mk("a"), mk("b")], id: "a").map(\.id), ["b"])
    }
}

import XCTest
@testable import Taskflow

// Test-only factory for TaskLogEntry — keeps production types clean.
private extension TaskLogEntry {
    static func sample(id: String) -> TaskLogEntry {
        TaskLogEntry(
            id: id,
            sessionId: "s",
            timestamp: "2024-01-01T00:00:00Z",
            type: .info,
            message: "msg",
            meta: nil
        )
    }
}

@MainActor
final class TaskViewModelTests: XCTestCase {
    private func task(_ id: String, _ title: String = "t", status: String = "active") -> TaskItem {
        TaskItem(
            id: id, projectId: "p", parentId: nil, title: title, description: "",
            notes: "", worktree: TaskWorktree(enabled: false, path: nil, branch: nil, pr: nil),
            sessions: [], createdAt: "0", status: status, archivedAt: nil, pinned: false,
            initCommand: nil
        )
    }

    func testUpsertUpdatedReplacesInPlace() {
        let start = [task("a", "old"), task("b")]
        let out = TaskViewModel.upsertUpdated(start, task("a", "new"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])       // order preserved
        XCTAssertEqual(out.first?.title, "new")          // replaced
    }

    func testUpsertUpdatedAppendsUnknown() {
        let out = TaskViewModel.upsertUpdated([task("a")], task("z"))
        XCTAssertEqual(out.map(\.id), ["a", "z"])
    }

    func testInsertCreatedDedupes() {
        let start = [task("a")]
        XCTAssertEqual(TaskViewModel.insertCreated(start, task("a")).map(\.id), ["a"]) // no dup
        XCTAssertEqual(TaskViewModel.insertCreated(start, task("b")).map(\.id), ["a", "b"])
    }

    func testAppendLogCreatesAndAppends() {
        let e1 = TaskLogEntry.sample(id: "1")
        let one = TaskViewModel.appendLog([:], taskId: "t", entry: e1)
        XCTAssertEqual(one["t"]?.count, 1)
        let e2 = TaskLogEntry.sample(id: "2")
        let two = TaskViewModel.appendLog(one, taskId: "t", entry: e2)
        XCTAssertEqual(two["t"]?.map(\.id), ["1", "2"])
    }
}

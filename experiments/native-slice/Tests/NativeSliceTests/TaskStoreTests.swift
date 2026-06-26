import XCTest
@testable import NativeSlice

final class TaskStoreTests: XCTestCase {
    private func task(_ id: String, _ created: String, _ title: String = "t") -> TaskItem {
        TaskItem(id: id, projectId: "p", title: title, status: "active", createdAt: created)
    }

    func testUpsertAddsNewTask() {
        let result = TaskReducer.upsert([task("a", "2026-01-01")], task("b", "2026-01-02"))
        XCTAssertEqual(result.map(\.id).sorted(), ["a", "b"])
    }

    func testUpsertReplacesExistingById() {
        let result = TaskReducer.upsert([task("a", "2026-01-01", "old")], task("a", "2026-01-01", "new"))
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.first?.title, "new")
    }

    func testSortNewestFirst() {
        let sorted = TaskReducer.sortedByCreatedDesc([task("a", "2026-01-01"), task("b", "2026-02-01")])
        XCTAssertEqual(sorted.map(\.id), ["b", "a"])
    }

    func testDecodeTaskListResponseIgnoresExtraKeys() throws {
        let json = #"{"tasks":[{"id":"t1","projectId":"p1","title":"Build","status":"active","createdAt":"2026-06-26T00:00:00Z","notes":"ignored","pinned":false}]}"#
        struct Resp: Codable { let tasks: [TaskItem] }
        let resp = try JSONDecoder().decode(Resp.self, from: Data(json.utf8))
        XCTAssertEqual(resp.tasks.first?.title, "Build")
    }
}

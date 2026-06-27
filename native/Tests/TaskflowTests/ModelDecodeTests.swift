import XCTest
@testable import Taskflow

final class ModelDecodeTests: XCTestCase {
    func testTaskListResponseDecodes() throws {
        // Shape matches a real `task:list` response payload.
        let json = """
        {"tasks":[{"id":"t1","projectId":"p1","title":"Demo","description":"",
        "notes":"","worktree":{"enabled":false},"sessions":[],
        "createdAt":"2026-06-27T00:00:00.000Z","status":"active",
        "archivedAt":null,"pinned":false}]}
        """.data(using: .utf8)!
        struct Resp: Codable { let tasks: [TaskItem] }
        let resp = try JSONDecoder().decode(Resp.self, from: json)
        XCTAssertEqual(resp.tasks.count, 1)
        XCTAssertEqual(resp.tasks[0].id, "t1")
        XCTAssertEqual(resp.tasks[0].status, "active")
        XCTAssertNil(resp.tasks[0].archivedAt ?? nil)
    }

    func testSessionStatusEnumDecodes() throws {
        let v = try JSONDecoder().decode(SessionStatus.self, from: "\"working\"".data(using: .utf8)!)
        XCTAssertEqual(v, .working)
    }
}

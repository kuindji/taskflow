import XCTest
@testable import Taskflow

@MainActor
final class NotificationViewModelTests: XCTestCase {
    // Disambiguate from Foundation.Notification — Taskflow.Notification is our generated type.
    private typealias TFNotification = Taskflow.Notification
    private func note(_ id: String, read: Bool = false, at: String = "0") -> TFNotification {
        TFNotification(id: id, projectId: "p", sessionId: "s", taskId: nil,
                       message: "m", read: read, createdAt: at)
    }
    func testUpsertReplacesInPlaceElseAppends() {
        let start = [note("a", at: "1"), note("b", at: "2")]
        let replaced = NotificationViewModel.upsert(start, note("a", read: true, at: "1"))
        XCTAssertEqual(replaced.map(\.id), ["a", "b"])
        XCTAssertTrue(replaced.first { $0.id == "a" }?.read ?? false)
        let appended = NotificationViewModel.upsert(start, note("c", at: "3"))
        XCTAssertEqual(appended.map(\.id), ["a", "b", "c"])
    }
    func testRemove() {
        XCTAssertEqual(NotificationViewModel.remove([note("a"), note("b")], id: "a").map(\.id), ["b"])
    }
    func testMarkRead() {
        let out = NotificationViewModel.markRead([note("a")], id: "a")
        XCTAssertTrue(out.first?.read ?? false)
    }
    func testSortedNewestFirst() {
        let out = NotificationViewModel.sorted([note("a", at: "1"), note("b", at: "3"), note("c", at: "2")])
        XCTAssertEqual(out.map(\.id), ["b", "c", "a"]) // createdAt desc
    }
}

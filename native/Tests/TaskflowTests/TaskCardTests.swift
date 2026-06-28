import XCTest
@testable import Taskflow

@MainActor
final class TaskCardTests: XCTestCase {
    func testRequestNewTaskSetsRequest() {
        let vm = TaskCreationViewModel()
        vm.requestNewTask(projectId: "p1")
        XCTAssertEqual(vm.newTaskRequest, TaskCreationViewModel.NewTaskRequest(projectId: "p1", parentId: nil))
    }
    func testRequestNewSubtask() {
        let vm = TaskCreationViewModel()
        vm.requestNewSubtask(parentId: "t1", projectId: "p1")
        XCTAssertEqual(vm.newTaskRequest, TaskCreationViewModel.NewTaskRequest(projectId: "p1", parentId: "t1"))
    }
    func testClear() {
        let vm = TaskCreationViewModel()
        vm.requestNewProject()
        XCTAssertTrue(vm.newProjectRequested)
        vm.clear()
        XCTAssertNil(vm.newTaskRequest)
        XCTAssertFalse(vm.newProjectRequested)
    }

    // MARK: - TaskCard.displayTitle

    static func sample() -> TaskItem {
        TaskItem(id: "t", projectId: "p", parentId: nil, title: "", description: "",
                 notes: "", worktree: TaskWorktree(enabled: false, path: nil, branch: nil, pr: nil),
                 sessions: [], createdAt: "0", status: "active", archivedAt: nil, pinned: false, initCommand: nil)
    }
    static func with(_ t: TaskItem, title: String, description: String) -> TaskItem {
        TaskItem(id: t.id, projectId: t.projectId, parentId: t.parentId, title: title, description: description,
                 notes: t.notes, worktree: t.worktree, sessions: t.sessions, createdAt: t.createdAt,
                 status: t.status, archivedAt: t.archivedAt, pinned: t.pinned, initCommand: t.initCommand)
    }

    func testDisplayTitlePrefersTitle() {
        var t = Self.sample(); t = Self.with(t, title: "Real Title", description: "desc")
        XCTAssertEqual(TaskCard.displayTitle(t), "Real Title")
    }
    func testDisplayTitleFallsBackToTruncatedDescription() {
        let long = String(repeating: "x", count: 80)
        let t = Self.with(Self.sample(), title: "", description: long)
        let out = TaskCard.displayTitle(t)
        XCTAssertTrue(out.hasSuffix("…"))
        XCTAssertEqual(out.count, 51) // 50 chars + ellipsis
    }
    func testDisplayTitleShortDescriptionNoEllipsis() {
        let t = Self.with(Self.sample(), title: "", description: "short")
        XCTAssertEqual(TaskCard.displayTitle(t), "short")
    }
}

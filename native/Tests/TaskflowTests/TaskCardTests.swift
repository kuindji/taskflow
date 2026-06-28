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
}

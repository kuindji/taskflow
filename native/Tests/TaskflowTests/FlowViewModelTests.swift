import XCTest
@testable import Taskflow

@MainActor
final class FlowViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeRun(
        taskId: String? = nil,
        projectId: String? = nil,
        master: Bool? = nil,
        flowId: String = "flow1",
        status: FlowRunStatus = .running
    ) -> FlowRun {
        FlowRun(
            taskId: taskId, projectId: projectId, master: master,
            flowId: flowId, status: status,
            currentActionIndex: 0, actions: [], artifacts: [],
            inputValues: nil, startedAt: "2024-01-01T00:00:00Z", completedAt: nil
        )
    }

    private func makeClient() -> WSClient {
        WSClient(url: URL(string: "ws://localhost:0")!)
    }

    // MARK: - applyRunUpdate (static pure reducer)

    func testApplyRunUpdateInsertsNewRunByOwnerId() {
        let run = makeRun(taskId: "task1")
        let runs = FlowViewModel.applyRunUpdate([:], run)
        XCTAssertEqual(runs["task1"]?.flowId, "flow1")
        XCTAssertEqual(runs.count, 1)
    }

    func testApplyRunUpdateReplacesExistingForSameOwner() {
        let original = makeRun(taskId: "task1", flowId: "flow1")
        let updated = makeRun(taskId: "task1", flowId: "flow2", status: .paused)
        let runs = FlowViewModel.applyRunUpdate(["task1": original], updated)
        XCTAssertEqual(runs["task1"]?.flowId, "flow2")
        XCTAssertEqual(runs.count, 1)
    }

    func testApplyRunUpdateSkipsCompletedRunForUntrackedOwner() {
        // Completed run for an owner we were never tracking → no insertion
        // Matches TS: `if (run.status === "running" || run.status === "paused" || s.activeRuns[ownerId])`
        let run = makeRun(taskId: "task1", status: .completed)
        let runs = FlowViewModel.applyRunUpdate([:], run)
        XCTAssertTrue(runs.isEmpty)
    }

    func testApplyRunUpdateUpdatesTrackedOwnerEvenWhenCompleted() {
        // If we're already tracking the owner, we update regardless of the new status
        let original = makeRun(taskId: "task1", status: .running)
        let completed = makeRun(taskId: "task1", status: .completed)
        let runs = FlowViewModel.applyRunUpdate(["task1": original], completed)
        XCTAssertEqual(runs["task1"]?.status, .completed)
    }

    func testApplyRunUpdateOwnerIdFromProjectId() {
        let run = makeRun(projectId: "proj1")
        let runs = FlowViewModel.applyRunUpdate([:], run)
        XCTAssertEqual(runs["proj1"]?.flowId, "flow1")
    }

    func testApplyRunUpdateOwnerIdForMaster() {
        let run = makeRun(master: true)
        let runs = FlowViewModel.applyRunUpdate([:], run)
        XCTAssertEqual(runs["__master__"]?.flowId, "flow1")
    }

    // MARK: - onRunFocus closure (via receiveRunUpdate)

    func testOnRunFocusFiresWhenSet() {
        let vm = FlowViewModel(client: makeClient())
        var firedRun: FlowRun?
        vm.onRunFocus = { firedRun = $0 }
        let run = makeRun(taskId: "task1")
        vm.receiveRunUpdate(run)
        XCTAssertEqual(firedRun?.flowId, "flow1")
    }

    func testOnRunFocusDoesNotFireWhenNil() {
        let vm = FlowViewModel(client: makeClient())
        vm.onRunFocus = nil
        let run = makeRun(taskId: "task1")
        // Should not crash and should still update activeRuns
        vm.receiveRunUpdate(run)
        XCTAssertEqual(vm.activeRuns["task1"]?.flowId, "flow1")
    }

    func testReceiveRunUpdateUpdatesActiveRuns() {
        let vm = FlowViewModel(client: makeClient())
        let run = makeRun(taskId: "task1")
        vm.receiveRunUpdate(run)
        XCTAssertEqual(vm.activeRuns.count, 1)
        XCTAssertEqual(vm.activeRuns["task1"]?.status, .running)
    }

    // MARK: - Malformed (no-owner) runs — security: must not crash or mis-key

    func testOwnerIdReturnsNilWhenNoOwnerSet() {
        // taskId/projectId/master all unset → nil (not a trap, not "")
        let run = makeRun(taskId: nil, projectId: nil, master: nil)
        XCTAssertNil(run.ownerId())
    }

    func testApplyRunUpdateIgnoresRunWithNoOwner() {
        // A malformed run decoded from WS input must be a no-op — returns runs unchanged,
        // never bucketing it under a bogus "" key.
        let existing = makeRun(taskId: "task1")
        let start = ["task1": existing]
        let malformed = makeRun(taskId: nil, projectId: nil, master: nil)
        let out = FlowViewModel.applyRunUpdate(start, malformed)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out["task1"]?.flowId, "flow1")
        XCTAssertNil(out[""])  // no bogus empty-string key
    }

    func testReceiveRunUpdateSkipsRunWithNoOwnerAndDoesNotFireFocus() {
        let vm = FlowViewModel(client: makeClient())
        var fired = false
        vm.onRunFocus = { _ in fired = true }
        let malformed = makeRun(taskId: nil, projectId: nil, master: nil)
        vm.receiveRunUpdate(malformed)  // must not crash
        XCTAssertTrue(vm.activeRuns.isEmpty)  // activeRuns unchanged
        XCTAssertFalse(fired)                 // onRunFocus not fired
    }
}

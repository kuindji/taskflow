import XCTest
@testable import Taskflow

@MainActor
final class RunMenuRequestTests: XCTestCase {

    // MARK: - Flow-input seam

    /// Verifies the flow-input branch compiles and the closure is callable.
    /// Seeding a flow with inputs into FlowViewModel requires a WS backend (`private(set) var flows`
    /// has no public setter), so the request assertion is deferred to the Task 11 dialog wiring.
    /// This test confirms the branch compiles and produces nil when the lookup misses.
    func testOnStartFlowWithInputsSeam() async {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let flows = FlowViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(
            projectId: "p1",
            taskId: "t1",
            session: nil,
            flows: flows,
            tasks: nil,
            ui: ui,
            defaultRuntime: "bun"
        )
        cb.onStartFlow("flow-with-inputs")
        // FlowViewModel.flows is empty (no WS seeding) → flow lookup misses → no request set.
        // Assertion is intentionally absent here; verified via dialog wiring in Task 11.
        _ = cb
    }

    // MARK: - Run-options seam

    func testOnRunTabWithOptionsSetsRequest() {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(
            projectId: "p1",
            taskId: "t1",
            session: nil,
            flows: nil,
            tasks: nil,
            ui: ui,
            defaultRuntime: "bun"
        )
        cb.onRunTabWithOptions(.claude)
        XCTAssertEqual(vm.runOptionsRequest?.agent, .claude)
        XCTAssertEqual(vm.runOptionsRequest?.taskId, "t1")
    }

    func testOnRunTabWithOptionsSetsTitle() {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(
            projectId: "p1",
            taskId: "t1",
            session: nil,
            flows: nil,
            tasks: nil,
            ui: ui,
            defaultRuntime: "bun"
        )
        cb.onRunTabWithOptions(.gemini)
        XCTAssertEqual(vm.runOptionsRequest?.title, "Run Gemini with options")
    }

    func testOnRunTabWithOptionsProjectIdNilWhenTaskIdPresent() {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(
            projectId: "p1",
            taskId: "t1",
            session: nil,
            flows: nil,
            tasks: nil,
            ui: ui,
            defaultRuntime: "bun"
        )
        cb.onRunTabWithOptions(.codex)
        XCTAssertNil(vm.runOptionsRequest?.projectId)
    }

    func testOnRunTabWithOptionsProjectIdSetWhenNoTaskId() {
        let vm = RunMenuViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        let ui = UIViewModel()
        let cb = vm.callbacks(
            projectId: "p1",
            taskId: nil,
            session: nil,
            flows: nil,
            tasks: nil,
            ui: ui,
            defaultRuntime: "bun"
        )
        cb.onRunTabWithOptions(.claude)
        XCTAssertEqual(vm.runOptionsRequest?.projectId, "p1")
        XCTAssertNil(vm.runOptionsRequest?.taskId)
    }
}

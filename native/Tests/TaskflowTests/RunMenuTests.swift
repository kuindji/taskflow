import XCTest
@testable import Taskflow

// MARK: - Fixtures

private enum FlowDefinitionFixture {
    static func make(inputs: [FlowInputDefinition]? = nil) -> FlowDefinition {
        FlowDefinition(
            id: "flow-1",
            projectId: nil,
            name: "Test Flow",
            description: "",
            actions: [],
            inputs: inputs,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z"
        )
    }
}

// MARK: - RunMenuTests

final class RunMenuTests: XCTestCase {

    private func data(
        scripts: [String: String] = [:],
        agentCommands: [AgentCommand] = [],
        flows: [FlowDefinition] = [],
        actions: [ActionDefinition] = [],
        activeFlowRun: Bool = false,
        showAgentOptions: Bool = false
    ) -> RunMenuData {
        RunMenuData(
            scripts: scripts,
            defaultRuntime: "bun",
            agentCommands: agentCommands,
            flows: flows,
            standaloneActions: actions,
            hasActiveFlowRun: activeFlowRun,
            showAgentOptions: showAgentOptions,
            online: true
        )
    }

    // MARK: - hasRunMenuItems

    func testHasItems() {
        XCTAssertFalse(RunMenuViewModel.hasRunMenuItems(data()))
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(scripts: ["build": "tsc"])))
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(showAgentOptions: true)))
    }

    func testFlowsSuppressedWhileRunning() {
        let f = FlowDefinitionFixture.make()
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(flows: [f])))
        XCTAssertFalse(RunMenuViewModel.hasRunMenuItems(data(flows: [f], activeFlowRun: true)))
    }

    func testAgentCommandsTriggerItems() {
        let cmd = AgentCommand(name: "review", source: "local")
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(agentCommands: [cmd])))
    }

    func testStandaloneActionsTriggerItems() {
        let action = ActionDefinition(
            id: "a1", projectId: nil, name: "Deploy",
            prompt: "deploy now", sessionType: .shell,
            agentOptions: nil, standalone: true,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z"
        )
        XCTAssertTrue(RunMenuViewModel.hasRunMenuItems(data(actions: [action])))
    }

    func testEmptyDataReturnsFalse() {
        XCTAssertFalse(RunMenuViewModel.hasRunMenuItems(data()))
    }
}

import XCTest
@testable import Taskflow

@MainActor
final class AgentOptionsFormModelTests: XCTestCase {
    func testSeedFromClaudeOptions() {
        let model = AgentOptionsFormModel(
            seed: .claude(ClaudeLaunchOptions(
                type: AnyCodable(.string("claude")),
                dangerouslySkipPermissions: true,
                permissionMode: .acceptEdits,
                model: "opus",
                effort: .high)),
            settings: nil)
        XCTAssertEqual(model.claudeModel, "opus")
        XCTAssertEqual(model.claudeEffort, .high)
        XCTAssertTrue(model.claudeSkipPermissions)
        XCTAssertEqual(model.claudePermissionMode, .acceptEdits)
    }

    func testOptionsForClaudeRoundTrips() {
        let model = AgentOptionsFormModel(seed: nil, settings: nil)
        model.claudeModel = "opus"
        model.claudeSkipPermissions = true
        guard case let .claude(o)? = model.options(for: .claude) else { return XCTFail() }
        XCTAssertEqual(o.model, "opus")
        XCTAssertEqual(o.dangerouslySkipPermissions, true)
    }

    func testOptionsForEmptyClaudeNormalizesFalsyToNil() {
        let model = AgentOptionsFormModel(seed: nil, settings: nil)
        // all defaults → normalized claude has nil skip-permissions, nil model
        guard case let .claude(o)? = model.options(for: .claude) else { return XCTFail() }
        XCTAssertNil(o.dangerouslySkipPermissions)
        XCTAssertNil(o.model)
    }

    func testSeedMismatchIgnored() {
        // seed is codex but we read claude → claude stays default
        let model = AgentOptionsFormModel(
            seed: .codex(CodexLaunchOptions(
                type: AnyCodable(.string("codex")),
                model: "o3",
                sandbox: nil,
                approvalPolicy: nil,
                fullAuto: true)),
            settings: nil)
        XCTAssertEqual(model.codexModel, "o3")
        XCTAssertTrue(model.codexFullAuto)
        XCTAssertNil(model.claudeModel)
    }
}

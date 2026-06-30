import XCTest
@testable import Taskflow

final class AgentOptionsNormalizeTests: XCTestCase {
    func testShellReturnsNil() {
        XCTAssertNil(AgentOptionsNormalize.normalized(
            type: .shell,
            options: .claude(ClaudeLaunchOptions(
                type: AnyCodable(.string("claude")),
                dangerouslySkipPermissions: true,
                permissionMode: nil,
                model: nil,
                effort: nil))))
    }

    func testTypeMismatchReturnsNil() {
        // options say codex but the selected type is claude → nil
        XCTAssertNil(AgentOptionsNormalize.normalized(
            type: .claude,
            options: .codex(CodexLaunchOptions(
                type: AnyCodable(.string("codex")),
                model: "o3",
                sandbox: nil,
                approvalPolicy: nil,
                fullAuto: nil))))
    }

    func testNilOptionsReturnsNil() {
        XCTAssertNil(AgentOptionsNormalize.normalized(type: .claude, options: nil))
    }

    func testClaudeFalsyBooleanZeroed() {
        let out = AgentOptionsNormalize.normalized(
            type: .claude,
            options: .claude(ClaudeLaunchOptions(
                type: AnyCodable(.string("claude")),
                dangerouslySkipPermissions: false,
                permissionMode: .default,
                model: "",
                effort: nil)))
        guard case let .claude(o)? = out else { return XCTFail("expected claude") }
        XCTAssertNil(o.dangerouslySkipPermissions)   // false → nil
    }

    func testCodexFullAutoPreservedWhenTrue() {
        let out = AgentOptionsNormalize.normalized(
            type: .codex,
            options: .codex(CodexLaunchOptions(
                type: AnyCodable(.string("codex")),
                model: "o3",
                sandbox: .workspaceWrite,
                approvalPolicy: nil,
                fullAuto: true)))
        guard case let .codex(o)? = out else { return XCTFail("expected codex") }
        XCTAssertEqual(o.fullAuto, true)
        XCTAssertEqual(o.model, "o3")
    }
}

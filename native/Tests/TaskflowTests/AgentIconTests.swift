import XCTest
@testable import Taskflow

final class AgentIconTests: XCTestCase {
    func testInitials() {
        XCTAssertEqual(AgentIcon.initial(for: .claude), "C")
        XCTAssertEqual(AgentIcon.initial(for: .codex), "X")   // distinguish from Claude/Cursor
        XCTAssertEqual(AgentIcon.initial(for: .opencode), "O")
        XCTAssertEqual(AgentIcon.initial(for: .gemini), "G")
        XCTAssertEqual(AgentIcon.initial(for: .cursor), "▶")  // distinguish from Codex/Claude
        XCTAssertEqual(AgentIcon.initial(for: .pi), "π")
    }
    func testCursorUsesItsDedicatedThemeToken() {
        XCTAssertEqual(AgentIcon.tintToken(for: .cursor), .cursorAgent)
    }
    func testEveryAgentHasATint() {
        for a in [AgentType.claude, .codex, .opencode, .gemini, .cursor, .pi] {
            _ = AgentIcon.tintToken(for: a)   // total function: no default-trap
        }
    }
}

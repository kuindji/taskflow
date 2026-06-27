import XCTest
@testable import Taskflow

final class AgentOptionsLabelTests: XCTestCase {
    func testClaudeDefaultsVsSessionModelLabel() {
        XCTAssertEqual(ClaudeOptionsView.modelLabel(.defaults), "Default Model")
        XCTAssertEqual(ClaudeOptionsView.modelLabel(.session), "Model")
    }
}

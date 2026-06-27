import XCTest
@testable import Taskflow

final class UnionDecodeTests: XCTestCase {
    func testTaggedAgentOptionsDecodesByType() throws {
        let json = #"{"type":"claude","model":"opus","effort":"high"}"#.data(using: .utf8)!
        let opts = try JSONDecoder().decode(AgentLaunchOptions.self, from: json)
        if case let .claude(c) = opts {
            XCTAssertEqual(c.model, "opus")
        } else {
            XCTFail("expected .claude case, got \(opts)")
        }
    }

    func testXorOwnerDecodesByPresentKey() throws {
        let json = #"{"projectId":"p1"}"#.data(using: .utf8)!
        let owner = try JSONDecoder().decode(FlowOwner.self, from: json)
        if case let .projectId(id) = owner {
            XCTAssertEqual(id, "p1")
        } else {
            XCTFail("expected .projectId case, got \(owner)")
        }
    }
}

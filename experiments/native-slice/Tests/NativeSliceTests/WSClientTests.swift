import XCTest
@testable import NativeSlice

@MainActor
final class WSClientTests: XCTestCase {
    func testResponseResolvesPendingRequest() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        async let result: Data = client.awaitNextCorrelation { cid in
            client.handleInbound(.response(correlationId: cid, type: "task:list",
                                           payload: Data(#"{"tasks":[]}"#.utf8)))
        }
        let payload = try await result
        let obj = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        XCTAssertNotNil(obj["tasks"])
    }

    func testEventFansOutToHandlers() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var received: Data?
        _ = client.on(event: "task:updated") { received = $0 }
        client.handleInbound(.event(type: "task:updated", payload: Data(#"{"task":{"id":"t1"}}"#.utf8)))
        XCTAssertNotNil(received)
    }

    func testUnsubscribeStopsDelivery() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var count = 0
        let off = client.on(event: "task:created") { _ in count += 1 }
        client.handleInbound(.event(type: "task:created", payload: Data("{}".utf8)))
        off()
        client.handleInbound(.event(type: "task:created", payload: Data("{}".utf8)))
        XCTAssertEqual(count, 1)
    }
}

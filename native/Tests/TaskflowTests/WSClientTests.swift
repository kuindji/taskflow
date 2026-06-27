import XCTest
@testable import Taskflow

@MainActor
final class WSClientTests: XCTestCase {
    func testRequestResolvesOnMatchingResponse() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let payload = try await client.awaitNextCorrelation { id in
            client.handleInbound(.response(correlationId: id, type: "task:list",
                                           payload: #"{"tasks":[]}"#.data(using: .utf8)!))
        }
        XCTAssertEqual(String(data: payload, encoding: .utf8), #"{"tasks":[]}"#)
    }

    func testEventFanOutAndUnsubscribe() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var hits = 0
        let off = client.on(MessageType.taskCreated) { (_: AnyCodable) in hits += 1 }
        client.handleInbound(.event(type: "task:created", payload: #"{}"#.data(using: .utf8)!))
        off()
        client.handleInbound(.event(type: "task:created", payload: #"{}"#.data(using: .utf8)!))
        XCTAssertEqual(hits, 1)
    }

    func testUnmatchedResponseIsIgnored() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        client.handleInbound(.response(correlationId: "nope", type: "x",
                                       payload: Data())) // must not crash
    }

    // Production fix 1: a resolved request cancels its timeout (no late spurious failure).
    func testResolvedRequestDoesNotTimeOut() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let data = try await client.awaitNextCorrelation { id in
            client.handleInbound(.response(correlationId: id, type: "x",
                                           payload: #"{"ok":true}"#.data(using: .utf8)!))
        }
        // If the timeout weren't cancelled, a second resume would crash the continuation.
        try await SleepHelper.millis(50)
        XCTAssertFalse(data.isEmpty)
    }

    // Production fix 2: pending requests fail fast when the socket drops.
    func testSocketDropFailsPending() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        do {
            _ = try await client.awaitNextCorrelation { _ in client.failAllPending(.notConnected) }
            XCTFail("expected throw")
        } catch {
            // expected
        }
    }
}

enum SleepHelper { static func millis(_ ms: UInt64) async throws { try await Swift.Task.sleep(nanoseconds: ms * 1_000_000) } }

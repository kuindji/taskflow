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

    // Production fix 1: a resolved request cancels its timeout task so it doesn't linger.
    // This test FAILS if handleInbound's timeouts.removeValue(forKey:)?.cancel() is removed
    // because activeTimeoutCount would remain 1 after resolution.
    func testResolvedRequestDoesNotTimeOut() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let knownId = "test-correlation-\(UUID().uuidString)"
        let responsePayload = #"{"ok":true}"#.data(using: .utf8)!

        // Launch requestRaw on a child task. socketTask is nil so send is a no-op,
        // but pending + timeout ARE installed synchronously inside the continuation body.
        let child = Swift.Task {
            try await client.requestRaw(.taskList, payload: [:], correlationId: knownId,
                                        timeoutNanoseconds: 30_000_000_000)
        }
        // Yield so requestRaw runs and installs its pending/timeout entries.
        await Swift.Task.yield()
        XCTAssertEqual(client.activeTimeoutCount, 1, "timeout task must be registered before response")

        // Resolve the request; handleInbound must cancel+remove the timeout.
        client.handleInbound(.response(correlationId: knownId, type: "task:list",
                                       payload: responsePayload))

        let result = try await child.value
        XCTAssertEqual(result, responsePayload)
        XCTAssertEqual(client.activeTimeoutCount, 0, "timeout task must be cancelled and removed after response")
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

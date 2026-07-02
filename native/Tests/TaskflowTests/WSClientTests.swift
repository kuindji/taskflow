import XCTest
@testable import Taskflow

@MainActor
final class WSClientTests: XCTestCase {
    func testRequestResolvesOnMatchingResponse() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let payload = try await client.awaitNextCorrelation { id in
            client.handleInbound(.response(correlationId: id, type: "task:list",
                                           payload: #"{"tasks":[]}"#.data(using: .utf8)!,
                                           error: nil))
        }
        XCTAssertEqual(String(data: payload, encoding: .utf8), #"{"tasks":[]}"#)
    }

    func testRequestThrowsOnServerErrorResponse() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        do {
            _ = try await client.awaitNextCorrelation { id in
                client.handleInbound(.response(correlationId: id, type: "task:delete",
                                               payload: Data("{}".utf8),
                                               error: "Task not found"))
            }
            XCTFail("expected server error")
        } catch let error as WSClient.WSClientError {
            if case let .server(message) = error {
                XCTAssertEqual(message, "Task not found")
            } else {
                XCTFail("expected server error, got \(error)")
            }
        } catch {
            XCTFail("expected WSClientError, got \(error)")
        }
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
                                       payload: Data(), error: nil)) // must not crash
    }

    // Production fix 1: a resolved request cancels its timeout task so it doesn't linger.
    // This test FAILS if handleInbound's timeouts.removeValue(forKey:)?.cancel() is removed
    // because activeTimeoutCount would remain 1 after resolution.
    func testResolvedRequestDoesNotTimeOut() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let responsePayload = #"{"ok":true}"#.data(using: .utf8)!

        let child = Swift.Task {
            try await client.awaitNextCorrelation(timeoutNanoseconds: 30_000_000_000) { id in
                client.handleInbound(.response(correlationId: id, type: "task:list",
                                               payload: responsePayload, error: nil))
            }
        }

        await Swift.Task.yield()

        let result = try await child.value
        XCTAssertEqual(result, responsePayload)
        XCTAssertEqual(client.activeTimeoutCount, 0, "timeout task must be cancelled and removed after response")
    }

    // Production fix 2: a request made while disconnected fails immediately instead of waiting
    // for the normal request timeout.
    func testRequestRawFailsFastWhenNotConnected() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        do {
            _ = try await client.requestRaw(
                .taskList,
                payload: [:],
                timeoutNanoseconds: 30_000_000_000
            )
            XCTFail("expected notConnected")
        } catch let error as WSClient.WSClientError {
            if case .notConnected = error {
                XCTAssertEqual(client.activeTimeoutCount, 0)
            } else {
                XCTFail("expected notConnected, got \(error)")
            }
        } catch {
            XCTFail("expected WSClientError, got \(error)")
        }
    }

    // Production fix 3: pending requests fail fast when the socket drops.
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

import XCTest
@testable import Taskflow

/// Live-delivery tests for `TerminalSessionBridge` (the async parts; pure reducers
/// are covered in `TerminalSequenceTests`). Uses a recording `TerminalByteSink`
/// because a real `InMemoryTerminalSession` has no observable state without a
/// libghostty surface attached.
@MainActor
final class TerminalSessionBridgeTests: XCTestCase {

    private final class RecordingSink: TerminalByteSink {
        var received: [String] = []
        func receive(_ string: String) { received.append(string) }
    }

    private func chunk(_ seq: Int, _ data: String, sessionId: String = "s1") -> Data {
        Data(#"{"sessionId":"\#(sessionId)","data":"\#(data)","sequence":\#(seq)}"#.utf8)
    }

    private func makeStartedBridge(sink: RecordingSink, client: WSClient) async -> TerminalSessionBridge {
        let bridge = TerminalSessionBridge(
            sessionId: "s1", workspaceKey: "task:t1", client: client, session: sink)
        bridge.start()
        // Unconnected client: snapshot + history requests fail fast; bridge starts empty.
        var spins = 0
        while !bridge.historyLoaded && spins < 10_000 {
            await Task.yield()
            spins += 1
        }
        XCTAssertTrue(bridge.historyLoaded, "history load must settle against an unconnected client")
        return bridge
    }

    /// Chunks must reach the sink synchronously from the WS handler. An async hop
    /// between handler and receive() can reorder chunks — and the sequence gate
    /// silently DROPS the late chunk instead of reordering, corrupting output.
    func testLiveChunksApplySynchronouslyInOrder() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let sink = RecordingSink()
        let bridge = await makeStartedBridge(sink: sink, client: client)
        defer { bridge.stop() }  // also keeps the bridge (weakly captured by the handler) alive

        client.handleInbound(.event(type: "terminal:output", payload: chunk(1, "a")))
        XCTAssertEqual(sink.received, ["a"], "chunk must be applied synchronously, not after an async hop")
        client.handleInbound(.event(type: "terminal:output", payload: chunk(2, "b")))
        XCTAssertEqual(sink.received, ["a", "b"])
    }

    func testStaleAndForeignChunksAreDropped() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let sink = RecordingSink()
        let bridge = await makeStartedBridge(sink: sink, client: client)
        defer { bridge.stop() }  // also keeps the bridge (weakly captured by the handler) alive

        client.handleInbound(.event(type: "terminal:output", payload: chunk(2, "b")))
        client.handleInbound(.event(type: "terminal:output", payload: chunk(1, "a"))) // stale seq
        client.handleInbound(.event(type: "terminal:output", payload: chunk(3, "x", sessionId: "other")))
        XCTAssertEqual(sink.received, ["b"])
    }
}

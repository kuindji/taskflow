import XCTest
@testable import Taskflow

final class WSCodecTests: XCTestCase {
    func testDecodeResponseVsEvent() {
        let resp = WSCodec.decode(#"{"correlationId":"c1","type":"task:list","payload":{"tasks":[]}}"#)
        XCTAssertEqual(resp, .response(correlationId: "c1", type: "task:list",
                                       payload: #"{"tasks":[]}"#.data(using: .utf8)!))
        let ev = WSCodec.decode(#"{"type":"task:created","payload":{"task":{}}}"#)
        if case let .event(type, _) = ev { XCTAssertEqual(type, "task:created") }
        else { XCTFail("expected event") }
    }

    func testEncodeRequestRoundTrips() {
        let text = WSCodec.encodeRequest(type: "task:list", correlationId: "c1", payload: [:])!
        let obj = try! JSONSerialization.jsonObject(with: text.data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "task:list")
        XCTAssertEqual(obj["correlationId"] as? String, "c1")
    }
}

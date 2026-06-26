import XCTest
@testable import NativeSlice

final class WSCodecTests: XCTestCase {
    func testEncodeRequestProducesEnvelope() throws {
        let text = WSCodec.encodeRequest(type: "task:list", correlationId: "abc", payload: [:])
        let obj = try JSONSerialization.jsonObject(with: XCTUnwrap(text).data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "task:list")
        XCTAssertEqual(obj["correlationId"] as? String, "abc")
        XCTAssertNotNil(obj["payload"])
    }

    func testDecodeResponseCarriesCorrelationId() throws {
        let text = #"{"correlationId":"c1","type":"task:list","payload":{"tasks":[]}}"#
        guard case let .response(correlationId, type, payload) = try XCTUnwrap(WSCodec.decode(text)) else {
            return XCTFail("expected response")
        }
        XCTAssertEqual(correlationId, "c1")
        XCTAssertEqual(type, "task:list")
        let p = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        XCTAssertNotNil(p["tasks"])
    }

    func testDecodeEventHasNoCorrelationId() throws {
        let text = #"{"type":"task:updated","payload":{"task":{"id":"t1"}}}"#
        guard case let .event(type, _) = try XCTUnwrap(WSCodec.decode(text)) else {
            return XCTFail("expected event")
        }
        XCTAssertEqual(type, "task:updated")
    }

    func testDecodeGarbageReturnsNil() {
        XCTAssertNil(WSCodec.decode("not json"))
    }
}

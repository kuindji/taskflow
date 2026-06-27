import Foundation

enum WSInbound: Equatable {
    case response(correlationId: String, type: String, payload: Data)
    case event(type: String, payload: Data)
}

enum WSCodec {
    static func encodeRequest(type: String, correlationId: String, payload: [String: Any]) -> String? {
        let body: [String: Any] = ["correlationId": correlationId, "type": type, "payload": payload]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func decode(_ text: String) -> WSInbound? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        let payloadObj = obj["payload"] ?? [:]
        let payload = (try? JSONSerialization.data(withJSONObject: payloadObj)) ?? Data("{}".utf8)
        if let correlationId = obj["correlationId"] as? String {
            return .response(correlationId: correlationId, type: type, payload: payload)
        }
        return .event(type: type, payload: payload)
    }
}

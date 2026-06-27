// Hand-maintained support type for dynamic JSON fields. Not overwritten by codegen.
import Foundation

struct AnyCodable: Codable, Sendable, Equatable {
    let value: AnyCodableValue
    init(_ value: AnyCodableValue) { self.value = value }
    init(from decoder: Decoder) throws { value = try AnyCodableValue(from: decoder) }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

indirect enum AnyCodableValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool)
    case array([AnyCodableValue]), object([String: AnyCodableValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let d = try? c.decode(Double.self) { self = .number(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([AnyCodableValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: AnyCodableValue].self) { self = .object(o) }
        else { self = .null }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): try c.encode(n)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }
}

// Typed view over FlowDefinition.actions ([AnyCodable]); union per packages/shared/src/types/flow.ts
import Foundation

enum FlowActionEntryKind: Identifiable, Equatable {
    case reference(FlowActionReferenceEntry)
    case inline(FlowActionInlineEntry)
    var id: String {
        switch self {
        case .reference(let r): return r.id
        case .inline(let i): return i.id
        }
    }
}

enum FlowActionEntryCodec {
    nonisolated static func decode(_ raw: [AnyCodable]) -> [FlowActionEntryKind] {
        let enc = JSONEncoder()
        let dec = JSONDecoder()
        return raw.compactMap { element in
            guard case .object(let dict) = element.value,
                  let data = try? enc.encode(element) else { return nil }
            if dict["inline"] != nil, let i = try? dec.decode(FlowActionInlineEntry.self, from: data) {
                return .inline(i)
            }
            if let r = try? dec.decode(FlowActionReferenceEntry.self, from: data) {
                return .reference(r)
            }
            return nil
        }
    }

    nonisolated static func encode(_ entries: [FlowActionEntryKind]) -> [AnyCodable] {
        let enc = JSONEncoder()
        let dec = JSONDecoder()
        return entries.compactMap { entry in
            let data: Data?
            switch entry {
            case .reference(let r): data = try? enc.encode(r)
            case .inline(let i): data = try? enc.encode(i)
            }
            guard let data, let any = try? dec.decode(AnyCodable.self, from: data) else { return nil }
            return any
        }
    }
}

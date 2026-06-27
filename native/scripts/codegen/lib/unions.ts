import ts from "typescript";
import type { EmitCtx } from "./types";
import { camelCase, remapTypeName } from "./swift";

export type UnionKind =
    | { kind: "tagged"; members: string[] } // member type-reference names, each has a `type` discriminant
    | { kind: "xor"; variants: { key: string; type: string }[] } // anonymous object members keyed by presence
    | { kind: "none" };

export function classifyUnion(decl: ts.TypeAliasDeclaration, _ctx: Pick<EmitCtx, "enumNames">): UnionKind {
    const t = decl.type;
    if (!ts.isUnionTypeNode(t)) return { kind: "none" };

    // Tagged: every member is a TypeReference to a named interface (assumed to carry a `type` field).
    if (t.types.every((m) => ts.isTypeReferenceNode(m) && ts.isIdentifier(m.typeName))) {
        const members = t.types.map((m) => ((m as ts.TypeReferenceNode).typeName as ts.Identifier).text);
        return { kind: "tagged", members };
    }

    // XOR: every member is an anonymous object literal; the "present" key is the one whose
    // sibling fields are all `?: never`. Take the first non-never required key as the discriminant.
    if (t.types.every((m) => ts.isTypeLiteralNode(m))) {
        const variants: { key: string; type: string }[] = [];
        for (const m of t.types as ts.TypeLiteralNode[]) {
            const present = m.members.find((mem) => {
                if (!ts.isPropertySignature(mem) || !mem.type) return false;
                const isNever = mem.type.kind === ts.SyntaxKind.NeverKeyword;
                return !isNever && mem.questionToken === undefined;
            }) as ts.PropertySignature | undefined;
            if (!present || !present.name || !ts.isIdentifier(present.name)) return { kind: "none" };
            const key = present.name.text;
            const type =
                present.type && present.type.kind === ts.SyntaxKind.StringKeyword ? "String" : "Bool";
            variants.push({ key, type });
        }
        return { kind: "xor", variants };
    }
    return { kind: "none" };
}

// Tagged union -> Swift enum with associated values + custom Decodable switching on `type`.
// Assumes each member interface has a string `type` discriminant whose value is the wire tag.
// `tagValues` maps member interface name -> its discriminant wire string (resolved by the caller
// from each member interface's `type` literal; passed in to keep this function pure).
export function renderTaggedUnion(
    name: string,
    members: { interfaceName: string; tag: string }[],
): string {
    const cases = members.map((m) => `    case ${camelCase(m.tag)}(${remapTypeName(m.interfaceName)})`);
    const decodeCases = members
        .map(
            (m) =>
                `        case "${m.tag}": self = .${camelCase(m.tag)}(try ${remapTypeName(m.interfaceName)}(from: decoder))`,
        )
        .join("\n");
    const encodeCases = members
        .map((m) => `        case let .${camelCase(m.tag)}(v): try v.encode(to: encoder)`)
        .join("\n");
    return [
        `enum ${name}: Codable, Sendable, Equatable {`,
        ...cases,
        "",
        "    private enum DiscriminantKeys: String, CodingKey { case type }",
        "    init(from decoder: Decoder) throws {",
        "        let c = try decoder.container(keyedBy: DiscriminantKeys.self)",
        "        let tag = try c.decode(String.self, forKey: .type)",
        "        switch tag {",
        decodeCases,
        `        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown ${name} tag \\(tag)"))`,
        "        }",
        "    }",
        "    func encode(to encoder: Encoder) throws {",
        "        switch self {",
        encodeCases,
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}

// XOR union -> Swift enum decoded by which key is present.
export function renderXorUnion(name: string, variants: { key: string; type: string }[]): string {
    const cases = variants.map((v) => `    case ${v.key}(${v.type})`);
    const keys = variants.map((v) => `        case ${v.key}`).join("\n");
    const decode = variants
        .map(
            (v) =>
                `        if let v = try c.decodeIfPresent(${v.type}.self, forKey: .${v.key}) { self = .${v.key}(v); return }`,
        )
        .join("\n");
    const encode = variants
        .map((v) => `        case let .${v.key}(v): try c.encode(v, forKey: .${v.key})`)
        .join("\n");
    return [
        `enum ${name}: Codable, Sendable, Equatable {`,
        ...cases,
        "",
        "    private enum CodingKeys: String, CodingKey {",
        keys,
        "    }",
        "    init(from decoder: Decoder) throws {",
        "        let c = try decoder.container(keyedBy: CodingKeys.self)",
        decode,
        `        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no known ${name} key present"))`,
        "    }",
        "    func encode(to encoder: Encoder) throws {",
        "        var c = encoder.container(keyedBy: CodingKeys.self)",
        "        switch self {",
        encode,
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}

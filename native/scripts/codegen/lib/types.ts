import ts from "typescript";
import { camelCase, swiftEscapeKeyword } from "./swift";

export interface EmitCtx {
    enumNames: Set<string>; // names known to be string-union enums
    knownTypes: Set<string>; // all emittable type names (interfaces + string-union enums)
    typeParams: Set<string>; // current interface's type parameters (reset per renderInterface call)
}

export function mapPrimitive(name: string): string | null {
    switch (name) {
        case "string": return "String";
        case "number": return "Double";
        case "boolean": return "Bool";
        case "null": return "Optional"; // handled by caller as nullability
        case "unknown":
        case "any": return "AnyCodable";
        default: return null;
    }
}

// TypeScript 5 represents `null`/`undefined` in type position as
// LiteralTypeNode { literal: NullKeyword } rather than a bare NullKeyword.
function isNullOrUndefined(t: ts.TypeNode): boolean {
    if (t.kind === ts.SyntaxKind.NullKeyword) return true;
    if (t.kind === ts.SyntaxKind.UndefinedKeyword) return true;
    if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.UndefinedKeyword) return true;
    return false;
}

// Render a TS type node to a Swift type string. Optionality (`?`) is decided by the
// calling property renderer (questionToken and `| null`/`| undefined` unions).
export function swiftType(node: ts.TypeNode, ctx: EmitCtx): string {
    if (ts.isArrayTypeNode(node)) return `[${swiftType(node.elementType, ctx)}]`;

    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const ref = node.typeName.text;

        // Known generic containers
        if (ref === "Array" && node.typeArguments?.length === 1) {
            return `[${swiftType(node.typeArguments[0], ctx)}]`;
        }
        if (ref === "Record" && node.typeArguments?.length === 2) {
            return `[String: ${swiftType(node.typeArguments[1], ctx)}]`;
        }
        if (ref === "Partial" && node.typeArguments?.length === 1) {
            return swiftType(node.typeArguments[0], ctx);
        }

        // Unresolved type parameters resolve to AnyCodable
        if (ctx.typeParams.has(ref)) return "AnyCodable";

        // Any other utility type with type arguments (Extract, Omit, Pick, etc.) → AnyCodable
        if (node.typeArguments && node.typeArguments.length > 0) return "AnyCodable";

        // Named ref: only emit the name if we know it will be in the output module
        if (ctx.knownTypes.has(ref)) return ref;

        // Unknown ref (discriminated union alias, imported type not emitted, etc.) → AnyCodable
        return "AnyCodable";
    }

    if (node.kind === ts.SyntaxKind.StringKeyword) return "String";
    if (node.kind === ts.SyntaxKind.NumberKeyword) return "Double";
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return "Bool";

    if (ts.isLiteralTypeNode(node)) {
        if (ts.isStringLiteral(node.literal)) return "String";
        if (ts.isNumericLiteral(node.literal)) return "Double";
        // true/false literal types
        if (
            node.literal.kind === ts.SyntaxKind.TrueKeyword ||
            node.literal.kind === ts.SyntaxKind.FalseKeyword
        ) return "Bool";
    }

    if (ts.isUnionTypeNode(node)) {
        const nonNull = node.types.filter((t) => !isNullOrUndefined(t));
        if (nonNull.length === 1) return swiftType(nonNull[0], ctx);
        // Inline string-literal union → String (named ones are promoted to enums)
        if (nonNull.every((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))) {
            return "String";
        }
    }

    // Fallback for unhandled nodes (inline object types, intersection types,
    // conditional types, mapped types, indexed access types, etc.)
    return "AnyCodable";
}

function isValidSwiftIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// `export type Foo = "a" | "b" | "c";` → a Swift String enum.
// Returns null if not a pure string-literal union.
export function renderStringUnionAlias(decl: ts.TypeAliasDeclaration): string | null {
    const t = decl.type;
    if (!ts.isUnionTypeNode(t)) return null;
    const literals = t.types.filter(
        (x): x is ts.LiteralTypeNode =>
            ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal),
    );
    if (literals.length !== t.types.length || literals.length === 0) return null;
    const name = decl.name.text;
    const cases = literals.map((x) => {
        const raw = (x.literal as ts.StringLiteral).text;
        return `    case ${swiftEscapeKeyword(camelCase(raw))} = "${raw}"`;
    });
    return [`enum ${name}: String, Codable, Sendable {`, ...cases, "}", ""].join("\n");
}

// `export interface Foo { a: string; b?: number; c: Bar[] }` → a Swift Codable struct.
// Skips: `never`-typed fields, non-identifier property names (e.g. CSS vars like "--bg").
// Generic type parameters in the interface are substituted with AnyCodable.
export function renderInterface(decl: ts.InterfaceDeclaration, ctx: EmitCtx): string {
    const name = decl.name.text;

    // Track type params for this interface so they resolve to AnyCodable
    const localTypeParams: string[] = [];
    if (decl.typeParameters) {
        for (const tp of decl.typeParameters) {
            localTypeParams.push(tp.name.text);
            ctx.typeParams.add(tp.name.text);
        }
    }

    const fields: string[] = [];
    for (const member of decl.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;

        // Skip `never` discriminant markers (e.g. `inline?: never` in XOR union patterns)
        if (member.type.kind === ts.SyntaxKind.NeverKeyword) continue;

        const propName = ts.isIdentifier(member.name)
            ? member.name.text
            : ts.isStringLiteral(member.name)
              ? member.name.text
              : null;
        if (propName === null) continue;

        // Skip fields with non-identifier names (e.g. CSS variables like "--background")
        if (!isValidSwiftIdentifier(propName)) continue;

        let type = swiftType(member.type, ctx);
        const nullableUnion =
            ts.isUnionTypeNode(member.type) &&
            member.type.types.some(isNullOrUndefined);
        const optional = member.questionToken !== undefined || nullableUnion;
        if (optional) type += "?";
        fields.push(`    let ${swiftEscapeKeyword(propName)}: ${type}`);
    }

    // Clean up type params added for this interface
    for (const tp of localTypeParams) {
        ctx.typeParams.delete(tp);
    }

    return [`struct ${name}: Codable, Sendable, Equatable {`, ...fields, "}", ""].join("\n");
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { extractMessageCases } from "./lib/messages";
import { swiftHeader, swiftEnum, pascalCase } from "./lib/swift";
import { renderInterface, renderStringUnionAlias, type EmitCtx } from "./lib/types";
import { classifyUnion, renderTaggedUnion, renderXorUnion } from "./lib/unions";

// Hand-maintained files in Generated/ that must NOT be overwritten by this script:
//   AnyCodable.swift — dynamic-field escape hatch; update by hand if the schema changes.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHARED = join(REPO_ROOT, "packages", "shared", "src");
const OUT = join(REPO_ROOT, "native", "Sources", "Taskflow", "Generated");

function emit(relPath: string, body: string): void {
    const full = join(OUT, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, swiftHeader() + body);
    console.log(`emitted ${relPath}`);
}

// MessageType enum from MSG.
const constants = readFileSync(join(SHARED, "constants.ts"), "utf8");
emit("MessageType.swift", swiftEnum("MessageType", extractMessageCases(constants)));

// --- Model emission: shared type files → Codable structs + string-union enums ---

const TYPES_DIR = join(SHARED, "types");
const typeFiles = readdirSync(TYPES_DIR).filter((f) => f.endsWith(".ts"));

const ctx: EmitCtx = {
    enumNames: new Set(),
    knownTypes: new Set(),
    typeParams: new Set(),
    interfaceDecls: new Map(),
};

// Helper: try to extract a string literal value from a type node.
// Handles bare string literals ("x") and Extract<T, "x"> patterns.
function resolveStringLiteral(node: ts.TypeNode): string | null {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
        return node.literal.text;
    }
    if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "Extract" &&
        node.typeArguments &&
        node.typeArguments.length === 2
    ) {
        const second = node.typeArguments[1];
        if (ts.isLiteralTypeNode(second) && ts.isStringLiteral(second.literal)) {
            return second.literal.text;
        }
    }
    return null;
}

// Pass 1a: collect all type names (interfaces + string-union enums) for cross-file resolution.
for (const file of typeFiles) {
    const sourceText = readFileSync(join(TYPES_DIR, file), "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    sf.forEachChild((node) => {
        if (ts.isTypeAliasDeclaration(node)) {
            const t = node.type;
            if (ts.isUnionTypeNode(t)) {
                const isStringUnion = t.types.every(
                    (x) => ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal),
                );
                if (isStringUnion && t.types.length > 0) {
                    ctx.enumNames.add(node.name.text);
                    ctx.knownTypes.add(node.name.text);
                }
            }
        } else if (ts.isInterfaceDeclaration(node)) {
            ctx.knownTypes.add(node.name.text);
            ctx.interfaceDecls.set(node.name.text, node);
        }
    });
}

// Pass 1b: build a map from interface name → `type` field wire tag (for tagged union resolution).
// Resolves both bare string literals and Extract<T, "literal"> patterns.
const interfaceTypeFields = new Map<string, string>();
for (const file of typeFiles) {
    const sourceText = readFileSync(join(TYPES_DIR, file), "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    sf.forEachChild((node) => {
        if (!ts.isInterfaceDeclaration(node)) return;
        for (const member of node.members) {
            if (
                ts.isPropertySignature(member) &&
                ts.isIdentifier(member.name) &&
                member.name.text === "type" &&
                member.type
            ) {
                const tag = resolveStringLiteral(member.type);
                if (tag !== null) {
                    interfaceTypeFields.set(node.name.text, tag);
                }
            }
        }
    });
}

// Pass 1c: classify discriminated union aliases; add resolvable ones to knownTypes.
// Tagged: all members are TypeReferences AND every member has a resolvable `type` field literal.
// XOR: all members are anonymous object literals with exactly one required non-never key.
// Unresolvable tagged unions (no `type` field in members) are left as AnyCodable.
const classifiedTaggedUnions = new Map<string, { interfaceName: string; tag: string }[]>();
const classifiedXorUnions = new Map<string, { key: string; type: string }[]>();

for (const file of typeFiles) {
    const sourceText = readFileSync(join(TYPES_DIR, file), "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    sf.forEachChild((node) => {
        if (!ts.isTypeAliasDeclaration(node)) return;
        if (ctx.enumNames.has(node.name.text)) return; // already handled as string-union enum
        const kind = classifyUnion(node, ctx);
        if (kind.kind === "tagged") {
            const resolved: { interfaceName: string; tag: string }[] = [];
            let allResolved = true;
            for (const memberName of kind.members) {
                const tag = interfaceTypeFields.get(memberName);
                if (tag === undefined) {
                    allResolved = false;
                    break;
                }
                resolved.push({ interfaceName: memberName, tag });
            }
            if (allResolved && resolved.length > 0) {
                classifiedTaggedUnions.set(node.name.text, resolved);
                ctx.knownTypes.add(node.name.text);
            }
        } else if (kind.kind === "xor") {
            classifiedXorUnions.set(node.name.text, kind.variants);
            ctx.knownTypes.add(node.name.text);
        }
    });
}

// Pass 2: emit one Swift file per TS type file.
for (const file of typeFiles) {
    const sourceText = readFileSync(join(TYPES_DIR, file), "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const blocks: string[] = [];
    sf.forEachChild((node) => {
        if (ts.isTypeAliasDeclaration(node)) {
            const name = node.name.text;
            if (classifiedTaggedUnions.has(name)) {
                blocks.push(renderTaggedUnion(name, classifiedTaggedUnions.get(name)!));
            } else if (classifiedXorUnions.has(name)) {
                blocks.push(renderXorUnion(name, classifiedXorUnions.get(name)!));
            } else {
                const e = renderStringUnionAlias(node);
                if (e) blocks.push(e);
            }
        } else if (ts.isInterfaceDeclaration(node)) {
            blocks.push(renderInterface(node, ctx));
        }
    });
    if (blocks.length) {
        const swiftName = pascalCase(file.replace(/\.ts$/, "")) + "Types.swift";
        emit(join("Models", swiftName), blocks.join("\n"));
    }
}

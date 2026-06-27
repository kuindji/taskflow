import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { extractMessageCases } from "./lib/messages";
import { swiftHeader, swiftEnum, pascalCase } from "./lib/swift";
import { renderInterface, renderStringUnionAlias, type EmitCtx } from "./lib/types";

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
};

// Pass 1: collect all names that will be emitted (for cross-file reference resolution).
// Interfaces → struct names; pure string-literal union aliases → enum names.
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
            const e = renderStringUnionAlias(node);
            if (e) blocks.push(e);
            // Tagged/XOR/mixed union aliases are deferred to Task 5.
        } else if (ts.isInterfaceDeclaration(node)) {
            blocks.push(renderInterface(node, ctx));
        }
    });
    if (blocks.length) {
        const swiftName = pascalCase(file.replace(/\.ts$/, "")) + "Types.swift";
        emit(join("Models", swiftName), blocks.join("\n"));
    }
}

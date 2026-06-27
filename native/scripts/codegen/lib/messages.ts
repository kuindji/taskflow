import ts from "typescript";
import { camelCase } from "./swift";

// Walk a TS source for `export const MSG = { KEY: "wire:type", ... } as const`
// and return Swift case descriptors keyed by the wire string (deduped, first-wins).
export function extractMessageCases(sourceText: string): { name: string; raw: string }[] {
    const sf = ts.createSourceFile("constants.ts", sourceText, ts.ScriptTarget.Latest, true);
    const cases: { name: string; raw: string }[] = [];
    const seen = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === "MSG" &&
            node.initializer
        ) {
            const init = ts.isAsExpression(node.initializer)
                ? node.initializer.expression
                : node.initializer;
            if (ts.isObjectLiteralExpression(init)) {
                for (const prop of init.properties) {
                    if (
                        ts.isPropertyAssignment(prop) &&
                        ts.isStringLiteral(prop.initializer)
                    ) {
                        const raw = prop.initializer.text;
                        if (seen.has(raw)) continue;
                        seen.add(raw);
                        cases.push({ name: camelCase(raw), raw });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return cases;
}

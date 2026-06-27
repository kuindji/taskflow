import { expect, test } from "bun:test";
import { extractMessageCases } from "./lib/messages";
import { swiftEnum, pascalCase, camelCase } from "./lib/swift";
import { mapPrimitive } from "./lib/types";
import { classifyUnion } from "./lib/unions";
import ts from "typescript";

const SAMPLE = `
export const MSG = {
    TASK_LIST: "task:list",
    TASK_CREATED: "task:created",
    SYSTEM_INFO: "system:info",
} as const;
`;

test("extractMessageCases reads MSG string-literal values", () => {
    const cases = extractMessageCases(SAMPLE);
    expect(cases).toEqual([
        { name: "taskList", raw: "task:list" },
        { name: "taskCreated", raw: "task:created" },
        { name: "systemInfo", raw: "system:info" },
    ]);
});

test("camelCase maps a colon/snake wire type to a Swift case name", () => {
    expect(camelCase("task:list")).toBe("taskList");
    expect(pascalCase("flow-run-updated")).toBe("FlowRunUpdated");
    expect(camelCase("flow:run-updated")).toBe("flowRunUpdated");
    expect(camelCase("remote-agent:status-changed")).toBe("remoteAgentStatusChanged");
});

test("swiftEnum renders a String-backed enum", () => {
    const out = swiftEnum("MessageType", [{ name: "taskList", raw: "task:list" }]);
    expect(out).toContain("enum MessageType: String, Codable, Sendable, CaseIterable {");
    expect(out).toContain(`case taskList = "task:list"`);
});

test("mapPrimitive maps TS scalars and containers to Swift", () => {
    expect(mapPrimitive("string")).toBe("String");
    expect(mapPrimitive("number")).toBe("Double");
    expect(mapPrimitive("boolean")).toBe("Bool");
});

function alias(src: string): ts.TypeAliasDeclaration {
    const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
    let found: ts.TypeAliasDeclaration | undefined;
    sf.forEachChild((n) => { if (ts.isTypeAliasDeclaration(n)) found = n; });
    if (!found) throw new Error("no alias");
    return found;
}

test("classifyUnion detects a type-tagged union", () => {
    const decl = alias(`type AgentLaunchOptions = ClaudeLaunchOptions | PiLaunchOptions;`);
    const k = classifyUnion(decl, { enumNames: new Set() });
    expect(k.kind).toBe("tagged");
});

test("classifyUnion detects a key-presence XOR union", () => {
    const decl = alias(
        `type FlowOwner =
            | { taskId: string; projectId?: never; master?: never }
            | { projectId: string; taskId?: never; master?: never }
            | { master: true; taskId?: never; projectId?: never };`,
    );
    const k = classifyUnion(decl, { enumNames: new Set() });
    expect(k.kind).toBe("xor");
});

test("classifyUnion returns none for a mixed named-ref + string-literal union", () => {
    const decl = alias(`type T = AgentType | "shell";`);
    const k = classifyUnion(decl, { enumNames: new Set() });
    expect(k.kind).toBe("none");
});

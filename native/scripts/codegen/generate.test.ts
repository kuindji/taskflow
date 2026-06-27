import { expect, test } from "bun:test";
import { extractMessageCases } from "./lib/messages";
import { swiftEnum, pascalCase, camelCase } from "./lib/swift";

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
});

test("swiftEnum renders a String-backed enum", () => {
    const out = swiftEnum("MessageType", [{ name: "taskList", raw: "task:list" }]);
    expect(out).toContain("enum MessageType: String, Codable, Sendable, CaseIterable {");
    expect(out).toContain(`case taskList = "task:list"`);
});

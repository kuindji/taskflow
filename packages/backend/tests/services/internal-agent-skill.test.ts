import { describe, expect, it } from "bun:test";
import {
    INTERNAL_AGENT_SYSTEM_PROMPT,
    buildAgentLaunchSpec,
} from "../../src/services/internal-agent-skill";

function escapeTomlBasicString(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("\b", "\\b")
        .replaceAll("\t", "\\t")
        .replaceAll("\n", "\\n")
        .replaceAll("\f", "\\f")
        .replaceAll("\r", "\\r")
        .replaceAll('"', '\\"');
}

describe("internal agent skill", () => {
    it("uses only working and attention session states", () => {
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).toContain(
            'status with JSON {"status":"working"} immediately when you start work',
        );
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).toContain(
            'the same endpoint with JSON {"status":"attention"} before asking the user anything, and when you are done and waiting for the user.',
        );
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).not.toContain('{"status":"idle"}');
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).not.toContain("/done");
    });

    it("configures Codex to load the Taskflow internal skill", () => {
        const spec = buildAgentLaunchSpec(
            "codex",
            "Investigate the failing build",
            "/tmp/taskflow-internal-api/SKILL.md",
        );

        expect(spec.command).toBe("codex");
        expect(spec.args).toEqual([
            "-c",
            `developer_instructions="${escapeTomlBasicString(INTERNAL_AGENT_SYSTEM_PROMPT)}"`,
            "-c",
            'skills.config=[{path="/tmp/taskflow-internal-api/SKILL.md", enabled=true}]',
            "Investigate the failing build",
        ]);
    });

    it("appends the Taskflow internal API prompt for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", undefined, "/tmp/ignored/SKILL.md");

        expect(spec.command).toBe("claude");
        expect(spec.args).toEqual(["--append-system-prompt", INTERNAL_AGENT_SYSTEM_PROMPT]);
    });
});

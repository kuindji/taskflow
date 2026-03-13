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
    it("leaves session status under app control", () => {
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).toContain("TASKFLOW_PROJECT_ID");
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).toContain("--project");
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).toContain(
            "Session status is app-controlled, so do not post manual session status updates.",
        );
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).not.toContain("/api/sessions/");
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).not.toContain('{"status":"working"}');
        expect(INTERNAL_AGENT_SYSTEM_PROMPT).not.toContain('{"status":"attention"}');
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
        expect(spec.args).toEqual([
            "--allowedTools",
            "Bash(taskflow-cli*)",
            "--append-system-prompt",
            INTERNAL_AGENT_SYSTEM_PROMPT,
        ]);
    });
});

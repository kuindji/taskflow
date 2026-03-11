import { describe, expect, it } from "bun:test";
import {
    INTERNAL_AGENT_SYSTEM_PROMPT,
    buildAgentLaunchSpec,
} from "../../src/services/internal-agent-skill";

describe("internal agent skill", () => {
    it("configures Codex to load the Taskflow internal skill", () => {
        const spec = buildAgentLaunchSpec(
            "codex",
            "Investigate the failing build",
            "/tmp/taskflow-internal-api/SKILL.md",
        );

        expect(spec.command).toBe("codex");
        expect(spec.args).toEqual([
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

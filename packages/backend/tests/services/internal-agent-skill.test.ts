import { afterEach, describe, expect, it } from "bun:test";
import {
    buildSystemPrompt,
    ensureCliScript,
    buildAgentLaunchSpec,
    PROMPT_AUTONOMOUS,
} from "../../src/services/internal-agent-skill";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

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

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe("internal agent skill", () => {
    it("prompts do not reference TASKFLOW env vars", () => {
        const taskPrompt = buildSystemPrompt(false);
        const projectPrompt = buildSystemPrompt(true);
        for (const prompt of [taskPrompt, projectPrompt]) {
            expect(prompt).not.toContain("TASKFLOW_");
        }
    });

    it("task-scoped prompt includes task context", () => {
        const prompt = buildSystemPrompt(false);
        expect(prompt).toContain("scoped to a specific task");
        expect(prompt).toContain("taskflow-cli");
    });

    it("project-scoped prompt indicates project scope", () => {
        const prompt = buildSystemPrompt(true);
        expect(prompt).toContain("scoped to a project, not a specific task");
    });

    it("flow block is only included when isFlowScope is true", () => {
        const withoutFlow = buildSystemPrompt(false);
        const withFlow = buildSystemPrompt(false, true);
        expect(withoutFlow).not.toContain("scoped to a flow step");
        expect(withFlow).toContain("scoped to a flow step");
    });

    it("configures Codex to load the Taskflow internal skill", () => {
        const codexPrompt = buildSystemPrompt(false, undefined, false);
        const spec = buildAgentLaunchSpec(
            "codex",
            "Investigate the failing build",
            "/tmp/taskflow-internal-api/SKILL.md",
        );

        expect(spec.command).toBe("codex");
        expect(spec.args).toEqual([
            "-c",
            `developer_instructions="${escapeTomlBasicString(codexPrompt)}"`,
            "-c",
            'skills.config=[{path="/tmp/taskflow-internal-api/SKILL.md", enabled=true}]',
            "--",
            "Investigate the failing build",
        ]);
    });

    it("Codex developer_instructions does not duplicate the skill body", () => {
        const fullPrompt = buildSystemPrompt(false);
        const codexPrompt = buildSystemPrompt(false, undefined, false);
        const spec = buildAgentLaunchSpec(
            "codex",
            undefined,
            "/tmp/taskflow-internal-api/SKILL.md",
        );

        // Sanity — the skill-less prompt is strictly smaller than the full prompt.
        expect(codexPrompt.length).toBeLessThan(fullPrompt.length);

        const devInstructionsArg = spec.args.find((arg) =>
            arg.startsWith("developer_instructions="),
        );
        expect(devInstructionsArg).toBeDefined();
        // Skill H1 heading should appear exactly zero times in the embedded prompt.
        expect(devInstructionsArg).not.toContain("# Taskflow CLI");
        // But the base framing must still be present.
        expect(devInstructionsArg).toContain("taskflow-cli");
        // And the skill is still registered as a separate codex skill.
        expect(spec.args).toContain(
            'skills.config=[{path="/tmp/taskflow-internal-api/SKILL.md", enabled=true}]',
        );
    });

    it("Codex does not forward --model when set to the 'default' sentinel", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            model: "default",
        });
        const modelIdx = spec.args.indexOf("--model");
        if (modelIdx >= 0) {
            expect(spec.args[modelIdx + 1]).not.toBe("default");
        }
        expect(spec.args).not.toContain("default");
    });

    it("Gemini does not forward --model when set to the 'default' sentinel", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do it", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            model: "default",
        });
        const modelIdx = spec.args.indexOf("--model");
        if (modelIdx >= 0) {
            expect(spec.args[modelIdx + 1]).not.toBe("default");
        }
        expect(spec.args).not.toContain("default");
    });

    it("buildSystemPrompt omits the skill body when includeSkill is false", () => {
        const withSkill = buildSystemPrompt(false);
        const withoutSkill = buildSystemPrompt(false, undefined, false);
        expect(withSkill).toContain("# Taskflow CLI");
        expect(withoutSkill).not.toContain("# Taskflow CLI");
        // Both retain the base framing and scope block.
        expect(withoutSkill).toContain("taskflow-cli");
        expect(withoutSkill).toContain("scoped to a specific task");
    });

    it("appends the Taskflow internal API prompt for Claude", () => {
        const taskPrompt = buildSystemPrompt(false);
        const spec = buildAgentLaunchSpec("claude", undefined, "/tmp/ignored/SKILL.md");

        expect(spec.command).toBe("claude");
        expect(spec.args).toEqual([
            "--allowedTools",
            `Read(/${dirname("/tmp/ignored/SKILL.md")}/**)`,
            "--allowedTools",
            "Bash(taskflow-cli*)",
            "--append-system-prompt",
            taskPrompt,
        ]);
    });

    it("passes only user prompt to Gemini via --prompt-interactive", () => {
        const spec = buildAgentLaunchSpec("gemini", "Fix the bug", "/tmp/ignored/SKILL.md");
        expect(spec.command).toBe("gemini");
        expect(spec.args).toContain("--prompt-interactive");
        expect(spec.args).toContain("Fix the bug");
        expect(spec.args.join(" ")).not.toContain("taskflow-cli");
    });

    it("omits --prompt-interactive for Gemini when no user prompt given", () => {
        const spec = buildAgentLaunchSpec("gemini", undefined, "/tmp/ignored/SKILL.md");
        expect(spec.command).toBe("gemini");
        expect(spec.args).not.toContain("--prompt-interactive");
    });

    it("passes Gemini agent options through", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do stuff", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            approvalMode: "yolo",
            model: "gemini-2.5-pro",
        });
        expect(spec.args).toContain("--approval-mode");
        expect(spec.args).toContain("yolo");
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("gemini-2.5-pro");
    });

    it("omits --approval-mode for Gemini when set to default", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do stuff", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            approvalMode: "default",
        });
        expect(spec.args).not.toContain("--approval-mode");
    });

    it("passes --sandbox for Gemini when sandbox is true", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do stuff", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            sandbox: true,
        });
        expect(spec.args).toContain("--sandbox");
    });

    it("passes project scope through to the system prompt", () => {
        const projectPrompt = buildSystemPrompt(true);
        const spec = buildAgentLaunchSpec(
            "claude",
            "Help me explore",
            "/tmp/ignored/SKILL.md",
            undefined,
            undefined,
            true,
        );

        expect(spec.args).toContain(projectPrompt);
    });

    it("escapes artifact text payloads before posting JSON", async () => {
        const tempDir = await mkdtemp(join(tmpdir(), "taskflow-cli-test-"));
        tempDirs.push(tempDir);
        const cliDir = join(tempDir, "cli");
        const fakeBinDir = join(tempDir, "fake-bin");
        const captureFile = join(tempDir, "payload.json");

        await ensureCliScript(cliDir);
        await mkdir(fakeBinDir, { recursive: true });
        await writeFile(
            join(fakeBinDir, "curl"),
            `#!/bin/sh
set -e
data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -d)
      data="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
printf '%s' "$data" > "$CAPTURE_FILE"
printf '{}'
`,
            "utf8",
        );
        await chmod(join(fakeBinDir, "curl"), 0o755);

        const result = spawnSync(
            join(cliDir, "taskflow-cli"),
            ["artifact", "save", "summary", "--text", 'line "one"\nline two'],
            {
                env: {
                    ...process.env,
                    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
                    CAPTURE_FILE: captureFile,
                    TASKFLOW_API_URL: "http://localhost:1234",
                    TASKFLOW_TASK_ID: "task-1",
                    TASKFLOW_FLOW_ID: "flow-1",
                    TASKFLOW_ACTION_ENTRY_ID: "entry-1",
                    TASKFLOW_SESSION_ID: "session-1",
                },
                encoding: "utf8",
            },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(await readFile(captureFile, "utf8"))).toEqual({
            taskId: "task-1",
            flowId: "flow-1",
            actionEntryId: "entry-1",
            sessionId: "session-1",
            type: "summary",
            text: 'line "one"\nline two',
        });
    });

    it("bypassPermissions uses Claude's canonical permission mode", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            permissionMode: "bypassPermissions",
        });
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("bypassPermissions");
        expect(spec.args).not.toContain("--dangerously-skip-permissions");
    });

    it("permissionMode passes --permission-mode for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            permissionMode: "dontAsk",
        });
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("dontAsk");
        expect(spec.args).not.toContain("--dangerously-skip-permissions");
    });

    it("permissionMode auto passes --permission-mode auto for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            permissionMode: "auto",
        });
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("auto");
    });

    it("omits --permission-mode when Claude inherits its configured default", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
        });
        expect(spec.args).not.toContain("--permission-mode");
    });

    it("permissionMode manual explicitly restores Claude's backwards-compatible default mode", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            permissionMode: "manual",
        });
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("default");
    });

    it("effort passes --effort for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            effort: "high",
        });
        expect(spec.args).toContain("--effort");
        expect(spec.args).toContain("high");
    });

    it("passes the session-only ultracode effort for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            effort: "ultracode",
        });
        expect(spec.args).toContain("--effort");
        expect(spec.args).toContain("ultracode");
    });

    it("passes full model name for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            model: "claude-sonnet-4-6",
        });
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("claude-sonnet-4-6");
    });

    it("combines all Claude-specific flags without conflicting permission switches", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            permissionMode: "auto",
            model: "opus",
            effort: "max",
        });
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("auto");
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("opus");
        expect(spec.args).toContain("--effort");
        expect(spec.args).toContain("max");
    });

    it("passes the explicit dangerous bypass flag for Codex", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            dangerouslyBypassApprovalsAndSandbox: true,
        });
        expect(spec.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("passes Codex sandbox and approvalPolicy flags", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            sandbox: "danger-full-access",
            approvalPolicy: "never",
        });
        expect(spec.args).toContain("--sandbox");
        expect(spec.args).toContain("danger-full-access");
        expect(spec.args).toContain("--ask-for-approval");
        expect(spec.args).toContain("never");
        expect(spec.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("dangerous bypass skips individual sandbox and approval policy for Codex", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            dangerouslyBypassApprovalsAndSandbox: true,
            sandbox: "read-only",
            approvalPolicy: "untrusted",
        });
        expect(spec.args).toContain("--dangerously-bypass-approvals-and-sandbox");
        expect(spec.args).not.toContain("--sandbox");
        expect(spec.args).not.toContain("--ask-for-approval");
    });

    it("passes Codex model via --model", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            model: "o4-mini",
        });
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("o4-mini");
    });

    it("passes Codex reasoning effort as a config override", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            reasoningEffort: "xhigh",
        });
        expect(spec.args).toContain("-c");
        expect(spec.args).toContain('model_reasoning_effort="xhigh"');
    });

    it("passes --approval-mode auto_edit for Gemini", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do it", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            approvalMode: "auto_edit",
        });
        expect(spec.args).toContain("--approval-mode");
        expect(spec.args).toContain("auto_edit");
    });

    it("yolo flag passes --yolo for Cursor", () => {
        const spec = buildAgentLaunchSpec("cursor", "Do it", "/tmp/ignored/SKILL.md", {
            type: "cursor",
            yolo: true,
        });
        expect(spec.args).toContain("--yolo");
    });

    it("autoApprove forces permission allow for OpenCode", () => {
        const spec = buildAgentLaunchSpec("opencode", "Do it", "/tmp/ignored/SKILL.md", {
            type: "opencode",
            autoApprove: true,
        });
        const config = JSON.parse(spec.env!.OPENCODE_CONFIG_CONTENT) as {
            permission: Record<string, string>;
        };
        expect(config.permission).toEqual({ edit: "allow", bash: "allow", write: "allow" });
    });

    it("omits permission config for OpenCode when autoApprove is not set", () => {
        const spec = buildAgentLaunchSpec("opencode", "Do it", "/tmp/ignored/SKILL.md", {
            type: "opencode",
        });
        const config = JSON.parse(spec.env!.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>;
        expect(config.permission).toBeUndefined();
    });

    it("passes --variant for OpenCode", () => {
        const spec = buildAgentLaunchSpec("opencode", "Do it", "/tmp/ignored/SKILL.md", {
            type: "opencode",
            model: "openrouter/anthropic/claude-sonnet-4.6",
            variant: "high",
        });
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("openrouter/anthropic/claude-sonnet-4.6");
        expect(spec.args).toContain("--variant");
        expect(spec.args).toContain("high");
    });

    it("PROMPT_AUTONOMOUS is exported and contains expected content", () => {
        expect(PROMPT_AUTONOMOUS).toContain("Do not ask clarifying questions");
        expect(PROMPT_AUTONOMOUS).toContain("proceed autonomously");
    });
});

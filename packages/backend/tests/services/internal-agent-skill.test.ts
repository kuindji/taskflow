import { afterEach, describe, expect, it } from "bun:test";
import {
    buildSystemPrompt,
    ensureCliScript,
    buildAgentLaunchSpec,
    PROMPT_AUTONOMOUS,
} from "../../src/services/internal-agent-skill";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
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
        const taskPrompt = buildSystemPrompt(false);
        const spec = buildAgentLaunchSpec(
            "codex",
            "Investigate the failing build",
            "/tmp/taskflow-internal-api/SKILL.md",
        );

        expect(spec.command).toBe("codex");
        expect(spec.args).toEqual([
            "-c",
            `developer_instructions="${escapeTomlBasicString(taskPrompt)}"`,
            "-c",
            'skills.config=[{path="/tmp/taskflow-internal-api/SKILL.md", enabled=true}]',
            "--",
            "Investigate the failing build",
        ]);
    });

    it("appends the Taskflow internal API prompt for Claude", () => {
        const taskPrompt = buildSystemPrompt(false);
        const spec = buildAgentLaunchSpec("claude", undefined, "/tmp/ignored/SKILL.md");

        expect(spec.command).toBe("claude");
        expect(spec.args).toEqual([
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
            fullAccess: true,
            model: "pro",
        });
        expect(spec.args).toContain("--yolo");
        expect(spec.args).toContain("--model");
        expect(spec.args).toContain("pro");
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

    it("dontAskQuestions forces --dangerously-skip-permissions and --permission-mode dontAsk for Claude", () => {
        const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
            type: "claude",
            dontAskQuestions: true,
        });
        expect(spec.args).toContain("--dangerously-skip-permissions");
        expect(spec.args).toContain("--permission-mode");
        expect(spec.args).toContain("dontAsk");
    });

    it("dontAskQuestions forces --full-auto for Codex", () => {
        const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
            type: "codex",
            dontAskQuestions: true,
        });
        expect(spec.args).toContain("--full-auto");
    });

    it("dontAskQuestions forces --yolo for Gemini", () => {
        const spec = buildAgentLaunchSpec("gemini", "Do it", "/tmp/ignored/SKILL.md", {
            type: "gemini",
            dontAskQuestions: true,
        });
        expect(spec.args).toContain("--yolo");
    });

    it("dontAskQuestions forces --yolo for Cursor", () => {
        const spec = buildAgentLaunchSpec("cursor", "Do it", "/tmp/ignored/SKILL.md", {
            type: "cursor",
            dontAskQuestions: true,
        });
        expect(spec.args).toContain("--yolo");
    });

    it("dontAskQuestions forces permission allow for OpenCode", () => {
        const spec = buildAgentLaunchSpec("opencode", "Do it", "/tmp/ignored/SKILL.md", {
            type: "opencode",
            dontAskQuestions: true,
        });
        const config = JSON.parse(spec.env!.OPENCODE_CONFIG_CONTENT) as {
            permission: Record<string, string>;
        };
        expect(config.permission).toEqual({ edit: "allow", bash: "allow", write: "allow" });
    });

    it("PROMPT_AUTONOMOUS is exported and contains expected content", () => {
        expect(PROMPT_AUTONOMOUS).toContain("Do not ask clarifying questions");
        expect(PROMPT_AUTONOMOUS).toContain("proceed autonomously");
    });
});

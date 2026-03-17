import { afterEach, describe, expect, it } from "bun:test";
import {
    buildSystemPrompt,
    ensureCliScript,
    buildAgentLaunchSpec,
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
    it("leaves session status under app control", () => {
        const taskPrompt = buildSystemPrompt(false);
        const projectPrompt = buildSystemPrompt(true);
        for (const prompt of [taskPrompt, projectPrompt]) {
            expect(prompt).toContain("TASKFLOW_PROJECT_ID");
            expect(prompt).toContain("--project");
            expect(prompt).toContain(
                "Session status is app-controlled, so do not post manual session status updates.",
            );
            expect(prompt).not.toContain("/api/sessions/");
            expect(prompt).not.toContain('{"status":"working"}');
            expect(prompt).not.toContain('{"status":"attention"}');
        }
    });

    it("task-scoped prompt includes proactive task commands", () => {
        const prompt = buildSystemPrompt(false);
        expect(prompt).toContain("TASKFLOW_TASK_ID is also set");
        expect(prompt).toContain("taskflow-cli task`");
        expect(prompt).toContain("taskflow-cli task worktree --disable");
    });

    it("project-scoped prompt does not encourage proactive task usage", () => {
        const prompt = buildSystemPrompt(true);
        expect(prompt).toContain("scoped to the project, not a specific task");
        expect(prompt).toContain("only be used when the user explicitly asks");
        expect(prompt).not.toContain("TASKFLOW_TASK_ID is also set");
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
});

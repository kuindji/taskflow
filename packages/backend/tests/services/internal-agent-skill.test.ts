import { afterEach, describe, expect, it } from "bun:test";
import {
    INTERNAL_AGENT_SYSTEM_PROMPT,
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
        await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

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

        const result = spawnSync(join(cliDir, "taskflow-cli"), [
            "artifact",
            "save",
            "summary",
            "--text",
            'line "one"\nline two',
        ], {
            env: {
                ...process.env,
                PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
                CAPTURE_FILE: captureFile,
                TASKFLOW_API_URL: "http://localhost:1234",
                TASKFLOW_TASK_ID: "task-1",
                TASKFLOW_FLOW_ID: "flow-1",
                TASKFLOW_STEP_ENTRY_ID: "entry-1",
                TASKFLOW_SESSION_ID: "session-1",
            },
            encoding: "utf8",
        });

        expect(result.status).toBe(0);
        expect(JSON.parse(await readFile(captureFile, "utf8"))).toEqual({
            taskId: "task-1",
            flowId: "flow-1",
            stepEntryId: "entry-1",
            sessionId: "session-1",
            type: "summary",
            text: 'line "one"\nline two',
        });
    });
});

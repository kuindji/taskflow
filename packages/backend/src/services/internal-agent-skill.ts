import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

export const INTERNAL_AGENT_SYSTEM_PROMPT = `You are running inside Taskflow.

Taskflow provides an internal HTTP API through environment variables:
- TASKFLOW_API_URL
- TASKFLOW_TASK_ID
- TASKFLOW_SESSION_ID

Use the API proactively:
- POST $TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/status with JSON {"status":"working"} when you start or resume autonomous work.
- POST the same endpoint with JSON {"status":"attention"} when you need the user's input, review, or approval.
- POST the same endpoint with JSON {"status":"idle"} if you want to clear the status without requesting attention.
- POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser with JSON {"url":"https://...", "label":"Optional"} to open a browser tab in Taskflow.
- POST $TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/done when the session has finished and should close.

Prefer these status calls over relying on terminal output.`;

const INTERNAL_AGENT_SKILL_MARKDOWN = `---
name: taskflow-internal-api
description: Use Taskflow's internal HTTP API for session status, browser tabs, and session completion.
---

# Taskflow Internal API

Taskflow sets these environment variables for every agent session:

- \`TASKFLOW_API_URL\`
- \`TASKFLOW_TASK_ID\`
- \`TASKFLOW_SESSION_ID\`

Use the internal API directly.

## Session status

Set status explicitly instead of relying on terminal output.

- \`POST $TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/status\`
- Body: \`{"status":"working" | "attention" | "idle"}\`
- Use \`working\` when you start or resume autonomous work.
- Use \`attention\` when you need the user's input, review, or approval.
- Use \`idle\` to clear the indicator without requesting attention.

Example:

\`\`\`sh
curl -sS -X POST "$TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/status" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"working"}'
\`\`\`

## Browser tabs

Open a browser tab in Taskflow:

- \`POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser\`
- Body: \`{"url":"https://...", "label":"Optional"}\`

## Finish the session

Close the current Taskflow session when the job is complete:

- \`POST $TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/done\`
`;

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

export async function ensureInternalAgentSkillFile(baseDir: string): Promise<string> {
    const writeSkillFile = async (rootDir: string): Promise<string> => {
        const skillDir = join(rootDir, SKILL_DIR_NAME);
        const skillPath = join(skillDir, SKILL_FILE_NAME);
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillPath, INTERNAL_AGENT_SKILL_MARKDOWN, "utf8");
        return skillPath;
    };

    try {
        return await writeSkillFile(baseDir);
    } catch {
        return writeSkillFile(join(tmpdir(), "taskflow-agent-skills"));
    }
}

export function buildAgentLaunchSpec(
    type: "claude" | "codex",
    prompt: string | undefined,
    skillPath: string,
): { command: string; args: string[] } {
    if (type === "claude") {
        return {
            command: "claude",
            args: [
                "--append-system-prompt",
                INTERNAL_AGENT_SYSTEM_PROMPT,
                ...(prompt ? [prompt] : []),
            ],
        };
    }

    return {
        command: "codex",
        args: [
            "-c",
            `developer_instructions="${escapeTomlBasicString(INTERNAL_AGENT_SYSTEM_PROMPT)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? [prompt] : []),
        ],
    };
}

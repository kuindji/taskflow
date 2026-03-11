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
- POST $TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/status with JSON {"status":"working"} immediately when you start work, and again after every user reply when you resume work.
- POST the same endpoint with JSON {"status":"attention"} before asking the user anything, and when you are done and waiting for the user.
- POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser with JSON {"url":"https://...", "label":"Optional"} to open a browser tab in Taskflow.

Prefer these status calls over relying on terminal output when they are already permitted.
Do not interrupt the user only to request approval for a Taskflow status update.`;

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
- Body: \`{"status":"working" | "attention"}\`
- Use \`working\` immediately when you start work.
- Use \`working\` again after every user reply when you resume work.
- Use \`attention\` before asking the user anything.
- Use \`attention\` when you are done and waiting for the user.

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

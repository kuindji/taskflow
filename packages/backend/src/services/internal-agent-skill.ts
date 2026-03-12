import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

export const INTERNAL_AGENT_SYSTEM_PROMPT = `You are running inside Taskflow.

Taskflow provides an internal HTTP API through environment variables:
- TASKFLOW_API_URL
- TASKFLOW_TASK_ID
- TASKFLOW_PROJECT_ID
- TASKFLOW_SESSION_ID

Use the API proactively:
- At session start, read task context: GET $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID (returns task info and log from prior sessions).
- Log significant findings: POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log with JSON {"type":"info","message":"...","sessionId":"$TASKFLOW_SESSION_ID"}.
- After committing, log the commit: POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log with JSON {"type":"commit","message":"<commit message>","sessionId":"$TASKFLOW_SESSION_ID","meta":{"hash":"<commit hash>"}}.
- Log types: "info" (findings/progress), "commit" (commits), "warning" (concerns), "error" (failures).
- For browser tabs: POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser with JSON {"url":"https://...", "label":"Optional"}.
- For project-scoped browser tabs: POST $TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/browser with JSON {"url":"https://...", "label":"Optional"}.
Session status is app-controlled, so do not post manual session status updates.`;

const INTERNAL_AGENT_SKILL_MARKDOWN = `---
name: taskflow-internal-api
description: Use Taskflow's internal HTTP API for browser tabs.
---

# Taskflow Internal API

Taskflow sets these environment variables for every agent session:

- \`TASKFLOW_API_URL\`
- \`TASKFLOW_TASK_ID\`
- \`TASKFLOW_PROJECT_ID\`
- \`TASKFLOW_SESSION_ID\`

Use the internal API directly.

## Task context

Read task info and log from prior sessions at the start of your session:

- \`GET $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID\`
- Returns: \`{ "task": {...}, "log": [{...}, ...] }\`

## Task log

Log your findings, progress, and commits so future sessions have context:

- \`POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log\`
- Body: \`{"type":"info|commit|warning|error", "message":"...", "sessionId":"$TASKFLOW_SESSION_ID"}\`
- For commits, add meta: \`{"type":"commit", "message":"...", "sessionId":"...", "meta":{"hash":"abc123"}}\`

## Browser tabs

Open a browser tab in Taskflow:

- Task-scoped session: \`POST $TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser\`
- Project-scoped session: \`POST $TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/browser\`
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

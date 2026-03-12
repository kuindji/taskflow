import { chmod, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentLaunchOptions } from "@taskflow/shared";

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

export const INTERNAL_AGENT_SYSTEM_PROMPT = `You are running inside Taskflow.

Taskflow provides the \`taskflow-cli\` command (already on your PATH) for interacting with the host app.
Environment variables TASKFLOW_API_URL, TASKFLOW_TASK_ID, TASKFLOW_PROJECT_ID, and TASKFLOW_SESSION_ID are set automatically.

Use taskflow-cli proactively:
- At session start, read task context: \`taskflow-cli task\` (returns task info and log from prior sessions).
- Log significant findings: \`taskflow-cli log info "your message"\`
- After committing, log the commit: \`taskflow-cli log commit "commit message" --hash <hash>\`
- Log types: info (findings/progress), commit (commits), warning (concerns), error (failures).
- Open a browser tab: \`taskflow-cli browser "https://..." --label "Optional"\`
- Open a project-scoped browser tab: \`taskflow-cli browser "https://..." --label "Optional" --project\`
Session status is app-controlled, so do not post manual session status updates.`;

const INTERNAL_AGENT_SKILL_MARKDOWN = `---
name: taskflow-internal-api
description: Use Taskflow's taskflow-cli for logging, browser tabs, and task context.
---

# Taskflow CLI

Taskflow puts \`taskflow-cli\` on your PATH and sets these environment variables:

- \`TASKFLOW_API_URL\`
- \`TASKFLOW_TASK_ID\`
- \`TASKFLOW_PROJECT_ID\`
- \`TASKFLOW_SESSION_ID\`

## Task context

Read task info and log from prior sessions:

\`\`\`
taskflow-cli task
\`\`\`

## Task log

Log your findings, progress, and commits so future sessions have context:

\`\`\`
taskflow-cli log info "discovered X"
taskflow-cli log warning "potential issue with Y"
taskflow-cli log error "failed to do Z"
taskflow-cli log commit "fix: resolve race condition" --hash abc123
\`\`\`

## Browser tabs

Open a browser tab in Taskflow:

\`\`\`
taskflow-cli browser "https://example.com" --label "Docs"
taskflow-cli browser "https://example.com" --project
\`\`\`

Use \`--project\` for project-scoped tabs, otherwise tabs are task-scoped.
`;

const CLI_SCRIPT = `#!/bin/sh
set -e

# Taskflow CLI — lightweight wrapper for the Taskflow internal API.
# Environment: TASKFLOW_API_URL, TASKFLOW_TASK_ID, TASKFLOW_SESSION_ID, TASKFLOW_PROJECT_ID

if [ -z "$TASKFLOW_API_URL" ]; then
  echo "Error: TASKFLOW_API_URL is not set" >&2
  exit 1
fi

cmd="\${1:-}"
shift 2>/dev/null || true

case "$cmd" in
  task)
    if [ -z "$TASKFLOW_TASK_ID" ]; then
      echo "Error: TASKFLOW_TASK_ID is not set" >&2
      exit 1
    fi
    curl -sf "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID"
    ;;

  log)
    if [ -z "$TASKFLOW_TASK_ID" ]; then
      echo "Error: TASKFLOW_TASK_ID is not set" >&2
      exit 1
    fi
    log_type="\${1:-}"
    log_message="\${2:-}"
    if [ -z "$log_type" ] || [ -z "$log_message" ]; then
      echo "Usage: taskflow-cli log <type> <message> [--hash <hash>]" >&2
      exit 1
    fi
    shift 2

    hash=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --hash) hash="\${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done

    if [ -n "$hash" ]; then
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \\
        -H "Content-Type: application/json" \\
        -d "{\\"type\\":\\"$log_type\\",\\"message\\":\\"$log_message\\",\\"sessionId\\":\\"$TASKFLOW_SESSION_ID\\",\\"meta\\":{\\"hash\\":\\"$hash\\"}}"
    else
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \\
        -H "Content-Type: application/json" \\
        -d "{\\"type\\":\\"$log_type\\",\\"message\\":\\"$log_message\\",\\"sessionId\\":\\"$TASKFLOW_SESSION_ID\\"}"
    fi
    ;;

  browser)
    url="\${1:-}"
    if [ -z "$url" ]; then
      echo "Usage: taskflow-cli browser <url> [--label <label>] [--project]" >&2
      exit 1
    fi
    shift

    label=""
    project=false
    while [ $# -gt 0 ]; do
      case "$1" in
        --label) label="\${2:-}"; shift 2 ;;
        --project) project=true; shift ;;
        *) shift ;;
      esac
    done

    if [ "$project" = true ]; then
      if [ -z "$TASKFLOW_PROJECT_ID" ]; then
        echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
        exit 1
      fi
      endpoint="$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/browser"
    else
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      endpoint="$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/browser"
    fi

    if [ -n "$label" ]; then
      curl -sf -X POST "$endpoint" \\
        -H "Content-Type: application/json" \\
        -d "{\\"url\\":\\"$url\\",\\"label\\":\\"$label\\"}"
    else
      curl -sf -X POST "$endpoint" \\
        -H "Content-Type: application/json" \\
        -d "{\\"url\\":\\"$url\\"}"
    fi
    ;;

  *)
    echo "Usage: taskflow-cli <command>" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  task                              Get task context and log" >&2
    echo "  log <type> <message> [--hash h]   Log to task (info|commit|warning|error)" >&2
    echo "  browser <url> [--label l] [--project]  Open a browser tab" >&2
    exit 1
    ;;
esac
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

export async function ensureCliScript(binDir: string): Promise<void> {
    const scriptPath = join(binDir, "taskflow-cli");
    await mkdir(binDir, { recursive: true });
    await writeFile(scriptPath, CLI_SCRIPT, "utf8");
    await chmod(scriptPath, 0o755);
}

export function buildAgentLaunchSpec(
    type: "claude" | "codex",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
): { command: string; args: string[] } {
    if (type === "claude") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "claude") {
            if (agentOptions.fullAccess) optionArgs.push("--dangerously-skip-permissions");
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "claude",
            args: [
                ...optionArgs,
                "--allowedTools",
                "Bash(taskflow-cli*)",
                "--append-system-prompt",
                INTERNAL_AGENT_SYSTEM_PROMPT,
                ...(prompt ? [prompt] : []),
            ],
        };
    }

    const optionArgs: string[] = [];
    if (agentOptions?.type === "codex") {
        if (agentOptions.fullAccess) optionArgs.push("--full-auto");
    }
    return {
        command: "codex",
        args: [
            ...optionArgs,
            "-c",
            `developer_instructions="${escapeTomlBasicString(INTERNAL_AGENT_SYSTEM_PROMPT)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? [prompt] : []),
        ],
    };
}

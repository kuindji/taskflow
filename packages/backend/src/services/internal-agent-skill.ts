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
- Create a new task: \`taskflow-cli task create "description" [--title "title"]\`
- Log significant findings: \`taskflow-cli log info "your message"\`
- After committing, log the commit: \`taskflow-cli log commit "commit message" --hash <hash>\`
- Log types: info (findings/progress), commit (commits), warning (concerns), error (failures).
- Open a browser tab: \`taskflow-cli browser "https://..." --label "Optional"\`
- Open a project-scoped browser tab: \`taskflow-cli browser "https://..." --label "Optional" --project\`
- After merging a worktree branch, disable the worktree: \`taskflow-cli task worktree --disable\`
Session status is app-controlled, so do not post manual session status updates.

When running as a flow action (TASKFLOW_FLOW_ID is set):
- Signal action completion: \`taskflow-cli action complete\`
- Save a file artifact: \`taskflow-cli artifact save <type> --path <path>\`
- Save a text artifact: \`taskflow-cli artifact save <type> --text <text>\`
- List all artifacts: \`taskflow-cli artifact list\`
- Get artifact by type: \`taskflow-cli artifact get <type>\``;

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

## Create a task

Create a new task in the current project:

\`\`\`
taskflow-cli task create "Fix login timeout bug"
taskflow-cli task create "Investigate memory leak" --title "Memory leak in auth service"
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

## Worktree management

After merging a task's worktree branch into the project, disable the worktree so future sessions run from the project root:

\`\`\`
taskflow-cli task worktree --disable
\`\`\`

This verifies the branch was merged, removes the worktree from disk, and deletes the branch. It will fail if the branch has not been merged yet.

## Flow commands (available when TASKFLOW_FLOW_ID is set)

Signal that this action is done (the next action starts automatically):

\`\`\`
taskflow-cli action complete
\`\`\`

Save artifacts for use by subsequent actions:

\`\`\`
taskflow-cli artifact save plan --path docs/plan.md
taskflow-cli artifact save summary --text "Brief summary here"
\`\`\`

Read artifacts from prior actions:

\`\`\`
taskflow-cli artifact list
taskflow-cli artifact get plan
\`\`\`
`;

const CLI_SCRIPT = `#!/bin/sh
set -e

# Taskflow CLI — lightweight wrapper for the Taskflow internal API.
# Environment: TASKFLOW_API_URL, TASKFLOW_TASK_ID, TASKFLOW_SESSION_ID, TASKFLOW_PROJECT_ID

if [ -z "$TASKFLOW_API_URL" ]; then
  echo "Error: TASKFLOW_API_URL is not set" >&2
  exit 1
fi

json_string() {
  printf '%s' "$1" | awk '
    BEGIN { printf "\\"" }
    {
      if (NR > 1) {
        printf "\\\\n"
      }
      gsub(/\\\\/, "\\\\\\\\")
      gsub(/"/, "\\\\\\"")
      gsub(/\t/, "\\\\t")
      gsub(/\r/, "\\\\r")
      printf "%s", $0
    }
    END { printf "\\"" }
  '
}

cmd="\${1:-}"
shift 2>/dev/null || true

case "$cmd" in
  task)
    subcmd="\${1:-}"
    if [ "$subcmd" = "worktree" ]; then
      shift
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      disable=false
      while [ $# -gt 0 ]; do
        case "$1" in
          --disable) disable=true; shift ;;
          *) shift ;;
        esac
      done
      if [ "$disable" = true ]; then
        curl -sf -X PATCH "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/worktree" \\
          -H "Content-Type: application/json" \\
          -d "{\\"enabled\\":false}"
      else
        echo "Usage: taskflow-cli task worktree --disable" >&2
        exit 1
      fi
    elif [ "$subcmd" = "create" ]; then
      shift
      if [ -z "$TASKFLOW_PROJECT_ID" ]; then
        echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
        exit 1
      fi
      description="\${1:-}"
      if [ -z "$description" ]; then
        echo "Usage: taskflow-cli task create <description> [--title <title>]" >&2
        exit 1
      fi
      shift

      title=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --title) title="\${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done

      if [ -n "$title" ]; then
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \\
          -H "Content-Type: application/json" \\
          -d "{\\"description\\":\\"$description\\",\\"title\\":\\"$title\\"}"
      else
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \\
          -H "Content-Type: application/json" \\
          -d "{\\"description\\":\\"$description\\"}"
      fi
    else
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      curl -sf "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID"
    fi
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
      payload=$(printf '{"type":%s,"message":%s,"sessionId":%s,"meta":{"hash":%s}}' \
        "$(json_string "$log_type")" \
        "$(json_string "$log_message")" \
        "$(json_string "$TASKFLOW_SESSION_ID")" \
        "$(json_string "$hash")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \\
        -H "Content-Type: application/json" \\
        -d "$payload"
    else
      payload=$(printf '{"type":%s,"message":%s,"sessionId":%s}' \
        "$(json_string "$log_type")" \
        "$(json_string "$log_message")" \
        "$(json_string "$TASKFLOW_SESSION_ID")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \\
        -H "Content-Type: application/json" \\
        -d "$payload"
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
      payload=$(printf '{"url":%s,"label":%s}' \
        "$(json_string "$url")" \
        "$(json_string "$label")")
      curl -sf -X POST "$endpoint" \\
        -H "Content-Type: application/json" \\
        -d "$payload"
    else
      payload=$(printf '{"url":%s}' "$(json_string "$url")")
      curl -sf -X POST "$endpoint" \\
        -H "Content-Type: application/json" \\
        -d "$payload"
    fi
    ;;

  action)
    if [ "\${1:-}" = "complete" ]; then
      if [ -z "$TASKFLOW_FLOW_ID" ]; then
        echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
        exit 1
      fi
      payload=$(printf '{"taskId":%s,"flowId":%s,"sessionId":%s}' \
        "$(json_string "$TASKFLOW_TASK_ID")" \
        "$(json_string "$TASKFLOW_FLOW_ID")" \
        "$(json_string "$TASKFLOW_SESSION_ID")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/flow/action-complete" \\
        -H "Content-Type: application/json" \\
        -d "$payload"
    else
      echo "Usage: taskflow-cli action complete" >&2
      exit 1
    fi
    ;;

  artifact)
    if [ -z "$TASKFLOW_FLOW_ID" ]; then
      echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
      exit 1
    fi
    subcmd="\${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      save)
        artifact_type="\${1:-}"
        if [ -z "$artifact_type" ]; then
          echo "Usage: taskflow-cli artifact save <type> --path <path> | --text <text>" >&2
          exit 1
        fi
        shift
        artifact_path=""
        artifact_text=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --path) artifact_path="\${2:-}"; shift 2 ;;
            --text) artifact_text="\${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -n "$artifact_path" ] && [ -n "$artifact_text" ]; then
          echo "Use either --path or --text, not both" >&2
          exit 1
        fi
        if [ -z "$artifact_path" ] && [ -z "$artifact_text" ]; then
          echo "Either --path or --text is required" >&2
          exit 1
        fi
        if [ -n "$artifact_path" ]; then
          payload=$(printf '{"taskId":%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"path":%s}' \
            "$(json_string "$TASKFLOW_TASK_ID")" \
            "$(json_string "$TASKFLOW_FLOW_ID")" \
            "$(json_string "$TASKFLOW_ACTION_ENTRY_ID")" \
            "$(json_string "$TASKFLOW_SESSION_ID")" \
            "$(json_string "$artifact_type")" \
            "$(json_string "$artifact_path")")
          curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \\
            -H "Content-Type: application/json" \\
            -d "$payload"
        else
          payload=$(printf '{"taskId":%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"text":%s}' \
            "$(json_string "$TASKFLOW_TASK_ID")" \
            "$(json_string "$TASKFLOW_FLOW_ID")" \
            "$(json_string "$TASKFLOW_ACTION_ENTRY_ID")" \
            "$(json_string "$TASKFLOW_SESSION_ID")" \
            "$(json_string "$artifact_type")" \
            "$(json_string "$artifact_text")")
          curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \\
            -H "Content-Type: application/json" \\
            -d "$payload"
        fi
        ;;
      list)
        curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$TASKFLOW_TASK_ID/$TASKFLOW_FLOW_ID"
        ;;
      get)
        artifact_type="\${1:-}"
        if [ -z "$artifact_type" ]; then
          echo "Usage: taskflow-cli artifact get <type>" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$TASKFLOW_TASK_ID/$TASKFLOW_FLOW_ID/$artifact_type"
        ;;
      *)
        echo "Usage: taskflow-cli artifact <save|list|get>" >&2
        exit 1
        ;;
    esac
    ;;

  *)
    echo "Usage: taskflow-cli <command>" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  task                                          Get task context and log" >&2
    echo "  task create <desc> [--title t]                Create a new task in the project" >&2
    echo "  task worktree --disable                       Disable worktree after branch merge" >&2
    echo "  log <type> <message> [--hash h]               Log to task (info|commit|warning|error)" >&2
    echo "  browser <url> [--label l] [--project]         Open a browser tab" >&2
    echo "  action complete                               Signal flow action completion" >&2
    echo "  artifact <save|list|get>                      Manage flow artifacts" >&2
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

export { CLI_SCRIPT };
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

import { chmod, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentLaunchOptions } from "@taskflow/shared";

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

const PROMPT_BASE = `You are running inside Taskflow.

Taskflow provides the \`taskflow-cli\` command (already on your PATH) for interacting with the host app.
Environment variables TASKFLOW_API_URL, TASKFLOW_PROJECT_ID, and TASKFLOW_SESSION_ID are set automatically.

Use taskflow-cli proactively:
- Log significant findings: \`taskflow-cli log info "your message"\`
- After committing, log the commit: \`taskflow-cli log commit "commit message" --hash <hash>\`
- After doing code changes, with quick summary of changes: \`taskflow-cli log info "summary of changes"\`
- Log types: info (findings/progress), commit (commits), warning (concerns), error (failures).
- Open a browser tab: \`taskflow-cli browser "https://..." --label "Optional"\`
- Open a project-scoped browser tab: \`taskflow-cli browser "https://..." --label "Optional" --project\`
Session status is app-controlled, so do not post manual session status updates.`;

const PROMPT_TASK_SCOPE = `
TASKFLOW_TASK_ID is also set — this session is scoped to a specific task.

Use taskflow-cli proactively for task context:
- At session start, read task context: \`taskflow-cli task\` (returns task info and log from prior sessions).
- List all tasks in the project: \`taskflow-cli task list\`
- Create a new task: \`taskflow-cli task create "description" [--title "title"]\`
- After merging a worktree branch, disable the worktree: \`taskflow-cli task worktree --disable\``;

const PROMPT_PROJECT_SCOPE = `
This session is scoped to the project, not a specific task.
Task-related commands (\`taskflow-cli task\`, \`taskflow-cli task list\`, \`taskflow-cli task create\`) are available but should only be used when the user explicitly asks for task operations.`;

const PROMPT_FLOW = `
When running as a flow action (TASKFLOW_FLOW_ID is set):
- Signal action completion: \`taskflow-cli action complete\`
- Save a file artifact: \`taskflow-cli artifact save <type> --path <path>\`
- Save a text artifact: \`taskflow-cli artifact save <type> --text <text>\`
- List all artifacts: \`taskflow-cli artifact list\`
- Get artifact by type: \`taskflow-cli artifact get <type>\``;

export function buildSystemPrompt(isProjectScope: boolean): string {
    const scopeBlock = isProjectScope ? PROMPT_PROJECT_SCOPE : PROMPT_TASK_SCOPE;
    return `${PROMPT_BASE}\n${scopeBlock}\n${PROMPT_FLOW}`;
}

/** @deprecated Use buildSystemPrompt() instead. Kept for tests that assert on common content. */
export const INTERNAL_AGENT_SYSTEM_PROMPT = buildSystemPrompt(false);

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

## List tasks

List all tasks in the current project (returns task IDs, titles, statuses):

\`\`\`
taskflow-cli task list
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
    elif [ "$subcmd" = "list" ]; then
      if [ -z "$TASKFLOW_PROJECT_ID" ]; then
        echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
        exit 1
      fi
      curl -sf "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks"
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
          -d "$(printf '{"description":%s,"title":%s}' "$(json_string "$description")" "$(json_string "$title")")"
      else
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \\
          -H "Content-Type: application/json" \\
          -d "$(printf '{"description":%s}' "$(json_string "$description")")"
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
      if [ -n "$TASKFLOW_TASK_ID" ]; then
        owner_field=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
      else
        owner_field=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
      fi
      payload=$(printf '{%s,"flowId":%s,"sessionId":%s}' \
        "$owner_field" \
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
    # Determine owner ID (task or project)
    if [ -n "$TASKFLOW_TASK_ID" ]; then
      flow_owner_id="$TASKFLOW_TASK_ID"
      owner_field=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
    else
      flow_owner_id="$TASKFLOW_PROJECT_ID"
      owner_field=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
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
          payload=$(printf '{%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"path":%s}' \
            "$owner_field" \
            "$(json_string "$TASKFLOW_FLOW_ID")" \
            "$(json_string "$TASKFLOW_ACTION_ENTRY_ID")" \
            "$(json_string "$TASKFLOW_SESSION_ID")" \
            "$(json_string "$artifact_type")" \
            "$(json_string "$artifact_path")")
          curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \\
            -H "Content-Type: application/json" \\
            -d "$payload"
        else
          payload=$(printf '{%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"text":%s}' \
            "$owner_field" \
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
        curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$flow_owner_id/$TASKFLOW_FLOW_ID"
        ;;
      get)
        artifact_type="\${1:-}"
        if [ -z "$artifact_type" ]; then
          echo "Usage: taskflow-cli artifact get <type>" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$flow_owner_id/$TASKFLOW_FLOW_ID/$artifact_type"
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
    echo "  task list                                     List all tasks in the project" >&2
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
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
    additionalSystemPrompt?: string,
    isProjectScope?: boolean,
): { command: string; args: string[]; env?: Record<string, string> } {
    const basePrompt = buildSystemPrompt(isProjectScope ?? false);
    const systemPrompt = additionalSystemPrompt
        ? `${basePrompt}\n\n${additionalSystemPrompt}`
        : basePrompt;

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
                systemPrompt,
                ...(prompt ? [prompt] : []),
            ],
        };
    }

    if (type === "opencode") {
        const config: Record<string, unknown> = {
            instructions: [skillPath],
        };
        if (agentOptions?.type === "opencode" && agentOptions.fullAccess) {
            config.permission = { edit: "allow", bash: "allow", write: "allow" };
        }

        const args: string[] = [];
        if (agentOptions?.type === "opencode" && agentOptions.model) {
            args.push("--model", agentOptions.model);
        }
        if (prompt) args.push("--prompt", prompt);

        return {
            command: "opencode",
            args,
            env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        };
    }

    if (type === "gemini") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "gemini") {
            if (agentOptions.fullAccess) optionArgs.push("--yolo");
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "gemini",
            args: [
                ...optionArgs,
                ...(prompt ? ["--prompt-interactive", prompt] : []),
            ],
        };
    }

    if (type === "cursor") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "cursor") {
            if (agentOptions.fullAccess) optionArgs.push("--yolo");
            if (agentOptions.model && agentOptions.model !== "default") optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "cursor",
            args: [
                "agent",
                ...optionArgs,
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
            `developer_instructions="${escapeTomlBasicString(systemPrompt)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? [prompt] : []),
        ],
    };
}

#!/bin/sh
set -e

# Taskflow CLI — lightweight wrapper for the Taskflow internal API.
# Environment: TASKFLOW_API_URL, TASKFLOW_TASK_ID, TASKFLOW_SESSION_ID, TASKFLOW_PROJECT_ID

if [ -z "$TASKFLOW_API_URL" ]; then
  echo "Error: TASKFLOW_API_URL is not set" >&2
  exit 1
fi

json_string() {
  printf '%s' "$1" | awk '
    BEGIN { printf "\"" }
    {
      if (NR > 1) {
        printf "\\n"
      }
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      printf "%s", $0
    }
    END { printf "\"" }
  '
}

# Parse global flags before the command
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASKFLOW_TASK_ID="${2:-}"; shift 2 ;;
    *) break ;;
  esac
done

cmd="${1:-}"
shift 2>/dev/null || true

case "$cmd" in
  task)
    subcmd="${1:-}"
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
        curl -sf -X PATCH "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/worktree" \
          -H "Content-Type: application/json" \
          -d "{\"enabled\":false}"
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
      description="${1:-}"
      if [ -z "$description" ]; then
        echo "Usage: taskflow-cli task create <description> [--title <title>]" >&2
        exit 1
      fi
      shift

      title=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --title) title="${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done

      if [ -n "$title" ]; then
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \
          -H "Content-Type: application/json" \
          -d "$(printf '{"description":%s,"title":%s}' "$(json_string "$description")" "$(json_string "$title")")"
      else
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \
          -H "Content-Type: application/json" \
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
    log_type="${1:-}"
    log_message="${2:-}"
    if [ -z "$log_type" ] || [ -z "$log_message" ]; then
      echo "Usage: taskflow-cli log <type> <message> [--hash <hash>]" >&2
      exit 1
    fi
    shift 2

    hash=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --hash) hash="${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done

    if [ -n "$hash" ]; then
      payload=$(printf '{"type":%s,"message":%s,"sessionId":%s,"meta":{"hash":%s}}' \
        "$(json_string "$log_type")" \
        "$(json_string "$log_message")" \
        "$(json_string "$TASKFLOW_SESSION_ID")" \
        "$(json_string "$hash")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \
        -H "Content-Type: application/json" \
        -d "$payload"
    else
      payload=$(printf '{"type":%s,"message":%s,"sessionId":%s}' \
        "$(json_string "$log_type")" \
        "$(json_string "$log_message")" \
        "$(json_string "$TASKFLOW_SESSION_ID")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \
        -H "Content-Type: application/json" \
        -d "$payload"
    fi
    ;;

  browser)
    url="${1:-}"
    if [ -z "$url" ]; then
      echo "Usage: taskflow-cli browser <url> [--label <label>] [--project]" >&2
      exit 1
    fi
    shift

    label=""
    project=false
    while [ $# -gt 0 ]; do
      case "$1" in
        --label) label="${2:-}"; shift 2 ;;
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
      curl -sf -X POST "$endpoint" \
        -H "Content-Type: application/json" \
        -d "$payload"
    else
      payload=$(printf '{"url":%s}' "$(json_string "$url")")
      curl -sf -X POST "$endpoint" \
        -H "Content-Type: application/json" \
        -d "$payload"
    fi
    ;;

  action)
    if [ "${1:-}" = "complete" ]; then
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
      curl -sf -X POST "$TASKFLOW_API_URL/api/flow/action-complete" \
        -H "Content-Type: application/json" \
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
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      save)
        artifact_type="${1:-}"
        if [ -z "$artifact_type" ]; then
          echo "Usage: taskflow-cli artifact save <type> --path <path> | --text <text>" >&2
          exit 1
        fi
        shift
        artifact_path=""
        artifact_text=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --path) artifact_path="${2:-}"; shift 2 ;;
            --text) artifact_text="${2:-}"; shift 2 ;;
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
          curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
            -H "Content-Type: application/json" \
            -d "$payload"
        else
          payload=$(printf '{%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"text":%s}' \
            "$owner_field" \
            "$(json_string "$TASKFLOW_FLOW_ID")" \
            "$(json_string "$TASKFLOW_ACTION_ENTRY_ID")" \
            "$(json_string "$TASKFLOW_SESSION_ID")" \
            "$(json_string "$artifact_type")" \
            "$(json_string "$artifact_text")")
          curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
            -H "Content-Type: application/json" \
            -d "$payload"
        fi
        ;;
      list)
        curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$flow_owner_id/$TASKFLOW_FLOW_ID"
        ;;
      get)
        artifact_type="${1:-}"
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

  flow)
    if [ -z "$TASKFLOW_FLOW_ID" ]; then
      echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
      exit 1
    fi
    if [ -n "$TASKFLOW_TASK_ID" ]; then
      flow_owner_id="$TASKFLOW_TASK_ID"
    elif [ -n "$TASKFLOW_PROJECT_ID" ]; then
      flow_owner_id="$TASKFLOW_PROJECT_ID"
    else
      echo "Error: neither TASKFLOW_TASK_ID nor TASKFLOW_PROJECT_ID is set" >&2
      exit 1
    fi
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      input)
        input_id="${1:-}"
        if [ -z "$input_id" ]; then
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID"
        else
          # Endpoint returns plain text — output directly
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID/$input_id"
        fi
        ;;
      *)
        echo "Usage: taskflow-cli flow <input>" >&2
        exit 1
        ;;
    esac
    ;;

  agent)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      list)
        curl -sf "$TASKFLOW_API_URL/api/agents"
        ;;
      run)
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        agent_type="${1:-}"
        if [ -z "$agent_type" ]; then
          echo "Usage: taskflow-cli agent run <type> [--prompt <prompt>] [--task <id>] [--label <label>]" >&2
          exit 1
        fi
        shift

        agent_prompt=""
        agent_task_id=""
        agent_label=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --prompt) agent_prompt="${2:-}"; shift 2 ;;
            --task) agent_task_id="${2:-}"; shift 2 ;;
            --label) agent_label="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done

        payload=$(printf '"projectId":%s,"type":%s' \
          "$(json_string "$TASKFLOW_PROJECT_ID")" \
          "$(json_string "$agent_type")")
        if [ -n "$agent_task_id" ]; then
          payload=$(printf '%s,"taskId":%s' "$payload" "$(json_string "$agent_task_id")")
        fi
        if [ -n "$agent_prompt" ]; then
          payload=$(printf '%s,"prompt":%s' "$payload" "$(json_string "$agent_prompt")")
        fi
        if [ -n "$agent_label" ]; then
          payload=$(printf '%s,"label":%s' "$payload" "$(json_string "$agent_label")")
        fi

        curl -sf -X POST "$TASKFLOW_API_URL/api/sessions" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      *)
        echo "Usage: taskflow-cli agent <list|run>" >&2
        exit 1
        ;;
    esac
    ;;

  *)
    echo "Usage: taskflow-cli [--task <id>] <command>" >&2
    echo "" >&2
    echo "Global flags:" >&2
    echo "  --task <id>                                   Set task ID for this invocation" >&2
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
    echo "  flow input [<id>]                             Get flow input values" >&2
    echo "  agent list                                    List available agents" >&2
    echo "  agent run <type> [--prompt p] [--task id]     Start a new agent session" >&2
    exit 1
    ;;
esac

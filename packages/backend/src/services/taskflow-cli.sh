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

# Helper to resolve owner ID from env vars
resolve_owner_id() {
  if [ -n "$TASKFLOW_TASK_ID" ]; then
    echo "$TASKFLOW_TASK_ID"
  elif [ -n "$TASKFLOW_PROJECT_ID" ]; then
    echo "$TASKFLOW_PROJECT_ID"
  else
    echo "Error: neither TASKFLOW_TASK_ID nor TASKFLOW_PROJECT_ID is set" >&2
    return 1
  fi
}

# Parse global flags before the command
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASKFLOW_TASK_ID="${2:-}"; shift 2 ;;
    --project-id) TASKFLOW_PROJECT_ID="${2:-}"; shift 2 ;;
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
    elif [ "$subcmd" = "list-archived" ]; then
      curl -sf "$TASKFLOW_API_URL/api/tasks/archived"
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
    elif [ "$subcmd" = "update" ]; then
      shift
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      payload=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --title) payload=$(printf '%s"title":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
          --description) payload=$(printf '%s"description":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
          --notes) payload=$(printf '%s"notes":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
          --pin) payload=$(printf '%s"pinned":true,' "$payload"); shift ;;
          --unpin) payload=$(printf '%s"pinned":false,' "$payload"); shift ;;
          *) shift ;;
        esac
      done
      if [ -z "$payload" ]; then
        echo "Usage: taskflow-cli task update [--title t] [--description d] [--notes n] [--pin] [--unpin]" >&2
        exit 1
      fi
      # Remove trailing comma
      payload=$(printf '%s' "$payload" | sed 's/,$//')
      curl -sf -X PATCH "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID" \
        -H "Content-Type: application/json" \
        -d "{$payload}"
    elif [ "$subcmd" = "archive" ]; then
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/archive"
    elif [ "$subcmd" = "unarchive" ]; then
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/unarchive"
    elif [ "$subcmd" = "delete" ]; then
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      shift
      delete_worktree=false
      while [ $# -gt 0 ]; do
        case "$1" in
          --delete-worktree) delete_worktree=true; shift ;;
          *) shift ;;
        esac
      done
      if [ "$delete_worktree" = true ]; then
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID" \
          -H "Content-Type: application/json" \
          -d '{"deleteWorktree":true}'
      else
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID"
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
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      complete)
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
        ;;
      list)
        curl -sf "$TASKFLOW_API_URL/api/flow-actions"
        ;;
      get)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action get <id>" >&2
          exit 1
        fi
        # Fetch all actions and filter by id
        all_actions=$(curl -sf "$TASKFLOW_API_URL/api/flow-actions")
        # Use awk to extract the matching action object from the JSON array
        printf '%s' "$all_actions" | awk -v id="$action_id" '
          BEGIN { RS="{"; FS="}" }
          NR > 1 {
            obj = "{" $1 "}"
            if (index(obj, "\"id\":\"" id "\"") > 0) {
              print obj
              found = 1
              exit
            }
          }
          END { if (!found) { print "{\"error\":\"Action not found: " id "\"}" > "/dev/stderr"; exit 1 } }
        '
        ;;
      create)
        action_name=""
        action_prompt=""
        action_session_type="claude"
        action_standalone=false
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) action_name="${2:-}"; shift 2 ;;
            --prompt) action_prompt="${2:-}"; shift 2 ;;
            --session-type) action_session_type="${2:-}"; shift 2 ;;
            --standalone) action_standalone=true; shift ;;
            *) shift ;;
          esac
        done
        if [ -z "$action_name" ] || [ -z "$action_prompt" ]; then
          echo "Usage: taskflow-cli action create --name <name> --prompt <prompt> [--session-type claude] [--standalone]" >&2
          exit 1
        fi
        action_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
        now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
        payload=$(printf '{"id":%s,"name":%s,"prompt":%s,"sessionType":%s,"standalone":%s,"createdAt":%s,"updatedAt":%s}' \
          "$(json_string "$action_id")" \
          "$(json_string "$action_name")" \
          "$(json_string "$action_prompt")" \
          "$(json_string "$action_session_type")" \
          "$action_standalone" \
          "$(json_string "$now")" \
          "$(json_string "$now")")
        if [ -n "$TASKFLOW_PROJECT_ID" ]; then
          payload=$(printf '%s' "$payload" | sed "s/}$/,\"projectId\":$(json_string "$TASKFLOW_PROJECT_ID")}/")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flow-actions" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      update)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action update <id> [--name n] [--prompt p] [--session-type t] [--standalone] [--no-standalone]" >&2
          exit 1
        fi
        shift
        # Fetch current action
        current=$(curl -sf "$TASKFLOW_API_URL/api/flow-actions")
        # Extract the action JSON (simple grep-based approach)
        action_json=$(printf '%s' "$current" | awk -v id="$action_id" '
          BEGIN { RS="{"; FS="}" }
          NR > 1 {
            obj = "{" $1 "}"
            if (index(obj, "\"id\":\"" id "\"") > 0) { print obj; exit }
          }
        ')
        if [ -z "$action_json" ]; then
          echo "Error: Action not found: $action_id" >&2
          exit 1
        fi
        # Parse update flags and build overlay fields
        overlay=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) overlay=$(printf '%s"name":%s,' "$overlay" "$(json_string "${2:-}")"); shift 2 ;;
            --prompt) overlay=$(printf '%s"prompt":%s,' "$overlay" "$(json_string "${2:-}")"); shift 2 ;;
            --session-type) overlay=$(printf '%s"sessionType":%s,' "$overlay" "$(json_string "${2:-}")"); shift 2 ;;
            --standalone) overlay=$(printf '%s"standalone":true,' "$overlay"); shift ;;
            --no-standalone) overlay=$(printf '%s"standalone":false,' "$overlay"); shift ;;
            *) shift ;;
          esac
        done
        if [ -z "$overlay" ]; then
          echo "No update fields provided" >&2
          exit 1
        fi
        now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
        overlay=$(printf '%s"updatedAt":%s,' "$overlay" "$(json_string "$now")")
        overlay=$(printf '%s' "$overlay" | sed 's/,$//')
        # Merge: start with existing action JSON, replace closing brace with overlay fields
        merged=$(printf '%s' "$action_json" | sed "s/}$/,$overlay}/")
        curl -sf -X POST "$TASKFLOW_API_URL/api/flow-actions" \
          -H "Content-Type: application/json" \
          -d "$merged"
        ;;
      delete)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action delete <id>" >&2
          exit 1
        fi
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/flow-actions/$action_id"
        ;;
      run)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action run <id> [--prompt <prompt>] [--label <label>]" >&2
          exit 1
        fi
        shift
        run_prompt=""
        run_label=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --prompt) run_prompt="${2:-}"; shift 2 ;;
            --label) run_label="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        payload=""
        if [ -n "$TASKFLOW_TASK_ID" ]; then
          payload=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
        elif [ -n "$TASKFLOW_PROJECT_ID" ]; then
          payload=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
        else
          echo "Error: neither TASKFLOW_TASK_ID nor TASKFLOW_PROJECT_ID is set" >&2
          exit 1
        fi
        if [ -n "$run_prompt" ]; then
          payload=$(printf '%s,"prompt":%s' "$payload" "$(json_string "$run_prompt")")
        fi
        if [ -n "$run_label" ]; then
          payload=$(printf '%s,"label":%s' "$payload" "$(json_string "$run_label")")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flow-actions/$action_id/run" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      *)
        echo "Usage: taskflow-cli action <complete|list|get|create|update|delete|run>" >&2
        exit 1
        ;;
    esac
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
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      input)
        if [ -z "$TASKFLOW_FLOW_ID" ]; then
          echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
          exit 1
        fi
        flow_owner_id=$(resolve_owner_id) || exit 1 || exit 1
        input_id="${1:-}"
        if [ -z "$input_id" ]; then
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID"
        else
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID/$input_id"
        fi
        ;;
      list)
        curl -sf "$TASKFLOW_API_URL/api/flows"
        ;;
      actions)
        curl -sf "$TASKFLOW_API_URL/api/flow-actions"
        ;;
      start)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow start <flowId> [--input key=value ...]" >&2
          exit 1
        fi
        shift

        owner_id=$(resolve_owner_id) || exit 1
        payload=""
        if [ -n "$TASKFLOW_TASK_ID" ]; then
          payload=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
        else
          payload=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
        fi
        payload=$(printf '%s,"flowId":%s' "$payload" "$(json_string "$flow_id")")

        # Collect --input key=value pairs
        input_fields=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --input)
              kv="${2:-}"
              key=$(printf '%s' "$kv" | cut -d= -f1)
              value=$(printf '%s' "$kv" | cut -d= -f2-)
              input_fields=$(printf '%s%s:%s,' "$input_fields" "$(json_string "$key")" "$(json_string "$value")")
              shift 2
              ;;
            *) shift ;;
          esac
        done
        if [ -n "$input_fields" ]; then
          input_fields=$(printf '%s' "$input_fields" | sed 's/,$//')
          payload=$(printf '%s,"inputValues":{%s}' "$payload" "$input_fields")
        fi

        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/start" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      stop)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow stop <flowId>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$owner_id/$flow_id/stop"
        ;;
      pause)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow pause <flowId>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$owner_id/$flow_id/pause"
        ;;
      resume)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow resume <flowId>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$owner_id/$flow_id/resume"
        ;;
      skip)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow skip <flowId>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$owner_id/$flow_id/skip"
        ;;
      jump)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        action_index="${2:-}"
        if [ -z "$flow_id" ] || [ -z "$action_index" ]; then
          echo "Usage: taskflow-cli flow jump <flowId> <actionIndex>" >&2
          exit 1
        fi
        case "$action_index" in
          *[!0-9]*) echo "Error: actionIndex must be a non-negative integer" >&2; exit 1 ;;
        esac
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$owner_id/$flow_id/jump" \
          -H "Content-Type: application/json" \
          -d "{\"actionIndex\":$action_index}"
        ;;
      run)
        owner_id=$(resolve_owner_id) || exit 1
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow run <flowId>" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/flow-runs/$owner_id/$flow_id"
        ;;
      runs)
        owner_id=$(resolve_owner_id) || exit 1
        curl -sf "$TASKFLOW_API_URL/api/flow-runs/$owner_id"
        ;;
      get)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow get <id>" >&2
          exit 1
        fi
        all_flows=$(curl -sf "$TASKFLOW_API_URL/api/flows")
        printf '%s' "$all_flows" | awk -v id="$flow_id" '
          BEGIN { RS="{"; FS="}" }
          NR > 1 {
            obj = "{" $1 "}"
            if (index(obj, "\"id\":\"" id "\"") > 0) {
              print obj
              found = 1
              exit
            }
          }
          END { if (!found) { print "{\"error\":\"Flow not found: " id "\"}" > "/dev/stderr"; exit 1 } }
        '
        ;;
      create)
        flow_name=""
        flow_description=""
        flow_action_ids=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) flow_name="${2:-}"; shift 2 ;;
            --description) flow_description="${2:-}"; shift 2 ;;
            --action) flow_action_ids="$flow_action_ids ${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -z "$flow_name" ]; then
          echo "Usage: taskflow-cli flow create --name <name> --description <desc> [--action <actionId> ...]" >&2
          exit 1
        fi
        flow_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
        now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
        # Build actions array from --action flags
        actions_json="["
        first_action=true
        for aid in $flow_action_ids; do
          entry_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
          if [ "$first_action" = true ]; then
            first_action=false
          else
            actions_json="$actions_json,"
          fi
          actions_json=$(printf '%s{"id":%s,"actionId":%s}' "$actions_json" "$(json_string "$entry_id")" "$(json_string "$aid")")
        done
        actions_json="$actions_json]"
        payload=$(printf '{"id":%s,"name":%s,"description":%s,"actions":%s,"createdAt":%s,"updatedAt":%s}' \
          "$(json_string "$flow_id")" \
          "$(json_string "$flow_name")" \
          "$(json_string "$flow_description")" \
          "$actions_json" \
          "$(json_string "$now")" \
          "$(json_string "$now")")
        if [ -n "$TASKFLOW_PROJECT_ID" ]; then
          payload=$(printf '%s' "$payload" | sed "s/}$/,\"projectId\":$(json_string "$TASKFLOW_PROJECT_ID")}/")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      update)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow update <id> [--name n] [--description d]" >&2
          exit 1
        fi
        shift
        # Fetch current flow
        current=$(curl -sf "$TASKFLOW_API_URL/api/flows")
        flow_json=$(printf '%s' "$current" | awk -v id="$flow_id" '
          BEGIN { RS="{"; FS="}" }
          NR > 1 {
            obj = "{" $1 "}"
            if (index(obj, "\"id\":\"" id "\"") > 0) { print obj; exit }
          }
        ')
        if [ -z "$flow_json" ]; then
          echo "Error: Flow not found: $flow_id" >&2
          exit 1
        fi
        overlay=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) overlay=$(printf '%s"name":%s,' "$overlay" "$(json_string "${2:-}")"); shift 2 ;;
            --description) overlay=$(printf '%s"description":%s,' "$overlay" "$(json_string "${2:-}")"); shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -z "$overlay" ]; then
          echo "No update fields provided" >&2
          exit 1
        fi
        now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
        overlay=$(printf '%s"updatedAt":%s,' "$overlay" "$(json_string "$now")")
        overlay=$(printf '%s' "$overlay" | sed 's/,$//')
        merged=$(printf '%s' "$flow_json" | sed "s/}$/,$overlay}/")
        curl -sf -X POST "$TASKFLOW_API_URL/api/flows" \
          -H "Content-Type: application/json" \
          -d "$merged"
        ;;
      delete)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow delete <id>" >&2
          exit 1
        fi
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/flows/$flow_id"
        ;;
      *)
        echo "Usage: taskflow-cli flow <list|get|actions|create|update|delete|start|stop|pause|resume|skip|jump|run|runs|input>" >&2
        exit 1
        ;;
    esac
    ;;

  notify)
    message="${1:-}"
    if [ -z "$message" ]; then
      echo "Usage: taskflow-cli notify <message>" >&2
      exit 1
    fi
    if [ -z "$TASKFLOW_PROJECT_ID" ]; then
      echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
      exit 1
    fi
    if [ -z "$TASKFLOW_SESSION_ID" ]; then
      echo "Error: TASKFLOW_SESSION_ID is not set" >&2
      exit 1
    fi
    payload=$(printf '{"message":%s}' "$(json_string "$message")")
    curl -sf -X POST "$TASKFLOW_API_URL/api/notifications" \
      -H "Content-Type: application/json" \
      -H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID" \
      -H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID" \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      -d "$payload"
    ;;

  project)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      list)
        curl -sf "$TASKFLOW_API_URL/api/projects"
        ;;
      add)
        proj_path="${1:-}"
        if [ -z "$proj_path" ]; then
          echo "Usage: taskflow-cli project add <path> [--name <name>]" >&2
          exit 1
        fi
        shift
        proj_name=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) proj_name="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        payload=$(printf '"path":%s' "$(json_string "$proj_path")")
        if [ -n "$proj_name" ]; then
          payload=$(printf '%s,"name":%s' "$payload" "$(json_string "$proj_name")")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      remove)
        proj_id="${1:-}"
        if [ -z "$proj_id" ]; then
          echo "Usage: taskflow-cli project remove <id>" >&2
          exit 1
        fi
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/projects/$proj_id"
        ;;
      update)
        proj_id="${1:-}"
        if [ -z "$proj_id" ]; then
          echo "Usage: taskflow-cli project update <id> [--name n] [--path p] [--hidden] [--visible]" >&2
          exit 1
        fi
        shift
        payload=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) payload=$(printf '%s"name":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --path) payload=$(printf '%s"path":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --hidden) payload=$(printf '%s"hidden":true,' "$payload"); shift ;;
            --visible) payload=$(printf '%s"hidden":false,' "$payload"); shift ;;
            *) shift ;;
          esac
        done
        if [ -z "$payload" ]; then
          echo "No update fields provided" >&2
          exit 1
        fi
        payload=$(printf '%s' "$payload" | sed 's/,$//')
        curl -sf -X PATCH "$TASKFLOW_API_URL/api/projects/$proj_id" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      fork)
        proj_id="${1:-}"
        branch="${2:-}"
        if [ -z "$proj_id" ] || [ -z "$branch" ]; then
          echo "Usage: taskflow-cli project fork <id> <branch> [--folder <name>]" >&2
          exit 1
        fi
        shift 2
        folder=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --folder) folder="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        payload=$(printf '"branch":%s' "$(json_string "$branch")")
        if [ -n "$folder" ]; then
          payload=$(printf '%s,"folderName":%s' "$payload" "$(json_string "$folder")")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$proj_id/fork" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      *)
        echo "Usage: taskflow-cli project <list|add|remove|update|fork>" >&2
        exit 1
        ;;
    esac
    ;;

  schedule)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      complete)
        if [ -z "$TASKFLOW_SESSION_ID" ]; then
          echo "Error: TASKFLOW_SESSION_ID is not set" >&2
          exit 1
        fi
        payload=$(printf '{"sessionId":%s}' "$(json_string "$TASKFLOW_SESSION_ID")")
        curl -sf -X POST "$TASKFLOW_API_URL/api/schedules/complete" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      list)
        if [ -n "$TASKFLOW_PROJECT_ID" ]; then
          curl -sf "$TASKFLOW_API_URL/api/schedules?projectId=$TASKFLOW_PROJECT_ID"
        else
          curl -sf "$TASKFLOW_API_URL/api/schedules"
        fi
        ;;
      create)
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        sched_expression=""
        sched_expression_type="rate"
        sched_prompt=""
        sched_name=""
        sched_timeout=""
        sched_agent_type=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --expression) sched_expression="${2:-}"; shift 2 ;;
            --type) sched_expression_type="${2:-}"; shift 2 ;;
            --prompt) sched_prompt="${2:-}"; shift 2 ;;
            --name) sched_name="${2:-}"; shift 2 ;;
            --timeout) sched_timeout="${2:-}"; shift 2 ;;
            --agent) sched_agent_type="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -z "$sched_expression" ]; then
          echo "Usage: taskflow-cli schedule create --expression <expr> [--type cron|rate] [--prompt p] [--name n] [--timeout m] [--agent type]" >&2
          exit 1
        fi
        payload=$(printf '"projectId":%s,"expression":%s,"expressionType":%s' \
          "$(json_string "$TASKFLOW_PROJECT_ID")" \
          "$(json_string "$sched_expression")" \
          "$(json_string "$sched_expression_type")")
        if [ -n "$sched_prompt" ]; then
          payload=$(printf '%s,"prompt":%s' "$payload" "$(json_string "$sched_prompt")")
        fi
        if [ -n "$sched_name" ]; then
          payload=$(printf '%s,"name":%s' "$payload" "$(json_string "$sched_name")")
        fi
        if [ -n "$sched_timeout" ]; then
          case "$sched_timeout" in
            *[!0-9]*) echo "Error: timeout must be a positive integer (minutes)" >&2; exit 1 ;;
          esac
          payload=$(printf '%s,"timeout":%s' "$payload" "$sched_timeout")
        fi
        if [ -n "$sched_agent_type" ]; then
          payload=$(printf '%s,"agentType":%s' "$payload" "$(json_string "$sched_agent_type")")
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/schedules" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      update)
        sched_id="${1:-}"
        if [ -z "$sched_id" ]; then
          echo "Usage: taskflow-cli schedule update <id> [--name n] [--prompt p] [--expression e] [--type cron|rate] [--timeout m] [--enable] [--disable]" >&2
          exit 1
        fi
        shift
        payload=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) payload=$(printf '%s"name":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --prompt) payload=$(printf '%s"prompt":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --expression) payload=$(printf '%s"expression":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --type) payload=$(printf '%s"expressionType":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --timeout)
              case "${2:-}" in
                ''|*[!0-9]*) echo "Error: timeout must be a positive integer (minutes)" >&2; exit 1 ;;
              esac
              payload=$(printf '%s"timeout":%s,' "$payload" "${2:-}"); shift 2 ;;
            --enable) payload=$(printf '%s"enabled":true,' "$payload"); shift ;;
            --disable) payload=$(printf '%s"enabled":false,' "$payload"); shift ;;
            *) shift ;;
          esac
        done
        if [ -z "$payload" ]; then
          echo "No update fields provided" >&2
          exit 1
        fi
        payload=$(printf '%s' "$payload" | sed 's/,$//')
        curl -sf -X PATCH "$TASKFLOW_API_URL/api/schedules/$sched_id" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      delete)
        sched_id="${1:-}"
        if [ -z "$sched_id" ]; then
          echo "Usage: taskflow-cli schedule delete <id>" >&2
          exit 1
        fi
        curl -sf -X DELETE "$TASKFLOW_API_URL/api/schedules/$sched_id"
        ;;
      trigger)
        sched_id="${1:-}"
        if [ -z "$sched_id" ]; then
          echo "Usage: taskflow-cli schedule trigger <id>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/schedules/$sched_id/trigger"
        ;;
      *)
        echo "Usage: taskflow-cli schedule <complete|list|create|update|delete|trigger>" >&2
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

        # First positional arg is agent type (optional — if it starts with --, it's a flag)
        agent_type=""
        if [ $# -gt 0 ]; then
          case "$1" in
            --*) ;;  # not a type, leave for flag parsing
            *) agent_type="$1"; shift ;;
          esac
        fi

        agent_prompt=""
        agent_task_id=""
        agent_label=""
        agent_full_access=""
        agent_model=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --prompt) agent_prompt="${2:-}"; shift 2 ;;
            --task) agent_task_id="${2:-}"; shift 2 ;;
            --label) agent_label="${2:-}"; shift 2 ;;
            --full-access) agent_full_access="true"; shift ;;
            --model) agent_model="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done

        payload=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
        if [ -n "$agent_type" ]; then
          payload=$(printf '%s,"type":%s' "$payload" "$(json_string "$agent_type")")
        fi
        if [ -n "$agent_task_id" ]; then
          payload=$(printf '%s,"taskId":%s' "$payload" "$(json_string "$agent_task_id")")
        fi
        if [ -n "$agent_prompt" ]; then
          payload=$(printf '%s,"prompt":%s' "$payload" "$(json_string "$agent_prompt")")
        fi
        if [ -n "$agent_label" ]; then
          payload=$(printf '%s,"label":%s' "$payload" "$(json_string "$agent_label")")
        fi
        # Build agentOptions if --full-access or --model was provided
        if [ -n "$agent_full_access" ] || [ -n "$agent_model" ]; then
          agent_opts=""
          if [ -n "$agent_type" ]; then
            agent_opts=$(printf '"type":%s' "$(json_string "$agent_type")")
          fi
          if [ -n "$agent_full_access" ]; then
            if [ -n "$agent_opts" ]; then
              agent_opts=$(printf '%s,"fullAccess":true' "$agent_opts")
            else
              agent_opts='"fullAccess":true'
            fi
          fi
          if [ -n "$agent_model" ]; then
            if [ -n "$agent_opts" ]; then
              agent_opts=$(printf '%s,"model":%s' "$agent_opts" "$(json_string "$agent_model")")
            else
              agent_opts=$(printf '"model":%s' "$(json_string "$agent_model")")
            fi
          fi
          payload=$(printf '%s,"agentOptions":{%s}' "$payload" "$agent_opts")
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

  session)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      rename)
        sess_id="${1:-}"
        sess_label="${2:-}"
        if [ -z "$sess_id" ] || [ -z "$sess_label" ]; then
          echo "Usage: taskflow-cli session rename <sessionId> <label>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/rename" \
          -H "Content-Type: application/json" \
          -d "$(printf '{"label":%s}' "$(json_string "$sess_label")")"
        ;;
      snapshot)
        sess_id="${1:-}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session snapshot <sessionId>" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/snapshot"
        ;;
      close)
        sess_id="${1:-}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session close <sessionId>" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/done"
        ;;
      status)
        sess_id="${1:-}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session status <sessionId>" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/status"
        ;;
      input)
        sess_id="${1:-}"
        shift 2>/dev/null || true
        raw_flag=false
        msg_parts=""
        for arg in "$@"; do
          if [ "$arg" = "--raw" ]; then
            raw_flag=true
          else
            msg_parts="$msg_parts $arg"
          fi
        done
        sess_msg="${msg_parts# }"
        if [ -z "$sess_id" ] || [ -z "$sess_msg" ]; then
          echo "Usage: taskflow-cli session input <sessionId> <message> [--raw]" >&2
          exit 1
        fi
        curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/input" \
          -H "Content-Type: application/json" \
          -d "$(printf '{"data":%s,"raw":%s}' "$(json_string "$sess_msg")" "$raw_flag")"
        ;;
      tail)
        sess_id="${1:-}"
        shift 2>/dev/null || true
        tail_lines=100
        for arg in "$@"; do
          case "$arg" in
            --lines) tail_lines="__next__" ;;
            *)
              if [ "$tail_lines" = "__next__" ]; then
                tail_lines="$arg"
              fi
              ;;
          esac
        done
        if [ "$tail_lines" = "__next__" ]; then
          tail_lines=100
        fi
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session tail <sessionId> [--lines N]" >&2
          exit 1
        fi
        curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/tail?lines=$tail_lines"
        ;;
      *)
        echo "Usage: taskflow-cli session <rename|snapshot|close|status|input|tail>" >&2
        exit 1
        ;;
    esac
    ;;

  system)
    subcmd="${1:-}"
    case "$subcmd" in
      info) curl -sf "$TASKFLOW_API_URL/api/system/info" ;;
      shells) curl -sf "$TASKFLOW_API_URL/api/shells" ;;
      runtimes) curl -sf "$TASKFLOW_API_URL/api/runtimes" ;;
      *)
        echo "Usage: taskflow-cli system <info|shells|runtimes>" >&2
        exit 1
        ;;
    esac
    ;;

  settings)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      get)
        curl -sf "$TASKFLOW_API_URL/api/settings"
        ;;
      *)
        echo "Usage: taskflow-cli settings <get>" >&2
        exit 1
        ;;
    esac
    ;;

  app-name)
    curl -sf "$TASKFLOW_API_URL/api/app-name"
    ;;

  *)
    echo "Usage: taskflow-cli [--task <id>] [--project-id <id>] <command>" >&2
    echo "" >&2
    echo "Global flags:" >&2
    echo "  --task <id>                                   Set task ID for this invocation" >&2
    echo "  --project-id <id>                             Set project ID for this invocation" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  task                                          Get task context and log" >&2
    echo "  task list                                     List all tasks in the project" >&2
    echo "  task list-archived                            List archived tasks" >&2
    echo "  task create <desc> [--title t]                Create a new task" >&2
    echo "  task update [--title t] [--pin] [--unpin]     Update task fields" >&2
    echo "  task archive                                  Archive the current task" >&2
    echo "  task unarchive                                Unarchive the current task" >&2
    echo "  task delete [--delete-worktree]               Delete the current task" >&2
    echo "  task worktree --disable                       Disable worktree after merge" >&2
    echo "  log <type> <message> [--hash h]               Log to task" >&2
    echo "  browser <url> [--label l] [--project]         Open a browser tab" >&2
    echo "  project <list|add|remove|update|fork>         Manage projects" >&2
    echo "  session <rename|snapshot|close>               Manage sessions" >&2
    echo "  action <list|get|create|update|delete|run>     Manage and run actions" >&2
    echo "  action complete                               Signal flow action completion" >&2
    echo "  flow <list|get|create|update|delete|...>      Manage and run flows" >&2
    echo "  artifact <save|list|get>                      Manage flow artifacts" >&2
    echo "  schedule <list|create|update|delete|trigger>  Manage schedules" >&2
    echo "  agent <list|run>                              Manage agents" >&2
    echo "  notify <message>                              Send a desktop notification" >&2
    echo "  settings get                                  Get current settings" >&2
    echo "  app-name                                     Get the application display name" >&2
    echo "  system <info|shells|runtimes>                 System information" >&2
    exit 1
    ;;
esac

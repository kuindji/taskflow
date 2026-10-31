#!/bin/sh
set -e

# Taskflow CLI — lightweight wrapper for the Taskflow internal API.
# Environment: TASKFLOW_API_URL, TASKFLOW_TASK_ID, TASKFLOW_SESSION_ID, TASKFLOW_PROJECT_ID
# When TASKFLOW_SESSION_ID is set, TASKFLOW_TASK_ID / TASKFLOW_PROJECT_ID are
# replaced by the session's current owner, so a moved session acts on its new one.

if [ -z "$TASKFLOW_API_URL" ]; then
  echo "Error: TASKFLOW_API_URL is not set" >&2
  exit 1
fi

# Every request goes through here. The token reaches curl as a config file on
# stdin (`-K -`), never in argv, where `ps` shows it to every local user.
tf_curl() {
  if [ -n "$TASKFLOW_API_TOKEN" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$TASKFLOW_API_TOKEN" | curl -K - "$@"
  else
    curl "$@"
  fi
}

# Paths the backend stores or opens later: its working directory is not the
# caller's, so a relative path goes out joined to $PWD. Empty stays empty for
# the backend to refuse.
abs_path() {
  case "$1" in
    /*|'') printf '%s' "$1" ;;
    *) printf '%s/%s' "$PWD" "$1" ;;
  esac
}

# One URL path segment for a free-form value (an artifact label such as
# "code review"): every byte goes out as %XX, so no character of it can end
# the segment or the path.
url_encode() {
  printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'
}

# The extra newline makes awk see the text's own trailing newline as a line
# break instead of dropping it. Control characters other than tab, newline and
# carriage return go out as \u00XX: raw JSON rejects them, and `session input
# --raw` exists to send keys such as Ctrl-C or Escape.
json_string() {
  printf '%s\n' "$1" | awk '
    BEGIN {
      printf "\""
      for (i = 1; i < 32; i++) ctl[sprintf("%c", i)] = sprintf("\\u%04x", i)
    }
    {
      if (NR > 1) {
        printf "\\n"
      }
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      line = $0
      out = ""
      while (match(line, /[\001-\010\013\014\016-\037]/)) {
        out = out substr(line, 1, RSTART - 1) ctl[substr(line, RSTART, 1)]
        line = substr(line, RSTART + 1)
      }
      printf "%s", out line
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

# The flow run this flow-action session belongs to, as a URL owner id
# (flow_owner_id) and a request field (owner_field). A flow started in the
# master workspace gives its sessions neither id, and flow sessions cannot be
# moved, so "neither" means the master workspace.
set_flow_owner() {
  if [ -n "$TASKFLOW_TASK_ID" ]; then
    flow_owner_id="$TASKFLOW_TASK_ID"
    owner_field=$(printf '"taskId":%s' "$(json_string "$TASKFLOW_TASK_ID")")
  elif [ -n "$TASKFLOW_PROJECT_ID" ]; then
    flow_owner_id="$TASKFLOW_PROJECT_ID"
    owner_field=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
  else
    flow_owner_id="__master__"
    owner_field='"master":true'
  fi
}

# Unlike `curl -sf` used elsewhere in this script, this prints the API's
# error body. Some writes fail for actionable reasons (duplicate attribute
# name, an unmovable session, an invalid dev server) and an agent needs to
# read them. It also sends the caller's context headers, which routes that
# act on "the caller's owner" read and every other route ignores.
api_request() {
  req_method="$1"
  req_url="$2"
  req_body="${3:-}"
  if [ -n "$req_body" ]; then
    req_out=$(tf_curl -s -w '\n%{http_code}' -X "$req_method" "$req_url" \
      ${TASKFLOW_PROJECT_ID:+-H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID"} \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      ${TASKFLOW_SESSION_ID:+-H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID"} \
      -H "Content-Type: application/json" -d "$req_body") \
      || { echo "Error: unable to reach $TASKFLOW_API_URL" >&2; exit 1; }
  else
    req_out=$(tf_curl -s -w '\n%{http_code}' -X "$req_method" "$req_url" \
      ${TASKFLOW_PROJECT_ID:+-H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID"} \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      ${TASKFLOW_SESSION_ID:+-H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID"}) \
      || { echo "Error: unable to reach $TASKFLOW_API_URL" >&2; exit 1; }
  fi
  req_code=$(printf '%s' "$req_out" | tail -n1)
  printf '%s' "$req_out" | sed '$d'
  case "$req_code" in
    2*) ;;
    *) echo "Error: $req_method $req_url returned $req_code" >&2; exit 1 ;;
  esac
}

# Parse global flags before the command
owner_flag_given=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASKFLOW_TASK_ID="${2:-}"; owner_flag_given=1; shift 2 ;;
    --project-id) TASKFLOW_PROJECT_ID="${2:-}"; owner_flag_given=1; shift 2 ;;
    *) break ;;
  esac
done

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      tf_curl -sf "$TASKFLOW_API_URL/api/cli-help"
      exit 0
      ;;
  esac
done

# A moved session's env still names the owner it started in. Unless the
# caller named one, ask the backend where this session lives now. Any
# failure (headless sessions are unknown to it) or a reply that names no
# owner keeps the env values.
if [ -z "$owner_flag_given" ] && [ -n "$TASKFLOW_SESSION_ID" ]; then
  if owner_json=$(tf_curl -sf "$TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/owner" 2>/dev/null) \
    && printf '%s' "$owner_json" | grep -Eq '"(taskId|projectId)":"|"master":true'; then
    TASKFLOW_TASK_ID=$(printf '%s' "$owner_json" | sed -n 's/.*"taskId":"\([^"]*\)".*/\1/p')
    TASKFLOW_PROJECT_ID=$(printf '%s' "$owner_json" | sed -n 's/.*"projectId":"\([^"]*\)".*/\1/p')
  fi
fi

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
        tf_curl -sf -X PATCH "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/worktree" \
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
      tf_curl -sf "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks"
    elif [ "$subcmd" = "list-archived" ]; then
      tf_curl -sf "$TASKFLOW_API_URL/api/tasks/archived"
    elif [ "$subcmd" = "create" ]; then
      shift
      if [ -z "$TASKFLOW_PROJECT_ID" ]; then
        echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
        exit 1
      fi
      description="${1:-}"
      if [ -z "$description" ]; then
        echo "Usage: taskflow-cli task create <description> [--title <title>] [--worktree] [--init <command>]" >&2
        exit 1
      fi
      shift

      title=""
      worktree=""
      init_command=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --title) title="${2:-}"; shift 2 ;;
          --worktree) worktree="true"; shift ;;
          --init) init_command="${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done

      json_body="$(printf '"description":%s' "$(json_string "$description")")"
      if [ -n "$title" ]; then
        json_body="$(printf '%s,"title":%s' "$json_body" "$(json_string "$title")")"
      fi
      if [ -n "$worktree" ]; then
        json_body="$json_body,\"worktree\":true"
      fi
      if [ -n "$init_command" ]; then
        json_body="$(printf '%s,"initCommand":%s' "$json_body" "$(json_string "$init_command")")"
      fi

      tf_curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$TASKFLOW_PROJECT_ID/tasks" \
        -H "Content-Type: application/json" \
        -d "{$json_body}"
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
      tf_curl -sf -X PATCH "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID" \
        -H "Content-Type: application/json" \
        -d "{$payload}"
    elif [ "$subcmd" = "archive" ]; then
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      tf_curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/archive"
    elif [ "$subcmd" = "unarchive" ]; then
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      tf_curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/unarchive"
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
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID" \
          -H "Content-Type: application/json" \
          -d '{"deleteWorktree":true}'
      else
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID"
      fi
    else
      if [ -z "$TASKFLOW_TASK_ID" ]; then
        echo "Error: TASKFLOW_TASK_ID is not set" >&2
        exit 1
      fi
      tf_curl -sf "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID"
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
      tf_curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \
        -H "Content-Type: application/json" \
        -d "$payload"
    else
      payload=$(printf '{"type":%s,"message":%s,"sessionId":%s}' \
        "$(json_string "$log_type")" \
        "$(json_string "$log_message")" \
        "$(json_string "$TASKFLOW_SESSION_ID")")
      tf_curl -sf -X POST "$TASKFLOW_API_URL/api/tasks/$TASKFLOW_TASK_ID/log" \
        -H "Content-Type: application/json" \
        -d "$payload"
    fi
    ;;

  browser)
    browser_usage() {
      echo "Usage: taskflow-cli browser open <url> [--label <label>] [--project|--master] | list [--project|--master] | close <tabId>" >&2
      exit 1
    }
    subcmd="${1:-}"
    [ -n "$subcmd" ] || browser_usage
    case "$subcmd" in
      close)
        shift
        [ $# -eq 1 ] && [ -n "$1" ] || browser_usage
        api_request DELETE "$TASKFLOW_API_URL/api/browser/tabs/$1"
        ;;
      *)
        if [ "$subcmd" = list ]; then
          method=GET
          shift
        else
          method=POST
          if [ "$subcmd" = open ]; then shift; fi
          url="${1:-}"
          case "$url" in ""|-*) browser_usage ;; esac
          shift
        fi
        label=""
        scope=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --label)
              [ "$method" = POST ] && [ $# -ge 2 ] && [ -n "$2" ] || browser_usage
              label="$2"
              shift 2
              ;;
            --project|--master)
              next_scope="${1#--}"
              [ -z "$scope" ] || [ "$scope" = "$next_scope" ] || browser_usage
              scope="$next_scope"
              shift
              ;;
            *) browser_usage ;;
          esac
        done
        endpoint="$TASKFLOW_API_URL/api/browser/tabs"
        if [ "$method" = GET ]; then
          if [ -n "$scope" ]; then endpoint="$endpoint?scope=$scope"; fi
          api_request GET "$endpoint"
        else
          payload=$(printf '{"url":%s' "$(json_string "$url")")
          if [ -n "$label" ]; then payload="$payload,\"label\":$(json_string "$label")"; fi
          if [ -n "$scope" ]; then payload="$payload,\"scope\":$(json_string "$scope")"; fi
          api_request POST "$endpoint" "$payload}"
        fi
        ;;
    esac
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
        set_flow_owner
        payload=$(printf '{%s,"flowId":%s,"sessionId":%s}' \
          "$owner_field" \
          "$(json_string "$TASKFLOW_FLOW_ID")" \
          "$(json_string "$TASKFLOW_SESSION_ID")")
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow/action-complete" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      list)
        tf_curl -sf "$TASKFLOW_API_URL/api/flow-actions"
        ;;
      get)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action get <id>" >&2
          exit 1
        fi
        api_request GET "$TASKFLOW_API_URL/api/flow-actions/$action_id"
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow-actions" \
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
        # The backend merges the fields into the stored action and stamps
        # updatedAt. The trailing comma is cut with ${%,}, not sed, which
        # would rewrite & and \ in the values.
        api_request PATCH "$TASKFLOW_API_URL/api/flow-actions/$action_id" "{${overlay%,}}"
        ;;
      delete)
        action_id="${1:-}"
        if [ -z "$action_id" ]; then
          echo "Usage: taskflow-cli action delete <id>" >&2
          exit 1
        fi
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/flow-actions/$action_id"
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow-actions/$action_id/run" \
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
    set_flow_owner
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
          artifact_path=$(abs_path "$artifact_path")
          payload=$(printf '{%s,"flowId":%s,"actionEntryId":%s,"sessionId":%s,"type":%s,"path":%s}' \
            "$owner_field" \
            "$(json_string "$TASKFLOW_FLOW_ID")" \
            "$(json_string "$TASKFLOW_ACTION_ENTRY_ID")" \
            "$(json_string "$TASKFLOW_SESSION_ID")" \
            "$(json_string "$artifact_type")" \
            "$(json_string "$artifact_path")")
          tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
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
          tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow/artifact" \
            -H "Content-Type: application/json" \
            -d "$payload"
        fi
        ;;
      list)
        tf_curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$flow_owner_id/$TASKFLOW_FLOW_ID"
        ;;
      get)
        artifact_type="${1:-}"
        if [ -z "$artifact_type" ]; then
          echo "Usage: taskflow-cli artifact get <type>" >&2
          exit 1
        fi
        tf_curl -sf "$TASKFLOW_API_URL/api/flow/artifact/$flow_owner_id/$TASKFLOW_FLOW_ID/$(url_encode "$artifact_type")"
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
      complete)
        if [ -z "$TASKFLOW_FLOW_ID" ]; then
          echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
          exit 1
        fi
        # Unlike "action complete", the session id is required: completeFlow only
        # acts when it matches the current action's session, so an empty value
        # would post successfully, do nothing, and still print {"success":true}.
        if [ -z "$TASKFLOW_SESSION_ID" ]; then
          echo "Error: TASKFLOW_SESSION_ID is not set" >&2
          exit 1
        fi
        set_flow_owner
        payload=$(printf '{%s,"flowId":%s,"sessionId":%s}' \
          "$owner_field" \
          "$(json_string "$TASKFLOW_FLOW_ID")" \
          "$(json_string "$TASKFLOW_SESSION_ID")")
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flow/complete" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      input)
        if [ -z "$TASKFLOW_FLOW_ID" ]; then
          echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
          exit 1
        fi
        set_flow_owner
        input_id="${1:-}"
        if [ -z "$input_id" ]; then
          tf_curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID"
        else
          tf_curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID/$input_id"
        fi
        ;;
      list)
        tf_curl -sf "$TASKFLOW_API_URL/api/flows"
        ;;
      actions)
        tf_curl -sf "$TASKFLOW_API_URL/api/flow-actions"
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
              # Split on the first "=" without line tools: values may be
              # multiline. A pair with no key is skipped, as on Windows.
              case "$kv" in
                ?*=*)
                  key="${kv%%=*}"
                  value="${kv#*=}"
                  input_fields=$(printf '%s%s:%s,' "$input_fields" "$(json_string "$key")" "$(json_string "$value")")
                  ;;
              esac
              shift 2
              ;;
            *) shift ;;
          esac
        done
        if [ -n "$input_fields" ]; then
          input_fields=$(printf '%s' "$input_fields" | sed 's/,$//')
          payload=$(printf '%s,"inputValues":{%s}' "$payload" "$input_fields")
        fi

        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/start" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      stop)
        set_flow_owner
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow stop <flowId>" >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$flow_owner_id/$flow_id/stop"
        ;;
      pause)
        set_flow_owner
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow pause <flowId>" >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$flow_owner_id/$flow_id/pause"
        ;;
      resume)
        set_flow_owner
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow resume <flowId>" >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$flow_owner_id/$flow_id/resume"
        ;;
      skip)
        set_flow_owner
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow skip <flowId>" >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$flow_owner_id/$flow_id/skip"
        ;;
      jump)
        set_flow_owner
        flow_id="${1:-}"
        action_index="${2:-}"
        if [ -z "$flow_id" ] || [ -z "$action_index" ]; then
          echo "Usage: taskflow-cli flow jump <flowId> <actionIndex>" >&2
          exit 1
        fi
        case "$action_index" in
          *[!0-9]*) echo "Error: actionIndex must be a non-negative integer" >&2; exit 1 ;;
        esac
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows/$flow_owner_id/$flow_id/jump" \
          -H "Content-Type: application/json" \
          -d "{\"actionIndex\":$action_index}"
        ;;
      status)
        set_flow_owner
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          tf_curl -sf "$TASKFLOW_API_URL/api/flow-runs/$flow_owner_id"
        else
          tf_curl -sf "$TASKFLOW_API_URL/api/flow-runs/$flow_owner_id/$flow_id"
        fi
        ;;
      get)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow get <id>" >&2
          exit 1
        fi
        api_request GET "$TASKFLOW_API_URL/api/flows/$flow_id"
        ;;
      create)
        flow_name=""
        flow_description=""
        flow_action_ids=""
        flow_loop=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) flow_name="${2:-}"; shift 2 ;;
            --description) flow_description="${2:-}"; shift 2 ;;
            --action) flow_action_ids="$flow_action_ids ${2:-}"; shift 2 ;;
            --loop)
              if [ "$flow_loop" = "false" ]; then
                echo "Error: --loop and --no-loop are mutually exclusive" >&2
                exit 1
              fi
              flow_loop="true"; shift ;;
            --no-loop)
              if [ "$flow_loop" = "true" ]; then
                echo "Error: --loop and --no-loop are mutually exclusive" >&2
                exit 1
              fi
              flow_loop="false"; shift ;;
            *) shift ;;
          esac
        done
        if [ -z "$flow_name" ]; then
          echo "Usage: taskflow-cli flow create --name <name> --description <desc> [--action <actionId> ...] [--loop|--no-loop]" >&2
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
        # No json_string here: flow_loop is already the bare JSON literal true or
        # false, and quoting it would fail the backend's boolean validation.
        # An empty flow_loop omits the key entirely.
        if [ -n "$flow_loop" ]; then
          payload=$(printf '%s' "$payload" | sed "s/}$/,\"loop\":$flow_loop}/")
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/flows" \
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
        api_request PATCH "$TASKFLOW_API_URL/api/flows/$flow_id" "{${overlay%,}}"
        ;;
      delete)
        flow_id="${1:-}"
        if [ -z "$flow_id" ]; then
          echo "Usage: taskflow-cli flow delete <id>" >&2
          exit 1
        fi
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/flows/$flow_id"
        ;;
      *)
        echo "Usage: taskflow-cli flow <list|get|actions|create|update|delete|start|stop|pause|resume|skip|jump|run|runs|input|complete>" >&2
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
    tf_curl -sf -X POST "$TASKFLOW_API_URL/api/notifications" \
      -H "Content-Type: application/json" \
      -H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID" \
      -H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID" \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      -d "$payload"
    ;;

  devserver)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      add)
        ds_pid=""
        ds_label=""
        ds_usage='Usage: taskflow-cli devserver add --pid <pid> --label "<label>"'
        while [ $# -gt 0 ]; do
          case "$1" in
            --pid|--label)
              if [ $# -lt 2 ]; then echo "$ds_usage" >&2; exit 1; fi
              case "$1" in
                --pid) ds_pid="$2" ;;
                --label) ds_label="$2" ;;
              esac
              shift 2
              ;;
            *) echo "$ds_usage" >&2; exit 1 ;;
          esac
        done
        case "$ds_pid" in
          ''|*[!0-9]*) echo "$ds_usage" >&2; exit 1 ;;
        esac
        if [ -z "$ds_label" ]; then echo "$ds_usage" >&2; exit 1; fi
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        # "007" is not valid JSON; send 7.
        ds_pid=$(printf '%s' "$ds_pid" | sed 's/^0*\([0-9]\)/\1/')
        api_request POST "$TASKFLOW_API_URL/api/dev-servers" \
          "$(printf '{"pid":%s,"label":%s}' "$ds_pid" "$(json_string "$ds_label")")"
        ;;
      list)
        ds_all=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --all) ds_all=1; shift ;;
            *) echo "Usage: taskflow-cli devserver list [--all]" >&2; exit 1 ;;
          esac
        done
        if [ -n "$ds_all" ]; then
          api_request GET "$TASKFLOW_API_URL/api/dev-servers?all=1"
        else
          if [ -z "$TASKFLOW_PROJECT_ID" ]; then
            echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
            exit 1
          fi
          api_request GET "$TASKFLOW_API_URL/api/dev-servers"
        fi
        ;;
      remove)
        ds_id=""
        ds_pid=""
        ds_by_pid=""
        ds_given=0
        ds_usage="Usage: taskflow-cli devserver remove <id> | --pid <pid>"
        while [ $# -gt 0 ]; do
          case "$1" in
            --pid)
              if [ $# -lt 2 ]; then echo "$ds_usage" >&2; exit 1; fi
              ds_pid="$2"
              ds_by_pid=1
              ds_given=$((ds_given + 1))
              shift 2
              ;;
            -*) echo "$ds_usage" >&2; exit 1 ;;
            *)
              ds_id="$1"
              ds_given=$((ds_given + 1))
              shift
              ;;
          esac
        done
        if [ "$ds_given" -ne 1 ]; then echo "$ds_usage" >&2; exit 1; fi
        if [ -n "$ds_by_pid" ]; then
          case "$ds_pid" in
            ''|*[!0-9]*) echo "$ds_usage" >&2; exit 1 ;;
          esac
        elif [ -z "$ds_id" ]; then
          echo "$ds_usage" >&2
          exit 1
        fi
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        if [ -n "$ds_by_pid" ]; then
          ds_pid=$(printf '%s' "$ds_pid" | sed 's/^0*\([0-9]\)/\1/')
          api_request DELETE "$TASKFLOW_API_URL/api/dev-servers?pid=$ds_pid"
        else
          api_request DELETE "$TASKFLOW_API_URL/api/dev-servers/$ds_id"
        fi
        ;;
      *)
        echo "Usage: taskflow-cli devserver <add|list|remove>" >&2
        exit 1
        ;;
    esac
    ;;

  project)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      list)
        tf_curl -sf "$TASKFLOW_API_URL/api/projects"
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
        payload=$(printf '"path":%s' "$(json_string "$(abs_path "$proj_path")")")
        if [ -n "$proj_name" ]; then
          payload=$(printf '%s,"name":%s' "$payload" "$(json_string "$proj_name")")
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/projects" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      remove)
        proj_id="${1:-}"
        if [ -z "$proj_id" ]; then
          echo "Usage: taskflow-cli project remove <id>" >&2
          exit 1
        fi
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/projects/$proj_id"
        ;;
      update)
        proj_id="${1:-}"
        if [ -z "$proj_id" ]; then
          echo "Usage: taskflow-cli project update <id> [--name n] [--path p] [--hidden] [--visible] [--claude-account a] [--codex-account a]" >&2
          exit 1
        fi
        shift
        payload=""
        proj_claude_account=""
        proj_codex_account=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) payload=$(printf '%s"name":%s,' "$payload" "$(json_string "${2:-}")"); shift 2 ;;
            --path) payload=$(printf '%s"path":%s,' "$payload" "$(json_string "$(abs_path "${2:-}")")"); shift 2 ;;
            --hidden) payload=$(printf '%s"hidden":true,' "$payload"); shift ;;
            --visible) payload=$(printf '%s"hidden":false,' "$payload"); shift ;;
            --claude-account) proj_claude_account="${2:-}"; shift 2 ;;
            --codex-account) proj_codex_account="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        _account_json() {
          if [ "$1" = "inherit" ]; then printf 'null'; else json_string "$1"; fi
        }
        accounts=""
        if [ -n "$proj_claude_account" ]; then
          accounts=$(printf '%s"claude":%s,' "$accounts" "$(_account_json "$proj_claude_account")")
        fi
        if [ -n "$proj_codex_account" ]; then
          accounts=$(printf '%s"codex":%s,' "$accounts" "$(_account_json "$proj_codex_account")")
        fi
        if [ -n "$accounts" ]; then
          accounts=$(printf '%s' "$accounts" | sed 's/,$//')
          payload=$(printf '%s"agentAccounts":{%s},' "$payload" "$accounts")
        fi
        if [ -z "$payload" ]; then
          echo "No update fields provided" >&2
          exit 1
        fi
        payload=$(printf '%s' "$payload" | sed 's/,$//')
        tf_curl -sf -X PATCH "$TASKFLOW_API_URL/api/projects/$proj_id" \
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/projects/$proj_id/fork" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      move)
        proj_id="${1:-}"
        move_usage="Usage: taskflow-cli project move <id> (--to <n> | --before <id> | --after <id>)"
        if [ -z "$proj_id" ]; then
          echo "$move_usage" >&2
          exit 1
        fi
        shift
        move_target=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --to)
              case "${2:-}" in
                ''|-|*[!0-9-]*|?*-*) echo "--to must be a number" >&2; exit 1 ;;
              esac
              # Leading zeros are not valid JSON numbers.
              move_to=$(printf '%s' "$2" | sed 's/^\(-\{0,1\}\)0*\([0-9]\)/\1\2/')
              move_target=$(printf '"to":%s' "$move_to"); shift 2 ;;
            --before) move_target=$(printf '"before":%s' "$(json_string "${2:-}")"); shift 2 ;;
            --after) move_target=$(printf '"after":%s' "$(json_string "${2:-}")"); shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -z "$move_target" ]; then
          echo "One of --to, --before, or --after is required" >&2
          exit 1
        fi
        api_request POST "$TASKFLOW_API_URL/api/projects/$proj_id/move" "{$move_target}"
        ;;
      *)
        echo "Usage: taskflow-cli project <list|add|remove|update|fork|move>" >&2
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/schedules/complete" \
          -H "Content-Type: application/json" \
          -d "$payload"
        ;;
      list)
        if [ -n "$TASKFLOW_PROJECT_ID" ]; then
          tf_curl -sf "$TASKFLOW_API_URL/api/schedules?projectId=$TASKFLOW_PROJECT_ID"
        else
          tf_curl -sf "$TASKFLOW_API_URL/api/schedules"
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/schedules" \
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
        tf_curl -sf -X PATCH "$TASKFLOW_API_URL/api/schedules/$sched_id" \
          -H "Content-Type: application/json" \
          -d "{$payload}"
        ;;
      delete)
        sched_id="${1:-}"
        if [ -z "$sched_id" ]; then
          echo "Usage: taskflow-cli schedule delete <id>" >&2
          exit 1
        fi
        tf_curl -sf -X DELETE "$TASKFLOW_API_URL/api/schedules/$sched_id"
        ;;
      trigger)
        sched_id="${1:-}"
        if [ -z "$sched_id" ]; then
          echo "Usage: taskflow-cli schedule trigger <id>" >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/schedules/$sched_id/trigger"
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
        tf_curl -sf "$TASKFLOW_API_URL/api/agents"
        ;;
      run)
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
        agent_project_id=""
        agent_label=""
        agent_model=""
        agent_account=""
        # Claude-specific
        agent_permission_mode=""
        agent_effort=""
        agent_skip_permissions=""
        # Codex-specific
        agent_sandbox=""
        agent_approval_policy=""
        agent_reasoning_effort=""
        agent_full_auto=""
        # OpenCode-specific
        agent_auto_approve=""
        agent_yolo=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --prompt) agent_prompt="${2:-}"; shift 2 ;;
            --task) agent_task_id="${2:-}"; shift 2 ;;
            --project) agent_project_id="${2:-}"; shift 2 ;;
            --label) agent_label="${2:-}"; shift 2 ;;
            --model) agent_model="${2:-}"; shift 2 ;;
            --account) agent_account="${2:-}"; shift 2 ;;
            # Claude
            --dangerously-skip-permissions) agent_skip_permissions="true"; shift ;;
            --permission-mode) agent_permission_mode="${2:-}"; shift 2 ;;
            --effort) agent_effort="${2:-}"; shift 2 ;;
            # Codex
            --sandbox) agent_sandbox="${2:-}"; shift 2 ;;
            --approval-policy) agent_approval_policy="${2:-}"; shift 2 ;;
            --reasoning-effort) agent_reasoning_effort="${2:-}"; shift 2 ;;
            --dangerously-bypass-approvals-and-sandbox) agent_yolo="true"; shift ;;
            --full-auto) agent_full_auto="true"; shift ;;
            --yolo) agent_yolo="true"; shift ;;
            # OpenCode
            --auto-approve) agent_auto_approve="true"; shift ;;
            *) shift ;;
          esac
        done

        # An explicit --task carries its own project (the backend resolves
        # it), and an explicit --project starts a project-level session.
        # Only with neither does the caller's own owner apply.
        if [ -n "$agent_task_id" ]; then
          payload=$(printf '"taskId":%s' "$(json_string "$agent_task_id")")
          if [ -n "$agent_project_id" ]; then
            payload=$(printf '%s,"projectId":%s' "$payload" "$(json_string "$agent_project_id")")
          fi
        elif [ -n "$agent_project_id" ]; then
          payload=$(printf '"projectId":%s' "$(json_string "$agent_project_id")")
        else
          if [ -z "$TASKFLOW_PROJECT_ID" ]; then
            echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
            exit 1
          fi
          payload=$(printf '"projectId":%s' "$(json_string "$TASKFLOW_PROJECT_ID")")
          if [ -n "$TASKFLOW_TASK_ID" ]; then
            payload=$(printf '%s,"taskId":%s' "$payload" "$(json_string "$TASKFLOW_TASK_ID")")
          fi
        fi
        if [ -n "$agent_type" ]; then
          payload=$(printf '%s,"type":%s' "$payload" "$(json_string "$agent_type")")
        fi
        if [ -n "$agent_prompt" ]; then
          payload=$(printf '%s,"prompt":%s' "$payload" "$(json_string "$agent_prompt")")
        fi
        if [ -n "$agent_label" ]; then
          payload=$(printf '%s,"label":%s' "$payload" "$(json_string "$agent_label")")
        fi
        # Build agentOptions based on agent type
        agent_opts=""
        if [ -n "$agent_type" ]; then
          agent_opts=$(printf '"type":%s' "$(json_string "$agent_type")")
        fi
        _append_opt() {
          if [ -n "$agent_opts" ]; then
            agent_opts=$(printf '%s,%s' "$agent_opts" "$1")
          else
            agent_opts="$1"
          fi
        }
        if [ "$agent_type" = "claude" ]; then
          if [ -n "$agent_skip_permissions" ] && [ -z "$agent_permission_mode" ]; then
            agent_permission_mode="bypassPermissions"
          fi
          if [ -n "$agent_permission_mode" ]; then
            _append_opt "$(printf '"permissionMode":%s' "$(json_string "$agent_permission_mode")")"
          fi
          if [ -n "$agent_effort" ]; then
            _append_opt "$(printf '"effort":%s' "$(json_string "$agent_effort")")"
          fi
        elif [ "$agent_type" = "codex" ]; then
          if [ -n "$agent_full_auto" ]; then
            _append_opt '"sandbox":"workspace-write"'
            _append_opt '"approvalPolicy":"on-request"'
          fi
          if [ -n "$agent_yolo" ]; then
            _append_opt '"dangerouslyBypassApprovalsAndSandbox":true'
          fi
          if [ -n "$agent_sandbox" ]; then
            _append_opt "$(printf '"sandbox":%s' "$(json_string "$agent_sandbox")")"
          fi
          if [ -n "$agent_approval_policy" ]; then
            _append_opt "$(printf '"approvalPolicy":%s' "$(json_string "$agent_approval_policy")")"
          fi
          if [ -n "$agent_reasoning_effort" ]; then
            _append_opt "$(printf '"reasoningEffort":%s' "$(json_string "$agent_reasoning_effort")")"
          fi
        elif [ "$agent_type" = "opencode" ]; then
          if [ -n "$agent_auto_approve" ]; then
            _append_opt '"autoApprove":true'
          fi
        fi
        # With no agent named, the account goes to the backend's default agent,
        # which ignores it unless that agent has accounts.
        if [ -n "$agent_account" ] && { [ -z "$agent_type" ] || [ "$agent_type" = "claude" ] || [ "$agent_type" = "codex" ]; }; then
          _append_opt "$(printf '"account":%s' "$(json_string "$agent_account")")"
        fi
        if [ -n "$agent_model" ]; then
          _append_opt "$(printf '"model":%s' "$(json_string "$agent_model")")"
        fi
        # Only add agentOptions if we have more than just the type field
        if [ -n "$agent_opts" ]; then
          payload=$(printf '%s,"agentOptions":{%s}' "$payload" "$agent_opts")
        fi

        api_request POST "$TASKFLOW_API_URL/api/sessions" "{$payload}"
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/rename" \
          -H "Content-Type: application/json" \
          -d "$(printf '{"label":%s}' "$(json_string "$sess_label")")"
        ;;
      snapshot)
        sess_id="${1:-}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session snapshot <sessionId>" >&2
          exit 1
        fi
        tf_curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/snapshot"
        ;;
      close)
        sess_id="${1:-$TASKFLOW_SESSION_ID}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session close [sessionId]" >&2
          echo "  If no sessionId is provided, closes the current session (using TASKFLOW_SESSION_ID)." >&2
          exit 1
        fi
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/done"
        ;;
      status)
        sess_id="${1:-}"
        if [ -z "$sess_id" ]; then
          echo "Usage: taskflow-cli session status <sessionId>" >&2
          exit 1
        fi
        tf_curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/status"
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
        tf_curl -sf -X POST "$TASKFLOW_API_URL/api/sessions/$sess_id/input" \
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
        tf_curl -sf "$TASKFLOW_API_URL/api/sessions/$sess_id/tail?lines=$tail_lines"
        ;;
      move)
        move_body=""
        move_count=0
        move_session="$TASKFLOW_SESSION_ID"
        move_usage="Usage: taskflow-cli session move --task <id> | --project <id> | --master [--session <id>]"
        while [ $# -gt 0 ]; do
          case "$1" in
            --task|--project|--session)
              if [ $# -lt 2 ]; then echo "$move_usage" >&2; exit 1; fi
              case "$1" in
                --task) move_body=$(printf '{"taskId":%s}' "$(json_string "$2")"); move_count=$((move_count + 1)) ;;
                --project) move_body=$(printf '{"projectId":%s}' "$(json_string "$2")"); move_count=$((move_count + 1)) ;;
                --session) move_session="$2" ;;
              esac
              shift 2
              ;;
            --master) move_body='{"master":true}'; move_count=$((move_count + 1)); shift ;;
            *) echo "$move_usage" >&2; exit 1 ;;
          esac
        done
        if [ "$move_count" -ne 1 ] || [ -z "$move_session" ]; then
          echo "$move_usage" >&2
          exit 1
        fi
        api_request POST "$TASKFLOW_API_URL/api/sessions/$move_session/move" "$move_body"
        ;;
      *)
        echo "Usage: taskflow-cli session <rename|snapshot|close|status|input|tail|move>" >&2
        exit 1
        ;;
    esac
    ;;

  system)
    subcmd="${1:-}"
    case "$subcmd" in
      info) tf_curl -sf "$TASKFLOW_API_URL/api/system/info" ;;
      shells) tf_curl -sf "$TASKFLOW_API_URL/api/shells" ;;
      runtimes) tf_curl -sf "$TASKFLOW_API_URL/api/runtimes" ;;
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
        tf_curl -sf "$TASKFLOW_API_URL/api/settings"
        ;;
      *)
        echo "Usage: taskflow-cli settings <get>" >&2
        exit 1
        ;;
    esac
    ;;

  attr)
    subcmd="${1:-}"
    shift 2>/dev/null || true

    attr_task_flag=""
    attr_project_flag=""
    attr_own=""
    attr_pos1=""
    attr_pos2=""
    attr_pos_count=0
    attr_leftover=""

    # Split leading positionals from flags. A *required* positional slot is
    # filled unconditionally, so a name or value that looks like a flag
    # (e.g. "--own", "--task-id") is still accepted; once the optional slots
    # begin, a known attr flag ends positional collection. Mirrors
    # splitAttrArgs() in taskflow-cli-bin.ts.
    attr_parse() {
      attr_required="$1"
      attr_max="$2"
      shift 2
      while [ $# -gt 0 ] && [ "$attr_pos_count" -lt "$attr_max" ]; do
        if [ "$attr_pos_count" -ge "$attr_required" ]; then
          case "$1" in
            --task-id|--project-id|--own) break ;;
          esac
        fi
        attr_pos_count=$((attr_pos_count + 1))
        if [ "$attr_pos_count" -eq 1 ]; then
          attr_pos1="$1"
        else
          attr_pos2="$1"
        fi
        shift
      done
      while [ $# -gt 0 ]; do
        case "$1" in
          --task-id) attr_task_flag="${2:-}"; shift 2 ;;
          --project-id) attr_project_flag="${2:-}"; shift 2 ;;
          --own) attr_own="1"; shift ;;
          *) attr_leftover="1"; shift ;;
        esac
      done
    }

    # Explicit flag wins, then the ambient task, then the ambient project.
    attr_resolve_scope() {
      if [ -n "$attr_task_flag" ] && [ -n "$attr_project_flag" ]; then
        echo "Error: pass either --task-id or --project-id, not both" >&2
        exit 1
      fi
      if [ -n "$attr_task_flag" ]; then
        attr_collection="tasks"; attr_owner="$attr_task_flag"
      elif [ -n "$attr_project_flag" ]; then
        attr_collection="projects"; attr_owner="$attr_project_flag"
      elif [ -n "$TASKFLOW_TASK_ID" ]; then
        attr_collection="tasks"; attr_owner="$TASKFLOW_TASK_ID"
      elif [ -n "$TASKFLOW_PROJECT_ID" ]; then
        attr_collection="projects"; attr_owner="$TASKFLOW_PROJECT_ID"
      else
        echo "Error: no attribute scope — set TASKFLOW_TASK_ID or TASKFLOW_PROJECT_ID, or pass --task-id / --project-id" >&2
        exit 1
      fi
    }

    case "$subcmd" in
      list)
        attr_parse 0 0 "$@"
        if [ -n "$attr_leftover" ]; then
          echo "Usage: taskflow-cli attr list [--own] [--task-id <id>] [--project-id <id>]" >&2
          exit 1
        fi
        attr_resolve_scope
        attr_query=""
        if [ -n "$attr_own" ]; then
          attr_query="?own=1"
        fi
        api_request GET "$TASKFLOW_API_URL/api/$attr_collection/$attr_owner/attributes$attr_query"
        ;;
      get)
        attr_parse 1 1 "$@"
        if [ "$attr_pos_count" -lt 1 ] || [ -z "$attr_pos1" ] || [ -n "$attr_leftover" ]; then
          echo "Usage: taskflow-cli attr get <id>" >&2
          exit 1
        fi
        attr_resolve_scope
        api_request GET "$TASKFLOW_API_URL/api/$attr_collection/$attr_owner/attributes/$attr_pos1"
        ;;
      create)
        attr_parse 1 2 "$@"
        if [ "$attr_pos_count" -lt 1 ] || [ -z "$attr_pos1" ] || [ -n "$attr_leftover" ]; then
          echo "Usage: taskflow-cli attr create \"<name>\" [\"<value>\"]" >&2
          exit 1
        fi
        attr_resolve_scope
        attr_payload=$(printf '{"name":%s,"value":%s}' \
          "$(json_string "$attr_pos1")" "$(json_string "$attr_pos2")")
        api_request POST "$TASKFLOW_API_URL/api/$attr_collection/$attr_owner/attributes" "$attr_payload"
        ;;
      set|rename)
        attr_parse 2 2 "$@"
        if [ "$attr_pos_count" -lt 2 ] || [ -z "$attr_pos1" ] || [ -n "$attr_leftover" ]; then
          if [ "$subcmd" = "set" ]; then
            echo "Usage: taskflow-cli attr set <id> \"<value>\"" >&2
          else
            echo "Usage: taskflow-cli attr rename <id> \"<name>\"" >&2
          fi
          exit 1
        fi
        attr_resolve_scope
        if [ "$subcmd" = "set" ]; then
          attr_payload=$(printf '{"value":%s}' "$(json_string "$attr_pos2")")
        else
          attr_payload=$(printf '{"name":%s}' "$(json_string "$attr_pos2")")
        fi
        api_request PATCH "$TASKFLOW_API_URL/api/$attr_collection/$attr_owner/attributes/$attr_pos1" "$attr_payload"
        ;;
      delete)
        attr_parse 1 1 "$@"
        if [ "$attr_pos_count" -lt 1 ] || [ -z "$attr_pos1" ] || [ -n "$attr_leftover" ]; then
          echo "Usage: taskflow-cli attr delete <id>" >&2
          exit 1
        fi
        attr_resolve_scope
        api_request DELETE "$TASKFLOW_API_URL/api/$attr_collection/$attr_owner/attributes/$attr_pos1"
        ;;
      *)
        echo "Usage: taskflow-cli attr <list|get|create|set|rename|delete> [--task-id <id>] [--project-id <id>]" >&2
        exit 1
        ;;
    esac
    ;;

  app-name)
    tf_curl -sf "$TASKFLOW_API_URL/api/app-name"
    ;;

  help|--help|-h)
    tf_curl -sf "$TASKFLOW_API_URL/api/cli-help"
    ;;

  *)
    tf_curl -sf "$TASKFLOW_API_URL/api/cli-help" >&2
    exit 1
    ;;
esac

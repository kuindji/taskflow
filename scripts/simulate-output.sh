#!/bin/bash
# Simulates a long-running Claude-like conversation with varied output patterns.
# Run this in a shell tab within Taskflow to reproduce scrolling issues.
#
# Usage: bash scripts/simulate-output.sh [rounds]
#   rounds: number of conversation rounds (default: 50)

ROUNDS="${1:-50}"
COLORS=("\033[0m" "\033[1m" "\033[36m" "\033[33m" "\033[32m" "\033[90m")

print_separator() {
    printf '\033[90m%s\033[0m\n' "────────────────────────────────────────────────────────"
}

# Simulate a short text response
short_response() {
    printf '\033[1m\033[36m❯\033[0m Round %d — Short response\n\n' "$1"
    echo "I'll check the configuration file for that setting."
    echo ""
    sleep 0.3
}

# Simulate a code block (many lines, typical tool output)
code_block() {
    local lines="${2:-80}"
    printf '\033[1m\033[36m❯\033[0m Round %d — Code block (%d lines)\n\n' "$1" "$lines"
    printf '\033[90m```typescript\033[0m\n'
    for j in $(seq 1 "$lines"); do
        printf '  \033[33mline %3d\033[0m: const result_%d = await processData({\n' "$j" "$j"
        printf '    input: "%s",\n' "value_$j"
        printf '    options: { timeout: %d, retries: 3 },\n' "$((j * 100))"
        printf '  });\n'
    done
    printf '\033[90m```\033[0m\n\n'
    sleep 0.2
}

# Simulate a plan/list output
plan_output() {
    local steps="${2:-15}"
    printf '\033[1m\033[36m❯\033[0m Round %d — Plan (%d steps)\n\n' "$1" "$steps"
    printf '\033[1m## Implementation Plan\033[0m\n\n'
    for j in $(seq 1 "$steps"); do
        printf '\033[32m  %2d.\033[0m \033[1mStep %d:\033[0m ' "$j" "$j"
        case $((j % 5)) in
            0) echo "Update the configuration schema and validate inputs";;
            1) echo "Refactor the authentication middleware for token rotation";;
            2) echo "Add integration tests for the new WebSocket handler";;
            3) echo "Migrate the database schema and run backfill script";;
            4) echo "Deploy to staging and verify monitoring dashboards";;
        esac
        printf '     \033[90m→ Estimated: %d files changed, %d tests added\033[0m\n' "$((RANDOM % 10 + 1))" "$((RANDOM % 20 + 1))"
    done
    echo ""
    sleep 0.3
}

# Simulate a large file read (burst of output)
large_file_read() {
    local lines="${2:-200}"
    printf '\033[1m\033[36m❯\033[0m Round %d — File read (%d lines, burst)\n\n' "$1" "$lines"
    printf '\033[90mReading /src/components/workspace/TabContent.tsx\033[0m\n\n'
    # Output all at once (no sleep between lines) to trigger multi-frame writes
    for j in $(seq 1 "$lines"); do
        printf '%4d│ ' "$j"
        case $((j % 7)) in
            0) printf 'import { useCallback, useEffect, useRef, useState } from "react";\n';;
            1) printf 'export function TabContent({ tabs, activeTabId }: TabContentProps) {\n';;
            2) printf '    const workspace = useActiveWorkspace();\n';;
            3) printf '    const [dragOver, setDragOver] = useState(false);\n';;
            4) printf '    // This is a comment explaining the component behavior\n';;
            5) printf '    return <div className="relative flex flex-1 overflow-hidden">content</div>;\n';;
            6) printf '}\n';;
        esac
    done
    echo ""
    sleep 0.1
}

# Simulate a diff output
diff_output() {
    local hunks="${2:-30}"
    printf '\033[1m\033[36m❯\033[0m Round %d — Diff output (%d lines)\n\n' "$1" "$hunks"
    printf '\033[1mdiff --git a/src/lib/writer.ts b/src/lib/writer.ts\033[0m\n'
    printf '\033[36m@@ -10,6 +10,8 @@\033[0m\n'
    for j in $(seq 1 "$hunks"); do
        case $((j % 4)) in
            0) printf '\033[32m+ const newLine = processInput(data_%d);\033[0m\n' "$j";;
            1) printf '\033[31m- const oldLine = legacyProcess(data_%d);\033[0m\n' "$j";;
            2) printf '  const unchanged = keepThis(value_%d);\n' "$j";;
            3) printf '\033[36m@@ -%d,%d +%d,%d @@\033[0m function handler() {\n' "$((j*10))" "6" "$((j*10))" "8";;
        esac
    done
    echo ""
    sleep 0.3
}

# Simulate mixed rapid-fire output (questions + short answers)
rapid_exchange() {
    local count="${2:-10}"
    printf '\033[1m\033[36m❯\033[0m Round %d — Rapid exchange (%d messages)\n\n' "$1" "$count"
    for j in $(seq 1 "$count"); do
        printf '\033[33mUser:\033[0m What about item %d?\n' "$j"
        printf '\033[36mAssistant:\033[0m Item %d is configured in the settings file at line %d. ' "$j" "$((j * 17))"
        echo "The current value is $(openssl rand -hex 8 2>/dev/null || echo "abc123") and it controls the retry behavior."
        echo ""
        sleep 0.05
    done
    sleep 0.2
}

echo ""
printf '\033[1m\033[33m=== Simulating %d conversation rounds ===\033[0m\n\n' "$ROUNDS"
printf '\033[90mThis script simulates varied output patterns to test terminal scrolling.\033[0m\n'
printf '\033[90mWatch for: viewport jumping, losing scroll position, inability to see old content.\033[0m\n\n'
sleep 1

for i in $(seq 1 "$ROUNDS"); do
    print_separator

    # Vary output type based on round
    case $((i % 8)) in
        0) short_response "$i";;
        1) code_block "$i" "$((40 + RANDOM % 80))";;
        2) plan_output "$i" "$((10 + RANDOM % 20))";;
        3) large_file_read "$i" "$((100 + RANDOM % 300))";;
        4) diff_output "$i" "$((20 + RANDOM % 40))";;
        5) rapid_exchange "$i" "$((5 + RANDOM % 15))";;
        6) code_block "$i" "$((100 + RANDOM % 150))";;
        7) large_file_read "$i" "$((200 + RANDOM % 400))";;
    esac

    # Progress indicator
    printf '\033[90m[%d/%d rounds complete — %d%% done]\033[0m\n\n' "$i" "$ROUNDS" "$((i * 100 / ROUNDS))"
done

print_separator
printf '\n\033[1m\033[32m=== Simulation complete (%d rounds) ===\033[0m\n' "$ROUNDS"
echo "Scroll up to verify all content is accessible."
echo ""

import type { AgentLaunchOptions, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";

/** What a new worktree task starts with once its worktree is ready. */
export type PendingTaskStart =
    | {
          kind: "session";
          type: "claude" | "codex" | "opencode" | "pi" | "kimi";
          description: string;
          agentOptions?: AgentLaunchOptions;
      }
    | { kind: "flow"; flowId: string; inputValues?: Record<string, string> };

/**
 * Removes and returns the starts whose task is ready: its worktree is set up,
 * or setup failed and the task fell back to the project folder. A start whose
 * task is gone is dropped. Starts are keyed by task id, so a task created
 * while another one's worktree is still being set up keeps its own start.
 */
export function takeReadyStarts(
    pending: Map<string, PendingTaskStart>,
    tasks: Scoped<Task>[],
): Array<{ task: Scoped<Task>; start: PendingTaskStart }> {
    const ready: Array<{ task: Scoped<Task>; start: PendingTaskStart }> = [];
    for (const [taskId, start] of pending) {
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
            pending.delete(taskId);
        } else if (!task.worktree.enabled || task.worktree.path) {
            pending.delete(taskId);
            ready.push({ task, start });
        }
    }
    return ready;
}

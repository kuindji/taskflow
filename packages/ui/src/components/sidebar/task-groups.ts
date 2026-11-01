import type { Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";

interface TaskGroups {
    topLevelTasks: Scoped<Task>[];
    subtaskMap: Map<string, Scoped<Task>[]>;
}

/**
 * Splits a project's listed tasks into rows and their subtasks. A subtask
 * whose parent is not listed gets a row of its own: in the archive view a
 * subtask archived alone has an active parent, and nesting it under that
 * absent parent would hide it.
 */
export function groupTasksByParent(tasks: Scoped<Task>[]): TaskGroups {
    const topLevelTasks: Scoped<Task>[] = [];
    const subtaskMap = new Map<string, Scoped<Task>[]>();
    const listedIds = new Set(tasks.map((task) => task.id));
    for (const task of tasks) {
        if (task.parentId && listedIds.has(task.parentId)) {
            const list = subtaskMap.get(task.parentId) ?? [];
            list.push(task);
            subtaskMap.set(task.parentId, list);
        } else {
            topLevelTasks.push(task);
        }
    }
    return { topLevelTasks, subtaskMap };
}
